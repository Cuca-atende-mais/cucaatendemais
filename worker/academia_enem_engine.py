"""
S-AE-04 / S-AE-16 — Automação de entrada da Academia Enem (WhatsApp oficial Meta direta).

Reescrito na S-AE-16 (2026-08-25, decisão do Junior — clonar o comportamento do Institucional):
- SEM etapa de coleta de nome. Toda mensagem do lead vai DIRETO ao cérebro (Edge Function
  própria `academia-enem-agente`), igual o Institucional fala direto com o `motor-agente`. A
  máquina de estados de nome (saudar/aguardando_nome/coletar_nome) foi REMOVIDA.
- O cérebro INSERE a resposta (1 linha por parte) e devolve `mensagens[]`; o worker SÓ ENVIA
  cada parte, nunca insere de novo — elimina a inserção dupla que existia antes.
- Handover: quando o cérebro sinaliza [[HANDOVER]], o texto do próprio cérebro é enviado ao
  lead, a conversa é marcada `awaiting_human` e o responsável de `modulo='academia_enem'` é
  notificado (mesmo padrão do Institucional em `meta_adapter_inbound._chamar_motor_agente`). O
  atalho de segurança `_quer_humano` (pedido explícito de humano, ANTES de chamar o cérebro)
  usa a mensagem fixa de confirmação via `acionar_transbordo`.
- Persistência ainda em `conversas`/`mensagens` compartilhadas NESTA etapa; a troca para
  `ae_conversas`/`ae_mensagens` (isolamento total, decisão 4 da S-AE-16) é feita na task 4
  (desvio na entrada), num deploy coordenado.
- Envio via `meta_adapter_outbound._meta_enviar` (Graph API), o mesmo adapter dos demais canais.
- Serviço `cuca-academia-enem` (S-AE-02), credenciais Meta próprias
  (`META_SYSTEM_USER_TOKEN` = token da BM da Academia Enem).
"""

import os
import asyncio
import logging
from datetime import datetime, timezone

from supabase import create_client, Client

logger = logging.getLogger("academia_enem_engine")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# S-AE-06: expressões de pedido explícito de humano (detecção por substring, igual
# empregabilidade_engine._CONTAINS_HANDOVER). Atalho de segurança: encaminha ao transbordo
# ANTES de chamar o cérebro, garantindo que "quero falar com humano" nunca dependa do LLM.
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
_FALLBACK_TECNICO = "Ih, deu um problema técnico aqui do meu lado 😅 Pode mandar de novo pra mim?"


def _quer_humano(texto: str) -> bool:
    t = (texto or "").strip().lower()
    return any(p in t for p in _CONTAINS_HANDOVER)


# ---------------------------------------------------------------------------
# Roteamento (S-AE-16) — chama a Edge Function PRÓPRIA da Academia Enem
# (academia-enem-agente), nunca o motor-agente compartilhado. Isolamento total: Edge Function,
# RAG e persona próprios. O cérebro insere a(s) mensagem(ns); o worker só envia.
# ---------------------------------------------------------------------------

async def _chamar_academia_enem_agente(mensagem: str, telefone: str, conversa_id: str, lead_id: str) -> dict | None:
    """Chama a Edge Function EXCLUSIVA da Academia Enem — nunca o motor-agente compartilhado.
    Retorna {"mensagens": list[str], "handover": bool, "encerrado": bool} ou None em qualquer
    falha (HTTP, rede, erro reportado). `mensagens` é a resposta já dividida em 1+ partes
    (S-AE-16 task 1); cai pra `[resposta]` se o campo vier ausente/mal formado (compat)."""
    import httpx  # noqa: PLC0415

    url = f"{SUPABASE_URL}/functions/v1/academia-enem-agente"
    body = {"mensagem": mensagem, "telefone": telefone, "conversa_id": conversa_id, "lead_id": lead_id}
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            resp = await client.post(
                url,
                headers={"Authorization": f"Bearer {SUPABASE_KEY}", "Content-Type": "application/json"},
                json=body,
            )
        if not resp.is_success:
            logger.error(f"[AE engine] academia-enem-agente HTTP {resp.status_code}: {resp.text[:200]}")
            return None
        data = resp.json()
        if not data.get("success"):
            logger.error(f"[AE engine] academia-enem-agente retornou erro: {data.get('error')}")
            return None
        mensagens = data.get("mensagens")
        if not (isinstance(mensagens, list) and mensagens and all(isinstance(m, str) and m for m in mensagens)):
            resposta = data.get("resposta")
            mensagens = [resposta] if resposta else []
        return {
            "mensagens": mensagens,
            "handover": bool(data.get("handover")),
            "encerrado": bool(data.get("encerrado")),
        }
    except Exception as exc:
        logger.error(f"[AE engine] Erro ao chamar academia-enem-agente: {type(exc).__name__}: {exc}")
        return None


async def classificar(conversa_id: str, phone_number_id: str, telefone: str, lead_id: str, texto: str) -> None:
    """S-AE-16 — chama a Edge Function exclusiva `academia-enem-agente` e despacha a resposta,
    espelhando o padrão do Institucional (`_chamar_motor_agente` + loop de envio):

    - O cérebro JÁ GRAVOU cada parte no histórico — o worker SÓ ENVIA (gravar=False).
    - Handover: envia o texto do próprio cérebro, marca `awaiting_human` e notifica o
      responsável de `modulo='academia_enem'` (não usa a mensagem fixa — essa é só do atalho
      explícito `_quer_humano`, em que o cérebro nem é chamado).
    - Sem resposta do cérebro: fallback técnico (aí sim gravado, porque o cérebro não gravou)."""
    resultado = await _chamar_academia_enem_agente(texto, telefone, conversa_id, lead_id)

    if not resultado or not resultado["mensagens"]:
        await _enviar(conversa_id, phone_number_id, telefone, _FALLBACK_TECNICO, lead_id)
        return

    if resultado["handover"]:
        await _marcar_awaiting_e_notificar(conversa_id, phone_number_id, telefone, lead_id)
    elif resultado["encerrado"]:
        await asyncio.to_thread(_atualizar_status, conversa_id, "encerrada")

    # Envia 1 parte por vez, na ordem. O cérebro já inseriu cada parte → gravar=False (sem
    # inserção dupla). Aborta as restantes na 1ª falha de envio (mesma regra do Institucional:
    # sem retry, sem mandar fora de ordem).
    for parte in resultado["mensagens"]:
        enviado = await _enviar(conversa_id, phone_number_id, telefone, parte, lead_id, gravar=False)
        if not enviado:
            logger.error("[AE engine] Falha ao enviar parte da resposta — abortando as restantes (conversa %s)", conversa_id)
            break


# ---------------------------------------------------------------------------
# I/O — status da conversa (`conversas`, compartilhada nesta etapa).
# ---------------------------------------------------------------------------

def _atualizar_status(conversa_id: str, status: str) -> None:
    supabase.table("ae_conversas").update(
        {"status": status, "updated_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", conversa_id).execute()


def _ultima_mensagem_lead(conversa_id: str) -> tuple[str, str]:
    """Retorna (remetente, conteudo) da última mensagem da conversa (ae_mensagens — isolamento
    total, decisão 4 da S-AE-16)."""
    res = (
        supabase.table("ae_mensagens")
        .select("remetente, conteudo")
        .eq("ae_conversa_id", conversa_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    ultima = (res.data or [{}])[0]
    return ultima.get("remetente", ""), ultima.get("conteudo") or ""


# ---------------------------------------------------------------------------
# Envio via Meta (Graph API, mesmo adapter dos demais canais diretos).
# `gravar=True` grava em `mensagens` (mensagens geradas pelo worker: fallback, transbordo).
# `gravar=False` só envia (respostas do cérebro, que ele já gravou — evita inserção dupla).
# ---------------------------------------------------------------------------

async def _enviar(
    conversa_id: str,
    phone_number_id: str,
    telefone: str,
    texto: str,
    lead_id: str = "",
    gravar: bool = True,
) -> bool:
    """Envia texto via Meta. Se `gravar`, grava em `ae_mensagens` (remetente='agente';
    isolamento total, decisão 4 da S-AE-16 — tabela SEM coluna `lead_id`, diferente de
    `mensagens`). Retorna True só se enviou de fato — evita "consumir" a mensagem sem o lead
    receber quando a Graph API falha."""
    from meta_adapter_outbound import _meta_enviar  # noqa: PLC0415

    token = os.getenv("META_SYSTEM_USER_TOKEN", "")
    ok = await _meta_enviar(phone_number_id, telefone, texto, token)
    if not ok:
        return False

    if gravar:
        try:
            supabase.table("ae_mensagens").insert({
                "ae_conversa_id": conversa_id,
                "remetente": "agente",
                "tipo": "text",
                "conteudo": texto,
            }).execute()
        except Exception as exc:
            logger.error("[AE engine] Falha ao gravar mensagem da IA (conversa %s): %s", conversa_id, exc, exc_info=True)
    return True


# ---------------------------------------------------------------------------
# Transbordo (S-AE-06) — reaproveita `_notificar_transbordo` (genérico, já filtra por
# `modulo='academia_enem'`). NÃO cria tabela nova: usa `transbordo_humano`.
# ---------------------------------------------------------------------------

async def _marcar_awaiting_e_notificar(
    conversa_id: str,
    phone_number_id: str,
    telefone: str,
    lead_id: str = "",
) -> None:
    """Handover sinalizado PELO CÉREBRO ([[HANDOVER]]): marca `awaiting_human` e notifica o
    responsável de `modulo='academia_enem'`. NÃO envia mensagem fixa (o texto do próprio cérebro
    é enviado por `classificar`, mesmo padrão do Institucional) e NÃO reverte o status se a
    notificação falhar — o lead pediu humano; deixar a IA voltar a responder seria pior. Só loga.
    Status vive em `ae_conversas` (isolamento total, decisão 4 da S-AE-16)."""
    try:
        await asyncio.to_thread(_atualizar_status, conversa_id, "awaiting_human")
    except Exception as exc:
        logger.error("[AE engine] Falha ao marcar awaiting_human (conversa %s): %s", conversa_id, exc, exc_info=True)
        return

    from meta_adapter_inbound import _notificar_transbordo  # noqa: PLC0415
    try:
        notificado = await _notificar_transbordo(conversa_id, "academia_enem", None, phone_number_id, telefone)
    except Exception as exc:
        logger.error("[AE engine] Erro ao notificar transbordo (conversa %s): %s", conversa_id, exc, exc_info=True)
        notificado = False

    if not notificado:
        logger.warning(
            "[AE engine] Handover do cérebro sem contato de transbordo configurado para "
            "modulo='academia_enem' (conversa %s) — conversa fica awaiting_human aguardando "
            "atendimento manual.", conversa_id,
        )


async def acionar_transbordo(
    conversa_id: str,
    phone_number_id: str,
    telefone: str,
    lead_id: str = "",
) -> bool:
    """Atalho de pedido EXPLÍCITO de humano (`_quer_humano`, antes de chamar o cérebro). Marca
    `awaiting_human`, notifica o responsável de `modulo='academia_enem'` e envia a mensagem fixa
    de confirmação. Reverte o status e avisa o lead se a notificação falhar — mesmo padrão de
    `empregabilidade_engine._acionar_transbordo_empregabilidade` (evita conversa "presa" em
    awaiting_human sem ninguém avisado)."""
    def _marcar_awaiting_human():
        supabase.table("ae_conversas").update(
            {"status": "awaiting_human", "updated_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", conversa_id).execute()

    def _restaurar_ativa():
        supabase.table("ae_conversas").update(
            {"status": "ativa", "updated_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", conversa_id).execute()

    try:
        await asyncio.to_thread(_marcar_awaiting_human)
    except Exception as exc:
        logger.error("[AE engine] Falha ao marcar awaiting_human (conversa %s): %s", conversa_id, exc, exc_info=True)
        return False

    from meta_adapter_inbound import _notificar_transbordo  # noqa: PLC0415
    try:
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
    logger.info("[AE engine] Transbordo (pedido explícito) acionado com sucesso (conversa %s)", conversa_id)
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

    # 2) Pedido explícito de humano tem prioridade e nem passa pelo cérebro (atalho de segurança).
    if _quer_humano(texto):
        await acionar_transbordo(conversa_id, phone_number_id, phone, lead_id)
        return

    # 3) Todo o resto vai DIRETO ao cérebro (sem etapa de nome, igual Institucional).
    await classificar(conversa_id, phone_number_id, phone, lead_id, texto)
