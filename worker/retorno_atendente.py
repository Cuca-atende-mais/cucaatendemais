"""Hotfix 05/11/2026 — conversa do Institucional parada em "aguardando atendente" volta para o bot
quando ninguém da equipe responde em 30 minutos.

Por quê: com o volume da abertura das inscrições (03-04/11), a equipe não deu conta das
transferências e o cidadão ficava horas sem resposta, porque o worker descarta toda mensagem que
chega numa conversa `awaiting_human`. Decisão do Junior (05/11): sem resposta do atendente em 30
minutos, a conversa volta para o bot.

Como decide (sem coluna nova no banco):
- Enquanto a conversa está `awaiting_human` o bot não fala; logo, toda mensagem `remetente='agente'`
  depois da transferência é de uma pessoa da equipe (o portal grava assim).
- "Pendente" = mensagens do lead depois da última mensagem `agente` (da transferência ou do
  atendente). Se a mais antiga delas tem 30 minutos ou mais, a equipe não respondeu.
- Só dentro da janela de 24h da Meta (texto livre só vale até 24h depois da última mensagem do
  lead); usamos 23h de margem. Fora disso a conversa fica como está.
- Só Institucional/maria pelo canal Meta. Empregabilidade, Ouvidoria e Acesso CUCA ficam de fora.

Ao devolver: troca o status para `ativa` só se ainda estiver `awaiting_human` (se alguém assumiu
no meio do caminho, nada acontece), manda um aviso curto e passa as mensagens pendentes pelo mesmo
caminho de sempre (`_executar_dispatch`, com o debounce por conversa).
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)

MINUTOS_SEM_RESPOSTA = int(os.getenv("RETORNO_BOT_MINUTOS", "30"))
INTERVALO_LOOP_SEGUNDOS = 120
JANELA_META_HORAS = 23
AGENTES_COM_RETORNO = ("Institucional", "maria")
AVISO_RETORNO = "Nossa equipe ainda não conseguiu te responder por aqui 😕 Enquanto isso, sigo te ajudando!"
PEDIDO_TEXTO = "Me conta em texto o que você precisa que eu te ajudo 😊"


def _como_datetime(valor: str) -> datetime:
    return datetime.fromisoformat(valor.replace("Z", "+00:00"))


def mensagens_pendentes(mensagens: list[dict], agora: datetime, ligado_em: datetime | None = None) -> list[dict] | None:
    """Mensagens do lead que esperam resposta da equipe há `MINUTOS_SEM_RESPOSTA` ou mais.

    `mensagens` vem em ordem cronológica. Devolve None quando não há nada a fazer: última mensagem
    é da equipe/bot, ainda não deu o tempo, a mais recente do lead já saiu da janela da Meta, ou a
    conversa JÁ estava passada do prazo quando o worker ligou (`ligado_em`).

    Esse último caso é decisão do Junior (05/11, revisão do @qa): quem já estava esperando no
    momento do deploy fica com a equipe, que responde e libera para a IA pelo portal. Só quem entra
    em transbordo depois de o worker ligar segue a regra dos 30 minutos.
    """
    pendentes: list[dict] = []
    for m in reversed(mensagens):
        if m.get("remetente") == "lead":
            pendentes.append(m)
        else:
            break
    if not pendentes:
        return None
    pendentes.reverse()
    mais_antiga = _como_datetime(pendentes[0]["created_at"])
    mais_recente = _como_datetime(pendentes[-1]["created_at"])
    if agora - mais_antiga < timedelta(minutes=MINUTOS_SEM_RESPOSTA):
        return None
    if agora - mais_recente > timedelta(hours=JANELA_META_HORAS):
        return None
    if ligado_em is not None and mais_antiga + timedelta(minutes=MINUTOS_SEM_RESPOSTA) <= ligado_em:
        return None
    return pendentes


def texto_para_o_bot(pendentes: list[dict]) -> str:
    """Junta o texto das mensagens pendentes (só as de texto; imagem/figurinha não entram)."""
    return "\n".join(
        (m.get("conteudo") or "").strip()
        for m in pendentes
        if m.get("tipo", "text") == "text" and (m.get("conteudo") or "").strip()
    )


async def devolver_conversa_ao_bot(conversa: dict, pendentes: list[dict], supabase) -> bool:
    """Devolve UMA conversa ao bot. True quando devolveu."""
    from meta_adapter_inbound import (  # noqa: PLC0415
        _agendar_dispatch_debounced,
        _executar_dispatch,
        _get_instancia_by_phone_number_id,
    )
    from meta_adapter_outbound import _meta_enviar  # noqa: PLC0415

    conversa_id = conversa["id"]
    res = supabase.table("conversas").update(
        {"status": "ativa", "updated_at": "now()"}
    ).eq("id", conversa_id).eq("status", "awaiting_human").execute()
    if not res.data:
        logger.info("[retorno-bot] Conversa %s já não estava aguardando atendente — nada feito", conversa_id)
        return False

    lead = supabase.table("leads").select("telefone").eq("id", conversa["lead_id"]).single().execute()
    telefone = (lead.data or {}).get("telefone")
    phone_number_id = conversa.get("origem_id") or ""
    instancia = _get_instancia_by_phone_number_id(phone_number_id)
    if not telefone or not instancia:
        logger.error("[retorno-bot] Conversa %s sem telefone ou canal ativo — devolvida sem resposta", conversa_id)
        return True

    token = os.getenv("META_SYSTEM_USER_TOKEN", "")
    texto = texto_para_o_bot(pendentes)
    aviso = AVISO_RETORNO if texto else AVISO_RETORNO + " " + PEDIDO_TEXTO
    enviado_em = datetime.now(timezone.utc).isoformat()
    await _meta_enviar(phone_number_id, telefone, aviso, token)
    # Gravado com o horário do envio, mas só DEPOIS da resposta do bot: o motor lê o histórico e
    # precisa ver a pergunta pendente como a última coisa dita, não o aviso.
    def _gravar_aviso() -> None:
        supabase.table("mensagens").insert({
            "conversa_id": conversa_id,
            "lead_id": conversa["lead_id"],
            "tipo": "text",
            "conteudo": aviso,
            "remetente": "agente",
            "created_at": enviado_em,
        }).execute()

    logger.info(
        "[retorno-bot] Conversa %s devolvida ao bot após %d min sem resposta da equipe (%d mensagem(ns) pendente(s))",
        conversa_id, MINUTOS_SEM_RESPOSTA, len(pendentes),
    )
    if not texto:
        _gravar_aviso()
        return True

    contrato_v2 = {
        "canal_origem": instancia["canal_origem"],
        "telefone": telefone,
        "agente_tipo": instancia["agente_tipo"],
        "unidade_cuca": instancia.get("unidade_cuca"),
        "canal_tipo": instancia["canal_tipo"],
        "mensagem": texto,
        "midia_url": None,
        "midia_tipo": "text",
        "botao": None,
        "data_atual": datetime.now(timezone(timedelta(hours=-3))).strftime("%A, %d de %B de %Y, %H:%M"),
        "wamid": pendentes[-1].get("wamid") or "",
    }

    async def _dispatch() -> None:
        try:
            await _executar_dispatch(
                agente_tipo=instancia["agente_tipo"],
                contrato_v2=contrato_v2,
                conversa_id=conversa_id,
                lead_id=conversa["lead_id"],
                telefone=telefone,
                phone_number_id=phone_number_id,
                wamid=contrato_v2["wamid"],
                push_name="",
                midia_tipo="text",
                unidade_cuca=instancia.get("unidade_cuca"),
                mensagem=texto,
                supabase=supabase,
            )
        finally:
            _gravar_aviso()

    await _agendar_dispatch_debounced(conversa_id, _dispatch)
    return True


async def verificar_conversas_sem_resposta(supabase, agora: datetime | None = None, ligado_em: datetime | None = None) -> int:
    """Uma rodada: acha as conversas que estouraram o prazo e devolve ao bot. Devolve quantas.
    `ligado_em`: quando o loop começou — conversa que já estava passada do prazo nesse momento
    fica com a equipe (ver `mensagens_pendentes`)."""
    agora = agora or datetime.now(timezone.utc)
    desde = (agora - timedelta(hours=24)).isoformat()
    res = supabase.table("conversas").select("id, lead_id, origem_id, agente_tipo").eq(
        "status", "awaiting_human"
    ).eq("canal_ativo", "meta").in_("agente_tipo", list(AGENTES_COM_RETORNO)).gte(
        "updated_at", desde
    ).limit(200).execute()
    devolvidas = 0
    for conversa in res.data or []:
        try:
            msgs = supabase.table("mensagens").select(
                "remetente, conteudo, created_at, tipo, wamid"
            ).eq("conversa_id", conversa["id"]).order("created_at", desc=True).limit(30).execute()
            pendentes = mensagens_pendentes(list(reversed(msgs.data or [])), agora, ligado_em)
            if pendentes and await devolver_conversa_ao_bot(conversa, pendentes, supabase):
                devolvidas += 1
        except Exception as exc:
            logger.error("[retorno-bot] Erro na conversa %s: %s", conversa.get("id"), exc)
    return devolvidas


async def retorno_bot_loop() -> None:
    from meta_adapter_inbound import _get_supabase  # noqa: PLC0415

    ligado_em = datetime.now(timezone.utc)
    logger.info(
        "[retorno-bot] Loop iniciado (devolve ao bot após %d min sem resposta da equipe; quem já estava "
        "passado do prazo antes de %s fica com a equipe)", MINUTOS_SEM_RESPOSTA, ligado_em.isoformat(),
    )
    while True:
        try:
            await verificar_conversas_sem_resposta(_get_supabase(), ligado_em=ligado_em)
        except Exception as exc:
            logger.error("[retorno-bot] Erro na rodada: %s", exc)
        await asyncio.sleep(INTERVALO_LOOP_SEGUNDOS)
