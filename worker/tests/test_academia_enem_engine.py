"""
Testes — Academia Enem Engine (S-AE-16: clone do comportamento do Institucional).

Cobre o comportamento novo:
- SEM etapa de coleta de nome: toda mensagem do lead vai direto ao cérebro (`classificar`).
- O cérebro grava a resposta; o worker SÓ ENVIA cada parte (gravar=False) — sem inserção dupla.
- Handover pelo cérebro → envia o texto do cérebro + marca awaiting_human + notifica.
- Pedido explícito de humano (`_quer_humano`) → atalho `acionar_transbordo` (mensagem fixa),
  sem passar pelo cérebro.
- Guard anti-loop: só reage quando a última mensagem da conversa é do lead.

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


def _mock_supabase_tabelas(conteudos_por_tabela: dict):
    """Monta um supabase mock cujo .table(nome) retorna SEMPRE o mesmo MagicMock por tabela
    (memoizado), com .execute() devolvendo .data = conteudos_por_tabela[nome]. Memoização
    permite inspecionar depois (ex.: `.update.assert_not_called()`) o que o código chamou."""
    sb = MagicMock()
    tabelas_criadas: dict = {}

    def _table(nome):
        if nome in tabelas_criadas:
            return tabelas_criadas[nome]
        tbl = MagicMock()
        resultado = MagicMock()
        resultado.data = conteudos_por_tabela.get(nome)
        for metodo in ("select", "eq", "order", "limit", "single", "update", "insert"):
            getattr(tbl, metodo).return_value = tbl
        tbl.execute.return_value = resultado
        tabelas_criadas[nome] = tbl
        return tbl

    sb.table.side_effect = _table
    return sb


# ---------------------------------------------------------------------------
# processar_mensagem_academia_enem — roteamento (Supabase mockado)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_processar_mensagem_ignora_quando_ultima_mensagem_nao_e_do_lead(monkeypatch):
    """Evita loop: se a última mensagem gravada foi da própria IA (nosso outbound), não reage."""
    sb = _mock_supabase_tabelas({
        "ae_mensagens": [{"remetente": "agente", "conteudo": "oi"}],
    })
    monkeypatch.setattr(ae, "supabase", sb)
    classificar_mock = AsyncMock()
    monkeypatch.setattr(ae, "classificar", classificar_mock)
    transbordo_mock = AsyncMock()
    monkeypatch.setattr(ae, "acionar_transbordo", transbordo_mock)

    await ae.processar_mensagem_academia_enem(
        texto="oi", phone="5585999999999", phone_number_id="123",
        lead_id="lead-1", conversa_id="conv-1",
    )

    classificar_mock.assert_not_awaited()
    transbordo_mock.assert_not_awaited()


@pytest.mark.asyncio
async def test_processar_mensagem_lead_vai_direto_ao_cerebro_sem_etapa_de_nome(monkeypatch):
    """S-AE-16: qualquer mensagem do lead (inclusive a primeira) vai DIRETO ao cérebro —
    não há mais saudação/coleta de nome."""
    sb = _mock_supabase_tabelas({
        "ae_mensagens": [{"remetente": "lead", "conteudo": "oi"}],
    })
    monkeypatch.setattr(ae, "supabase", sb)
    classificar_mock = AsyncMock()
    monkeypatch.setattr(ae, "classificar", classificar_mock)

    await ae.processar_mensagem_academia_enem(
        texto="oi", phone="5585999999999", phone_number_id="123",
        lead_id="lead-1", conversa_id="conv-1",
    )

    classificar_mock.assert_awaited_once_with("conv-1", "123", "5585999999999", "lead-1", "oi")


@pytest.mark.asyncio
async def test_processar_mensagem_pergunta_delega_ao_cerebro(monkeypatch):
    sb = _mock_supabase_tabelas({
        "ae_mensagens": [{"remetente": "lead", "conteudo": "quanto custa?"}],
    })
    monkeypatch.setattr(ae, "supabase", sb)
    classificar_mock = AsyncMock()
    monkeypatch.setattr(ae, "classificar", classificar_mock)

    await ae.processar_mensagem_academia_enem(
        texto="quanto custa?", phone="5585999999999", phone_number_id="123",
        lead_id="lead-1", conversa_id="conv-1",
    )

    classificar_mock.assert_awaited_once_with("conv-1", "123", "5585999999999", "lead-1", "quanto custa?")


@pytest.mark.asyncio
async def test_processar_mensagem_pedido_humano_aciona_transbordo_sem_passar_pelo_cerebro(monkeypatch):
    """Pedido explícito de humano tem prioridade e nem chama o cérebro (atalho de segurança)."""
    sb = _mock_supabase_tabelas({
        "ae_mensagens": [{"remetente": "lead", "conteudo": "quero falar com alguém"}],
    })
    monkeypatch.setattr(ae, "supabase", sb)
    acionar_mock = AsyncMock(return_value=True)
    monkeypatch.setattr(ae, "acionar_transbordo", acionar_mock)
    classificar_mock = AsyncMock()
    monkeypatch.setattr(ae, "classificar", classificar_mock)

    await ae.processar_mensagem_academia_enem(
        texto="quero falar com alguém", phone="5585999999999", phone_number_id="123",
        lead_id="lead-1", conversa_id="conv-1",
    )

    acionar_mock.assert_awaited_once_with("conv-1", "123", "5585999999999", "lead-1")
    classificar_mock.assert_not_awaited()


# ---------------------------------------------------------------------------
# _quer_humano — detecção de pedido explícito de transbordo
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("texto", [
    "quero falar com alguém",
    "passa para um atendente",
    "não entendi",
    "quero atendimento",
    "Preciso de Ajuda Humana, por favor",
])
def test_quer_humano_detecta_pedidos_explicitos(texto):
    assert ae._quer_humano(texto) is True


@pytest.mark.parametrize("texto", [
    "quanto custa o curso?",
    "quero saber mais sobre o enem",
    "obrigado",
])
def test_quer_humano_nao_dispara_em_mensagem_normal(texto):
    assert ae._quer_humano(texto) is False


# ---------------------------------------------------------------------------
# classificar() — despacho da resposta do cérebro (envio em partes, sem inserção dupla)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_classificar_chama_edge_function_propria_com_dados_corretos(monkeypatch):
    chamar_mock = AsyncMock(return_value={"mensagens": ["A prova é dia 10/11."], "handover": False, "encerrado": False})
    monkeypatch.setattr(ae, "_chamar_academia_enem_agente", chamar_mock)
    enviar_mock = AsyncMock(return_value=True)
    monkeypatch.setattr(ae, "_enviar", enviar_mock)

    await ae.classificar("conv-1", "123", "5585999999999", "lead-1", "quando é a prova?")

    chamar_mock.assert_awaited_once_with("quando é a prova?", "5585999999999", "conv-1", "lead-1")
    # cérebro já gravou → worker só envia (gravar=False), sem inserção dupla.
    enviar_mock.assert_awaited_once()
    assert enviar_mock.await_args.args == ("conv-1", "123", "5585999999999", "A prova é dia 10/11.", "lead-1")
    assert enviar_mock.await_args.kwargs.get("gravar") is False


@pytest.mark.asyncio
async def test_classificar_envia_todas_as_partes_na_ordem_sem_gravar(monkeypatch):
    """S-AE-16: resposta dividida em partes pelo cérebro é enviada parte a parte, na ordem,
    e nenhuma é gravada de novo pelo worker (o cérebro já gravou)."""
    chamar_mock = AsyncMock(return_value={
        "mensagens": ["Olha só as datas:", "Prova - 10/11", "Quer detalhes de alguma?"],
        "handover": False, "encerrado": False,
    })
    monkeypatch.setattr(ae, "_chamar_academia_enem_agente", chamar_mock)
    enviar_mock = AsyncMock(return_value=True)
    monkeypatch.setattr(ae, "_enviar", enviar_mock)

    await ae.classificar("conv-1", "123", "5585999999999", "lead-1", "quais as datas?")

    assert enviar_mock.await_count == 3
    textos = [c.args[3] for c in enviar_mock.await_args_list]
    assert textos == ["Olha só as datas:", "Prova - 10/11", "Quer detalhes de alguma?"]
    assert all(c.kwargs.get("gravar") is False for c in enviar_mock.await_args_list)


@pytest.mark.asyncio
async def test_classificar_aborta_partes_restantes_na_primeira_falha(monkeypatch):
    monkeypatch.setattr(ae, "_chamar_academia_enem_agente", AsyncMock(return_value={
        "mensagens": ["parte 1", "parte 2", "parte 3"], "handover": False, "encerrado": False,
    }))
    # 1ª envia ok, 2ª falha → 3ª não é tentada.
    enviar_mock = AsyncMock(side_effect=[True, False, True])
    monkeypatch.setattr(ae, "_enviar", enviar_mock)

    await ae.classificar("conv-1", "123", "5585999999999", "lead-1", "oi")

    assert enviar_mock.await_count == 2


@pytest.mark.asyncio
async def test_classificar_sem_resposta_usa_fallback_tecnico_e_grava(monkeypatch):
    monkeypatch.setattr(ae, "_chamar_academia_enem_agente", AsyncMock(return_value=None))
    enviar_mock = AsyncMock(return_value=True)
    monkeypatch.setattr(ae, "_enviar", enviar_mock)

    await ae.classificar("conv-1", "123", "5585999999999", "lead-1", "oi")

    # fallback é gerado pelo worker (cérebro não gravou) → gravar=True (default, sem kwarg).
    enviar_mock.assert_awaited_once_with("conv-1", "123", "5585999999999", ae._FALLBACK_TECNICO, "lead-1")


@pytest.mark.asyncio
async def test_classificar_handover_envia_texto_do_cerebro_e_notifica(monkeypatch):
    """S-AE-16: no handover sinalizado pelo cérebro, o lead vê o TEXTO DO PRÓPRIO CÉREBRO
    (não uma frase fixa), e por trás marca awaiting_human + notifica — igual Institucional."""
    monkeypatch.setattr(ae, "_chamar_academia_enem_agente", AsyncMock(return_value={
        "mensagens": ["Com certeza, vou te passar para um humano."], "handover": True, "encerrado": False,
    }))
    marcar_mock = AsyncMock()
    monkeypatch.setattr(ae, "_marcar_awaiting_e_notificar", marcar_mock)
    enviar_mock = AsyncMock(return_value=True)
    monkeypatch.setattr(ae, "_enviar", enviar_mock)

    await ae.classificar("conv-1", "123", "5585999999999", "lead-1", "quero um humano")

    marcar_mock.assert_awaited_once_with("conv-1", "123", "5585999999999", "lead-1")
    enviar_mock.assert_awaited_once()
    assert enviar_mock.await_args.args[3] == "Com certeza, vou te passar para um humano."
    assert enviar_mock.await_args.kwargs.get("gravar") is False


@pytest.mark.asyncio
async def test_classificar_encerrado_marca_status_encerrada(monkeypatch):
    monkeypatch.setattr(ae, "_chamar_academia_enem_agente", AsyncMock(return_value={
        "mensagens": ["Tudo certo, até mais! 😊"], "handover": False, "encerrado": True,
    }))
    enviar_mock = AsyncMock(return_value=True)
    monkeypatch.setattr(ae, "_enviar", enviar_mock)
    status_mock = MagicMock()
    monkeypatch.setattr(ae, "_atualizar_status", status_mock)

    await ae.classificar("conv-1", "123", "5585999999999", "lead-1", "obrigado, tchau")

    status_mock.assert_called_once_with("conv-1", "encerrada")
    enviar_mock.assert_awaited_once()


@pytest.mark.asyncio
async def test_classificar_nao_importa_nem_toca_meta_adapter_inbound_motor_agente(monkeypatch):
    """Isolamento: `classificar()` nunca chama o motor-agente compartilhado do Institucional."""
    import meta_adapter_inbound as mai

    chamar_motor_agente_mock = AsyncMock()
    monkeypatch.setattr(mai, "_chamar_motor_agente", chamar_motor_agente_mock)
    monkeypatch.setattr(ae, "_chamar_academia_enem_agente", AsyncMock(return_value={
        "mensagens": ["ok"], "handover": False, "encerrado": False,
    }))
    monkeypatch.setattr(ae, "_enviar", AsyncMock(return_value=True))

    await ae.classificar("conv-1", "123", "5585999999999", "lead-1", "oi")

    chamar_motor_agente_mock.assert_not_awaited()


# ---------------------------------------------------------------------------
# _marcar_awaiting_e_notificar — handover pelo cérebro (sem mensagem fixa, sem reversão)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_marcar_awaiting_e_notificar_marca_status_e_notifica_modulo_correto(monkeypatch):
    import meta_adapter_inbound as mai

    sb = _mock_supabase_tabelas({"ae_conversas": {}})
    monkeypatch.setattr(ae, "supabase", sb)
    notificar_mock = AsyncMock(return_value=True)
    monkeypatch.setattr(mai, "_notificar_transbordo", notificar_mock)

    await ae._marcar_awaiting_e_notificar("conv-1", "123", "5585999999999", "lead-1")

    conversas_tbl = sb.table("ae_conversas")
    assert conversas_tbl.update.call_args_list[0].args[0]["status"] == "awaiting_human"
    # nunca reverte para 'ativa' (diferente do atalho explícito acionar_transbordo).
    assert all(c.args[0].get("status") != "ativa" for c in conversas_tbl.update.call_args_list)
    notificar_mock.assert_awaited_once_with("conv-1", "academia_enem", None, "123", "5585999999999")


# ---------------------------------------------------------------------------
# acionar_transbordo — atalho de pedido EXPLÍCITO de humano (mensagem fixa)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_acionar_transbordo_sucesso_marca_awaiting_human_e_notifica(monkeypatch):
    import meta_adapter_inbound as mai

    sb = _mock_supabase_tabelas({"ae_mensagens": [], "ae_conversas": {}})
    monkeypatch.setattr(ae, "supabase", sb)
    notificar_mock = AsyncMock(return_value=True)
    monkeypatch.setattr(mai, "_notificar_transbordo", notificar_mock)
    enviar_mock = AsyncMock(return_value=True)
    monkeypatch.setattr(ae, "_enviar", enviar_mock)

    resultado = await ae.acionar_transbordo("conv-1", "123", "5585999999999", "lead-1")

    assert resultado is True
    conversas_tbl = sb.table("ae_conversas")
    primeira_chamada = conversas_tbl.update.call_args_list[0]
    assert primeira_chamada.args[0]["status"] == "awaiting_human"
    assert all(c.args[0].get("status") != "ativa" for c in conversas_tbl.update.call_args_list)
    notificar_mock.assert_awaited_once_with("conv-1", "academia_enem", None, "123", "5585999999999")
    enviar_mock.assert_awaited_once()
    assert "chamei" in enviar_mock.await_args.args[3].lower()


@pytest.mark.asyncio
async def test_acionar_transbordo_sem_contato_reverte_status_e_avisa_lead(monkeypatch):
    """Sem contato configurado para modulo='academia_enem', não deixa a conversa travada em
    awaiting_human — reverte para 'ativa' e avisa o lead."""
    import meta_adapter_inbound as mai

    sb = _mock_supabase_tabelas({"ae_mensagens": [], "ae_conversas": {}})
    monkeypatch.setattr(ae, "supabase", sb)
    notificar_mock = AsyncMock(return_value=False)
    monkeypatch.setattr(mai, "_notificar_transbordo", notificar_mock)
    enviar_mock = AsyncMock(return_value=True)
    monkeypatch.setattr(ae, "_enviar", enviar_mock)

    resultado = await ae.acionar_transbordo("conv-1", "123", "5585999999999", "lead-1")

    assert resultado is False
    conversas_tbl = sb.table("ae_conversas")
    status_chamados = [c.args[0]["status"] for c in conversas_tbl.update.call_args_list]
    assert status_chamados == ["awaiting_human", "ativa"]
    assert "não consegui" in enviar_mock.await_args.args[3].lower()
