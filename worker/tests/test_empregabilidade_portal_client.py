"""S-EMP-FSL-01 — Testes da fundação do canal worker → portal e do leitor do flag.

Cobre o coração testável da FSL-01 sem ativar nenhum fluxo de conversa (AC5):
- classificação tri-state+ das respostas do portal (ok / ja_inscrito / rejeitado / retry);
- que erro de rede/timeout vira `retry` sem levantar exceção (AC4);
- que a candidatura manda o header `x-internal-token` e cai na rota certa;
- que token ausente vira `retry` (config), não `rejeitado` (negócio);
- o leitor fail-closed do flag `empreg_fluxo_sem_link` (AC1/AC2 — default desligado).
"""
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, __file__.rsplit("/tests/", 1)[0])

import empregabilidade_portal_client as pc  # noqa: E402


def _make_httpx_mock():
    mock_httpx = MagicMock()
    mock_httpx.TimeoutException = Exception
    mock_httpx.RequestError = Exception
    return mock_httpx


def _resp(status_code, corpo=None, corpo_invalido=False):
    r = MagicMock()
    r.status_code = status_code
    if corpo_invalido:
        r.json.side_effect = ValueError("not json")
    else:
        r.json.return_value = corpo if corpo is not None else {}
    return r


# ─────────────────────────────────────────────────────────────────────────────
# classificar_resposta — o núcleo (o ponto que o review de planejamento destacou)
# ─────────────────────────────────────────────────────────────────────────────

class TestClassificarResposta:

    def test_2xx_ok(self):
        res = pc.classificar_resposta(_resp(200, {"url": "https://r2/x.pdf"}))
        assert res.status == "ok"
        assert res.ok is True
        assert res.dado == {"url": "https://r2/x.pdf"}

    def test_201_ok(self):
        assert pc.classificar_resposta(_resp(201, {"id": "abc", "codigo": "ABC123"})).status == "ok"

    def test_409_ja_inscrito_terminal_nao_retry(self):
        res = pc.classificar_resposta(_resp(409, {"error": "Você já está inscrito nesta vaga."}))
        assert res.status == "ja_inscrito"
        assert res.deve_retentar is False
        assert res.terminal is True

    def test_400_idade_rejeitado_preserva_corpo(self):
        # 400 do corte de idade (candidaturas/route.ts) — FSL-04 ramifica nesse corpo.
        res = pc.classificar_resposta(_resp(400, {"error": "Esta vaga exige idade mínima de 18 anos."}))
        assert res.status == "rejeitado"
        assert res.deve_retentar is False
        assert res.http_status == 400
        assert res.dado["error"] == "Esta vaga exige idade mínima de 18 anos."

    def test_403_rejeitado(self):
        res = pc.classificar_resposta(_resp(403, {"error": "Link inválido ou expirado."}))
        assert res.status == "rejeitado"
        assert res.deve_retentar is False

    def test_500_retry(self):
        res = pc.classificar_resposta(_resp(500, {"error": "Erro interno"}))
        assert res.status == "retry"
        assert res.deve_retentar is True

    def test_503_sem_json_retry(self):
        res = pc.classificar_resposta(_resp(503, corpo_invalido=True))
        assert res.status == "retry"
        assert res.deve_retentar is True


# ─────────────────────────────────────────────────────────────────────────────
# criar_candidatura
# ─────────────────────────────────────────────────────────────────────────────

class TestCriarCandidatura:

    @pytest.mark.asyncio
    async def test_token_ausente_vira_retry_nao_rejeitado(self, monkeypatch):
        monkeypatch.delenv("WEBHOOK_INTERNAL_TOKEN", raising=False)
        res = await pc.criar_candidatura({"nome": "Fulano", "telefone": "5585999"})
        assert res.status == "retry"
        assert "WEBHOOK_INTERNAL_TOKEN" in (res.erro or "")

    @pytest.mark.asyncio
    async def test_envia_token_e_cai_na_rota_certa(self, monkeypatch):
        monkeypatch.setenv("WEBHOOK_INTERNAL_TOKEN", "segredo-teste")
        monkeypatch.setenv("PORTAL_URL", "https://portal.teste")
        mock_httpx = _make_httpx_mock()
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=_resp(200, {"id": "id1", "codigo": "ABC123"}))
        mock_httpx.AsyncClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.AsyncClient.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch.dict(sys.modules, {"httpx": mock_httpx}):
            res = await pc.criar_candidatura({"nome": "Fulano", "telefone": "5585999"})

        assert res.status == "ok"
        assert res.dado["codigo"] == "ABC123"
        call = mock_client.post.call_args
        assert "/api/empregabilidade/candidaturas" in str(call)
        assert call.kwargs["headers"]["x-internal-token"] == "segredo-teste"

    @pytest.mark.asyncio
    async def test_timeout_vira_retry_sem_levantar(self, monkeypatch):
        monkeypatch.setenv("WEBHOOK_INTERNAL_TOKEN", "segredo-teste")
        mock_httpx = _make_httpx_mock()
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(side_effect=mock_httpx.TimeoutException("timeout"))
        mock_httpx.AsyncClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.AsyncClient.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch.dict(sys.modules, {"httpx": mock_httpx}):
            res = await pc.criar_candidatura({"nome": "Fulano", "telefone": "5585999"})

        assert res.status == "retry"


# ─────────────────────────────────────────────────────────────────────────────
# enviar_curriculo_para_r2
# ─────────────────────────────────────────────────────────────────────────────

class TestEnviarCurriculo:

    @pytest.mark.asyncio
    async def test_upload_ok_retorna_url(self, monkeypatch):
        monkeypatch.setenv("PORTAL_URL", "https://portal.teste")
        mock_httpx = _make_httpx_mock()
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=_resp(200, {"url": "https://r2/perm/cv.pdf"}))
        mock_httpx.AsyncClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.AsyncClient.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch.dict(sys.modules, {"httpx": mock_httpx}):
            res = await pc.enviar_curriculo_para_r2(b"%PDF-1.4 fake", "cv.pdf", "application/pdf")

        assert res.status == "ok"
        assert res.dado["url"] == "https://r2/perm/cv.pdf"
        call = mock_client.post.call_args
        assert "/api/empregabilidade/upload-cv" in str(call)
        assert "file" in call.kwargs["files"]
        assert call.kwargs["data"]["folder"] == "candidaturas"

    @pytest.mark.asyncio
    async def test_octet_stream_com_pdf_valido_manda_mime_permitido(self, monkeypatch):
        # WhatsApp costuma declarar application/octet-stream — sem normalização, a rota daria 400.
        monkeypatch.setenv("PORTAL_URL", "https://portal.teste")
        mock_httpx = _make_httpx_mock()
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(return_value=_resp(200, {"url": "https://r2/perm/cv.pdf"}))
        mock_httpx.AsyncClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.AsyncClient.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch.dict(sys.modules, {"httpx": mock_httpx}):
            res = await pc.enviar_curriculo_para_r2(b"%PDF-1.4 conteudo", "cv", "application/octet-stream")

        assert res.status == "ok"
        # o 3º elemento da tupla do file é o content-type efetivamente enviado
        enviado = mock_client.post.call_args.kwargs["files"]["file"]
        assert enviado[2] == "application/pdf"

    def test_normaliza_mime(self):
        assert pc._content_type_para_upload(b"%PDF-1.7", "application/octet-stream") == "application/pdf"
        assert pc._content_type_para_upload(b"\x89PNG\r\n", "") == "image/png"
        assert pc._content_type_para_upload(b"\xff\xd8\xff\xe0", "image/jpeg") == "image/jpeg"
        assert pc._content_type_para_upload(b"\x00\x00\x00\x18ftypheic", "image/heic") == "image/jpeg"
        assert pc._content_type_para_upload(b"lixo", "application/pdf") == "application/pdf"

    @pytest.mark.asyncio
    async def test_upload_timeout_vira_retry(self, monkeypatch):
        mock_httpx = _make_httpx_mock()
        mock_client = AsyncMock()
        mock_client.post = AsyncMock(side_effect=mock_httpx.RequestError("conn"))
        mock_httpx.AsyncClient.return_value.__aenter__ = AsyncMock(return_value=mock_client)
        mock_httpx.AsyncClient.return_value.__aexit__ = AsyncMock(return_value=False)

        with patch.dict(sys.modules, {"httpx": mock_httpx}):
            res = await pc.enviar_curriculo_para_r2(b"x", "cv.pdf", "application/pdf")

        assert res.status == "retry"


# ─────────────────────────────────────────────────────────────────────────────
# _fluxo_sem_link_ativo — leitor fail-closed do flag (AC1/AC2)
# ─────────────────────────────────────────────────────────────────────────────

def _fake_supabase_com_valor(valor):
    """Monta um supabase mock cujo select…execute() devolve .data com o valor dado.
    `valor=None` simula linha ausente (data vazia)."""
    fake = MagicMock()
    exec_result = MagicMock()
    exec_result.data = [] if valor is None else [{"valor": valor}]
    fake.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.return_value = exec_result
    return fake


class TestFlagReader:

    @pytest.mark.asyncio
    @pytest.mark.parametrize("valor", ["true", "1", "on", "sim", "TRUE", " True ", "Sim"])
    async def test_valores_ligados(self, monkeypatch, valor):
        import empregabilidade_engine as eng
        monkeypatch.setattr(eng, "supabase", _fake_supabase_com_valor(valor))
        assert await eng._fluxo_sem_link_ativo() is True

    @pytest.mark.asyncio
    @pytest.mark.parametrize("valor", ["false", "0", "off", "não", "", "False", "lixo", "2"])
    async def test_valores_desligados(self, monkeypatch, valor):
        import empregabilidade_engine as eng
        monkeypatch.setattr(eng, "supabase", _fake_supabase_com_valor(valor))
        assert await eng._fluxo_sem_link_ativo() is False

    @pytest.mark.asyncio
    async def test_linha_ausente_desligado(self, monkeypatch):
        import empregabilidade_engine as eng
        monkeypatch.setattr(eng, "supabase", _fake_supabase_com_valor(None))
        assert await eng._fluxo_sem_link_ativo() is False

    @pytest.mark.asyncio
    async def test_excecao_na_leitura_desligado(self, monkeypatch):
        import empregabilidade_engine as eng
        fake = MagicMock()
        fake.table.return_value.select.return_value.eq.return_value.limit.return_value.execute.side_effect = RuntimeError("db down")
        monkeypatch.setattr(eng, "supabase", fake)
        assert await eng._fluxo_sem_link_ativo() is False
