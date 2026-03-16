"""
S29-S31 — Motor de Empregabilidade via WhatsApp
Instância unificada: atende empresa, candidato ativo e grande público no mesmo número.

Máquina de estados armazenada em conversas.metadata["empreg_fluxo"].
"""

import os
import re
import logging
import httpx
from datetime import date
from urllib.parse import quote
from supabase import create_client, Client

logger = logging.getLogger("empregabilidade_engine")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
UAZAPI_URL = os.getenv("UAZAPI_BASE_URL", "https://uazapi.com.br")
PORTAL_URL = os.getenv("PORTAL_URL", "https://www.cucaatendemais.com.br")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

_PALAVRAS_ENCERRAR = {
    "tchau", "até mais", "até logo", "encerrar", "finalizar", "obrigado",
    "obrigada", "valeu", "pronto", "pode fechar", "ok pode fechar",
    "nada mais", "só isso", "era isso",
}


# ---------------------------------------------------------------------------
# Envio de mensagem de texto via UAZAPI
# ---------------------------------------------------------------------------

async def _enviar(instance_name: str, token: str, phone: str, texto: str):
    async with httpx.AsyncClient(timeout=15) as client:
        await client.post(
            f"{UAZAPI_URL}/send/text",
            headers={"token": token, "Content-Type": "application/json"},
            json={"number": phone, "delay": 1200, "text": texto},
        )


# ---------------------------------------------------------------------------
# Consulta CNPJ Brasil API (Receita Federal)
# ---------------------------------------------------------------------------

async def _consultar_cnpj(cnpj: str) -> dict | None:
    """Retorna dados da empresa pelo CNPJ via API pública cnpj.ws ou None se inválido/não encontrado."""
    cnpj_limpo = re.sub(r"\D", "", cnpj)
    if len(cnpj_limpo) != 14:
        return None
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(f"https://publica.cnpj.ws/cnpj/{cnpj_limpo}")
            if res.status_code == 200:
                return res.json()
            return None
    except Exception as e:
        logger.warning(f"[CNPJ API] Erro ao consultar {cnpj_limpo}: {e}")
        return None


def _formatar_dados_cnpj(dados: dict) -> str:
    """Formata os dados retornados pela API em uma mensagem legível."""
    nome = dados.get("razao_social") or dados.get("nome_fantasia") or "Não informado"
    fantasia = dados.get("nome_fantasia") or ""
    cnpj_fmt = dados.get("cnpj") or ""
    situacao = (dados.get("situacao_cadastral") or {}).get("descricao", "")
    endereco = dados.get("estabelecimento", {}) or {}
    logradouro = endereco.get("logradouro") or ""
    numero = endereco.get("numero") or ""
    municipio = (endereco.get("municipio") or {}).get("descricao", "")
    uf = endereco.get("uf") or ""
    email = endereco.get("email") or ""
    telefone1 = endereco.get("telefone1") or ""

    linhas = [
        "📋 *Dados encontrados na Receita Federal:*",
        f"🏢 *Razão Social:* {nome}",
    ]
    if fantasia and fantasia.upper() != nome.upper():
        linhas.append(f"🏷️ *Nome Fantasia:* {fantasia}")
    linhas.append(f"🔢 *CNPJ:* {cnpj_fmt}")
    if situacao:
        linhas.append(f"📌 *Situação:* {situacao}")
    if logradouro:
        linhas.append(f"📍 *Endereço:* {logradouro}, {numero} — {municipio}/{uf}")
    if email:
        linhas.append(f"📧 *E-mail:* {email}")
    if telefone1:
        linhas.append(f"📞 *Telefone:* {telefone1}")
    return "\n".join(linhas)


# ---------------------------------------------------------------------------
# Leitura e gravação do estado no banco
# ---------------------------------------------------------------------------

def _get_fluxo(conversa_id: str) -> dict:
    res = supabase.table("conversas").select("metadata").eq("id", conversa_id).single().execute()
    metadata = (res.data or {}).get("metadata") or {}
    return metadata.get("empreg_fluxo", {})


def _set_fluxo(conversa_id: str, fluxo: dict):
    res = supabase.table("conversas").select("metadata").eq("id", conversa_id).single().execute()
    metadata = (res.data or {}).get("metadata") or {}
    metadata["empreg_fluxo"] = fluxo
    supabase.table("conversas").update({"metadata": metadata}).eq("id", conversa_id).execute()


def _quer_encerrar(texto: str) -> bool:
    t = texto.strip().lower()
    return t in _PALAVRAS_ENCERRAR or any(p in t for p in _PALAVRAS_ENCERRAR)


# ---------------------------------------------------------------------------
# Encerramento padronizado
# ---------------------------------------------------------------------------

async def _encerrar_fluxo(
    conversa_id: str,
    instance_name: str,
    token: str,
    phone: str,
    perfil: str,
):
    """Envia despedida contextualizada, limpa estado e encerra a conversa."""
    if perfil == "empresa":
        msg = (
            "Tudo certo! Quando precisar criar uma nova vaga ou acompanhar candidatos, "
            "é só nos enviar uma mensagem. 👷\n\nAté logo!"
        )
    else:
        msg = (
            "Boa sorte! Fique de olho nas mensagens da equipe CUCA. 🤝\n\n"
            "Se precisar de mais alguma coisa, é só chamar. Até logo! 👋"
        )
    await _enviar(instance_name, token, phone, msg)
    _set_fluxo(conversa_id, {})


# ---------------------------------------------------------------------------
# Identificação de perfil (empresa, candidato, público geral)
# ---------------------------------------------------------------------------

def _identificar_perfil(texto: str, fluxo: dict) -> str:
    """
    Retorna 'empresa', 'candidato', 'publico' ou 'indefinido'.
    Usa palavras-chave para classificação inicial.
    """
    t = texto.lower()

    palavras_empresa = [
        "vaga", "contratar", "selecionar", "divulgar", "empresa",
        "cnpj", "candidato", "processo seletivo", "emprego", "oferecer",
        "disponibilizar", "preciso de funcionário", "estágio", "trainee",
    ]
    palavras_candidato = [
        "minha candidatura", "me candidatei", "número da candidatura",
        "status", "cpf", "fui selecionado", "aprovado", "entrevista",
        "acompanhar", "como está", "resultado",
    ]
    palavras_publico = [
        "vaga aberta", "quero trabalhar", "quero emprego", "tem vaga",
        "como me candidato", "como faço", "oportunidade", "interesse em vaga",
    ]

    score_empresa = sum(1 for p in palavras_empresa if p in t)
    score_candidato = sum(1 for p in palavras_candidato if p in t)
    score_publico = sum(1 for p in palavras_publico if p in t)

    if score_empresa > score_candidato and score_empresa > score_publico:
        return "empresa"
    if score_candidato > score_empresa and score_candidato > score_publico:
        return "candidato"
    if score_publico > 0:
        return "publico"
    return "indefinido"


# ---------------------------------------------------------------------------
# Fluxo de EMPRESA
# ---------------------------------------------------------------------------

async def _processar_empresa(
    texto: str,
    phone: str,
    instance_name: str,
    token: str,
    lead_id: str,
    conversa_id: str,
    unidade_cuca: str,
):
    fluxo = _get_fluxo(conversa_id)
    etapa = fluxo.get("etapa", "solicitar_cnpj")

    # Encerramento em qualquer etapa pós-ação
    if _quer_encerrar(texto) and etapa not in ("aguardando_cnpj", "confirmando_cadastro", "confirmando_cadastro_com_correcao"):
        await _encerrar_fluxo(conversa_id, instance_name, token, phone, "empresa")
        return

    # --- RETOMADA: empresa já identificada voltando sem etapa ativa ---
    if etapa in ("", None) or etapa == "encerrado":
        empresa_id = fluxo.get("empresa_id")
        empresa_nome = fluxo.get("empresa_nome_exibicao") or fluxo.get("empresa_nome", "")
        if empresa_id and empresa_nome:
            await _enviar(
                instance_name, token, phone,
                f"Olá! 👋 Que bom ter você de volta.\n\n"
                f"Vi que você já tem cadastro conosco como *{empresa_nome}*.\n\n"
                "O que deseja fazer?\n\n"
                "1️⃣ Cadastrar nova vaga\n"
                "2️⃣ Consultar status de uma vaga\n"
                "3️⃣ Editar uma vaga\n"
                "4️⃣ Cancelar uma vaga\n\n"
                "Responda com *1*, *2*, *3* ou *4*."
            )
            fluxo["etapa"] = "menu_empresa_acoes"
            _set_fluxo(conversa_id, fluxo)
            return

    # --- ETAPA: menu_empresa_retomada (legado — redireciona para menu_empresa_acoes) ---
    if etapa == "menu_empresa_retomada":
        empresa_id = fluxo.get("empresa_id")
        empresa_nome = fluxo.get("empresa_nome_exibicao") or fluxo.get("empresa_nome", "")
        await _enviar(
            instance_name, token, phone,
            f"Olá! 👋 Que bom ter você de volta, *{empresa_nome}*.\n\n"
            "O que deseja fazer?\n\n"
            "1️⃣ Cadastrar nova vaga\n"
            "2️⃣ Consultar status de uma vaga\n"
            "3️⃣ Editar uma vaga\n"
            "4️⃣ Cancelar uma vaga\n\n"
            "Responda com *1*, *2*, *3* ou *4*."
        )
        fluxo["etapa"] = "menu_empresa_acoes"
        _set_fluxo(conversa_id, fluxo)
        return

    # --- ETAPA: menu_empresa_acoes ---
    if etapa == "menu_empresa_acoes":
        t = texto.strip().lower()
        empresa_id = fluxo.get("empresa_id")
        empresa_nome = fluxo.get("empresa_nome_exibicao") or fluxo.get("empresa_nome", "")
        if t in ("1", "nova vaga", "divulgar", "criar", "cadastrar"):
            unidade_param = f"&unidade_cuca={quote(unidade_cuca)}" if unidade_cuca else ""
            link_vaga = f"{PORTAL_URL}/empregabilidade/vagas/nova?empresa_id={empresa_id}{unidade_param}"
            await _enviar(
                instance_name, token, phone,
                f"Ótimo! 🎯 Acesse o link abaixo para preencher os dados da nova vaga:\n\n"
                f"🔗 {link_vaga}\n\n"
                "Após o preenchimento, você receberá aqui o número da vaga e a confirmação."
            )
            _set_fluxo(conversa_id, {
                "perfil": "empresa",
                "etapa": "aguardando_retorno_vaga",
                "empresa_id": empresa_id,
                "empresa_nome": fluxo.get("empresa_nome", ""),
                "empresa_nome_exibicao": empresa_nome,
                "cnpj": fluxo.get("cnpj"),
            })
        elif t in ("2", "consultar", "status", "acompanhar", "vagas"):
            _set_fluxo(conversa_id, {**fluxo, "etapa": "consulta_empresa"})
            await _processar_consulta_empresa(texto, phone, instance_name, token, fluxo, conversa_id)
        elif t in ("3", "editar", "alterar", "modificar"):
            _set_fluxo(conversa_id, {**fluxo, "etapa": "selecionando_vaga_edicao"})
            await _listar_vagas_para_acao(empresa_id, instance_name, token, phone, "edicao", conversa_id, fluxo)
        elif t in ("4", "cancelar", "encerrar vaga", "remover vaga"):
            _set_fluxo(conversa_id, {**fluxo, "etapa": "selecionando_vaga_cancelamento"})
            await _listar_vagas_para_acao(empresa_id, instance_name, token, phone, "cancelamento", conversa_id, fluxo)
        else:
            await _encerrar_fluxo(conversa_id, instance_name, token, phone, "empresa")
        return

    # --- ETAPA: selecionando_vaga_edicao ---
    if etapa == "selecionando_vaga_edicao":
        empresa_id = fluxo.get("empresa_id")
        match_num = re.search(r"\b(\d{1,4})\b", texto)
        if not match_num:
            await _enviar(instance_name, token, phone,
                          "Por favor, informe o *número* da vaga que deseja editar (ex: 1, 2, 3...):")
            return
        num = match_num.group(1)
        vagas_res = supabase.table("vagas").select(
            "id, titulo, status, numero_vaga"
        ).eq("empresa_id", empresa_id).not_.in_("status", ["cancelada"]).execute()
        vaga_match = next(
            (v for v in (vagas_res.data or []) if str(v.get("numero_vaga", "")) == num),
            None
        )
        if not vaga_match:
            await _enviar(instance_name, token, phone,
                          "Vaga não encontrada ou não disponível para edição. Informe outro número:")
            return
        if vaga_match["status"] == "preenchida":
            await _enviar(instance_name, token, phone,
                          f"A vaga *{vaga_match['titulo']}* já está preenchida e não pode ser editada.")
            return
        unidade_param = f"&empresa_id={empresa_id}"
        link_edicao = f"{PORTAL_URL}/empregabilidade/vagas/editar?vaga_id={vaga_match['id']}{unidade_param}"
        await _enviar(
            instance_name, token, phone,
            f"🔗 Acesse o link abaixo para editar a vaga *{vaga_match['titulo']}*:\n\n"
            f"{link_edicao}\n\n"
            "Todos os dados já estarão preenchidos. Altere apenas o que deseja mudar e clique em *Salvar Alterações*.\n\n"
            "Após o envio, você receberá uma confirmação aqui. As alterações serão validadas pela equipe CUCA antes de a vaga voltar a aceitar candidaturas."
        )
        _set_fluxo(conversa_id, {
            **fluxo,
            "etapa": "aguardando_retorno_edicao",
            "vaga_edicao_id": vaga_match["id"],
            "vaga_edicao_titulo": vaga_match["titulo"],
        })
        return

    # --- ETAPA: aguardando_retorno_edicao ---
    if etapa == "aguardando_retorno_edicao":
        fluxo_atual = _get_fluxo(conversa_id)
        vaga_editada_id = fluxo_atual.get("vaga_editada_id")
        empresa_id = fluxo_atual.get("empresa_id")
        empresa_nome = fluxo_atual.get("empresa_nome_exibicao") or fluxo_atual.get("empresa_nome", "")
        vaga_titulo = fluxo_atual.get("vaga_editada_titulo") or fluxo_atual.get("vaga_edicao_titulo", "")

        if vaga_editada_id:
            # Portal já confirmou a edição — mensagem enviada pelo loop proativo
            # Se chegar aqui por mensagem manual, mostrar menu
            await _enviar(
                instance_name, token, phone,
                "O que deseja fazer agora?\n\n"
                "1️⃣ Cadastrar nova vaga\n"
                "2️⃣ Consultar status de uma vaga\n"
                "3️⃣ Editar uma vaga\n"
                "4️⃣ Cancelar uma vaga\n\n"
                "Responda com *1*, *2*, *3* ou *4*."
            )
            _set_fluxo(conversa_id, {
                "perfil": "empresa",
                "etapa": "menu_empresa_acoes",
                "empresa_id": empresa_id,
                "empresa_nome": fluxo_atual.get("empresa_nome", ""),
                "empresa_nome_exibicao": empresa_nome,
                "cnpj": fluxo_atual.get("cnpj"),
            })
        else:
            empresa_id_ref = fluxo.get("empresa_id")
            vaga_id_ref = fluxo.get("vaga_edicao_id")
            unidade_param = f"&empresa_id={empresa_id_ref}"
            link_edicao = f"{PORTAL_URL}/empregabilidade/vagas/editar?vaga_id={vaga_id_ref}{unidade_param}"
            await _enviar(
                instance_name, token, phone,
                "Ainda aguardando o preenchimento do formulário de edição. 🕐\n\n"
                f"Caso precise do link novamente:\n🔗 {link_edicao}\n\n"
                "Se precisar de ajuda, entre em contato com a equipe da unidade. 🤝"
            )
        return

    # --- ETAPA: selecionando_vaga_cancelamento ---
    if etapa == "selecionando_vaga_cancelamento":
        empresa_id = fluxo.get("empresa_id")
        match_num = re.search(r"\b(\d{1,4})\b", texto)
        if not match_num:
            await _enviar(instance_name, token, phone,
                          "Por favor, informe o *número* da vaga que deseja cancelar (ex: 1, 2, 3...):")
            return
        num = match_num.group(1)
        vagas_res = supabase.table("vagas").select(
            "id, titulo, status, numero_vaga, created_at"
        ).eq("empresa_id", empresa_id).execute()
        vaga_match = next(
            (v for v in (vagas_res.data or [])
             if str(v.get("numero_vaga", "")) == num and v["status"] not in ("cancelada",)),
            None
        )
        if not vaga_match:
            await _enviar(instance_name, token, phone,
                          "Vaga não encontrada ou já cancelada. Informe outro número ou diga *encerrar*.")
            return
        data_criacao = vaga_match.get("created_at", "")[:10] if vaga_match.get("created_at") else ""
        await _enviar(
            instance_name, token, phone,
            f"⚠️ Você está prestes a *cancelar* a vaga:\n\n"
            f"📋 *{vaga_match['titulo']}*\n"
            f"📅 Criada em: {data_criacao}\n\n"
            "Uma vaga cancelada *não pode ser reativada*. Para publicar novamente no futuro, será necessário criar uma nova vaga.\n\n"
            "Confirma o cancelamento? Responda *sim* para confirmar ou *não* para voltar."
        )
        _set_fluxo(conversa_id, {
            **fluxo,
            "etapa": "confirmando_cancelamento",
            "vaga_cancelar_id": vaga_match["id"],
            "vaga_cancelar_titulo": vaga_match["titulo"],
        })
        return

    # --- ETAPA: confirmando_cancelamento ---
    if etapa == "confirmando_cancelamento":
        t = texto.strip().lower()
        empresa_id = fluxo.get("empresa_id")
        empresa_nome = fluxo.get("empresa_nome_exibicao") or fluxo.get("empresa_nome", "")
        vaga_id_cancelar = fluxo.get("vaga_cancelar_id")
        vaga_titulo_cancelar = fluxo.get("vaga_cancelar_titulo", "")

        if t in ("sim", "s", "confirmo", "confirmar", "ok", "yes"):
            from datetime import datetime
            # Buscar histórico atual
            vaga_res = supabase.table("vagas").select(
                "historico_alteracoes, created_by, unidade_cuca"
            ).eq("id", vaga_id_cancelar).single().execute()
            historico = (vaga_res.data or {}).get("historico_alteracoes") or []
            created_by = (vaga_res.data or {}).get("created_by")
            unidade_vaga = (vaga_res.data or {}).get("unidade_cuca", unidade_cuca)

            nova_entrada = {
                "tipo": "cancelamento",
                "canal": "whatsapp",
                "ator": {"empresa_id": empresa_id},
                "timestamp": datetime.utcnow().isoformat(),
            }

            supabase.table("vagas").update({
                "status": "cancelada",
                "historico_alteracoes": [*historico, nova_entrada],
                "updated_at": datetime.utcnow().isoformat(),
            }).eq("id", vaga_id_cancelar).execute()

            await _enviar(
                instance_name, token, phone,
                f"✅ A vaga *{vaga_titulo_cancelar}* foi *cancelada*.\n\n"
                "Se quiser publicar essa oportunidade novamente no futuro, basta criar uma nova vaga pelo mesmo processo.\n\n"
                "O que deseja fazer agora?\n\n"
                "1️⃣ Cadastrar nova vaga\n"
                "2️⃣ Consultar status de uma vaga\n"
                "3️⃣ Editar uma vaga\n"
                "4️⃣ Encerrar\n\n"
                "Responda com *1*, *2*, *3* ou *4*."
            )

            # Notificar lead responsável
            if created_by:
                try:
                    lead_res = supabase.table("leads").select("telefone").eq("id", created_by).single().execute()
                    lead_phone = (lead_res.data or {}).get("telefone")
                    if lead_phone:
                        inst_res = supabase.table("instancias_uazapi").select(
                            "nome, token"
                        ).eq("unidade_cuca", unidade_vaga).eq("canal_tipo", "Institucional").eq("ativa", True).limit(1).execute()
                        inst = (inst_res.data or [None])[0]
                        if inst:
                            tel_limpo = re.sub(r"\D", "", lead_phone)
                            tel_fmt = tel_limpo if tel_limpo.startswith("55") else f"55{tel_limpo}"
                            msg_lead = (
                                f"❌ *Vaga Cancelada*\n\n"
                                f"A empresa *{empresa_nome}* solicitou o cancelamento da vaga *{vaga_titulo_cancelar}*.\n\n"
                                "O histórico foi registrado. Nenhuma ação é necessária."
                            )
                            await _enviar(inst["nome"], inst["token"], tel_fmt, msg_lead)
                except Exception as e_lead:
                    logger.warning(f"[cancelamento] Erro ao notificar lead: {e_lead}")

            _set_fluxo(conversa_id, {
                "perfil": "empresa",
                "etapa": "menu_empresa_acoes",
                "empresa_id": empresa_id,
                "empresa_nome": fluxo.get("empresa_nome", ""),
                "empresa_nome_exibicao": empresa_nome,
                "cnpj": fluxo.get("cnpj"),
            })
        else:
            await _enviar(
                instance_name, token, phone,
                "Cancelamento abortado. A vaga continua ativa.\n\n"
                "O que deseja fazer?\n\n"
                "1️⃣ Cadastrar nova vaga\n"
                "2️⃣ Consultar status de uma vaga\n"
                "3️⃣ Editar uma vaga\n"
                "4️⃣ Cancelar uma vaga\n\n"
                "Responda com *1*, *2*, *3* ou *4*."
            )
            _set_fluxo(conversa_id, {**fluxo, "etapa": "menu_empresa_acoes"})
        return

    # --- ETAPA: solicitar_cnpj ---
    if etapa == "solicitar_cnpj":
        await _enviar(
            instance_name, token, phone,
            "Olá! 👋 Sou o assistente de empregabilidade do CUCA.\n\n"
            "Para verificar seu cadastro, por favor informe o *CNPJ* da sua empresa (somente números):"
        )
        _set_fluxo(conversa_id, {"etapa": "aguardando_cnpj"})
        return

    # --- ETAPA: aguardando_cnpj ---
    if etapa == "aguardando_cnpj":
        cnpj_limpo = re.sub(r"\D", "", texto)
        if len(cnpj_limpo) != 14:
            await _enviar(instance_name, token, phone,
                          "CNPJ inválido. Por favor, informe os *14 dígitos* do CNPJ da sua empresa:")
            return

        # Verificar no banco
        emp_res = supabase.table("empresas").select("id, nome, nome_fantasia").eq("cnpj", cnpj_limpo).execute()
        if emp_res.data:
            empresa = emp_res.data[0]
            nome_exibicao = empresa.get("nome_fantasia") or empresa["nome"]
            await _enviar(
                instance_name, token, phone,
                f"✅ Empresa *{nome_exibicao}* já está cadastrada!\n\n"
                "Deseja divulgar uma vaga agora? Responda *sim* ou *não*."
            )
            _set_fluxo(conversa_id, {
                "etapa": "aguardando_criar_vaga",
                "cnpj": cnpj_limpo,
                "empresa_id": empresa["id"],
                "empresa_nome": empresa["nome"],
                "empresa_nome_exibicao": nome_exibicao,
            })
            return

        # Empresa não cadastrada — consultar CNPJ Brasil
        await _enviar(instance_name, token, phone, "🔍 Consultando dados na Receita Federal, aguarde...")
        dados_rf = await _consultar_cnpj(cnpj_limpo)

        if not dados_rf:
            await _enviar(
                instance_name, token, phone,
                "Não encontrei dados para esse CNPJ na Receita Federal. "
                "Verifique se digitou corretamente e tente novamente:"
            )
            return

        situacao = (dados_rf.get("situacao_cadastral") or {}).get("descricao", "").upper()
        if "ATIVA" not in situacao and situacao:
            await _enviar(
                instance_name, token, phone,
                f"⚠️ O CNPJ informado está com situação *{situacao}* na Receita Federal.\n"
                "Não é possível cadastrar empresas inativas. Se houver erro, entre em contato com a unidade."
            )
            _set_fluxo(conversa_id, {})
            return

        msg_dados = _formatar_dados_cnpj(dados_rf)
        await _enviar(
            instance_name, token, phone,
            f"{msg_dados}\n\n"
            "As informações estão corretas? Responda *sim* para confirmar o cadastro.\n"
            "Se algum dado estiver desatualizado, informe o que precisa ser corrigido."
        )

        # Extrair campos para pré-cadastro
        endereco = dados_rf.get("estabelecimento") or {}
        municipio = (endereco.get("municipio") or {}).get("descricao", "")
        uf = endereco.get("uf") or ""
        logradouro = endereco.get("logradouro") or ""
        numero_end = endereco.get("numero") or ""
        end_completo = f"{logradouro}, {numero_end} — {municipio}/{uf}".strip(" ,—/")

        _set_fluxo(conversa_id, {
            "etapa": "confirmando_cadastro",
            "cnpj": cnpj_limpo,
            "dados_rf": {
                "nome": dados_rf.get("razao_social") or "",
                "nome_fantasia": dados_rf.get("nome_fantasia") or "",
                "email": (dados_rf.get("estabelecimento") or {}).get("email") or "",
                "telefone": (dados_rf.get("estabelecimento") or {}).get("telefone1") or "",
                "endereco": end_completo,
                "setor": (dados_rf.get("cnae_fiscal_descricao") or ""),
                "porte": (dados_rf.get("porte") or {}).get("descricao") or "",
            },
        })
        return

    # --- ETAPA: confirmando_cadastro ---
    if etapa == "confirmando_cadastro":
        t = texto.strip().lower()
        dados_rf = fluxo.get("dados_rf", {})
        cnpj = fluxo.get("cnpj", "")

        if t in ("sim", "s", "confirmar", "confirmo", "correto", "ok", "certo", "isso"):
            nome_fantasia = dados_rf.get("nome_fantasia") or None
            emp_insert = supabase.table("empresas").insert({
                "nome": dados_rf.get("nome"),
                "nome_fantasia": nome_fantasia,
                "cnpj": cnpj,
                "email": dados_rf.get("email") or None,
                "telefone": dados_rf.get("telefone") or None,
                "endereco": dados_rf.get("endereco") or None,
                "setor": dados_rf.get("setor") or None,
                "porte": dados_rf.get("porte") or None,
                "ativa": True,
            }).execute()
            empresa_id = emp_insert.data[0]["id"]
            empresa_nome = dados_rf.get("nome", "")
            nome_exibicao = nome_fantasia or empresa_nome

            await _enviar(
                instance_name, token, phone,
                f"✅ *Cadastro realizado com sucesso!*\n\n"
                f"🏢 *{nome_exibicao}* agora está na nossa base de parceiros.\n\n"
                "Deseja divulgar uma vaga agora? Responda *sim* ou *não*."
            )
            _set_fluxo(conversa_id, {
                "etapa": "aguardando_criar_vaga",
                "cnpj": cnpj,
                "empresa_id": empresa_id,
                "empresa_nome": empresa_nome,
                "empresa_nome_exibicao": nome_exibicao,
            })
        else:
            dados_rf["correcao"] = texto
            await _enviar(
                instance_name, token, phone,
                "Obrigado pela correção! Guardamos essa informação.\n\n"
                "Confirma o cadastro com a correção informada? Responda *sim* para confirmar:"
            )
            fluxo["dados_rf"] = dados_rf
            fluxo["etapa"] = "confirmando_cadastro_com_correcao"
            _set_fluxo(conversa_id, fluxo)
        return

    # --- ETAPA: confirmando_cadastro_com_correcao ---
    if etapa == "confirmando_cadastro_com_correcao":
        t = texto.strip().lower()
        dados_rf = fluxo.get("dados_rf", {})
        cnpj = fluxo.get("cnpj", "")

        if t in ("sim", "s", "confirmar", "confirmo", "ok"):
            nome_fantasia = dados_rf.get("nome_fantasia") or None
            emp_insert = supabase.table("empresas").insert({
                "nome": dados_rf.get("nome"),
                "nome_fantasia": nome_fantasia,
                "cnpj": cnpj,
                "email": dados_rf.get("email") or None,
                "telefone": dados_rf.get("telefone") or None,
                "endereco": dados_rf.get("endereco") or None,
                "setor": dados_rf.get("setor") or None,
                "porte": dados_rf.get("porte") or None,
                "ativa": True,
            }).execute()
            empresa_id = emp_insert.data[0]["id"]
            empresa_nome = dados_rf.get("nome", "")
            nome_exibicao = nome_fantasia or empresa_nome

            await _enviar(
                instance_name, token, phone,
                f"✅ *Cadastro realizado com sucesso!*\n\n"
                f"🏢 *{nome_exibicao}* agora está na nossa base.\n\n"
                "Deseja divulgar uma vaga agora? Responda *sim* ou *não*."
            )
            _set_fluxo(conversa_id, {
                "etapa": "aguardando_criar_vaga",
                "cnpj": cnpj,
                "empresa_id": empresa_id,
                "empresa_nome": empresa_nome,
                "empresa_nome_exibicao": nome_exibicao,
            })
        else:
            await _enviar(instance_name, token, phone,
                          "Entendido. Se precisar de ajuda, pode entrar em contato novamente. 👋")
            _set_fluxo(conversa_id, {})
        return

    # --- ETAPA: aguardando_criar_vaga ---
    if etapa == "aguardando_criar_vaga":
        t = texto.strip().lower()
        empresa_id = fluxo.get("empresa_id")
        empresa_nome = fluxo.get("empresa_nome", "")
        nome_exibicao = fluxo.get("empresa_nome_exibicao") or empresa_nome

        if t in ("sim", "s", "quero", "vou", "yes", "ok", "1"):
            unidade_param = f"&unidade_cuca={quote(unidade_cuca)}" if unidade_cuca else ""
            link_vaga = f"{PORTAL_URL}/empregabilidade/vagas/nova?empresa_id={empresa_id}{unidade_param}"
            await _enviar(
                instance_name, token, phone,
                f"Ótimo! 🎯 Acesse o link abaixo para preencher os dados da vaga:\n\n"
                f"🔗 {link_vaga}\n\n"
                "Após o preenchimento, você receberá aqui o *número da vaga* e a confirmação. "
                "A vaga será revisada pela equipe do CUCA antes de ser publicada."
            )
            _set_fluxo(conversa_id, {
                "etapa": "aguardando_retorno_vaga",
                "empresa_id": empresa_id,
                "empresa_nome": empresa_nome,
                "empresa_nome_exibicao": nome_exibicao,
                "cnpj": fluxo.get("cnpj"),
            })
        else:
            await _enviar(
                instance_name, token, phone,
                "Sem problema! O que deseja fazer?\n\n"
                "1️⃣ Cadastrar nova vaga\n"
                "2️⃣ Consultar status de uma vaga\n"
                "3️⃣ Editar uma vaga\n"
                "4️⃣ Cancelar uma vaga\n\n"
                "Responda com *1*, *2*, *3* ou *4*."
            )
            _set_fluxo(conversa_id, {
                "perfil": "empresa",
                "etapa": "menu_empresa_acoes",
                "cnpj": fluxo.get("cnpj"),
                "empresa_id": empresa_id,
                "empresa_nome": empresa_nome,
                "empresa_nome_exibicao": nome_exibicao,
            })
        return

    # --- ETAPA: aguardando_retorno_vaga (após link enviado) ---
    if etapa == "aguardando_retorno_vaga":
        # Verificar se o portal já notificou que a vaga foi criada
        fluxo_atual = _get_fluxo(conversa_id)
        vaga_criada_id = fluxo_atual.get("vaga_criada_id")
        vaga_numero = fluxo_atual.get("vaga_numero")
        vaga_titulo = fluxo_atual.get("vaga_titulo", "")
        empresa_id = fluxo_atual.get("empresa_id")
        empresa_nome_exibicao = fluxo_atual.get("empresa_nome_exibicao") or fluxo_atual.get("empresa_nome", "")

        if vaga_criada_id:
            numero_ref = f"#{vaga_numero}" if vaga_numero else f"...{vaga_criada_id[-6:].upper()}"
            await _enviar(
                instance_name, token, phone,
                f"✅ *Vaga cadastrada com sucesso!*\n\n"
                f"📋 *Título:* {vaga_titulo}\n"
                f"🔢 *Número da vaga:* {numero_ref}\n\n"
                "Guarde esse número para acompanhar as candidaturas aqui no WhatsApp.\n\n"
                "O que deseja fazer agora?\n\n"
                "1️⃣ Divulgar outra vaga\n"
                "2️⃣ Acompanhar candidatos desta vaga\n"
                "3️⃣ Encerrar\n\n"
                "Responda com *1*, *2* ou *3*."
            )
            _set_fluxo(conversa_id, {
                "etapa": "menu_pos_vaga",
                "empresa_id": empresa_id,
                "empresa_nome": fluxo_atual.get("empresa_nome", ""),
                "empresa_nome_exibicao": empresa_nome_exibicao,
                "cnpj": fluxo_atual.get("cnpj"),
                "ultima_vaga_id": vaga_criada_id,
            })
        else:
            # Formulário ainda não preenchido — reenviar link como lembrete
            empresa_id = fluxo.get("empresa_id")
            unidade_param = f"&unidade_cuca={quote(unidade_cuca)}" if unidade_cuca else ""
            link_vaga = f"{PORTAL_URL}/empregabilidade/vagas/nova?empresa_id={empresa_id}{unidade_param}"
            await _enviar(
                instance_name, token, phone,
                "Ainda aguardando o preenchimento do formulário de vaga. 🕐\n\n"
                f"Caso precise do link novamente:\n🔗 {link_vaga}\n\n"
                "Se precisar de ajuda, entre em contato com a equipe da unidade. 🤝"
            )
        return

    # --- ETAPA: menu_pos_vaga (redireciona para menu_empresa_acoes) ---
    if etapa == "menu_pos_vaga":
        fluxo["etapa"] = "menu_empresa_acoes"
        _set_fluxo(conversa_id, fluxo)
        await _processar_empresa(texto, phone, instance_name, token, lead_id, conversa_id, unidade_cuca)
        return

    # --- ETAPA: consulta_empresa ---
    if etapa in ("consulta_empresa", "empresa_ativa"):
        await _processar_consulta_empresa(texto, phone, instance_name, token, fluxo, conversa_id)
        return

    # Fallback — iniciar fluxo empresa
    _set_fluxo(conversa_id, {"etapa": "solicitar_cnpj"})
    await _processar_empresa(texto, phone, instance_name, token, lead_id, conversa_id, unidade_cuca)


# ---------------------------------------------------------------------------
# Helper: lista vagas da empresa para edição ou cancelamento
# ---------------------------------------------------------------------------

async def _listar_vagas_para_acao(
    empresa_id: str,
    instance_name: str,
    token: str,
    phone: str,
    acao: str,
    conversa_id: str,
    fluxo: dict,
):
    """Lista vagas disponíveis para edição ou cancelamento e aguarda escolha."""
    if acao == "edicao":
        status_excluidos = ["cancelada", "preenchida"]
        verbo = "editar"
        instrucao = "Informe o *número* da vaga que deseja editar:"
    else:
        status_excluidos = ["cancelada"]
        verbo = "cancelar"
        instrucao = "Informe o *número* da vaga que deseja cancelar:"

    vagas_res = supabase.table("vagas").select(
        "id, titulo, status, numero_vaga"
    ).eq("empresa_id", empresa_id).not_.in_("status", status_excluidos).order("numero_vaga", desc=False).limit(10).execute()

    vagas = vagas_res.data or []
    if not vagas:
        msg_vazia = (
            "Não há vagas disponíveis para edição no momento."
            if acao == "edicao"
            else "Não há vagas ativas para cancelar."
        )
        await _enviar(instance_name, token, phone, msg_vazia)
        return

    linhas = [f"📋 *Vagas disponíveis para {verbo}:*\n"]
    for v in vagas:
        numero_ref = f"#{v['numero_vaga']}" if v.get("numero_vaga") else f"...{v['id'][-6:].upper()}"
        linhas.append(f"• {numero_ref} *{v['titulo']}* — {v['status']}")
    linhas.append(f"\n{instrucao}")

    await _enviar(instance_name, token, phone, "\n".join(linhas))


# ---------------------------------------------------------------------------
# Consulta de vagas pela empresa
# ---------------------------------------------------------------------------

async def _processar_consulta_empresa(
    texto: str,
    phone: str,
    instance_name: str,
    token: str,
    fluxo: dict,
    conversa_id: str,
):
    t = texto.strip().lower()
    empresa_id = fluxo.get("empresa_id")

    # Encerrar se pedido
    if _quer_encerrar(texto):
        await _encerrar_fluxo(conversa_id, instance_name, token, phone, "empresa")
        return

    # Buscar pelo número da vaga sequencial ou ref UUID
    match_vaga = re.search(r"\b(\d{1,4})\b", texto)
    if match_vaga and empresa_id:
        num = match_vaga.group(1)
        vagas_res = supabase.table("vagas").select(
            "id, titulo, status, total_vagas, numero_vaga, created_at"
        ).eq("empresa_id", empresa_id).execute()

        vaga_match = None
        for v in (vagas_res.data or []):
            if str(v.get("numero_vaga", "")) == num or v["id"][-6:].upper() in texto.upper():
                vaga_match = v
                break

        if vaga_match:
            cands = supabase.table("candidaturas").select("status", count="exact").eq("vaga_id", vaga_match["id"]).execute()
            total_cands = cands.count or 0
            numero_ref = f"#{vaga_match['numero_vaga']}" if vaga_match.get("numero_vaga") else f"...{vaga_match['id'][-6:].upper()}"
            await _enviar(
                instance_name, token, phone,
                f"📋 *Vaga {numero_ref}:* {vaga_match['titulo']}\n"
                f"📌 *Status:* {vaga_match['status']}\n"
                f"👥 *Candidatos:* {total_cands}\n\n"
                "Deseja ver outra vaga, criar uma nova ou encerrar?"
            )
        else:
            await _enviar(instance_name, token, phone,
                          "Não encontrei essa vaga. Informe o número da vaga ou *todas* para listar.")
        return

    # Listar todas as vagas da empresa
    if empresa_id:
        vagas_res = supabase.table("vagas").select(
            "id, titulo, status, total_vagas, numero_vaga"
        ).eq("empresa_id", empresa_id).order("numero_vaga", desc=False).limit(10).execute()
        vagas = vagas_res.data or []

        if not vagas:
            await _enviar(instance_name, token, phone,
                          "Sua empresa ainda não tem vagas cadastradas. Deseja criar uma? Responda *sim*.")
            _set_fluxo(conversa_id, {**fluxo, "etapa": "aguardando_criar_vaga"})
            return

        linhas = ["📋 *Suas vagas cadastradas:*\n"]
        for v in vagas:
            cands = supabase.table("candidaturas").select("id", count="exact").eq("vaga_id", v["id"]).execute()
            numero_ref = f"#{v['numero_vaga']}" if v.get("numero_vaga") else f"...{v['id'][-6:].upper()}"
            linhas.append(
                f"• {numero_ref} *{v['titulo']}* — {v['status']} ({cands.count or 0} candidatos)"
            )
        linhas.append("\nInforme o *número* da vaga para ver detalhes, ou diga *encerrar*.")
        await _enviar(instance_name, token, phone, "\n".join(linhas))
    else:
        await _enviar(instance_name, token, phone,
                      "Para consultar suas vagas, informe o *CNPJ* da empresa:")
        _set_fluxo(conversa_id, {"etapa": "aguardando_cnpj"})


# ---------------------------------------------------------------------------
# Fluxo de CANDIDATO ATIVO
# ---------------------------------------------------------------------------

async def _processar_candidato(
    texto: str,
    phone: str,
    instance_name: str,
    token: str,
    lead_id: str,
    conversa_id: str,
):
    fluxo = _get_fluxo(conversa_id)
    etapa = fluxo.get("etapa", "solicitar_identificacao")

    # Encerramento
    if _quer_encerrar(texto) and etapa != "aguardando_id_candidato":
        await _encerrar_fluxo(conversa_id, instance_name, token, phone, "candidato")
        return

    if etapa == "solicitar_identificacao":
        await _enviar(
            instance_name, token, phone,
            "Para consultar sua candidatura, informe:\n\n"
            "• O *número da candidatura* recebido (6 caracteres, ex: AB12CD)\n"
            "• Seu *nome completo*\n"
            "• Ou o *telefone* cadastrado no momento da inscrição"
        )
        _set_fluxo(conversa_id, {"etapa": "aguardando_id_candidato"})
        return

    if etapa == "aguardando_id_candidato":
        apenas_digitos = re.sub(r"\D", "", texto)
        texto_limpo = texto.strip()

        candidaturas_encontradas = []

        # Busca por CPF (histórico)
        if len(apenas_digitos) == 11:
            cand_pessoa = supabase.table("candidatos").select("id").eq("cpf", apenas_digitos).execute()
            ids_candidatos = [c["id"] for c in (cand_pessoa.data or [])]
            if ids_candidatos:
                cand_res = supabase.table("candidaturas").select(
                    "id, status, vaga_id, created_at, observacoes"
                ).in_("candidato_id", ids_candidatos).order("created_at", desc=True).limit(5).execute()
                candidaturas_encontradas = cand_res.data or []

        # Busca por número de candidatura (6+ chars alfanuméricos)
        elif re.match(r"^[A-Za-z0-9]{6}$", texto_limpo):
            ref = texto_limpo.upper()
            todas = supabase.table("candidaturas").select(
                "id, status, vaga_id, created_at, observacoes"
            ).order("created_at", desc=True).limit(500).execute()
            candidaturas_encontradas = [
                c for c in (todas.data or [])
                if c["id"].replace("-", "")[-6:].upper() == ref
            ]

        # Busca por telefone (10-11 dígitos)
        elif len(apenas_digitos) in (10, 11):
            cand_res = supabase.table("candidaturas").select(
                "id, status, vaga_id, created_at, observacoes"
            ).eq("telefone", apenas_digitos).order("created_at", desc=True).limit(5).execute()
            candidaturas_encontradas = cand_res.data or []

        # Busca por nome (texto com espaço, 5+ chars)
        elif len(texto_limpo) >= 5 and " " in texto_limpo:
            cand_res = supabase.table("candidaturas").select(
                "id, status, vaga_id, created_at, observacoes, nome"
            ).ilike("nome", f"%{texto_limpo}%").order("created_at", desc=True).limit(5).execute()
            candidaturas_encontradas = cand_res.data or []

        if not candidaturas_encontradas:
            await _enviar(
                instance_name, token, phone,
                "Não encontrei candidatura com esse dado. 🔍\n\n"
                "Você pode tentar com:\n"
                "• *Número da candidatura* (6 caracteres, ex: AB12CD)\n"
                "• *Nome completo*\n"
                "• *Telefone* cadastrado\n\n"
                "Ou entre em contato diretamente com a unidade CUCA."
            )
            return

        linhas = ["📋 *Candidatura(s) encontrada(s):*\n"]
        for c in candidaturas_encontradas[:5]:
            vaga_res = supabase.table("vagas").select("titulo").eq("id", c["vaga_id"]).single().execute()
            titulo_vaga = (vaga_res.data or {}).get("titulo", "Vaga") if vaga_res.data else "Vaga"
            obs = c.get("observacoes") or ""
            if "banco_talentos" in obs:
                status_emoji = "⏳"
                status_label = "Em banco de talentos — aguardando oportunidade compatível"
            else:
                status_map = {
                    "pendente": ("⏳", "Pendente — em análise"),
                    "selecionado": ("✅", "Selecionado"),
                    "rejeitado": ("❌", "Não selecionado"),
                    "contratado": ("🎉", "Contratado"),
                }
                status_emoji, status_label = status_map.get(c.get("status", "pendente"), ("⏳", "Pendente"))
            linhas.append(
                f"{status_emoji} *{titulo_vaga}*\n"
                f"   Status: {status_label}\n"
                f"   Ref: {c['id'].replace('-','')[-6:].upper()}"
            )
        await _enviar(instance_name, token, phone, "\n".join(linhas))
        await _enviar(
            instance_name, token, phone,
            "Deseja consultar outra candidatura ou encerrar?\n\n"
            "Responda com *outro* para nova consulta ou *encerrar* para finalizar."
        )
        _set_fluxo(conversa_id, {"etapa": "candidato_consultado", "perfil": "candidato"})
        return

    # Estado consultado — oferecer nova consulta ou encerrar
    if etapa == "candidato_consultado":
        t = texto.strip().lower()
        if any(p in t for p in ("outro", "outra", "mais", "nova consulta", "consultar")):
            await _enviar(
                instance_name, token, phone,
                "Informe o número da candidatura, nome completo ou telefone cadastrado:"
            )
            _set_fluxo(conversa_id, {"etapa": "aguardando_id_candidato", "perfil": "candidato"})
        else:
            await _encerrar_fluxo(conversa_id, instance_name, token, phone, "candidato")
        return

    # Fallback
    _set_fluxo(conversa_id, {"perfil": "candidato", "etapa": "solicitar_identificacao"})
    await _processar_candidato(texto, phone, instance_name, token, lead_id, conversa_id)


# ---------------------------------------------------------------------------
# Fluxo de GRANDE PÚBLICO
# ---------------------------------------------------------------------------

_INTENCAO_BANCO_TALENTOS = {
    "nenhuma dessas", "nenhuma", "não encontrei", "nao encontrei",
    "guardar meu currículo", "guardar curriculo", "banco de talentos",
    "deixar currículo", "deixar curriculo", "quero me cadastrar",
    "não tem nada", "nao tem nada",
}


async def _processar_publico(
    texto: str,
    phone: str,
    instance_name: str,
    token: str,
    lead_id: str,
    conversa_id: str,
    unidade_cuca: str,
):
    fluxo = _get_fluxo(conversa_id)
    etapa = fluxo.get("etapa", "inicio")
    t_lower = texto.strip().lower()

    # Encerramento
    if _quer_encerrar(texto) and etapa not in ("coletando_nome_candidato", "confirmando_terceiro"):
        await _encerrar_fluxo(conversa_id, instance_name, token, phone, "publico")
        return

    # --- ETAPA: aguardando_confirmacao_candidatura ---
    # Verifica se o portal já registrou a candidatura e envia o número
    if etapa == "aguardando_confirmacao_candidatura":
        fluxo_atual = _get_fluxo(conversa_id)
        candidatura_id = fluxo_atual.get("candidatura_criada_id")
        candidatura_codigo = fluxo_atual.get("candidatura_codigo")

        if candidatura_id:
            codigo = candidatura_codigo or candidatura_id.replace("-", "")[-6:].upper()
            await _enviar(
                instance_name, token, phone,
                f"🎉 *Candidatura recebida com sucesso!*\n\n"
                f"🔢 *Número de acompanhamento:* *{codigo}*\n\n"
                "Guarde esse número! Com ele você pode retornar aqui a qualquer momento "
                "para verificar o status da sua candidatura.\n\n"
                "Nossa equipe fará a triagem e você será notificado pelo WhatsApp. ✅\n\n"
                "Deseja se candidatar a outra vaga ou encerrar?\n"
                "Responda *outra* para ver mais vagas ou *encerrar*."
            )
            _set_fluxo(conversa_id, {
                "etapa": "candidatura_confirmada",
                "perfil": "publico",
                "ultima_candidatura_codigo": codigo,
            })
        else:
            # Ainda aguardando — link reenviado se necessário
            link_reenviado = fluxo_atual.get("link_candidatura", "")
            await _enviar(
                instance_name, token, phone,
                "Ainda aguardando o envio do seu currículo. 🕐\n\n"
                f"{'Acesse o link para preencher: 🔗 ' + link_reenviado if link_reenviado else ''}\n\n"
                "Após o envio, você receberá aqui o número de acompanhamento."
            )
        return

    # --- ETAPA: candidatura_confirmada ---
    if etapa == "candidatura_confirmada":
        if any(p in t_lower for p in ("outra", "mais", "ver vagas", "outras vagas")):
            _set_fluxo(conversa_id, {"perfil": "publico", "etapa": "inicio"})
            await _processar_publico(texto, phone, instance_name, token, lead_id, conversa_id, unidade_cuca)
        else:
            await _encerrar_fluxo(conversa_id, instance_name, token, phone, "publico")
        return

    # --- ETAPA: coletando_nome_candidato ---
    if etapa == "coletando_nome_candidato":
        nome_coletado = texto.strip()
        vaga_id_ref = fluxo.get("vaga_id_selecionada")
        eh_banco_talentos = fluxo.get("banco_talentos", False)

        await _enviar(
            instance_name, token, phone,
            f"Obrigado, *{nome_coletado}*!\n\n"
            "Esse currículo é para *você mesmo(a)* ou para outra pessoa?\n\n"
            "Responda *eu* ou *outra pessoa*."
        )
        _set_fluxo(conversa_id, {
            **fluxo,
            "etapa": "confirmando_terceiro",
            "nome_candidato": nome_coletado,
            "vaga_id_selecionada": vaga_id_ref,
            "banco_talentos": eh_banco_talentos,
        })
        return

    # --- ETAPA: confirmando_terceiro ---
    if etapa == "confirmando_terceiro":
        nome_candidato = fluxo.get("nome_candidato", "")
        vaga_id_ref = fluxo.get("vaga_id_selecionada")
        eh_banco_talentos = fluxo.get("banco_talentos", False)

        if any(p in t_lower for p in ("outra", "outro", "outra pessoa", "amigo", "familiar", "parente", "não")):
            await _enviar(
                instance_name, token, phone,
                "Tudo certo! Informe o *nome completo* da pessoa para quem você está enviando o currículo:"
            )
            _set_fluxo(conversa_id, {
                **fluxo,
                "etapa": "coletando_nome_terceiro",
                "vaga_id_selecionada": vaga_id_ref,
                "banco_talentos": eh_banco_talentos,
            })
            return

        # É para si mesmo — enviar link
        await _enviar_link_candidatura(
            instance_name, token, phone, conversa_id, fluxo,
            nome_candidato, phone, vaga_id_ref, eh_banco_talentos
        )
        return

    # --- ETAPA: coletando_nome_terceiro ---
    if etapa == "coletando_nome_terceiro":
        nome_terceiro = texto.strip()
        vaga_id_ref = fluxo.get("vaga_id_selecionada")
        eh_banco_talentos = fluxo.get("banco_talentos", False)

        await _enviar_link_candidatura(
            instance_name, token, phone, conversa_id, fluxo,
            nome_terceiro, phone, vaga_id_ref, eh_banco_talentos
        )
        return

    # Buscar vagas abertas da unidade
    vagas_res = supabase.table("vagas").select(
        "id, titulo, tipo_contrato, salario, escolaridade_minima, total_vagas, faixa_etaria"
    ).eq("status", "aberta").eq("unidade_cuca", unidade_cuca).order("created_at", desc=True).limit(8).execute()
    vagas = vagas_res.data or []

    # Intenção de banco de talentos
    if any(p in t_lower for p in _INTENCAO_BANCO_TALENTOS):
        await _enviar(
            instance_name, token, phone,
            "📁 *Banco de Talentos CUCA*\n\n"
            "Podemos cadastrar seu currículo no banco de talentos. "
            "Quando surgir uma vaga compatível com seu perfil, a equipe entrará em contato.\n\n"
            "Para continuar, preciso do seu *nome completo*:"
        )
        _set_fluxo(conversa_id, {
            "perfil": "publico",
            "etapa": "coletando_nome_candidato",
            "banco_talentos": True,
        })
        return

    # Verificar se quer se candidatar a vaga específica (por código ou "quero essa")
    match_codigo = re.search(r"\b([A-Za-z0-9]{6})\b", texto)
    match_num_seq = re.search(r"\b(\d{1,4})\b", texto)
    vaga_id_ref = None

    if match_codigo and etapa == "listou_vagas":
        ref = match_codigo.group(1).upper()
        for v in vagas:
            if v["id"][-6:].upper() == ref:
                vaga_id_ref = v["id"]
                break

    if not vaga_id_ref and (etapa == "listou_vagas") and ("quero essa" in t_lower or "candidatar" in t_lower):
        vaga_id_ref = fluxo.get("ultima_vaga_id")

    if vaga_id_ref:
        await _enviar(
            instance_name, token, phone,
            "Para finalizar sua candidatura, preciso do seu *nome completo*:"
        )
        _set_fluxo(conversa_id, {
            "perfil": "publico",
            "etapa": "coletando_nome_candidato",
            "vaga_id_selecionada": vaga_id_ref,
            "banco_talentos": False,
        })
        return

    if not vagas:
        await _enviar(
            instance_name, token, phone,
            "No momento não há vagas abertas nesta unidade.\n"
            "Posso cadastrar seu currículo no banco de talentos para oportunidades futuras.\n\n"
            "Deseja? Responda *sim* ou *não*."
        )
        _set_fluxo(conversa_id, {"perfil": "publico", "etapa": "oferta_banco_talentos"})
        return

    linhas = ["💼 *Vagas abertas no CUCA:*\n"]
    ultima_vaga_id = None
    for v in vagas:
        salario = f" | 💰 R$ {v['salario']}" if v.get("salario") else ""
        contrato = f" | 📄 {v['tipo_contrato']}" if v.get("tipo_contrato") else ""
        escolaridade = f" | 🎓 {v['escolaridade_minima']}" if v.get("escolaridade_minima") else ""
        linhas.append(
            f"• *{v['titulo']}*{contrato}{salario}{escolaridade}\n"
            f"  Para se candidatar: informe o código *{v['id'][-6:].upper()}*"
        )
        ultima_vaga_id = v["id"]

    linhas.append(
        "\nInforme o *código* da vaga para se candidatar, "
        "ou diga *nenhuma dessas* para entrar no banco de talentos."
    )
    await _enviar(instance_name, token, phone, "\n".join(linhas))
    _set_fluxo(conversa_id, {"perfil": "publico", "etapa": "listou_vagas", "ultima_vaga_id": ultima_vaga_id})


async def _enviar_link_candidatura(
    instance_name: str,
    token: str,
    phone: str,
    conversa_id: str,
    fluxo: dict,
    nome_candidato: str,
    telefone_origem: str,
    vaga_id: str | None,
    banco_talentos: bool,
):
    """Monta e envia o link de candidatura com nome e telefone pré-preenchidos."""
    import urllib.parse
    params = {
        "nome": nome_candidato,
        "origem_tel": re.sub(r"\D", "", telefone_origem),
        "conversa_id": conversa_id,
    }
    if vaga_id:
        params["vaga_id"] = vaga_id
    if banco_talentos:
        params["banco_talentos"] = "1"

    query = urllib.parse.urlencode(params)
    link = f"{PORTAL_URL}/empregabilidade/candidatura?{query}"

    await _enviar(
        instance_name, token, phone,
        f"Ótimo! 🎯 Acesse o link abaixo para enviar o currículo de *{nome_candidato}*:\n\n"
        f"🔗 {link}\n\n"
        "Após o envio, você receberá aqui o *número de acompanhamento* da candidatura. ✅"
    )
    _set_fluxo(conversa_id, {
        "perfil": "publico",
        "etapa": "aguardando_confirmacao_candidatura",
        "nome_candidato": nome_candidato,
        "link_candidatura": link,
        "vaga_id_selecionada": vaga_id,
    })


# ---------------------------------------------------------------------------
# Ponto de entrada principal
# ---------------------------------------------------------------------------

_ETAPAS_EMPRESA = {
    "solicitar_cnpj", "aguardando_cnpj", "confirmando_cadastro",
    "confirmando_cadastro_com_correcao", "aguardando_criar_vaga",
    "aguardando_retorno_vaga", "consulta_empresa", "empresa_ativa",
    "menu_empresa_retomada", "menu_pos_vaga", "menu_empresa_acoes",
    "selecionando_vaga_edicao", "aguardando_retorno_edicao",
    "selecionando_vaga_cancelamento", "confirmando_cancelamento",
}
_ETAPAS_CANDIDATO = {
    "solicitar_identificacao", "aguardando_id_candidato", "candidato_consultado",
}
_ETAPAS_PUBLICO = {
    "inicio", "listou_vagas", "candidatura_enviada",
    "coletando_nome_candidato", "confirmando_terceiro", "coletando_nome_terceiro",
    "aguardando_confirmacao_candidatura", "candidatura_confirmada",
    "oferta_banco_talentos",
}


async def processar_mensagem_empregabilidade(
    texto: str,
    phone: str,
    instance_name: str,
    token: str,
    lead_id: str,
    conversa_id: str,
    unidade_cuca: str,
):
    """
    Entry point chamado pelo main.py quando agente_tipo = 'Empregabilidade'.
    Identifica o perfil e roteia para o fluxo correto.
    """
    fluxo = _get_fluxo(conversa_id)
    perfil_atual = fluxo.get("perfil")
    etapa_atual = fluxo.get("etapa", "")

    # Rotear pelo perfil salvo OU pela etapa (evita loop quando _set_fluxo não preservou perfil)
    if perfil_atual == "empresa" or etapa_atual in _ETAPAS_EMPRESA:
        await _processar_empresa(texto, phone, instance_name, token, lead_id, conversa_id, unidade_cuca)
        return
    if perfil_atual == "candidato" or etapa_atual in _ETAPAS_CANDIDATO:
        await _processar_candidato(texto, phone, instance_name, token, lead_id, conversa_id)
        return
    if perfil_atual == "publico" or etapa_atual in _ETAPAS_PUBLICO:
        await _processar_publico(texto, phone, instance_name, token, lead_id, conversa_id, unidade_cuca)
        return

    # Retomada de empresa sem etapa ativa mas com empresa_id salvo
    empresa_id_salvo = fluxo.get("empresa_id")
    if empresa_id_salvo:
        await _processar_empresa(texto, phone, instance_name, token, lead_id, conversa_id, unidade_cuca)
        return

    # Usuário respondeu ao menu inicial com número ou palavra-chave
    if etapa_atual == "menu_inicial":
        t = texto.strip().lower()
        if t in ("1", "empresa", "divulgar", "divulgar vaga", "quero divulgar"):
            _set_fluxo(conversa_id, {"perfil": "empresa", "etapa": "solicitar_cnpj"})
            await _processar_empresa(texto, phone, instance_name, token, lead_id, conversa_id, unidade_cuca)
            return
        if t in ("2", "candidato", "candidatura", "minha candidatura", "acompanhar"):
            _set_fluxo(conversa_id, {"perfil": "candidato", "etapa": "solicitar_identificacao"})
            await _processar_candidato(texto, phone, instance_name, token, lead_id, conversa_id)
            return
        if t in ("3", "vagas", "vaga", "ver vagas", "vagas abertas", "quero trabalhar", "emprego"):
            _set_fluxo(conversa_id, {"perfil": "publico", "etapa": "inicio"})
            await _processar_publico(texto, phone, instance_name, token, lead_id, conversa_id, unidade_cuca)
            return
        await _enviar(
            instance_name, token, phone,
            "Não entendi sua resposta. Por favor, escolha uma das opções:\n\n"
            "1️⃣ *Empresa* — Quero divulgar uma vaga\n"
            "2️⃣ *Candidato* — Quero acompanhar minha candidatura\n"
            "3️⃣ *Vagas* — Quero ver vagas abertas\n\n"
            "Digite *1*, *2* ou *3*."
        )
        return

    # Primeira interação ou perfil indefinido — identificar pelo conteúdo da mensagem
    perfil = _identificar_perfil(texto, fluxo)

    if perfil == "empresa":
        _set_fluxo(conversa_id, {"perfil": "empresa", "etapa": "solicitar_cnpj"})
        await _processar_empresa(texto, phone, instance_name, token, lead_id, conversa_id, unidade_cuca)
    elif perfil == "candidato":
        _set_fluxo(conversa_id, {"perfil": "candidato", "etapa": "solicitar_identificacao"})
        await _processar_candidato(texto, phone, instance_name, token, lead_id, conversa_id)
    elif perfil == "publico":
        _set_fluxo(conversa_id, {"perfil": "publico", "etapa": "inicio"})
        await _processar_publico(texto, phone, instance_name, token, lead_id, conversa_id, unidade_cuca)
    else:
        await _enviar(
            instance_name, token, phone,
            "👋 Olá! Sou o assistente de empregabilidade do CUCA.\n\n"
            "Como posso te ajudar?\n\n"
            "1️⃣ *Empresa* — Quero divulgar uma vaga\n"
            "2️⃣ *Candidato* — Quero acompanhar minha candidatura\n"
            "3️⃣ *Vagas* — Quero ver vagas abertas\n\n"
            "Responda com o número ou descreva o que precisa."
        )
        _set_fluxo(conversa_id, {"etapa": "menu_inicial"})


# ---------------------------------------------------------------------------
# Loop proativo: detecta vagas criadas e notifica empresa via WhatsApp
# ---------------------------------------------------------------------------

async def empregabilidade_notify_loop():
    """
    Roda em background a cada 20s.
    Detecta conversas em aguardando_retorno_vaga com vaga_criada_id já preenchido
    pelo portal e envia a confirmação via WhatsApp sem esperar nova mensagem.
    """
    import asyncio

    logger.info("[empreg-notify] Loop de notificação de vagas iniciado.")
    while True:
        try:
            res = supabase.table("conversas").select(
                "id, metadata, instancia_uazapi"
            ).eq("agente_tipo", "Empregabilidade").in_("status", ["ativa", "aberta"]).execute()

            conversas = res.data or []
            for c in conversas:
                metadata = c.get("metadata") or {}
                fluxo = metadata.get("empreg_fluxo", {})
                etapa_c = fluxo.get("etapa", "")

                # Só processa etapas que esperam retorno do portal
                if etapa_c not in ("aguardando_retorno_vaga", "aguardando_retorno_edicao"):
                    continue

                # Buscar dados da conversa e instância para envio
                conversa_id = c["id"]
                instance_name = c.get("instancia_uazapi", "")
                inst_res = supabase.table("instancias_uazapi").select(
                    "token, unidade_cuca"
                ).eq("nome", instance_name).single().execute()
                inst = inst_res.data or {}
                token = inst.get("token", "")
                unidade_cuca = inst.get("unidade_cuca", "")

                lead_res = supabase.table("conversas").select(
                    "lead_id"
                ).eq("id", conversa_id).single().execute()
                lead_id = (lead_res.data or {}).get("lead_id", "")

                lead_phone_res = supabase.table("leads").select(
                    "telefone"
                ).eq("id", lead_id).single().execute()
                phone = (lead_phone_res.data or {}).get("telefone", "")

                if not phone or not token or not instance_name:
                    continue

                empresa_id = fluxo.get("empresa_id")
                empresa_nome = fluxo.get("empresa_nome_exibicao") or fluxo.get("empresa_nome", "")

                # --- Notificação de vaga criada ---
                if etapa_c == "aguardando_retorno_vaga":
                    vaga_criada_id = fluxo.get("vaga_criada_id")
                    if not vaga_criada_id:
                        continue
                    vaga_numero = fluxo.get("vaga_numero")
                    vaga_titulo = fluxo.get("vaga_titulo", "")
                    numero_ref = f"#{vaga_numero}" if vaga_numero else f"...{vaga_criada_id[-6:].upper()}"

                    await _enviar(
                        instance_name, token, phone,
                        f"✅ *Vaga cadastrada com sucesso!*\n\n"
                        f"📋 *Título:* {vaga_titulo}\n"
                        f"🔢 *Número da vaga:* {numero_ref}\n\n"
                        "Nossa equipe irá revisar e publicar a vaga em breve.\n\n"
                        "O que deseja fazer agora?\n"
                        "1️⃣ Cadastrar nova vaga\n"
                        "2️⃣ Consultar status de uma vaga\n"
                        "3️⃣ Editar uma vaga\n"
                        "4️⃣ Cancelar uma vaga\n\n"
                        "Responda com *1*, *2*, *3* ou *4*."
                    )
                    _set_fluxo(conversa_id, {
                        "perfil": "empresa",
                        "etapa": "menu_empresa_acoes",
                        "empresa_id": empresa_id,
                        "empresa_nome": fluxo.get("empresa_nome", ""),
                        "empresa_nome_exibicao": empresa_nome,
                        "cnpj": fluxo.get("cnpj"),
                        "ultima_vaga_id": vaga_criada_id,
                    })
                    logger.info(f"[empreg-notify] Notificação de criação enviada para conversa {conversa_id} — vaga {numero_ref}")

                # --- Notificação de edição confirmada ---
                elif etapa_c == "aguardando_retorno_edicao":
                    vaga_editada_id = fluxo.get("vaga_editada_id")
                    if not vaga_editada_id:
                        continue
                    vaga_titulo = fluxo.get("vaga_editada_titulo", "")
                    vaga_unidade = fluxo.get("vaga_editada_unidade", "")

                    await _enviar(
                        instance_name, token, phone,
                        f"✅ *Alterações recebidas com sucesso!*\n\n"
                        f"📋 *Vaga:* {vaga_titulo}\n\n"
                        f"A equipe CUCA {vaga_unidade or unidade_cuca} irá revisar as alterações antes de a vaga voltar a aceitar candidaturas.\n\n"
                        "O que deseja fazer agora?\n"
                        "1️⃣ Cadastrar nova vaga\n"
                        "2️⃣ Consultar status de uma vaga\n"
                        "3️⃣ Editar uma vaga\n"
                        "4️⃣ Cancelar uma vaga\n\n"
                        "Responda com *1*, *2*, *3* ou *4*."
                    )
                    _set_fluxo(conversa_id, {
                        "perfil": "empresa",
                        "etapa": "menu_empresa_acoes",
                        "empresa_id": empresa_id,
                        "empresa_nome": fluxo.get("empresa_nome", ""),
                        "empresa_nome_exibicao": empresa_nome,
                        "cnpj": fluxo.get("cnpj"),
                    })
                    logger.info(f"[empreg-notify] Confirmação de edição enviada para conversa {conversa_id} — vaga {vaga_editada_id}")

        except Exception as e:
            logger.error(f"[empreg-notify] Erro no loop: {e}")

        await asyncio.sleep(20)
