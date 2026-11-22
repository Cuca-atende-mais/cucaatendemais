"""
Testes do endpoint /empregabilidade/vaga-criada (S-EMP-GES-12): autenticação M2M (503/403),
validação do corpo (400) e repasse do status/corpo de `processar_vaga_criada_portal`. As
regras de envio são testadas direto na função, em test_empregabilidade_engine.py.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Mesmo cuidado de test_main_retomar_disparo.py: não deixar o Sentry real ligado nos testes.
os.environ["SENTRY_DSN_WORKER"] = ""

from unittest.mock import AsyncMock  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import empregabilidade_engine as emp  # noqa: E402
import main as worker_main  # noqa: E402

TOKEN = "segredo-teste-ges12"


@pytest.fixture
def client():
    return TestClient(worker_main.app)


@pytest.fixture
def mock_processar(monkeypatch):
    mock = AsyncMock(return_value=(200, {"confirmacao": True, "aviso_transbordo": True, "etapa_trocada": True}))
    monkeypatch.setattr(emp, "processar_vaga_criada_portal", mock)
    return mock


def test_sem_token_configurado_503(monkeypatch, client, mock_processar):
    monkeypatch.delenv("WEBHOOK_INTERNAL_TOKEN", raising=False)
    resp = client.post("/empregabilidade/vaga-criada", headers={"x-internal-token": "x"},
                       json={"vaga_id": "v", "conversa_id": "c"})
    assert resp.status_code == 503
    mock_processar.assert_not_called()


def test_token_errado_403(monkeypatch, client, mock_processar):
    monkeypatch.setenv("WEBHOOK_INTERNAL_TOKEN", TOKEN)
    resp = client.post("/empregabilidade/vaga-criada", headers={"x-internal-token": "errado"},
                       json={"vaga_id": "v", "conversa_id": "c"})
    assert resp.status_code == 403
    mock_processar.assert_not_called()


def test_sem_header_403(monkeypatch, client, mock_processar):
    monkeypatch.setenv("WEBHOOK_INTERNAL_TOKEN", TOKEN)
    resp = client.post("/empregabilidade/vaga-criada", json={"vaga_id": "v", "conversa_id": "c"})
    assert resp.status_code == 403
    mock_processar.assert_not_called()


@pytest.mark.parametrize("corpo", [
    {"vaga_id": "v"},
    {"conversa_id": "c"},
    {"vaga_id": "", "conversa_id": "c"},
    {"vaga_id": 1, "conversa_id": "c"},
    [],
])
def test_corpo_invalido_400(monkeypatch, client, mock_processar, corpo):
    monkeypatch.setenv("WEBHOOK_INTERNAL_TOKEN", TOKEN)
    resp = client.post("/empregabilidade/vaga-criada", headers={"x-internal-token": TOKEN}, json=corpo)
    assert resp.status_code == 400
    mock_processar.assert_not_called()


def test_corpo_que_nao_e_json_400(monkeypatch, client, mock_processar):
    monkeypatch.setenv("WEBHOOK_INTERNAL_TOKEN", TOKEN)
    resp = client.post("/empregabilidade/vaga-criada", headers={"x-internal-token": TOKEN,
                       "content-type": "application/json"}, content=b"nao-e-json")
    assert resp.status_code == 400
    mock_processar.assert_not_called()


@pytest.mark.parametrize("status_code,corpo", [
    (200, {"confirmacao": True, "aviso_transbordo": True, "etapa_trocada": True}),
    (502, {"confirmacao": False, "aviso_transbordo": False, "etapa_trocada": False}),
    (409, {"erro": "conversa de outra empresa"}),
    (404, {"erro": "vaga não encontrada"}),
])
def test_repassa_status_e_corpo(monkeypatch, client, mock_processar, status_code, corpo):
    monkeypatch.setenv("WEBHOOK_INTERNAL_TOKEN", TOKEN)
    mock_processar.return_value = (status_code, corpo)
    resp = client.post("/empregabilidade/vaga-criada", headers={"x-internal-token": TOKEN},
                       json={"vaga_id": "v-1", "conversa_id": "c-1"})
    assert resp.status_code == status_code
    assert resp.json() == corpo
    mock_processar.assert_awaited_once_with("v-1", "c-1")
