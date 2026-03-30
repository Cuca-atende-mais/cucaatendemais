"""
Motor de automação Institucional via WhatsApp.

Antes de chamar o motor-agente (RAG), apresenta um menu de seleção de unidade.
O lead escolhe a unidade e, a partir daí, todas as respostas usam o RAG daquela unidade.
Se o lead demonstrar interesse em outra unidade durante a conversa, o sistema confirma a troca.

Estado armazenado em conversas.metadata["inst_fluxo"].
"""

import os
import logging
import httpx
from supabase import create_client, Client
from datetime import datetime, timezone, timedelta

logger = logging.getLogger("institucional_engine")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
UAZAPI_URL = os.getenv("UAZAPI_BASE_URL", "https://uazapi.com.br")
WEBHOOK_INTERNAL_TOKEN = os.getenv("WEBHOOK_INTERNAL_TOKEN", "")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# ---------------------------------------------------------------------------
# Mapa de unidades — número/palavra → nome canônico
# ---------------------------------------------------------------------------

UNIDADES_MAPA: dict[str, str] = {
    "1": "Cuca Barra",
    "barra": "Cuca Barra",
    "cuca barra": "Cuca Barra",
    "2": "Cuca Mondubim",
    "mondubim": "Cuca Mondubim",
    "cuca mondubim": "Cuca Mondubim",
    "3": "Cuca Jangurussu",
    "jangurussu": "Cuca Jangurussu",
    "cuca jangurussu": "Cuca Jangurussu",
    "4": "Cuca José Walter",
    "josé walter": "Cuca José Walter",
    "jose walter": "Cuca José Walter",
    "j. walter": "Cuca José Walter",
    "jwalter": "Cuca José Walter",
    "cuca josé walter": "Cuca José Walter",
    "cuca jose walter": "Cuca José Walter",
    "5": "Cuca Pici",
    "pici": "Cuca Pici",
    "cuca pici": "Cuca Pici",
}

MENU_UNIDADES = (
    "Olá! 👋 Bem-vindo à *CUCA — Centro Urbano de Cultura, Arte, Ciência e Esporte*.\n\n"
    "Sobre qual unidade você quer informações?\n\n"
    "1️⃣ Cuca Barra\n"
    "2️⃣ Cuca Mondubim\n"
    "3️⃣ Cuca Jangurussu\n"
    "4️⃣ Cuca José Walter\n"
    "5️⃣ Cuca Pici\n\n"
    "Envie o *número* da unidade ou o nome dela."
)

# ---------------------------------------------------------------------------
# Helpers de estado
# ---------------------------------------------------------------------------

def _get_inst_fluxo(conversa_id: str) -> dict:
    res = supabase.table("conversas").select("metadata").eq("id", conversa_id).single().execute()
    metadata = (res.data or {}).get("metadata") or {}
    return metadata.get("inst_fluxo") or {}


def _set_inst_fluxo(conversa_id: str, dados: dict):
    res = supabase.table("conversas").select("metadata").eq("id", conversa_id).single().execute()
    metadata = (res.data or {}).get("metadata") or {}
    metadata["inst_fluxo"] = dados
    supabase.table("conversas").update({"metadata": metadata}).eq("id", conversa_id).execute()


# ---------------------------------------------------------------------------
# Envio de texto via UAZAPI
# ---------------------------------------------------------------------------

async def _enviar(instance_name: str, token: str, phone: str, texto: str):
    async with httpx.AsyncClient(timeout=15) as client:
        await client.post(
            f"{UAZAPI_URL}/send/text",
            headers={"token": token, "Content-Type": "application/json"},
            json={"number": phone, "delay": 1200, "text": texto},
        )


# ---------------------------------------------------------------------------
# Detecção de unidade no texto
# ---------------------------------------------------------------------------

def _detectar_unidade(texto: str, ignorar_numeros: bool = False) -> str | None:
    """Retorna o nome canônico da unidade mencionada no texto, ou None."""
    t = texto.strip().lower()
    
    # Se a pessoa digitou apenas o número e não estamos ignorando
    if not ignorar_numeros and t in ["1", "2", "3", "4", "5"]:
        return UNIDADES_MAPA[t]

    import re
    # Verifica chaves de texto, ignorando as numéricas
    for chave in sorted(UNIDADES_MAPA.keys(), key=len, reverse=True):
        if chave.isdigit():
            continue
        # Usa word boundary para não dar match em "barranco" quando procurar "barra" (opcional, mas mais seguro)
        # Como "barra" e "pici" são curtos, usar Regex é melhor para evitar falsos positivos
        if re.search(r'\b' + re.escape(chave) + r'\b', t):
            return UNIDADES_MAPA[chave]
            
    return None


# ---------------------------------------------------------------------------
# Chamada ao motor-agente (edge function)
# ---------------------------------------------------------------------------

async def _chamar_motor_agente(
    texto: str,
    phone: str,
    instance_name: str,
    unidade: str,
    conversa_id: str,
    lead_id: str,
    token: str,
    midia_url: str | None = None,
    midia_tipo: str | None = None,
):
    edge_url = f"{SUPABASE_URL}/functions/v1/motor-agente"
    headers = {
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "x-internal-token": WEBHOOK_INTERNAL_TOKEN,
    }
    _tz_fortaleza = timezone(timedelta(hours=-3))
    _agora = datetime.now(_tz_fortaleza)

    payload = {
        "telefone": phone,
        "instancia_uazapi": instance_name,
        "agente_tipo": "Institucional",
        "unidade_cuca": unidade,
        "canal_tipo": "Institucional",
        "mensagem": texto,
        "midia_url": midia_url,
        "midia_tipo": midia_tipo,
        "data_atual": _agora.strftime("%A, %d de %B de %Y, %H:%M"),
    }

    try:
        async with httpx.AsyncClient(timeout=45) as client:
            resp = await client.post(edge_url, json=payload, headers=headers)
            if resp.status_code != 200:
                logger.error(f"[inst-engine] motor-agente retornou {resp.status_code}: {resp.text[:200]}")
            else:
                data = resp.json()
                logger.info(f"[inst-engine] resposta motor: success={data.get('success')}")
                if data.get("success") and "resposta" in data:
                    import re
                    resposta_ia = data["resposta"]
                    media_url_out = None
                    
                    # Checar se a IA quer enviar arte / flyer
                    match_md = re.search(r'!\[.*?\]\((.*?)\)', resposta_ia)
                    match_tag = re.search(r'\[(?:FLYER|MÍDIA):\s*(.*?)\]', resposta_ia)
                    
                    if match_md:
                        media_url_out = match_md.group(1).strip()
                        resposta_ia = resposta_ia.replace(match_md.group(0), '').strip()
                    elif match_tag:
                        media_url_out = match_tag.group(1).strip()
                        resposta_ia = resposta_ia.replace(match_tag.group(0), '').strip()
                    
                    # Remover marcadores internos caso existam
                    handover_match = re.search(r'\[\[HANDOVER\]\]|\[TRANSBORDO\]|\[HUMANO\]|\[TRANSBORDO_HUMANO\]', resposta_ia, re.IGNORECASE)
                    if handover_match:
                        resposta_ia = resposta_ia.replace(handover_match.group(0), '').strip()
                        if not resposta_ia:
                            resposta_ia = "Certo, estou te transferindo para um atendente humano. Aguarde um momento por favor!"

                    if media_url_out:
                         await client.post(
                             f"{UAZAPI_URL}/message/sendMedia/{instance_name}",
                             headers={"apikey": token, "Content-Type": "application/json"},
                             json={
                                 "number": phone,
                                 "options": {"delay": 1500, "presence": "composing"},
                                 "mediaMessage": {
                                     "mediatype": "image",
                                     "caption": resposta_ia,
                                     "media": media_url_out
                                 }
                             }
                         )
                    else:
                        await _enviar(instance_name, token, phone, resposta_ia)
    except Exception as e:
        logger.error(f"[inst-engine] Erro ao chamar motor-agente: {e}", exc_info=True)


# ---------------------------------------------------------------------------
# Entry point principal
# ---------------------------------------------------------------------------

async def processar_mensagem_institucional(
    texto: str,
    phone: str,
    instance_name: str,
    token: str,
    lead_id: str,
    conversa_id: str,
    unidade_cuca_instancia: str,
):
    fluxo = _get_inst_fluxo(conversa_id)
    etapa = fluxo.get("etapa", "")
    t = texto.strip().lower()

    # -----------------------------------------------------------------------
    # Primeira mensagem ou fluxo vazio → exibir menu de unidades
    # -----------------------------------------------------------------------
    if not etapa:
        await _enviar(instance_name, token, phone, MENU_UNIDADES)
        _set_inst_fluxo(conversa_id, {"etapa": "aguardando_unidade"})
        return

    # -----------------------------------------------------------------------
    # Aguardando seleção de unidade
    # -----------------------------------------------------------------------
    if etapa == "aguardando_unidade":
        unidade = _detectar_unidade(t)
        if unidade:
            _set_inst_fluxo(conversa_id, {
                "etapa": "respondendo",
                "unidade_selecionada": unidade,
            })
            await _chamar_motor_agente(texto, phone, instance_name, unidade, conversa_id, lead_id, token)
        else:
            await _enviar(
                instance_name, token, phone,
                "Não reconheci a unidade. Por favor, envie o *número* ou o *nome* da unidade:\n\n"
                "1️⃣ Cuca Barra\n"
                "2️⃣ Cuca Mondubim\n"
                "3️⃣ Cuca Jangurussu\n"
                "4️⃣ Cuca José Walter\n"
                "5️⃣ Cuca Pici"
            )
        return

    # -----------------------------------------------------------------------
    # Aguardando confirmação de troca de unidade
    # -----------------------------------------------------------------------
    if etapa == "confirmando_troca":
        unidade_atual = fluxo.get("unidade_selecionada", "")
        unidade_nova = fluxo.get("unidade_nova", "")

        if t in ("1", "sim", "s", "yes", "confirmar", "confirma"):
            _set_inst_fluxo(conversa_id, {
                "etapa": "respondendo",
                "unidade_selecionada": unidade_nova,
            })
            await _enviar(
                instance_name, token, phone,
                f"Ok! Agora estou buscando informações sobre *{unidade_nova}*. Pode perguntar! 😊"
            )
        else:
            # Mantém unidade atual — NÃO repassa a mensagem anterior ao motor-agente
            # (o histórico da conversa contém a menção à outra unidade e causaria confusão)
            _set_inst_fluxo(conversa_id, {
                "etapa": "respondendo",
                "unidade_selecionada": unidade_atual,
            })
            await _enviar(
                instance_name, token, phone,
                f"Continuamos com *{unidade_atual}*! 😊 Como posso te ajudar?"
            )
        return

    # -----------------------------------------------------------------------
    # Respondendo normalmente — detecta menção a outra unidade
    # -----------------------------------------------------------------------
    if etapa == "respondendo":
        unidade_atual = fluxo.get("unidade_selecionada") or unidade_cuca_instancia
        unidade_mencionada = _detectar_unidade(t, ignorar_numeros=True)

        if unidade_mencionada and unidade_mencionada != unidade_atual:
            # Lead quer saber sobre outra unidade — pede confirmação antes de trocar
            _set_inst_fluxo(conversa_id, {
                "etapa": "confirmando_troca",
                "unidade_selecionada": unidade_atual,
                "unidade_nova": unidade_mencionada,
            })
            await _enviar(
                instance_name, token, phone,
                f"Você quer informações sobre *{unidade_mencionada}*?\n\n"
                f"Responda *1* para sim ou *2* para continuar com *{unidade_atual}*."
            )
            return

        # Mensagem normal — chama motor-agente com a unidade atual
        await _chamar_motor_agente(texto, phone, instance_name, unidade_atual, conversa_id, lead_id, token)
        return

    # -----------------------------------------------------------------------
    # Fallback — estado desconhecido, reinicia com o menu
    # -----------------------------------------------------------------------
    _set_inst_fluxo(conversa_id, {})
    await _enviar(instance_name, token, phone, MENU_UNIDADES)
    _set_inst_fluxo(conversa_id, {"etapa": "aguardando_unidade"})
