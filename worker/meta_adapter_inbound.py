"""
Adapter Inbound — Meta Cloud API → Contrato v2
S-WM-01: recepção de webhook, validação HMAC-SHA256, normalização para Contrato v2.
"""
import asyncio
import io
import hmac
import hashlib
import json
import logging
import os
import re
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone, timedelta

from meta_adapter_outbound import _normalizar_telefone_br

logger = logging.getLogger("worker-cuca")


def _render_template(corpo_texto: str, variaveis: dict[int, str]) -> str:
    """Substitui {{N}} pelo valor correspondente — usado para log/preview."""
    resultado = corpo_texto
    for pos, valor in variaveis.items():
        resultado = resultado.replace(f"{{{{{pos}}}}}", valor)
    return resultado


def _get_instancia_by_phone_number_id(phone_number_id: str) -> dict | None:
    """Busca dados do canal em meta_phone_numbers por phone_number_id (S-WM-03)."""
    try:
        res = _get_supabase().table("meta_phone_numbers").select(
            "phone_number_id, agente_tipo, canal_tipo, unidade_cuca"
        ).eq("phone_number_id", phone_number_id).eq("ativo", True).maybe_single().execute()
        if not res.data:
            return None
        d = res.data
        return {
            "canal_origem": d["phone_number_id"],
            "agente_tipo":  d["agente_tipo"],
            "canal_tipo":   d["canal_tipo"],
            "unidade_cuca": d.get("unidade_cuca"),
        }
    except Exception as exc:
        logger.error("[meta-inbound] Erro ao buscar meta_phone_numbers para %s: %s", phone_number_id, exc)
        return None


# ─── Validação HMAC-SHA256 ─────────────────────────────────────────────────────
def validar_hmac_meta(raw_body: bytes, signature_header: str | None, app_secret: str) -> bool:
    """Valida X-Hub-Signature-256 do webhook Meta (formato: sha256=<hex>)."""
    if not signature_header:
        return False
    expected = hmac.new(app_secret.encode(), raw_body, hashlib.sha256).hexdigest()
    received = signature_header.removeprefix("sha256=")
    return hmac.compare_digest(expected, received)


# ─── Download de Mídia Meta (Bearer, sem MediaKey/HKDF) ───────────────────────
async def _baixar_midia_meta(media_id: str, token: str) -> bytes | None:
    """Baixa bytes de mídia: media_id → GET Bearer → URL temp → GET Bearer → bytes."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            r = await client.get(
                f"https://graph.facebook.com/v19.0/{media_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
            r.raise_for_status()
            url_temp = r.json().get("url")
            if not url_temp:
                logger.error(f"[meta-inbound] media_id={media_id}: Graph sem 'url' na resposta")
                return None
            r2 = await client.get(url_temp, headers={"Authorization": f"Bearer {token}"})
            r2.raise_for_status()
            return r2.content
    except Exception as exc:
        logger.error(f"[meta-inbound] Erro download media_id={media_id}: {exc}")
        return None


async def _obter_url_midia_meta(media_id: str, token: str) -> str | None:
    """Obtém URL pública temporária de mídia Meta (sem baixar o conteúdo)."""
    import httpx
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            r = await client.get(
                f"https://graph.facebook.com/v19.0/{media_id}",
                headers={"Authorization": f"Bearer {token}"},
            )
            r.raise_for_status()
            return r.json().get("url")
    except Exception as exc:
        logger.error(f"[meta-inbound] Erro ao obter URL media_id={media_id}: {exc}")
        return None


# ─── Transcrição Whisper ────────────────────────────────────────────────────────
async def _transcrever_audio_meta(audio_bytes: bytes, mimetype: str) -> str | None:
    """Transcreve áudio via Whisper (mesmo padrão de main.py:492-497)."""
    import openai as _openai
    ext = "ogg"
    if "mp4" in mimetype or "mpeg" in mimetype:
        ext = "mp4"
    elif "webm" in mimetype:
        ext = "webm"
    try:
        oa = _openai.AsyncOpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        buf = io.BytesIO(audio_bytes)
        buf.name = f"audio.{ext}"
        tr = await oa.audio.transcriptions.create(model="whisper-1", file=buf, language="pt")
        return tr.text
    except Exception as exc:
        logger.error(f"[meta-inbound] Whisper erro: {exc}")
        return None


# AUD-14: texto descritivo mínimo pro histórico quando não há mensagem de texto (mídia sem
# legenda, ou áudio cuja transcrição falhou/veio vazia). Só usado no registro em `mensagens`
# (rastreabilidade no painel) — nunca no que é enviado ao motor-agente.
def _texto_historico_para_midia_vazia(midia_tipo: str) -> str:
    if midia_tipo == "image":
        return "[Imagem enviada sem legenda]"
    if midia_tipo in ("voz", "audio", "ptt"):
        return "[Áudio enviado]"
    return "[Mídia enviada]"


# AUD-12 (LGPD, S-WM-23): padrões de opt-out deliberadamente ESPECÍFICOS, não uma palavra solta
# (ex.: \bsair\b bateria em "vou sair de férias" ou "quero sair pra jantar" — falso positivo que
# registraria opt_in=false por engano). Cada padrão exige a mensagem inteira ser só a
# palavra-chave, ou uma frase explícita o suficiente de parar/cancelar/não querer mais receber.
# Detecção determinística (não LLM) de propósito — confiabilidade importa mais que sofisticação
# aqui, é registro real de opt_in, não só tom de resposta.
_PADROES_OPT_OUT = [
    re.compile(r"^\s*(sair|parar|cancelar)\s*[.!]?\s*$", re.IGNORECASE),
    re.compile(r"\bcancelar\s+(a\s+)?inscri[cç][aã]o\b", re.IGNORECASE),
    re.compile(r"\bparar\s+de\s+(mandar|enviar|receber)\b", re.IGNORECASE),
    re.compile(r"\bn[aã]o\s+quero\s+mais\s+receber\b", re.IGNORECASE),
    re.compile(r"\bquero\s+cancelar\b", re.IGNORECASE),
    # "quero sair" sozinho é frágil demais ("quero sair pra jantar" bateria) — só conta quando
    # vem com contexto explícito de sair de uma lista/receber mensagens/o número.
    re.compile(r"\bquero\s+sair\s+(da\s+lista|das\s+mensagens|de\s+receber|do\s+whatsapp|desse\s+n[uú]mero)\b", re.IGNORECASE),
    re.compile(r"\bremover\s+(meu\s+)?(numero|n[uú]mero|contato)\b", re.IGNORECASE),
]


def _eh_pedido_opt_out(texto: str) -> bool:
    """AUD-12: true se a mensagem do lead é um pedido claro de opt-out (SAIR/PARAR/CANCELAR e
    variações razoáveis) — ver _PADROES_OPT_OUT acima para os critérios exatos e o porquê de
    serem específicos em vez de uma palavra solta."""
    if not texto:
        return False
    t = texto.strip()
    return any(padrao.search(t) for padrao in _PADROES_OPT_OUT)


# ─── Parser de Mensagem Meta ───────────────────────────────────────────────────
async def _parse_mensagem_meta(msg: dict) -> tuple[str, str | None, str]:
    """
    Parseia uma mensagem Meta e retorna (texto, midia_url, midia_tipo).

    text  → (body, None, "text")
    audio → (transcrição_ou_vazio, None, "voz")   [mock se sem token]
    image → ("", url_ou_none, "image")
    """
    msg_type = msg.get("type", "")
    token = os.getenv("META_SYSTEM_USER_TOKEN", "")

    if msg_type == "text":
        body = msg.get("text", {}).get("body", "")
        return body, None, "text"

    elif msg_type == "audio":
        audio = msg.get("audio", {})
        media_id = audio.get("id", "")
        mimetype = audio.get("mime_type", "audio/ogg")
        audio_bytes: bytes | None = None

        if token and media_id:
            audio_bytes = await _baixar_midia_meta(media_id, token)

        if audio_bytes is None:
            # Fixture local de teste (mock-first: META_SYSTEM_USER_TOKEN ausente)
            fixture = os.path.join(os.path.dirname(__file__), "tests", "fixtures", "audio_teste.ogg")
            if os.path.exists(fixture):
                with open(fixture, "rb") as f:
                    audio_bytes = f.read()
                logger.info("[meta-inbound] Usando fixture local de áudio (mock)")
            else:
                logger.warning(f"[meta-inbound] Áudio ignorado: sem token e sem fixture (media_id={media_id})")
                return "", None, "voz"

        texto = await _transcrever_audio_meta(audio_bytes, mimetype) or ""
        return texto, None, "voz"

    elif msg_type == "image":
        image = msg.get("image", {})
        media_id = image.get("id", "")
        midia_url: str | None = None
        if token and media_id:
            midia_url = await _obter_url_midia_meta(media_id, token)
        return "", midia_url, "image"

    else:
        logger.info(f"[meta-inbound] Tipo '{msg_type}' não suportado — ignorado")
        return "", None, msg_type


# ─── Construção do Contrato v2 ─────────────────────────────────────────────────
async def build_contrato_v2(meta_payload: dict, instancia_data: dict) -> dict:
    """
    Constrói o Contrato v2 a partir do payload Meta e dados da instância.

    Campos: canal_origem, telefone, agente_tipo, unidade_cuca, canal_tipo,
            mensagem, midia_url, midia_tipo, data_atual.
    """
    entry = meta_payload.get("entry", [{}])[0]
    changes = entry.get("changes", [{}])[0]
    value = changes.get("value", {})
    messages = value.get("messages", [])

    if not messages:
        raise ValueError("Payload Meta sem messages[]")

    msg = messages[0]
    telefone: str = _normalizar_telefone_br(msg.get("from", ""))
    wamid: str = msg.get("id", "")

    mensagem, midia_url, midia_tipo = await _parse_mensagem_meta(msg)

    _tz = timezone(timedelta(hours=-3))
    data_atual = datetime.now(_tz).strftime("%A, %d de %B de %Y, %H:%M")

    return {
        "canal_origem": instancia_data["canal_origem"],
        "telefone":     telefone,
        "agente_tipo":  instancia_data["agente_tipo"],
        "unidade_cuca": instancia_data.get("unidade_cuca"),
        "canal_tipo":   instancia_data["canal_tipo"],
        "mensagem":     mensagem,
        "midia_url":    midia_url,
        "midia_tipo":   midia_tipo,
        "data_atual":   data_atual,
        "wamid":        wamid,
    }


# ─── Supabase (lazy singleton — evita colisão com pasta supabase/ do projeto) ──
_supabase_client = None


def _get_supabase():
    global _supabase_client
    if _supabase_client is None:
        from supabase import create_client  # noqa: PLC0415
        _supabase_client = create_client(
            os.getenv("SUPABASE_URL"),
            os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY"),
        )
    return _supabase_client


# S-WM-24 Task 2 (AUD-08, escopo ampliado a pedido do Junior em 2026-08-07): tipos de
# mensagem que o motor-agente estruturalmente não consegue interpretar hoje — não é
# falha técnica, é conteúdo pro qual não existe extração de texto nenhuma (diferente de
# "image", que ao menos resolve midia_url, e de "voz"/audio, que já passa por
# transcrição Whisper). midia_tipo aqui é o `type` cru do webhook Meta (sticker, video,
# document, location, contacts, reaction, button, interactive, order, system...) —
# lista aberta de propósito: qualquer tipo que caia no `else` de _parse_mensagem_meta
# (mensagem="") e não seja "text"/"voz"/"image" entra automaticamente aqui, sem
# precisar atualizar esta constante a cada tipo novo que a Meta manda.
_MIDIA_TIPOS_COM_INTERPRETACAO = frozenset({"text", "voz", "image"})

# Escopo do guard acima: só Institucional/maria (mesmo módulo, ver _AGENTE_MODULO_MAP).
# A story original (S-WM-24) marca "Qualquer mudança em Sofia, Ouvidoria, ..., Ana"
# como fora de escopo — esses canais ainda não migraram pra Meta, e a decisão de
# "ignorar em silêncio" não foi tomada pra eles. Se/quando migrarem, este guard não
# se aplica automaticamente — precisa de decisão própria.
_AGENTES_GUARD_MIDIA_SEM_INTERPRETACAO = frozenset({"Institucional", "maria"})

# ─── Agentes despachados via motor-agente Edge Function ────────────────────────
_AGENTES_MOTOR_AGENTE = frozenset({"Institucional", "maria", "sofia", "ana"})
_AGENTE_MODULO_MAP: dict[str, str] = {
    "sofia":         "Ouvidoria",
    "Institucional": "Institucional",
    "maria":         "Institucional",
    "ana":           "Acesso",
}

# S-WM-16 Task 2: normaliza modulo/agente_tipo (snake_case interno) para a tag de
# automação salva em meta_templates.automacoes (capitalizada, como aparece no Developer
# Console). Cobre tanto valores de agente_tipo quanto os já normalizados por
# _AGENTE_MODULO_MAP, já que _notificar_transbordo recebe modulo de origens diferentes
# (literal "empregabilidade" em empregabilidade_engine.py, ou _AGENTE_MODULO_MAP.get(...)
# em meta_adapter_inbound.py).
MODULO_AUTOMACAO_MAP: dict[str, str] = {
    "empregabilidade": "Empregabilidade",
    "julia":           "Empregabilidade",
    "sofia":           "Ouvidoria",
    "sofia_global":    "Ouvidoria",
    "sofia_unidade":   "Ouvidoria",
    "ana":             "Acesso CUCA",
    "Institucional":   "Institucional",
    "maria":           "Institucional",
    "programacao":     "Institucional",
    "ouvidoria":       "Ouvidoria",
    "acesso_cuca":     "Acesso CUCA",
    "Acesso":          "Acesso CUCA",
}


async def _chamar_motor_agente(
    contrato_v2: dict,
    conversa_id: str,
    supabase,
    phone_number_id_origem: str = "",
) -> list[str] | None:
    """
    Chama o motor-agente (Supabase Edge Function) e retorna a resposta como uma lista de
    1+ partes, já na ordem em que devem ser despachadas.

    S-WM-22 (TOM-03b): o motor-agente pode dividir uma resposta longa/listável em 2-3 partes,
    devolvidas no campo novo `mensagens` (lista) — campo aditivo, não substitui `resposta`
    (string, mantida por compat). Lê `mensagens` primeiro; se ausente/vazio/mal formado (ex.:
    early-returns do motor-agente que ainda só devolvem `resposta`, como o menu de unidades ou
    a pergunta de ambiguidade), cai pra `[resposta]` — o dispatch trata os dois casos com o
    MESMO caminho de código (lista de 1 elemento é indistinguível de "não dividiu").

    Atualiza conversas.status se handover ou encerrado (a motor-agente também
    faz isso internamente, mas o inbound atualiza o mesmo registro por origem_id).
    Retorna None em caso de falha HTTP, resposta sem texto ou erro do motor.
    Nunca propaga exceção — falhas são logadas e retornam None.
    """
    import httpx  # noqa: PLC0415

    supabase_url = os.getenv("SUPABASE_URL", "")
    service_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

    if not supabase_url or not service_key:
        logger.error("[meta-inbound] SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes — motor-agente abortado")
        return None

    body = {
        "mensagem":    contrato_v2["mensagem"],
        "midia_url":   contrato_v2.get("midia_url"),
        "midia_tipo":  contrato_v2.get("midia_tipo"),
        "telefone":    contrato_v2["telefone"],
        "canal_origem": contrato_v2["canal_origem"],
        "agente_tipo": contrato_v2["agente_tipo"],
        "unidade_cuca": contrato_v2.get("unidade_cuca"),
        "conversa_id": conversa_id,
    }

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                f"{supabase_url}/functions/v1/motor-agente",
                headers={
                    "Authorization": f"Bearer {service_key}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
    except Exception as exc:
        logger.error("[meta-inbound] Erro de rede ao chamar motor-agente: %s", type(exc).__name__)
        return None

    if not resp.is_success:
        logger.error(
            "[meta-inbound] motor-agente HTTP %s para agente=%s conversa_id=%s telefone=%r: %s",
            resp.status_code,
            contrato_v2.get("agente_tipo"),
            conversa_id,
            contrato_v2.get("telefone"),
            resp.text[:200],
        )
        return None

    try:
        data = resp.json()
    except Exception:
        logger.error("[meta-inbound] motor-agente retornou resposta não-JSON")
        return None

    if not data.get("success"):
        logger.error("[meta-inbound] motor-agente erro: %s", data.get("error", "desconhecido"))
        return None

    # Atualizar status da conversa local (motor-agente atualiza o próprio registro)
    if data.get("handover"):
        try:
            supabase.table("conversas").update(
                {"status": "awaiting_human", "updated_at": "now()"}
            ).eq("id", conversa_id).execute()
        except Exception as exc:
            logger.warning("[meta-inbound] Erro ao setar awaiting_human: %s", exc)
        agente_tipo_hdv = contrato_v2.get("agente_tipo", "")
        logger.info("[transbordo] motor-agente %s sinalizado", agente_tipo_hdv)
        await _notificar_transbordo(
            conversa_id=conversa_id,
            modulo=_AGENTE_MODULO_MAP.get(agente_tipo_hdv, agente_tipo_hdv.lower()),
            unidade_cuca=contrato_v2.get("unidade_cuca"),
            phone_number_id_origem=phone_number_id_origem,
            lead_identificacao=contrato_v2.get("telefone", ""),
        )

    elif data.get("encerrado"):
        try:
            supabase.table("conversas").update(
                {"status": "encerrada", "updated_at": "now()"}
            ).eq("id", conversa_id).execute()
        except Exception as exc:
            logger.warning("[meta-inbound] Erro ao setar encerrada: %s", exc)

    mensagens = data.get("mensagens")
    if isinstance(mensagens, list) and all(isinstance(m, str) and m for m in mensagens) and mensagens:
        return mensagens

    resposta = data.get("resposta")
    return [resposta] if resposta else None


async def _notificar_transbordo(
    conversa_id: str,
    modulo: str,
    unidade_cuca: str | None,
    phone_number_id_origem: str,
    lead_identificacao: str,
) -> bool:
    """Notifica colaboradores configurados sobre transbordo via template Meta."""
    try:
        sb = _get_supabase()
        contacts: list = []
        if unidade_cuca:
            res = sb.table("transbordo_humano").select("*") \
                .eq("modulo", modulo).eq("unidade_cuca", unidade_cuca).eq("ativo", True).execute()
            contacts = res.data or []
        if not contacts:
            res = sb.table("transbordo_humano").select("*") \
                .eq("modulo", modulo).is_("unidade_cuca", "null").eq("ativo", True).execute()
            contacts = res.data or []
        if not contacts:
            logger.warning(
                "[transbordo] Nenhum contato ativo para modulo=%s unidade=%s conversa=%s",
                modulo, unidade_cuca, conversa_id,
            )
            return False
        automacao = MODULO_AUTOMACAO_MAP.get(modulo, modulo)
        # Lookup relacional (automação + número + tag "Transbordo" — zero nome hardcoded).
        # A 2ª tag "Transbordo" desambigua de outros templates que também usam o mesmo
        # canal/número (ex.: programação mensal, evento pontual), já que várias finalidades
        # podem compartilhar a mesma automação + phone_number_id.
        tpl_res = sb.table("meta_templates").select("nome, corpo_texto, variaveis") \
            .contains("automacoes", [automacao, "Transbordo"]) \
            .contains("phone_number_ids", [phone_number_id_origem]) \
            .eq("ativo", True).eq("status", "aprovado") \
            .limit(1).maybe_single().execute()
        if not tpl_res.data:
            logger.warning(
                "[transbordo] Nenhum template aprovado para automacao=%s phone_number_id=%s — notificação não enviada",
                automacao, phone_number_id_origem,
            )
            return False
        template_name = tpl_res.data["nome"]
        corpo_texto = tpl_res.data.get("corpo_texto") or ""
        variaveis_transbordo = tpl_res.data.get("variaveis")
        token = os.getenv("META_SYSTEM_USER_TOKEN", "")
        from campanhas_engine import _enviar_template_meta, _montar_parametros_named  # noqa: PLC0415
        algum_envio_ok = False
        for contato in contacts:
            nome = contato.get("responsavel") or "Equipe"
            telefone_destino = contato["telefone"]
            components = [{
                "type": "body",
                "parameters": _montar_parametros_named(variaveis_transbordo, [nome, lead_identificacao, modulo]),
            }]
            if corpo_texto:
                preview = _render_template(corpo_texto, {1: nome, 2: lead_identificacao, 3: modulo})
                logger.debug("[transbordo] preview: %s", preview[:120])
            ok, _wamid = await _enviar_template_meta(
                phone_number_id_origem, telefone_destino, token,
                template_name, components,
            )
            if ok:
                algum_envio_ok = True
                logger.info("[transbordo] Notificação enviada para %s (modulo=%s)", telefone_destino, modulo)
            else:
                logger.warning("[transbordo] Falha ao notificar %s (modulo=%s)", telefone_destino, modulo)
        return algum_envio_ok
    except Exception as exc:
        logger.error("[transbordo] Erro inesperado em _notificar_transbordo: %s", exc)
        return False


# ─── Debounce de dispatch (VAL-05) ─────────────────────────────────────────────
# docs/migracao-meta/VALIDACAO-producao-institucional.md: mensagens rápidas em sequência do
# mesmo lead ("entendi" / "beleza então" / "obrigado") disparavam um dispatch completo ao
# motor-agente (ou Empregabilidade) POR MENSAGEM — 3 chamadas de GPT e 3 respostas separadas
# e quase idênticas pro mesmo lead, sinal forte de "isso é automatizado". A persistência
# (Lead/Conversa/Mensagem) continua acontecendo por mensagem, imediatamente — só o DISPATCH
# (chamada ao motor-agente/Empregabilidade + envio da resposta) é adiado. Cada mensagem nova
# do mesmo lead cancela o dispatch pendente da anterior e reagenda — só a última mensagem da
# janela efetivamente dispara, mas o `historico` que o motor-agente lê já inclui todas as
# mensagens persistidas nesse meio-tempo (S-WM-17).
#
# Limitação conhecida, documentada e aceita (não bloqueadora agora): `_DEBOUNCE_TASKS` é um
# dict em memória do processo — só funciona corretamente com o worker rodando como processo
# único (`gunicorn -w 1`, configuração atual do Dockerfile). Se o worker escalar para múltiplas
# réplicas, cada réplica passa a ter seu próprio dict sem coordenação entre si, e o debounce
# deixa de funcionar de forma correta (mensagens do mesmo lead podem cair em réplicas
# diferentes) — precisaria migrar para um mecanismo compartilhado (Redis, ou uma tabela no
# Supabase) antes de escalar horizontalmente.
_DEBOUNCE_TASKS: dict[str, asyncio.Task] = {}


def _debounce_segundos() -> float:
    """Lido a cada chamada (não cacheado em import) para permitir override em teste via
    monkeypatch de variável de ambiente sem precisar recarregar o módulo."""
    return float(os.getenv("META_DEBOUNCE_SECONDS", "10"))


async def _dormir_debounce(segundos: float) -> None:
    """Isolado do `asyncio.sleep` direto só para ser interceptável em teste (cuidado 2 do
    pedido: tempo injetável, não esperar o real). Testes que não mexem nisso usam a suíte
    inteira com o debounce real de `_debounce_segundos()` — por isso `worker/tests/conftest.py`
    substitui esta função por um no-op autouse, para não deixar a suíte inteira lenta."""
    await asyncio.sleep(segundos)


async def _agendar_dispatch_debounced(chave: str, dispatch: Callable[[], Awaitable[None]]) -> None:
    """Cancela o dispatch pendente da mesma `chave` (se houver) e agenda `dispatch` para rodar
    depois de `_debounce_segundos()`. `chave` é o `conversa_id` — identidade exata da conversa,
    já garante unicidade por (lead, canal) sem precisar compor telefone+phone_number_id.

    Fica pendurado em `await` até o dispatch (cancelado ou não) resolver — isso é seguro porque
    quem chama esta função (`processar_webhook_meta`) já roda como BackgroundTask do FastAPI,
    ou seja, já está fora do ciclo de vida da requisição HTTP (a resposta 200 pro webhook da
    Meta já foi enviada antes do BackgroundTask começar a rodar); não há custo de latência
    percebido por ninguém além do próprio lead esperando a resposta, que é exatamente o
    trade-off aceito do debounce.
    """
    tarefa_anterior = _DEBOUNCE_TASKS.get(chave)
    if tarefa_anterior and not tarefa_anterior.done():
        tarefa_anterior.cancel()

    async def _aguardar_e_despachar() -> None:
        try:
            await _dormir_debounce(_debounce_segundos())
        except asyncio.CancelledError:
            logger.info("[debounce] dispatch da conversa %s cancelado — mensagem mais recente chegou", chave)
            raise
        await dispatch()

    tarefa = asyncio.create_task(_aguardar_e_despachar())
    _DEBOUNCE_TASKS[chave] = tarefa
    try:
        await tarefa
    except asyncio.CancelledError:
        pass
    finally:
        # Só remove do dict se ainda for ESTA tarefa — se uma mensagem mais nova já cancelou
        # e reagendou (sobrescrevendo a entrada), não pode apagar a referência da tarefa nova.
        if _DEBOUNCE_TASKS.get(chave) is tarefa:
            _DEBOUNCE_TASKS.pop(chave, None)


# ─── Background Task ───────────────────────────────────────────────────────────
async def processar_webhook_meta(raw_body: bytes) -> None:
    """
    Background task do webhook Meta.
    Persiste Lead, Conversa e Mensagem antes do dispatch (AC #5).
    Despacha para Empregabilidade se agente_tipo corresponder (AC #6).
    """
    try:
        payload = json.loads(raw_body)
    except json.JSONDecodeError as exc:
        logger.error(f"[meta-inbound] JSON inválido: {exc}")
        return

    try:
        value = payload["entry"][0]["changes"][0]["value"]
        phone_number_id: str = value["metadata"]["phone_number_id"]
        messages = value.get("messages", [])
        statuses = value.get("statuses", [])
    except (KeyError, IndexError):
        logger.warning("[meta-inbound] Estrutura entry/changes/value inesperada — descartado")
        return

    # S-WM-57: consome os eventos statuses[] (entregue/lido/falhou) que a Meta manda
    # depois de cada envio — antes descartados sem leitura junto com o early-return de
    # "sem messages[]" abaixo. Best-effort: nunca deixa uma falha de lookup/update
    # propagar da background task (o 200 pro webhook da Meta já foi respondido antes
    # deste ponto, ver main.py).
    if statuses:
        supabase_status = _get_supabase()
        _STATUS_MAP = {
            "sent": "enviado",
            "delivered": "entregue",
            "read": "lido",
            "failed": "falhou",
            "deleted": "apagada",
            "warning": "aviso",
        }
        for status_evt in statuses:
            wamid_status = status_evt.get("id")
            status_meta = status_evt.get("status")
            if not wamid_status or status_meta not in _STATUS_MAP:
                continue
            erro_codigo = None
            if status_meta in ("failed", "warning"):
                erros_lista = status_evt.get("errors") or []
                if erros_lista:
                    erro_codigo = str(erros_lista[0].get("code", ""))
            # S-WM-57 (emenda 2026-07-28): timestamp do evento reportado pela própria
            # Meta, usado logo abaixo pra proteção contra status fora de ordem.
            status_timestamp_meta = None
            timestamp_evt = status_evt.get("timestamp")
            if timestamp_evt is not None:
                try:
                    status_timestamp_meta = datetime.fromtimestamp(
                        int(timestamp_evt), tz=timezone.utc
                    ).isoformat()
                except (TypeError, ValueError):
                    status_timestamp_meta = None
            try:
                query = supabase_status.table("logs_disparo").update({
                    "status": _STATUS_MAP[status_meta],
                    "erro": erro_codigo,
                    "atualizado_em": datetime.now(timezone.utc).isoformat(),
                    "status_timestamp_meta": status_timestamp_meta,
                }).eq("wamid", wamid_status)
                # Proteção contra status fora de ordem (emenda 2026-07-28): só
                # sobrescreve se não houver timestamp salvo ainda, ou se o evento
                # novo for igual/mais recente que o já gravado. Checagem atômica na
                # própria query (.or_), não select-depois-compara — evita a corrida
                # entre 2 webhooks simultâneos pro mesmo wamid.
                if status_timestamp_meta:
                    query = query.or_(
                        f"status_timestamp_meta.is.null,status_timestamp_meta.lte.{status_timestamp_meta}"
                    )
                query.execute()
            except Exception as exc:
                logger.warning(f"[meta-inbound] Erro ao atualizar status de wamid={wamid_status!r}: {exc}")

    # Ignorar eventos de status (delivery, read) sem messages[]
    if not messages:
        logger.info("[meta-inbound] Evento sem messages[] (status update) — ignorado")
        return

    # Guard: phone_number_id desconhecido → discard silencioso (AC #5 segurança)
    instancia_data = _get_instancia_by_phone_number_id(phone_number_id)
    if instancia_data is None:
        logger.warning(f"[meta-inbound] phone_number_id desconhecido: {phone_number_id} — descartado")
        return

    supabase = _get_supabase()

    # Dedupe por wamid (S-WM-20): reentrega do webhook (retry da Meta) não deve
    # duplicar Lead/Conversa/Mensagem nem disparar dispatch/resposta 2x. Checagem
    # o mais cedo possível — antes até de build_contrato_v2, que pode transcrever
    # áudio via Whisper (custoso e desnecessário repetir numa reentrega).
    wamid: str = messages[0].get("id", "")
    if wamid:
        try:
            ja_processado = supabase.table("mensagens").select("id").eq("wamid", wamid).limit(1).execute()
            if ja_processado.data:
                logger.info(f"[meta-inbound] wamid={wamid!r} já processado — reentrega descartada")
                return
        except Exception as exc:
            logger.warning(f"[meta-inbound] Erro ao checar dedupe de wamid={wamid!r}: {exc}")

    contacts = value.get("contacts", [])
    push_name = (contacts[0].get("profile", {}).get("name") or "Cidadão") if contacts else "Cidadão"

    try:
        contrato_v2 = await build_contrato_v2(payload, instancia_data)
        logger.info(
            f"[meta-inbound] Contrato v2 construído: canal_origem={contrato_v2['canal_origem']} "
            f"tel={contrato_v2['telefone']} agente={contrato_v2['agente_tipo']} "
            f"midia_tipo={contrato_v2['midia_tipo']}"
        )
    except Exception as exc:
        logger.error(f"[meta-inbound] Erro ao processar Contrato v2: {exc}")
        return

    telefone: str = contrato_v2["telefone"]
    agente_tipo: str = contrato_v2["agente_tipo"]
    canal_tipo: str = contrato_v2["canal_tipo"]
    unidade_cuca = contrato_v2.get("unidade_cuca")
    mensagem: str = contrato_v2["mensagem"]
    midia_tipo: str = contrato_v2["midia_tipo"]

    # Guard: numero com bloqueio permanente (2026-08-01, caso WEBLOCACAO/MKL IT
    # SOLUTIONS) — tabela separada de `leads`, checada ANTES do upsert, porque
    # `leads.bloqueado` mora na propria linha e nao sobrevive a um DELETE dela.
    # Fail-open (loga e segue) em erro de leitura: um bug aqui nao pode travar
    # todo o processamento de mensagens.
    try:
        bloqueio_perm = supabase.table("numeros_bloqueados_permanente") \
            .select("telefone").eq("telefone", telefone).limit(1).execute()
        if bloqueio_perm.data:
            logger.info(f"[meta-inbound] Numero {telefone} com bloqueio permanente — descartado")
            return
    except Exception as exc:
        logger.warning(f"[meta-inbound] Erro ao checar bloqueio permanente de {telefone}: {exc}")

    # ── DB A: upsert Lead por telefone ────────────────────────────────────
    try:
        lead_result = supabase.table("leads").upsert(
            {"telefone": telefone, "nome": push_name, "updated_at": "now()"},
            on_conflict="telefone",
        ).execute()
        lead_id: str = lead_result.data[0]["id"]
        _fresh = supabase.table("leads").select("bloqueado").eq("id", lead_id).single().execute()
        bloqueado: bool = (_fresh.data or {}).get("bloqueado", False)
    except Exception as exc:
        logger.error(f"[meta-inbound] Erro ao gerenciar Lead: {exc}")
        return

    if bloqueado:
        logger.info(f"[meta-inbound] Lead {telefone} está bloqueado — mensagem ignorada")
        return

    # ── DB B: recuperar ou criar Conversa por (lead_id, origem_id) ──────
    # S-WM-31: upsert atômico via constraint UNIQUE(lead_id, origem_id) — elimina a corrida
    # select-então-insert (dois webhooks quase simultâneos do mesmo lead podiam cada um "não
    # achar" conversa existente e inserir a sua). "status" fica de fora do payload de propósito:
    # tem default 'ativa' no banco (usado só na criação) e é gerenciado depois pelo motor-agente
    # (encerrada/awaiting_human) — incluí-lo aqui sobrescreveria esse estado a cada mensagem.
    try:
        supabase.table("conversas").upsert(
            {
                "lead_id":    lead_id,
                "origem_id":  phone_number_id,
                "canal_ativo": "meta",
                "agente_tipo": agente_tipo,
                "updated_at": "now()",
            },
            on_conflict="lead_id,origem_id",
        ).execute()

        conv_fresh = supabase.table("conversas").select(
            "id, status, created_at, updated_at, primeira_interacao_lead_em"
        ).match(
            {"lead_id": lead_id, "origem_id": phone_number_id}
        ).execute()
        conversa_id: str = conv_fresh.data[0]["id"]
        conversa_status = conv_fresh.data[0].get("status")
    except Exception as exc:
        logger.error(f"[meta-inbound] Erro ao gerenciar Conversa: {exc}")
        return

    # S-WM-66: marca o momento da 1ª mensagem enviada PELO LEAD — nunca setado pelo
    # caminho de disparo/breadcrumb (campanhas_engine.py), só aqui, porque só aqui é
    # garantido que a mensagem que chegou é do lead, não um envio nosso. Base pra
    # fixar, no painel de Atendimento, toda conversa com interação real, sem
    # depender de awaiting_human (handover explícito, raro por decisão de produto —
    # a instrução de "fale com humano" é deliberadamente omitida do prompt).
    # Restrito a agente_tipo do motor-agente (Institucional/maria/sofia/ana) — decisão
    # do Junior de deixar Empregabilidade/Julia de fora por enquanto (ver
    # docs/stories/S-WM-66-Fila-Fixa-Leads-Engajados-Atendimento.md, Escopo OUT).
    # Guard "IS NULL" no UPDATE (não só na leitura acima) fecha a corrida entre 2
    # mensagens quase simultâneas do mesmo lead — mesmo se ambas lerem a coluna como
    # NULL, só a 1ª a chegar no banco de fato grava; a 2ª UPDATE não afeta linha
    # nenhuma (WHERE já não bate mais), sem sobrescrever com um timestamp mais tardio.
    if agente_tipo in _AGENTES_MOTOR_AGENTE and conv_fresh.data[0].get("primeira_interacao_lead_em") is None:
        try:
            supabase.table("conversas").update(
                {"primeira_interacao_lead_em": "now()"}
            ).eq("id", conversa_id).is_("primeira_interacao_lead_em", "null").execute()
        except Exception as exc:
            logger.warning(f"[meta-inbound] Erro ao gravar primeira_interacao_lead_em (conversa_id={conversa_id}): {exc}")

    # Achado 2026-07-25/26: 27 de 32 casos de HTTP 400 do motor-agente (telefone
    # vazio) aconteceram entre 11-12,5s da criação do lead — correlação forte com
    # "1ª mensagem de lead novo", mas não 100% determinística (alguns leads novos
    # não falharam). Log temporário pra fechar a causa exata na próxima ocorrência
    # real — remover quando o achado #1 (docs/qa/INVESTIGACAO-comportamento-
    # conversas-disparo-corrida-2026-07-25.md) estiver resolvido.
    try:
        lead_criado_agora = lead_result.data[0].get("created_at") == lead_result.data[0].get("updated_at")
        conversa_criada_agora = conv_fresh.data[0].get("created_at") == conv_fresh.data[0].get("updated_at")
        logger.info(
            "[meta-inbound][DIAG-achado1] conversa_id=%s lead_id=%s lead_novo=%s conversa_nova=%s",
            conversa_id, lead_id, lead_criado_agora, conversa_criada_agora,
        )
    except (IndexError, KeyError, AttributeError) as exc:
        logger.warning("[meta-inbound][DIAG-achado1] Erro ao calcular lead_novo/conversa_nova: %s", exc)

    # ── DB C: inserir Mensagem inbound e incrementar não lidas ──────────
    try:
        supabase.table("mensagens").insert({
            "conversa_id": conversa_id,
            "lead_id": lead_id,
            "tipo": midia_tipo,
            # AUD-14: mídia sem legenda (imagem) ou áudio sem transcrição chegam com
            # mensagem="" — gravar string vazia no histórico polui o painel do colaborador
            # com turnos de usuário vazios e sem rastreabilidade do que o lead realmente
            # mandou. `mensagem` (o texto real, se houver) segue intacto pro motor-agente
            # via contrato_v2["mensagem"] — só o registro no histórico ganha um texto
            # descritivo mínimo quando não há texto nenhum.
            "conteudo": mensagem or _texto_historico_para_midia_vazia(midia_tipo),
            "remetente": "lead",
            "created_at": "now()",
            "wamid": contrato_v2.get("wamid") or None,
        }).execute()
        supabase.rpc("increment_nao_lidas", {"conv_id": conversa_id}).execute()
    except Exception as exc:
        logger.critical(
            "[meta-inbound][DATA-LOSS] Falha ao salvar Mensagem do lead — conteudo perdido do "
            "historico, dispatch vai continuar mesmo assim. conversa_id=%s lead_id=%s "
            "midia_tipo=%s mensagem=%r erro=%s",
            conversa_id, lead_id, midia_tipo, mensagem, exc,
        )

    # ── Opt-out (AUD-12, LGPD) ────────────────────────────────────────────
    # Detectado ANTES do dispatch normal — registra opt_in=false via RPC já existente no banco
    # (registrar_opt_out) e responde direto, sem rotear pro motor-agente/Empregabilidade. Não
    # bloqueia o lead nem apaga nada — só marca a preferência de não receber campanha em massa
    # (campanhas_engine.py já filtra por opt_in=True nos 3 pontos de disparo, confirmado nesta
    # story: nenhum outro ponto do worker faz busca em massa de leads). O caminho de entrada
    # livre (lead não cadastrado) não é afetado — esta checagem só roda depois que o lead já foi
    # resolvido (upsert acima), igual a qualquer mensagem normal.
    if _eh_pedido_opt_out(mensagem):
        try:
            supabase.rpc("registrar_opt_out", {"p_telefone": telefone}).execute()
            logger.info(f"[meta-inbound] Opt-out registrado para telefone={telefone}")
        except Exception as exc:
            logger.error(f"[meta-inbound] Erro ao registrar opt-out para telefone={telefone}: {exc}")

        resposta_opt_out = (
            "Prontinho! Você não vai mais receber nossas campanhas e avisos em massa. 😊 "
            "Se quiser voltar a receber ou tiver alguma dúvida, é só me chamar por aqui."
        )
        try:
            supabase.table("mensagens").insert({
                "conversa_id": conversa_id,
                "lead_id": lead_id,
                "tipo": "text",
                "conteudo": resposta_opt_out,
                "remetente": "agente",
                "created_at": "now()",
            }).execute()
        except Exception as exc:
            logger.error(f"[meta-inbound] Erro ao salvar confirmação de opt-out: {exc}")

        from meta_adapter_outbound import _meta_enviar  # noqa: PLC0415
        token = os.getenv("META_SYSTEM_USER_TOKEN", "")
        await _meta_enviar(phone_number_id, telefone, resposta_opt_out, token)
        return

    # ── Guard awaiting_human: IA silenciada enquanto colaborador controla ────────
    # Checagem na CHEGADA da mensagem — early exit barato, evita até agendar o debounce à toa.
    # Não substitui a checagem no MOMENTO do dispatch (cuidado 1, dentro de _executar_dispatch):
    # entre a chegada e o dispatch de fato (adiado pelo debounce) o status pode mudar — ex.: um
    # colaborador assumiu a conversa manualmente enquanto o lead ainda mandava mensagens.
    if conversa_status == "awaiting_human":
        logger.info(
            "[awaiting_human] IA silenciada — conversa %s em atendimento humano. Descartando inbound.",
            conversa_id,
        )
        return

    # ── Dispatch (adiado por debounce — VAL-05) ─────────────────────────────
    async def _dispatch() -> None:
        await _executar_dispatch(
            agente_tipo=agente_tipo,
            contrato_v2=contrato_v2,
            conversa_id=conversa_id,
            lead_id=lead_id,
            telefone=telefone,
            phone_number_id=phone_number_id,
            wamid=wamid,
            push_name=push_name,
            midia_tipo=midia_tipo,
            unidade_cuca=unidade_cuca,
            mensagem=mensagem,
            supabase=supabase,
        )

    await _agendar_dispatch_debounced(conversa_id, _dispatch)


async def _executar_dispatch(
    *,
    agente_tipo: str,
    contrato_v2: dict,
    conversa_id: str,
    lead_id: str,
    telefone: str,
    phone_number_id: str,
    wamid: str,
    push_name: str,
    midia_tipo: str,
    unidade_cuca,
    mensagem: str,
    supabase,
) -> None:
    """Dispatch de verdade (motor-agente/Empregabilidade + envio da resposta) — roda depois do
    debounce (VAL-05). Mesma lógica que já existia inline em `processar_webhook_meta`, só
    extraída para poder ser adiada, mais o cuidado 1: reconferir `awaiting_human` aqui, porque
    o status pode ter mudado durante a espera do debounce."""
    try:
        status_result = supabase.table("conversas").select("status").eq("id", conversa_id).single().execute()
        status_no_dispatch = (status_result.data or {}).get("status")
    except Exception as exc:
        logger.warning("[debounce] Erro ao reconferir status antes do dispatch adiado: %s", exc)
        status_no_dispatch = None

    if status_no_dispatch == "awaiting_human":
        logger.info(
            "[awaiting_human] IA silenciada no momento do dispatch adiado — conversa %s passou a "
            "atendimento humano enquanto aguardava o debounce.",
            conversa_id,
        )
        return

    if agente_tipo == "Empregabilidade":
        try:
            from empregabilidade_engine import processar_mensagem_empregabilidade  # noqa: PLC0415
            await processar_mensagem_empregabilidade(
                texto=mensagem,
                phone=telefone,
                instance_name=phone_number_id,
                token="",
                lead_id=lead_id,
                conversa_id=conversa_id,
                unidade_cuca=unidade_cuca or "",
                push_name=push_name,
                midia_tipo=midia_tipo,
            )
        except Exception as exc:
            logger.error(f"[meta-inbound] Erro no dispatch Empregabilidade: {exc}")

    elif agente_tipo in _AGENTES_MOTOR_AGENTE:
        # S-WM-24 Task 2 (AUD-08, escopo ampliado 2026-08-07): mídia sem interpretação
        # (sticker, video, document, location, contacts, reaction, ...) é IGNORADA em
        # silêncio — sem chamar o motor-agente (que hoje só valida `mensagem` não-vazia,
        # nunca usa midia_url/midia_tipo, e responderia 400 "Nenhuma mensagem"), sem
        # marcar lida/digitando, sem nenhuma resposta ao lead. Decisão explícita do
        # Junior: não travar a IA nem devolver o fallback enganoso de "problema técnico"
        # pra esse conteúdo — fica assim até decidirem como tratar cada tipo. O inbound
        # já foi gravado no histórico (`mensagens`, em processar_webhook_meta, com o
        # texto descritivo de _texto_historico_para_midia_vazia) antes de chegar aqui —
        # só a resposta automática é que não acontece. "image" e "voz" (áudio) NÃO
        # entram neste guard — comportamento deles é inalterado por esta mudança.
        if (
            agente_tipo in _AGENTES_GUARD_MIDIA_SEM_INTERPRETACAO
            and midia_tipo not in _MIDIA_TIPOS_COM_INTERPRETACAO
        ):
            logger.info(
                "[meta-inbound] midia_tipo=%r sem interpretação — motor-agente não chamado, "
                "lead não recebe resposta (S-WM-24/AUD-08). conversa_id=%s",
                midia_tipo, conversa_id,
            )
            return
        try:
            from meta_adapter_outbound import _meta_enviar, _meta_marcar_lida_e_digitando  # noqa: PLC0415
            token = os.getenv("META_SYSTEM_USER_TOKEN", "")
            # TOM-02: marca lida + "digitando..." antes de chamar motor-agente (pode levar até
            # ~20s no pior caso do retry de rate limit) — reduz a percepção de "bot travado".
            # Best-effort, não bloqueia o dispatch se falhar.
            await _meta_marcar_lida_e_digitando(phone_number_id, wamid, token)
            partes = await _chamar_motor_agente(contrato_v2, conversa_id, supabase, phone_number_id)
            if partes:
                # S-WM-22 (TOM-03b): 1 ou mais partes, despachadas em sequência, na ordem. Falha
                # parcial (comportamento definido e documentado na story, não implícito): aborta
                # as partes restantes no 1º erro, SEM retry automático — _meta_enviar não tem
                # garantia de idempotência do lado da API da Meta, reenviar sem saber se o
                # request anterior só falhou na resposta (mas foi entregue) arriscaria duplicar
                # a mensagem pro lead. Enviar as partes seguintes fora de ordem (ex.: pular a
                # que falhou e mandar só o fechamento) deixaria uma resposta sem sentido — pior
                # do que a conversa ficar incompleta.
                #
                # 2026-08-18: `_meta_enviar` ganhou retry único centralizado (default), pra
                # cobrir o padrão de silêncio travado achado no fluxo de Empregabilidade. Esse
                # loop é a ÚNICA exceção deliberada — `retry=False` preserva exatamente o
                # comportamento acima (decisão S-WM-22 intacta, sem risco novo de duplicar
                # parte no meio de uma resposta sequencial).
                for indice, parte in enumerate(partes):
                    sucesso = await _meta_enviar(phone_number_id, telefone, parte, token, retry=False)
                    if not sucesso:
                        logger.error(
                            "[meta-inbound] Falha ao enviar parte %d/%d da resposta — abortando as partes "
                            "restantes (sem retry, sem duplicar). %d parte(s) enviada(s) com sucesso antes da falha.",
                            indice + 1,
                            len(partes),
                            indice,
                        )
                        break
            else:
                # TOM-01: tom neutro-amigável único pros 4 agente_tipo que passam por aqui
                # (Institucional, maria, sofia, ana — não "julia", que despacha por
                # Empregabilidade, outro caminho). Decisão: NÃO diferenciar por persona —
                # esse fallback dispara antes/sem saber se o motor-agente respondeu, o worker
                # não tem acesso ao prompt_contexto de cada persona (isso vive em
                # prompts_agentes, dentro da Edge Function), e duplicar tom por persona aqui
                # arriscaria dessincronizar do texto real de cada persona no futuro. Mantém a
                # substring "problema técnico" de propósito — é o que
                # test_processar_webhook_imagem_cai_no_fallback_tecnico (AUD-08, já commitado)
                # usa pra identificar esse caminho; mudar a palavra quebraria esse teste sem
                # relação com o achado que ele documenta.
                fallback_tecnico = "Ih, deu um problema técnico aqui do meu lado 😅 Pode mandar de novo pra mim?"
                await _meta_enviar(phone_number_id, telefone, fallback_tecnico, token)
                supabase.table("mensagens").insert({
                    "conversa_id": conversa_id,
                    "lead_id": lead_id,
                    "tipo": "text",
                    "conteudo": fallback_tecnico,
                    "remetente": "agente",
                    "created_at": "now()",
                }).execute()
        except Exception as exc:
            logger.error(f"[meta-inbound] Erro no dispatch motor-agente ({agente_tipo}): {exc}")

    else:
        logger.info(f"[meta-inbound] agente_tipo={agente_tipo!r} sem dispatch — descartado")
