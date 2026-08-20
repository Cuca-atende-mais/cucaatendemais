"""
S-AE-04 — Automação de Entrada Humanizada (Academia Enem / WhatsApp oficial Meta direta).

Reescrito em 2026-08-20 (decisão do Junior, migração Meta direta — abandono do AuctaFlux):
- Roda DENTRO do mesmo código-base do worker (`main.py`/`meta_adapter_inbound.py`), só que
  implantado como o serviço separado `cuca-academia-enem` (S-AE-02), com credenciais Meta
  próprias (`META_SYSTEM_USER_TOKEN` desse serviço = token da BM da Academia Enem, não a "Ivida").
- Estado da conversa em `conversas.metadata.ae_fluxo` (mesmo padrão de `empreg_fluxo` do
  `empregabilidade_engine.py`) — `conversas` NÃO tem coluna `estado` própria; a etapa vive
  inteira dentro do metadata, igual Empregabilidade.
- Mensagens em `mensagens` (tabela compartilhada, `remetente` in {'lead','agente'}).
- Envio via `meta_adapter_outbound._meta_enviar` (Graph API), o mesmo adapter usado por
  Institucional/Empregabilidade/motor-agente.
- SEM menu numérico: saudação humanizada + coleta de nome. Após o nome, hand-off ao
  classificador (S-AE-10) pelo seam `classificar()` — SEM responder dúvida aqui (no-invention;
  o "cérebro" de roteamento disparo-vs-RAG é a S-AE-10, ainda não implementada).

A máquina de estados pura `decidir()` abaixo é INALTERADA em relação à implementação anterior
(AuctaFlux) — já era testável sem IO e desacoplada de tabela/provider; só a camada de I/O
(persistência/envio) mudou de `ae_conversas`/`ae_mensagens`/AuctaFlux para `conversas`/
`mensagens`/Meta.
"""

import os
import re
import asyncio
import logging
from datetime import datetime, timezone

from supabase import create_client, Client

logger = logging.getLogger("academia_enem_engine")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Reuso da mecânica do empregabilidade_engine — palavras de encerramento.
_PALAVRAS_ENCERRAR = {
    "tchau", "até mais", "até logo", "encerrar", "finalizar", "obrigado",
    "obrigada", "valeu", "pronto", "pode fechar", "nada mais", "só isso", "era isso",
}

# S-AE-06: mesmo conjunto de expressões de pedido explícito de humano usado por
# `empregabilidade_engine._CONTAINS_HANDOVER` — detecção por substring, não regex, igual lá.
_CONTAINS_HANDOVER = {
    "falar com humano", "falar com um humano", "atendente humano", "falar com atendente",
    "falar com o atendente", "falar com um atendente", "falar com a atendente",
    "quero atendente", "quero humano", "humano por favor", "pessoa real",
    "quero falar com atendente", "quero falar com o atendente",
    "preciso de atendente", "chamar atendente", "atendente por favor",
    "falar com pessoa", "atendimento humano", "preciso de ajuda humana",
    "falar com alguem", "falar com alguém", "falar com um alguem", "falar com um alguém",
    "quero falar com alguem", "quero falar com alguém", "quero falar com um humano",
    "me passa para humano", "me passa para atendente", "falar com uma pessoa",
    "quero atendimento", "preciso de atendimento", "falar com suporte",
    "passa para atendente", "passa pra atendente", "passa para um atendente",
    "passa pra um atendente", "não entendi", "nao entendi",
}

_MSG_TRANSBORDO_SUCESSO = (
    "Certo! Já chamei alguém da nossa equipe pra te ajudar por aqui. 🙋 "
    "Só um instante que já te respondem."
)
_MSG_TRANSBORDO_FALHOU = (
    "Tentei chamar nossa equipe agora, mas não consegui confirmar o encaminhamento automático. "
    "Por favor, tente novamente em alguns minutos."
)


def _quer_humano(texto: str) -> bool:
    t = (texto or "").strip().lower()
    return any(p in t for p in _CONTAINS_HANDOVER)

SAUDACAO = (
    "Olá! 👋 Seja muito bem-vindo(a) à Academia Enem. "
    "Pra te atender direitinho, como você se chama?"
)

# Prefixos comuns que o lead usa ao dizer o nome ("meu nome é joão" -> "joão").
_PREFIXOS_NOME = re.compile(
    r"^\s*(?:"
    r"meu nome\s+(?:é|e|eh)?\s*|"
    r"me chamo\s+|"
    r"(?:eu\s+)?sou\s+(?:o|a)?\s*|"
    r"aqui\s+(?:é|e)\s+(?:o|a)?\s*|"
    r"nome\s*:?\s*"
    r")",
    re.IGNORECASE,
)


def _quer_encerrar(texto: str) -> bool:
    t = (texto or "").strip().lower()
    return t in _PALAVRAS_ENCERRAR or any(p in t for p in _PALAVRAS_ENCERRAR)


def _extrair_nome(texto: str) -> str:
    """Extrai um nome legível da mensagem do lead (sem inventar — só limpa/normaliza)."""
    bruto = _PREFIXOS_NOME.sub("", (texto or "").strip())
    bruto = bruto.splitlines()[0] if bruto else ""
    # Mantém só a primeira parte curta (evita capturar uma frase inteira como "nome").
    palavras = [p for p in re.split(r"\s+", bruto) if p][:3]
    nome = " ".join(palavras).strip(" .,!?-")[:60]
    return nome.title() if nome else ""


# ---------------------------------------------------------------------------
# Máquina de estados — FUNÇÃO PURA (testável sem IO). Decide a ação a partir do
# estado atual + texto recebido. Não faz rede nem banco. INALTERADA desde a
# implementação AuctaFlux (a lógica de conversa não depende de tabela/provider).
# ---------------------------------------------------------------------------

def decidir(estado: str | None, texto: str, fluxo: dict | None) -> dict:
    """
    Retorna a decisão da máquina de estados:
      { acao: 'saudar'|'coletar_nome'|'classificar'|'encerrar',
        proximo_estado: str, mensagem: str|None, fluxo: dict }
    'classificar' tem mensagem=None: hand-off SILENCIOSO ao seam (S-AE-10 responde, não aqui).
    """
    estado = estado or "novo"
    fluxo = dict(fluxo or {})
    texto_norm = (texto or "").strip()

    # Encerramento só faz sentido depois do diálogo ter começado.
    if estado in ("aguardando_nome", "ativo") and _quer_encerrar(texto_norm):
        return {
            "acao": "encerrar",
            "proximo_estado": "encerrada",
            "mensagem": "Tudo certo! Quando quiser falar sobre o Enem, é só me chamar por aqui. 👋",
            "fluxo": {**fluxo, "etapa": "encerrada"},
        }

    if estado in ("novo", "", None):
        return {
            "acao": "saudar",
            "proximo_estado": "aguardando_nome",
            "mensagem": SAUDACAO,
            "fluxo": {**fluxo, "etapa": "aguardando_nome"},
        }

    if estado == "aguardando_nome":
        nome = _extrair_nome(texto_norm)
        saud = f"Prazer, {nome}!" if nome else "Prazer!"
        return {
            "acao": "coletar_nome",
            "proximo_estado": "ativo",
            "mensagem": f"{saud} 😊 Pode me mandar sua dúvida sobre o Enem que eu te ajudo.",
            "fluxo": {**fluxo, "nome": nome, "etapa": "ativo"},
        }

    # estado 'ativo' (ou qualquer estado pós-nome): hand-off ao classificador (S-AE-10).
    # Seam SILENCIOSO — a S-AE-04 não responde dúvidas (no-invention). A S-AE-10 assume o roteamento.
    return {"acao": "classificar", "proximo_estado": "ativo", "mensagem": None, "fluxo": fluxo}


# ---------------------------------------------------------------------------
# SEAM de roteamento (S-AE-10) — interface estável, no-op até a S-AE-10 existir.
# NÃO adicionar lógica de RAG/disparo/transbordo aqui: isso é a S-AE-10 (integrador).
# ---------------------------------------------------------------------------

async def classificar(conversa_id: str) -> None:
    """Hand-off ao classificador disparo-vs-RAG (S-AE-10). No-op por enquanto (silêncio proposital)."""
    logger.info(
        "[AE engine] seam classificar() acionado p/ conversa %s — "
        "roteamento será implementado na S-AE-10 (no-op no momento).",
        conversa_id,
    )
    return None


# ---------------------------------------------------------------------------
# I/O — fluxo (metadata.ae_fluxo em `conversas`, mesmo padrão de empreg_fluxo).
# ---------------------------------------------------------------------------

def _get_fluxo(conversa_id: str) -> dict:
    res = supabase.table("conversas").select("metadata").eq("id", conversa_id).single().execute()
    metadata = (res.data or {}).get("metadata") or {}
    return metadata.get("ae_fluxo", {})


def _persistir_estado(conversa_id: str, fluxo: dict) -> None:
    """Atualiza `metadata.ae_fluxo` (etapa da conversa vive inteira no metadata — `conversas`
    não tem coluna `estado` própria, mesmo padrão do `empreg_fluxo` de Empregabilidade)."""
    res = supabase.table("conversas").select("metadata").eq("id", conversa_id).single().execute()
    metadata = (res.data or {}).get("metadata") or {}
    metadata["ae_fluxo"] = fluxo
    supabase.table("conversas").update(
        {"metadata": metadata, "updated_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", conversa_id).execute()


def _ultima_mensagem_lead(conversa_id: str) -> tuple[str, str]:
    """Retorna (remetente, conteudo) da última mensagem da conversa."""
    res = (
        supabase.table("mensagens")
        .select("remetente, conteudo")
        .eq("conversa_id", conversa_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    ultima = (res.data or [{}])[0]
    return ultima.get("remetente", ""), ultima.get("conteudo") or ""


# ---------------------------------------------------------------------------
# Envio via Meta (Graph API, mesmo adapter dos demais canais diretos) + gravação em `mensagens`.
# ---------------------------------------------------------------------------

async def _enviar(conversa_id: str, phone_number_id: str, telefone: str, texto: str, lead_id: str = "") -> bool:
    """Envia texto via Meta e grava em `mensagens` (remetente='agente'). Retorna True só se
    enviou de fato — evita "consumir" a saudação sem o lead receber quando a Graph API falha."""
    from meta_adapter_outbound import _meta_enviar  # noqa: PLC0415

    token = os.getenv("META_SYSTEM_USER_TOKEN", "")
    ok = await _meta_enviar(phone_number_id, telefone, texto, token)
    if not ok:
        return False

    try:
        supabase.table("mensagens").insert({
            "conversa_id": conversa_id,
            "lead_id": lead_id or None,
            "remetente": "agente",
            "tipo": "text",
            "conteudo": texto,
        }).execute()
    except Exception as exc:
        logger.error("[AE engine] Falha ao gravar mensagem da IA (conversa %s): %s", conversa_id, exc, exc_info=True)
    return True


# ---------------------------------------------------------------------------
# Transbordo (S-AE-06) — reaproveita `_notificar_transbordo` (genérico, já filtra por
# `modulo` corretamente — ver de-risk na story) em vez de recriar a lógica de notificação.
# NÃO cria tabela nova: usa `transbordo_humano` com `modulo='academia_enem'`.
# ---------------------------------------------------------------------------

async def acionar_transbordo(
    conversa_id: str,
    phone_number_id: str,
    telefone: str,
    lead_id: str = "",
) -> bool:
    """Marca a conversa em `awaiting_human` (silenciando a IA) e notifica o responsável
    cadastrado em `transbordo_humano` para `modulo='academia_enem'`. Reverte o status se a
    notificação falhar (mesmo padrão de `empregabilidade_engine._acionar_transbordo_empregabilidade`)
    — evita deixar a conversa "presa" em awaiting_human sem ninguém avisado.

    Público (não prefixado com `_`): a S-AE-10 (classificador) vai chamar esta função quando o
    lead aceitar transferência após o RAG não encontrar resposta (AC3) — seam já pronto, sem
    reimplementar a notificação lá."""
    def _marcar_awaiting_human():
        supabase.table("conversas").update(
            {"status": "awaiting_human", "updated_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", conversa_id).execute()

    def _restaurar_ativa():
        supabase.table("conversas").update(
            {"status": "ativa", "updated_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", conversa_id).execute()

    try:
        await asyncio.to_thread(_marcar_awaiting_human)
    except Exception as exc:
        logger.error("[AE engine] Falha ao marcar awaiting_human (conversa %s): %s", conversa_id, exc, exc_info=True)
        return False

    from meta_adapter_inbound import _notificar_transbordo  # noqa: PLC0415
    try:
        # AC4: modulo FIXO 'academia_enem' — nunca cai no contato de outro módulo mesmo sem
        # contato configurado (_notificar_transbordo filtra estrito por modulo, sem fallback
        # cruzado; loga warning e retorna False — tratado abaixo).
        notificado = await _notificar_transbordo(conversa_id, "academia_enem", None, phone_number_id, telefone)
    except Exception as exc:
        logger.error("[AE engine] Erro ao notificar transbordo (conversa %s): %s", conversa_id, exc, exc_info=True)
        notificado = False

    if not notificado:
        try:
            await asyncio.to_thread(_restaurar_ativa)
        except Exception as exc:
            logger.error("[AE engine] Falha ao reverter awaiting_human (conversa %s): %s", conversa_id, exc, exc_info=True)
        await _enviar(conversa_id, phone_number_id, telefone, _MSG_TRANSBORDO_FALHOU, lead_id)
        return False

    await _enviar(conversa_id, phone_number_id, telefone, _MSG_TRANSBORDO_SUCESSO, lead_id)
    logger.info("[AE engine] Transbordo acionado com sucesso (conversa %s)", conversa_id)
    return True


# ---------------------------------------------------------------------------
# Entrada do engine — chamado por `meta_adapter_inbound._executar_dispatch` quando
# agente_tipo == 'academia_enem'. `awaiting_human` já foi checado ali, antes do dispatch
# (mesma checagem central usada por todos os agente_tipo) — não repetido aqui.
# ---------------------------------------------------------------------------

async def processar_mensagem_academia_enem(
    texto: str,
    phone: str,
    phone_number_id: str,
    lead_id: str,
    conversa_id: str,
) -> None:
    # 1) Relê a última mensagem da própria conversa — só age sobre inbound do lead
    #    (evita loop com o próprio outbound, mesmo cuidado do empregabilidade_engine).
    remetente, _conteudo = await asyncio.to_thread(_ultima_mensagem_lead, conversa_id)
    if remetente != "lead":
        logger.info("[AE engine] Última mensagem não é do lead (conversa %s) — nada a fazer.", conversa_id)
        return

    # 1.5) AC1: pedido explícito de humano tem prioridade sobre a máquina de estados —
    # o lead pode pedir transbordo em qualquer etapa da conversa (não só em 'ativo').
    if _quer_humano(texto):
        await acionar_transbordo(conversa_id, phone_number_id, phone, lead_id)
        return

    # 2) Decide (puro) a partir do fluxo fresco (metadata.ae_fluxo).
    fluxo = await asyncio.to_thread(_get_fluxo, conversa_id)
    decisao = decidir(fluxo.get("etapa"), texto, fluxo)

    # 3) Hand-off ao classificador (S-AE-10): sem envio, só avança o fluxo e delega.
    if decisao["acao"] == "classificar":
        await asyncio.to_thread(_persistir_estado, conversa_id, decisao["fluxo"])
        await classificar(conversa_id)
        return

    # 4) Ações com mensagem: ENVIA primeiro; só avança o fluxo se o envio funcionou.
    if not decisao.get("mensagem"):
        return
    enviado = await _enviar(conversa_id, phone_number_id, phone, decisao["mensagem"], lead_id)
    if enviado:
        await asyncio.to_thread(_persistir_estado, conversa_id, decisao["fluxo"])
