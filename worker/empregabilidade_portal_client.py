"""S-EMP-FSL-01 — Canal worker → portal (fundação do fluxo do candidato 100% no WhatsApp).

Hoje o worker **nunca** chama a API do ``cuca-portal`` — só o inverso acontece (o portal chama o
worker pra OCR, ``/process-cv``). O fluxo sem link inverte isso: o worker precisa gravar o
currículo no **R2 permanente** e criar a candidatura chamando as **mesmas rotas** que o formulário
web já usa, pra herdar exatamente as mesmas regras de negócio:

- ``POST {PORTAL_URL}/api/empregabilidade/upload-cv``   — multipart ``file`` (+ ``folder``)
  → ``200 {"url": <url R2 permanente>}``
- ``POST {PORTAL_URL}/api/empregabilidade/candidaturas`` — JSON (mesmo payload do formulário)
  → ``200 {"id", "codigo"}``

Autenticação M2M: header ``x-internal-token`` == ``WEBHOOK_INTERNAL_TOKEN`` — mesmo segredo e
mesmo padrão já usado no sentido portal→worker (``main.py``). A rota ``upload-cv`` é **pública**
(candidatos externos sobem CV sem login), então não exige token. A rota ``candidaturas`` valida
link assinado, mas reconhece o token do worker como caminho de auth **alternativo** (bypass do
link, sem enfraquecer o do formulário — ver ``candidaturas/route.ts``).

**Escopo desta fundação (FSL-01):** expor UM tijolo de **uma tentativa classificada** por chamada,
que nunca levanta exceção. A orquestração de "mensagem de espera + re-tentar" (decisão 8 do plano)
é da FSL-03 (conversa), **não** daqui — por isso as funções abaixo fazem uma única tentativa e
devolvem o resultado classificado. Nenhum fluxo de conversa é ativado por este módulo (AC5).

Classificação (o ponto crítico, por instrução do review de planejamento):

- ``ok``          — 2xx: gravou. ``dado`` traz o JSON (url / id+codigo).
- ``ja_inscrito`` — 409: a pessoa já tem candidatura ativa nesta vaga/cargo. Estado **terminal**,
  não é falha nem retry (a rota devolve isso de propósito).
- ``rejeitado``   — demais 4xx (400 idade/campos, 403 link/telefone): **rejeição de negócio**,
  terminal. NÃO re-tentar (re-tentar um 400 permanente deixaria o lead sem resposta pra sempre).
  ``http_status`` + ``dado`` são preservados pra FSL-03/FSL-04 ramificarem (ex.: 400 de idade →
  oferecer Banco de Talentos na conversa).
- ``retry``       — timeout, erro de conexão ou 5xx: falha **transiente**. Aqui é que entra a
  decisão 8 (mensagem "estou finalizando" + re-tentar por trás), orquestrada pela FSL-03.
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# --- Política de timeout/retry (decisão 8) -------------------------------------------------
# A PRIMEIRA tentativa é curta: ela roda dentro do turno da conversa e tem orçamento de latência
# (o worker já usa timeout=10 em outras chamadas do engine). Se ela cair em `retry`, quem chama
# (FSL-03) manda a mensagem de espera e SÓ ENTÃO re-tenta — re-tentar em linha faria o lead
# esperar dezenas de segundos por uma resposta, que é justamente o que a decisão 8 evita.
PORTAL_TIMEOUT_PRIMEIRA_TENTATIVA_S = 8.0
PORTAL_TIMEOUT_RETRY_S = 15.0
PORTAL_MAX_RETRIES = 2
PORTAL_RETRY_INTERVALO_S = 2.0

_ROTA_UPLOAD_CV = "/api/empregabilidade/upload-cv"
_ROTA_CANDIDATURAS = "/api/empregabilidade/candidaturas"

# A rota upload-cv REJEITA (400) um mime declarado fora da lista permitida ANTES de validar os
# bytes — e o WhatsApp costuma entregar documento como "application/octet-stream" (ou nada). Um PDF
# perfeitamente válido com octet-stream declarado seria rejeitado como se fosse lixo, e o lead
# receberia um "não" definitivo. Como o mime declarado está 100% sob controle do worker e a rota é
# autoritativa por MAGIC BYTES (o arquivo é sempre armazenado pela extensão detectada dos bytes,
# não pelo mime declarado), normalizamos aqui: mandamos sempre um mime da lista permitida, deixando
# a validação de bytes do portal ser o juiz real (ela devolve 400 se os bytes forem lixo de fato).
# Assinaturas idênticas às de upload-cv/route.ts (MAGIC_SIGNATURES).
_MIME_POR_MAGIC = (
    (b"%PDF", "application/pdf"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"\x89PNG", "image/png"),
    (b"PK\x03\x04", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    (b"\xd0\xcf\x11\xe0", "application/msword"),
)
_MIMES_PERMITIDOS = frozenset(mime for _, mime in _MIME_POR_MAGIC)


def _content_type_para_upload(conteudo: bytes, tipo_mime: str) -> str:
    """Devolve um content-type SEMPRE dentro da lista aceita pela rota upload-cv, pra não tomar
    400 por mime declarado. Ordem: (1) o mime informado, se já for permitido; (2) sniff dos magic
    bytes; (3) HEIC (caixa ftyp) → a rota converte lá dentro e pula a checagem de mime, então o
    valor é inócuo; (4) desconhecido → manda um permitido e deixa a validação de bytes do portal
    rejeitar se for lixo de verdade."""
    t = (tipo_mime or "").strip().lower()
    if t in _MIMES_PERMITIDOS:
        return t
    for assinatura, mime in _MIME_POR_MAGIC:
        if conteudo.startswith(assinatura):
            return mime
    if len(conteudo) >= 12 and conteudo[4:8] == b"ftyp":
        return "image/jpeg"  # HEIC/HEIF — convertido no portal; step de mime é pulado lá
    return "application/pdf"


@dataclass
class ResultadoPortal:
    """Resultado classificado de UMA tentativa de chamada ao portal. Nunca representa exceção
    crua — erros de rede/timeout já vêm mapeados como ``status='retry'``."""

    status: str  # "ok" | "ja_inscrito" | "rejeitado" | "retry"
    http_status: int | None = None
    dado: dict | None = None
    erro: str | None = None

    @property
    def ok(self) -> bool:
        return self.status == "ok"

    @property
    def deve_retentar(self) -> bool:
        """Só ``retry`` é re-tentável. ``ja_inscrito`` e ``rejeitado`` são terminais (re-tentar
        não muda o resultado e ainda deixaria o lead sem resposta)."""
        return self.status == "retry"

    @property
    def terminal(self) -> bool:
        return self.status in ("ok", "ja_inscrito", "rejeitado")


def _config() -> tuple[str, str]:
    portal_url = os.getenv("PORTAL_URL", "https://www.cucaatendemais.com.br").rstrip("/")
    token = os.getenv("WEBHOOK_INTERNAL_TOKEN", "")
    return portal_url, token


def _corpo_json(resp) -> dict | None:
    try:
        corpo = resp.json()
        return corpo if isinstance(corpo, dict) else {"data": corpo}
    except Exception:
        return None


def _mensagem_erro(corpo: dict | None, http_status: int) -> str | None:
    if corpo and isinstance(corpo.get("error"), str):
        return corpo["error"]
    return f"HTTP {http_status}"


def classificar_resposta(resp) -> ResultadoPortal:
    """Traduz uma resposta HTTP do portal na classificação do fluxo. Isolada e pura pra ser o
    coração testável do módulo."""
    sc = resp.status_code
    corpo = _corpo_json(resp)
    if 200 <= sc < 300:
        return ResultadoPortal("ok", sc, corpo, None)
    if sc == 409:
        return ResultadoPortal("ja_inscrito", sc, corpo, _mensagem_erro(corpo, sc))
    if 400 <= sc < 500:
        return ResultadoPortal("rejeitado", sc, corpo, _mensagem_erro(corpo, sc))
    # 5xx (e qualquer status inesperado >= 500): transiente → re-tentável.
    return ResultadoPortal("retry", sc, corpo, _mensagem_erro(corpo, sc))


def _resultado_erro_rede(exc: Exception) -> ResultadoPortal:
    return ResultadoPortal("retry", None, None, f"{type(exc).__name__}: {exc}")


async def enviar_curriculo_para_r2(
    conteudo: bytes,
    nome_arquivo: str,
    tipo_mime: str,
    folder: str = "candidaturas",
    timeout_s: float = PORTAL_TIMEOUT_PRIMEIRA_TENTATIVA_S,
) -> ResultadoPortal:
    """Envia o arquivo recebido no WhatsApp pra rota de upload do portal → **R2 permanente**
    (nunca o bucket ``anexos-conversas`` de 15 dias). Uma tentativa; classifica; não levanta.

    ``tipo_mime`` é o mime informado pelo WhatsApp (pode vir ``application/octet-stream`` ou vazio).
    O content-type enviado é **normalizado** por ``_content_type_para_upload`` pra sempre cair na
    lista aceita pela rota — a validação real do arquivo é por magic bytes no portal, então um mime
    declarado ruim não pode transformar um CV válido num 400."""
    portal_url, _ = _config()
    try:
        import httpx  # noqa: PLC0415 — lazy: httpx pode faltar nos containers de teste
    except ImportError as exc:  # pragma: no cover - ambiente sem httpx
        return _resultado_erro_rede(exc)
    content_type = _content_type_para_upload(conteudo, tipo_mime)
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.post(
                f"{portal_url}{_ROTA_UPLOAD_CV}",
                files={"file": (nome_arquivo, conteudo, content_type)},
                data={"folder": folder},
            )
        return classificar_resposta(resp)
    except (httpx.TimeoutException, httpx.RequestError) as exc:
        logger.warning("[portal-client] upload-cv falhou (transiente): %s", exc)
        return _resultado_erro_rede(exc)


async def criar_candidatura(
    payload: dict,
    timeout_s: float = PORTAL_TIMEOUT_PRIMEIRA_TENTATIVA_S,
) -> ResultadoPortal:
    """Cria a candidatura chamando a MESMA rota do formulário, com o payload idêntico, usando o
    token interno do worker como auth (bypass do link assinado — só pro worker). Uma tentativa;
    classifica; não levanta.

    Sem ``WEBHOOK_INTERNAL_TOKEN`` no ambiente, a rota devolveria 403 (que seria lido como
    ``rejeitado``, uma mentira — não é rejeição de negócio, é config faltando). Por isso tratamos
    token ausente como ``retry`` com erro explícito: o lead não é informado de "rejeição", o
    problema fica visível na observabilidade (FSL-08) e a decisão 8 segura a conversa."""
    portal_url, token = _config()
    if not token:
        logger.error("[portal-client] WEBHOOK_INTERNAL_TOKEN ausente no worker — candidatura não enviada")
        return ResultadoPortal("retry", None, None, "WEBHOOK_INTERNAL_TOKEN ausente no worker")
    try:
        import httpx  # noqa: PLC0415 — lazy: httpx pode faltar nos containers de teste
    except ImportError as exc:  # pragma: no cover - ambiente sem httpx
        return _resultado_erro_rede(exc)
    try:
        async with httpx.AsyncClient(timeout=timeout_s) as client:
            resp = await client.post(
                f"{portal_url}{_ROTA_CANDIDATURAS}",
                json=payload,
                headers={"x-internal-token": token},
            )
        return classificar_resposta(resp)
    except (httpx.TimeoutException, httpx.RequestError) as exc:
        logger.warning("[portal-client] candidaturas falhou (transiente): %s", exc)
        return _resultado_erro_rede(exc)
