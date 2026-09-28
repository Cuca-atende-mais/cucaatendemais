"""Limite de respostas de IA por conversa (ACHADO-016, frente custo-llm).

Protege contra quem manda mensagens sem parar (pessoa ou robô) e limita o pior caso de um disparo
em massa: acima de N respostas de IA na última hora (ou M no dia) na mesma conversa, o lead recebe
uma resposta pronta em vez de uma nova chamada à OpenAI.

- Conta as respostas de IA pelo registro de consumo (`ai_usage_logs`, feature "chat", gravado pelo
  motor-agente com `conversa_id`) — respostas prontas e menus não contam.
- Limites e texto em `system_config` (editáveis sem deploy): `ia_limite_por_hora`,
  `ia_limite_por_dia`, `ia_limite_mensagem`. Valores decididos em 28/09/2026: 20/h e 40/dia, acima
  do máximo real medido de 13/h e 17/dia por pessoa (12 a 28/09).
- Falha aberta: qualquer erro aqui atende normalmente. O limite nunca bloqueia por defeito.
- Não repete o aviso: se a última mensagem do agente já foi o aviso, fica em silêncio.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timedelta, timezone

logger = logging.getLogger("limite_ia")

PADRAO = {
    "ia_limite_por_hora": "20",
    "ia_limite_por_dia": "40",
    "ia_limite_mensagem": (
        "Recebi várias mensagens seguidas por aqui! 😊 Para te ajudar melhor, espera um pouquinho e "
        "me manda de novo daqui a alguns minutos. Se preferir, as informações também estão no Portal "
        "da Juventude: portaldajuventude.fortaleza.ce.gov.br"
    ),
}
_TTL_S = 600
_cache: dict = {"valor": None, "expira": 0.0}


def _config(supabase) -> dict:
    if _cache["valor"] is not None and time.monotonic() < _cache["expira"]:
        return _cache["valor"]
    cfg = dict(PADRAO)
    try:
        res = supabase.table("system_config").select("chave, valor").in_("chave", list(PADRAO)).execute()
        for linha in res.data or []:
            if linha.get("valor"):
                cfg[linha["chave"]] = linha["valor"]
    except Exception as exc:  # noqa: BLE001
        logger.warning("[limite-ia] Configuração ilegível, usando o padrão: %s", exc)
    _cache.update(valor=cfg, expira=time.monotonic() + _TTL_S)
    return cfg


def _contar_respostas_ia(supabase, conversa_id: str, desde: datetime) -> int:
    res = (supabase.table("ai_usage_logs").select("id", count="exact")
           .eq("conversa_id", conversa_id).eq("feature", "chat")
           .gte("created_at", desde.isoformat()).limit(1).execute())
    return int(res.count or 0)


def mensagem_se_excedeu(supabase, conversa_id: str) -> str | None:
    """Devolve o texto do aviso se a conversa passou do limite (e o aviso ainda não foi o último
    envio); "" se passou mas o aviso já foi dado (ficar em silêncio); None se está dentro do limite
    ou se a checagem falhou."""
    try:
        cfg = _config(supabase)
        agora = datetime.now(timezone.utc)
        por_hora = _contar_respostas_ia(supabase, conversa_id, agora - timedelta(hours=1))
        excedeu = por_hora >= int(cfg["ia_limite_por_hora"])
        if not excedeu:
            por_dia = _contar_respostas_ia(supabase, conversa_id, agora - timedelta(days=1))
            excedeu = por_dia >= int(cfg["ia_limite_por_dia"])
        if not excedeu:
            return None
        texto = cfg["ia_limite_mensagem"]
        ultima = (supabase.table("mensagens").select("conteudo, remetente").eq("conversa_id", conversa_id)
                  .order("created_at", desc=True).limit(1).execute())
        linha = (ultima.data or [{}])[0]
        if linha.get("remetente") == "agente" and linha.get("conteudo") == texto:
            return ""
        logger.info("[limite-ia] Conversa %s passou do limite de respostas de IA — resposta pronta", conversa_id)
        return texto
    except Exception as exc:  # noqa: BLE001
        logger.warning("[limite-ia] Falha na checagem (atendendo normalmente): %s", exc)
        return None
