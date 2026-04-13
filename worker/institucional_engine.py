"""
Motor de automação Institucional via WhatsApp.

Antes de chamar o motor-agente (RAG), apresenta um menu de seleção de unidade.
O lead escolhe a unidade e, a partir daí, todas as respostas usam o RAG daquela unidade.
Se o lead demonstrar interesse em outra unidade durante a conversa, o sistema confirma a troca.

Estado armazenado em conversas.metadata["inst_fluxo"].
"""

import asyncio
import os
import re
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

# ---------------------------------------------------------------------------
# Helpers de instância — números dinâmicos (nunca hardcode)
# ---------------------------------------------------------------------------

def _normalizar_tel_br(telefone: str | None) -> str | None:
    """
    Normaliza telefone brasileiro para formato wa.me (13 dígitos: 55 + DDD + 9 dígitos).
    Remove dígito extra quando o número veio do JID do WhatsApp já com o nono dígito
    incorporado, resultando em 14 dígitos ao ser armazenado com o prefixo 55.
    """
    if not telefone:
        return None
    digits = re.sub(r"\D", "", telefone)
    # Brasil: 55 + DDD (2) + número (9 dígitos) = 13 dígitos
    if digits.startswith("55") and len(digits) == 14:
        ddd = digits[2:4]
        numero = digits[4:]  # 10 dígitos — 1 a mais
        if numero[0] == "9":
            numero = numero[1:]  # remove o '9' extra no início do número
        digits = f"55{ddd}{numero}"
    return digits or None

def _buscar_telefone_instancia(nome_fragment: str, canal_tipo: str | None = None) -> str | None:
    """Busca o telefone de uma instância pelo fragmento do nome ou canal_tipo."""
    try:
        res = (
            supabase.table("instancias_uazapi")
            .select("telefone")
            .ilike("nome", f"%{nome_fragment}%")
            .eq("ativa", True)
            .limit(1)
            .execute()
        )
        if res.data and res.data[0].get("telefone"):
            return _normalizar_tel_br(res.data[0]["telefone"])
        if canal_tipo:
            # Fallback: buscar por canal_tipo sem unidade_cuca
            res2 = (
                supabase.table("instancias_uazapi")
                .select("telefone")
                .eq("canal_tipo", canal_tipo)
                .eq("ativa", True)
                .is_("unidade_cuca", None)
                .limit(1)
                .execute()
            )
            if res2.data and res2.data[0].get("telefone"):
                return _normalizar_tel_br(res2.data[0]["telefone"])
    except Exception as e:
        logger.warning(f"[inst-engine] Falha ao buscar telefone instância '{nome_fragment}': {e}")
    return None


def _montar_menu_unidades() -> str:
    """
    Ação 5.2 SQS-41: Monta o menu institucional com o número da empregabilidade
    buscado dinamicamente da tabela instancias_uazapi. Nunca usa número fixo.
    """
    telefone_empreg = _buscar_telefone_instancia("empregoredecuca", canal_tipo="Empregabilidade")

    link_empregabilidade = (
        f"wa.me/{telefone_empreg}" if telefone_empreg
        else "[número de empregabilidade não configurado]"
    )

    return (
        "Olá! 👋 Bem-vindo à *CUCA — Centro Urbano de Cultura, Arte, Ciência e Esporte*.\n\n"
        "Sobre qual unidade você quer informações?\n\n"
        "1️⃣ Cuca Barra\n"
        "2️⃣ Cuca Mondubim\n"
        "3️⃣ Cuca Jangurussu\n"
        "4️⃣ Cuca José Walter\n"
        "5️⃣ Cuca Pici\n\n"
        "Envie o *número* da unidade ou o nome dela.\n\n"
        f"Caso queira saber sobre *VAGAS DE EMPREGOS ABERTAS NA REDE CUCA*, acesse nosso numero da empregabilidade:\n"
        f"📍 *Empregabilidade Rede Cuca:* {link_empregabilidade}"
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

async def _enviar(instance_name: str, token: str, phone: str, texto: str, conversa_id: str = "", lead_id: str = ""):
    async with httpx.AsyncClient(timeout=15) as client:
        await client.post(
            f"{UAZAPI_URL}/send/text",
            headers={"token": token, "Content-Type": "application/json"},
            json={"number": phone, "delay": 1200, "text": texto},
        )
    # Gravar mensagem de saída do bot na tabela mensagens para exibição no painel
    if conversa_id:
        def _inserir():
            return supabase.table("mensagens").insert({
                "conversa_id": conversa_id,
                "lead_id": lead_id or None,
                "remetente": "agente",
                "tipo": "text",
                "conteudo": texto,
            }).execute()
        try:
            await asyncio.to_thread(_inserir)
        except Exception as _e:
            logger.error(f"[_enviar_institucional] Falha ao gravar mensagem no DB: {_e}", exc_info=True)


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

    # Ação 5.3 SQS-41: busca número da empregabilidade para injetar no prompt do LLM
    telefone_empreg = _buscar_telefone_instancia("empregoredecuca", canal_tipo="Empregabilidade")
    link_empreg = f"wa.me/{telefone_empreg}" if telefone_empreg else None

    instrucao_empregabilidade = (
        f"REGRA INQUEBRÁVEL: Se o usuário demonstrar qualquer intenção de buscar emprego, vagas de trabalho, "
        f"enviar currículo ou trabalhar no CUCA, NÃO tente responder ou dar informações. "
        f"Responda APENAS com esta mensagem exata: "
        f"'Para vagas de emprego e oportunidades na Rede CUCA, acesse nossa central de Empregabilidade: "
        f"{link_empreg or '[número não configurado]'}' — sem adicionar nenhuma outra informação."
    ) if link_empreg else (
        "REGRA INQUEBRÁVEL: Se o usuário demonstrar qualquer intenção de buscar emprego, vagas de trabalho, "
        "enviar currículo ou trabalhar no CUCA, informe que o canal correto é a Central de Empregabilidade da Rede CUCA "
        "e que ele deve buscar a unidade mais próxima para mais informações."
    )

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
        "numero_empregabilidade": telefone_empreg,
        "instrucoes_adicionais": instrucao_empregabilidade,
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
        await _enviar(instance_name, token, phone, _montar_menu_unidades(), conversa_id=conversa_id, lead_id=lead_id)
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
                "5️⃣ Cuca Pici",
                conversa_id=conversa_id, lead_id=lead_id,
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
                f"Ok! Agora estou buscando informações sobre *{unidade_nova}*. Pode perguntar! 😊",
                conversa_id=conversa_id, lead_id=lead_id,
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
                f"Continuamos com *{unidade_atual}*! 😊 Como posso te ajudar?",
                conversa_id=conversa_id, lead_id=lead_id,
            )
        return

    # -----------------------------------------------------------------------
    # Respondendo normalmente — detecta menção a outra unidade
    # -----------------------------------------------------------------------
    if etapa == "respondendo":
        unidade_atual = fluxo.get("unidade_selecionada") or unidade_cuca_instancia

        # Ação 5.3 SQS-41: Interceptação de intenção de emprego — resposta direta, sem chamar LLM
        _KEYWORDS_EMPREGO = {
            "emprego", "vaga", "vagas", "trabalho", "trabalhar", "currículo", "curriculo",
            "curriculum", "empregabilidade", "contrato", "contratado", "clt", "estágio",
            "estagio", "trainee", "job", "oportunidade", "oportunidades", "rh", "seleção",
            "processo seletivo", "me candidatar", "quero trabalhar", "busco emprego",
            "procuro emprego", "procurando emprego", "enviar currículo", "enviar curriculo",
        }
        if any(kw in t for kw in _KEYWORDS_EMPREGO):
            telefone_empreg = _buscar_telefone_instancia("empregoredecuca", canal_tipo="Empregabilidade")
            if telefone_empreg:
                msg_redirect = (
                    f"Para vagas de emprego e oportunidades na Rede CUCA, acesse nossa central de Empregabilidade: "
                    f"📍 *Empregabilidade Rede Cuca:* wa.me/{telefone_empreg}"
                )
            else:
                msg_redirect = (
                    "Para vagas de emprego e oportunidades na Rede CUCA, procure a unidade CUCA mais próxima "
                    "e solicite atendimento na Empregabilidade. 💼"
                )
            await _enviar(instance_name, token, phone, msg_redirect, conversa_id=conversa_id, lead_id=lead_id)
            return

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
                f"Responda *1* para sim ou *2* para continuar com *{unidade_atual}*.",
                conversa_id=conversa_id, lead_id=lead_id,
            )
            return

        # Mensagem normal — chama motor-agente com a unidade atual
        await _chamar_motor_agente(texto, phone, instance_name, unidade_atual, conversa_id, lead_id, token)
        return

    # -----------------------------------------------------------------------
    # Fallback — estado desconhecido, reinicia com o menu
    # -----------------------------------------------------------------------
    _set_inst_fluxo(conversa_id, {})
    await _enviar(instance_name, token, phone, _montar_menu_unidades(), conversa_id=conversa_id, lead_id=lead_id)
    _set_inst_fluxo(conversa_id, {"etapa": "aguardando_unidade"})
