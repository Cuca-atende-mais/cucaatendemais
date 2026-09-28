"""PLANO-028 (reserva atômica do OCR) e ACHADO-014 (currículo espontâneo em PDF)."""
import asyncio
import base64
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

import cv_processor
import ocr_reserva


def _sb_rpc(respostas):
    """Supabase falso: rpc(nome, params).execute() devolve respostas[nome]; registra as chamadas."""
    sb = MagicMock()
    chamadas = []

    def rpc(nome, params):
        chamadas.append((nome, params))
        valor = respostas[nome]
        if isinstance(valor, Exception):
            raise valor
        return SimpleNamespace(execute=lambda: SimpleNamespace(data=valor))

    sb.rpc.side_effect = rpc
    return sb, chamadas


def _rodar(coro):
    return asyncio.get_event_loop().run_until_complete(coro) if False else asyncio.run(coro)


def test_reserva_perdida_nao_processa(monkeypatch):
    sb, chamadas = _sb_rpc({"reservar_ocr_candidatura": None})
    processar = AsyncMock(return_value=True)
    monkeypatch.setattr(cv_processor, "supabase", sb)
    monkeypatch.setattr(cv_processor, "process_cv_ocr", processar)
    assert _rodar(ocr_reserva.processar_cv_com_reserva("c1", "u.pdf", "v1", origem="loop")) is False
    processar.assert_not_called()
    assert [n for n, _ in chamadas] == ["reservar_ocr_candidatura"]


def test_reserva_ganha_processa_com_token_e_finaliza_ok(monkeypatch):
    sb, chamadas = _sb_rpc({"reservar_ocr_candidatura": "tok-1", "finalizar_ocr_candidatura": True})
    processar = AsyncMock(return_value=True)
    monkeypatch.setattr(cv_processor, "supabase", sb)
    monkeypatch.setattr(cv_processor, "process_cv_ocr", processar)
    assert _rodar(ocr_reserva.processar_cv_com_reserva("c1", "u.pdf", "v1", "Vendedor", origem="endpoint")) is True
    processar.assert_awaited_once_with("c1", "u.pdf", "v1", "Vendedor", ocr_token="tok-1")
    assert chamadas[0][1]["p_max_tentativas"] == ocr_reserva.OCR_MAX_TENTATIVAS
    assert chamadas[-1] == ("finalizar_ocr_candidatura", {"p_candidatura_id": "c1", "p_token": "tok-1", "p_status": "ok"})


def test_falha_no_ocr_finaliza_erro(monkeypatch):
    sb, chamadas = _sb_rpc({"reservar_ocr_candidatura": "tok-2", "finalizar_ocr_candidatura": True})
    monkeypatch.setattr(cv_processor, "supabase", sb)
    monkeypatch.setattr(cv_processor, "process_cv_ocr", AsyncMock(return_value=False))
    assert _rodar(ocr_reserva.processar_cv_com_reserva("c1", "u.pdf", "v1")) is False
    assert chamadas[-1][1]["p_status"] == "erro"


def test_excecao_no_ocr_libera_a_reserva(monkeypatch):
    sb, chamadas = _sb_rpc({"reservar_ocr_candidatura": "tok-3", "finalizar_ocr_candidatura": True})
    monkeypatch.setattr(cv_processor, "supabase", sb)
    monkeypatch.setattr(cv_processor, "process_cv_ocr", AsyncMock(side_effect=RuntimeError("caiu")))
    with pytest.raises(RuntimeError):
        _rodar(ocr_reserva.processar_cv_com_reserva("c1", "u.pdf", "v1"))
    assert chamadas[-1][0] == "finalizar_ocr_candidatura" and chamadas[-1][1]["p_status"] == "erro"


def test_erro_ao_reservar_nao_processa(monkeypatch):
    sb, _ = _sb_rpc({"reservar_ocr_candidatura": RuntimeError("banco fora")})
    processar = AsyncMock()
    monkeypatch.setattr(cv_processor, "supabase", sb)
    monkeypatch.setattr(cv_processor, "process_cv_ocr", processar)
    assert _rodar(ocr_reserva.processar_cv_com_reserva("c1", "u.pdf", "v1")) is False
    processar.assert_not_called()


def _sb_ocr(gravou: bool):
    """Supabase falso para process_cv_ocr: leituras de candidatura/vaga e o update com token."""
    sb = MagicMock()
    updates = []

    def table(nome):
        t = MagicMock()
        if nome == "vagas":
            t.select.return_value.eq.return_value.single.return_value.execute.return_value = SimpleNamespace(
                data={"titulo": "Vendedor", "requisitos": "", "escolaridade_minima": "", "tipo": "normal"})
        if nome == "candidaturas":
            t.select.return_value.eq.return_value.single.return_value.execute.return_value = SimpleNamespace(
                data={"candidato_id": None, "telefone": "85999990000"})

            def update(payload):
                cadeia = MagicMock()
                filtros = []

                def eq(col, val):
                    filtros.append((col, val))
                    return cadeia
                cadeia.eq.side_effect = eq
                cadeia.execute.side_effect = lambda: (updates.append((payload, list(filtros))),
                                                      SimpleNamespace(data=[{"id": "c1"}] if gravou else []))[1]
                return cadeia
            t.update.side_effect = update
        return t
    sb.table.side_effect = table
    return sb, updates


def _resposta_ia(conteudo):
    return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=conteudo))], usage=None, model="gpt-4o", id="x")


def test_ocr_com_token_confere_o_token_ao_gravar(monkeypatch):
    sb, updates = _sb_ocr(gravou=True)
    monkeypatch.setattr(cv_processor, "supabase", sb)
    monkeypatch.setattr(cv_processor, "download_file_bytes", AsyncMock(return_value=b"%PDF"))
    monkeypatch.setattr(cv_processor, "extract_text_from_pdf", lambda b: "Currículo " * 50)
    monkeypatch.setattr(cv_processor.client.chat.completions, "create",
                        AsyncMock(return_value=_resposta_ia('{"match_score": 70, "analise_aderencia": {"veredito": "✅"}}')))
    assert _rodar(cv_processor.process_cv_ocr("c1", "u.pdf", "v1", ocr_token="tok-9")) is True
    assert ("ocr_token", "tok-9") in updates[0][1]


def test_ocr_descarta_resultado_se_outro_executor_assumiu(monkeypatch):
    sb, updates = _sb_ocr(gravou=False)
    monkeypatch.setattr(cv_processor, "supabase", sb)
    monkeypatch.setattr(cv_processor, "download_file_bytes", AsyncMock(return_value=b"%PDF"))
    monkeypatch.setattr(cv_processor, "extract_text_from_pdf", lambda b: "Currículo " * 50)
    monkeypatch.setattr(cv_processor.client.chat.completions, "create",
                        AsyncMock(return_value=_resposta_ia('{"match_score": 70, "telefone": "85988887777"}')))
    assert _rodar(cv_processor.process_cv_ocr("c1", "u.pdf", "v1", ocr_token="tok-velho")) is False
    assert len(updates) == 1  # não seguiu para gravar telefone depois de perder a reserva


def test_espontaneo_pdf_envia_o_texto_do_curriculo(monkeypatch):
    sb = MagicMock()
    sb.rpc.return_value.execute.return_value = SimpleNamespace(data=1)
    monkeypatch.setattr(cv_processor, "supabase", sb)
    monkeypatch.setattr(cv_processor, "download_file_as_base64", AsyncMock(return_value=base64.b64encode(b"%PDF").decode()))
    monkeypatch.setattr(cv_processor, "extract_text_from_pdf", lambda b: "Experiência: vendedora na loja X. " * 20)
    criar = AsyncMock(return_value=_resposta_ia('{"habilidades": ["vendas"]}'))
    monkeypatch.setattr(cv_processor.client.chat.completions, "create", criar)
    _rodar(cv_processor.process_cv_espontaneo("Ana", "(85) 99999-0000", "https://x/cv.pdf"))
    enviado = criar.call_args.kwargs["messages"][1]["content"]
    assert "vendedora na loja X" in enviado and "base64" not in enviado
    nome, params = sb.rpc.call_args[0]
    assert nome == "atualizar_skills_talento_por_telefone" and params["p_telefone"] == "(85) 99999-0000"
    assert params["p_skills"]["origem"] == "candidatura_espontanea"


def test_espontaneo_pdf_escaneado_nao_vai_para_a_ia(monkeypatch):
    monkeypatch.setattr(cv_processor, "supabase", MagicMock())
    monkeypatch.setattr(cv_processor, "download_file_as_base64", AsyncMock(return_value=base64.b64encode(b"%PDF").decode()))
    monkeypatch.setattr(cv_processor, "extract_text_from_pdf", lambda b: "")
    criar = AsyncMock()
    monkeypatch.setattr(cv_processor.client.chat.completions, "create", criar)
    _rodar(cv_processor.process_cv_espontaneo("Ana", "85999990000", "https://x/cv.pdf"))
    criar.assert_not_called()
