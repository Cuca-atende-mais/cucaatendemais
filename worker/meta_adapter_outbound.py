"""
Adapter Outbound — Cuca Worker → Meta Cloud API
S-WM-02: envio de mensagens de texto via Graph API v23.0.
"""
import logging
import os

logger = logging.getLogger("worker-cuca")

GRAPH_API_VERSION = "v23.0"


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
