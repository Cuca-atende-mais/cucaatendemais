"""
Testes unitários — Adapter Inbound Meta (S-WM-01)
"""
import json
import hmac
import hashlib
import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from meta_adapter_inbound import (
    validar_hmac_meta,
    _get_instancia_by_phone_number_id,
    _parse_mensagem_meta,
    build_contrato_v2,
    processar_webhook_meta,
)


# ─── Helpers ──────────────────────────────────────────────────────────────────
def _payload_texto(phone_number_id="TEST_ID", telefone="558599999999", texto="Olá"):
    return {
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
                    "contacts": [{"profile": {"name": "Teste"}, "wa_id": telefone}],
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
    }


def _payload_audio(phone_number_id="TEST_ID", media_id="MEDIA_123"):
    return {
        "object": "whatsapp_business_account",
        "entry": [{
            "id": "WABA_ID",
            "changes": [{
                "value": {
                    "messaging_product": "whatsapp",
                    "metadata": {"display_phone_number": "558500000000", "phone_number_id": phone_number_id},
                    "contacts": [{"profile": {"name": "Teste"}, "wa_id": "558599999999"}],
                    "messages": [{
                        "from": "558599999999",
                        "id": "wamid.test",
                        "timestamp": "1750000000",
                        "type": "audio",
                        "audio": {
                            "mime_type": "audio/ogg; codecs=opus",
                            "sha256": "abc123",
                            "id": media_id,
                            "voice": True,
                        },
                    }],
                },
                "field": "messages",
            }],
        }],
    }


def _payload_imagem(phone_number_id="TEST_ID", media_id="IMG_123"):
    return {
        "object": "whatsapp_business_account",
        "entry": [{
            "id": "WABA_ID",
            "changes": [{
                "value": {
                    "messaging_product": "whatsapp",
                    "metadata": {"display_phone_number": "558500000000", "phone_number_id": phone_number_id},
                    "contacts": [{"profile": {"name": "Teste"}, "wa_id": "558599999999"}],
                    "messages": [{
                        "from": "558599999999",
                        "id": "wamid.test",
                        "timestamp": "1750000000",
                        "type": "image",
                        "image": {"mime_type": "image/jpeg", "sha256": "def456", "id": media_id},
                    }],
                },
                "field": "messages",
            }],
        }],
    }


_STUB_INSTANCIA = {
    "canal_origem": "cuca_empregabilidade_01",
    "agente_tipo":  "Empregabilidade",
    "canal_tipo":   "Empregabilidade",
    "unidade_cuca": None,
}


# ─── HMAC ─────────────────────────────────────────────────────────────────────
class TestHmac:
    def test_hmac_valido(self):
        secret = "meu_segredo_123"
        body = b'{"test": true}'
        sig = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
        assert validar_hmac_meta(body, sig, secret) is True

    def test_hmac_invalido_assinatura_errada(self):
        assert validar_hmac_meta(b"body", "sha256=invalido", "segredo") is False

    def test_hmac_header_ausente(self):
        assert validar_hmac_meta(b"body", None, "segredo") is False

    def test_hmac_header_vazio(self):
        assert validar_hmac_meta(b"body", "", "segredo") is False

    def test_hmac_body_diferente(self):
        secret = "segredo"
        sig = "sha256=" + hmac.new(secret.encode(), b"body_original", hashlib.sha256).hexdigest()
        assert validar_hmac_meta(b"body_alterado", sig, secret) is False


# ─── Lookup / Guard ───────────────────────────────────────────────────────────
class TestLookup:
    def test_phone_number_id_desconhecido_retorna_none(self):
        """Guard: DB retorna data=None → None (sem erro)."""
        from unittest.mock import MagicMock, patch
        mock_sb = MagicMock()
        mock_sb.table.return_value.select.return_value \
            .eq.return_value.eq.return_value \
            .maybe_single.return_value.execute.return_value.data = None
        with patch("meta_adapter_inbound._get_supabase", return_value=mock_sb):
            assert _get_instancia_by_phone_number_id("PHONE_ID_NAO_EXISTE_JAMAIS") is None

    @pytest.mark.asyncio
    async def test_phone_number_id_desconhecido_200_discard(self):
        """AC #4: phone_number_id desconhecido → processamento descartado sem exception."""
        from unittest.mock import patch
        payload = _payload_texto(phone_number_id="ID_DESCONHECIDO")
        raw_body = json.dumps(payload).encode()

        with patch("meta_adapter_inbound._get_instancia_by_phone_number_id", return_value=None) as mock_lookup:
            await processar_webhook_meta(raw_body)
            mock_lookup.assert_called_once_with("ID_DESCONHECIDO")


# ─── Parser ───────────────────────────────────────────────────────────────────
class TestParseMensagem:
    @pytest.mark.asyncio
    async def test_parse_mensagem_texto(self):
        """AC #5: mensagem texto → midia_tipo='text', sem instancia_uazapi."""
        msg = {"type": "text", "from": "558599999999", "text": {"body": "Olá mundo"}}
        texto, midia_url, midia_tipo = await _parse_mensagem_meta(msg)
        assert texto == "Olá mundo"
        assert midia_url is None
        assert midia_tipo == "text"

    @pytest.mark.asyncio
    async def test_parse_mensagem_audio_voz(self):
        """AC #6: áudio → midia_tipo='voz', mensagem=transcrição Whisper."""
        from unittest.mock import patch, AsyncMock
        msg = {
            "type": "audio",
            "from": "558599999999",
            "audio": {"mime_type": "audio/ogg; codecs=opus", "sha256": "x", "id": "MEDIA_ID", "voice": True},
        }
        audio_falso = b"FAKE_AUDIO_BYTES"
        transcricao = "texto transcrito do áudio"

        with patch("meta_adapter_inbound._baixar_midia_meta", new_callable=AsyncMock, return_value=audio_falso), \
             patch("meta_adapter_inbound._transcrever_audio_meta", new_callable=AsyncMock, return_value=transcricao), \
             patch.dict(os.environ, {"META_SYSTEM_USER_TOKEN": "token_fake"}):
            texto, midia_url, midia_tipo = await _parse_mensagem_meta(msg)

        assert texto == transcricao
        assert midia_url is None
        assert midia_tipo == "voz"

    @pytest.mark.asyncio
    async def test_parse_mensagem_imagem(self):
        """AC #7: imagem → midia_tipo='image'."""
        msg = {
            "type": "image",
            "from": "558599999999",
            "image": {"mime_type": "image/jpeg", "sha256": "x", "id": "IMG_ID"},
        }
        _, _, midia_tipo = await _parse_mensagem_meta(msg)
        assert midia_tipo == "image"


# ─── Contrato v2 ──────────────────────────────────────────────────────────────
class TestContratoV2:
    @pytest.mark.asyncio
    async def test_contrato_v2_campos_completos(self):
        """AC #5: 9 campos obrigatórios presentes e instancia_uazapi ausente."""
        from unittest.mock import patch, AsyncMock
        payload = _payload_texto(telefone="558599999999", texto="Mensagem")

        with patch("meta_adapter_inbound._parse_mensagem_meta", new_callable=AsyncMock,
                   return_value=("Mensagem", None, "text")):
            contrato = await build_contrato_v2(payload, _STUB_INSTANCIA)

        campos = ["canal_origem", "telefone", "agente_tipo", "unidade_cuca",
                  "canal_tipo", "mensagem", "midia_url", "midia_tipo", "data_atual"]
        for campo in campos:
            assert campo in contrato, f"Campo obrigatório ausente: {campo}"

        assert "instancia_uazapi" not in contrato
        assert contrato["canal_origem"] == "cuca_empregabilidade_01"
        assert contrato["telefone"] == "558599999999"
        assert contrato["midia_tipo"] == "text"

    @pytest.mark.asyncio
    async def test_contrato_v2_sem_instancia_uazapi(self):
        from unittest.mock import patch, AsyncMock
        payload = _payload_texto()
        with patch("meta_adapter_inbound._parse_mensagem_meta", new_callable=AsyncMock,
                   return_value=("msg", None, "text")):
            contrato = await build_contrato_v2(payload, _STUB_INSTANCIA)
        assert "instancia_uazapi" not in contrato
        assert "canal_origem" in contrato


# ─── Regressão — Rename touch points 1 e 2 ────────────────────────────────────
class TestRenomeTouchPoints:
    def test_rename_touch_point_regressao(self):
        """
        S-WM-01 touch points: payload motor-agente (institucional_engine.py) e Edge Function
        devem usar 'canal_origem'. Touch point 1 (main.py payload_edge via UAZAPI) foi
        removido em S-WM-02 junto com process_webhook_payload() — validado pela ausência
        do código UAZAPI em main.py.
        """
        worker_dir = os.path.join(os.path.dirname(__file__), "..")

        # Touch point 1 (S-WM-02): process_webhook_payload removido — não deve existir em main.py
        with open(os.path.join(worker_dir, "main.py"), encoding="utf-8") as f:
            main_content = f.read()
        assert "process_webhook_payload" not in main_content, (
            "Regressão S-WM-02 touch point 1: process_webhook_payload ainda presente em main.py"
        )

        # Touch point 2 (S-WM-05): institucional_engine.py foi DELETADO — confirmar ausência
        assert not os.path.exists(os.path.join(worker_dir, "institucional_engine.py")), (
            "Regressão S-WM-05 touch point 2: institucional_engine.py ainda existe — deve ter sido deletado"
        )

        # Touch point 3: Edge Function motor-agente deve ler 'canal_origem' do body
        edge_fn = os.path.join(os.path.dirname(__file__), "..", "..",
                               "supabase", "functions", "motor-agente", "index.ts")
        with open(edge_fn, encoding="utf-8") as f:
            edge_content = f.read()
        assert "canal_origem" in edge_content, (
            "Regressão touch point 3: 'canal_origem' não encontrado em motor-agente/index.ts"
        )
        # S-WM-12 AC 8: alias transitório 'canal_origem: instancia_uazapi' foi REMOVIDO — destructure direto
        assert "canal_origem: instancia_uazapi" not in edge_content, (
            "Regressão S-WM-12 AC 8: alias transitório ainda presente — deve ter sido limpo"
        )


# ─── S-WM-04: Dispatch para motor-agente ──────────────────────────────────────
class TestDispatchMotorAgente:
    """AC 1-6 de S-WM-04: dispatch para motor-agente via _chamar_motor_agente."""

    _MOTOR_AGENTE_RESP_OK = {
        "success": True,
        "agente_usado": "Institucional",
        "handover": False,
        "encerrado": False,
        "resposta": "Olá! Como posso ajudar?",
    }

    def _make_stub(self, agente_tipo: str, canal_tipo: str = "Institucional"):
        return {
            "canal_origem": "TEST_PHONE_ID",
            "agente_tipo": agente_tipo,
            "canal_tipo": canal_tipo,
            "unidade_cuca": None,
        }

    @staticmethod
    def _make_mock_httpx(post_return=None, post_side_effect=None):
        """Injeta um módulo httpx falso em sys.modules (httpx não instalado no env de teste)."""
        import sys, types
        from unittest.mock import AsyncMock, MagicMock

        mock_client_instance = AsyncMock()
        mock_client_instance.__aenter__ = AsyncMock(return_value=mock_client_instance)
        mock_client_instance.__aexit__ = AsyncMock(return_value=False)
        if post_side_effect:
            mock_client_instance.post = AsyncMock(side_effect=post_side_effect)
        else:
            mock_client_instance.post = AsyncMock(return_value=post_return)

        mock_httpx = types.ModuleType("httpx")
        mock_httpx.AsyncClient = MagicMock(return_value=mock_client_instance)
        mock_httpx.RequestError = Exception
        mock_httpx.TimeoutException = Exception
        return mock_httpx, mock_client_instance

    # ── _chamar_motor_agente: retorna texto em sucesso ────────────────────
    @pytest.mark.asyncio
    async def test_chamar_motor_agente_retorna_resposta(self):
        """AC 1: motor-agente respondeu → retorna texto de resposta."""
        import sys
        from unittest.mock import AsyncMock, MagicMock, patch
        from meta_adapter_inbound import _chamar_motor_agente

        mock_resp = MagicMock()
        mock_resp.is_success = True
        mock_resp.json.return_value = self._MOTOR_AGENTE_RESP_OK

        mock_httpx, _ = self._make_mock_httpx(post_return=mock_resp)

        contrato = {
            "mensagem": "oi",
            "midia_url": None,
            "midia_tipo": "text",
            "telefone": "558599990000",
            "canal_origem": "TEST_PHONE_ID",
            "agente_tipo": "Institucional",
            "unidade_cuca": None,
        }

        with patch.dict(os.environ, {"SUPABASE_URL": "http://fake", "SUPABASE_SERVICE_ROLE_KEY": "fake_key"}), \
             patch.dict(sys.modules, {"httpx": mock_httpx}):
            resultado = await _chamar_motor_agente(contrato, "conversa-uuid-123", MagicMock())

        assert resultado == "Olá! Como posso ajudar?"

    # ── Resilência: falha HTTP → retorna None sem propagar ────────────────
    @pytest.mark.asyncio
    async def test_chamar_motor_agente_falha_http_retorna_none(self):
        """AC 6: falha HTTP → None, sem exception propagada."""
        import sys
        from unittest.mock import MagicMock, patch
        from meta_adapter_inbound import _chamar_motor_agente

        mock_httpx, _ = self._make_mock_httpx(post_side_effect=Exception("timeout simulado"))

        with patch.dict(os.environ, {"SUPABASE_URL": "http://fake", "SUPABASE_SERVICE_ROLE_KEY": "k"}), \
             patch.dict(sys.modules, {"httpx": mock_httpx}):
            resultado = await _chamar_motor_agente(
                {"mensagem": "x", "telefone": "55", "canal_origem": "id", "agente_tipo": "sofia"},
                "conv-id",
                MagicMock(),
            )

        assert resultado is None

    # ── Handover: atualiza conversas.status ───────────────────────────────
    @pytest.mark.asyncio
    async def test_chamar_motor_agente_handover_atualiza_status(self):
        """AC 5: handover=true → conversas.status='awaiting_human' + _notificar_transbordo chamado."""
        import sys
        from unittest.mock import AsyncMock, MagicMock, patch
        from meta_adapter_inbound import _chamar_motor_agente

        resp_handover = {**self._MOTOR_AGENTE_RESP_OK, "handover": True, "resposta": "Transferindo..."}
        mock_resp = MagicMock()
        mock_resp.is_success = True
        mock_resp.json.return_value = resp_handover

        mock_httpx, _ = self._make_mock_httpx(post_return=mock_resp)
        mock_supabase = MagicMock()

        with patch.dict(os.environ, {"SUPABASE_URL": "http://fake", "SUPABASE_SERVICE_ROLE_KEY": "k"}), \
             patch.dict(sys.modules, {"httpx": mock_httpx}), \
             patch("meta_adapter_inbound._notificar_transbordo", new_callable=AsyncMock) as mock_notificar:
            resultado = await _chamar_motor_agente(
                {"mensagem": "x", "telefone": "55", "canal_origem": "id", "agente_tipo": "sofia"},
                "conv-uuid-abc",
                mock_supabase,
            )

        assert resultado == "Transferindo..."
        mock_supabase.table.assert_called_with("conversas")
        mock_supabase.table.return_value.update.assert_called_once_with(
            {"status": "awaiting_human", "updated_at": "now()"}
        )
        mock_notificar.assert_called_once()
        call_kwargs = mock_notificar.call_args.kwargs
        assert call_kwargs["modulo"] == "ouvidoria"
        assert call_kwargs["lead_identificacao"] == "55"

    # ── Dispatch completo: agentes motor-agente roteiam corretamente ──────
    @pytest.mark.asyncio
    async def test_processar_webhook_agentes_motor_agente(self):
        """AC 1/2/3: Institucional/sofia/ana → _chamar_motor_agente chamado + _meta_enviar."""
        from unittest.mock import patch, AsyncMock, MagicMock
        from meta_adapter_inbound import processar_webhook_meta

        for agente in ("Institucional", "sofia", "ana"):
            stub = self._make_stub(agente)
            payload = _payload_texto(phone_number_id="INST_PHONE_ID", texto="oi")
            raw = json.dumps(payload).encode()

            mock_supabase = MagicMock()
            mock_supabase.table.return_value.upsert.return_value.execute.return_value.data = [
                {"id": "lead-id-1"}
            ]
            mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
                "bloqueado": False
            }
            mock_supabase.table.return_value.select.return_value.match.return_value.execute.return_value.data = [
                {"id": "conv-id-1", "status": "ativa"}
            ]
            mock_supabase.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
            mock_supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock()
            mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()
            mock_supabase.rpc.return_value.execute.return_value = MagicMock()

            with patch("meta_adapter_inbound._get_instancia_by_phone_number_id", return_value=stub), \
                 patch("meta_adapter_inbound._get_supabase", return_value=mock_supabase), \
                 patch("meta_adapter_inbound._chamar_motor_agente", new_callable=AsyncMock,
                       return_value="Resposta motor") as mock_motor, \
                 patch("meta_adapter_outbound._meta_enviar", new_callable=AsyncMock,
                       return_value=True) as mock_enviar:
                await processar_webhook_meta(raw)

            mock_motor.assert_called_once(), f"motor-agente não chamado para agente={agente}"
            mock_enviar.assert_called_once(), f"_meta_enviar não chamado para agente={agente}"

    # ── Discard: agente_tipo desconhecido não envia nada ─────────────────
    @pytest.mark.asyncio
    async def test_processar_webhook_agente_desconhecido_descartado(self):
        """AC 4: agente_tipo desconhecido → nenhum envio, log de discard."""
        from unittest.mock import patch, AsyncMock, MagicMock
        from meta_adapter_inbound import processar_webhook_meta

        stub_desconhecido = self._make_stub("agente_inexistente")
        payload = _payload_texto(phone_number_id="UNKNOWN_PHONE", texto="oi")
        raw = json.dumps(payload).encode()

        mock_supabase = MagicMock()
        mock_supabase.table.return_value.upsert.return_value.execute.return_value.data = [{"id": "l1"}]
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {"bloqueado": False}
        mock_supabase.table.return_value.select.return_value.match.return_value.execute.return_value.data = [{"id": "c1", "status": "ativa"}]
        mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()
        mock_supabase.rpc.return_value.execute.return_value = MagicMock()

        with patch("meta_adapter_inbound._get_instancia_by_phone_number_id", return_value=stub_desconhecido), \
             patch("meta_adapter_inbound._get_supabase", return_value=mock_supabase), \
             patch("meta_adapter_inbound._chamar_motor_agente", new_callable=AsyncMock) as mock_motor, \
             patch("meta_adapter_outbound._meta_enviar", new_callable=AsyncMock) as mock_enviar:
            await processar_webhook_meta(raw)

        mock_motor.assert_not_called()
        mock_enviar.assert_not_called()

    # ── Guard awaiting_human: IA silenciada, nenhum dispatch ─────────────
    @pytest.mark.asyncio
    async def test_awaiting_human_silencia_ia(self):
        """AC 1/4: status='awaiting_human' → IA silenciada, nenhum dispatch chamado."""
        import sys, types
        from unittest.mock import patch, AsyncMock, MagicMock
        from meta_adapter_inbound import processar_webhook_meta

        mock_processar_emp = AsyncMock()
        fake_emp_module = types.ModuleType("empregabilidade_engine")
        fake_emp_module.processar_mensagem_empregabilidade = mock_processar_emp

        for agente in ("Empregabilidade", "Institucional", "sofia", "ana"):
            stub = self._make_stub(agente, canal_tipo=agente if agente == "Empregabilidade" else "Institucional")
            payload = _payload_texto(phone_number_id="PHONE_AWAIT", texto="mensagem lead")
            raw = json.dumps(payload).encode()

            mock_supabase = MagicMock()
            mock_supabase.table.return_value.upsert.return_value.execute.return_value.data = [{"id": "l-aw"}]
            mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {"bloqueado": False}
            mock_supabase.table.return_value.select.return_value.match.return_value.execute.return_value.data = [
                {"id": "c-aw", "status": "awaiting_human"}
            ]
            mock_supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock()
            mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()
            mock_supabase.rpc.return_value.execute.return_value = MagicMock()

            with patch.dict(sys.modules, {"empregabilidade_engine": fake_emp_module}), \
                 patch("meta_adapter_inbound._get_instancia_by_phone_number_id", return_value=stub), \
                 patch("meta_adapter_inbound._get_supabase", return_value=mock_supabase), \
                 patch("meta_adapter_inbound._chamar_motor_agente", new_callable=AsyncMock) as mock_motor, \
                 patch("meta_adapter_outbound._meta_enviar", new_callable=AsyncMock) as mock_enviar:
                await processar_webhook_meta(raw)

            mock_motor.assert_not_called(), f"motor-agente chamado para agente={agente} em awaiting_human"
            mock_processar_emp.assert_not_called(), f"empregabilidade chamada para agente={agente} em awaiting_human"
            mock_enviar.assert_not_called(), f"_meta_enviar chamado para agente={agente} em awaiting_human"
            mock_processar_emp.reset_mock()

    # ── Guard awaiting_human: status null (UAZAPI legado) → dispatch normal ──
    @pytest.mark.asyncio
    async def test_status_null_nao_silencia_ia(self):
        """AC 2: conversas com status=null (UAZAPI legado) não são silenciadas."""
        import sys, types
        from unittest.mock import patch, AsyncMock, MagicMock
        from meta_adapter_inbound import processar_webhook_meta

        mock_processar = AsyncMock()
        fake_emp_module = types.ModuleType("empregabilidade_engine")
        fake_emp_module.processar_mensagem_empregabilidade = mock_processar

        stub = _STUB_INSTANCIA
        payload = _payload_texto(phone_number_id="EMP_NULL", texto="mensagem")
        raw = json.dumps(payload).encode()

        mock_supabase = MagicMock()
        mock_supabase.table.return_value.upsert.return_value.execute.return_value.data = [{"id": "l-null"}]
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {"bloqueado": False}
        mock_supabase.table.return_value.select.return_value.match.return_value.execute.return_value.data = [
            {"id": "c-null", "status": None}
        ]
        mock_supabase.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
        mock_supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock()
        mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()
        mock_supabase.rpc.return_value.execute.return_value = MagicMock()

        with patch.dict(sys.modules, {"empregabilidade_engine": fake_emp_module}), \
             patch("meta_adapter_inbound._get_instancia_by_phone_number_id", return_value=stub), \
             patch("meta_adapter_inbound._get_supabase", return_value=mock_supabase), \
             patch("meta_adapter_inbound._chamar_motor_agente", new_callable=AsyncMock) as mock_motor:
            await processar_webhook_meta(raw)

        mock_processar.assert_called_once()
        mock_motor.assert_not_called()

    # ── S-WM-09: motor-agente sinaliza handover → _notificar_transbordo chamado ──
    @pytest.mark.asyncio
    async def test_processar_webhook_motor_agente_handover_chama_notificar(self):
        """AC 7/8: handover=true no motor-agente → _notificar_transbordo chamado com modulo correto."""
        from unittest.mock import patch, AsyncMock, MagicMock
        from meta_adapter_inbound import processar_webhook_meta

        for agente, modulo_esperado in [("sofia", "ouvidoria"), ("maria", "programacao"), ("Institucional", "programacao")]:
            stub = self._make_stub(agente)
            payload = _payload_texto(phone_number_id="INST_PHONE_ID", texto="falar com atendente")
            raw = json.dumps(payload).encode()

            mock_supabase = MagicMock()
            mock_supabase.table.return_value.upsert.return_value.execute.return_value.data = [{"id": "lead-h1"}]
            mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {"bloqueado": False}
            mock_supabase.table.return_value.select.return_value.match.return_value.execute.return_value.data = [
                {"id": "conv-h1", "status": "ativa"}
            ]
            mock_supabase.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
            mock_supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock()
            mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()
            mock_supabase.rpc.return_value.execute.return_value = MagicMock()

            resp_handover = {"success": True, "handover": True, "encerrado": False, "resposta": "Aguarde..."}

            with patch("meta_adapter_inbound._get_instancia_by_phone_number_id", return_value=stub), \
                 patch("meta_adapter_inbound._get_supabase", return_value=mock_supabase), \
                 patch("meta_adapter_inbound._chamar_motor_agente", new_callable=AsyncMock,
                       return_value="Aguarde...") as mock_motor, \
                 patch("meta_adapter_inbound._notificar_transbordo", new_callable=AsyncMock) as mock_notif, \
                 patch("meta_adapter_outbound._meta_enviar", new_callable=AsyncMock):
                await processar_webhook_meta(raw)

            mock_motor.assert_called_once()

    # ── Regressão: Empregabilidade não afetada pelo novo dispatch ─────────
    @pytest.mark.asyncio
    async def test_empregabilidade_nao_usa_motor_agente(self):
        """AC 8: Empregabilidade ainda chama processar_mensagem_empregabilidade, nunca motor-agente."""
        import sys, types
        from unittest.mock import patch, AsyncMock, MagicMock
        from meta_adapter_inbound import processar_webhook_meta

        # empregabilidade_engine importa `supabase` que não existe no env de teste.
        # Injetar módulo fake em sys.modules antes do patch para evitar ImportError.
        mock_processar = AsyncMock()
        fake_emp_module = types.ModuleType("empregabilidade_engine")
        fake_emp_module.processar_mensagem_empregabilidade = mock_processar

        stub_emp = _STUB_INSTANCIA
        payload = _payload_texto(phone_number_id="EMP_PHONE_ID", texto="quero vagas")
        raw = json.dumps(payload).encode()

        mock_supabase = MagicMock()
        mock_supabase.table.return_value.upsert.return_value.execute.return_value.data = [{"id": "l2"}]
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {"bloqueado": False}
        mock_supabase.table.return_value.select.return_value.match.return_value.execute.return_value.data = [{"id": "c2", "status": "ativa"}]
        mock_supabase.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
        mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()
        mock_supabase.rpc.return_value.execute.return_value = MagicMock()

        with patch.dict(sys.modules, {"empregabilidade_engine": fake_emp_module}), \
             patch("meta_adapter_inbound._get_instancia_by_phone_number_id", return_value=stub_emp), \
             patch("meta_adapter_inbound._get_supabase", return_value=mock_supabase), \
             patch("meta_adapter_inbound._chamar_motor_agente", new_callable=AsyncMock) as mock_motor:
            await processar_webhook_meta(raw)

        mock_motor.assert_not_called()
        mock_processar.assert_called_once()


# ─── S-WM-09: _notificar_transbordo ──────────────────────────────────────────
class TestNotificarTransbordo:
    """_notificar_transbordo — ACs 2, 4, 5 (S-WM-09)."""

    @pytest.mark.asyncio
    async def test_sem_template_aprovado_nao_envia(self):
        """S-WM-13 AC 3: nenhum template aprovado em meta_templates → log + sem chamada à Graph API."""
        from unittest.mock import MagicMock, patch, AsyncMock
        from meta_adapter_inbound import _notificar_transbordo

        contato = {"telefone_destino": "5585999990001", "nome_responsavel": "Fulano"}
        mock_sb = MagicMock()

        contacts_mock = MagicMock()
        contacts_mock.select.return_value.eq.return_value.eq.return_value.eq.return_value \
            .execute.return_value.data = [contato]

        templates_mock = MagicMock()
        # S-WM-16 Task 2: lookup relacional único (automação + número + tag "Transbordo"),
        # sem fallback por nome hardcoded.
        templates_mock.select.return_value.contains.return_value.contains.return_value \
            .eq.return_value.eq.return_value.limit.return_value.maybe_single.return_value \
            .execute.return_value.data = None

        def _table_side_effect(name):
            return contacts_mock if name == "human_handover_contacts" else templates_mock
        mock_sb.table.side_effect = _table_side_effect

        mock_enviar = AsyncMock()
        import sys
        import types
        fake_camp = types.ModuleType("campanhas_engine")
        fake_camp._enviar_template_meta = mock_enviar
        with patch("meta_adapter_inbound._get_supabase", return_value=mock_sb), \
             patch.dict(sys.modules, {"campanhas_engine": fake_camp}):
            await _notificar_transbordo("conv-1", "empregabilidade", "Barra", "PHONE_ID", "5585999991111")

        mock_enviar.assert_not_called()

    @pytest.mark.asyncio
    async def test_prioridade_unidade_especifica_nao_consulta_global(self):
        """AC 4: contato específico encontrado → consulta global (is_ null) não executada."""
        from unittest.mock import MagicMock, patch
        from meta_adapter_inbound import _notificar_transbordo

        contato = {"telefone_destino": "5585999990001", "nome_responsavel": "Fulano"}
        mock_sb = MagicMock()
        mock_sb.table.return_value.select.return_value \
            .eq.return_value.eq.return_value.eq.return_value.execute.return_value.data = [contato]

        templates_mock = MagicMock()
        templates_mock.select.return_value.contains.return_value.eq.return_value.eq.return_value \
            .limit.return_value.maybe_single.return_value.execute.return_value.data = None
        templates_mock.select.return_value.ilike.return_value.eq.return_value.eq.return_value \
            .limit.return_value.maybe_single.return_value.execute.return_value.data = None

        def _table_side_effect_2(name):
            return mock_sb._contacts_mock if name == "human_handover_contacts" else templates_mock
        mock_sb._contacts_mock = mock_sb.table.return_value
        mock_sb.table.side_effect = _table_side_effect_2

        with patch("meta_adapter_inbound._get_supabase", return_value=mock_sb):
            await _notificar_transbordo("conv-2", "empregabilidade", "Barra", "PHONE_ID", "55phone")

        # Fallback global usa .is_() — deve ter sido chamado zero vezes
        first_eq_rv = mock_sb._contacts_mock.select.return_value.eq.return_value
        first_eq_rv.is_.assert_not_called()

    @pytest.mark.asyncio
    async def test_sem_contatos_nao_falha_nem_envia(self):
        """AC 5: nenhum contato ativo → warning logado, sem exception, sem envio."""
        from unittest.mock import MagicMock, patch
        from meta_adapter_inbound import _notificar_transbordo

        mock_sb = MagicMock()
        # Query global (unidade_cuca=None) retorna vazio
        mock_sb.table.return_value.select.return_value \
            .eq.return_value.is_.return_value.eq.return_value.execute.return_value.data = []

        with patch("meta_adapter_inbound._get_supabase", return_value=mock_sb):
            await _notificar_transbordo("conv-3", "ouvidoria", None, "PHONE_ID", "55phone")


# ─────────────────────────────────────────────────────────────────────────────
# S-WM-20 Task 1: dedupe de mensagens inbound por wamid
# ─────────────────────────────────────────────────────────────────────────────

class TestDedupeWamid:

    @staticmethod
    def _mock_supabase_fluxo_completo(wamid_ja_existe: bool):
        """Mock com toda a cadeia de processar_webhook_meta configurada."""
        from unittest.mock import MagicMock
        mock_sb = MagicMock()
        mock_sb.table.return_value.upsert.return_value.execute.return_value.data = [{"id": "lead-dedupe"}]
        mock_sb.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
            "bloqueado": False
        }
        mock_sb.table.return_value.select.return_value.match.return_value.execute.return_value.data = [
            {"id": "conv-dedupe", "status": "ativa"}
        ]
        mock_sb.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = (
            [{"id": "msg-existente"}] if wamid_ja_existe else []
        )
        mock_sb.table.return_value.insert.return_value.execute.return_value = MagicMock()
        mock_sb.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock()
        mock_sb.rpc.return_value.execute.return_value = MagicMock()
        return mock_sb

    @pytest.mark.asyncio
    async def test_reentrega_mesmo_wamid_e_descartada_sem_dispatch(self):
        """AC 9: wamid já processado → early return, sem upsert de lead nem dispatch."""
        import sys, types
        from unittest.mock import patch, AsyncMock

        mock_processar = AsyncMock()
        fake_emp_module = types.ModuleType("empregabilidade_engine")
        fake_emp_module.processar_mensagem_empregabilidade = mock_processar

        mock_sb = self._mock_supabase_fluxo_completo(wamid_ja_existe=True)
        payload = _payload_texto(phone_number_id="DEDUPE_ID", texto="oi")
        raw = json.dumps(payload).encode()

        with patch.dict(sys.modules, {"empregabilidade_engine": fake_emp_module}), \
             patch("meta_adapter_inbound._get_instancia_by_phone_number_id",
                   return_value={"canal_origem": "c", "agente_tipo": "Empregabilidade",
                                 "canal_tipo": "Empregabilidade", "unidade_cuca": None}), \
             patch("meta_adapter_inbound._get_supabase", return_value=mock_sb):
            await processar_webhook_meta(raw)

        mock_processar.assert_not_called()
        mock_sb.table.assert_any_call("mensagens")
        # Dedupe descarta antes do upsert de lead — "leads" nunca é chamado.
        for call in mock_sb.table.call_args_list:
            assert call.args[0] != "leads", "Reentrega não deveria chegar a tocar em 'leads'"

    @pytest.mark.asyncio
    async def test_wamid_novo_processa_normalmente_e_persiste(self):
        """AC 9: wamid inédito → fluxo normal, dispatch chamado, wamid persistido no insert."""
        import sys, types
        from unittest.mock import patch, AsyncMock

        mock_processar = AsyncMock()
        fake_emp_module = types.ModuleType("empregabilidade_engine")
        fake_emp_module.processar_mensagem_empregabilidade = mock_processar

        mock_sb = self._mock_supabase_fluxo_completo(wamid_ja_existe=False)
        payload = _payload_texto(phone_number_id="DEDUPE_ID_2", texto="oi de novo")
        raw = json.dumps(payload).encode()

        with patch.dict(sys.modules, {"empregabilidade_engine": fake_emp_module}), \
             patch("meta_adapter_inbound._get_instancia_by_phone_number_id",
                   return_value={"canal_origem": "c", "agente_tipo": "Empregabilidade",
                                 "canal_tipo": "Empregabilidade", "unidade_cuca": None}), \
             patch("meta_adapter_inbound._get_supabase", return_value=mock_sb):
            await processar_webhook_meta(raw)

        mock_processar.assert_called_once()
        insert_call = mock_sb.table.return_value.insert.call_args
        assert insert_call.args[0]["wamid"] == "wamid.test"
