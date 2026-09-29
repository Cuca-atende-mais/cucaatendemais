"""PLANO-024 — ponta a ponta no inbound: clique no botão de presença.

Webhook real de clique (type="button") → o porteiro recebe o tipo/identificador do botão →
texto fixo enviado DEPOIS do guard de atendimento humano, sem chamar o motor-agente.
"""
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

STUB = {"canal_origem": "TEST_PHONE_ID", "agente_tipo": "Institucional", "canal_tipo": "Institucional", "unidade_cuca": None}
TEXTO_FIXO = "Presença confirmada! ✅ Te esperamos. Se tiver qualquer dúvida, é só mandar aqui. 😊"


def _payload(msg: dict) -> bytes:
    return json.dumps({
        "object": "whatsapp_business_account",
        "entry": [{"id": "WABA_ID", "changes": [{"field": "messages", "value": {
            "messaging_product": "whatsapp",
            "metadata": {"display_phone_number": "558500000000", "phone_number_id": "PHONE_CLIQUE"},
            "contacts": [{"profile": {"name": "Teste"}, "wa_id": "558591733321"}],
            "messages": [{"from": "558591733321", "id": "wamid.clique", "timestamp": "1750000000", **msg}],
        }}]}],
    }).encode()


CLIQUE = {"type": "button", "button": {"text": "Sim, eu vou!", "payload": "Sim, eu vou!"}}
DIGITADO = {"type": "text", "text": {"body": "Sim, eu vou!"}}


def _supabase(status="ativa"):
    sb = MagicMock()
    sb.table.return_value.upsert.return_value.execute.return_value.data = [{"id": "lead-1"}]
    sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {"bloqueado": False, "status": status}
    sb.table.return_value.select.return_value.match.return_value.execute.return_value.data = [{"id": "conv-1", "status": status}]
    sb.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
    sb.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock()
    sb.table.return_value.insert.return_value.execute.return_value = MagicMock()
    sb.rpc.return_value.execute.return_value = MagicMock()
    return sb


async def _rodar(msg: dict, porteiro_retorno, status="ativa"):
    from meta_adapter_inbound import processar_webhook_meta
    porteiro = MagicMock(return_value=porteiro_retorno)
    with patch("meta_adapter_inbound._get_instancia_by_phone_number_id", return_value=STUB), \
         patch("meta_adapter_inbound._get_supabase", return_value=_supabase(status)), \
         patch("academia_enem_porteiro.processar_mensagem_campanha", porteiro), \
         patch("meta_adapter_inbound._chamar_motor_agente", new_callable=AsyncMock, return_value=None) as motor, \
         patch("meta_adapter_outbound._meta_marcar_lida_e_digitando", new_callable=AsyncMock, return_value=True), \
         patch("meta_adapter_outbound._meta_enviar", new_callable=AsyncMock, return_value=True) as enviar:
        await processar_webhook_meta(_payload(msg))
    return porteiro, motor, enviar


@pytest.mark.asyncio
async def test_clique_de_presenca_responde_texto_fixo_sem_chamar_a_ia():
    porteiro, motor, enviar = await _rodar(CLIQUE, {"anotou": {"resposta": "confirmou"}, "responder": TEXTO_FIXO})
    assert porteiro.call_args.kwargs["botao"] == {"tipo": "button", "id": "Sim, eu vou!", "texto": "Sim, eu vou!"}
    assert porteiro.call_args.kwargs["mensagem"] == "Sim, eu vou!"
    motor.assert_not_called()
    enviar.assert_called_once()
    assert enviar.call_args[0][2] == TEXTO_FIXO


@pytest.mark.asyncio
async def test_clique_em_atendimento_humano_nao_envia_nada():
    _, motor, enviar = await _rodar(CLIQUE, {"anotou": {"resposta": "confirmou"}, "responder": TEXTO_FIXO}, status="awaiting_human")
    motor.assert_not_called()
    enviar.assert_not_called()


@pytest.mark.asyncio
async def test_texto_digitado_chega_ao_porteiro_como_nao_clique_e_vai_ao_agente():
    porteiro, motor, _ = await _rodar(DIGITADO, {"anotou": {"resposta": "confirmou"}})
    assert porteiro.call_args.kwargs["botao"] == {}
    motor.assert_called_once()
