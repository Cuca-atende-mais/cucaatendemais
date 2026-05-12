"""
S29-S31 — Motor de Empregabilidade via WhatsApp
Instância unificada: atende empresa, candidato ativo e grande público no mesmo número.

Máquina de estados armazenada em conversas.metadata["empreg_fluxo"].
"""

import os
import re
import logging
import asyncio
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

def _montar_historico(conversa_id: str, limite: int = 6) -> str:
    """Busca últimas mensagens da conversa e formata como histórico legível."""
    try:
        res = (
            supabase.table("mensagens")
            .select("remetente, conteudo, created_at")
            .eq("conversa_id", conversa_id)
            .order("created_at", desc=True)
            .limit(limite)
            .execute()
        )
        msgs = list(reversed(res.data or []))
        if not msgs:
            return "(sem histórico disponível)"
        linhas = []
        for m in msgs:
            quem = "👤 Lead" if m["remetente"] == "lead" else "🤖 IA"
            conteudo = (m["conteudo"] or "")[:120]
            linhas.append(f"{quem}: {conteudo}")
        return "\n".join(linhas)
    except Exception:
        return "(erro ao carregar histórico)"


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
            logger.error(f"[_enviar] Falha ao gravar mensagem bot no DB: {_e}", exc_info=True)


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
    await _enviar(instance_name, token, phone, msg, conversa_id=conversa_id)
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

    async def e(msg: str):
        await _enviar(instance_name, token, phone, msg, conversa_id=conversa_id, lead_id=lead_id)

    # Encerramento em qualquer etapa pós-ação
    if _quer_encerrar(texto) and etapa not in ("aguardando_cnpj", "confirmando_cadastro", "confirmando_cadastro_com_correcao"):
        await _encerrar_fluxo(conversa_id, instance_name, token, phone, "empresa")
        return

    # --- RETOMADA: empresa já identificada voltando sem etapa ativa ---
    if etapa in ("", None) or etapa == "encerrado":
        empresa_id = fluxo.get("empresa_id")
        empresa_nome = fluxo.get("empresa_nome_exibicao") or fluxo.get("empresa_nome", "")
        if empresa_id and empresa_nome:
            await e(
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
        await e(
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
            # SQS-41: unidade escolhida no formulário web — vai direto coletar e-mail do responsável
            await e(
                "Ótimo! 🎯 Antes de gerar o link da vaga, preciso de algumas informações do *responsável pelo processo seletivo*.\n\n"
                "Qual é o *e-mail* para receber os currículos?\n"
                "(pode ser diferente do e-mail geral da empresa)"
            )
            _set_fluxo(conversa_id, {
                "perfil": "empresa",
                "etapa": "coletando_email_responsavel",
                "empresa_id": empresa_id,
                "empresa_nome": fluxo.get("empresa_nome", ""),
                "empresa_nome_exibicao": empresa_nome,
                "cnpj": fluxo.get("cnpj"),
            })
        elif t in ("2", "consultar", "status", "acompanhar", "vagas"):
            _set_fluxo(conversa_id, {**fluxo, "etapa": "consulta_empresa"})
            await _processar_consulta_empresa("todas", phone, instance_name, token, fluxo, conversa_id)
        elif t in ("3", "editar", "alterar", "modificar"):
            _set_fluxo(conversa_id, {**fluxo, "etapa": "selecionando_vaga_edicao"})
            await _listar_vagas_para_acao(empresa_id, instance_name, token, phone, "edicao", conversa_id, fluxo)
        elif t in ("4", "cancelar", "encerrar vaga", "remover vaga"):
            _set_fluxo(conversa_id, {**fluxo, "etapa": "selecionando_vaga_cancelamento"})
            await _listar_vagas_para_acao(empresa_id, instance_name, token, phone, "cancelamento", conversa_id, fluxo)
        else:
            await _encerrar_fluxo(conversa_id, instance_name, token, phone, "empresa")
        return

    # --- ETAPA: perguntando_unidade_vaga (DEPRECADO — SQS-41 moveu seleção para o formulário web) ---
    # Redireciona conversas já neste estado para o novo fluxo de coleta de e-mail
    if etapa == "perguntando_unidade_vaga":
        empresa_id = fluxo.get("empresa_id")
        empresa_nome = fluxo.get("empresa_nome_exibicao") or fluxo.get("empresa_nome", "")
        await e(
            "Ótimo! 🎯 Antes de gerar o link da vaga, preciso de algumas informações do *responsável pelo processo seletivo*.\n\n"
            "Qual é o *e-mail* para receber os currículos?\n"
            "(pode ser diferente do e-mail geral da empresa)"
        )
        _set_fluxo(conversa_id, {
            "perfil": "empresa",
            "etapa": "coletando_email_responsavel",
            "empresa_id": empresa_id,
            "empresa_nome": fluxo.get("empresa_nome", ""),
            "empresa_nome_exibicao": empresa_nome,
            "cnpj": fluxo.get("cnpj"),
        })
        return

    # --- ETAPA: selecionando_vaga_edicao ---
    if etapa == "selecionando_vaga_edicao":
        empresa_id = fluxo.get("empresa_id")
        match_num = re.search(r"\b(\d{1,4})\b", texto)
        if not match_num:
            await e("Por favor, informe o *número* da vaga que deseja editar (ex: 1, 2, 3...):")
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
            await e("Vaga não encontrada ou não disponível para edição. Informe outro número:")
            return
        if vaga_match["status"] == "preenchida":
            await e(f"A vaga *{vaga_match['titulo']}* já está preenchida e não pode ser editada.")
            return
        unidade_param = f"&empresa_id={empresa_id}"
        link_edicao = f"{PORTAL_URL}/empregabilidade/vagas/editar?vaga_id={vaga_match['id']}{unidade_param}"
        await e(
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
            await e(
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
            await e(
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
            await e("Por favor, informe o *número* da vaga que deseja cancelar (ex: 1, 2, 3...):")
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
            await e("Vaga não encontrada ou já cancelada. Informe outro número ou diga *encerrar*.")
            return
        data_criacao = vaga_match.get("created_at", "")[:10] if vaga_match.get("created_at") else ""
        await e(
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

            await e(
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
            await e(
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
        await e(
            "Olá! 👋 Sou o assistente de empregabilidade do CUCA.\n\n"
            "Para verificar seu cadastro, por favor informe o *CNPJ* da sua empresa (somente números):"
        )
        _set_fluxo(conversa_id, {"etapa": "aguardando_cnpj"})
        return

    # --- ETAPA: aguardando_cnpj ---
    if etapa == "aguardando_cnpj":
        cnpj_limpo = re.sub(r"\D", "", texto)
        if len(cnpj_limpo) != 14:
            await e("CNPJ inválido. Por favor, informe os *14 dígitos* do CNPJ da sua empresa:")
            return

        # Verificar no banco
        emp_res = supabase.table("empresas").select("id, nome, nome_fantasia").eq("cnpj", cnpj_limpo).execute()
        if emp_res.data:
            empresa = emp_res.data[0]
            nome_exibicao = empresa.get("nome_fantasia") or empresa["nome"]
            await e(
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
        await e("🔍 Consultando dados na Receita Federal, aguarde...")
        dados_rf = await _consultar_cnpj(cnpj_limpo)

        if not dados_rf:
            await e(
                "Não encontrei dados para esse CNPJ na Receita Federal. "
                "Verifique se digitou corretamente e tente novamente:"
            )
            return

        situacao = (dados_rf.get("situacao_cadastral") or {}).get("descricao", "").upper()
        if "ATIVA" not in situacao and situacao:
            await e(
                f"⚠️ O CNPJ informado está com situação *{situacao}* na Receita Federal.\n"
                "Não é possível cadastrar empresas inativas. Se houver erro, entre em contato com a unidade."
            )
            _set_fluxo(conversa_id, {})
            return

        msg_dados = _formatar_dados_cnpj(dados_rf)
        await e(
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

            await e(
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
            await e(
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

            await e(
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
            await e("Entendido. Se precisar de ajuda, pode entrar em contato novamente. 👋")
            _set_fluxo(conversa_id, {})
        return

    # --- ETAPA: aguardando_criar_vaga ---
    if etapa == "aguardando_criar_vaga":
        t = texto.strip().lower()
        empresa_id = fluxo.get("empresa_id")
        empresa_nome = fluxo.get("empresa_nome", "")
        nome_exibicao = fluxo.get("empresa_nome_exibicao") or empresa_nome

        if t in ("sim", "s", "quero", "vou", "yes", "ok", "1"):
            await e(
                "Ótimo! 🎯 Antes de gerar o link da vaga, preciso de algumas informações do *responsável pelo processo seletivo*.\n\n"
                "Qual é o *e-mail* para receber os currículos?\n"
                "(pode ser diferente do e-mail geral da empresa)"
            )
            _set_fluxo(conversa_id, {
                "etapa": "coletando_email_responsavel",
                "empresa_id": empresa_id,
                "empresa_nome": empresa_nome,
                "empresa_nome_exibicao": nome_exibicao,
                "cnpj": fluxo.get("cnpj"),
            })
        else:
            await e(
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

    # --- ETAPA: coletando_email_responsavel ---
    if etapa == "coletando_email_responsavel":
        email_candidato = texto.strip()
        # Validação básica de e-mail
        if "@" not in email_candidato or "." not in email_candidato.split("@")[-1]:
            await e(
                "⚠️ Esse e-mail não parece válido. Por favor, informe um e-mail no formato correto (ex: rh@empresa.com.br):"
            )
            return
        await e(
            f"Perfeito! E-mail registrado: *{email_candidato}*\n\n"
            "Agora informe o *telefone/WhatsApp do responsável* pela seleção:\n"
            "(com DDD, ex: 85999990000)"
        )
        _set_fluxo(conversa_id, {
            **fluxo,
            "etapa": "coletando_telefone_responsavel",
            "email_responsavel": email_candidato,
        })
        return

    # --- ETAPA: coletando_telefone_responsavel ---
    if etapa == "coletando_telefone_responsavel":
        tel_digits = re.sub(r"\D", "", texto.strip())
        if len(tel_digits) < 10:
            await e(
                "⚠️ Telefone inválido. Por favor, informe o número com DDD (ex: 85999990000):"
            )
            return
        empresa_id = fluxo.get("empresa_id")
        empresa_nome = fluxo.get("empresa_nome", "")
        nome_exibicao = fluxo.get("empresa_nome_exibicao") or empresa_nome
        email_responsavel = fluxo.get("email_responsavel", "")
        # SQS-49: antes de enviar o link, perguntar qual tipo de divulgação
        await e(
            f"✅ Dados registrados!\n\n"
            f"📧 E-mail: {email_responsavel}\n"
            f"📱 Telefone: {tel_digits}\n\n"
            "Como deseja divulgar?\n\n"
            "1️⃣ *Criar uma vaga* — Para uma vaga específica com requisitos detalhados\n"
            "2️⃣ *Marcar seleção* — Processo seletivo com vários cargos e data definida\n\n"
            "Responda com *1* ou *2*."
        )
        _set_fluxo(conversa_id, {
            "etapa": "escolhendo_tipo_vaga",
            "empresa_id": empresa_id,
            "empresa_nome": empresa_nome,
            "empresa_nome_exibicao": nome_exibicao,
            "cnpj": fluxo.get("cnpj"),
            "email_responsavel": email_responsavel,
            "telefone_responsavel": tel_digits,
            "perfil": "empresa",
        })
        return

    # --- ETAPA: escolhendo_tipo_vaga (SQS-49) ---
    if etapa == "escolhendo_tipo_vaga":
        t_tipo = texto.strip().lower()
        empresa_id = fluxo.get("empresa_id")
        email_responsavel = fluxo.get("email_responsavel", "")
        tel_digits = fluxo.get("telefone_responsavel", "")
        unidade_param = f"&unidade_cuca={quote(unidade_cuca)}" if unidade_cuca else ""
        email_param = f"&email_responsavel={quote(email_responsavel)}" if email_responsavel else ""
        tel_param = f"&telefone_responsavel={quote(tel_digits)}" if tel_digits else ""

        if t_tipo in ("1", "vaga", "criar", "criar vaga", "vaga normal"):
            link_vaga = f"{PORTAL_URL}/empregabilidade/vagas/nova?empresa_id={empresa_id}{unidade_param}{email_param}{tel_param}"
            await e(
                "Ótimo! 🎯 Acesse o link abaixo para preencher os dados completos da vaga:\n\n"
                f"🔗 {link_vaga}\n\n"
                "Após o preenchimento, você receberá aqui o *número da vaga* e a confirmação. "
                "A vaga será revisada pela equipe do CUCA antes de ser publicada."
            )
            _set_fluxo(conversa_id, {
                **fluxo,
                "etapa": "aguardando_retorno_vaga",
            })
        elif t_tipo in ("2", "selecao", "seleção", "marcar", "marcar selecao", "marcar seleção", "evento"):
            link_selecao = f"{PORTAL_URL}/empregabilidade/selecao/nova?empresa_id={empresa_id}{unidade_param}{email_param}{tel_param}"
            await e(
                "Ótimo! 📋 Acesse o link abaixo para registrar o processo seletivo:\n\n"
                f"🔗 {link_selecao}\n\n"
                "Você poderá informar as datas, horários e cargos disponíveis. "
                "Após o preenchimento, você receberá aqui a confirmação."
            )
            _set_fluxo(conversa_id, {
                **fluxo,
                "etapa": "aguardando_retorno_selecao",
            })
        else:
            await e(
                "Não entendi. Responda com *1* para criar uma vaga ou *2* para marcar seleção:"
            )
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
            await e(
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
            await e(
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

    async def e(msg: str):
        await _enviar(instance_name, token, phone, msg, conversa_id=conversa_id)

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
        await e(msg_vazia)
        return

    linhas = [f"📋 *Vagas disponíveis para {verbo}:*\n"]
    for v in vagas:
        numero_ref = f"#{v['numero_vaga']}" if v.get("numero_vaga") else f"...{v['id'][-6:].upper()}"
        linhas.append(f"• {numero_ref} *{v['titulo']}* — {v['status']}")
    linhas.append(f"\n{instrucao}")

    await e("\n".join(linhas))


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

    async def e(msg: str):
        await _enviar(instance_name, token, phone, msg, conversa_id=conversa_id)

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
            await e(
                f"📋 *Vaga {numero_ref}:* {vaga_match['titulo']}\n"
                f"📌 *Status:* {vaga_match['status']}\n"
                f"👥 *Candidatos:* {total_cands}\n\n"
                "Deseja ver outra vaga, criar uma nova ou encerrar?"
            )
        else:
            await e("Não encontrei essa vaga. Informe o número da vaga ou *todas* para listar.")
        return

    # Listar todas as vagas da empresa
    if empresa_id:
        vagas_res = supabase.table("vagas").select(
            "id, titulo, status, total_vagas, numero_vaga"
        ).eq("empresa_id", empresa_id).order("numero_vaga", desc=False).limit(10).execute()
        vagas = vagas_res.data or []

        if not vagas:
            await e("Sua empresa ainda não tem vagas cadastradas. Deseja criar uma? Responda *sim*.")
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
        await e("\n".join(linhas))
    else:
        await e("Para consultar suas vagas, informe o *CNPJ* da empresa:")
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

    async def e(msg: str):
        await _enviar(instance_name, token, phone, msg, conversa_id=conversa_id, lead_id=lead_id)

    # Encerramento
    if _quer_encerrar(texto) and etapa != "aguardando_id_candidato":
        await _encerrar_fluxo(conversa_id, instance_name, token, phone, "candidato")
        return

    if etapa == "solicitar_identificacao":
        await e(
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
            await e(
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
        await e("\n".join(linhas))
        await e(
            "Deseja consultar outra candidatura ou encerrar?\n\n"
            "Responda com *outro* para nova consulta ou *encerrar* para finalizar."
        )
        _set_fluxo(conversa_id, {"etapa": "candidato_consultado", "perfil": "candidato"})
        return

    # Estado consultado — oferecer nova consulta ou encerrar
    if etapa == "candidato_consultado":
        t = texto.strip().lower()
        if any(p in t for p in ("outro", "outra", "mais", "nova consulta", "consultar")):
            await e(
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
    "não tem nada", "nao tem nada", "enviar currículo", "enviar curriculo",
    "mandar currículo", "mandar curriculo", "cadastrar currículo",
    "cadastrar curriculo", "opção 4", "opcao 4", "número 4", "numero 4",
    "menu 4", "opção quatro", "opcao quatro",
}


def _quer_banco_talentos(texto: str, etapa: str = "", fluxo: dict | None = None) -> bool:
    """Detecta correção de intenção para banco de talentos sem roubar opções válidas."""
    t = texto.strip().lower()
    if any(p in t for p in _INTENCAO_BANCO_TALENTOS):
        return True

    # "4" puro é ambíguo em menus dinâmicos. Só redireciona se a etapa atual
    # não tiver uma opção 4 válida visível para o lead.
    if t not in ("4", "4.", "04"):
        return False

    fluxo = fluxo or {}
    if etapa == "listou_categorias" and "4" in (fluxo.get("mapa_categorias") or {}):
        return False
    if etapa == "listou_vagas" and "4" in (fluxo.get("mapa_vagas") or {}):
        return False
    if etapa == "aguardando_escolha_unidade" and len(fluxo.get("unidades_opcoes") or []) >= 4:
        return False
    if etapa == "listando_cargos_selecao" and len(fluxo.get("cargos_disponiveis") or []) >= 4:
        return False

    return etapa in {
        "inicio", "listou_categorias", "listou_vagas",
        "aguardando_escolha_unidade", "listando_cargos_selecao",
        "pos_candidatura", "candidatura_confirmada", "oferta_banco_talentos",
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

    # Helper local: envia e grava automaticamente no DB para exibição no painel
    async def e(msg: str):
        await _enviar(instance_name, token, phone, msg, conversa_id=conversa_id, lead_id=lead_id)

    async def iniciar_banco_talentos():
        historico_aplicadas = list(fluxo.get("historico_vagas_aplicadas") or [])
        await e(
            "📁 *Banco de Talentos CUCA*\n\n"
            "Podemos cadastrar seu currículo no banco de talentos. "
            "Quando surgir uma vaga compatível com seu perfil, a equipe entrará em contato.\n\n"
            "Para continuar, preciso do seu *nome completo*:"
        )
        _set_fluxo(conversa_id, {
            "perfil": "publico",
            "etapa": "coletando_nome_candidato",
            "banco_talentos": True,
            "historico_vagas_aplicadas": historico_aplicadas,
            "nome_candidato_prefill": fluxo.get("nome_candidato_prefill", ""),
        })

    # Encerramento
    # S37C-03: pos_candidatura é tolerante — "obrigado", "valeu" não encerram o fluxo
    if _quer_encerrar(texto) and etapa not in ("coletando_nome_candidato", "confirmando_terceiro", "pos_candidatura"):
        await _encerrar_fluxo(conversa_id, instance_name, token, phone, "publico")
        return

    # SQS-53: correção de rota quando o lead escolheu vagas por engano e depois
    # expressa intenção de enviar currículo para o banco de talentos.
    if _quer_banco_talentos(texto, etapa, fluxo):
        await iniciar_banco_talentos()
        return

    # --- ETAPA: aguardando_confirmacao_candidatura ---
    # Verifica se o portal já registrou a candidatura e envia o número
    if etapa == "aguardando_confirmacao_candidatura":
        fluxo_atual = _get_fluxo(conversa_id)
        candidatura_id = fluxo_atual.get("candidatura_criada_id")
        candidatura_codigo = fluxo_atual.get("candidatura_codigo")

        if candidatura_id:
            eh_banco_talentos = fluxo_atual.get("banco_talentos", False)
            if eh_banco_talentos:
                await e(
                    "✅ *Currículo salvo com sucesso!*\n\n"
                    "Seu currículo foi cadastrado no banco de talentos da rede CUCA. "
                    "Assim que surgir uma oportunidade compatível com seu perfil e área de interesse, "
                    "nossa equipe entrará em contato diretamente por aqui. 🎯\n\n"
                    "Obrigado por confiar na CUCA!\n\n"
                    "Deseja ver as *vagas abertas* ou encerrar por aqui?\n"
                    "Responda *vagas* para ver oportunidades ou *encerrar*."
                )
                _set_fluxo(conversa_id, {
                    "etapa": "candidatura_confirmada",
                    "perfil": "publico",
                })
            else:
                codigo = candidatura_codigo or candidatura_id.replace("-", "")[-6:].upper()
                # S37C-02: Mensagem 1 — confirmação com o código de acompanhamento
                await e(
                    f"🎉 *Candidatura recebida com sucesso!*\n\n"
                    f"🔢 *Número de acompanhamento:* *{codigo}*\n\n"
                    "Guarde esse número! Com ele você pode verificar o status da sua candidatura a qualquer momento. ✅"
                )
                # S37C-02: Mensagem 2 — oferta de nova candidatura (separada para melhor UX)
                await e(
                    "Deseja se candidatar a outra vaga da CUCA? 👀\n\n"
                    "Responda *outra* para ver mais vagas ou *encerrar* para finalizar."
                )
                # S37C-04/05: salva histórico de vagas e prefill do nome para o próximo ciclo
                vaga_confirmada = fluxo_atual.get("vaga_id_selecionada")
                historico = list(fluxo_atual.get("historico_vagas_aplicadas") or [])
                if vaga_confirmada and vaga_confirmada not in historico:
                    historico.append(vaga_confirmada)
                _set_fluxo(conversa_id, {
                    "etapa": "pos_candidatura",  # S37C-01
                    "perfil": "publico",
                    "ultima_candidatura_codigo": codigo,
                    "historico_vagas_aplicadas": historico,
                    "nome_candidato_prefill": fluxo_atual.get("nome_candidato", ""),
                })
        else:
            # Ainda aguardando — link reenviado se necessário
            link_reenviado = fluxo_atual.get("link_candidatura", "")
            await e(
                "Ainda aguardando o envio do seu currículo. 🕐\n\n"
                f"{'Acesse o link para preencher: 🔗 ' + link_reenviado if link_reenviado else ''}\n\n"
                "Após o envio, você receberá aqui o número de acompanhamento."
            )
        return

    # --- ETAPA: candidatura_confirmada (S37C-06: alias de retrocompatibilidade) ---
    # Mantido para não quebrar leads que estavam nesta etapa durante o deploy.
    # Comportamento idêntico ao antigo — redireciona para pos_candidatura de forma transparente.
    if etapa == "candidatura_confirmada":
        if any(p in t_lower for p in ("outra", "mais", "ver vagas", "outras vagas", "vagas", "vaga")):
            _set_fluxo(conversa_id, {
                "perfil": "publico",
                "etapa": "pos_candidatura",
                "historico_vagas_aplicadas": fluxo.get("historico_vagas_aplicadas") or [],
                "nome_candidato_prefill": fluxo.get("nome_candidato_prefill", ""),
            })
            await _processar_publico("vagas", phone, instance_name, token, lead_id, conversa_id, unidade_cuca)
        else:
            await _encerrar_fluxo(conversa_id, instance_name, token, phone, "publico")
        return

    # --- ETAPA: pos_candidatura (S37C-01) ---
    if etapa == "pos_candidatura":
        quer_mais_vagas = any(p in t_lower for p in (
            "outra", "mais", "ver vagas", "outras vagas", "vagas", "vaga", "sim", "quero", "ok"
        ))
        quer_encerrar_claro = any(p in t_lower for p in (
            "não", "nao", "encerrar", "tchau", "até mais", "até logo", "finalizar", "pode fechar"
        ))

        if quer_mais_vagas:
            # S37C-04/05: preserva histórico e prefill, reinicia listagem de vagas
            _set_fluxo(conversa_id, {
                "perfil": "publico",
                "etapa": "inicio",
                "historico_vagas_aplicadas": fluxo.get("historico_vagas_aplicadas") or [],
                "nome_candidato_prefill": fluxo.get("nome_candidato_prefill", ""),
            })
            await _processar_publico("vagas", phone, instance_name, token, lead_id, conversa_id, unidade_cuca)
        elif quer_encerrar_claro:
            await _encerrar_fluxo(conversa_id, instance_name, token, phone, "publico")
        else:
            # S37C-03: mensagem ambígua (ex: "obrigado", "valeu") — reapresenta opções sem encerrar
            await e(
                "Fico feliz em ter ajudado! 😊\n\n"
                "Ainda quer se candidatar a outra vaga?\n"
                "Responda *outra* para ver mais vagas ou *encerrar* para finalizar."
            )
        return

    # --- ETAPA: oferta_banco_talentos ---
    if etapa == "oferta_banco_talentos":
        quer_banco = any(p in t_lower for p in ("sim", "quero", "ok", "claro", "pode", "banco", "talentos", "cadastrar"))
        quer_recusar = any(p in t_lower for p in ("não", "nao", "não quero", "dispenso", "encerrar", "tchau", "até logo"))
        if quer_banco:
            await e("Para continuar, preciso do seu *nome completo*:")
            _set_fluxo(conversa_id, {
                "perfil": "publico",
                "etapa": "coletando_nome_candidato",
                "banco_talentos": True,
                "historico_vagas_aplicadas": fluxo.get("historico_vagas_aplicadas") or [],
                "nome_candidato_prefill": fluxo.get("nome_candidato_prefill", ""),
            })
        else:
            # Recusa ou mensagem ambígua → despedida e encerramento
            await e(
                "Tudo bem! Qualquer novidade, entraremos em contato. Até logo! 👋"
            )
            await _encerrar_fluxo(conversa_id, instance_name, token, phone, "publico")
        return

    # --- ETAPA: coletando_nome_candidato ---
    if etapa == "coletando_nome_candidato":
        nome_coletado = texto.strip()
        vaga_id_ref = fluxo.get("vaga_id_selecionada")
        eh_banco_talentos = fluxo.get("banco_talentos", False)

        await e(
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
            await e("Tudo certo! Informe o *nome completo* da pessoa para quem você está enviando o currículo:")
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
            nome_candidato, phone, vaga_id_ref, eh_banco_talentos, lead_id=lead_id
        )
        return

    # --- ETAPA: coletando_nome_terceiro ---
    if etapa == "coletando_nome_terceiro":
        nome_terceiro = texto.strip()
        vaga_id_ref = fluxo.get("vaga_id_selecionada")
        eh_banco_talentos = fluxo.get("banco_talentos", False)

        await _enviar_link_candidatura(
            instance_name, token, phone, conversa_id, fluxo,
            nome_terceiro, phone, vaga_id_ref, eh_banco_talentos, lead_id=lead_id
        )
        return

    # --- ETAPA: listando_cargos_selecao (SQS-49) ---
    # Candidato escolheu uma vaga do tipo selecao_evento e agora escolhe o(s) cargo(s)
    if etapa == "listando_cargos_selecao":
        cargos_disponiveis = fluxo.get("cargos_disponiveis", [])
        vaga_id_ref = fluxo.get("vaga_id_selecionada")
        escolhas_raw = re.findall(r"\d+", texto)
        cargos_escolhidos = []
        for n in escolhas_raw:
            idx = int(n) - 1
            if 0 <= idx < len(cargos_disponiveis):
                titulo = cargos_disponiveis[idx].get("titulo", "")
                if titulo:
                    cargos_escolhidos.append(titulo)
        if not cargos_escolhidos:
            linhas_re = ["Não entendi. Digite o número do cargo de interesse. Ex: *1* ou *1,3*\n"]
            for idx_c, c in enumerate(cargos_disponiveis, start=1):
                linhas_re.append(f"{idx_c}️⃣ {c.get('titulo', '')}")
            await e("\n".join(linhas_re))
            return
        display_str = ", ".join(cargos_escolhidos)
        await e(f"Ótimo! Você escolheu: *{display_str}* ✅\n\nPara finalizar, preciso do seu *nome completo*:")
        _set_fluxo(conversa_id, {
            **fluxo,
            "etapa": "coletando_nome_candidato",
            "cargos_escolhidos": cargos_escolhidos,  # lista — AC10 SQS-49
            "banco_talentos": False,
        })
        return

    # --- ETAPA: listou_categorias (SQS-41 Ação 2.1) ---
    if etapa == "listou_categorias":
        mapa_cat = fluxo.get("mapa_categorias", {})
        match_cat = re.search(r"\b(\d{1,2})\b", texto)
        if match_cat and match_cat.group(1) in mapa_cat:
            cat_data = mapa_cat[match_cat.group(1)]
            cat_vagas = cat_data["vagas"]  # list of {"id", "titulo", "unidade_destino"}
            linhas_cat = [f"💼 *{cat_data['categoria']} — Vagas disponíveis:*\n"]
            mapa_vagas_cat: dict = {}
            ultima_vaga_id_cat = None
            for ic, vc in enumerate(cat_vagas, start=1):
                linhas_cat.append(f"*{ic}.* {vc['titulo']}")
                mapa_vagas_cat[str(ic)] = vc["id"]
                ultima_vaga_id_cat = vc["id"]
            linhas_cat.append("\nDigite o *número* da vaga para se candidatar.")
            await e("\n".join(linhas_cat))
            _set_fluxo(conversa_id, {
                **fluxo,
                "etapa": "listou_vagas",
                "mapa_vagas": mapa_vagas_cat,
                "ultima_vaga_id": ultima_vaga_id_cat,
                "_vagas_meta": {vc["id"]: vc for vc in cat_vagas},
            })
        else:
            # Re-exibe o menu de categorias
            linhas_re = ["💼 *Vagas abertas na Rede CUCA — Escolha uma categoria:*\n"]
            for k, v in mapa_cat.items():
                subcats_re = ", ".join(vg["titulo"].lower() for vg in v["vagas"][:3])
                total_re = len(v["vagas"])
                linhas_re.append(
                    f"*{k}.* {v['categoria']} ({subcats_re}) - ({total_re} vaga{'s' if total_re > 1 else ''})"
                )
            linhas_re.append("\nDigite o número da categoria.")
            await e("\n".join(linhas_re))
        return

    # --- ETAPA: aguardando_escolha_unidade (SQS-41 Ação 2.3) ---
    if etapa == "aguardando_escolha_unidade":
        unidades_opcoes: list = fluxo.get("unidades_opcoes", [])
        vaga_id_global = fluxo.get("vaga_id_selecionada")
        match_unid = re.search(r"\b([1-5])\b", t_lower)
        if match_unid and unidades_opcoes:
            idx_escolha = int(match_unid.group(1)) - 1
            if 0 <= idx_escolha < len(unidades_opcoes):
                unidade_escolhida = unidades_opcoes[idx_escolha]
                unidade_id_escolhida: str = unidade_escolhida["id"]
                nome_prefill = fluxo.get("nome_candidato_prefill", "")
                novo_fluxo = {**fluxo, "unidade_id_escolhida": unidade_id_escolhida}
                if nome_prefill:
                    await _enviar_link_candidatura(
                        instance_name, token, phone, conversa_id, novo_fluxo,
                        nome_prefill, phone, vaga_id_global, False, lead_id=lead_id
                    )
                else:
                    # Salva estado antes de enviar para não ficar preso se envio falhar
                    _set_fluxo(conversa_id, {
                        **novo_fluxo,
                        "etapa": "coletando_nome_candidato",
                        "banco_talentos": False,
                    })
                    await e("Para finalizar sua candidatura, preciso do seu *nome completo*:")
                return
        # Resposta inválida — re-exibe as opções
        linhas_re_unid = [
            "Não entendi. Por favor, escolha a unidade CUCA mais próxima de você:\n"
        ]
        for idx_ru, u in enumerate(unidades_opcoes, start=1):
            linhas_re_unid.append(f"*{idx_ru}.* {u['nome']}")
        await e("\n".join(linhas_re_unid))
        return

    # Candidatos veem TODAS as vagas abertas de qualquer unidade.
    # unidade_destino controla apenas qual equipe CUCA gerencia a candidatura — não a visibilidade pública.
    vagas_res = supabase.table("vagas").select(
        "id, titulo, tipo_contrato, salario, escolaridade_minima, total_vagas, faixa_etaria, setor, unidade_destino"
    ).eq("status", "aberta").order("created_at", desc=True).limit(50).execute()
    vagas = vagas_res.data or []

    # HF37-06: Sincronizar com o banco — buscar vagas já candidatadas por este telefone
    # (captura candidaturas de sessões anteriores que não estão na memória da sessão atual)
    # Filtro de status feito em Python puro para evitar incompatibilidade com postgrest-py
    STATUS_INATIVOS = {"rejeitado", "cancelado", "excluido", "inativo"}
    # Remove todos os não-dígitos e normaliza: candidaturas são salvas sem o "55" do Brasil
    telefone_limpo = re.sub(r"\D", "", phone)
    if telefone_limpo.startswith("55") and len(telefone_limpo) > 11:
        telefone_limpo = telefone_limpo[2:]
    db_cands_res = supabase.table("candidaturas").select("vaga_id, status, cargo_escolhido").eq(
        "telefone", telefone_limpo
    ).execute()
    db_vagas_ids = set()
    # SQS-49: selecao_evento — rastrear cargos já inscritos por vaga (não ocultar a vaga inteira)
    db_cargos_por_vaga: dict[str, set] = {}
    for c in (db_cands_res.data or []):
        if not c.get("vaga_id") or c.get("status") in STATUS_INATIVOS:
            continue
        cargo = c.get("cargo_escolhido")
        if cargo:
            # candidatura com cargo: registra o cargo, não bloqueia a vaga inteira
            db_cargos_por_vaga.setdefault(c["vaga_id"], set()).add(cargo)
        else:
            # candidatura sem cargo (vaga_normal): bloqueia a vaga normalmente
            db_vagas_ids.add(c["vaga_id"])

    # S37C-04: Combinar histórico da sessão com IDs do banco e filtrar vagas
    historico_aplicadas = list(fluxo.get("historico_vagas_aplicadas") or [])
    ids_excluir = db_vagas_ids | set(historico_aplicadas)
    if ids_excluir:
        vagas = [v for v in vagas if v["id"] not in ids_excluir]

    # Intenção de banco de talentos
    if _quer_banco_talentos(texto, etapa, fluxo):
        await iniciar_banco_talentos()
        return

    # Verificar se quer se candidatar a vaga específica (por número sequencial, título ou "quero essa")
    vaga_id_ref = None
    match_num_seq = re.search(r"\b(\d{1,2})\b", texto)

    if etapa == "listou_vagas":
        mapa_vagas = fluxo.get("mapa_vagas", {})  # {"1": vaga_id, "2": vaga_id, ...}

        # Candidatura por número da lista (ex: "1", "2", "quero a 1")
        if match_num_seq:
            num_digitado = match_num_seq.group(1)
            if num_digitado in mapa_vagas:
                vaga_id_ref = mapa_vagas[num_digitado]

        # Candidatura por nome parcial da vaga
        if not vaga_id_ref:
            for v in vagas:
                titulo_lower = v["titulo"].lower()
                palavras = [p for p in titulo_lower.split() if len(p) > 3]
                if any(p in t_lower for p in palavras):
                    vaga_id_ref = v["id"]
                    break

        # "quero essa" → última vaga listada
        if not vaga_id_ref and ("quero essa" in t_lower or "candidatar" in t_lower or "quero" in t_lower):
            vaga_id_ref = fluxo.get("ultima_vaga_id")

    if vaga_id_ref:
        # SQS-49: verificar se vaga é selecao_evento antes de qualquer outra coisa
        vaga_tipo_res = supabase.table("vagas").select("tipo, cargos_lista").eq("id", vaga_id_ref).maybe_single().execute()
        if vaga_tipo_res.data and vaga_tipo_res.data.get("tipo") == "selecao_evento":
            cargos = vaga_tipo_res.data.get("cargos_lista") or []
            # SQS-49: excluir cargos que o candidato já se inscreveu
            cargos_ja_inscritos = db_cargos_por_vaga.get(vaga_id_ref, set())
            cargos_disponiveis = [c for c in cargos if c.get("titulo") not in cargos_ja_inscritos]
            if cargos_disponiveis:
                linhas_cargos = [
                    "🎯 *Escolha o cargo para o qual deseja se candidatar:*\n",
                ]
                if cargos_ja_inscritos:
                    inscritos_txt = ", ".join(cargos_ja_inscritos)
                    linhas_cargos.append(f"_(Já inscrito: {inscritos_txt})_\n")
                for idx_c, cargo in enumerate(cargos_disponiveis, start=1):
                    qtd = cargo.get("quantidade", "")
                    faixa = cargo.get("faixa_etaria", "")
                    qtd_txt = f" · {qtd} vagas" if qtd else ""
                    faixa_txt = f" · {faixa}" if faixa else ""
                    linhas_cargos.append(f"*{idx_c}.* {cargo.get('titulo', '')}{qtd_txt}{faixa_txt}")
                linhas_cargos.append("\nDigite o *número* do cargo. Para mais de um, separe por vírgula (ex: *1,3*).")
                _set_fluxo(conversa_id, {
                    **fluxo,
                    "etapa": "listando_cargos_selecao",
                    "vaga_id_selecionada": vaga_id_ref,
                    "cargos_disponiveis": cargos_disponiveis,
                    "historico_vagas_aplicadas": historico_aplicadas,
                })
                await e("\n".join(linhas_cargos))
                return
            # Se não tiver cargos estruturados, cai no fluxo normal de candidatura

        # SQS-41 Ação 2.3: verificar se vaga é global antes de coletar nome/enviar link
        vaga_meta = next((v for v in vagas if v["id"] == vaga_id_ref), None)
        if not vaga_meta:
            _vr = supabase.table("vagas").select("id, unidade_destino").eq("id", vaga_id_ref).maybe_single().execute()
            vaga_meta = _vr.data or {}
        unidade_destino_vaga = (vaga_meta or {}).get("unidade_destino", "")

        if unidade_destino_vaga == "global":
            # Perguntar ao candidato qual unidade fica mais próxima
            _unid_res = supabase.table("unidades_cuca").select("id, nome").eq("ativo", True).order("nome").execute()
            unidades_disponiveis = _unid_res.data or []
            linhas_unid = [
                "🌐 *Esta vaga é para toda a Rede CUCA!*\n\n"
                "Qual unidade fica mais próxima da sua residência?\n"
            ]
            for idx_u, u in enumerate(unidades_disponiveis, start=1):
                linhas_unid.append(f"*{idx_u}.* {u['nome']}")
            # Salva o estado ANTES de enviar a mensagem — evita ficar preso em listou_vagas
            # se o envio falhar de forma intermitente
            _set_fluxo(conversa_id, {
                **fluxo,
                "etapa": "aguardando_escolha_unidade",
                "vaga_id_selecionada": vaga_id_ref,
                "banco_talentos": False,
                "historico_vagas_aplicadas": historico_aplicadas,
                "unidades_opcoes": unidades_disponiveis,
            })
            await e("\n".join(linhas_unid))
            return

        # S37C-05: vaga com unidade definida — fluxo normal
        nome_prefill = fluxo.get("nome_candidato_prefill", "")
        if nome_prefill:
            await _enviar_link_candidatura(
                instance_name, token, phone, conversa_id, fluxo,
                nome_prefill, phone, vaga_id_ref, False, lead_id=lead_id
            )
        else:
            await e("Para finalizar sua candidatura, preciso do seu *nome completo*:")
            _set_fluxo(conversa_id, {
                "perfil": "publico",
                "etapa": "coletando_nome_candidato",
                "vaga_id_selecionada": vaga_id_ref,
                "banco_talentos": False,
                "historico_vagas_aplicadas": historico_aplicadas,
            })
        return

    if not vagas:
        # HF37-06: distingue "sem vagas no sistema" de "candidato já aplicou a todas"
        if ids_excluir:
            await e(
                "Você já se candidatou a todas as nossas vagas abertas no momento! 🎉\n\n"
                "Assim que novas oportunidades surgirem, entraremos em contato pelo WhatsApp.\n\n"
                "Deseja deixar seu currículo no banco de talentos para futuras vagas?\n"
                "Responda *sim* ou *não*."
            )
        else:
            await e(
                "No momento não há vagas abertas nesta unidade.\n"
                "Posso cadastrar seu currículo no banco de talentos para oportunidades futuras.\n\n"
                "Deseja? Responda *sim* ou *não*."
            )
        _set_fluxo(conversa_id, {
            "perfil": "publico",
            "etapa": "oferta_banco_talentos",
            "historico_vagas_aplicadas": historico_aplicadas,
            "nome_candidato_prefill": fluxo.get("nome_candidato_prefill", ""),
        })
        return

    # SQS-41 Ação 2.1: Menu dinâmico agrupado por categoria
    from collections import defaultdict
    categorias_map: dict = defaultdict(list)
    for v in vagas:
        setores = v.get("setor") or []
        cat = setores[0] if setores else "Geral"
        categorias_map[cat].append(v)

    linhas = ["💼 *Vagas abertas na Rede CUCA — Escolha uma categoria:*\n"]
    mapa_categorias: dict = {}
    for i, (cat, cat_vagas) in enumerate(categorias_map.items(), start=1):
        subcats = ", ".join(v["titulo"].lower() for v in cat_vagas[:3])
        total = len(cat_vagas)
        linhas.append(
            f"*{i}.* {cat} ({subcats}) - ({total} vaga{'s' if total > 1 else ''})"
        )
        mapa_categorias[str(i)] = {
            "categoria": cat,
            "vagas": [
                {"id": v["id"], "titulo": v["titulo"], "unidade_destino": v.get("unidade_destino", "global")}
                for v in cat_vagas
            ],
        }

    linhas.append(
        "\nDigite o *número* da categoria para ver as vagas disponíveis.\n"
        "Ou diga *banco de talentos* para deixar seu currículo para futuras oportunidades."
    )
    await e("\n".join(linhas))
    _set_fluxo(conversa_id, {
        "perfil": "publico",
        "etapa": "listou_categorias",
        "mapa_categorias": mapa_categorias,
        # HF37-02: propaga histórico para que ciclos seguintes não reofereçam vagas já aplicadas
        "historico_vagas_aplicadas": historico_aplicadas,
        "nome_candidato_prefill": fluxo.get("nome_candidato_prefill", ""),
    })


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
    lead_id: str = "",
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
    # SQS-41 Ação 2.3: unidade escolhida pelo candidato em vagas globais
    unidade_id_link = fluxo.get("unidade_id_escolhida", "")
    if unidade_id_link:
        params["unidade_id"] = unidade_id_link
    # SQS-49 AC10: lista de cargos escolhidos em selecao_evento
    cargos_escolhidos_link = fluxo.get("cargos_escolhidos") or []
    if cargos_escolhidos_link:
        params["cargos_escolhidos"] = ",".join(cargos_escolhidos_link)

    query = urllib.parse.urlencode(params)
    link = f"{PORTAL_URL}/empregabilidade/candidatura?{query}"

    if banco_talentos:
        mensagem_link = (
            f"Ótimo! 📁 Acesse o link abaixo para enviar o currículo de *{nome_candidato}*:\n\n"
            f"🔗 {link}\n\n"
            "Após o envio, seu currículo será salvo no banco de talentos da rede CUCA. ✅"
        )
    else:
        mensagem_link = (
            f"Ótimo! 🎯 Acesse o link abaixo para enviar o currículo de *{nome_candidato}*:\n\n"
            f"🔗 {link}\n\n"
            "Após o envio, você receberá aqui o *número de acompanhamento* da candidatura. ✅"
        )
    await _enviar(instance_name, token, phone, mensagem_link, conversa_id=conversa_id, lead_id=lead_id)
    _set_fluxo(conversa_id, {
        "perfil": "publico",
        "etapa": "aguardando_confirmacao_candidatura",
        "nome_candidato": nome_candidato,
        "link_candidatura": link,
        "vaga_id_selecionada": vaga_id,
        "banco_talentos": banco_talentos,
        # S37C-04/05: preserva histórico e atualiza prefill para o próximo ciclo
        "historico_vagas_aplicadas": fluxo.get("historico_vagas_aplicadas") or [],
        "nome_candidato_prefill": nome_candidato,
    })


# ---------------------------------------------------------------------------
# Ponto de entrada principal
# ---------------------------------------------------------------------------

_ETAPAS_EMPRESA = {
    "solicitar_cnpj", "aguardando_cnpj", "confirmando_cadastro",
    "confirmando_cadastro_com_correcao", "aguardando_criar_vaga",
    "aguardando_retorno_vaga", "consulta_empresa", "empresa_ativa",
    "menu_empresa_retomada", "menu_pos_vaga", "menu_empresa_acoes", "perguntando_unidade_vaga",
    "selecionando_vaga_edicao", "aguardando_retorno_edicao",
    "selecionando_vaga_cancelamento", "confirmando_cancelamento",
    # SQS-49: novos estados de seleção por evento
    "escolhendo_tipo_vaga", "aguardando_retorno_selecao",
}
_ETAPAS_CANDIDATO = {
    "solicitar_identificacao", "aguardando_id_candidato", "candidato_consultado",
}
_ETAPAS_PUBLICO = {
    "inicio", "listou_vagas", "candidatura_enviada",
    "coletando_nome_candidato", "confirmando_terceiro", "coletando_nome_terceiro",
    "aguardando_confirmacao_candidatura", "candidatura_confirmada",
    "pos_candidatura",            # S37C-01: novo estado para fluxo cíclico
    "oferta_banco_talentos",
    "listou_categorias",          # SQS-41: menu dinâmico por categoria
    "aguardando_escolha_unidade", # SQS-41: roteamento de vaga global
    "listando_cargos_selecao",    # SQS-49: escolha de cargo dentro de selecao_evento
}


async def processar_mensagem_empregabilidade(
    texto: str,
    phone: str,
    instance_name: str,
    token: str,
    lead_id: str,
    conversa_id: str,
    unidade_cuca: str,
    push_name: str = "Cidadão",
):
    """
    Entry point chamado pelo main.py quando agente_tipo = 'Empregabilidade'.
    Identifica o perfil e roteia para o fluxo correto.
    """
    fluxo = _get_fluxo(conversa_id)
    perfil_atual = fluxo.get("perfil")
    etapa_atual = fluxo.get("etapa", "")

    # SQS-40 Task 3.3: Handover por Dúvida
    from datetime import datetime, timezone
    cm_res = supabase.table("conversas").select("metadata").eq("id", conversa_id).single().execute()
    cm_meta = (cm_res.data or {}).get("metadata") or {}
    
    if cm_meta.get("ultima_intencao") == "duvida":
        # Limpar flag para não repetir infinitamente nesta conversa se o humano não assumir
        cm_meta["ultima_intencao"] = None
        supabase.table("conversas").update({"metadata": cm_meta}).eq("id", conversa_id).execute()
        
        logger.info(f"[SQS-40] Disparando transbordo para dúvida do lead {phone}")
        
        # Notificar equipe de transbordo (Módulo Empregabilidade)
        try:
            modulo_alvo = "empregabilidade"
            handover_res = supabase.table("human_handover_contacts").select("*").eq("modulo", modulo_alvo).eq("unidade_cuca", unidade_cuca).eq("ativo", True).execute()
            contato = (handover_res.data or [None])[0]
            if not contato:
                # Fallback global
                handover_res = supabase.table("human_handover_contacts").select("*").eq("modulo", modulo_alvo).is_("unidade_cuca", "null").eq("ativo", True).execute()
                contato = (handover_res.data or [None])[0]

            if contato:
                tel_destino = contato["telefone_destino"]
                setor_resp = contato.get("nome_responsavel") or "Empregabilidade"
                historico = _montar_historico(conversa_id)
                msg_handover = (
                    f"🚨 *TRANSBORDO — EMPREGABILIDADE*\n\n"
                    f"👤 *Lead:* {push_name}\n"
                    f"📱 *Telefone:* {phone}\n"
                    f"🏢 *Setor:* {setor_resp}\n\n"
                    f"📋 *Histórico da conversa:*\n{historico}\n\n"
                    f"🔗 Iniciar chat: https://wa.me/{phone}"
                )
                async with httpx.AsyncClient() as hc:
                    await hc.post(
                        f"{UAZAPI_URL}/send/text",
                        headers={"token": token, "Content-Type": "application/json"},
                        json={"number": tel_destino, "text": msg_handover, "delay": 1200}
                    )
                # Pausar IA — portal fica disponível para o humano responder
                supabase.table("conversas").update({"status": "awaiting_human"}).eq("id", conversa_id).execute()
                # Avisar o lead que um humano foi chamado
                await _enviar(
                    instance_name, token, phone,
                    "Entendi que você tem uma dúvida. 🤝 Estarei encaminhando sua mensagem para nossa equipe humana de empregabilidade. "
                    "Em breve um de nossos consultores falará com você por aqui!",
                    conversa_id=conversa_id, lead_id=lead_id
                )
                return # Interrompe fluxo bot
        except Exception as _he:
            logger.error(f"[SQS-40] Erro ao disparar transbordo por dúvida: {_he}")
        return  # Sempre encerra após tentativa de transbordo por dúvida

    # Detecção por expressão natural: usuário pede explicitamente atendimento humano
    _texto_lower = texto.strip().lower()
    _CONTAINS_HANDOVER = {
        "falar com humano", "falar com um humano", "atendente humano", "falar com atendente",
        "falar com o atendente", "falar com um atendente", "falar com a atendente",
        "quero atendente", "quero humano", "humano por favor", "pessoa real",
        "quero falar com atendente", "quero falar com o atendente",
        "preciso de atendente", "chamar atendente", "atendente por favor",
        "falar com pessoa", "atendimento humano", "preciso de ajuda humana",
        "falar com alguem", "falar com alguém", "falar com um alguem", "falar com um alguém",
        "quero falar com alguem", "quero falar com alguém", "quero falar com um humano",
        "me passa para humano", "me passa para atendente", "falar com uma pessoa",
        "quero atendimento", "preciso de atendimento", "falar com suporte",
    }
    if any(kw in _texto_lower for kw in _CONTAINS_HANDOVER):
        logger.info(f"[HANDOVER-KW] Transbordo por palavra-chave para {phone}")
        try:
            modulo_alvo = "empregabilidade"
            hw_res = supabase.table("human_handover_contacts").select("*").eq("modulo", modulo_alvo).eq("unidade_cuca", unidade_cuca).eq("ativo", True).execute()
            contato_hw = (hw_res.data or [None])[0]
            if not contato_hw:
                hw_res = supabase.table("human_handover_contacts").select("*").eq("modulo", modulo_alvo).is_("unidade_cuca", "null").eq("ativo", True).execute()
                contato_hw = (hw_res.data or [None])[0]
            if contato_hw:
                tel_destino = contato_hw["telefone_destino"]
                setor_resp = contato_hw.get("nome_responsavel") or "Empregabilidade"
                historico = _montar_historico(conversa_id)
                msg_hw = (
                    f"🚨 *TRANSBORDO — EMPREGABILIDADE*\n\n"
                    f"👤 *Lead:* {push_name}\n"
                    f"📱 *Telefone:* {phone}\n"
                    f"🏢 *Setor:* {setor_resp}\n\n"
                    f"📋 *Histórico da conversa:*\n{historico}\n\n"
                    f"🔗 Iniciar chat: https://wa.me/{phone}"
                )
                async with httpx.AsyncClient() as hc:
                    await hc.post(
                        f"{UAZAPI_URL}/send/text",
                        headers={"token": token, "Content-Type": "application/json"},
                        json={"number": tel_destino, "text": msg_hw, "delay": 1200}
                    )
                # Pausar IA — portal fica disponível para o humano responder
                supabase.table("conversas").update({"status": "awaiting_human"}).eq("id", conversa_id).execute()
                await _enviar(
                    instance_name, token, phone,
                    "Entendido! 🤝 Estou encaminhando você para nossa equipe humana de empregabilidade. Em breve um consultor falará com você por aqui!",
                    conversa_id=conversa_id, lead_id=lead_id
                )
                return
        except Exception as _hwe:
            logger.error(f"[HANDOVER-KW] Erro ao disparar transbordo por palavra-chave: {_hwe}")
        return  # Sempre encerra após tentativa de transbordo por palavra-chave

    # SQS-40 Task 3.4: Interceptar respostas ao convite de entrevista
    texto_norm = texto.strip()
    # candidaturas.telefone é salvo sem o código de país (55); phone do JID tem "55" prefixado
    phone_local = phone[2:] if phone.startswith("55") and len(phone) > 11 else phone
    cands_convite = (
        supabase.table("candidaturas")
        .select("id, nome")
        .eq("telefone", phone_local)
        .eq("status", "convite_enviado")
        .execute().data or []
    )

    if cands_convite:
        cand = cands_convite[0]
        cand_id = cand["id"]
        cand_nome = cand.get("nome", "Candidato")

        if texto_norm in ("1", "1.", "sim", "sim!", "confirmar", "confirmado"):
            supabase.table("candidaturas").update({"status": "entrevista_confirmada"}).eq("id", cand_id).execute()
            _set_fluxo(conversa_id, {"perfil": "encerrado"})
            await _enviar(
                instance_name, token, phone,
                f"✅ Recebemos sua confirmação, *{cand_nome}*! Sua presença na entrevista foi registrada com sucesso. "
                f"Boa sorte! Em caso de dúvidas, pode chamar aqui. 🍀",
                conversa_id=conversa_id, lead_id=lead_id
            )
            return
        elif texto_norm in ("2", "2.", "não", "nao", "não posso", "nao posso", "recusar"):
            supabase.table("candidaturas").update({"status": "entrevista_recusada"}).eq("id", cand_id).execute()
            _set_fluxo(conversa_id, {"perfil": "encerrado"})
            await _enviar(
                instance_name, token, phone,
                f"Entendido, *{cand_nome}*. Recebemos sua resposta e registramos que você não poderá comparecer desta vez. "
                f"Continue acompanhando novas oportunidades pelo CUCA! 💙",
                conversa_id=conversa_id, lead_id=lead_id
            )
            return
        elif texto_norm in ("3", "3.", "dúvida", "duvida", "?"):
            # Marcar dúvida e deixar o fluxo normal de transbordo tratar
            cm_res2 = supabase.table("conversas").select("metadata").eq("id", conversa_id).single().execute()
            cm_meta2 = (cm_res2.data or {}).get("metadata") or {}
            cm_meta2["ultima_intencao"] = "duvida"
            supabase.table("conversas").update({"metadata": cm_meta2}).eq("id", conversa_id).execute()
            # Reprocessar com a flag de dúvida agora setada (vai cair no bloco acima)
            await processar_mensagem_empregabilidade(
                texto, phone, instance_name, token, lead_id, conversa_id, unidade_cuca, push_name
            )
            return
        else:
            # Resposta não reconhecida — re-exibir opções
            await _enviar(
                instance_name, token, phone,
                f"Olá, *{cand_nome}*! 👋 Você possui um convite de entrevista pendente. Por favor, responda:\n\n"
                f"*1* - ✅ Confirmar presença\n"
                f"*2* - ❌ Não poderei comparecer\n"
                f"*3* - ❓ Tenho uma dúvida",
                conversa_id=conversa_id, lead_id=lead_id
            )
            return

    # SQS-41 Ação 2.2: Bypass global — "menu" retorna ao menu de categorias a qualquer momento
    if texto.strip().lower() == "menu":
        _set_fluxo(conversa_id, {
            "perfil": "publico",
            "etapa": "inicio",
            "historico_vagas_aplicadas": fluxo.get("historico_vagas_aplicadas") or [],
            "nome_candidato_prefill": fluxo.get("nome_candidato_prefill", ""),
        })
        await _processar_publico("vagas", phone, instance_name, token, lead_id, conversa_id, unidade_cuca)
        return

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
        if t in ("1", "empresa", "divulgar", "divulgar vaga", "quero divulgar",
                 "marcar selecao", "marcar seleção", "selecao", "seleção"):
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
        if t in ("4", "enviar curriculo", "enviar currículo", "deixar curriculo", "deixar currículo",
                 "sem vaga", "curriculo sem vaga", "currículo sem vaga", "banco", "cadastrar curriculo",
                 "cadastrar currículo"):
            _set_fluxo(conversa_id, {
                "perfil": "publico",
                "etapa": "coletando_nome_candidato",
                "banco_talentos": True,
            })
            await _enviar(
                instance_name, token, phone,
                "📁 *Enviar Currículo (sem vaga)*\n\n"
                "Vamos cadastrar seu currículo no banco de talentos da rede CUCA. "
                "Quando surgir uma oportunidade compatível com seu perfil, a equipe entrará em contato.\n\n"
                "Para começar, preciso do seu *nome completo*:",
                conversa_id=conversa_id, lead_id=lead_id,
            )
            return
        await _enviar(
            instance_name, token, phone,
            "Não entendi sua resposta. Por favor, escolha uma das opções:\n\n"
            "1️⃣ *Empresa* — Quero divulgar uma vaga ou marcar seleção\n"
            "2️⃣ *Candidato* — Quero acompanhar minha candidatura\n"
            "3️⃣ *Vagas* — Quero ver vagas abertas\n"
            "4️⃣ *Enviar Currículo* — Quero deixar meu currículo para futuras oportunidades\n\n"
            "Digite *1*, *2*, *3* ou *4*.",
            conversa_id=conversa_id, lead_id=lead_id,
        )
        return

    # SQS-49: detectar resposta de confirmação de presença (SIM/NÃO) para selecao_evento
    # Só intercepta quando fluxo está vazio e resposta é exatamente SIM ou NÃO/NAO.
    # Risco de falso positivo é mínimo pois exige candidatura selecionada com cargo_escolhido.
    t_conf = texto.strip().lower()
    if not fluxo and t_conf in ("sim", "s", "não", "nao", "n", "✅", "❌"):
        tel_limpo = re.sub(r"\D", "", phone)
        if tel_limpo.startswith("55") and len(tel_limpo) > 11:
            tel_limpo = tel_limpo[2:]
        cand_event = supabase.table("candidaturas").select(
            "id, cargo_escolhido, confirmacao_presenca"
        ).eq("telefone", tel_limpo).eq("status", "selecionado").not_.is_(
            "cargo_escolhido", "null"
        ).is_("confirmacao_presenca", "null").order("updated_at", desc=True).limit(1).execute()
        if cand_event.data:
            cand = cand_event.data[0]
            confirmacao = "confirmado" if t_conf in ("sim", "s", "✅") else "recusado"
            supabase.table("candidaturas").update({
                "confirmacao_presenca": confirmacao
            }).eq("id", cand["id"]).execute()
            cargo = cand.get("cargo_escolhido", "")
            if confirmacao == "confirmado":
                await _enviar(
                    instance_name, token, phone,
                    f"✅ *Presença confirmada!*\n\n"
                    f"Sua participação no processo seletivo{' para ' + cargo if cargo else ''} está registrada.\n\n"
                    "Fique atento ao dia e horário informados. Boa sorte! 💪\n\n"
                    "_Qualquer dúvida, entre em contato com a unidade CUCA._",
                    conversa_id=conversa_id, lead_id=lead_id
                )
            else:
                await _enviar(
                    instance_name, token, phone,
                    f"❌ *Ausência registrada.*\n\n"
                    "Tudo bem! Seu registro foi atualizado. Se mudar de ideia ou quiser ver outras oportunidades, é só nos chamar. 🤝",
                    conversa_id=conversa_id, lead_id=lead_id
                )
            logger.info(f"[SQS-49] Confirmação de presença '{confirmacao}' registrada para candidatura {cand['id']}")
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
            "1️⃣ *Empresa* — Quero divulgar uma vaga ou marcar seleção\n"
            "2️⃣ *Candidato* — Quero acompanhar minha candidatura\n"
            "3️⃣ *Vagas* — Quero ver vagas abertas\n"
            "4️⃣ *Enviar Currículo* — Quero deixar meu currículo para futuras oportunidades\n\n"
            "Responda com o número ou descreva o que precisa.",
            conversa_id=conversa_id, lead_id=lead_id,
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
                fluxo = metadata.get("empreg_fluxo") or {}
                etapa_c = fluxo.get("etapa", "")

                # Só processa etapas que esperam retorno do portal
                if etapa_c not in ("aguardando_retorno_vaga", "aguardando_retorno_edicao",
                                   "aguardando_confirmacao_candidatura", "aguardando_retorno_selecao"):
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

                # --- SQS-49: Notificação de seleção por evento criada ---
                elif etapa_c == "aguardando_retorno_selecao":
                    selecao_criada_id = fluxo.get("vaga_criada_id")
                    if not selecao_criada_id:
                        continue
                    selecao_titulo = fluxo.get("vaga_titulo", "Processo Seletivo")
                    selecao_numero = fluxo.get("vaga_numero")
                    numero_ref = f"#{selecao_numero}" if selecao_numero else f"...{selecao_criada_id[-6:].upper()}"
                    await _enviar(
                        instance_name, token, phone,
                        f"✅ *Processo seletivo cadastrado com sucesso!*\n\n"
                        f"📋 *Título:* {selecao_titulo}\n"
                        f"🔢 *Número de referência:* {numero_ref}\n\n"
                        "A seleção já está visível para todas as unidades da rede CUCA. "
                        "Os candidatos poderão se inscrever e a equipe irá gerenciar as candidaturas pelo portal.\n\n"
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
                        "ultima_vaga_id": selecao_criada_id,
                    })
                    logger.info(f"[empreg-notify] Seleção por evento confirmada para conversa {conversa_id} — ref {numero_ref}")

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

                # --- Notificação de candidatura confirmada (candidato) ---
                elif etapa_c == "aguardando_confirmacao_candidatura":
                    candidatura_id = fluxo.get("candidatura_criada_id")
                    if not candidatura_id:
                        continue
                    eh_banco_talentos = fluxo.get("banco_talentos", False)
                    if eh_banco_talentos:
                        await _enviar(
                            instance_name, token, phone,
                            "✅ *Currículo salvo com sucesso!*\n\n"
                            "Seu currículo foi cadastrado no banco de talentos da rede CUCA. "
                            "Assim que surgir uma oportunidade compatível com seu perfil e área de interesse, "
                            "nossa equipe entrará em contato diretamente por aqui. 🎯\n\n"
                            "Obrigado por confiar na CUCA!\n\n"
                            "Deseja ver as *vagas abertas* ou encerrar por aqui?\n"
                            "Responda *vagas* para ver oportunidades ou *encerrar*."
                        )
                        _set_fluxo(conversa_id, {
                            "etapa": "candidatura_confirmada",
                            "perfil": "publico",
                        })
                        logger.info(f"[empreg-notify] Banco de talentos confirmado para conversa {conversa_id}")
                    else:
                        candidatura_codigo = fluxo.get("candidatura_codigo")
                        codigo = candidatura_codigo or candidatura_id.replace("-", "")[-6:].upper()
                        # S37C-02: Mensagem 1 — confirmação com o código
                        await _enviar(
                            instance_name, token, phone,
                            f"🎉 *Candidatura recebida com sucesso!*\n\n"
                            f"🔢 *Número de acompanhamento:* *{codigo}*\n\n"
                            "Guarde esse número! Com ele você pode verificar o status da sua candidatura a qualquer momento. ✅"
                        )
                        # S37C-02: Mensagem 2 — oferta de nova candidatura
                        await _enviar(
                            instance_name, token, phone,
                            "Deseja se candidatar a outra vaga da CUCA? 👀\n\n"
                            "Responda *outra* para ver mais vagas ou *encerrar* para finalizar."
                        )
                        # S37C-04/05: salva histórico e prefill
                        vaga_confirmada = fluxo.get("vaga_id_selecionada")
                        historico = list(fluxo.get("historico_vagas_aplicadas") or [])
                        if vaga_confirmada and vaga_confirmada not in historico:
                            historico.append(vaga_confirmada)
                        _set_fluxo(conversa_id, {
                            "etapa": "pos_candidatura",  # S37C-01
                            "perfil": "publico",
                            "ultima_candidatura_codigo": codigo,
                            "historico_vagas_aplicadas": historico,
                            "nome_candidato_prefill": fluxo.get("nome_candidato", ""),
                        })
                        logger.info(f"[empreg-notify] Confirmação enviada → pos_candidatura para conversa {conversa_id} — código {codigo}")

        except Exception as e:
            logger.error(f"[empreg-notify] Erro no loop: {e}")

        await asyncio.sleep(20)
