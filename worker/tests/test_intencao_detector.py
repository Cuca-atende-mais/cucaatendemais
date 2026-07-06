"""
S-EMP-01-01 — Testes do IntencaoDetector.
Cenários obrigatórios (AC#10): candidato direto, banco de talentos, upload,
empresa, saudação ambígua e keyword composta.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from intencao_detector import IntencaoDetector, avaliar_mensagem_contextual, extrair_nome_heuristico


# ─── Helper ───────────────────────────────────────────────────────────────────

def _classif(msg: str, midia: str = "", nome: str | None = None) -> dict:
    """Executa classificar de forma síncrona para uso nos testes.

    asyncio.run() em vez de asyncio.get_event_loop().run_until_complete(): o
    padrão antigo depende de haver um "current event loop" já setado na
    thread, o que quebra quando outros testes async (pytest-asyncio, modo
    STRICT) rodam antes na mesma sessão e fecham o loop deles."""
    detector = IntencaoDetector()
    return asyncio.run(detector.classificar(msg, midia, nome))


# ─── Cenários obrigatórios (AC#10) ────────────────────────────────────────────

def test_candidato_direto():
    """Lead diz 'quero uma vaga' → candidato_vaga, sem chamar GPT."""
    res = _classif("quero uma vaga")
    assert res["intencao"] == "candidato_vaga"


def test_banco_de_talentos_explicito():
    """Lead diz que quer deixar currículo no banco de talentos → banco_talentos."""
    res = _classif("quero deixar meu currículo no banco de talentos")
    assert res["intencao"] == "banco_talentos"


def test_upload_documento():
    """Lead envia documento (PDF) → upload independe do texto."""
    res = _classif("", midia="document")
    assert res["intencao"] == "upload"


def test_upload_imagem():
    """Lead envia imagem → upload."""
    res = _classif("curriculo.jpg", midia="image")
    assert res["intencao"] == "upload"


def test_empresa_cnpj_keyword():
    """Lead menciona CNPJ → empresa."""
    res = _classif("tenho um CNPJ, quero abrir uma vaga")
    assert res["intencao"] == "empresa"


def test_saudacao_ambigua_sem_gpt(monkeypatch):
    """Saudação 'Bom dia' não tem keyword; GPT mockado retorna ambiguo → ambiguo."""
    async def mock_gpt(self, texto, lead_nome):
        return {"intencao": "ambiguo", "nome": lead_nome}

    monkeypatch.setattr(IntencaoDetector, "_gpt_fallback", mock_gpt)
    res = _classif("Bom dia")
    assert res["intencao"] == "ambiguo"


def test_keyword_composta_vaga_e_saudacao():
    """'Boa tarde, quero me candidatar a uma vaga de emprego' → candidato_vaga."""
    res = _classif("Boa tarde, quero me candidatar a uma vaga de emprego")
    assert res["intencao"] == "candidato_vaga"


def test_empresa_abrir_uma_vaga_nao_deveria_inverter_intencao(monkeypatch):
    """Bug 4 (relatório, 04/07/2026): 'abrir uma vaga' (com 'uma' no meio) não
    batia com a keyword exata 'abrir vaga' de KEYWORDS_EMPRESA, caía em
    KEYWORDS_VAGA pela palavra solta 'vaga' e classificava como candidato_vaga
    — o oposto do que a empresa quis dizer. Resolvido pelo classificador
    semântico da Task 3 (S-WM-20): `avaliar_mensagem_contextual`, decisão
    primária em produção, sem keywords antes do LLM."""
    import intencao_detector

    async def mock_gpt(texto, perfil, etapa, ultima_msg_bot):
        return {"intencao": "empresa", "quer_sair": False, "mudou_de_assunto": False}

    monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", mock_gpt)
    res = asyncio.run(avaliar_mensagem_contextual(
        "gostaria de saber como faço para abrir uma vaga para ser gerida pela rede cuca"
    ))
    assert res["intencao"] == "empresa"


# ─── Testes adicionais ────────────────────────────────────────────────────────

def test_banco_talentos_curriculo_sozinho():
    """'currículo' sozinho → banco_talentos."""
    res = _classif("Preciso enviar meu currículo")
    assert res["intencao"] == "banco_talentos"


def test_empresa_processo_seletivo():
    """Empresa usando 'processo seletivo' → empresa."""
    res = _classif("Quero fazer um processo seletivo para minha empresa")
    assert res["intencao"] == "empresa"


def test_nome_passado_preservado():
    """Nome do lead é preservado no resultado."""
    res = _classif("quero uma vaga", nome="João")
    assert res["nome"] == "João"


def test_nome_none_quando_ausente():
    """Sem nome disponível retorna None."""
    res = _classif("quero uma vaga", nome=None)
    assert res["nome"] is None


def test_upload_tem_prioridade_sobre_keywords():
    """Mesmo que texto diga 'banco de talentos', se midia=document → upload."""
    res = _classif("banco de talentos", midia="document")
    assert res["intencao"] == "upload"


def test_gpt_fallback_retorna_categoria_valida(monkeypatch):
    """GPT retornando valor válido é aceito."""
    async def mock_gpt(self, texto, lead_nome):
        return {"intencao": "candidato_vaga", "nome": lead_nome}

    monkeypatch.setattr(IntencaoDetector, "_gpt_fallback", mock_gpt)
    res = _classif("estou procurando algo")
    assert res["intencao"] == "candidato_vaga"


def test_gpt_fallback_valor_invalido_vira_ambiguo(monkeypatch):
    """GPT retornando categoria desconhecida é normalizado para ambiguo."""
    async def mock_gpt(self, texto, lead_nome):
        return {"intencao": "desconhecido", "nome": lead_nome}

    monkeypatch.setattr(IntencaoDetector, "_gpt_fallback", mock_gpt)
    res = _classif("mensagem estranha xyz")
    assert res["intencao"] == "ambiguo"


def test_gpt_fallback_excecao_vira_ambiguo(monkeypatch):
    """Erro no GPT → graceful degradation para ambiguo."""
    async def mock_gpt_error(self, texto, lead_nome):
        raise RuntimeError("OpenAI indisponível")

    monkeypatch.setattr(IntencaoDetector, "_gpt_fallback", mock_gpt_error)
    res = _classif("oi tudo bem")
    assert res["intencao"] == "ambiguo"


# ─── avaliar_mensagem_contextual (S-WM-20 Task 3) ─────────────────────────────

def test_contextual_upload_nao_chama_llm():
    """Upload é sinal dominante — não deveria nem tentar chamar o LLM."""
    res = asyncio.run(avaliar_mensagem_contextual("", midia_tipo="document"))
    assert res["intencao"] == "upload"
    assert res["quer_sair"] is False
    assert res["mudou_de_assunto"] is False


def test_contextual_digito_puro_nao_chama_llm():
    """AC#2: dígito puro (atalho de menu) responde sem chamar o LLM."""
    res = asyncio.run(avaliar_mensagem_contextual("2"))
    assert res["quer_sair"] is False
    assert res["mudou_de_assunto"] is False


def test_contextual_texto_vazio_retorna_default():
    res = asyncio.run(avaliar_mensagem_contextual(""))
    assert res["intencao"] == "ambiguo"


def test_contextual_repassa_quer_sair_e_mudou_de_assunto(monkeypatch):
    """AC#3: frase livre chama o LLM com o contexto completo e repassa os
    sinais de escape (quer_sair, mudou_de_assunto) tal como retornados."""
    import intencao_detector

    capturado = {}

    async def mock_gpt(texto, perfil, etapa, ultima_msg_bot):
        capturado.update(texto=texto, perfil=perfil, etapa=etapa, ultima_msg_bot=ultima_msg_bot)
        return {"intencao": "empresa", "quer_sair": False, "mudou_de_assunto": True}

    monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", mock_gpt)
    res = asyncio.run(avaliar_mensagem_contextual(
        "nao nao, sou uma empresa", perfil="candidato", etapa="aguardando_id_candidato",
        ultima_msg_bot="Informe seu CPF ou telefone",
    ))
    assert res == {"intencao": "empresa", "quer_sair": False, "mudou_de_assunto": True, "nome": None}
    assert capturado == {
        "texto": "nao nao, sou uma empresa", "perfil": "candidato",
        "etapa": "aguardando_id_candidato", "ultima_msg_bot": "Informe seu CPF ou telefone",
    }


def test_contextual_intencao_invalida_vira_ambiguo(monkeypatch):
    import intencao_detector

    async def mock_gpt(texto, perfil, etapa, ultima_msg_bot):
        return {"intencao": "nao_existe", "quer_sair": False, "mudou_de_assunto": False}

    monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", mock_gpt)
    res = asyncio.run(avaliar_mensagem_contextual("mensagem qualquer"))
    assert res["intencao"] == "ambiguo"


def test_contextual_excecao_vira_default_seguro(monkeypatch):
    """Falha no LLM (rede, JSON malformado, etc.) nunca deve travar o fluxo."""
    import intencao_detector

    async def mock_gpt_error(texto, perfil, etapa, ultima_msg_bot):
        raise RuntimeError("OpenAI indisponível")

    monkeypatch.setattr(intencao_detector, "_chamar_gpt_contextual", mock_gpt_error)
    res = asyncio.run(avaliar_mensagem_contextual("mensagem qualquer"))
    assert res == {"intencao": "ambiguo", "quer_sair": False, "mudou_de_assunto": False, "nome": None}


# ─── extrair_setor_da_mensagem ────────────────────────────────────────────────

def test_setor_vendas():
    from intencao_detector import extrair_setor_da_mensagem
    kw, canonical = extrair_setor_da_mensagem("quero vaga de vendas")
    assert kw == "vendas"
    assert canonical == "Comércio"


def test_setor_administrativo():
    from intencao_detector import extrair_setor_da_mensagem
    kw, canonical = extrair_setor_da_mensagem("procuro emprego na área administrativa")
    assert kw in ("administrativo", "administrativa")
    assert canonical == "Administrativo"


def test_setor_saude_nao_encontrado():
    """Saúde não é um setor no SETORES_VAGA — retorna (None, None) graciosamente."""
    from intencao_detector import extrair_setor_da_mensagem
    kw, canonical = extrair_setor_da_mensagem("quero vaga na área de saúde")
    assert kw is None
    assert canonical is None


def test_setor_nenhum():
    from intencao_detector import extrair_setor_da_mensagem
    kw, canonical = extrair_setor_da_mensagem("quero uma vaga")
    assert kw is None
    assert canonical is None


def test_setor_banco_talentos_nao_confunde():
    """'banco de talentos' tem guard para não ser confundido com setor."""
    from intencao_detector import extrair_setor_da_mensagem
    kw, canonical = extrair_setor_da_mensagem("quero banco de talentos")
    assert kw is None
    assert canonical is None


# ─── extrair_nome_heuristico ──────────────────────────────────────────────────

def test_extrair_nome_primeiro_nome_maiusculo():
    assert extrair_nome_heuristico("Boa tarde, meu nome é Carlos") == "Carlos"


def test_extrair_nome_sem_nome():
    assert extrair_nome_heuristico("quero uma vaga") is None


def test_extrair_nome_texto_vazio():
    assert extrair_nome_heuristico("") is None


def test_extrair_nome_none():
    assert extrair_nome_heuristico(None) is None  # type: ignore[arg-type]
