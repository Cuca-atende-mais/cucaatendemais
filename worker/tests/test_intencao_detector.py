"""
S-EMP-01-01 — Testes do IntencaoDetector.
Cenários obrigatórios (AC#10): candidato direto, banco de talentos, upload,
empresa, saudação ambígua e keyword composta.
"""
import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from intencao_detector import IntencaoDetector, extrair_nome_heuristico


# ─── Helper ───────────────────────────────────────────────────────────────────

def _classif(msg: str, midia: str = "", nome: str | None = None) -> dict:
    """Executa classificar de forma síncrona para uso nos testes."""
    detector = IntencaoDetector()
    return asyncio.get_event_loop().run_until_complete(
        detector.classificar(msg, midia, nome)
    )


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


# ─── extrair_nome_heuristico ──────────────────────────────────────────────────

def test_extrair_nome_primeiro_nome_maiusculo():
    assert extrair_nome_heuristico("Boa tarde, meu nome é Carlos") == "Carlos"


def test_extrair_nome_sem_nome():
    assert extrair_nome_heuristico("quero uma vaga") is None


def test_extrair_nome_texto_vazio():
    assert extrair_nome_heuristico("") is None


def test_extrair_nome_none():
    assert extrair_nome_heuristico(None) is None  # type: ignore[arg-type]
