"""
S29-03 a S29-07 — Motor de Empregabilidade via WhatsApp
Instância unificada: atende empresa, candidato ativo e grande público no mesmo número.

Máquina de estados armazenada em conversas.metadata["empreg_fluxo"].
"""

import os
import re
import logging
import httpx
from supabase import create_client, Client

logger = logging.getLogger("empregabilidade_engine")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
UAZAPI_URL = os.getenv("UAZAPI_BASE_URL", "https://uazapi.com.br")
PORTAL_URL = os.getenv("PORTAL_URL", "https://portal.cuca.ce.gov.br")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


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
        f"📋 *Dados encontrados na Receita Federal:*",
        f"🏢 *Razão Social:* {nome}",
    ]
    if fantasia and fantasia != nome:
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
        emp_res = supabase.table("empresas").select("id, nome").eq("cnpj", cnpj_limpo).execute()
        if emp_res.data:
            empresa = emp_res.data[0]
            await _enviar(
                instance_name, token, phone,
                f"✅ Empresa *{empresa['nome']}* já está cadastrada!\n\n"
                "Deseja divulgar uma vaga agora? Responda *sim* ou *não*."
            )
            _set_fluxo(conversa_id, {
                "etapa": "aguardando_criar_vaga",
                "cnpj": cnpj_limpo,
                "empresa_id": empresa["id"],
                "empresa_nome": empresa["nome"],
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
        numero = endereco.get("numero") or ""
        end_completo = f"{logradouro}, {numero} — {municipio}/{uf}".strip(" ,—/")

        _set_fluxo(conversa_id, {
            "etapa": "confirmando_cadastro",
            "cnpj": cnpj_limpo,
            "dados_rf": {
                "nome": dados_rf.get("razao_social") or "",
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

        # Verificar se está confirmando
        if t in ("sim", "s", "confirmar", "confirmo", "correto", "ok", "certo", "isso"):
            # Criar empresa no banco
            emp_insert = supabase.table("empresas").insert({
                "nome": dados_rf.get("nome"),
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

            await _enviar(
                instance_name, token, phone,
                f"✅ *Cadastro realizado com sucesso!*\n\n"
                f"🏢 {empresa_nome} agora está na nossa base de parceiros.\n\n"
                "Deseja divulgar uma vaga agora? Responda *sim* ou *não*."
            )
            _set_fluxo(conversa_id, {
                "etapa": "aguardando_criar_vaga",
                "cnpj": cnpj,
                "empresa_id": empresa_id,
                "empresa_nome": empresa_nome,
            })
        else:
            # Usuário quer corrigir algo — aplicar correção e re-confirmar
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
            emp_insert = supabase.table("empresas").insert({
                "nome": dados_rf.get("nome"),
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

            await _enviar(
                instance_name, token, phone,
                f"✅ *Cadastro realizado com sucesso!*\n\n"
                f"🏢 {empresa_nome} agora está na nossa base.\n\n"
                "Deseja divulgar uma vaga agora? Responda *sim* ou *não*."
            )
            _set_fluxo(conversa_id, {
                "etapa": "aguardando_criar_vaga",
                "cnpj": cnpj,
                "empresa_id": empresa_id,
                "empresa_nome": empresa_nome,
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

        if t in ("sim", "s", "quero", "vou", "yes", "ok"):
            link_vaga = f"{PORTAL_URL}/empregabilidade/vagas/nova?empresa_id={empresa_id}"
            await _enviar(
                instance_name, token, phone,
                f"Ótimo! 🎯 Acesse o link abaixo para preencher os dados da vaga:\n\n"
                f"🔗 {link_vaga}\n\n"
                "Após o preenchimento, você receberá aqui o número da vaga e a confirmação. "
                "A vaga será revisada pela equipe do CUCA antes de ser publicada."
            )
            _set_fluxo(conversa_id, {
                "etapa": "aguardando_retorno_vaga",
                "empresa_id": empresa_id,
                "empresa_nome": empresa_nome,
                "cnpj": fluxo.get("cnpj"),
            })
        else:
            await _enviar(
                instance_name, token, phone,
                "Sem problema! Quando quiser divulgar uma vaga, é só entrar em contato novamente. 👋\n"
                "Para consultar suas vagas, informe seu *CNPJ* ou o *número da vaga*."
            )
            _set_fluxo(conversa_id, {"etapa": "consulta_empresa", "cnpj": fluxo.get("cnpj"), "empresa_id": empresa_id})
        return

    # --- ETAPA: aguardando_retorno_vaga (após link enviado) ---
    if etapa == "aguardando_retorno_vaga":
        await _enviar(
            instance_name, token, phone,
            "Aguardando o preenchimento do formulário de vaga. "
            "Assim que for concluído, você receberá a confirmação por aqui.\n\n"
            "Se precisar de ajuda, entre em contato com a equipe da unidade. 🤝"
        )
        return

    # --- ETAPA: consulta_empresa ---
    if etapa in ("consulta_empresa", "empresa_ativa"):
        await _processar_consulta_empresa(texto, phone, instance_name, token, fluxo, conversa_id)
        return

    # Fallback — iniciar fluxo empresa
    _set_fluxo(conversa_id, {"etapa": "solicitar_cnpj"})
    await _processar_empresa(texto, phone, instance_name, token, lead_id, conversa_id, unidade_cuca)


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
    cnpj = fluxo.get("cnpj")

    # Buscar pelo número da vaga (ex: "vaga 123" ou apenas o número)
    match_vaga = re.search(r"\b(\d{4,})\b", texto)
    if match_vaga:
        num = match_vaga.group(1)
        vagas_res = supabase.table("vagas").select(
            "id, titulo, status, total_vagas, created_at"
        ).eq("empresa_id", empresa_id).execute()

        # Filtrar por número (últimos dígitos do UUID ou campo numero se existir)
        vaga_match = None
        for v in (vagas_res.data or []):
            if v["id"][-6:].upper() in num.upper() or num in str(v.get("numero_vaga", "")):
                vaga_match = v
                break

        if vaga_match:
            # Contar candidatos
            cands = supabase.table("candidaturas").select("status", count="exact").eq("vaga_id", vaga_match["id"]).execute()
            total_cands = cands.count or 0
            await _enviar(
                instance_name, token, phone,
                f"📋 *Vaga:* {vaga_match['titulo']}\n"
                f"📌 *Status:* {vaga_match['status']}\n"
                f"👥 *Candidatos:* {total_cands}\n"
                f"🔢 *Referência:* ...{vaga_match['id'][-6:].upper()}"
            )
        else:
            await _enviar(instance_name, token, phone,
                          "Não encontrei essa vaga. Informe o número completo ou o CNPJ para ver todas as vagas.")
        return

    # Buscar por CNPJ ou listar todas
    if empresa_id:
        vagas_res = supabase.table("vagas").select(
            "id, titulo, status, total_vagas"
        ).eq("empresa_id", empresa_id).order("created_at", desc=True).limit(10).execute()
        vagas = vagas_res.data or []

        if not vagas:
            await _enviar(instance_name, token, phone,
                          "Sua empresa ainda não tem vagas cadastradas. Deseja criar uma? Responda *sim*.")
            return

        linhas = ["📋 *Suas vagas cadastradas:*\n"]
        for v in vagas:
            cands = supabase.table("candidaturas").select("id", count="exact").eq("vaga_id", v["id"]).execute()
            linhas.append(
                f"• *{v['titulo']}* — {v['status']} ({cands.count or 0} candidatos)\n"
                f"  Ref: ...{v['id'][-6:].upper()}"
            )
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

    if etapa == "solicitar_identificacao":
        await _enviar(
            instance_name, token, phone,
            "Para consultar sua candidatura, informe seu *CPF* (apenas números) "
            "ou o *número da candidatura* recebido no momento da inscrição:"
        )
        _set_fluxo(conversa_id, {"etapa": "aguardando_id_candidato"})
        return

    if etapa == "aguardando_id_candidato":
        # Tenta localizar por CPF (11 dígitos) ou número de candidatura
        apenas_digitos = re.sub(r"\D", "", texto)

        candidaturas_encontradas = []

        if len(apenas_digitos) == 11:
            # Busca por CPF via join candidatos → candidaturas
            cand_pessoa = supabase.table("candidatos").select("id").eq("cpf", apenas_digitos).execute()
            ids_candidatos = [c["id"] for c in (cand_pessoa.data or [])]
            if ids_candidatos:
                cand_res = supabase.table("candidaturas").select(
                    "id, status, vaga_id, created_at, candidato_id"
                ).in_("candidato_id", ids_candidatos).order("created_at", desc=True).limit(5).execute()
                candidaturas_encontradas = cand_res.data or []
        elif len(apenas_digitos) >= 6:
            # Busca por fragmento do UUID da candidatura
            todas = supabase.table("candidaturas").select(
                "id, status, vaga_id, created_at, candidato_id"
            ).order("created_at", desc=True).limit(200).execute()
            candidaturas_encontradas = [
                c for c in (todas.data or [])
                if c["id"].replace("-", "")[-6:].upper() == apenas_digitos[-6:].upper()
            ]

        if not candidaturas_encontradas:
            await _enviar(
                instance_name, token, phone,
                "Não encontrei candidatura com esse dado. Verifique e tente novamente, "
                "ou entre em contato diretamente com a unidade CUCA."
            )
            return

        linhas = ["📋 *Suas candidaturas:*\n"]
        for c in candidaturas_encontradas[:5]:
            vaga_res = supabase.table("vagas").select("titulo").eq("id", c["vaga_id"]).single().execute()
            titulo_vaga = (vaga_res.data or {}).get("titulo", "Vaga") if vaga_res.data else "Vaga"
            status_emoji = {
                "pendente": "⏳", "selecionado": "✅", "rejeitado": "❌", "contratado": "🎉"
            }.get(c.get("status", "pendente"), "⏳")
            linhas.append(
                f"{status_emoji} *{titulo_vaga}*\n"
                f"   Status: *{c.get('status', 'pendente').capitalize()}*\n"
                f"   Ref: ...{c['id'][-6:].upper()}"
            )
        await _enviar(instance_name, token, phone, "\n".join(linhas))
        _set_fluxo(conversa_id, {"etapa": "candidato_consultado"})
        return

    # Estado consultado — oferecer nova consulta
    await _enviar(
        instance_name, token, phone,
        "Posso ajudar com mais alguma coisa? Informe novamente seu CPF ou número de candidatura para consultar, "
        "ou pergunte sobre vagas abertas."
    )
    _set_fluxo(conversa_id, {"etapa": "aguardando_id_candidato"})


# ---------------------------------------------------------------------------
# Fluxo de GRANDE PÚBLICO
# ---------------------------------------------------------------------------

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

    # Buscar vagas abertas da unidade
    vagas_res = supabase.table("vagas").select(
        "id, titulo, tipo_contrato, salario, escolaridade_minima, total_vagas"
    ).eq("status", "aberta").eq("unidade_cuca", unidade_cuca).order("created_at", desc=True).limit(8).execute()
    vagas = vagas_res.data or []

    # Verificar se quer se candidatar a vaga específica
    match_vaga_ref = re.search(r"\b([A-F0-9]{6})\b", texto.upper())
    if match_vaga_ref or "candidatar" in texto.lower() or "quero essa" in texto.lower():
        vaga_id_ref = fluxo.get("ultima_vaga_id")
        if match_vaga_ref:
            ref = match_vaga_ref.group(1)
            todas_vagas = supabase.table("vagas").select("id, titulo").eq("status", "aberta").execute()
            vaga_match = next((v for v in (todas_vagas.data or []) if v["id"][-6:].upper() == ref), None)
            if vaga_match:
                vaga_id_ref = vaga_match["id"]

        if vaga_id_ref:
            link = f"{PORTAL_URL}/empregabilidade/candidatura?vaga_id={vaga_id_ref}"
            await _enviar(
                instance_name, token, phone,
                f"Ótimo! 🎯 Acesse o link abaixo para se candidatar:\n\n"
                f"🔗 {link}\n\n"
                "Após o envio, você receberá o número da sua candidatura para acompanhar o processo aqui mesmo. ✅"
            )
            _set_fluxo(conversa_id, {"etapa": "candidatura_enviada", "ultima_vaga_id": vaga_id_ref})
            return

    if not vagas:
        await _enviar(
            instance_name, token, phone,
            "No momento não há vagas abertas nesta unidade.\n"
            "Fique de olho! Você pode retornar a qualquer momento para verificar novas oportunidades. 👋"
        )
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

    linhas.append("\nPara se candidatar a uma vaga, informe o código dela acima ou diga *quero essa* após ver a vaga de interesse.")
    await _enviar(instance_name, token, phone, "\n".join(linhas))
    _set_fluxo(conversa_id, {"etapa": "listou_vagas", "ultima_vaga_id": ultima_vaga_id})


# ---------------------------------------------------------------------------
# Ponto de entrada principal
# ---------------------------------------------------------------------------

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

    # Se já tem perfil definido, continuar no fluxo
    if perfil_atual == "empresa":
        await _processar_empresa(texto, phone, instance_name, token, lead_id, conversa_id, unidade_cuca)
        return
    if perfil_atual == "candidato":
        await _processar_candidato(texto, phone, instance_name, token, lead_id, conversa_id)
        return
    if perfil_atual == "publico":
        await _processar_publico(texto, phone, instance_name, token, lead_id, conversa_id, unidade_cuca)
        return

    # Primeira interação ou perfil indefinido — identificar
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
        # Perfil indefinido — apresentar menu
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
