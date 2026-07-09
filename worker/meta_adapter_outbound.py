"""
Adapter Outbound — Cuca Worker → Meta Cloud API
S-WM-02: envio de mensagens de texto via Graph API v23.0.
"""
import logging
import os

logger = logging.getLogger("worker-cuca")

GRAPH_API_VERSION = "v23.0"


def _normalizar_telefone_br(telefone: str) -> str:
    """
    Adiciona o nono dígito em números celulares brasileiros se ausente.
    Formato entrada: 558581733321 (12 dígitos total, 8 na parte local)
    Formato saída:  5585981733321 (13 dígitos total, 9 na parte local)
    Só aplica se: começa com 55, tem 12 dígitos total,
    e o dígito após o DDD não é 9.
    """
    if (len(telefone) == 12 and
            telefone.startswith("55") and
            telefone[4] != "9"):
        return telefone[:4] + "9" + telefone[4:]
    return telefone


async def _meta_enviar(
    phone_number_id: str,
    to: str,
    text: str,
    token: str,
) -> bool:
    """
    Envia mensagem de texto via Meta Cloud API.

    Retorna True em 2xx, False em qualquer falha.
    Falha antes do HTTP se phone_number_id ou token ausentes.
    Nunca expõe token em logs.
    """
    if not phone_number_id or not token:
        logger.error(
            "[meta-outbound] Envio abortado: phone_number_id=%s token=%s",
            bool(phone_number_id),
            bool(token),
        )
        return False

    if not to or not text:
        logger.error("[meta-outbound] Envio abortado: destinatário ou texto ausente")
        return False

    to = _normalizar_telefone_br(to)

    import httpx  # noqa: PLC0415 — lazy: httpx ausente nos containers de teste

    url = f"https://graph.facebook.com/{GRAPH_API_VERSION}/{phone_number_id}/messages"
    body = {
        "messaging_product": "whatsapp",
        "to": to,
        "type": "text",
        "text": {"body": text},
    }

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
    except httpx.TimeoutException as exc:
        logger.error("[meta-outbound] Timeout ao enviar para %s: %s", to, type(exc).__name__)
        return False
    except httpx.RequestError as exc:
        logger.error("[meta-outbound] Erro de rede ao enviar para %s: %s", to, type(exc).__name__)
        return False

    if resp.status_code < 200 or resp.status_code >= 300:
        # Loga status + corpo truncado; nunca repete cabeçalhos (token protegido)
        try:
            erro_body = resp.json()
            erro_resumo = str(erro_body).replace(token, "[REDACTED]")[:300]
        except Exception:
            erro_resumo = resp.text[:300].replace(token, "[REDACTED]")
        logger.error(
            "[meta-outbound] Graph API %s para %s: %s",
            resp.status_code,
            to,
            erro_resumo,
        )
        return False

    logger.info("[meta-outbound] Mensagem enviada para %s via %s", to, phone_number_id)
    return True


async def _meta_marcar_lida_e_digitando(
    phone_number_id: str,
    message_id: str,
    token: str,
) -> bool:
    """
    TOM-02: marca a mensagem inbound como lida (✓✓ azul) e ativa o indicador de "digitando..."
    numa única chamada (POST /{phone_number_id}/messages, status="read" + typing_indicator) —
    reduz a percepção de "bot travado" durante os até ~20s do pior caso do retry de rate limit
    da OpenAI (o lead vê "digitando" em vez de silêncio total).

    Best-effort: nunca propaga exceção nem bloqueia o dispatch — falha aqui só é logada.
    """
    if not phone_number_id or not token or not message_id:
        logger.warning(
            "[meta-outbound] Marcação lida/digitando abortada: phone_number_id=%s message_id=%s token=%s",
            bool(phone_number_id),
            bool(message_id),
            bool(token),
        )
        return False

    import httpx  # noqa: PLC0415 — lazy: httpx ausente nos containers de teste

    url = f"https://graph.facebook.com/{GRAPH_API_VERSION}/{phone_number_id}/messages"
    body = {
        "messaging_product": "whatsapp",
        "status": "read",
        "message_id": message_id,
        "typing_indicator": {"type": "text"},
    }

    try:
        # timeout curto de propósito: essa chamada é awaited no caminho crítico, antes do
        # motor-agente — um timeout longo aqui devoraria justamente a latência que essa
        # feature existe pra mascarar. Um indicador de "digitando" que chega atrasado não vale
        # a espera (o WhatsApp já expira o indicador sozinho em ~25s).
        async with httpx.AsyncClient(timeout=2) as client:
            resp = await client.post(
                url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json",
                },
                json=body,
            )
    except Exception as exc:
        logger.warning("[meta-outbound] Falha ao marcar lida/digitando: %s", type(exc).__name__)
        return False

    if resp.status_code < 200 or resp.status_code >= 300:
        logger.warning(
            "[meta-outbound] Graph API %s ao marcar lida/digitando para message_id=%s",
            resp.status_code,
            message_id,
        )
        return False

    return True
