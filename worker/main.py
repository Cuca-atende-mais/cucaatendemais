import os
import hmac
import hashlib
import json
import logging
import asyncio
import time
from collections import defaultdict
from fastapi import FastAPI, Request, Response, BackgroundTasks, HTTPException
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from supabase import create_client, Client
from talent_bank_matcher import triar_banco_talentos
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

# ─── Ambiente ─────────────────────────────────────────────────────────────────
_IS_DEV = os.getenv("ENVIRONMENT", "production") == "development"

# ─── CORS: Apenas origens conhecidas ─────────────────────────────────────────
# Localhost removido em produção — presente apenas em modo development.
_CORS_ORIGINS = [
    "https://cucaatendemais.com.br",
    "https://www.cucaatendemais.com.br",
    "https://portal.cuca.ce.gov.br",
    "https://cuca-portal.vercel.app",
]
if _IS_DEV:
    _CORS_ORIGINS += ["http://localhost:3000", "http://localhost:3001"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
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


async def ocr_pending_loop():
    """Loop que verifica candidaturas com CV mas sem análise e dispara OCR automaticamente."""
    from cv_processor import process_cv_ocr
    logger.info("[ocr-loop] Loop de OCR pendente iniciado.")
    while True:
        try:
            res = supabase.table("candidaturas").select(
                "id, vaga_id, arquivo_cv_url, matching_justificativa, cargo_escolhido"
            ).not_.is_("arquivo_cv_url", "null").is_("matching_score", "null").is_("dados_ocr_json", "null").not_.is_("vaga_id", "null").limit(5).execute()
            pendentes = res.data or []
            for p in pendentes:
                # Pular candidaturas que já tiveram erro de OCR (evitar loop infinito)
                just = p.get("matching_justificativa") or ""
                if just.startswith("Erro OCR:"):
                    continue
                if p.get("arquivo_cv_url") and p.get("vaga_id"):
                    logger.info(f"[ocr-loop] Disparando OCR para candidatura {p['id']}")
                    # SQS-49: passa cargo_escolhido para análise contextualizada em selecao_evento
                    await process_cv_ocr(p["id"], p["arquivo_cv_url"], p["vaga_id"],
                                         cargo_escolhido=p.get("cargo_escolhido") or "")
        except Exception as e:
            logger.error(f"[ocr-loop] Erro: {e}")
        await asyncio.sleep(60)

@app.on_event("startup")
async def startup_event():
    from campanhas_engine import campanhas_loop
    from empregabilidade_engine import empregabilidade_notify_loop
    import asyncio
    logger.info("Agendando motor de Campanhas...")
    asyncio.create_task(campanhas_loop())
    logger.info("Agendando loop de notificação de vagas (Empregabilidade)...")
    asyncio.create_task(empregabilidade_notify_loop())
    logger.info("Agendando loop de OCR pendente...")
    asyncio.create_task(ocr_pending_loop())

# ─── Exception Handlers Globais ──────────────────────────────────────────────
# Garante que TODOS os erros retornem CORS headers (sem isso, exceções não tratadas
# passam pelo ServerErrorMiddleware ANTES do CORSMiddleware, sem headers)
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"[500] Exceção não tratada em {request.method} {request.url.path}: {type(exc).__name__}: {exc}")
    # SEC-12: stack trace exposto apenas em desenvolvimento — nunca em produção
    content: dict = {"error": "Erro interno do servidor"}
    if _IS_DEV:
        content["detail"] = str(exc)
    return JSONResponse(status_code=500, content=content)

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.detail},
    )

from meta_adapter_inbound import validar_hmac_meta, processar_webhook_meta

_META_APP_SECRET = os.getenv("META_APP_SECRET", "")
_META_VERIFY_TOKEN = os.getenv("META_VERIFY_TOKEN", "")


async def salvar_manifestacao_ouvidoria(conversa_id: str, lead_id: str, unidade_cuca: str | None, phone: str):
    """Extrai e salva manifestação da Ouvidoria quando Sofia confirma protocolo.
    ATENÇÃO: função interna — NÃO exposta como rota HTTP. Chamada apenas via asyncio.create_task."""
    try:
        from openai import AsyncOpenAI
        openai_client = AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))

        # Buscar histórico de mensagens da conversa
        msgs_res = (
            supabase.table("mensagens")
            .select("remetente, conteudo")
            .eq("conversa_id", conversa_id)
            .order("created_at")
            .execute()
        )
        historico = msgs_res.data or []

        # Montar texto do histórico
        hist_txt = "\n".join(
            f"{'Usuário' if m['remetente'] == 'lead' else 'Sofia'}: {m['conteudo']}"
            for m in historico
        )

        prompt_extracao = """Analise essa conversa de ouvidoria e extraia a manifestação mais recente que foi registrada (quando Sofia disse "protocolo seguro" ou "registrada em nossa Ouvidoria").

Retorne um JSON com:
- "tipo": "sugestao" ou "critica"
- "texto_manifestacao": o texto completo da manifestação do usuário (a mensagem de crítica/sugestão em si)
- "nome_solicitante": nome informado pelo usuário (null se não informou ou se for crítica anônima)
- "unidade_cuca": unidade CUCA mencionada (null se não informada). Normalize para formato: "CUCA Barra", "CUCA Jangurussu", "CUCA Mondubim", "CUCA Pici", "CUCA José Walter" ou null
- "anonimo": true se for crítica anônima, false caso contrário

Retorne APENAS o JSON, sem markdown."""

        response = await openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": prompt_extracao},
                {"role": "user", "content": hist_txt}
            ],
            response_format={"type": "json_object"},
            temperature=0.0
        )

        result = json.loads(response.choices[0].message.content)
        tipo = result.get("tipo")
        texto = result.get("texto_manifestacao")

        if not tipo or not texto:
            logger.warning(f"[Ouvidoria] Extração incompleta: {result}")
            return

        # Gerar número de protocolo
        ultimo_res = (
            supabase.table("ouvidoria_registros")
            .select("protocolo")
            .ilike("protocolo", "OUV-%")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        ultimo_num = 0
        if ultimo_res.data:
            try:
                ultimo_num = int(ultimo_res.data[0]["protocolo"].split("-")[1])
            except Exception:
                pass
        novo_protocolo = f"OUV-{str(ultimo_num + 1).zfill(3)}"

        unidade_final = result.get("unidade_cuca") or unidade_cuca

        supabase.table("ouvidoria_registros").insert({
            "tipo": tipo,
            "texto_manifestacao": texto,
            "nome_solicitante": result.get("nome_solicitante"),
            "telefone_solicitante": phone,
            "lead_id": lead_id,
            "unidade_cuca": unidade_final,
            "anonimo": result.get("anonimo", False),
            "protocolo": novo_protocolo,
        }).execute()

        logger.info(f"[Ouvidoria] Manifestação salva: {novo_protocolo} | tipo={tipo} | unidade={unidade_final}")

    except Exception as e:
        logger.error(f"[Ouvidoria] Erro ao salvar manifestação: {e}", exc_info=True)


@app.get("/")
async def root():
    """Health check raiz — substitui a rota que estava incorretamente ligada a salvar_manifestacao_ouvidoria."""
    return {"status": "ok", "service": "worker-cuca"}

@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "worker-cuca"}

@app.post("/send-message/{token}")
async def send_manual_message(token: str, request: Request):
    """S-WM-02: Envio manual de mensagem via Portal → Worker → Meta Cloud API."""
    if token != os.getenv("WEBHOOK_INTERNAL_TOKEN"):
        return Response(status_code=403, content="Token inválido")

    try:
        payload = await request.json()
    except Exception:
        return Response(status_code=400, content="Body inválido")

    # Rejeitar contrato antigo {phone, message} (AC #13)
    if "phone" in payload or "message" in payload:
        return Response(status_code=400, content="Contrato obsoleto: usar {number, text, instance}")

    number = payload.get("number")
    text = payload.get("text")
    template_name = payload.get("template_name")
    template_components = payload.get("components", [])
    # instance ignorado — canal roteado por conversa_id
    if not number or (not text and not template_name):
        return Response(status_code=422, content="Campos obrigatórios: number + (text ou template_name)")

    try:
        from meta_adapter_outbound import _meta_enviar
        from meta_adapter_inbound import _get_supabase

        conversa_id_payload = payload.get("conversa_id")

        if conversa_id_payload:
            # Routing por canal_ativo da conversa (AC 12-13 S-WM-03)
            sb = _get_supabase()
            conv = sb.table("conversas").select("canal_ativo, origem_id").eq(
                "id", conversa_id_payload
            ).maybe_single().execute()
            if not conv.data:
                return Response(status_code=404, content="Conversa não encontrada")
            canal_ativo = conv.data.get("canal_ativo", "uazapi")
            origem_id = conv.data.get("origem_id", "")
            if canal_ativo == "meta":
                meta_token = os.getenv("META_SYSTEM_USER_TOKEN", "")
                if template_name:
                    from campanhas_engine import _enviar_template_meta  # noqa: PLC0415
                    ok, _wamid = await _enviar_template_meta(
                        origem_id, number, meta_token, template_name, template_components
                    )
                    if ok:
                        logger.info(f"[send-manual] Template {template_name!r} enviado via Meta para {number}")
                        return {"status": "sent"}
                    return Response(status_code=502, content="Falha no envio de template Meta")
                else:
                    ok = await _meta_enviar(origem_id, number, text, meta_token)
                    if ok:
                        logger.info(f"[send-manual] Mensagem enviada via Meta (canal_ativo=meta) para {number}")
                        return {"status": "sent"}
                    return Response(status_code=502, content="Falha no envio Meta")
            elif canal_ativo == "uazapi":
                return Response(
                    status_code=501,
                    content="Canal legado não suportado neste endpoint",
                )
            else:
                return Response(status_code=400, content=f"Canal desconhecido: {canal_ativo}")
        else:
            # Fallback legado (AC 14): sem conversa_id — usa meta_phone_numbers (Empregabilidade)
            from empregabilidade_engine import _get_meta_phone  # noqa: PLC0415
            phone_number_id, meta_token = _get_meta_phone("Empregabilidade")
            ok = await _meta_enviar(phone_number_id, number, text, meta_token)
            if ok:
                logger.info(f"[send-manual] Mensagem enviada para {number} via Meta (fallback legado)")
                return {"status": "sent"}
            return Response(status_code=502, content="Falha no envio Meta")
    except Exception as e:
        logger.error(f"[send-manual] Erro: {e}", exc_info=True)
        return Response(status_code=500, content=str(e))

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

@app.post("/process-cv-text")
async def process_cv_text_endpoint(request: Request, background_tasks: BackgroundTasks):
    """Analisa currículo a partir de texto estruturado (sem arquivo PDF). Usado para currículos criados via formulário."""
    try:
        payload = await request.json()
        candidatura_id = payload.get("candidatura_id")
        cv_text = payload.get("cv_text")
        vaga_id = payload.get("vaga_id")

        if not candidatura_id or not cv_text or not vaga_id:
            return Response(status_code=400, content="Faltando parâmetros obrigatórios")

        from cv_processor import process_cv_from_text
        background_tasks.add_task(process_cv_from_text, candidatura_id, cv_text, vaga_id)

        return {"status": "processing_started"}
    except Exception as e:
        logger.error(f"[process-cv-text] Erro: {str(e)}")
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


@app.post("/academia-enem/process")
async def academia_enem_process_endpoint(request: Request, background_tasks: BackgroundTasks):
    """S-AE-04: acionado pelo webhook AuctaFlux (portal) a cada inbound de lead. Roda o engine
    próprio da Academia Enem (independente do motor uazapi). Fire-and-forget: responde já e
    processa em background para não atrasar o webhook que chamou.

    Autenticação M2M: exige header `x-internal-token` == WEBHOOK_INTERNAL_TOKEN (mesmo segredo
    interno usado para a edge function). Como o endpoint dispara envio de WhatsApp, falha fechada:
    se o token não estiver configurado no worker, rejeita (não roda sem proteção)."""
    expected = os.getenv("WEBHOOK_INTERNAL_TOKEN")
    if not expected:
        logger.error("[academia-enem/process] WEBHOOK_INTERNAL_TOKEN não configurada no worker — rejeitando.")
        return Response(status_code=503, content="internal token not configured")
    if request.headers.get("x-internal-token") != expected:
        logger.warning("[academia-enem/process] token interno inválido — requisição rejeitada (401).")
        return Response(status_code=401, content="unauthorized")
    try:
        payload = await request.json()
        ae_conversa_id = payload.get("ae_conversa_id")
        if not ae_conversa_id:
            return Response(status_code=400, content="Faltando ae_conversa_id")

        from academia_enem_engine import processar_mensagem_academia_enem
        background_tasks.add_task(processar_mensagem_academia_enem, ae_conversa_id)
        return {"status": "processing_started"}
    except Exception as e:
        logger.error(f"[academia-enem/process] Erro: {str(e)}")
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

@app.post("/extract-categories")
async def extract_categories_endpoint(request: Request, background_tasks: BackgroundTasks):
    """S19-02: Normaliza as atividades importadas para a taxonomia pai/filho via LLM."""
    try:
        payload = await request.json()
        campanha_id = payload.get("campanha_id")
        
        if not campanha_id:
            return Response(status_code=400, content="Faltando parâmetro campanha_id")

        from category_extractor import process_categories_for_campanha
        background_tasks.add_task(process_categories_for_campanha, campanha_id)
        
        return {"status": "processing_started"}
    except Exception as e:
        logger.error(f"Erro ao disparar extração de categorias: {str(e)}")
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

@app.post("/triar-banco-talentos")
async def triar_banco_talentos_endpoint(request: Request):
    """Triagem de candidatos do banco de talentos contra uma vaga usando GPT-4o."""
    try:
        payload = await request.json()
        vaga_id = payload.get("vaga_id")

        if not vaga_id:
            return Response(status_code=400, content="Faltando parâmetro vaga_id")

        setor_vaga = payload.get("setor_vaga") or []
        quantidade = max(1, min(int(payload.get("quantidade", 5)), 50))
        excluir_ids = payload.get("excluir_ids") or []
        telefones_inscritos = payload.get("telefones_inscritos") or []
        filtros = payload.get("filtros") or {}
        candidatos = await triar_banco_talentos(vaga_id, quantidade=quantidade, setor_vaga=setor_vaga, excluir_ids=excluir_ids, telefones_inscritos=telefones_inscritos, filtros=filtros)

        return {"candidatos": candidatos}
    except Exception as e:
        import traceback
        logger.error(f"[triar_banco_talentos] Erro: {str(e)}\n{traceback.format_exc()}")
        return Response(status_code=500, content=str(e))


# ─── Meta Cloud API Webhook (S-WM-01) ────────────────────────────────────────

@app.get("/webhook/meta")
async def meta_webhook_verify(request: Request):
    """Verificação de webhook Meta (hub challenge)."""
    params = request.query_params
    mode = params.get("hub.mode")
    token = params.get("hub.verify_token")
    challenge = params.get("hub.challenge", "")

    if mode == "subscribe" and token == _META_VERIFY_TOKEN:
        logger.info("[meta-inbound] Webhook Meta verificado com sucesso")
        return Response(content=challenge, media_type="text/plain")

    logger.warning(f"[meta-inbound] Verificação falhou: mode={mode} token_match={token == _META_VERIFY_TOKEN}")
    return Response(status_code=403, content="Forbidden")


@app.post("/webhook/meta")
async def meta_webhook(request: Request, background_tasks: BackgroundTasks):
    """Recepção de webhook Meta com validação HMAC-SHA256."""
    raw_body = await request.body()
    sig = request.headers.get("X-Hub-Signature-256")

    if not validar_hmac_meta(raw_body, sig, _META_APP_SECRET):
        logger.warning("[meta-inbound] HMAC inválido — requisição rejeitada")
        return Response(status_code=403, content="Forbidden")

    background_tasks.add_task(processar_webhook_meta, raw_body)
    return Response(status_code=200, content=json.dumps({"status": "received"}))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
