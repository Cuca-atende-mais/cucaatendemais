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

@app.on_event("startup")
async def startup_event():
    from campanhas_engine import campanhas_loop
    import asyncio
    logger.info("Agendando motor de Campanhas...")
    asyncio.create_task(campanhas_loop())

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
                    "updated_at": "now()"
                }, on_conflict="telefone").execute()
                lead_id = lead_result.data[0]["id"]
            except Exception as e:
                logger.error(f"Erro ao gerenciar Lead: {str(e)}")
                return # Se não tiver lead, não salvamos mensagem

            # B. Garantir que a Conversa existe
            try:
                # Tenta buscar conversa (verificando se está em modo manual ou ativa)
                conv_result = supabase.table("conversas").select("id, status").match({
                    "lead_id": lead_id,
                    "instancia_uazapi": instance_name
                }).execute()
                
                conversation_status = "ativa" # Default
                if conv_result.data:
                    conversation_id = conv_result.data[0]["id"]
                    conversation_status = conv_result.data[0].get("status", "ativa")
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
            # A IA só é disparada se não for uma mensagem nossa E se o status for 'ativa'
            if not from_me and conversation_status == "ativa":
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
                        # Buscar dados da instância para passar ao motor-agente
                        inst_result = supabase.table("instancias_uazapi").select("cuca_unit_id, agente_tipo, token").eq("nome", instance_name).single().execute()
                        agente_tipo = inst_result.data.get("agente_tipo", "maria") if inst_result.data else "maria"
                        unidade_cuca = inst_result.data.get("cuca_unit_id") if inst_result.data else None
                        inst_token = inst_result.data.get("token") if inst_result.data else ""
                        
                        payload_edge = {
                            "telefone": phone,
                            "instancia_uazapi": instance_name,
                            "agente_tipo": agente_tipo,
                            "unidade_cuca": unidade_cuca,
                            "mensagem": text_content,
                            "midia_tipo": "text"
                        }
                        
                        logger.info(f"Roteando para motor-agente: {edge_url}")
                        
                        # S5-08: Agora esperamos a resposta da IA para extrair Mídia Contextual (Flyers) e enviar via UAZAPI
                        # Timeout 45s (GPT-4 pode demorar) mas como estamos em background, não trava o webhook de 200 OK
                        resp = await client.post(edge_url, json=payload_edge, headers=headers, timeout=45.0)
                        
                        if resp.status_code == 200:
                            data = resp.json()
                            if data.get("success") and "resposta" in data:
                                resposta_ia = data["resposta"]
                                import re
                                media_url = None
                                
                                # Tenta extrair flyer markdown `![alt](url)`
                                match_md = re.search(r'!\[.*?\]\((.*?)\)', resposta_ia)
                                # Tenta extrair flyer tag `[FLYER: url]`
                                match_tag = re.search(r'\[(?:FLYER|MÍDIA):\s*(.*?)\]', resposta_ia)
                                
                                if match_md:
                                    media_url = match_md.group(1).strip()
                                    resposta_ia = resposta_ia.replace(match_md.group(0), '').strip()
                                elif match_tag:
                                    media_url = match_tag.group(1).strip()
                                    resposta_ia = resposta_ia.replace(match_tag.group(0), '').strip()
                                
                                UAZAPI_URL = os.getenv("UAZAPI_BASE_URL", "https://uazapi.com.br")
                                
                                if media_url:
                                    logger.info(f"Flyer detectado! Enviando media_url: {media_url}")
                                    # Envia a Midia e o restante da resposta como caption
                                    await client.post(
                                        f"{UAZAPI_URL}/message/sendMedia/{instance_name}",
                                        headers={"apikey": inst_token, "Content-Type": "application/json"},
                                        json={
                                            "number": phone,
                                            "options": {"delay": 1500, "presence": "composing"},
                                            "mediaMessage": {
                                                "mediatype": "image",
                                                "caption": resposta_ia,
                                                "media": media_url
                                            }
                                        }
                                    )
                                else:
                                    logger.info(f"Apenas texto detectado. Tamanho: {len(resposta_ia)}")
                                    await client.post(
                                        f"{UAZAPI_URL}/message/sendText/{instance_name}",
                                        headers={"apikey": inst_token, "Content-Type": "application/json"},
                                        json={
                                            "number": phone,
                                            "options": {"delay": 1200, "presence": "composing"},
                                            "textMessage": {"text": resposta_ia}
                                        }
                                    )
                        else:
                            logger.error(f"Erro no motor-agente HTTP {resp.status_code}: {resp.text}")
                    except httpx.ReadTimeout:
                        logger.error("Timeout aguardando processamento da IA (motor-agente demorou muito >45s).")
                    except Exception as e:
                        logger.error(f"Erro crítico no fluxo com motor-agente: {str(e)}")
            
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

@app.post("/send-message/{token}")
async def send_manual_message(token: str, request: Request):
    """S5-06: Envio manual de mensagem via Portal -> Worker -> UAZAPI."""
    if token != os.getenv("WEBHOOK_INTERNAL_TOKEN"):
        return Response(status_code=403, content="Token inválido")
    
    try:
        payload = await request.json()
        number = payload.get("number")
        text = payload.get("text")
        instance = payload.get("instance")

        # 1. Buscar credenciais da instância no Supabase
        inst_res = supabase.table("instancias_uazapi").select("nome, token").eq("nome", instance).single().execute()
        if not inst_res.data:
            return Response(status_code=404, content="Instância não encontrada")
        
        inst_token = inst_res.data["token"]
        UAZAPI_URL = os.getenv("UAZAPI_BASE_URL", "https://uazapi.com.br")

        # 2. Disparar para UAZAPI
        import httpx
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{UAZAPI_URL}/message/sendText/{instance}",
                headers={"apikey": inst_token, "Content-Type": "application/json"},
                json={
                    "number": number,
                    "options": {"delay": 1200, "presence": "composing"},
                    "textMessage": {"text": text}
                }
            )
            return response.json()
    except Exception as e:
        logger.error(f"Erro ao enviar mensagem manual: {str(e)}")
        return Response(status_code=500, content=str(e))

@app.post("/read-message/{token}")
async def mark_as_read(token: str, request: Request):
    """S5-07: Sincronização - Marcar conversa como lida no celular."""
    if token != os.getenv("WEBHOOK_INTERNAL_TOKEN"):
        return Response(status_code=403, content="Token inválido")
    
    try:
        payload = await request.json()
        remote_jid = payload.get("remoteJid") # formato: "558599999999@s.whatsapp.net"
        instance = payload.get("instance")

        inst_res = supabase.table("instancias_uazapi").select("token").eq("nome", instance).single().execute()
        if not inst_res.data: return Response(status_code=404)

        UAZAPI_URL = os.getenv("UAZAPI_BASE_URL", "https://uazapi.com.br")
        import httpx
        async with httpx.AsyncClient() as client:
            await client.post(
                f"{UAZAPI_URL}/chat/read/{instance}",
                headers={"apikey": inst_res.data["token"], "Content-Type": "application/json"},
                json={"remoteJid": remote_jid}
            )
        return {"success": True}
    except Exception as e:
        logger.error(f"Erro ao marcar como lida: {str(e)}")
        return Response(status_code=500)

@app.post("/process-cv")
async def process_cv_endpoint(request: Request, background_tasks: BackgroundTasks):
    """S9-08: Rota para o portal disparar o processamento OCR asincrono (GPT-4o)."""
    try:
        payload = await request.json()
        candidatura_id = payload.get("candidatura_id")
        cv_url = payload.get("cv_url")
        vaga_id = payload.get("vaga_id")
        
        if not candidatura_id or not cv_url or not vaga_id:
            return Response(status_code=400, content="Faltando parâmetros obligatórios")

        from cv_processor import process_cv_ocr
        background_tasks.add_task(process_cv_ocr, candidatura_id, cv_url, vaga_id)
        
        return {"status": "processing_started"}
    except Exception as e:
        logger.error(f"Erro ao startar OCR: {str(e)}")
        return Response(status_code=500, content=str(e))

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
