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

        # Touch point 2: payload do motor-agente em institucional_engine.py deve estar limpo
        with open(os.path.join(worker_dir, "institucional_engine.py"), encoding="utf-8") as f:
            engine_content = f.read()
        assert '"instancia_uazapi":' not in engine_content, (
            "Regressão touch point 2: institucional_engine.py ainda contém "
            "'\"instancia_uazapi\":' como chave de dict."
        )
        assert '"canal_origem":' in engine_content, (
            "Regressão touch point 2: 'canal_origem' não encontrado em institucional_engine.py"
        )

        # Touch point 3: Edge Function motor-agente deve ler 'canal_origem' do body
        edge_fn = os.path.join(os.path.dirname(__file__), "..", "..",
                               "supabase", "functions", "motor-agente", "index.ts")
        with open(edge_fn, encoding="utf-8") as f:
            edge_content = f.read()
        assert "canal_origem" in edge_content, (
            "Regressão touch point 3: 'canal_origem' não encontrado em motor-agente/index.ts"
        )
        # Garante que o body não lê mais 'instancia_uazapi' diretamente (linha do destructure)
        assert "canal_origem: instancia_uazapi" in edge_content, (
            "Regressão touch point 3: alias 'canal_origem: instancia_uazapi' ausente em motor-agente/index.ts"
        )
