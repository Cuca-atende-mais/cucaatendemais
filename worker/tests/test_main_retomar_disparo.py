"""
Testes do endpoint /retomar-disparo/{origem}/{item_id} (Plano 008/S-WM-60, Step 4).

Cobre só o AC4 (token ausente/inválido -> 403, sem side-effect) — o caminho de sucesso
(retomada de fato disparando) é coberto indiretamente pelos testes de
retomar_disparo_pausado/retomar_disparo_divulgacao_pausado em test_campanhas_engine.py,
chamados diretamente (sem passar pelo HTTP), já que o endpoint despacha via
BackgroundTasks (fire-and-forget) — testar o resultado do envio via HTTP exigiria
aguardar a task em background, fora do escopo deste teste de auth.
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
    """AC4: sem x-internal-token correto -> 403, sem side-effect (nenhuma chamada às
    funções de retomada)."""
    monkeypatch.setenv("WEBHOOK_INTERNAL_TOKEN", "segredo-teste-swm60")
    mock_retomar_pontual = AsyncMock()
    mock_retomar_divulgacao = AsyncMock()
    monkeypatch.setattr(camp, "retomar_disparo_pausado", mock_retomar_pontual)
    monkeypatch.setattr(camp, "retomar_disparo_divulgacao_pausado", mock_retomar_divulgacao)

    resp = client.post(
        "/retomar-disparo/eventos_pontuais/item-1",
        headers={"x-internal-token": "token-errado"},
    )

    assert resp.status_code == 403
    mock_retomar_pontual.assert_not_called()
    mock_retomar_divulgacao.assert_not_called()


def test_endpoint_retomar_disparo_sem_header_tambem_rejeita(monkeypatch, client):
    """Mesmo caso do AC4, sem header nenhum (não só valor errado)."""
    monkeypatch.setenv("WEBHOOK_INTERNAL_TOKEN", "segredo-teste-swm60")
    mock_retomar_pontual = AsyncMock()
    monkeypatch.setattr(camp, "retomar_disparo_pausado", mock_retomar_pontual)

    resp = client.post("/retomar-disparo/eventos_pontuais/item-1")

    assert resp.status_code == 403
    mock_retomar_pontual.assert_not_called()


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
