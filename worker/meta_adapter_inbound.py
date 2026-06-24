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


# ─── Stub de Lookup (S-WM-03 substitui por query em meta_phone_numbers) ───────
_STUB_PHONE_NUMBER_MAP: dict[str, dict] = {
    os.getenv("META_STUB_PHONE_NUMBER_ID", "STUB_ID"): {
        "canal_origem": os.getenv("META_STUB_CANAL_ORIGEM", "cuca_empregabilidade_01"),
        "agente_tipo":  os.getenv("META_STUB_AGENTE_TIPO", "Empregabilidade"),
        "canal_tipo":   os.getenv("META_STUB_CANAL_TIPO", "Empregabilidade"),
        "unidade_cuca": None,
    }
}


def _get_instancia_by_phone_number_id(phone_number_id: str) -> dict | None:
    """Stub — S-WM-03 substitui por: supabase.table('meta_phone_numbers').select(...)..."""
    return _STUB_PHONE_NUMBER_MAP.get(phone_number_id)


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


# ─── Background Task ───────────────────────────────────────────────────────────
async def processar_webhook_meta(raw_body: bytes) -> None:
    """
    Background task do webhook Meta.

    Guard: phone_number_id desconhecido → log + discard silencioso (AC #4, R3).
    S-WM-03 substituirá o stub e adicionará o dispatch para os engines.
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

    # Guard: phone_number_id desconhecido → discard silencioso (AC #4)
    instancia_data = _get_instancia_by_phone_number_id(phone_number_id)
    if instancia_data is None:
        logger.warning(f"[meta-inbound] phone_number_id desconhecido: {phone_number_id} — descartado")
        return

    try:
        contrato_v2 = await build_contrato_v2(payload, instancia_data)
        logger.info(
            f"[meta-inbound] Contrato v2 construído: canal_origem={contrato_v2['canal_origem']} "
            f"tel={contrato_v2['telefone']} agente={contrato_v2['agente_tipo']} "
            f"midia_tipo={contrato_v2['midia_tipo']}"
        )
        # S-WM-03: adicionar dispatch para engines aqui (feature flag + routing por agente_tipo/canal_tipo)
    except Exception as exc:
        logger.error(f"[meta-inbound] Erro ao processar Contrato v2: {exc}")
