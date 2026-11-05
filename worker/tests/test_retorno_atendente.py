"""Hotfix 05/11/2026 — conversa sem resposta da equipe em 30 min volta para o bot."""
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest

import meta_adapter_inbound
import meta_adapter_outbound
import retorno_atendente
from retorno_atendente import (
    AVISO_RETORNO,
    devolver_conversa_ao_bot,
    mensagens_pendentes,
    texto_para_o_bot,
    verificar_conversas_sem_resposta,
)

AGORA = datetime(2026, 11, 5, 13, 0, tzinfo=timezone.utc)


def _msg(remetente, minutos_atras, conteudo="oi", tipo="text", wamid=None):
    return {
        "remetente": remetente,
        "conteudo": conteudo,
        "created_at": (AGORA - timedelta(minutes=minutos_atras)).isoformat(),
        "tipo": tipo,
        "wamid": wamid,
    }


# ── regra de tempo ───────────────────────────────────────────────────────────────────────────
def test_glória_esperando_56_min_volta_para_o_bot():
    msgs = [
        _msg("lead", 58, "Em outra rede cuca?"),
        _msg("agente", 57, "Não encontrei... Posso ajudá-la a falar com um atendente! 😊"),
        _msg("lead", 56, "Ballet Classico", wamid="wamid.G"),
    ]
    pend = mensagens_pendentes(msgs, AGORA)
    assert [m["conteudo"] for m in pend] == ["Ballet Classico"]


def test_menos_de_30_min_ainda_espera_a_equipe():
    msgs = [_msg("agente", 40, "Vou te encaminhar"), _msg("lead", 29, "??")]
    assert mensagens_pendentes(msgs, AGORA) is None


def test_atendente_respondeu_por_ultimo_nada_a_fazer():
    msgs = [_msg("lead", 90, "oi"), _msg("agente", 80, "Olá, bom dia Leticia")]
    assert mensagens_pendentes(msgs, AGORA) is None


def test_conta_a_partir_da_mensagem_mais_antiga_sem_resposta():
    msgs = [_msg("agente", 50), _msg("lead", 35, "quero desse mês mesmo"), _msg("lead", 2, "Olá")]
    pend = mensagens_pendentes(msgs, AGORA)
    assert [m["conteudo"] for m in pend] == ["quero desse mês mesmo", "Olá"]


def test_fora_da_janela_de_24h_da_meta_fica_como_esta():
    msgs = [_msg("agente", 25 * 60), _msg("lead", 24 * 60, "oi")]
    assert mensagens_pendentes(msgs, AGORA) is None


def test_texto_para_o_bot_ignora_imagem_e_junta_as_mensagens():
    pend = [
        _msg("lead", 40, "[Imagem enviada sem legenda]", tipo="image"),
        _msg("lead", 39, "Informações de qndo começa"),
        _msg("lead", 38, "e com me informo no dia."),
    ]
    assert texto_para_o_bot(pend) == "Informações de qndo começa\ne com me informo no dia."
    assert texto_para_o_bot([_msg("lead", 40, "[Imagem]", tipo="image")]) == ""


# ── devolução ────────────────────────────────────────────────────────────────────────────────
def _supabase(update_data):
    sb = MagicMock()
    tabelas = {}

    def table(nome):
        if nome not in tabelas:
            t = MagicMock()
            for metodo in ("select", "update", "insert", "eq", "in_", "gte", "order", "limit", "single"):
                getattr(t, metodo).return_value = t
            tabelas[nome] = t
        return tabelas[nome]

    sb.table.side_effect = table
    table("conversas").execute.return_value = MagicMock(data=update_data)
    table("leads").execute.return_value = MagicMock(data={"telefone": "558594235892"})
    table("mensagens").execute.return_value = MagicMock(data=[])
    return sb, tabelas


@pytest.fixture
def canal(monkeypatch):
    monkeypatch.setattr(
        meta_adapter_inbound,
        "_get_instancia_by_phone_number_id",
        lambda pnid: {"canal_origem": pnid, "agente_tipo": "Institucional", "canal_tipo": "geral", "unidade_cuca": "Geral"},
    )
    enviar = AsyncMock(return_value=True)
    monkeypatch.setattr(meta_adapter_outbound, "_meta_enviar", enviar)
    dispatch = AsyncMock()
    monkeypatch.setattr(meta_adapter_inbound, "_executar_dispatch", dispatch)
    return enviar, dispatch


CONVERSA = {"id": "conv-g", "lead_id": "lead-g", "origem_id": "PNID_INST", "agente_tipo": "Institucional"}


@pytest.mark.asyncio
async def test_devolve_avisa_e_passa_a_pergunta_pendente_pelo_caminho_normal(canal):
    enviar, dispatch = canal
    sb, tabelas = _supabase(update_data=[{"id": "conv-g"}])
    pend = [_msg("lead", 56, "Ballet Classico", wamid="wamid.G")]

    assert await devolver_conversa_ao_bot(CONVERSA, pend, sb) is True

    # status só muda se ainda estava aguardando atendente
    tabelas["conversas"].update.assert_called_once()
    assert tabelas["conversas"].update.call_args.args[0]["status"] == "ativa"
    tabelas["conversas"].eq.assert_any_call("status", "awaiting_human")
    enviar.assert_awaited_once()
    assert enviar.await_args.args[2] == AVISO_RETORNO
    kwargs = dispatch.await_args.kwargs
    assert kwargs["mensagem"] == "Ballet Classico"
    assert kwargs["contrato_v2"]["mensagem"] == "Ballet Classico"
    assert kwargs["contrato_v2"]["telefone"] == "558594235892"
    assert kwargs["wamid"] == "wamid.G"
    # aviso gravado no histórico depois da resposta do bot
    tabelas["mensagens"].insert.assert_called_once()
    assert tabelas["mensagens"].insert.call_args.args[0]["conteudo"] == AVISO_RETORNO


@pytest.mark.asyncio
async def test_alguem_assumiu_no_meio_do_caminho_nada_acontece(canal):
    enviar, dispatch = canal
    sb, _ = _supabase(update_data=[])
    assert await devolver_conversa_ao_bot(CONVERSA, [_msg("lead", 40, "oi")], sb) is False
    enviar.assert_not_awaited()
    dispatch.assert_not_awaited()


@pytest.mark.asyncio
async def test_so_imagem_pendente_pede_texto_sem_chamar_o_bot(canal):
    enviar, dispatch = canal
    sb, _ = _supabase(update_data=[{"id": "conv-g"}])
    assert await devolver_conversa_ao_bot(CONVERSA, [_msg("lead", 40, "[Imagem]", tipo="image")], sb) is True
    assert retorno_atendente.PEDIDO_TEXTO in enviar.await_args.args[2]
    dispatch.assert_not_awaited()


@pytest.mark.asyncio
async def test_rodada_so_olha_institucional_meta_aguardando_atendente(canal):
    sb, tabelas = _supabase(update_data=[])
    tabelas["conversas"].execute.return_value = MagicMock(data=[])
    assert await verificar_conversas_sem_resposta(sb, AGORA) == 0
    t = tabelas["conversas"]
    t.eq.assert_any_call("status", "awaiting_human")
    t.eq.assert_any_call("canal_ativo", "meta")
    t.in_.assert_called_once_with("agente_tipo", ["Institucional", "maria"])


# ── revisão do @qa (05/11): quem já estava esperando no deploy fica com a equipe ─────────────
def test_quem_ja_estava_passado_do_prazo_quando_o_worker_ligou_fica_com_a_equipe():
    ligado_em = AGORA - timedelta(minutes=10)
    # Glória: esperando desde 56 min atrás — já tinha passado dos 30 min quando o worker ligou
    msgs = [_msg("agente", 57), _msg("lead", 56, "Ballet Classico")]
    assert mensagens_pendentes(msgs, AGORA, ligado_em) is None


def test_quem_ainda_nao_tinha_dado_o_prazo_no_deploy_segue_a_regra():
    ligado_em = AGORA - timedelta(minutes=10)
    # esperando desde 35 min atrás: no deploy (10 min atrás) tinha só 25 min — não era atraso ainda
    msgs = [_msg("agente", 36), _msg("lead", 35, "tem natação?")]
    assert [m["conteudo"] for m in mensagens_pendentes(msgs, AGORA, ligado_em)] == ["tem natação?"]


def test_transbordo_depois_do_deploy_segue_a_regra():
    ligado_em = AGORA - timedelta(hours=3)
    msgs = [_msg("agente", 50), _msg("lead", 45, "e no Pici?")]
    assert mensagens_pendentes(msgs, AGORA, ligado_em) is not None


@pytest.mark.asyncio
async def test_rodada_com_ligado_em_nao_devolve_quem_ja_esperava_no_deploy(canal):
    enviar, dispatch = canal
    sb, tabelas = _supabase(update_data=[{"id": "conv-g"}])
    tabelas["conversas"].execute.return_value = MagicMock(data=[CONVERSA])
    tabelas["mensagens"].execute.return_value = MagicMock(data=[
        _msg("lead", 56, "Ballet Classico"), _msg("agente", 57),  # ordem decrescente, como o banco devolve
    ])
    assert await verificar_conversas_sem_resposta(sb, AGORA, ligado_em=AGORA - timedelta(minutes=5)) == 0
    enviar.assert_not_awaited()
    dispatch.assert_not_awaited()
