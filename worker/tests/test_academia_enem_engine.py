"""
Testes — Academia Enem Engine (S-AE-04: automação de entrada humanizada, Meta direta).

Cobre:
- A máquina de estados pura `decidir()` (sem IO) — os 4 cenários dos ACs da story
  (saudação sem menu, coleta de nome, hand-off ao classificador, encerramento).
- A camada de I/O (`processar_mensagem_academia_enem`) com Supabase mockado — confirma que
  grava em `conversas`/`mensagens` (compartilhadas), não em `ae_conversas`/`ae_mensagens`, e
  que só envia mensagem quando a última mensagem da conversa é do lead (evita loop com o
  próprio outbound).

`academia_enem_engine.py` faz `from supabase import create_client, Client` no topo do módulo —
mesma limitação de ambiente já documentada em test_empregabilidade_engine.py/
test_campanhas_engine.py (pacote `supabase` não instalado neste ambiente de teste). Reaproveita
o mesmo stub de sys.modules.
"""
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

import academia_enem_engine as ae  # noqa: E402


# ---------------------------------------------------------------------------
# decidir() — máquina de estados pura
# ---------------------------------------------------------------------------

def test_decidir_lead_novo_saudacao_sem_menu():
    decisao = ae.decidir(None, "oi", None)
    assert decisao["acao"] == "saudar"
    assert decisao["proximo_estado"] == "aguardando_nome"
    assert "como você se chama" in decisao["mensagem"]
    # AC1: sem menu numérico — garante que a saudação não lista opções "1)/2)/3)".
    assert not any(f"{n})" in decisao["mensagem"] for n in range(1, 4))


def test_decidir_coleta_nome_persiste_e_avanca_para_ativo():
    decisao = ae.decidir("aguardando_nome", "meu nome é João Silva", {"etapa": "aguardando_nome"})
    assert decisao["acao"] == "coletar_nome"
    assert decisao["proximo_estado"] == "ativo"
    assert decisao["fluxo"]["nome"] == "João Silva"
    assert "João" in decisao["mensagem"]


def test_decidir_coleta_nome_sem_nome_extraivel_nao_quebra():
    decisao = ae.decidir("aguardando_nome", "??", {})
    assert decisao["acao"] == "coletar_nome"
    assert decisao["fluxo"]["nome"] == ""
    assert "Prazer!" in decisao["mensagem"]


def test_decidir_estado_ativo_handoff_classificador_silencioso():
    decisao = ae.decidir("ativo", "quanto custa o curso?", {"nome": "João"})
    assert decisao["acao"] == "classificar"
    assert decisao["mensagem"] is None
    # fluxo preservado (nome não é perdido no hand-off)
    assert decisao["fluxo"]["nome"] == "João"


@pytest.mark.parametrize("estado", ["aguardando_nome", "ativo"])
def test_decidir_encerramento_por_palavra_chave(estado):
    decisao = ae.decidir(estado, "tchau, obrigado", {"nome": "João"})
    assert decisao["acao"] == "encerrar"
    assert decisao["fluxo"]["etapa"] == "encerrada"
    assert "Quando quiser falar sobre o Enem" in decisao["mensagem"]


def test_decidir_encerramento_nao_dispara_no_estado_novo():
    # "obrigado" antes de qualquer diálogo real não deve ser tratado como despedida.
    decisao = ae.decidir(None, "obrigado por aceitar meu pedido de amizade", None)
    assert decisao["acao"] == "saudar"


# ---------------------------------------------------------------------------
# _extrair_nome — normalização
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("entrada,esperado", [
    ("João", "João"),
    ("me chamo Maria Souza", "Maria Souza"),
    ("sou o Pedro", "Pedro"),
    ("", ""),
])
def test_extrair_nome(entrada, esperado):
    assert ae._extrair_nome(entrada) == esperado


# ---------------------------------------------------------------------------
# processar_mensagem_academia_enem — camada de I/O (Supabase mockado)
# ---------------------------------------------------------------------------

def _mock_supabase_tabelas(conteudos_por_tabela: dict):
    """Monta um supabase mock cujo .table(nome) retorna SEMPRE o mesmo MagicMock por
    tabela (memoizado, como o client real reaproveitaria a mesma referência lógica),
    com .execute() devolvendo .data = conteudos_por_tabela[nome]. Memoização é o que
    permite inspecionar depois (ex.: `.update.assert_not_called()`) o que o código
    sob teste efetivamente chamou, não uma instância nova e sempre "limpa"."""
    sb = MagicMock()
    tabelas_criadas: dict = {}

    def _table(nome):
        if nome in tabelas_criadas:
            return tabelas_criadas[nome]
        tbl = MagicMock()
        resultado = MagicMock()
        resultado.data = conteudos_por_tabela.get(nome)
        # Encadeamentos usados pelo módulo: select().eq().order().limit().execute(),
        # select().eq().single().execute(), update().eq().execute(), insert().execute()
        for metodo in ("select", "eq", "order", "limit", "single", "update", "insert"):
            getattr(tbl, metodo).return_value = tbl
        tbl.execute.return_value = resultado
        tabelas_criadas[nome] = tbl
        return tbl

    sb.table.side_effect = _table
    return sb


@pytest.mark.asyncio
async def test_processar_mensagem_ignora_quando_ultima_mensagem_nao_e_do_lead(monkeypatch):
    """Evita loop: se a última mensagem gravada foi da própria IA (nosso outbound), não reage."""
    sb = _mock_supabase_tabelas({
        "mensagens": [{"remetente": "agente", "conteudo": "oi"}],
    })
    monkeypatch.setattr(ae, "supabase", sb)
    enviar_mock = AsyncMock()
    monkeypatch.setattr(ae, "_enviar", enviar_mock)

    await ae.processar_mensagem_academia_enem(
        texto="oi", phone="5585999999999", phone_number_id="123",
        lead_id="lead-1", conversa_id="conv-1",
    )

    enviar_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_processar_mensagem_lead_novo_envia_saudacao_via_conversas_mensagens(monkeypatch):
    """AC1/AC5: lead novo recebe saudação sem menu; grava em conversas/mensagens
    (compartilhadas) — nunca ae_conversas/ae_mensagens."""
    sb = _mock_supabase_tabelas({
        "mensagens": [{"remetente": "lead", "conteudo": "oi"}],
        "conversas": {"metadata": {}},
    })
    monkeypatch.setattr(ae, "supabase", sb)
    enviar_mock = AsyncMock(return_value=True)
    monkeypatch.setattr(ae, "_enviar", enviar_mock)

    await ae.processar_mensagem_academia_enem(
        texto="oi", phone="5585999999999", phone_number_id="123",
        lead_id="lead-1", conversa_id="conv-1",
    )

    enviar_mock.assert_awaited_once()
    _conv_id, _pnid, _phone, mensagem, _lead_id = enviar_mock.await_args.args
    assert "como você se chama" in mensagem
    # Nenhuma tabela ae_* foi tocada.
    tabelas_chamadas = {c.args[0] for c in sb.table.call_args_list}
    assert "ae_conversas" not in tabelas_chamadas
    assert "ae_mensagens" not in tabelas_chamadas
    assert "conversas" in tabelas_chamadas
    assert "mensagens" in tabelas_chamadas


@pytest.mark.asyncio
async def test_processar_mensagem_ativo_delega_ao_classificador_sem_enviar(monkeypatch):
    """AC2: após o nome, a conversa avança para roteamento (seam classificar()) — sem a
    S-AE-04 responder a dúvida diretamente (no-invention)."""
    sb = _mock_supabase_tabelas({
        "mensagens": [{"remetente": "lead", "conteudo": "quanto custa?"}],
        "conversas": {"metadata": {"ae_fluxo": {"etapa": "ativo", "nome": "João"}}},
    })
    monkeypatch.setattr(ae, "supabase", sb)
    enviar_mock = AsyncMock()
    monkeypatch.setattr(ae, "_enviar", enviar_mock)
    classificar_mock = AsyncMock()
    monkeypatch.setattr(ae, "classificar", classificar_mock)

    await ae.processar_mensagem_academia_enem(
        texto="quanto custa?", phone="5585999999999", phone_number_id="123",
        lead_id="lead-1", conversa_id="conv-1",
    )

    enviar_mock.assert_not_awaited()
    classificar_mock.assert_awaited_once_with("conv-1")


@pytest.mark.asyncio
async def test_processar_mensagem_nao_avanca_estado_se_envio_falhar(monkeypatch):
    """Se o envio falhar (Graph API fora), o fluxo NÃO avança — evita "consumir" a saudação
    sem o lead ter recebido nada."""
    sb = _mock_supabase_tabelas({
        "mensagens": [{"remetente": "lead", "conteudo": "oi"}],
        "conversas": {"metadata": {}},
    })
    monkeypatch.setattr(ae, "supabase", sb)
    enviar_mock = AsyncMock(return_value=False)
    monkeypatch.setattr(ae, "_enviar", enviar_mock)

    await ae.processar_mensagem_academia_enem(
        texto="oi", phone="5585999999999", phone_number_id="123",
        lead_id="lead-1", conversa_id="conv-1",
    )

    enviar_mock.assert_awaited_once()
    # update() não deve ter sido chamado em conversas (persistência de estado pulada).
    conversas_tbl = sb.table("conversas")
    conversas_tbl.update.assert_not_called()
