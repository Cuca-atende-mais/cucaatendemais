"""PLANO-023: registro de consumo do worker em ai_usage_logs."""
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

import llm_usage

PRECOS = {"gpt-4o": {"in": 2.5, "cached_in": 1.25, "out": 10.0},
          "gpt-4o-mini": {"in": 0.15, "cached_in": 0.075, "out": 0.6}}


def _resposta(modelo="gpt-4o-2024-08-06", prompt=1000, cached=200, saida=400, rid="chatcmpl-1"):
    usage = SimpleNamespace(prompt_tokens=prompt, completion_tokens=saida,
                            prompt_tokens_details=SimpleNamespace(cached_tokens=cached))
    return SimpleNamespace(id=rid, model=modelo, usage=usage)


def test_custo_separa_cache_e_escolhe_o_modelo_certo():
    assert llm_usage.calcular_custo_usd("gpt-4o-2024-08-06", 1000, 200, 400, PRECOS) == pytest.approx(
        (800 * 2.5 + 200 * 1.25 + 400 * 10) / 1e6)
    assert llm_usage.calcular_custo_usd("gpt-4o-mini-2024-07-18", 1000, 0, 0, PRECOS) == pytest.approx(1000 * 0.15 / 1e6)


def test_custo_null_sem_preco_ou_modelo_desconhecido():
    assert llm_usage.calcular_custo_usd("gpt-4o", 10, 0, 1, None) is None
    assert llm_usage.calcular_custo_usd("whisper-1", 10, 0, 1, PRECOS) is None


def test_grava_linha_sem_colunas_geradas(monkeypatch):
    sb = MagicMock()
    sb.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = \
        SimpleNamespace(data=[{"valor": '{"gpt-4o": {"in": 2.5, "cached_in": 1.25, "out": 10.0}}'}])
    monkeypatch.setattr(llm_usage, "_supabase", lambda: sb)
    monkeypatch.setattr(llm_usage, "_precos_expira_em", 0.0)
    linha = {**llm_usage._extrair(_resposta()), "feature": "ocr", "agente_tipo": None,
             "conversa_id": None, "blocos_contexto": None, "latencia_ms": None}
    llm_usage._gravar(linha)
    enviado = sb.table.return_value.insert.call_args[0][0]
    assert enviado["feature"] == "ocr"
    assert enviado["tokens_prompt"] == 1000 and enviado["tokens_prompt_cached"] == 200 and enviado["tokens_completion"] == 400
    assert enviado["openai_request_id"] == "chatcmpl-1"
    assert enviado["custo_usd"] == pytest.approx((800 * 2.5 + 200 * 1.25 + 400 * 10) / 1e6)
    assert "tokens_total" not in enviado and "custo_estimado_usd" not in enviado


def test_falha_do_banco_nunca_propaga(monkeypatch):
    sb = MagicMock()
    sb.table.side_effect = RuntimeError("banco fora do ar")
    monkeypatch.setattr(llm_usage, "_supabase", lambda: sb)
    llm_usage._gravar({"modelo": "gpt-4o", "tokens_prompt": 1, "tokens_prompt_cached": 0,
                       "tokens_completion": 1, "feature": "ocr"})  # não levanta


def test_registrar_uso_nunca_propaga_nem_com_resposta_estranha(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "http://exemplo")
    enviados = []
    monkeypatch.setattr(llm_usage._executor, "submit", lambda fn, linha: enviados.append(linha))
    llm_usage.registrar_uso(object(), feature="intencao")          # sem usage
    llm_usage.registrar_uso(_resposta(), feature="matching")
    llm_usage.registrar_uso(SimpleNamespace(text="oi"), feature="transcription", modelo="whisper-1")
    assert [e["feature"] for e in enviados] == ["intencao", "matching", "transcription"]
    assert enviados[2]["modelo"] == "whisper-1" and enviados[2]["tokens_prompt"] == 0


def test_sem_ambiente_nao_faz_nada(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    chamado = []
    monkeypatch.setattr(llm_usage._executor, "submit", lambda *a: chamado.append(a))
    llm_usage.registrar_uso(_resposta(), feature="ocr")
    assert chamado == []
