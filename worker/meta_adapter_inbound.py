"""
Adapter Inbound — Meta Cloud API → Contrato v2
S-WM-01: recepção de webhook, validação HMAC-SHA256, normalização para Contrato v2.
"""
import io
import hmac
import hashlib
import json
import logging
import os
from datetime import datetime, timezone, timedelta

logger = logging.getLogger("worker-cuca")


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
    telefone: str = msg.get("from", "")

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
    except (KeyError, IndexError):
        logger.warning("[meta-inbound] Estrutura entry/changes/value inesperada — descartado")
        return

    # Ignorar eventos de status (delivery, read) sem messages[]
    if not messages:
        logger.info("[meta-inbound] Evento sem messages[] (status update) — ignorado")
        return

    # Guard: phone_number_id desconhecido → discard silencioso (AC #5 segurança)
    instancia_data = _get_instancia_by_phone_number_id(phone_number_id)
    if instancia_data is None:
        logger.warning(f"[meta-inbound] phone_number_id desconhecido: {phone_number_id} — descartado")
        return

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

    supabase = _get_supabase()

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
    try:
        conv_result = supabase.table("conversas").select("id, status").match(
            {"lead_id": lead_id, "origem_id": phone_number_id}
        ).execute()

        if conv_result.data:
            conversa_id: str = conv_result.data[0]["id"]
            supabase.table("conversas").update({"updated_at": "now()"}).eq("id", conversa_id).execute()
        else:
            new_conv = supabase.table("conversas").insert({
                "lead_id":    lead_id,
                "origem_id":  phone_number_id,
                "canal_ativo": "meta",
                "status":     "ativa",
                "agente_tipo": agente_tipo,
            }).execute()
            conversa_id = new_conv.data[0]["id"]
    except Exception as exc:
        logger.error(f"[meta-inbound] Erro ao gerenciar Conversa: {exc}")
        return

    # ── DB C: inserir Mensagem inbound e incrementar não lidas ──────────
    try:
        supabase.table("mensagens").insert({
            "conversa_id": conversa_id,
            "lead_id": lead_id,
            "tipo": midia_tipo,
            "conteudo": mensagem,
            "remetente": "lead",
            "created_at": "now()",
        }).execute()
        supabase.rpc("increment_nao_lidas", {"conv_id": conversa_id}).execute()
    except Exception as exc:
        logger.error(f"[meta-inbound] Erro ao salvar Mensagem: {exc}")

    # ── Dispatch: Empregabilidade (AC #6) ────────────────────────────────
    if agente_tipo == "Empregabilidade":
        try:
            from empregabilidade_engine import processar_mensagem_empregabilidade  # noqa: PLC0415
            await processar_mensagem_empregabilidade(
                texto=mensagem,
                phone=telefone,
                instance_name=phone_number_id,  # vestigial; S-WM-04 limpa assinatura
                token="",
                lead_id=lead_id,
                conversa_id=conversa_id,
                unidade_cuca=unidade_cuca or "",
                push_name=push_name,
            )
        except Exception as exc:
            logger.error(f"[meta-inbound] Erro no dispatch Empregabilidade: {exc}")
    else:
        logger.info(f"[meta-inbound] agente_tipo={agente_tipo!r} — sem dispatch nesta story")
