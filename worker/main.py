import os
import json
import logging
import asyncio
import time
from typing import Optional
from collections import defaultdict
from fastapi import FastAPI, Request, Response, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from supabase import create_client, Client
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration
from sentry_sdk.integrations.httpx import HttpxIntegration
from sentry_sdk.integrations.logging import LoggingIntegration

load_dotenv()

# ─── Sentry: Monitoramento de Erros ───────────────────────────────────────────
_SENTRY_DSN = os.getenv("SENTRY_DSN_WORKER")
if _SENTRY_DSN:
    sentry_sdk.init(
        dsn=_SENTRY_DSN,
        integrations=[
            FastApiIntegration(transaction_style="endpoint"),
            HttpxIntegration(),
            LoggingIntegration(
                level=logging.WARNING,        # Captura logs WARNING+
                event_level=logging.ERROR,    # Envia como evento ERROR+
            ),
        ],
        # 10% das transações para performance monitoring
        traces_sample_rate=0.1,
        # Ambiente e versão
        environment=os.getenv("ENVIRONMENT", "production"),
        release=os.getenv("APP_VERSION", "1.0.0"),
        # Não capturar dados sensíveis (tokens, senhas)
        send_default_pii=False,
    )


# Configuração de Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("worker-cuca")

# Configurações do Supabase
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


# ─── Rate Limiter em Memória ─────────────────────────────────────────────────
# Estrutura: {ip: [timestamps]}
_rate_limit_store: dict = defaultdict(list)
RATE_LIMIT_REQUESTS = 30   # máximo de requisições
RATE_LIMIT_WINDOW = 60     # em uma janela de X segundos

def check_rate_limit(ip: str) -> bool:
    """Retorna True se a requisição deve ser bloqueada."""
    now = time.time()
    window_start = now - RATE_LIMIT_WINDOW
    # Limpa os timestamps antigos
    _rate_limit_store[ip] = [ts for ts in _rate_limit_store[ip] if ts > window_start]
    if len(_rate_limit_store[ip]) >= RATE_LIMIT_REQUESTS:
        return True  # bloqueado
    _rate_limit_store[ip].append(now)
    return False

app = FastAPI(title="Worker Sistema CUCA", docs_url=None, redoc_url=None)

# ─── CORS: Apenas origens conhecidas ─────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://cucaatendemais.com.br",
        "https://www.cucaatendemais.com.br",
        "https://portal.cuca.ce.gov.br",
        "https://cuca-portal.vercel.app",
        "http://localhost:3000",
        "http://localhost:3001",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
)

# ─── Middleware de Segurança e Rate Limit ─────────────────────────────────────
@app.middleware("http")
async def security_middleware(request: Request, call_next):
    # 1. Extrair IP real (atrás de proxy NGINX)
    client_ip = request.headers.get("X-Real-IP") or request.headers.get("X-Forwarded-For", "").split(",")[0].strip() or (request.client.host if request.client else "unknown")
    
    # 2. Isentar webhook e health do rate limit
    path = request.url.path
    is_webhook = path.startswith("/webhook/") or path in ("/", "/health")
    
    # 3. Rate limit para endpoints não-webhook
    if not is_webhook and check_rate_limit(client_ip):
        logger.warning(f"Rate limit atingido para IP: {client_ip} em {path}")
        return Response(
            content=json.dumps({"error": "Muitas requisições. Tente novamente em 1 minuto."}),
            status_code=429,
            media_type="application/json",
            headers={"Retry-After": "60"}
        )
    
    # 4. Processar requisição
    response = await call_next(request)
    
    # 5. Adicionar headers de segurança na resposta
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    
    return response


@app.on_event("startup")
async def startup_event():
    from campanhas_engine import campanhas_loop
    import asyncio
    logger.info("Agendando motor de Campanhas...")
    asyncio.create_task(campanhas_loop())

# ─── Exception Handlers Globais ──────────────────────────────────────────────
# Garante que TODOS os erros retornem CORS headers (sem isso, exceções não tratadas
# passam pelo ServerErrorMiddleware ANTES do CORSMiddleware, sem headers)
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"[500] Exceção não tratada em {request.method} {request.url.path}: {type(exc).__name__}: {exc}")
    return JSONResponse(
        status_code=500,
        content={"error": "Erro interno do servidor", "detail": str(exc)},
    )

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail},
    )

# ─── Router: UAZAPI Manager ─────────────────────────────────────────────────
from uazapi_manager import router as uazapi_router
app.include_router(uazapi_router)

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
        # UAZAPI v2: evento de conexão é 'connection'
        if event_type in ("connection", "connection.update"):
            # instance_data: objeto interno com status string (connected/disconnected)
            instance_data = data.get("instance", {})
            state = instance_data.get("status") or data.get("state") or ""
            # status_info: objeto {connected: bool, loggedIn: bool, jid: {...}}
            status_info = data.get("status", {})
            bool_connected = status_info.get("connected", False) if isinstance(status_info, dict) else False
            jid = status_info.get("jid") if isinstance(status_info, dict) else None
            phone_jid = data.get("wuid") or data.get("me", {}).get("id", "")
            phone = None
            if jid and isinstance(jid, dict):
                phone = jid.get("user")
            elif phone_jid:
                phone = phone_jid.split("@")[0].split(":")[0]
            try:
                from uazapi_manager import handle_connection_update
                await handle_connection_update(instance_name, state, token, phone, bool_connected)
            except Exception as conn_err:
                logger.error(f"Erro em handle_connection_update: {conn_err}")

        elif event_type == "messages.upsert":

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
                opt_in = lead_result.data[0].get("opt_in", False)
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
            
            # --- S14-01 e S14-02: Opt-in LGPD ---
            if not from_me and conversation_status == "ativa":
                if not opt_in:
                    texto_limpo = text_content.lower().strip()
                    import httpx
                    
                    # Verificando resposta ao opt-in
                    if texto_limpo in ["sim", "aceito", "quero"]:
                        try:
                            supabase.table("leads").update({"opt_in": True}).eq("id", lead_id).execute()
                            logger.info(f"Lead {lead_id} aceitou o LGPD Opt-in.")
                        except Exception as e:
                            logger.error(f"Erro ao setar opt-in: {e}")
                        
                        # Marca virtualmente como verdadeiro para continuar o fluxo para a IA nesta mesma mensagem
                        opt_in = True
                        
                        # Responder agradecendo
                        try:
                            UAZAPI_URL = os.getenv("UAZAPI_BASE_URL", "https://uazapi.com.br")
                            inst_result = supabase.table("instancias_uazapi").select("token").eq("nome", instance_name).single().execute()
                            inst_token = inst_result.data.get("token") if inst_result.data else ""
                            
                            async def notify_optin():
                                async with httpx.AsyncClient() as client:
                                    payload_send = {
                                        "number": phone,
                                        "options": {"delay": 1200, "presence": "composing"},
                                        "textMessage": {"text": "Obrigado por confirmar! Aguarde um momento enquanto processo seu atendimento..." }
                                    }
                                    await client.post(f"{UAZAPI_URL}/message/sendText/{instance_name}", json=payload_send, headers={"apikey": inst_token})
                            asyncio.create_task(notify_optin())
                        except Exception as e:
                            pass
                            
                    elif texto_limpo in ["não", "nao", "sair", "parar"]:
                        # Usuário negou o opt-in
                        try:
                            UAZAPI_URL = os.getenv("UAZAPI_BASE_URL", "https://uazapi.com.br")
                            inst_result = supabase.table("instancias_uazapi").select("token").eq("nome", instance_name).single().execute()
                            inst_token = inst_result.data.get("token") if inst_result.data else ""
                            
                            async with httpx.AsyncClient() as client:
                                payload_send = {
                                    "number": phone,
                                    "options": {"delay": 1200, "presence": "composing"},
                                    "textMessage": {"text": "Tudo bem! Suas preferências foram salvas e você não receberá mensagens do Atende+. Caso mude de ideia no futuro, basta mandar um 'Oi'." }
                                }
                                await client.post(f"{UAZAPI_URL}/message/sendText/{instance_name}", json=payload_send, headers={"apikey": inst_token})
                        except Exception as e:
                            logger.error(f"Erro ao tratar recusa de opt-in: {e}")
                        return # Encerra processamento
                    else:
                        # Manda a mensagem padrão pedindo aceite
                        try:
                            UAZAPI_URL = os.getenv("UAZAPI_BASE_URL", "https://uazapi.com.br")
                            inst_result = supabase.table("instancias_uazapi").select("token").eq("nome", instance_name).single().execute()
                            inst_token = inst_result.data.get("token") if inst_result.data else ""
                            
                            async with httpx.AsyncClient() as client:
                                payload_send = {
                                    "number": phone,
                                    "options": {"delay": 1200, "presence": "composing"},
                                    "textMessage": {"text": "👋 Olá! Bem-vindo ao *Atende+* da Rede CUCA.\n\nPara continuar o atendimento e de acordo com a LGPD, preciso que você aceite receber nossas mensagens e concorde com a nossa política.\n\nResponda *Sim* para continuar ou *Não* para encerrar." }
                                }
                                await client.post(f"{UAZAPI_URL}/message/sendText/{instance_name}", json=payload_send, headers={"apikey": inst_token})
                        except Exception as e:
                            logger.error(f"Erro ao pedir opt-in: {e}")
                        return # Encerra processamento até ele responder Sim

            # --- S9-08: STOP Automático (leads com opt_in=True que pedem saída) ---
            PALAVRAS_STOP_HANDLER = {
                "stop", "parar", "sair", "cancelar", "nao quero", "não quero",
                "remover", "descadastrar", "chega", "pare", "encerrar", "encerra",
                "sair da lista", "tirar da lista", "me remova"
            }
            if not from_me and opt_in:
                texto_stop = text_content.lower().strip()
                if any(p in texto_stop for p in PALAVRAS_STOP_HANDLER):
                    try:
                        supabase.table("leads").update({"opt_in": False}).eq("id", lead_id).execute()
                        logger.info(f"[STOP] Lead {lead_id} ({phone}) removido da lista.")
                        UAZAPI_URL = os.getenv("UAZAPI_BASE_URL", "https://uazapi.com.br")
                        inst_result = supabase.table("instancias_uazapi").select("token") \
                            .eq("nome", instance_name).single().execute()
                        inst_token = inst_result.data.get("token") if inst_result.data else ""
                        import httpx
                        async with httpx.AsyncClient() as client:
                            await client.post(
                                f"{UAZAPI_URL}/message/sendText/{instance_name}",
                                headers={"apikey": inst_token, "Content-Type": "application/json"},
                                json={
                                    "number": phone,
                                    "options": {"delay": 1200, "presence": "composing"},
                                    "textMessage": {"text": "✅ Pronto! Você foi removido da nossa lista de mensagens. Sentiremos sua falta! Se mudar de ideia, é só mandar um 'Oi'."}
                                }
                            )
                    except Exception as stop_err:
                        logger.error(f"[STOP] Erro ao processar opt_out: {stop_err}")
                    return  # Não processa IA após STOP

            # --- S5-02: Routing Automático para Motor de IA ---
            # A IA só é disparada se não for uma mensagem nossa, se o status for 'ativa' e se tiver opt-in LGPD aceito
            if not from_me and conversation_status == "ativa" and opt_in:
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
                        # S5-02 + S9-13: Buscar dados da instância (canal_tipo, agente, unidade)
                        inst_result = supabase.table("instancias_uazapi") \
                            .select("cuca_unit_id, agente_tipo, token, canal_tipo") \
                            .eq("nome", instance_name).single().execute()
                        agente_tipo = inst_result.data.get("agente_tipo", "maria") if inst_result.data else "maria"
                        unidade_cuca = inst_result.data.get("cuca_unit_id") if inst_result.data else None
                        inst_token = inst_result.data.get("token") if inst_result.data else ""
                        canal_tipo = inst_result.data.get("canal_tipo", "") if inst_result.data else ""

                        # S9-13: Canal Divulgação — persona Maria Geral, RAG global, 3 regras
                        if canal_tipo == "Divulgação":
                            agente_tipo = "maria_divulgacao"  # sinaliza para motor-agente usar RAG rede_cuca_global
                            unidade_cuca = None               # sem filtro de unidade

                        payload_edge = {
                            "telefone": phone,
                            "instancia_uazapi": instance_name,
                            "agente_tipo": agente_tipo,
                            "unidade_cuca": unidade_cuca,
                            "canal_tipo": canal_tipo,
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
                                
                                # S11-06: Transbordo Humano Inteligente
                                # Bug 4 corrigido: motor-agente emite [[HANDOVER]], alinhando a regex aqui
                                handover_from_ia = data.get("handover", False)
                                match_handover = re.search(
                                    r'\[\[HANDOVER\]\]|\[TRANSBORDO\]|\[HUMANO\]|\[TRANSBORDO_HUMANO\]',
                                    resposta_ia, re.IGNORECASE
                                )
                                if handover_from_ia or match_handover:
                                    if match_handover:
                                        resposta_ia = resposta_ia.replace(match_handover.group(0), '').strip()
                                    logger.info(f"Transbordo Humano ativado para o Lead {phone}!")
                                    if not resposta_ia:
                                        resposta_ia = "Certo, estou te transferindo para um atendente humano. Aguarde um momento por favor!"
                                        
                                    try:
                                        # 1. Mapear Agente -> Módulo
                                        modulo_alvo = "geral"
                                        # Bug 4 extra: agente_tipo real usa 'julia' (não julia_geral/julia_unidade)
                                        if agente_tipo in ["julia", "julia_geral", "julia_unidade"]:
                                            modulo_alvo = "empregabilidade"
                                        elif agente_tipo in ["sofia", "ouvidoria"]:
                                            modulo_alvo = "ouvidoria"
                                        elif agente_tipo in ["ana", "acesso"]:
                                            modulo_alvo = "acesso"
                                            
                                        # 2. Buscar contato na tabela correta: transbordo_humano
                                        # Bug 3 corrigido: era human_handover_contacts
                                        # Primeiro tenta específico da unidade
                                        handover_res = (
                                            supabase.table("transbordo_humano")
                                            .select("*")
                                            .eq("modulo", modulo_alvo)
                                            .eq("unidade_cuca", unidade_cuca)
                                            .eq("ativo", True)
                                            .execute()
                                        ) if unidade_cuca else None
                                        contato_handover = None
                                        
                                        if handover_res and handover_res.data:
                                            contato_handover = handover_res.data[0]
                                        else:
                                            # Fallback global (sem unidade específica)
                                            fallback_res = (
                                                supabase.table("transbordo_humano")
                                                .select("*")
                                                .eq("modulo", modulo_alvo)
                                                .is_("unidade_cuca", "null")
                                                .eq("ativo", True)
                                                .execute()
                                            )
                                            if fallback_res.data:
                                                contato_handover = fallback_res.data[0]
                                                
                                        if contato_handover:
                                            # Bug 3 corrigido: colunas reais são 'telefone' e 'responsavel'
                                            tel_destino = contato_handover["telefone"]
                                            setor_resp = contato_handover.get("responsavel") or "Atendimento"
                                            
                                            lead_nome = push_name or "Cidadão"
                                            msg_handover = (
                                                f"🚨 *ATENÇÃO: NOVO TRANSBORDO HUMANIZADO*\n\n"
                                                f"👤 *Lead:* {lead_nome}\n"
                                                f"📱 *Telefone:* {phone}\n"
                                                f"🏢 *Módulo/Setor:* {modulo_alvo.capitalize()} / {setor_resp}\n\n"
                                                f"💬 *Última mensagem:*\n\"{text_content}\"\n\n"
                                                f"🔗 Iniciar chat: https://wa.me/{phone}"
                                            )
                                            
                                            UAZAPI_URL = os.getenv("UAZAPI_BASE_URL", "https://uazapi.com.br")
                                            async with httpx.AsyncClient() as hc:
                                                await hc.post(
                                                    f"{UAZAPI_URL}/message/sendText/{instance_name}",
                                                    headers={"apikey": inst_token, "Content-Type": "application/json"},
                                                    json={
                                                        "number": tel_destino,
                                                        "textMessage": {"text": msg_handover}
                                                    }
                                                )
                                            logger.info(f"Transbordo disparado para {tel_destino} ({setor_resp})")
                                        else:
                                            logger.warning(f"Nenhum contato de transbordo encontrado para módulo='{modulo_alvo}' unidade='{unidade_cuca}'")
                                    except Exception as eh:
                                        logger.error(f"Erro ao processar transbordo: {eh}")
                                
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
                    logger.error("Timeout aguardando processamento da IA (motor-agente demorou mais de 45s).")
                except Exception as e:
                    logger.error(f"Erro crítico no fluxo com motor-agente: {str(e)}")
            

    except Exception as e:
        logger.error(f"Erro no processamento em background: {str(e)}")

@app.get("/")
async def root():
    return {"status": "ok", "service": "worker-cuca"}

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

@app.post("/process-cv-espontaneo")
async def process_cv_espontaneo_endpoint(request: Request, background_tasks: BackgroundTasks):
    """S16-01: OCR de currículo de candidatura espontânea (sem vaga). Atualiza talent_bank.skills_jsonb."""
    try:
        payload = await request.json()
        nome = payload.get("nome", "")
        telefone = payload.get("telefone", "")
        cv_url = payload.get("cv_url")

        if not cv_url or not telefone:
            return Response(status_code=400, content="Faltando cv_url ou telefone")

        from cv_processor import process_cv_espontaneo
        background_tasks.add_task(process_cv_espontaneo, nome, telefone, cv_url)

        return {"status": "processing_started"}
    except Exception as e:
        logger.error(f"Erro ao startar OCR espontâneo: {str(e)}")
        return Response(status_code=500, content=str(e))


@app.post("/buscar-vagas")
async def buscar_vagas_endpoint(request: Request):
    """S18-02: Busca vagas abertas em todas as CUCAs para o motor-agente."""
    try:
        payload = await request.json()
        busca = payload.get("busca", "")

        from supabase import create_client
        import os
        sb = create_client(os.getenv("SUPABASE_URL"), os.getenv("SUPABASE_SERVICE_KEY"))

        result = sb.rpc("buscar_vagas_multi_cuca", {"p_busca": busca}).execute()
        vagas = result.data or []

        return {"vagas": vagas, "total": len(vagas)}
    except Exception as e:
        logger.error(f"Erro ao buscar vagas: {str(e)}")
        return Response(status_code=500, content=str(e))


@app.post("/analyse-sentiment")
async def analyse_sentiment_endpoint(request: Request):
    """S13-11: Rota para o portal disparar a análise de sentimento via Sofia (LLM)."""
    try:
        payload = await request.json()
        registro_id = payload.get("registro_id")
        texto = payload.get("texto")
        
        if not registro_id or not texto:
            return Response(status_code=400, content="Faltando registro_id ou texto")

        from sentiment_processor import analyse_manifestation_sentiment
        # Aqui fazemos await pois o usuário quer o feedback imediato no portal
        result = await analyse_manifestation_sentiment(registro_id, texto)
        
        return result
    except Exception as e:
        logger.error(f"Erro ao processar sentimento: {str(e)}")
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
