"""
Testes unitários — S-WM-02: Adapter Outbound Meta + fluxo completo.
Cobre ACs 1-4 (Graph API client), 5 (persistência inbound), 6 (dispatch),
7 (engine Meta), 9 (transbordo neutro), 10-11 (loop proativo), 12-13 (/send-message).
"""
import json
import os
import sys
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

# ── Mock de módulos ausentes no ambiente de teste ──────────────────────────────
_supabase_mock = MagicMock()
_supabase_mock.create_client = MagicMock(return_value=MagicMock())
_supabase_mock.Client = MagicMock
sys.modules.setdefault("supabase", _supabase_mock)
sys.modules.setdefault("openai", MagicMock())
# httpx não é mockado globalmente — injetado por test via patch.dict

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from meta_adapter_outbound import _meta_enviar, GRAPH_API_VERSION


def _make_httpx_mock():
    """Mock de httpx para testes — injetado via sys.modules (lazy import pattern)."""
    mock_httpx = MagicMock()
    mock_httpx.TimeoutException = Exception
    mock_httpx.RequestError = Exception
    return mock_httpx


# ─────────────────────────────────────────────────────────────────────────────
# AC #1–4: cliente Graph API
# ─────────────────────────────────────────────────────────────────────────────

class TestMetaEnviar:

    @pytest.mark.asyncio
    async def test_envia_para_graph_api_v23(self):
        """AC #1: POST correto para /v23.0/{phone_number_id}/messages com Bearer."""
        mock_httpx = _make_httpx_mock()
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_httpx.AsyncClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.AsyncClient.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch.dict(sys.modules, {"httpx": mock_httpx}):
            result = await _meta_enviar("PNID_123", "5585999999999", "Olá", "token_teste")

        assert result is True
        call_repr = str(mock_client.post.call_args)
        assert GRAPH_API_VERSION in call_repr
        assert "PNID_123/messages" in call_repr
        headers = mock_client.post.call_args.kwargs.get("headers", {})
        assert "Bearer token_teste" in headers.get("Authorization", "")

    @pytest.mark.asyncio
    async def test_retorna_true_em_2xx(self):
        """AC #2: retorna True em qualquer 2xx sem delay anti-ban."""
        mock_httpx = _make_httpx_mock()
        mock_resp = MagicMock()
        mock_resp.status_code = 201
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_httpx.AsyncClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.AsyncClient.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch.dict(sys.modules, {"httpx": mock_httpx}):
            result = await _meta_enviar("PNID", "55859", "msg", "tok")

        assert result is True

    @pytest.mark.asyncio
    async def test_retorna_false_em_4xx(self):
        """AC #3: falha 4xx → retorna False, sem fallback UAZAPI."""
        mock_httpx = _make_httpx_mock()
        mock_resp = MagicMock()
        mock_resp.status_code = 400
        mock_resp.json.return_value = {"error": {"message": "bad request"}}
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_httpx.AsyncClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.AsyncClient.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch.dict(sys.modules, {"httpx": mock_httpx}):
            result = await _meta_enviar("PNID", "55859", "msg", "tok")

        assert result is False

    @pytest.mark.asyncio
    async def test_retorna_false_em_5xx(self):
        """AC #3: falha 5xx → False."""
        mock_httpx = _make_httpx_mock()
        mock_resp = MagicMock()
        mock_resp.status_code = 503
        mock_resp.json.side_effect = Exception("not json")
        mock_resp.text = "Service Unavailable"
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_httpx.AsyncClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.AsyncClient.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch.dict(sys.modules, {"httpx": mock_httpx}):
            result = await _meta_enviar("PNID", "55859", "msg", "tok")

        assert result is False

    @pytest.mark.asyncio
    async def test_retorna_false_em_timeout(self):
        """AC #3: timeout → False."""
        class FakeTimeoutException(Exception):
            pass

        mock_httpx = MagicMock()
        mock_httpx.TimeoutException = FakeTimeoutException
        mock_httpx.RequestError = Exception
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(side_effect=FakeTimeoutException("timeout"))
        mock_httpx.AsyncClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.AsyncClient.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch.dict(sys.modules, {"httpx": mock_httpx}):
            result = await _meta_enviar("PNID", "55859", "msg", "tok")

        assert result is False

    @pytest.mark.asyncio
    async def test_falha_antes_http_se_phone_number_id_ausente(self):
        """AC #4: phone_number_id vazio → False sem chamada HTTP."""
        mock_httpx = _make_httpx_mock()
        mock_client = AsyncMock()
        mock_httpx.AsyncClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.AsyncClient.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch.dict(sys.modules, {"httpx": mock_httpx}):
            result = await _meta_enviar("", "55859", "msg", "tok")

        mock_client.post.assert_not_called()
        assert result is False

    @pytest.mark.asyncio
    async def test_falha_antes_http_se_token_ausente(self):
        """AC #4: token vazio → False sem chamada HTTP."""
        mock_httpx = _make_httpx_mock()
        mock_client = AsyncMock()
        mock_httpx.AsyncClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.AsyncClient.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch.dict(sys.modules, {"httpx": mock_httpx}):
            result = await _meta_enviar("PNID", "55859", "msg", "")

        mock_client.post.assert_not_called()
        assert result is False

    @pytest.mark.asyncio
    async def test_token_nao_aparece_em_log_de_erro(self, caplog):
        """AC #4: token nunca exposto em logs de erro."""
        import logging
        mock_httpx = _make_httpx_mock()
        mock_resp = MagicMock()
        mock_resp.status_code = 403
        mock_resp.json.return_value = {"error": "forbidden"}
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=mock_resp)
        mock_httpx.AsyncClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.AsyncClient.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch.dict(sys.modules, {"httpx": mock_httpx}):
            with caplog.at_level(logging.ERROR):
                await _meta_enviar("PNID", "55859", "msg", "TOKEN_SECRETO_TESTE")

        for record in caplog.records:
            assert "TOKEN_SECRETO_TESTE" not in record.message


# ─────────────────────────────────────────────────────────────────────────────
# AC #5: persistência inbound Meta
# ─────────────────────────────────────────────────────────────────────────────

def _payload_texto(phone_number_id="TEST_EMPREG", telefone="558599999999", texto="Olá"):
    return json.dumps({
        "object": "whatsapp_business_account",
        "entry": [{
            "id": "WABA_ID",
            "changes": [{
                "value": {
                    "messaging_product": "whatsapp",
                    "metadata": {
                        "display_phone_number": "558500000000",
                        "phone_number_id": phone_number_id,
                    },
                    "contacts": [{"profile": {"name": "Cidadão Teste"}, "wa_id": telefone}],
                    "messages": [{
                        "from": telefone,
                        "id": "wamid.test",
                        "timestamp": "1750000000",
                        "type": "text",
                        "text": {"body": texto},
                    }],
                },
                "field": "messages",
            }],
        }],
    }).encode()


class TestPersistenciaInboundMeta:

    @pytest.mark.asyncio
    async def test_upsert_lead_e_cria_conversa(self):
        """AC #5: upsert lead + cria conversa por (lead_id, phone_number_id)."""
        from meta_adapter_inbound import processar_webhook_meta
        import empregabilidade_engine

        mock_sb = MagicMock()
        lead_data = MagicMock()
        lead_data.data = [{"id": "lead-uuid-123", "bloqueado": False}]
        fresh_data = MagicMock()
        fresh_data.data = {"bloqueado": False}
        conv_data = MagicMock()
        conv_data.data = []
        new_conv = MagicMock()
        new_conv.data = [{"id": "conv-uuid-456"}]
        rpc_data = MagicMock()

        mock_sb.table.return_value.upsert.return_value.execute.return_value = lead_data
        mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = fresh_data
        mock_sb.table.return_value.select.return_value.match.return_value.execute.return_value = conv_data
        mock_sb.table.return_value.insert.return_value.execute.return_value = new_conv
        mock_sb.rpc.return_value.execute.return_value = rpc_data

        dispatch_mock = AsyncMock()
        with patch("meta_adapter_inbound._get_instancia_by_phone_number_id",
                   return_value={"canal_origem": "cuca_emp", "agente_tipo": "Empregabilidade",
                                 "canal_tipo": "Empregabilidade", "unidade_cuca": None}), \
             patch("meta_adapter_inbound._get_supabase", return_value=mock_sb), \
             patch.object(empregabilidade_engine, "processar_mensagem_empregabilidade", dispatch_mock):
            await processar_webhook_meta(_payload_texto(phone_number_id="TEST_EMPREG"))

        mock_sb.table.assert_any_call("leads")
        mock_sb.table.assert_any_call("conversas")
        mock_sb.table.assert_any_call("mensagens")
        mock_sb.rpc.assert_called_once_with("increment_nao_lidas", {"conv_id": "conv-uuid-456"})

    @pytest.mark.asyncio
    async def test_lead_bloqueado_para_antes_do_dispatch(self):
        """AC #5: lead bloqueado → nenhum dispatch ao engine."""
        from meta_adapter_inbound import processar_webhook_meta
        import empregabilidade_engine

        mock_sb = MagicMock()
        lead_data = MagicMock()
        lead_data.data = [{"id": "lead-uuid-789", "bloqueado": True}]
        fresh_data = MagicMock()
        fresh_data.data = {"bloqueado": True}
        mock_sb.table.return_value.upsert.return_value.execute.return_value = lead_data
        mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = fresh_data

        dispatch_mock = AsyncMock()
        with patch("meta_adapter_inbound._get_instancia_by_phone_number_id",
                   return_value={"canal_origem": "c", "agente_tipo": "Empregabilidade",
                                 "canal_tipo": "Empregabilidade", "unidade_cuca": None}), \
             patch("meta_adapter_inbound._get_supabase", return_value=mock_sb), \
             patch.object(empregabilidade_engine, "processar_mensagem_empregabilidade", dispatch_mock):
            await processar_webhook_meta(_payload_texto())

        dispatch_mock.assert_not_called()

    @pytest.mark.asyncio
    async def test_nao_consulta_instancias_uazapi(self):
        """AC #5: nenhuma chamada a instancias_uazapi."""
        from meta_adapter_inbound import processar_webhook_meta
        import empregabilidade_engine

        mock_sb = MagicMock()
        lead_data = MagicMock()
        lead_data.data = [{"id": "lead-uuid"}]
        fresh_data = MagicMock()
        fresh_data.data = {"bloqueado": False}
        conv_data = MagicMock()
        conv_data.data = [{"id": "conv-uuid"}]
        msg_data = MagicMock()
        rpc_data = MagicMock()

        mock_sb.table.return_value.upsert.return_value.execute.return_value = lead_data
        mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = fresh_data
        mock_sb.table.return_value.select.return_value.match.return_value.execute.return_value = conv_data
        mock_sb.table.return_value.insert.return_value.execute.return_value = msg_data
        mock_sb.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock()
        mock_sb.rpc.return_value.execute.return_value = rpc_data

        with patch("meta_adapter_inbound._get_instancia_by_phone_number_id",
                   return_value={"canal_origem": "c", "agente_tipo": "Empregabilidade",
                                 "canal_tipo": "Empregabilidade", "unidade_cuca": None}), \
             patch("meta_adapter_inbound._get_supabase", return_value=mock_sb), \
             patch.object(empregabilidade_engine, "processar_mensagem_empregabilidade", AsyncMock()):
            await processar_webhook_meta(_payload_texto())

        for call in mock_sb.table.call_args_list:
            assert call.args[0] != "instancias_uazapi", \
                "Chamada não autorizada a instancias_uazapi detectada"


# ─────────────────────────────────────────────────────────────────────────────
# AC #6: dispatch inbound → Empregabilidade
# ─────────────────────────────────────────────────────────────────────────────

class TestDispatchInbound:

    @pytest.mark.asyncio
    async def test_dispatch_empregabilidade(self):
        """AC #6: agente_tipo=Empregabilidade → dispatch para processar_mensagem_empregabilidade."""
        from meta_adapter_inbound import processar_webhook_meta
        import empregabilidade_engine

        mock_sb = MagicMock()
        lead_data = MagicMock()
        lead_data.data = [{"id": "lead-uuid"}]
        fresh_data = MagicMock()
        fresh_data.data = {"bloqueado": False}
        conv_data = MagicMock()
        conv_data.data = [{"id": "conv-uuid"}]
        mock_sb.table.return_value.upsert.return_value.execute.return_value = lead_data
        mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value = fresh_data
        mock_sb.table.return_value.select.return_value.match.return_value.execute.return_value = conv_data
        mock_sb.table.return_value.insert.return_value.execute.return_value = MagicMock()
        mock_sb.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock()
        mock_sb.rpc.return_value.execute.return_value = MagicMock()

        dispatch_mock = AsyncMock()
        with patch("meta_adapter_inbound._get_instancia_by_phone_number_id",
                   return_value={"canal_origem": "c", "agente_tipo": "Empregabilidade",
                                 "canal_tipo": "Empregabilidade", "unidade_cuca": None}), \
             patch("meta_adapter_inbound._get_supabase", return_value=mock_sb), \
             patch.object(empregabilidade_engine, "processar_mensagem_empregabilidade", dispatch_mock):
            await processar_webhook_meta(_payload_texto(texto="Quero vaga"))

        dispatch_mock.assert_called_once()
        kwargs = dispatch_mock.call_args.kwargs
        assert kwargs["lead_id"] == "lead-uuid"
        assert kwargs["conversa_id"] == "conv-uuid"
        assert kwargs["texto"] == "Quero vaga"


# ─────────────────────────────────────────────────────────────────────────────
# AC #7: engine usa Meta env vars
# ─────────────────────────────────────────────────────────────────────────────

class TestEngineMeta:

    @pytest.mark.asyncio
    async def test_enviar_usa_meta_phone_da_tabela(self):
        """AC #7 (S-WM-03): _enviar() busca phone_number_id em meta_phone_numbers via _get_meta_phone."""
        from empregabilidade_engine import _enviar

        meta_mock = AsyncMock(return_value=True)
        with patch("meta_adapter_outbound._meta_enviar", meta_mock), \
             patch("empregabilidade_engine._get_meta_phone", return_value=("PNID_EMPREG_TEST", "TOKEN_EMPREG_TEST")):
            await _enviar("vestigial_inst", "vestigial_token", "5585999", "Mensagem")

        meta_mock.assert_called_once()
        args = meta_mock.call_args.args
        assert args[0] == "PNID_EMPREG_TEST"
        assert args[1] == "5585999"
        assert args[2] == "Mensagem"
        assert args[3] == "TOKEN_EMPREG_TEST"

    @pytest.mark.asyncio
    async def test_enviar_nao_grava_mensagem_em_falha_meta(self):
        """AC 17 (S-WM-03 / AC 8 S-WM-02): insert em mensagens NÃO ocorre quando _meta_enviar retorna False."""
        from empregabilidade_engine import _enviar

        meta_mock = AsyncMock(return_value=False)
        mock_sb = MagicMock()

        with patch("meta_adapter_outbound._meta_enviar", meta_mock), \
             patch("empregabilidade_engine._get_meta_phone", return_value=("PNID", "TOK")), \
             patch("empregabilidade_engine.supabase", mock_sb):
            result = await _enviar("", "", "5585999", "Texto", conversa_id="conv-uuid", lead_id="lead-uuid")

        assert result is False
        mensagens_calls = [c for c in mock_sb.table.call_args_list if c.args and c.args[0] == "mensagens"]
        assert not mensagens_calls, f"insert em mensagens não deve ocorrer em falha: {mensagens_calls}"


# ─────────────────────────────────────────────────────────────────────────────
# AC #9: transbordo neutro
# ─────────────────────────────────────────────────────────────────────────────

class TestTransbordoNeutro:

    @pytest.mark.asyncio
    async def test_transbordo_palavra_chave_envia_mensagem_neutra(self):
        """AC #9: transbordo por palavra-chave → mensagem neutra exata, sem alerta ao atendente."""
        from empregabilidade_engine import processar_mensagem_empregabilidade

        mock_sb = MagicMock()
        mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {"metadata": {}}

        mensagens_enviadas = []

        async def _fake_enviar(inst, tok, phone, texto, **kw):
            mensagens_enviadas.append(texto)
            return True

        with patch("empregabilidade_engine.supabase", mock_sb), \
             patch("empregabilidade_engine._enviar", _fake_enviar):
            await processar_mensagem_empregabilidade(
                texto="quero falar com humano",
                phone="5585999999999",
                instance_name="",
                token="",
                lead_id="lead-uuid",
                conversa_id="conv-uuid",
                unidade_cuca="Centro",
                push_name="Cidadão",
            )

        assert any("solicitação foi registrada" in m for m in mensagens_enviadas), \
            "Mensagem neutra de transbordo não foi enviada"
        assert not any("TRANSBORDO" in m for m in mensagens_enviadas), \
            "Alerta ao atendente não deve ser enviado (AC #9)"


# ─────────────────────────────────────────────────────────────────────────────
# AC #10–11: loop proativo
# ─────────────────────────────────────────────────────────────────────────────

class TestLoopProativo:

    @pytest.mark.asyncio
    async def test_loop_nao_avanca_estado_em_falha_meta(self):
        """AC #11: falha no envio → _set_fluxo NÃO chamado."""
        from empregabilidade_engine import empregabilidade_notify_loop
        import asyncio as asyncio_lib

        conversa_fake = {
            "id": "conv-uuid",
            "lead_id": "lead-uuid",
            "origem_id": "PNID_EMPREG",
            "metadata": {
                "empreg_fluxo": {
                    "etapa": "aguardando_retorno_vaga",
                    "vaga_criada_id": "vaga-uuid",
                    "vaga_numero": 42,
                    "vaga_titulo": "Vaga Teste",
                }
            },
        }

        mock_sb = MagicMock()
        mock_sb.table.return_value.select.return_value.eq.return_value.in_.return_value.execute.return_value.data = [conversa_fake]
        mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {"telefone": "5585999999999"}

        set_fluxo_calls = []

        async def _fail_enviar(*args, **kwargs):
            return False

        def _fake_set_fluxo(conv_id, data):
            set_fluxo_calls.append((conv_id, data))

        call_count = 0

        async def _fake_sleep(seconds):
            nonlocal call_count
            call_count += 1
            raise asyncio_lib.CancelledError()

        with patch("empregabilidade_engine.supabase", mock_sb), \
             patch("empregabilidade_engine._enviar", _fail_enviar), \
             patch("empregabilidade_engine._set_fluxo", _fake_set_fluxo), \
             patch("empregabilidade_engine._get_meta_phone", return_value=("PNID", "TOK")), \
             patch("asyncio.sleep", _fake_sleep):
            try:
                await empregabilidade_notify_loop()
            except asyncio_lib.CancelledError:
                pass

        assert set_fluxo_calls == [], \
            f"_set_fluxo foi chamado mesmo após falha no envio: {set_fluxo_calls}"

    @pytest.mark.asyncio
    async def test_loop_filtra_etapas_corretas(self):
        """AC 18 (S-WM-03 / AC 10 S-WM-02): loop processa etapa de notificação e ignora outras."""
        from empregabilidade_engine import empregabilidade_notify_loop
        import asyncio as asyncio_lib

        # Uma conversa com etapa de notificação + dados corretos → deve avançar estado
        # Uma conversa com etapa ignorada → não deve avançar estado
        conversas_fake = [
            {
                "id": "conv-notif",
                "lead_id": "lead-uuid",
                "origem_id": "PNID",
                "metadata": {"empreg_fluxo": {
                    "etapa": "aguardando_retorno_vaga",
                    "vaga_criada_id": "v-uuid",
                    "vaga_numero": 1,
                    "vaga_titulo": "Vaga Teste",
                }},
            },
            {
                "id": "conv-ignorado",
                "lead_id": "lead-uuid",
                "origem_id": "PNID",
                "metadata": {"empreg_fluxo": {"etapa": "listou_vagas"}},
            },
        ]

        mock_sb = MagicMock()
        mock_sb.table.return_value.select.return_value.eq.return_value.in_.return_value.execute.return_value.data = conversas_fake
        mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {"telefone": "5585999999999"}

        envio_count = []

        async def _fake_enviar(*args, **kwargs):
            envio_count.append(1)
            return True

        set_fluxo_ids = []

        def _fake_set_fluxo(conv_id, data):
            set_fluxo_ids.append(conv_id)

        async def _fake_sleep(seconds):
            raise asyncio_lib.CancelledError()

        with patch("empregabilidade_engine.supabase", mock_sb), \
             patch("empregabilidade_engine._enviar", _fake_enviar), \
             patch("empregabilidade_engine._set_fluxo", _fake_set_fluxo), \
             patch("empregabilidade_engine._get_meta_phone", return_value=("PNID", "TOK")), \
             patch("asyncio.sleep", _fake_sleep):
            try:
                await empregabilidade_notify_loop()
            except asyncio_lib.CancelledError:
                pass

        assert len(envio_count) == 1, \
            f"_enviar deve ser chamado 1 vez (etapa de notificação com dados), foi {len(envio_count)}"
        assert "conv-notif" in set_fluxo_ids, "_set_fluxo deve ser chamado para conv-notif"
        assert "conv-ignorado" not in set_fluxo_ids, \
            "_set_fluxo não deve ser chamado para etapa ignorada"

    @pytest.mark.asyncio
    async def test_loop_sleep_chamado_ao_final_de_iteracao(self):
        """AC 18 (S-WM-03 / AC 10 S-WM-02): asyncio.sleep(20) chamado ao final de cada iteração."""
        from empregabilidade_engine import empregabilidade_notify_loop
        import asyncio as asyncio_lib

        mock_sb = MagicMock()
        mock_sb.table.return_value.select.return_value.eq.return_value.in_.return_value.execute.return_value.data = []

        sleep_calls = []

        async def _fake_sleep(seconds):
            sleep_calls.append(seconds)
            raise asyncio_lib.CancelledError()

        with patch("empregabilidade_engine.supabase", mock_sb), \
             patch("asyncio.sleep", _fake_sleep):
            try:
                await empregabilidade_notify_loop()
            except asyncio_lib.CancelledError:
                pass

        assert len(sleep_calls) >= 1, "asyncio.sleep deve ser chamado ao final da iteração"
        assert sleep_calls[0] == 20, f"sleep deve ser 20s, mas foi {sleep_calls[0]}"


import importlib as _importlib
_fastapi_available = _importlib.util.find_spec("fastapi") is not None


# ─────────────────────────────────────────────────────────────────────────────
# AC #12–13: /send-message Meta puro
# Requerem fastapi — pulados se não disponível no ambiente de teste
# ─────────────────────────────────────────────────────────────────────────────

@pytest.mark.skipif(not _fastapi_available, reason="fastapi não disponível neste ambiente de teste")
class TestSendMessageEndpoint:

    def test_envia_via_meta_com_contrato_novo(self):
        """AC #12: {number, text, instance} → envia via Meta, ignora instance."""
        from fastapi.testclient import TestClient
        import worker.main as main_module

        meta_mock = AsyncMock(return_value=True)
        env = {
            "WEBHOOK_INTERNAL_TOKEN": "tok_interno",
            "META_STUB_PHONE_NUMBER_ID_EMPREG": "PNID",
            "META_SYSTEM_USER_TOKEN": "TOKEN",
        }
        with patch("worker.main._meta_enviar", meta_mock, create=True), \
             patch.dict(os.environ, env):
            with TestClient(main_module.app) as client:
                resp = client.post(
                    "/send-message/tok_interno",
                    json={"number": "5585999", "text": "Olá", "instance": "ignored"},
                )

        assert resp.status_code == 200
        assert resp.json()["status"] == "sent"

    def test_rejeita_contrato_antigo_phone_message(self):
        """AC #13: {phone, message} → 400."""
        from fastapi.testclient import TestClient
        import worker.main as main_module

        with patch.dict(os.environ, {"WEBHOOK_INTERNAL_TOKEN": "tok_interno"}):
            with TestClient(main_module.app) as client:
                resp = client.post(
                    "/send-message/tok_interno",
                    json={"phone": "5585999", "message": "Olá"},
                )

        assert resp.status_code == 400

    def test_rejeita_token_invalido(self):
        """AC #12: token inválido → 403."""
        from fastapi.testclient import TestClient
        import worker.main as main_module

        with patch.dict(os.environ, {"WEBHOOK_INTERNAL_TOKEN": "tok_certo"}):
            with TestClient(main_module.app) as client:
                resp = client.post(
                    "/send-message/tok_errado",
                    json={"number": "5585999", "text": "Olá"},
                )

        assert resp.status_code == 403
