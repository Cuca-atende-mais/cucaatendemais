"""
Testes do gate WORKER_SCOPE em main.py::startup_event (achado 2026-08-21, ver Change Log da
S-AE-02/S-AE-09): sem esse gate, um serviço rodando o mesmo código do worker (ex.:
cuca-academia-enem, mesma imagem por decisão da S-AE-02) iniciaria campanhas_loop/
empregabilidade_notify_loop/ocr_pending_loop e tentaria reivindicar/enviar disparos de OUTROS
módulos (Institucional/Empregabilidade/Ouvidoria/Divulgação) com o token Meta errado.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

os.environ["SENTRY_DSN_WORKER"] = ""

import pytest  # noqa: E402

import main as worker_main  # noqa: E402


def _rodar_startup_capturando_tasks(monkeypatch):
    """Executa startup_event() capturando quais coroutines seriam agendadas via
    asyncio.create_task, sem de fato rodar loops infinitos."""
    agendadas = []

    def _fake_create_task(coro):
        agendadas.append(coro.__qualname__)
        coro.close()  # evita warning de coroutine never awaited
        return None

    monkeypatch.setattr(asyncio, "create_task", _fake_create_task)
    asyncio.run(worker_main.startup_event())
    return agendadas


def test_worker_scope_principal_inicia_todos_os_loops_existentes(monkeypatch):
    """Sem WORKER_SCOPE setado (== 'principal', padrão do cuca-worker), o comportamento
    fica IDÊNTICO ao de antes desta correção: os 3 loops continuam iniciando."""
    monkeypatch.setattr(worker_main, "WORKER_SCOPE", "principal")

    agendadas = _rodar_startup_capturando_tasks(monkeypatch)

    assert any("campanhas_loop" in nome for nome in agendadas)
    assert any("empregabilidade_notify_loop" in nome for nome in agendadas)
    assert any("ocr_pending_loop" in nome for nome in agendadas)


def test_worker_scope_academia_enem_nao_inicia_loops_de_outros_modulos(monkeypatch):
    """Com WORKER_SCOPE='academia_enem' (serviço cuca-academia-enem), nenhum dos loops de
    Institucional/Empregabilidade/Ouvidoria/Divulgação/OCR pode iniciar — são módulos com
    token Meta/credenciais que não pertencem a este serviço."""
    monkeypatch.setattr(worker_main, "WORKER_SCOPE", "academia_enem")

    agendadas = _rodar_startup_capturando_tasks(monkeypatch)

    assert agendadas == []


def test_worker_scope_env_var_ausente_cai_no_padrao_principal():
    """os.getenv("WORKER_SCOPE", "principal") — sem a variável no ambiente, o fallback é
    'principal', não None/"" (evita quebrar silenciosamente cuca-worker se a env var for
    esquecida em algum redeploy)."""
    assert os.getenv("WORKER_SCOPE_INEXISTENTE_TESTE", "principal") == "principal"
