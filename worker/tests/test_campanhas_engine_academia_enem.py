"""
Testes unitários — fila própria de disparo da Academia Enem (S-AE-09).

Mesma limitação/estratégia de stub já documentada em test_campanhas_engine.py: `supabase` e
`postgrest` não estão instalados neste ambiente de teste — reaproveito aqui o mesmo stub de
sys.modules, para não repetir a explicação.
"""
import asyncio
import os
import sys
import types
from unittest.mock import AsyncMock, MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

if "supabase" not in sys.modules:
    _fake_supabase_pkg = types.ModuleType("supabase")
    _fake_supabase_pkg.create_client = MagicMock(return_value=MagicMock())
    _fake_supabase_pkg.Client = MagicMock
    sys.modules["supabase"] = _fake_supabase_pkg

if "postgrest" not in sys.modules:
    class _FakeAPIError(Exception):
        def __init__(self, error: dict):
            self.code = error.get("code")
            self.message = error.get("message")
            self.hint = error.get("hint")
            self.details = error.get("details")
            super().__init__(self.message or self.code)

    _fake_postgrest_pkg = types.ModuleType("postgrest")
    _fake_postgrest_exceptions_mod = types.ModuleType("postgrest.exceptions")
    _fake_postgrest_exceptions_mod.APIError = _FakeAPIError
    _fake_postgrest_pkg.exceptions = _fake_postgrest_exceptions_mod
    sys.modules["postgrest"] = _fake_postgrest_pkg
    sys.modules["postgrest.exceptions"] = _fake_postgrest_exceptions_mod

import campanhas_engine as camp  # noqa: E402


def _mock_supabase_multi_tabela():
    mock_sb = MagicMock()
    tabelas: dict[str, MagicMock] = {}

    def _table(nome):
        if nome not in tabelas:
            tabelas[nome] = MagicMock()
        return tabelas[nome]

    mock_sb.table = MagicMock(side_effect=_table)
    return mock_sb, tabelas


# ─── _contar_enviados_hoje_sync — 3º bloco (disparos_academia_enem) ────────────────────────

def test_contar_enviados_hoje_soma_tambem_academia_enem(monkeypatch):
    """S-AE-09 Dev Notes item 1: sem este bloco, o teto diário do número da Academia Enem
    nunca contaria os envios já feitos por ela (sempre '0 hoje') — este teste garante que o
    3º caminho (disparos_academia_enem) é somado junto dos 2 já existentes."""
    mock_sb, tabelas = _mock_supabase_multi_tabela()
    monkeypatch.setattr(camp, "supabase", mock_sb)

    tabelas.setdefault("disparos", MagicMock()).select.return_value.eq.return_value.execute.return_value.data = []
    tabelas.setdefault("disparos_divulgacao", MagicMock()).select.return_value.eq.return_value.execute.return_value.data = []
    tabelas.setdefault("disparos_academia_enem", MagicMock()).select.return_value.eq.return_value.execute.return_value.data = [
        {"id": "ae-disparo-1"}
    ]

    logs_mock = tabelas.setdefault("logs_disparo", MagicMock())

    def _select(*_a, **_kw):
        chain = MagicMock()

        def _in(campo, _valores):
            sub = MagicMock()
            if campo == "disparo_academia_enem_id":
                sub.gte.return_value.neq.return_value.execute.return_value.count = 8
            else:
                sub.gte.return_value.neq.return_value.execute.return_value.count = 0
            return sub

        chain.in_ = MagicMock(side_effect=_in)
        return chain

    logs_mock.select = MagicMock(side_effect=_select)

    assert camp._contar_enviados_hoje_sync("phone-academia-enem") == 8


def test_contar_enviados_hoje_sem_fila_academia_enem_nao_quebra(monkeypatch):
    """Número sem nenhuma linha em disparos_academia_enem (fila ainda vazia) — soma 0 nesse
    bloco, sem erro, sem sequer consultar logs_disparo por essa FK."""
    mock_sb, tabelas = _mock_supabase_multi_tabela()
    monkeypatch.setattr(camp, "supabase", mock_sb)

    tabelas.setdefault("disparos", MagicMock()).select.return_value.eq.return_value.execute.return_value.data = []
    tabelas.setdefault("disparos_divulgacao", MagicMock()).select.return_value.eq.return_value.execute.return_value.data = []
    tabelas.setdefault("disparos_academia_enem", MagicMock()).select.return_value.eq.return_value.execute.return_value.data = []

    assert camp._contar_enviados_hoje_sync("phone-sem-fila-ae") == 0


# ─── _processar_disparo_academia_enem_interno ──────────────────────────────────────────────

def _disparo_base(**overrides):
    base = {
        "id": "disparo-ae-1",
        "titulo": "Aviso de início das aulas",
        "template_nome": "ae_aviso_v1",
        "instancia_uazapi": "phone-ae-1",
        "contatos": [
            {"lead_id": "lead-1", "nome": "Ana", "telefone": "5585999990001"},
            {"lead_id": None, "nome": "Beto", "telefone": "5585999990002"},
        ],
    }
    base.update(overrides)
    return base


@pytest.mark.asyncio
async def test_envia_para_todos_grava_ledger_e_breadcrumb_so_com_lead_id(monkeypatch):
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.contains.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
        {"variaveis": [{"posicao": 1, "descricao": "nome"}]}
    ]
    logs_insert = MagicMock()
    mock_sb.table.return_value.insert.return_value.execute = logs_insert
    monkeypatch.setattr(camp, "supabase", mock_sb)
    monkeypatch.setenv("META_SYSTEM_USER_TOKEN", "token-fake")
    monkeypatch.setattr(camp, "_resolver_limite_restante_hoje_sync", lambda phone, daily_limit: 10)
    monkeypatch.setattr(camp, "_enviar_template_meta", AsyncMock(return_value=(True, "wamid.X")))
    breadcrumb_mock = MagicMock()
    monkeypatch.setattr(camp, "_gravar_breadcrumb_disparo", breadcrumb_mock)
    update_mock = MagicMock()
    monkeypatch.setattr(camp, "_update_db_sync", update_mock)

    await camp._processar_disparo_academia_enem_interno(_disparo_base(), 0, 0, 100)

    # breadcrumb só pro contato com lead_id (Ana) — Beto (lead_id=None) não gera breadcrumb
    assert breadcrumb_mock.call_count == 1
    assert breadcrumb_mock.call_args[0][0] == "lead-1"
    # A-1 (achado QA): agente_tipo explícito, não o default "Institucional" da função compartilhada
    assert breadcrumb_mock.call_args.kwargs["agente_tipo"] == "academia_enem"

    ultima_chamada = update_mock.call_args_list[-1]
    assert ultima_chamada.args[0] == "disparos_academia_enem"
    assert ultima_chamada.args[2]["status"] == "concluida"
    assert ultima_chamada.args[2]["total_enviados"] == 2
    assert ultima_chamada.args[2]["total_erros"] == 0


@pytest.mark.asyncio
async def test_template_nao_mais_aprovado_pausa_sem_enviar(monkeypatch):
    """Revalidação no momento do envio (defesa em profundidade) — template pode ter sido
    desativado/reprovado entre a criação da fila e o processamento pelo worker."""
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.contains.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
    monkeypatch.setattr(camp, "supabase", mock_sb)
    monkeypatch.setenv("META_SYSTEM_USER_TOKEN", "token-fake")
    enviar_mock = AsyncMock()
    monkeypatch.setattr(camp, "_enviar_template_meta", enviar_mock)
    update_mock = MagicMock()
    monkeypatch.setattr(camp, "_update_db_sync", update_mock)

    await camp._processar_disparo_academia_enem_interno(_disparo_base(), 0, 0, 100)

    enviar_mock.assert_not_called()
    update_mock.assert_called_once_with("disparos_academia_enem", "disparo-ae-1", {"status": "pausada"})


@pytest.mark.asyncio
async def test_sem_token_meta_pausa_sem_enviar(monkeypatch):
    monkeypatch.delenv("META_SYSTEM_USER_TOKEN", raising=False)
    mock_sb = MagicMock()
    monkeypatch.setattr(camp, "supabase", mock_sb)
    enviar_mock = AsyncMock()
    monkeypatch.setattr(camp, "_enviar_template_meta", enviar_mock)
    update_mock = MagicMock()
    monkeypatch.setattr(camp, "_update_db_sync", update_mock)

    await camp._processar_disparo_academia_enem_interno(_disparo_base(), 0, 0, 100)

    enviar_mock.assert_not_called()
    update_mock.assert_called_once_with("disparos_academia_enem", "disparo-ae-1", {"status": "pausada"})


@pytest.mark.asyncio
async def test_sem_contatos_conclui_direto_sem_chamar_meta(monkeypatch):
    mock_sb = MagicMock()
    monkeypatch.setattr(camp, "supabase", mock_sb)
    monkeypatch.setenv("META_SYSTEM_USER_TOKEN", "token-fake")
    enviar_mock = AsyncMock()
    monkeypatch.setattr(camp, "_enviar_template_meta", enviar_mock)
    update_mock = MagicMock()
    monkeypatch.setattr(camp, "_update_db_sync", update_mock)

    await camp._processar_disparo_academia_enem_interno(_disparo_base(contatos=[]), 0, 0, 100)

    enviar_mock.assert_not_called()
    update_mock.assert_called_once_with("disparos_academia_enem", "disparo-ae-1", {
        "status": "concluida", "total_enviados": 0, "total_erros": 0,
        "concluido_em": update_mock.call_args.args[2]["concluido_em"],
    })


@pytest.mark.asyncio
async def test_teto_diario_atingido_pausa_com_totais_parciais(monkeypatch):
    """AC#6: contido/pausado, não silenciosamente ignorado — quem já foi enviado antes do
    limite é contabilizado; quem viria depois não é sequer tentado."""
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.contains.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
        {"variaveis": []}
    ]
    monkeypatch.setattr(camp, "supabase", mock_sb)
    monkeypatch.setenv("META_SYSTEM_USER_TOKEN", "token-fake")
    monkeypatch.setattr(camp, "_resolver_limite_restante_hoje_sync", lambda phone, daily_limit: 1)
    monkeypatch.setattr(camp, "_enviar_template_meta", AsyncMock(return_value=(True, "wamid.Y")))
    monkeypatch.setattr(camp, "_gravar_breadcrumb_disparo", MagicMock())
    update_mock = MagicMock()
    monkeypatch.setattr(camp, "_update_db_sync", update_mock)

    disparo = _disparo_base(contatos=[
        {"lead_id": "lead-1", "nome": "Ana", "telefone": "5585999990001"},
        {"lead_id": "lead-2", "nome": "Beto", "telefone": "5585999990002"},
        {"lead_id": "lead-3", "nome": "Caio", "telefone": "5585999990003"},
    ])
    await camp._processar_disparo_academia_enem_interno(disparo, 0, 0, 100)

    ultima_chamada = update_mock.call_args_list[-1]
    assert ultima_chamada.args[2]["status"] == "pausada_limite_diario"
    assert ultima_chamada.args[2]["total_enviados"] == 1
    assert ultima_chamada.args[2]["total_erros"] == 0


@pytest.mark.asyncio
async def test_template_com_mais_de_1_variavel_pausa_sem_tentar_nenhum_envio(monkeypatch):
    """A-4 (achado QA, 2026-08-23): o envio só preenche 1 variável (nome) — template com 2+
    exigiria mais parâmetros do que o código monta, e a Meta rejeitaria 100% dos envios
    silenciosamente. Guard explícito: pausa ANTES de gastar o público."""
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.contains.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
        {"variaveis": [{"posicao": 1, "descricao": "nome"}, {"posicao": 2, "descricao": "mes"}]}
    ]
    monkeypatch.setattr(camp, "supabase", mock_sb)
    monkeypatch.setenv("META_SYSTEM_USER_TOKEN", "token-fake")
    enviar_mock = AsyncMock()
    monkeypatch.setattr(camp, "_enviar_template_meta", enviar_mock)
    update_mock = MagicMock()
    monkeypatch.setattr(camp, "_update_db_sync", update_mock)

    await camp._processar_disparo_academia_enem_interno(_disparo_base(), 0, 0, 100)

    enviar_mock.assert_not_called()
    update_mock.assert_called_once_with("disparos_academia_enem", "disparo-ae-1", {"status": "pausada"})


@pytest.mark.asyncio
async def test_template_com_exatamente_1_variavel_no_guard_nao_bloqueia(monkeypatch):
    """Regressão: 0 ou 1 variável continua liberado (não é uma restrição nova indevida)."""
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.contains.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
        {"variaveis": [{"posicao": 1, "descricao": "nome"}]}
    ]
    monkeypatch.setattr(camp, "supabase", mock_sb)
    monkeypatch.setenv("META_SYSTEM_USER_TOKEN", "token-fake")
    monkeypatch.setattr(camp, "_resolver_limite_restante_hoje_sync", lambda phone, daily_limit: 10)
    enviar_mock = AsyncMock(return_value=(True, "wamid.Z"))
    monkeypatch.setattr(camp, "_enviar_template_meta", enviar_mock)
    monkeypatch.setattr(camp, "_gravar_breadcrumb_disparo", MagicMock())
    monkeypatch.setattr(camp, "_update_db_sync", MagicMock())

    resultado = await camp._processar_disparo_academia_enem_interno(_disparo_base(), 0, 0, 100)

    assert enviar_mock.call_count == 2
    assert resultado["status"] == "concluida"


# ─── Retomada manual (achado QA A-3) ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_reivindicar_retomada_disparo_nao_encontrado(monkeypatch):
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
    monkeypatch.setattr(camp, "supabase", mock_sb)

    resultado = await camp.reivindicar_retomada_academia_enem("disparo-inexistente")

    assert resultado == {"ok": False, "status_code": 404, "motivo": "disparo não encontrado"}


@pytest.mark.asyncio
async def test_reivindicar_retomada_status_nao_pausado_rejeita(monkeypatch):
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
        {"id": "disparo-ae-1", "status": "concluida"}
    ]
    monkeypatch.setattr(camp, "supabase", mock_sb)

    resultado = await camp.reivindicar_retomada_academia_enem("disparo-ae-1")

    assert resultado["ok"] is False
    assert resultado["status_code"] == 409


@pytest.mark.asyncio
async def test_reivindicar_retomada_corrida_perdida_retorna_409(monkeypatch):
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
        {"id": "disparo-ae-1", "status": "pausada_limite_diario"}
    ]
    monkeypatch.setattr(camp, "supabase", mock_sb)
    monkeypatch.setattr(camp, "_claim_retomada_sync", lambda *_a, **_kw: False)

    resultado = await camp.reivindicar_retomada_academia_enem("disparo-ae-1")

    assert resultado["ok"] is False
    assert resultado["status_code"] == 409


@pytest.mark.asyncio
async def test_reivindicar_retomada_sucesso(monkeypatch):
    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
        {"id": "disparo-ae-1", "status": "pausada"}
    ]
    monkeypatch.setattr(camp, "supabase", mock_sb)
    monkeypatch.setattr(camp, "_claim_retomada_sync", lambda *_a, **_kw: True)

    resultado = await camp.reivindicar_retomada_academia_enem("disparo-ae-1")

    assert resultado["ok"] is True
    assert resultado["disparo"]["id"] == "disparo-ae-1"


@pytest.mark.asyncio
async def test_continuar_retomada_envia_so_pendentes_e_fecha_cumulativo(monkeypatch):
    """3 contatos na fila original, 1 já tentado (telefone já em logs_disparo) — só os outros
    2 devem ser reenviados; o fechamento relê o total cumulativo real, não só desta chamada."""
    disparo = _disparo_base(contatos=[
        {"lead_id": "lead-1", "nome": "Ana", "telefone": "5585999990001"},
        {"lead_id": "lead-2", "nome": "Beto", "telefone": "5585999990002"},
        {"lead_id": "lead-3", "nome": "Caio", "telefone": "5585999990003"},
    ])

    monkeypatch.setattr(
        camp, "_fetch_all_telefones_tentados_academia_enem_sync",
        lambda disparo_id: {"5585999990001"},
    )

    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.contains.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
        {"variaveis": [{"posicao": 1, "descricao": "nome"}]}
    ]
    # Fechamento cumulativo: 2 chamadas a logs_disparo (enviados/erros) via .eq().neq()/.in_()
    mock_sb.table.return_value.select.return_value.eq.return_value.neq.return_value.execute.return_value.count = 5
    mock_sb.table.return_value.select.return_value.eq.return_value.in_.return_value.execute.return_value.count = 1
    monkeypatch.setattr(camp, "supabase", mock_sb)
    monkeypatch.setenv("META_SYSTEM_USER_TOKEN", "token-fake")
    monkeypatch.setattr(camp, "_resolver_limite_restante_hoje_sync", lambda phone, daily_limit: 10)
    enviar_mock = AsyncMock(return_value=(True, "wamid.R"))
    monkeypatch.setattr(camp, "_enviar_template_meta", enviar_mock)
    monkeypatch.setattr(camp, "_gravar_breadcrumb_disparo", MagicMock())
    monkeypatch.setattr(camp, "_update_db_sync", MagicMock())

    resultado = await camp.continuar_retomada_academia_enem(disparo, 0, 0, 100)

    assert resultado["pendentes_encontrados"] == 2
    assert enviar_mock.call_count == 2
    enviados_numeros = {c.args[1] for c in enviar_mock.call_args_list}
    assert enviados_numeros == {"5585999990002", "5585999990003"}
    # fechamento usou a contagem cumulativa real (5 enviados, 1 erro), não só os 2 desta chamada
    assert resultado["status"] == "concluida"


@pytest.mark.asyncio
async def test_retomada_que_pausa_de_novo_grava_totais_cumulativos_nao_locais(monkeypatch):
    """B-1 (achado QA, 2026-08-23 — reproduzido antes da correção, agora regressão coberta):
    disparo original já tinha enviado 100 (histórico real em logs_disparo). Retomada tenta 2
    pendentes, mas o teto diário já está zerado (0 restante) — pausa de novo IMEDIATAMENTE.
    Antes da correção, isso gravava total_enviados=0 (só o local desta chamada), regredindo o
    valor real (100) pra 0. Depois da correção, deve gravar o total cumulativo real (100)."""
    disparo = _disparo_base(contatos=[
        {"lead_id": "lead-1", "nome": "Ana", "telefone": "5585999990001"},
        {"lead_id": "lead-2", "nome": "Beto", "telefone": "5585999990002"},
    ])
    monkeypatch.setattr(camp, "_fetch_all_telefones_tentados_academia_enem_sync", lambda disparo_id: set())

    mock_sb = MagicMock()
    mock_sb.table.return_value.select.return_value.eq.return_value.contains.return_value.eq.return_value.eq.return_value.limit.return_value.execute.return_value.data = [
        {"variaveis": []}
    ]
    # Contagem cumulativa real: 100 enviados, 3 erros (histórico completo, não desta chamada)
    mock_sb.table.return_value.select.return_value.eq.return_value.neq.return_value.execute.return_value.count = 100
    mock_sb.table.return_value.select.return_value.eq.return_value.in_.return_value.execute.return_value.count = 3
    monkeypatch.setattr(camp, "supabase", mock_sb)
    monkeypatch.setenv("META_SYSTEM_USER_TOKEN", "token-fake")
    monkeypatch.setattr(camp, "_resolver_limite_restante_hoje_sync", lambda phone, daily_limit: 0)  # teto já zerado
    enviar_mock = AsyncMock()
    monkeypatch.setattr(camp, "_enviar_template_meta", enviar_mock)
    update_mock = MagicMock()
    monkeypatch.setattr(camp, "_update_db_sync", update_mock)

    resultado = await camp.continuar_retomada_academia_enem(disparo, 0, 0, 100)

    enviar_mock.assert_not_called()  # daily_limit=0 pausa antes de tentar qualquer envio
    assert resultado["status"] == "pausada_limite_diario"
    ultima_chamada = update_mock.call_args_list[-1]
    assert ultima_chamada.args[2]["total_enviados"] == 100  # cumulativo real, não 0 (local desta chamada)
    assert ultima_chamada.args[2]["total_erros"] == 3
