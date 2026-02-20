import os
import json
import logging
import asyncio
from typing import Optional
from fastapi import FastAPI, Request, Response, BackgroundTasks
from dotenv import load_dotenv
from supabase import create_client, Client

load_dotenv()

# Configuração de Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("worker-cuca")

# Configurações do Supabase
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

app = FastAPI(title="Worker Sistema CUCA")

async def process_webhook_payload(payload: dict, token: str):
    """Processa o payload do webhook em background."""
    try:
        # 1. Salvar o log bruto do webhook para auditoria
        event_type = payload.get("event", "unknown")
        instance_name = payload.get("instance", "unknown")
        data = payload.get("data", {})
        
        # Tenta salvar em logs_webhook
        try:
            supabase.table("logs_webhook").insert({
                "instancia_uazapi": instance_name,
                "tipo_evento": event_type,
                "payload": payload,
                "processado": False
            }).execute()
        except Exception as e:
            logger.error(f"Erro ao salvar em logs_webhook: {str(e)}")

        # 2. Roteamento básico de eventos
        if event_type == "messages.upsert":
            logger.info(f"Nova mensagem recebida na instância {instance_name}")
            
            # Extrair dados básicos da mensagem
            message_data = data.get("message", {})
            remote_jid = data.get("key", {}).get("remoteJid")
            phone = remote_jid.split("@")[0] if remote_jid else None
            from_me = data.get("key", {}).get("fromMe", False)
            push_name = data.get("pushName", "Usuário")
            
            # Conteúdo (texto base ou transcrição futura)
            text_content = ""
            if "conversation" in message_data:
                text_content = message_data["conversation"]
            elif "extendedTextMessage" in message_data:
                text_content = message_data["extendedTextMessage"].get("text", "")
            
            if not phone:
                return

            # --- Fluxo de Banco de Dados ---
            
            # A. Garantir que o Lead existe
            try:
                # Upsert lead (baseado no telefone)
                lead_result = supabase.table("leads").upsert({
                    "telefone": phone,
                    "nome": push_name if not from_me else None,
                    "remote_jid": remote_jid,
                    "updated_at": "now()"
                }, on_conflict="telefone").execute()
                lead_id = lead_result.data[0]["id"]
            except Exception as e:
                logger.error(f"Erro ao gerenciar Lead: {str(e)}")
                return # Se não tiver lead, não salvamos mensagem

            # B. Garantir que a Conversa existe
            try:
                # Tenta buscar conversa ativa
                conv_result = supabase.table("conversas").select("id").match({
                    "lead_id": lead_id,
                    "instancia_uazapi": instance_name
                }).execute()
                
                if conv_result.data:
                    conversation_id = conv_result.data[0]["id"]
                    # Atualizar timestamp
                    supabase.table("conversas").update({"updated_at": "now()"}).eq("id", conversation_id).execute()
                else:
                    # Criar nova conversa
                    new_conv = supabase.table("conversas").insert({
                        "lead_id": lead_id,
                        "instancia_uazapi": instance_name,
                        "status": "ativa"
                    }).execute()
                    conversation_id = new_conv.data[0]["id"]
            except Exception as e:
                logger.error(f"Erro ao gerenciar Conversa: {str(e)}")
                return

            # C. Salvar em Mensagens
            try:
                supabase.table("mensagens").insert({
                    "conversa_id": conversation_id,
                    "lead_id": lead_id,
                    "tipo": "text", # Por enquanto fixo para MVP
                    "conteudo": text_content,
                    "remetente": "lead" if not from_me else "agente",
                    "created_at": "now()"
                }).execute()
                logger.info(f"Mensagem salva com sucesso. ConvID: {conversation_id}")
            except Exception as e:
                logger.error(f"Erro ao salvar mensagem: {str(e)}")
            
            # --- S5-02: Routing Automático para Motor de IA ---
            if not from_me:
                try:
                    # Chamar Edge Function motor-agente
                    # Nota: O token interno garante que a requisição partiu do nosso worker
                    import httpx
                    
                    async with httpx.AsyncClient() as client:
                        # Buscamos a URL base do Supabase do .env
                        edge_url = f"{SUPABASE_URL}/functions/v1/motor-agente"
                        headers = {
                            "Authorization": f"Bearer {SUPABASE_KEY}",
                            "Content-Type": "application/json",
                            "x-internal-token": os.getenv("WEBHOOK_INTERNAL_TOKEN")
                        }
                        payload_edge = {
                            "conversa_id": conversation_id,
                            "lead_id": lead_id,
                            "instancia": instance_name,
                            "mensagem": text_content
                        }
                        
                        logger.info(f"Roteando para motor-agente: {edge_url}")
                        # Não esperamos a resposta lenta da IA (fire and forget ou background)
                        # mas logamos o disparo
                        await client.post(edge_url, json=payload_edge, headers=headers, timeout=0.1)
                except httpx.ReadTimeout:
                    # Timeout curto é esperado se não quisermos esperar o processamento da IA
                    pass
                except Exception as e:
                    logger.error(f"Erro ao rotear para motor-agente: {str(e)}")
            
        elif event_type == "connection.update":
            status = data.get("status")
            logger.info(f"Instância {instance_name} mudou status para: {status}")
            # Atualizar tabela instancias_uazapi
            supabase.table("instancias_uazapi").update({
                "ativa": status == "open",
                "updated_at": "now()"
            }).eq("nome", instance_name).execute()

    except Exception as e:
        logger.error(f"Erro no processamento em background: {str(e)}")

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "worker-cuca"}

@app.post("/webhook/{token}")
async def uazapi_webhook(token: str, request: Request, background_tasks: BackgroundTasks):
    # 1. Resposta 200 OK imediata (Requisito Crítico UAZAPI / Anti-Ban)
    # A resposta deve ser rápida para evitar que a UAZAPI tente reenvios agressivos
    
    try:
        payload = await request.json()
        logger.info(f"Webhook recebido: {payload.get('event')} via token: {token}")
        
        # 2. Agendar processamento pesado em background
        background_tasks.add_task(process_webhook_payload, payload, token)
        
        return Response(status_code=200, content=json.dumps({"status": "received"}))
    except Exception as e:
        logger.error(f"Erro ao receber webhook: {str(e)}")
        # Retornamos 200 mesmo assim para não travar o fluxo da UAZAPI
        return Response(status_code=200, content=json.dumps({"status": "error", "message": str(e)}))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
