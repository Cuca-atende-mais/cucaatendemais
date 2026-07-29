"""
Testes do endpoint /retomar-disparo/{origem}/{item_id} (Plano 008/S-WM-60, Step 4).

Cobre o AC4 (token ausente/inválido -> 403, sem side-effect) e, desde a S-WM-59 (item 2),
a resposta SÍNCRONA do claim (404/409/500 real, sem esperar background) — o restante do
envio de fato (loop, pode levar minutos) continua coberto indiretamente pelos testes de
retomar_disparo_pausado/retomar_disparo_divulgacao_pausado em test_campanhas_engine.py,
chamados diretamente (sem passar pelo HTTP).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# main.py inicializa o Sentry SDK real (sentry_sdk.init) em nível de módulo, se
# SENTRY_DSN_WORKER estiver setado no ambiente (.env local de dev) — sem isso, os logs de
# ERROR/CRITICAL emitidos pelos testes abaixo (ex.: o teste de falha fechada) seriam
# enviados de verdade pro Sentry de produção. String vazia (não os.environ.pop) porque
# main.py chama load_dotenv() na própria importação, DEPOIS deste ponto — python-dotenv só
# preenche chaves ausentes de os.environ (override=False por padrão); um pop() deixaria a
# chave "ausente" de novo e o load_dotenv() reintroduziria o valor real do .env.
os.environ["SENTRY_DSN_WORKER"] = ""

from unittest.mock import AsyncMock  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import campanhas_engine as camp  # noqa: E402
import main as worker_main  # noqa: E402


@pytest.fixture
def client():
    return TestClient(worker_main.app)


def test_endpoint_retomar_disparo_exige_token(monkeypatch, client):
    """AC4: sem x-internal-token correto -> 403, sem side-effect (nenhuma chamada ao
    claim síncrono nem à continuação em background)."""
    monkeypatch.setenv("WEBHOOK_INTERNAL_TOKEN", "segredo-teste-swm60")
    mock_reivindicar_pontual = AsyncMock()
    mock_reivindicar_divulgacao = AsyncMock()
    monkeypatch.setattr(camp, "reivindicar_retomada_pontual", mock_reivindicar_pontual)
    monkeypatch.setattr(camp, "reivindicar_retomada_divulgacao", mock_reivindicar_divulgacao)

    resp = client.post(
        "/retomar-disparo/eventos_pontuais/item-1",
        headers={"x-internal-token": "token-errado"},
    )

    assert resp.status_code == 403
    mock_reivindicar_pontual.assert_not_called()
    mock_reivindicar_divulgacao.assert_not_called()


def test_endpoint_retomar_disparo_sem_header_tambem_rejeita(monkeypatch, client):
    """Mesmo caso do AC4, sem header nenhum (não só valor errado)."""
    monkeypatch.setenv("WEBHOOK_INTERNAL_TOKEN", "segredo-teste-swm60")
    mock_reivindicar_pontual = AsyncMock()
    monkeypatch.setattr(camp, "reivindicar_retomada_pontual", mock_reivindicar_pontual)

    resp = client.post("/retomar-disparo/eventos_pontuais/item-1")

    assert resp.status_code == 403
    mock_reivindicar_pontual.assert_not_called()


def test_endpoint_retomar_disparo_falha_fechada_sem_token_configurado(monkeypatch, client):
    """Se WEBHOOK_INTERNAL_TOKEN não estiver configurado no worker, rejeita sempre (503) —
    mesmo padrão fail-closed já usado em /academia-enem/process."""
    monkeypatch.delenv("WEBHOOK_INTERNAL_TOKEN", raising=False)

    resp = client.post(
        "/retomar-disparo/eventos_pontuais/item-1",
        headers={"x-internal-token": "qualquer-coisa"},
    )

    assert resp.status_code == 503


def test_endpoint_retomar_disparo_rejeita_origem_invalida(monkeypatch, client):
    """origem fora de {eventos_pontuais, ouvidoria_eventos, divulgacao} -> 400."""
    monkeypatch.setenv("WEBHOOK_INTERNAL_TOKEN", "segredo-teste-swm60")

    resp = client.post(
        "/retomar-disparo/origem-inventada/item-1",
        headers={"x-internal-token": "segredo-teste-swm60"},
    )

    assert resp.status_code == 400


def test_endpoint_retomar_disparo_pontual_nao_encontrado_retorna_404_sincrono(monkeypatch, client):
    """S-WM-59 (item 2): antes desta divisão, o endpoint SEMPRE respondia 200
    "retomada_iniciada", mesmo pra um item_id inexistente — o erro só existia dentro da
    tarefa em background, invisível pro chamador HTTP. Confirma que o claim agora roda de
    forma síncrona e o 404 real chega na resposta, sem precisar esperar nenhum background
    task rodar."""
    monkeypatch.setenv("WEBHOOK_INTERNAL_TOKEN", "segredo-teste-swm60")
    monkeypatch.setattr(camp, "reivindicar_retomada_pontual", AsyncMock(return_value={
        "ok": False, "status_code": 404, "motivo": "item não encontrado",
    }))
    mock_continuar = AsyncMock()
    monkeypatch.setattr(camp, "continuar_retomada_pontual", mock_continuar)

    resp = client.post(
        "/retomar-disparo/eventos_pontuais/item-inexistente",
        headers={"x-internal-token": "segredo-teste-swm60"},
    )

    assert resp.status_code == 404
    assert "não encontrado" in resp.text
    mock_continuar.assert_not_called()


def test_endpoint_retomar_disparo_pontual_nao_pausado_retorna_409_sincrono(monkeypatch, client):
    """Item existe mas não está mais pausado por limite diário (já foi concluído, por
    exemplo) -> 409 real na resposta, não 200 genérico."""
    monkeypatch.setenv("WEBHOOK_INTERNAL_TOKEN", "segredo-teste-swm60")
    monkeypatch.setattr(camp, "reivindicar_retomada_pontual", AsyncMock(return_value={
        "ok": False, "status_code": 409,
        "motivo": "item não está pausado por limite diário (status atual: 'concluida')",
    }))
    mock_continuar = AsyncMock()
    monkeypatch.setattr(camp, "continuar_retomada_pontual", mock_continuar)

    resp = client.post(
        "/retomar-disparo/eventos_pontuais/item-ja-concluido",
        headers={"x-internal-token": "segredo-teste-swm60"},
    )

    assert resp.status_code == 409
    mock_continuar.assert_not_called()


def test_endpoint_retomar_disparo_divulgacao_corrida_perdida_retorna_409_sincrono(monkeypatch, client):
    """Espelho pro lado divulgação — o cenário exato da corrida que a QA reproduziu no gate
    da S-WM-60 (2 chamadas concorrentes) agora vira um 409 visível na resposta HTTP da
    chamada perdedora, não silêncio."""
    monkeypatch.setenv("WEBHOOK_INTERNAL_TOKEN", "segredo-teste-swm60")
    monkeypatch.setattr(camp, "reivindicar_retomada_divulgacao", AsyncMock(return_value={
        "ok": False, "status_code": 409,
        "motivo": "disparo já reivindicado por outra retomada concorrente — corrida evitada, nada enviado por esta chamada",
    }))
    mock_continuar = AsyncMock()
    monkeypatch.setattr(camp, "continuar_retomada_divulgacao", mock_continuar)

    resp = client.post(
        "/retomar-disparo/divulgacao/disparo-1",
        headers={"x-internal-token": "segredo-teste-swm60"},
    )

    assert resp.status_code == 409
    mock_continuar.assert_not_called()


def test_endpoint_retomar_disparo_pontual_sucesso_agenda_continuacao_correta(monkeypatch, client):
    """Achado da revisão de arquitetura (S-WM-59, ao decidir a divisão claim/continuação):
    o endpoint precisa agendar continuar_retomada_pontual em background (que assume o claim
    já feito) — NUNCA retomar_disparo_pausado (a função de composição, que reexecutaria o
    claim já feito aqui e faria no-op silencioso, sem enviar nada). Este teste garante que
    é a função certa que é agendada, com os argumentos corretos vindos do claim."""
    monkeypatch.setenv("WEBHOOK_INTERNAL_TOKEN", "segredo-teste-swm60")
    item_fake = {"id": "item-1", "status": "em_andamento", "disparo_id": "disparo-1"}
    monkeypatch.setattr(camp, "reivindicar_retomada_pontual", AsyncMock(return_value={
        "ok": True, "item": item_fake, "disparo_id": "disparo-1",
    }))
    mock_continuar = AsyncMock(return_value={"status": "concluida", "pendentes_encontrados": 0})
    monkeypatch.setattr(camp, "continuar_retomada_pontual", mock_continuar)
    # Não deve ser chamada pelo endpoint — reexecutaria o claim (no-op silencioso).
    mock_composicao = AsyncMock()
    monkeypatch.setattr(camp, "retomar_disparo_pausado", mock_composicao)

    resp = client.post(
        "/retomar-disparo/eventos_pontuais/item-1",
        headers={"x-internal-token": "segredo-teste-swm60"},
    )

    assert resp.status_code == 200
    assert resp.json() == {"status": "retomada_iniciada"}
    mock_continuar.assert_called_once()
    args = mock_continuar.call_args.args
    assert args[0] == item_fake
    assert args[1] == "eventos_pontuais"
    assert args[2] == "disparo-1"
    mock_composicao.assert_not_called()
