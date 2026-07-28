"""
Testes unitários — Adapter Inbound Meta (S-WM-01)
"""
import asyncio
import json
import hmac
import hashlib
import os
import sys
import pytest
from unittest.mock import patch

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

    @pytest.mark.asyncio
    async def test_parse_mensagem_imagem_descarta_legenda(self):
        """Achado (não corrigido): imagem sempre vira mensagem="", mesmo com legenda —
        Meta envia legenda em image.caption, mas _parse_mensagem_meta nunca lê esse campo."""
        msg = {
            "type": "image",
            "from": "558599999999",
            "image": {"mime_type": "image/jpeg", "sha256": "x", "id": "IMG_ID", "caption": "Isso está certo?"},
        }
        mensagem, _, _ = await _parse_mensagem_meta(msg)
        assert mensagem == ""


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
        """AC 1: motor-agente respondeu → retorna lista com o texto de resposta (S-WM-22: sem
        campo `mensagens` no JSON, cai no fallback [resposta] — 1 elemento só)."""
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

        assert resultado == ["Olá! Como posso ajudar?"]

    # ── S-WM-22: _chamar_motor_agente lê o campo `mensagens` (múltiplas partes) quando presente ──
    @pytest.mark.asyncio
    async def test_chamar_motor_agente_le_campo_mensagens_multiplas_partes(self):
        """S-WM-22 (TOM-03b): quando o motor-agente divide a resposta, `mensagens` (lista) tem
        prioridade sobre `resposta` (string) — retorna a lista completa, na ordem."""
        import sys
        from unittest.mock import MagicMock, patch
        from meta_adapter_inbound import _chamar_motor_agente

        resp_dividida = {
            **self._MOTOR_AGENTE_RESP_OK,
            "resposta": "Abertura\n\nLista\n\nFechamento",
            "mensagens": ["Abertura", "Lista", "Fechamento"],
        }
        mock_resp = MagicMock()
        mock_resp.is_success = True
        mock_resp.json.return_value = resp_dividida
        mock_httpx, _ = self._make_mock_httpx(post_return=mock_resp)

        contrato = {"mensagem": "quais cursos vocês têm?", "telefone": "55", "canal_origem": "id", "agente_tipo": "Institucional"}

        with patch.dict(os.environ, {"SUPABASE_URL": "http://fake", "SUPABASE_SERVICE_ROLE_KEY": "k"}), \
             patch.dict(sys.modules, {"httpx": mock_httpx}):
            resultado = await _chamar_motor_agente(contrato, "conversa-uuid-456", MagicMock())

        assert resultado == ["Abertura", "Lista", "Fechamento"]

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

    # ── S-WM-53 (Plano 002, achado #1): log de falha 400 inclui telefone/conversa_id ──
    @pytest.mark.asyncio
    async def test_log_de_falha_400_inclui_telefone_e_conversa_id(self, caplog):
        """Achado 2026-07-25: 46% das chamadas ao motor-agente falharam com HTTP 400
        ("telefone e agente_tipo sao obrigatorios") durante um disparo em massa, e não
        havia como saber qual telefone foi enviado — este teste trava que o campo
        aparece no log de erro a partir de agora."""
        import logging
        import sys
        from unittest.mock import MagicMock, patch
        from meta_adapter_inbound import _chamar_motor_agente

        mock_resp = MagicMock()
        mock_resp.is_success = False
        mock_resp.status_code = 400
        mock_resp.text = '{"error": "telefone e agente_tipo sao obrigatorios"}'
        mock_httpx, _ = self._make_mock_httpx(post_return=mock_resp)

        contrato_v2 = {
            "mensagem": "oi", "telefone": "", "canal_origem": "123",
            "agente_tipo": "Institucional", "midia_url": None, "midia_tipo": "text",
        }

        with patch.dict(os.environ, {"SUPABASE_URL": "http://fake", "SUPABASE_SERVICE_ROLE_KEY": "k"}), \
             patch.dict(sys.modules, {"httpx": mock_httpx}):
            with caplog.at_level(logging.ERROR):
                resultado = await _chamar_motor_agente(contrato_v2, "conversa-teste-123", MagicMock())

        assert resultado is None
        assert "conversa-teste-123" in caplog.text
        assert "telefone=" in caplog.text

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

        assert resultado == ["Transferindo..."]
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
                       return_value=["Resposta motor"]) as mock_motor, \
                 patch("meta_adapter_outbound._meta_marcar_lida_e_digitando", new_callable=AsyncMock,
                       return_value=True), \
                 patch("meta_adapter_outbound._meta_enviar", new_callable=AsyncMock,
                       return_value=True) as mock_enviar:
                await processar_webhook_meta(raw)

            mock_motor.assert_called_once(), f"motor-agente não chamado para agente={agente}"
            mock_enviar.assert_called_once(), f"_meta_enviar não chamado para agente={agente}"

    # ── S-WM-53 (Plano 002, achado #1): log DIAG-achado1 indica lead/conversa novos ───
    @pytest.mark.asyncio
    async def test_log_diagnostico_indica_lead_novo(self, caplog):
        """Achado 2026-07-25/26: 27 de 32 falhas do achado #1 aconteceram ~11-12s após
        o lead ser criado — este log deixa explícito se o lead/conversa eram novos,
        pra correlacionar com o log de falha do Step 1 na próxima ocorrência real."""
        import logging
        from unittest.mock import patch, AsyncMock, MagicMock
        from meta_adapter_inbound import processar_webhook_meta

        stub = self._make_stub("Institucional")
        payload = _payload_texto(phone_number_id="INST_PHONE_ID", texto="oi")
        raw = json.dumps(payload).encode()

        mock_supabase = MagicMock()
        # lead novo: created_at == updated_at (mesmo INSERT)
        mock_supabase.table.return_value.upsert.return_value.execute.return_value.data = [
            {"id": "lead-novo-1", "created_at": "2026-07-27T10:00:00Z", "updated_at": "2026-07-27T10:00:00Z"}
        ]
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
            "bloqueado": False
        }
        # conversa nova: created_at == updated_at também
        mock_supabase.table.return_value.select.return_value.match.return_value.execute.return_value.data = [
            {"id": "conv-novo-1", "status": "ativa", "created_at": "2026-07-27T10:00:01Z", "updated_at": "2026-07-27T10:00:01Z"}
        ]
        mock_supabase.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
        mock_supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock()
        mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()
        mock_supabase.rpc.return_value.execute.return_value = MagicMock()

        with patch("meta_adapter_inbound._get_instancia_by_phone_number_id", return_value=stub), \
             patch("meta_adapter_inbound._get_supabase", return_value=mock_supabase), \
             patch("meta_adapter_inbound._chamar_motor_agente", new_callable=AsyncMock,
                   return_value=["Resposta motor"]), \
             patch("meta_adapter_outbound._meta_marcar_lida_e_digitando", new_callable=AsyncMock,
                   return_value=True), \
             patch("meta_adapter_outbound._meta_enviar", new_callable=AsyncMock, return_value=True):
            with caplog.at_level(logging.INFO):
                await processar_webhook_meta(raw)

        assert "DIAG-achado1" in caplog.text
        assert "lead_novo=True" in caplog.text
        assert "conversa_nova=True" in caplog.text

    # ── S-WM-54 (Plano 003, achado #2): falha ao salvar Mensagem continua o dispatch, log CRITICAL ──
    @pytest.mark.asyncio
    async def test_falha_ao_salvar_mensagem_continua_processamento_com_log_critico(self, caplog):
        """Achado #2 (2026-07-25): insert de mensagens falhando não pode ser 100% silencioso —
        trava que, quando falha, sobe pra CRITICAL com conversa_id/lead_id pra dar pra rastrear
        manualmente, mesmo sem interromper o dispatch."""
        import logging
        from unittest.mock import patch, AsyncMock, MagicMock
        from meta_adapter_inbound import processar_webhook_meta

        stub = self._make_stub("Institucional")
        payload = _payload_texto(phone_number_id="INST_PHONE_ID", texto="oi")
        raw = json.dumps(payload).encode()

        mock_supabase = MagicMock()
        mock_supabase.table.return_value.upsert.return_value.execute.return_value.data = [
            {"id": "lead-id-critico", "created_at": "T", "updated_at": "T"}
        ]
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
            "bloqueado": False
        }
        mock_supabase.table.return_value.select.return_value.match.return_value.execute.return_value.data = [
            {"id": "conv-id-critico", "status": "ativa", "created_at": "T", "updated_at": "T"}
        ]
        mock_supabase.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
        # DB C: insert de mensagens falha — só esse .insert().execute(), não afeta upsert (leads/conversas)
        mock_supabase.table.return_value.insert.return_value.execute.side_effect = Exception("insert falhou (simulado)")
        mock_supabase.rpc.return_value.execute.return_value = MagicMock()

        with patch("meta_adapter_inbound._get_instancia_by_phone_number_id", return_value=stub), \
             patch("meta_adapter_inbound._get_supabase", return_value=mock_supabase), \
             patch("meta_adapter_inbound._chamar_motor_agente", new_callable=AsyncMock,
                   return_value=["Resposta motor"]) as mock_motor, \
             patch("meta_adapter_outbound._meta_marcar_lida_e_digitando", new_callable=AsyncMock,
                   return_value=True), \
             patch("meta_adapter_outbound._meta_enviar", new_callable=AsyncMock, return_value=True):
            with caplog.at_level(logging.CRITICAL):
                await processar_webhook_meta(raw)

        # processamento continua — dispatch pro motor-agente ainda é chamado, sem return antecipado
        mock_motor.assert_called_once()
        assert any(r.levelname == "CRITICAL" for r in caplog.records)
        assert "DATA-LOSS" in caplog.text
        assert "conv-id-critico" in caplog.text
        assert "lead-id-critico" in caplog.text

    # ── S-WM-31 Task 2: concorrência na criação de conversa (upsert vs. select-então-insert) ──
    @pytest.mark.asyncio
    async def test_concorrencia_duas_chamadas_simultaneas_resolvem_mesma_conversa(self):
        """AC1: duas requisições quase simultâneas de webhook pro mesmo lead (mesmo telefone,
        mesmo phone_number_id) devem resolver pra 1 única conversa. A atomicidade real vem da
        constraint UNIQUE(lead_id, origem_id) aplicada no banco (Task 1, não testável por mock
        puro) — aqui confirmamos que o get-or-create usa upsert(on_conflict="lead_id,origem_id"),
        não mais select-então-insert (a corrida original), e que as duas chamadas concorrentes
        (asyncio.gather, não sequencial) convergem pro MESMO conversa_id. `_agendar_dispatch_
        debounced` é substituído por um stub aqui pra isolar da lógica de debounce/cancelamento
        (VAL-05, já coberta em TestDebounceDispatch) e capturar o conversa_id resolvido por
        chamada."""
        from unittest.mock import patch, MagicMock
        from meta_adapter_inbound import processar_webhook_meta

        stub = self._make_stub("Institucional")
        payload = _payload_texto(phone_number_id="INST_PHONE_ID", texto="oi")
        raw = json.dumps(payload).encode()

        mock_supabase = MagicMock()
        mock_supabase.table.return_value.upsert.return_value.execute.return_value.data = [{"id": "lead-race"}]
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
            "bloqueado": False
        }
        mock_supabase.table.return_value.select.return_value.match.return_value.execute.return_value.data = [
            {"id": "conv-race-shared", "status": "ativa"}
        ]
        mock_supabase.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []

        conversa_ids_recebidos = []

        async def _stub_debounce(chave, dispatch):
            conversa_ids_recebidos.append(chave)

        with patch("meta_adapter_inbound._get_instancia_by_phone_number_id", return_value=stub), \
             patch("meta_adapter_inbound._get_supabase", return_value=mock_supabase), \
             patch("meta_adapter_inbound._agendar_dispatch_debounced", side_effect=_stub_debounce):
            await asyncio.gather(
                processar_webhook_meta(raw),
                processar_webhook_meta(raw),
            )

        assert conversa_ids_recebidos == ["conv-race-shared", "conv-race-shared"], (
            "as duas chamadas quase simultâneas devem resolver pro MESMO conversa_id"
        )

        chamadas_upsert_conversas = [
            call for call in mock_supabase.table.return_value.upsert.call_args_list
            if call.kwargs.get("on_conflict") == "lead_id,origem_id"
        ]
        assert len(chamadas_upsert_conversas) == 2, (
            "esperava 1 upsert(on_conflict='lead_id,origem_id') por chamada — get-or-create "
            "atômico via constraint UNIQUE, não select-então-insert"
        )

    # ── S-WM-22 (TOM-03b): dispatch de múltiplas partes, na ordem, sequencial ─────────────────
    @pytest.mark.asyncio
    async def test_dispatch_multiplas_partes_envia_todas_na_ordem(self):
        """AC3: resposta dividida em N partes → _meta_enviar chamado N vezes, com o texto de
        cada parte, na ordem certa (não paralelo, não fora de ordem)."""
        from unittest.mock import patch, AsyncMock, MagicMock
        from meta_adapter_inbound import processar_webhook_meta

        stub = self._make_stub("Institucional")
        payload = _payload_texto(phone_number_id="INST_PHONE_ID", texto="quais cursos vocês têm?")
        raw = json.dumps(payload).encode()

        mock_supabase = MagicMock()
        mock_supabase.table.return_value.upsert.return_value.execute.return_value.data = [{"id": "lead-id-1"}]
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {"bloqueado": False}
        mock_supabase.table.return_value.select.return_value.match.return_value.execute.return_value.data = [{"id": "conv-id-1", "status": "ativa"}]
        mock_supabase.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
        mock_supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock()
        mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()
        mock_supabase.rpc.return_value.execute.return_value = MagicMock()

        partes = ["Claro! Segue a programação:", "Natacao - Ter/Qui\nJudo - Seg/Qua\nMusica - Sab", "Quer saber mais?"]

        with patch("meta_adapter_inbound._get_instancia_by_phone_number_id", return_value=stub), \
             patch("meta_adapter_inbound._get_supabase", return_value=mock_supabase), \
             patch("meta_adapter_inbound._chamar_motor_agente", new_callable=AsyncMock, return_value=partes), \
             patch("meta_adapter_outbound._meta_marcar_lida_e_digitando", new_callable=AsyncMock, return_value=True), \
             patch("meta_adapter_outbound._meta_enviar", new_callable=AsyncMock, return_value=True) as mock_enviar:
            await processar_webhook_meta(raw)

        assert mock_enviar.call_count == 3, "esperava _meta_enviar chamado 1 vez por parte (3 partes)"
        textos_enviados = [call.args[2] for call in mock_enviar.call_args_list]
        assert textos_enviados == partes, "as partes precisam ser enviadas na MESMA ordem que o motor-agente devolveu"

    @pytest.mark.asyncio
    async def test_dispatch_falha_na_parte_do_meio_aborta_sem_duplicar_nem_pular(self):
        """AC3 (comportamento de falha parcial, Escopo IN item 6): se a parte 2 de 3 falhar no
        envio, a 3ª NÃO pode ser enviada (evita resposta fora de ordem/sem sentido) e a 1ª não
        pode ser reenviada (evita duplicar) — aborta limpo, loga quantas foram enviadas antes."""
        from unittest.mock import patch, AsyncMock, MagicMock
        from meta_adapter_inbound import processar_webhook_meta

        stub = self._make_stub("Institucional")
        payload = _payload_texto(phone_number_id="INST_PHONE_ID", texto="quais cursos vocês têm?")
        raw = json.dumps(payload).encode()

        mock_supabase = MagicMock()
        mock_supabase.table.return_value.upsert.return_value.execute.return_value.data = [{"id": "lead-id-1"}]
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {"bloqueado": False}
        mock_supabase.table.return_value.select.return_value.match.return_value.execute.return_value.data = [{"id": "conv-id-1", "status": "ativa"}]
        mock_supabase.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
        mock_supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock()
        mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()
        mock_supabase.rpc.return_value.execute.return_value = MagicMock()

        partes = ["Abertura", "Lista", "Fechamento"]

        with patch("meta_adapter_inbound._get_instancia_by_phone_number_id", return_value=stub), \
             patch("meta_adapter_inbound._get_supabase", return_value=mock_supabase), \
             patch("meta_adapter_inbound._chamar_motor_agente", new_callable=AsyncMock, return_value=partes), \
             patch("meta_adapter_outbound._meta_marcar_lida_e_digitando", new_callable=AsyncMock, return_value=True), \
             patch("meta_adapter_outbound._meta_enviar", new_callable=AsyncMock, side_effect=[True, False, True]) as mock_enviar:
            await processar_webhook_meta(raw)

        assert mock_enviar.call_count == 2, (
            "esperava só 2 chamadas: a 1ª (sucesso) e a 2ª (falha) — a 3ª parte NÃO pode ser "
            "enviada depois de uma falha no meio, e a 1ª não pode ser reenviada (sem retry)"
        )
        textos_enviados = [call.args[2] for call in mock_enviar.call_args_list]
        assert textos_enviados == ["Abertura", "Lista"], "só 'Abertura' e 'Lista' deveriam ter sido tentadas, nessa ordem"

    # ── §1 auditoria: motor-agente retorna None → fallback ao lead, nunca silêncio ──
    @pytest.mark.asyncio
    async def test_processar_webhook_motor_agente_none_envia_fallback(self):
        """§1: _chamar_motor_agente retornando None não pode resultar em silêncio total."""
        from unittest.mock import patch, AsyncMock, MagicMock
        from meta_adapter_inbound import processar_webhook_meta

        stub = self._make_stub("Institucional")
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
                   return_value=None) as mock_motor, \
             patch("meta_adapter_outbound._meta_marcar_lida_e_digitando", new_callable=AsyncMock,
                   return_value=True), \
             patch("meta_adapter_outbound._meta_enviar", new_callable=AsyncMock,
                   return_value=True) as mock_enviar:
            await processar_webhook_meta(raw)

        mock_motor.assert_called_once()
        mock_enviar.assert_called_once()
        texto_enviado = mock_enviar.call_args.args[2]
        assert "problema técnico" in texto_enviado

    @pytest.mark.asyncio
    async def test_processar_webhook_fallback_deveria_ser_gravado_em_mensagens(self):
        """AUD-03 (auditoria externa 2026-07-07): a mensagem de fallback ("problema
        técnico") enviada ao lead quando _chamar_motor_agente falha deveria ficar
        registrada em `mensagens` (remetente="agente"), igual à resposta normal do
        motor-agente — hoje ela é enviada via _meta_enviar mas nunca é inserida na
        tabela, criando um buraco no histórico visto pelo colaborador no portal."""
        from unittest.mock import patch, AsyncMock, MagicMock
        from meta_adapter_inbound import processar_webhook_meta

        stub = self._make_stub("Institucional")
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
                   return_value=None), \
             patch("meta_adapter_outbound._meta_marcar_lida_e_digitando", new_callable=AsyncMock,
                   return_value=True), \
             patch("meta_adapter_outbound._meta_enviar", new_callable=AsyncMock,
                   return_value=True):
            await processar_webhook_meta(raw)

        inserts_de_agente = [
            call.args[0] for call in mock_supabase.table.return_value.insert.call_args_list
            if isinstance(call.args[0], dict) and call.args[0].get("remetente") == "agente"
        ]
        assert len(inserts_de_agente) == 1, (
            "AUD-03: a mensagem de fallback 'problema técnico' deveria ser gravada em "
            "`mensagens` (remetente='agente'), mas hoje só é enviada via _meta_enviar "
            "sem nunca ser inserida na tabela"
        )

    # ── Achado (não corrigido): lead manda imagem → cai no MESMO fallback de "problema
    # técnico" do §1, mas a causa real é "motor-agente não lê imagem", não uma falha técnica ──
    @pytest.mark.asyncio
    async def test_processar_webhook_imagem_cai_no_fallback_tecnico(self):
        """Reproduz ponta a ponta (sem mockar _chamar_motor_agente): imagem → mensagem="" →
        motor-agente responderia HTTP 400 "Nenhuma mensagem" → _chamar_motor_agente retorna
        None → dispatch envia a mensagem de fallback do §1, que é enganosa para este caso."""
        from unittest.mock import patch, AsyncMock, MagicMock
        from meta_adapter_inbound import processar_webhook_meta

        stub = self._make_stub("Institucional")
        payload = _payload_imagem(phone_number_id="INST_PHONE_ID")
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

        mock_resp_400 = MagicMock()
        mock_resp_400.is_success = False
        mock_resp_400.status_code = 400
        mock_resp_400.text = '{"error": "Nenhuma mensagem"}'
        mock_httpx, _ = self._make_mock_httpx(post_return=mock_resp_400)

        with patch("meta_adapter_inbound._get_instancia_by_phone_number_id", return_value=stub), \
             patch("meta_adapter_inbound._get_supabase", return_value=mock_supabase), \
             patch.dict(os.environ, {"SUPABASE_URL": "http://fake", "SUPABASE_SERVICE_ROLE_KEY": "fake_key"}), \
             patch.dict(sys.modules, {"httpx": mock_httpx}), \
             patch("meta_adapter_outbound._meta_enviar", new_callable=AsyncMock,
                   return_value=True) as mock_enviar:
            await processar_webhook_meta(raw)

        mock_enviar.assert_called_once()
        texto_enviado = mock_enviar.call_args.args[2]
        # Achado: a mensagem enviada é a de "problema técnico" — não menciona imagem/foto,
        # o que é enganoso (não houve falha técnica, imagem simplesmente não é suportada).
        assert "problema técnico" in texto_enviado

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
                       return_value=["Aguarde..."]) as mock_motor, \
                 patch("meta_adapter_inbound._notificar_transbordo", new_callable=AsyncMock) as mock_notif, \
                 patch("meta_adapter_outbound._meta_marcar_lida_e_digitando", new_callable=AsyncMock,
                       return_value=True), \
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


# ─── AUD-12 (LGPD, S-WM-23): opt-out real ────────────────────────────────────
class TestOptOutAud12:
    """AUD-12: detecção de opt-out (_eh_pedido_opt_out) + wiring no dispatch (registrar_opt_out
    chamado, dispatch normal pulado, confirmação enviada direto ao lead)."""

    _CASOS_POSITIVOS = [
        "sair", "Sair", "SAIR", "parar", "cancelar",
        "pode parar de mandar mensagem", "quero cancelar", "cancelar inscrição",
        "nao quero mais receber", "não quero mais receber mensagens",
        "remover meu numero", "quero sair da lista", "quero sair das mensagens",
    ]
    _CASOS_NEGATIVOS = [
        "vou sair de férias semana que vem", "quero saber os horários", "obrigado",
        "quero sair pra jantar hoje", "quais cursos vocês têm", "bom dia",
        "quero sair mais cedo do trabalho", "", None,
    ]

    # ── _eh_pedido_opt_out: função pura ────────────────────────────────────
    def test_detecta_pedidos_claros_de_opt_out(self):
        from meta_adapter_inbound import _eh_pedido_opt_out
        for texto in self._CASOS_POSITIVOS:
            assert _eh_pedido_opt_out(texto) is True, f"esperava True para {texto!r}"

    def test_nao_confunde_mensagens_comuns_com_opt_out(self):
        """Risco documentado na story: 'vou sair de férias'/'quero sair pra jantar' não podem
        virar opt-out por engano — os padrões são específicos de propósito, não uma palavra
        solta tipo \\bsair\\b."""
        from meta_adapter_inbound import _eh_pedido_opt_out
        for texto in self._CASOS_NEGATIVOS:
            assert _eh_pedido_opt_out(texto) is False, f"esperava False para {texto!r}"

    # ── Wiring completo via processar_webhook_meta ─────────────────────────
    def _mock_supabase_base(self, dados_conversa=None):
        from unittest.mock import MagicMock
        mock_supabase = MagicMock()
        mock_supabase.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
        mock_supabase.table.return_value.upsert.return_value.execute.return_value.data = [{"id": "lead-optout-1"}]
        mock_supabase.table.return_value.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {"bloqueado": False}
        mock_supabase.table.return_value.select.return_value.match.return_value.execute.return_value.data = (
            [dados_conversa] if dados_conversa else [{"id": "conv-optout-1", "status": "ativa"}]
        )
        mock_supabase.table.return_value.update.return_value.eq.return_value.execute.return_value = MagicMock()
        mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock()
        mock_supabase.rpc.return_value.execute.return_value = MagicMock()
        return mock_supabase

    @pytest.mark.asyncio
    async def test_mensagem_de_opt_out_chama_rpc_e_nao_despacha_pro_motor_agente(self):
        """AC1/AC3 da S-WM-23: pedido de opt-out chama registrar_opt_out com o telefone certo,
        NÃO chama _chamar_motor_agente (não roteia pro fluxo normal)."""
        from unittest.mock import AsyncMock, patch
        from meta_adapter_inbound import processar_webhook_meta

        stub = {"canal_origem": "TEST_ID", "agente_tipo": "Institucional", "canal_tipo": "Institucional", "unidade_cuca": None}
        payload = _payload_texto(phone_number_id="TEST_ID", telefone="558599990000", texto="quero cancelar")
        raw = json.dumps(payload).encode()
        mock_supabase = self._mock_supabase_base()

        with patch("meta_adapter_inbound._get_instancia_by_phone_number_id", return_value=stub), \
             patch("meta_adapter_inbound._get_supabase", return_value=mock_supabase), \
             patch("meta_adapter_inbound._chamar_motor_agente", new_callable=AsyncMock) as mock_motor, \
             patch("meta_adapter_outbound._meta_enviar", new_callable=AsyncMock, return_value=True) as mock_enviar:
            await processar_webhook_meta(raw)

        mock_motor.assert_not_called()
        chamadas_rpc_optout = [c for c in mock_supabase.rpc.call_args_list if c.args and c.args[0] == "registrar_opt_out"]
        assert len(chamadas_rpc_optout) == 1, "esperava exatamente 1 chamada a registrar_opt_out"
        assert chamadas_rpc_optout[0].args[1] == {"p_telefone": "558599990000"}
        mock_enviar.assert_called_once()
        texto_enviado = mock_enviar.call_args.args[2]
        assert "não vai mais receber" in texto_enviado.lower() or "nao vai mais receber" in texto_enviado.lower()

    @pytest.mark.asyncio
    async def test_mensagem_comum_nao_chama_registrar_opt_out_e_segue_dispatch_normal(self):
        """AC3 da S-WM-23 (sem falso positivo) + regressão: mensagem comum continua indo pro
        motor-agente normalmente, sem registrar opt-out."""
        from unittest.mock import AsyncMock, patch
        from meta_adapter_inbound import processar_webhook_meta

        stub = {"canal_origem": "TEST_ID", "agente_tipo": "Institucional", "canal_tipo": "Institucional", "unidade_cuca": None}
        payload = _payload_texto(phone_number_id="TEST_ID", telefone="558599990000", texto="quais cursos vocês têm?")
        raw = json.dumps(payload).encode()
        mock_supabase = self._mock_supabase_base()

        with patch("meta_adapter_inbound._get_instancia_by_phone_number_id", return_value=stub), \
             patch("meta_adapter_inbound._get_supabase", return_value=mock_supabase), \
             patch("meta_adapter_inbound._chamar_motor_agente", new_callable=AsyncMock, return_value=["Resposta motor"]) as mock_motor, \
             patch("meta_adapter_outbound._meta_marcar_lida_e_digitando", new_callable=AsyncMock, return_value=True), \
             patch("meta_adapter_outbound._meta_enviar", new_callable=AsyncMock, return_value=True) as mock_enviar:
            await processar_webhook_meta(raw)

        chamadas_rpc_optout = [c for c in mock_supabase.rpc.call_args_list if c.args and c.args[0] == "registrar_opt_out"]
        assert len(chamadas_rpc_optout) == 0, "mensagem comum não pode chamar registrar_opt_out"
        mock_motor.assert_called_once()
        mock_enviar.assert_called_once()

    @pytest.mark.asyncio
    async def test_falha_ao_registrar_opt_out_nao_quebra_o_fluxo(self):
        """Nunca propaga exceção — se a RPC falhar, ainda assim confirma pro lead (best-effort na
        gravação, mas a resposta não pode travar por causa disso)."""
        from unittest.mock import AsyncMock, patch
        from meta_adapter_inbound import processar_webhook_meta

        stub = {"canal_origem": "TEST_ID", "agente_tipo": "Institucional", "canal_tipo": "Institucional", "unidade_cuca": None}
        payload = _payload_texto(phone_number_id="TEST_ID", telefone="558599990000", texto="parar")
        raw = json.dumps(payload).encode()
        from unittest.mock import MagicMock
        mock_supabase = self._mock_supabase_base()

        def _rpc_side_effect(nome, *args, **kwargs):
            if nome == "registrar_opt_out":
                raise Exception("erro simulado de rede")
            m = MagicMock()
            m.execute.return_value = MagicMock()
            return m

        mock_supabase.rpc.side_effect = _rpc_side_effect

        with patch("meta_adapter_inbound._get_instancia_by_phone_number_id", return_value=stub), \
             patch("meta_adapter_inbound._get_supabase", return_value=mock_supabase), \
             patch("meta_adapter_inbound._chamar_motor_agente", new_callable=AsyncMock) as mock_motor, \
             patch("meta_adapter_outbound._meta_enviar", new_callable=AsyncMock, return_value=True) as mock_enviar:
            await processar_webhook_meta(raw)

        mock_motor.assert_not_called()
        mock_enviar.assert_called_once()


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


# ─── VAL-05: debounce de dispatch ──────────────────────────────────────────────
# docs/migracao-meta/VALIDACAO-producao-institucional.md: mensagens rápidas em sequência do
# mesmo lead disparavam um dispatch (chamada ao motor-agente + resposta) POR MENSAGEM. Estes
# testes provam: (1) N mensagens rápidas da mesma conversa geram 1 só dispatch, com a última
# mensagem; (2) o cuidado 1 pedido — reconferir awaiting_human no momento do dispatch adiado,
# não só na chegada; (3) chaves (conversa_id) diferentes não interferem entre si.
class TestDebounceDispatch:

    @staticmethod
    def _payload_com_wamid(phone_number_id: str, telefone: str, texto: str, wamid: str) -> dict:
        return {
            "object": "whatsapp_business_account",
            "entry": [{
                "id": "WABA_ID",
                "changes": [{
                    "value": {
                        "messaging_product": "whatsapp",
                        "metadata": {"display_phone_number": "558500000000", "phone_number_id": phone_number_id},
                        "contacts": [{"profile": {"name": "Teste"}, "wa_id": telefone}],
                        "messages": [{
                            "from": telefone,
                            "id": wamid,
                            "timestamp": "1750000000",
                            "type": "text",
                            "text": {"body": texto},
                        }],
                    },
                    "field": "messages",
                }],
            }],
        }

    @staticmethod
    def _mock_supabase_conversa_unica(conversa_id: str, status_conversas: str = "ativa"):
        """Cada `.table(nome)` retorna um mock PRÓPRIO (por nome), não o mesmo objeto
        compartilhado dos helpers acima — precisa disso aqui porque os testes de debounce
        precisam diferenciar a checagem de `conversas.status` (cuidado 1) da checagem de
        `leads.bloqueado`, que usam a mesma forma de chain (`.eq().single().execute().data`)
        mas em tabelas diferentes."""
        from unittest.mock import MagicMock

        mock_leads = MagicMock()
        mock_leads.upsert.return_value.execute.return_value.data = [{"id": "lead-debounce"}]
        mock_leads.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
            "bloqueado": False
        }

        mock_conversas = MagicMock()
        mock_conversas.select.return_value.match.return_value.execute.return_value.data = [
            {"id": conversa_id, "status": "ativa"}  # status na CHEGADA — sempre ativa nesta suíte
        ]
        mock_conversas.select.return_value.eq.return_value.single.return_value.execute.return_value.data = {
            "status": status_conversas  # status no momento do DISPATCH ADIADO — controlável por teste
        }
        mock_conversas.update.return_value.eq.return_value.execute.return_value = MagicMock()

        mock_mensagens = MagicMock()
        mock_mensagens.select.return_value.eq.return_value.limit.return_value.execute.return_value.data = []
        mock_mensagens.insert.return_value.execute.return_value = MagicMock()

        def _por_tabela(nome: str):
            return {"leads": mock_leads, "conversas": mock_conversas, "mensagens": mock_mensagens}.get(
                nome, MagicMock()
            )

        mock_sb = MagicMock()
        mock_sb.table.side_effect = _por_tabela
        mock_sb.rpc.return_value.execute.return_value = MagicMock()
        return mock_sb

    # ── 1) N mensagens rápidas → 1 só dispatch, com a última mensagem ──────────
    @pytest.mark.asyncio
    async def test_mensagens_rapidas_geram_um_so_dispatch_com_a_ultima_mensagem(self, monkeypatch):
        import meta_adapter_inbound
        from unittest.mock import AsyncMock

        class SleepControlavel:
            """Só resolve quando o teste manda — permite testar cancelamento/reagendamento
            sem depender de tempo real (`asyncio.sleep`)."""
            def __init__(self):
                self.entrou = asyncio.Event()
                self._liberar = asyncio.Event()

            async def __call__(self, segundos):
                self.entrou.set()
                await self._liberar.wait()

            def liberar(self):
                self._liberar.set()

        fake_sleep = SleepControlavel()
        monkeypatch.setattr(meta_adapter_inbound, "_dormir_debounce", fake_sleep)

        mock_sb = self._mock_supabase_conversa_unica("conv-debounce-1")
        stub = {"canal_origem": "PHONE_DEB", "agente_tipo": "Institucional", "canal_tipo": "Institucional", "unidade_cuca": None}

        raw1 = json.dumps(self._payload_com_wamid("PHONE_DEB", "558598887777", "entendi", "wamid.deb.1")).encode()
        raw2 = json.dumps(self._payload_com_wamid("PHONE_DEB", "558598887777", "beleza então", "wamid.deb.2")).encode()
        raw3 = json.dumps(self._payload_com_wamid("PHONE_DEB", "558598887777", "obrigado", "wamid.deb.3")).encode()

        with patch("meta_adapter_inbound._get_instancia_by_phone_number_id", return_value=stub), \
             patch("meta_adapter_inbound._get_supabase", return_value=mock_sb), \
             patch("meta_adapter_inbound._chamar_motor_agente", new_callable=AsyncMock,
                   return_value=["Até mais! 😊"]) as mock_motor, \
             patch("meta_adapter_outbound._meta_marcar_lida_e_digitando", new_callable=AsyncMock, return_value=True), \
             patch("meta_adapter_outbound._meta_enviar", new_callable=AsyncMock, return_value=True) as mock_enviar:

            tarefa1 = asyncio.create_task(processar_webhook_meta(raw1))
            await fake_sleep.entrou.wait()
            fake_sleep.entrou.clear()

            tarefa2 = asyncio.create_task(processar_webhook_meta(raw2))
            await fake_sleep.entrou.wait()
            fake_sleep.entrou.clear()

            tarefa3 = asyncio.create_task(processar_webhook_meta(raw3))
            await fake_sleep.entrou.wait()

            fake_sleep.liberar()
            await asyncio.gather(tarefa1, tarefa2, tarefa3)

        mock_motor.assert_called_once()
        mock_enviar.assert_called_once()
        contrato_usado = mock_motor.call_args.args[0]
        assert contrato_usado["mensagem"] == "obrigado", (
            "VAL-05: das 3 mensagens rápidas, só a ÚLTIMA ('obrigado') deveria efetivamente "
            "disparar o dispatch — as 2 primeiras deveriam ser canceladas/reagendadas, não "
            "gerar 3 chamadas separadas ao motor-agente"
        )

    # ── 2) cuidado 1: reconfere awaiting_human no momento do dispatch adiado ───
    @pytest.mark.asyncio
    async def test_awaiting_human_mudou_durante_debounce_cancela_dispatch(self):
        """Status='ativa' na CHEGADA da mensagem (passa pelo guard early-return), mas já
        virou 'awaiting_human' no momento em que o dispatch adiado dispara de fato (ex.: um
        colaborador assumiu a conversa manualmente enquanto o debounce esperava) — o dispatch
        não pode rodar mesmo assim."""
        from unittest.mock import AsyncMock

        mock_sb = self._mock_supabase_conversa_unica("conv-debounce-2", status_conversas="awaiting_human")
        stub = {"canal_origem": "PHONE_DEB2", "agente_tipo": "Institucional", "canal_tipo": "Institucional", "unidade_cuca": None}
        raw = json.dumps(self._payload_com_wamid("PHONE_DEB2", "558598887778", "oi", "wamid.deb.4")).encode()

        with patch("meta_adapter_inbound._get_instancia_by_phone_number_id", return_value=stub), \
             patch("meta_adapter_inbound._get_supabase", return_value=mock_sb), \
             patch("meta_adapter_inbound._chamar_motor_agente", new_callable=AsyncMock) as mock_motor, \
             patch("meta_adapter_outbound._meta_marcar_lida_e_digitando", new_callable=AsyncMock, return_value=True), \
             patch("meta_adapter_outbound._meta_enviar", new_callable=AsyncMock) as mock_enviar:
            await processar_webhook_meta(raw)

        mock_motor.assert_not_called(), (
            "cuidado 1 (VAL-05): status virou 'awaiting_human' antes do dispatch adiado disparar — "
            "motor-agente não deveria ser chamado mesmo a mensagem tendo chegado com status 'ativa'"
        )
        mock_enviar.assert_not_called()

    # ── 3) chaves diferentes (conversas diferentes) não interferem ─────────────
    @pytest.mark.asyncio
    async def test_agendar_dispatch_debounced_chaves_diferentes_nao_cancelam_uma_a_outra(self):
        import meta_adapter_inbound

        chamadas: list[str] = []

        async def _dispatch_a():
            chamadas.append("a")

        async def _dispatch_b():
            chamadas.append("b")

        await asyncio.gather(
            meta_adapter_inbound._agendar_dispatch_debounced("conversa-A", _dispatch_a),
            meta_adapter_inbound._agendar_dispatch_debounced("conversa-B", _dispatch_b),
        )

        assert sorted(chamadas) == ["a", "b"], (
            "duas conversas diferentes (chaves distintas) não podem cancelar o dispatch uma da outra"
        )
        assert meta_adapter_inbound._DEBOUNCE_TASKS == {}, "dict de tarefas pendentes deveria ficar vazio após ambas resolverem"

    # ── 4) S-WM-33: valor default da janela ─────────────────────────────────────
    def test_debounce_segundos_default_e_10s(self, monkeypatch):
        """S-WM-33: default alterado de 3s pra 7s, e depois pra 10s (decisão atualizada do
        Junior) — decisão original após o diagnóstico (teste ao vivo de 2026-07-14) confirmar
        que o debounce de 3s funcionava corretamente por desenho (não era bug), só que a
        janela era curta demais pro intervalo real observado (6,13s entre duas mensagens do
        mesmo lead). 10s cobre esse caso com margem ainda maior que os 7s originalmente
        decididos. Nota: existe só ESTA função/local no código controlando o valor — não há
        2ª fonte de verdade divergente (achado registrado no Dev Agent Record desta story)."""
        import meta_adapter_inbound

        monkeypatch.delenv("META_DEBOUNCE_SECONDS", raising=False)
        assert meta_adapter_inbound._debounce_segundos() == 10.0

    # ── 5) S-WM-33: intervalo real de ~6s cai DENTRO da janela decidida → agrupa ─
    @pytest.mark.asyncio
    async def test_mensagens_com_intervalo_de_6s_ficam_dentro_da_janela_de_7s_e_agrupam(self, monkeypatch):
        """S-WM-33: reproduz, em escala reduzida (fator 100x, sem esperar segundos reais), o
        cenário exato do incidente de 2026-07-14 ("Não precisa" / "Obrigado", 6,127s de
        intervalo real) testando contra o ponto de margem mais apertado já decidido pro
        Junior (7s, escalado pra 0,07s) — a 2ª mensagem chega ANTES do timer da 1ª disparar
        (6 < 7, escalado 0,06 < 0,07), então cancela e reagenda: resultado esperado é 1 SÓ
        dispatch, com o conteúdo da última mensagem. Com a janela ANTIGA (3s) esse mesmo
        intervalo teria gerado 2 dispatches separados — era exatamente o comportamento
        correto (não-bug) confirmado no diagnóstico prévio. O valor de produção atual é 10s
        (margem ainda maior que os 7s testados aqui) — este teste usa `_debounce_segundos`
        monkeypatched direto (não lê o default real), então continua válido independente do
        valor de produção: prova a margem mínima aceitável, não o valor exato configurado
        (isso é responsabilidade do teste anterior, `test_debounce_segundos_default_e_10s`).
        Usa `_dormir_debounce` real (não o stub instantâneo do autouse) sincronizado por um
        Event pra garantir que o debounce da 1ª mensagem já começou antes de medir o
        intervalo — preserva a proporção real intervalo/janela sem depender de timing frágil.
        """
        import meta_adapter_inbound
        from unittest.mock import AsyncMock

        sleep_iniciado = asyncio.Event()

        async def _dormir_real_instrumentado(segundos):
            sleep_iniciado.set()
            await asyncio.sleep(segundos)

        monkeypatch.setattr(meta_adapter_inbound, "_debounce_segundos", lambda: 0.07)
        monkeypatch.setattr(meta_adapter_inbound, "_dormir_debounce", _dormir_real_instrumentado)

        mock_sb = self._mock_supabase_conversa_unica("conv-debounce-3")
        stub = {"canal_origem": "PHONE_DEB3", "agente_tipo": "Institucional", "canal_tipo": "Institucional", "unidade_cuca": None}

        raw1 = json.dumps(self._payload_com_wamid("PHONE_DEB3", "558598887779", "Não precisa", "wamid.deb.5")).encode()
        raw2 = json.dumps(self._payload_com_wamid("PHONE_DEB3", "558598887779", "Obrigado", "wamid.deb.6")).encode()

        with patch("meta_adapter_inbound._get_instancia_by_phone_number_id", return_value=stub), \
             patch("meta_adapter_inbound._get_supabase", return_value=mock_sb), \
             patch("meta_adapter_inbound._chamar_motor_agente", new_callable=AsyncMock,
                   return_value=["Tranquilo, Valmir!"]) as mock_motor, \
             patch("meta_adapter_outbound._meta_marcar_lida_e_digitando", new_callable=AsyncMock, return_value=True), \
             patch("meta_adapter_outbound._meta_enviar", new_callable=AsyncMock, return_value=True) as mock_enviar:

            tarefa1 = asyncio.create_task(processar_webhook_meta(raw1))
            await sleep_iniciado.wait()
            await asyncio.sleep(0.06)  # ~6s reais em escala 100x — intervalo real do incidente
            tarefa2 = asyncio.create_task(processar_webhook_meta(raw2))
            await asyncio.gather(tarefa1, tarefa2)

        mock_motor.assert_called_once()
        mock_enviar.assert_called_once()
        contrato_usado = mock_motor.call_args.args[0]
        assert contrato_usado["mensagem"] == "Obrigado", (
            "S-WM-33: com janela de 7s, um intervalo de 6s entre as mensagens deveria ficar "
            "DENTRO da janela — a 2ª mensagem cancela o dispatch da 1ª e só ela dispara, "
            "gerando 1 resposta agrupada, não 2 separadas (era o comportamento com a janela "
            "antiga de 3s, confirmado correto mas insuficiente no diagnóstico prévio)"
        )


# ─── S-WM-57 (Plano 007): consumo de statuses[] do webhook Meta ───────────────
def _payload_status(phone_number_id="TEST_ID", wamid="wamid.test", status="delivered", errors=None):
    """Payload de evento de status (delivery/read/failed) — sem messages[], formato
    diferente de _payload_texto (que é pra mensagem inbound de verdade)."""
    status_evt = {
        "id": wamid,
        "status": status,
        "timestamp": "1750000000",
        "recipient_id": "558599999999",
    }
    if errors:
        status_evt["errors"] = errors
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
                    "statuses": [status_evt],
                },
                "field": "messages",
            }],
        }],
    }


@pytest.mark.asyncio
async def test_webhook_statuses_atualiza_ledger_por_wamid():
    """Achado B (diagnóstico arquitetural): eventos statuses[] (entregue/lido/falhou)
    eram descartados sem leitura, junto com o early-return de 'sem messages[]' —
    este teste trava que agora atualizam logs_disparo por wamid, a partir de
    agora."""
    from unittest.mock import MagicMock

    payload = _payload_status(wamid="wamid.ABC", status="delivered")
    raw = json.dumps(payload).encode()

    mock_supabase = MagicMock()

    with patch("meta_adapter_inbound._get_supabase", return_value=mock_supabase):
        await processar_webhook_meta(raw)

    mock_supabase.table.assert_any_call("logs_disparo")
    update_call = mock_supabase.table.return_value.update.call_args
    assert update_call is not None, "logs_disparo.update nunca foi chamado"
    assert update_call.args[0]["status"] == "entregue"
    eq_call = mock_supabase.table.return_value.update.return_value.eq.call_args
    assert eq_call.args == ("wamid", "wamid.ABC")


@pytest.mark.asyncio
async def test_webhook_status_fora_de_ordem_protegido_por_or_atomico_na_query():
    """Emenda 2026-07-28 (revisão do sócio, Plano 007): o UPDATE de logs_disparo por
    wamid sobrescrevia o status sem checar se o evento recebido era mais recente que
    o já gravado — 2 webhooks quase simultâneos pro mesmo wamid podiam fazer o status
    regredir (ex.: 'lido' sobrescrito por um 'entregue' atrasado). Este teste trava
    que a proteção está amarrada na própria query via .or_() (atômico), não como um
    design que não chega a ser aplicado no código — e não via SELECT-depois-compara
    em Python, que teria a mesma janela de corrida que esta emenda corrige."""
    from unittest.mock import MagicMock

    payload = _payload_status(wamid="wamid.ORDEM", status="delivered")
    raw = json.dumps(payload).encode()

    mock_supabase = MagicMock()

    with patch("meta_adapter_inbound._get_supabase", return_value=mock_supabase):
        await processar_webhook_meta(raw)

    update_call = mock_supabase.table.return_value.update.call_args
    assert update_call is not None, "logs_disparo.update nunca foi chamado"
    assert update_call.args[0]["status_timestamp_meta"] is not None, (
        "status_timestamp_meta nao foi gravado a partir do timestamp do evento da Meta"
    )

    or_call = mock_supabase.table.return_value.update.return_value.eq.return_value.or_.call_args
    assert or_call is not None, (
        ".or_() nunca foi chamado na query do UPDATE — protecao contra status fora "
        "de ordem nao esta amarrada no codigo, so no design"
    )
    filtro = or_call.args[0]
    assert "status_timestamp_meta.is.null" in filtro
    assert "status_timestamp_meta.lte." in filtro


@pytest.mark.asyncio
async def test_webhook_status_deleted_e_warning_mapeados_corretamente():
    """Emenda 2026-07-28 (revisão do sócio, Plano 007): 'deleted' e 'warning' faltavam
    no _STATUS_MAP — antes caiam no 'continue' e eram descartados silenciosamente,
    igual todo o resto de statuses[] antes da S-WM-57. 'warning' também precisa
    capturar o código de erro de errors[], igual 'failed' já faz."""
    from unittest.mock import MagicMock

    payload_deleted = _payload_status(wamid="wamid.DEL", status="deleted")
    mock_supabase_deleted = MagicMock()
    with patch("meta_adapter_inbound._get_supabase", return_value=mock_supabase_deleted):
        await processar_webhook_meta(json.dumps(payload_deleted).encode())

    update_call_deleted = mock_supabase_deleted.table.return_value.update.call_args
    assert update_call_deleted is not None, "logs_disparo.update nunca foi chamado (deleted)"
    assert update_call_deleted.args[0]["status"] == "apagada"

    payload_warning = _payload_status(
        wamid="wamid.WARN",
        status="warning",
        errors=[{"code": 470, "title": "Message failed to send because of an unknown error"}],
    )
    mock_supabase_warning = MagicMock()
    with patch("meta_adapter_inbound._get_supabase", return_value=mock_supabase_warning):
        await processar_webhook_meta(json.dumps(payload_warning).encode())

    update_call_warning = mock_supabase_warning.table.return_value.update.call_args
    assert update_call_warning is not None, "logs_disparo.update nunca foi chamado (warning)"
    assert update_call_warning.args[0]["status"] == "aviso"
    assert update_call_warning.args[0]["erro"] == "470"
