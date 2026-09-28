"""Registro de consumo de LLM por chamada em `ai_usage_logs` (PLANO-023, frente custo-llm).

Uma linha por chamada à OpenAI feita pelo worker: tokens de entrada, tokens em cache, tokens de
saída, custo real em US$ (`custo_usd`, com o preço do modelo) e a funcionalidade (`feature`).
É o mesmo registro que o `motor-agente` grava para o Institucional; juntos, alimentam o painel
Developer → Consumo.

Regras de desenho:
- NUNCA levanta exceção e NUNCA atrasa quem chamou. A gravação vai para uma fila própria (um
  pool de 2 threads), então funciona igual em código síncrono (`category_extractor`) e assíncrono,
  sem bloquear o event loop — o cliente Supabase em Python é síncrono.
- `tokens_total` e `custo_estimado_usd` são colunas GERADAS no banco: nunca são enviadas.
- Preço vem de `system_config.openai_precos_usd_por_milhao` (JSON em texto), com cache de 10 min.
  Sem preço configurado para o modelo, o custo fica NULL — nunca um valor chutado.
- Sem SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY no ambiente (ex.: testes), não faz nada.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any

logger = logging.getLogger("llm_usage")

_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="llm-usage")
_lock = threading.Lock()
_cliente = None
_precos: dict | None = None
_precos_expira_em = 0.0
_PRECOS_TTL_S = 600


def _supabase():
    global _cliente
    if _cliente is not None:
        return _cliente
    url = os.getenv("SUPABASE_URL")
    chave = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not chave:
        return None
    with _lock:
        if _cliente is None:
            from supabase import create_client  # noqa: PLC0415
            _cliente = create_client(url, chave)
    return _cliente


def _carregar_precos(sb) -> dict | None:
    global _precos, _precos_expira_em
    if time.monotonic() < _precos_expira_em:
        return _precos
    valor = None
    try:
        res = sb.table("system_config").select("valor").eq("chave", "openai_precos_usd_por_milhao").limit(1).execute()
        if res.data:
            valor = json.loads(res.data[0]["valor"])
    except Exception as exc:  # noqa: BLE001
        logger.warning("[llm_usage] Tabela de preços ilegível — custo fica NULL: %s", exc)
    _precos, _precos_expira_em = valor, time.monotonic() + _PRECOS_TTL_S
    return valor


def calcular_custo_usd(modelo: str, tokens_prompt: int, tokens_cached: int, tokens_completion: int,
                       precos: dict | None) -> float | None:
    """Mesmo cálculo do motor-agente: a chave de preço mais longa que casa como prefixo do modelo
    devolvido pela OpenAI (que vem com data, ex. "gpt-4o-mini-2024-07-18")."""
    if not precos or not modelo:
        return None
    candidatas = [k for k in precos if modelo == k or modelo.startswith(k + "-")]
    if not candidatas:
        return None
    p = precos[max(candidatas, key=len)]
    return ((tokens_prompt - tokens_cached) * p["in"] + tokens_cached * p["cached_in"]
            + tokens_completion * p["out"]) / 1_000_000


def _extrair(resposta: Any) -> dict:
    usage = getattr(resposta, "usage", None)
    detalhes = getattr(usage, "prompt_tokens_details", None) if usage is not None else None
    return {
        "modelo": str(getattr(resposta, "model", "") or ""),
        "openai_request_id": getattr(resposta, "id", None),
        "tokens_prompt": int(getattr(usage, "prompt_tokens", 0) or 0) if usage is not None else 0,
        "tokens_completion": int(getattr(usage, "completion_tokens", 0) or 0) if usage is not None else 0,
        "tokens_prompt_cached": int(getattr(detalhes, "cached_tokens", 0) or 0) if detalhes is not None else 0,
    }


def _gravar(linha: dict) -> None:
    try:
        sb = _supabase()
        if sb is None:
            return
        linha["custo_usd"] = calcular_custo_usd(
            linha["modelo"], linha["tokens_prompt"], linha["tokens_prompt_cached"],
            linha["tokens_completion"], _carregar_precos(sb),
        )
        sb.table("ai_usage_logs").insert(linha).execute()
    except Exception as exc:  # noqa: BLE001
        logger.warning("[llm_usage] Falha ao gravar consumo (%s): %s", linha.get("feature"), exc)


def registrar_uso(resposta: Any, *, feature: str, modelo: str | None = None,
                  conversa_id: str | None = None, agente_tipo: str | None = None,
                  blocos: dict | None = None, inicio: float | None = None) -> None:
    """Agenda a gravação de uma chamada à OpenAI. Chamar logo depois da resposta, antes de
    qualquer processamento que possa falhar. Nunca levanta e volta na hora.

    `modelo` só é necessário quando a resposta não informa o modelo (ex.: transcrição de áudio).
    `inicio` (time.monotonic() antes da chamada) é opcional e vira `latencia_ms`.
    """
    try:
        if os.getenv("SUPABASE_URL") is None:
            return
        dados = _extrair(resposta)
        if modelo and not dados["modelo"]:
            dados["modelo"] = modelo
        linha = {
            **dados,
            "feature": feature,
            "agente_tipo": agente_tipo,
            "conversa_id": conversa_id,
            "blocos_contexto": blocos,
            "latencia_ms": int((time.monotonic() - inicio) * 1000) if inicio else None,
        }
        _executor.submit(_gravar, linha)
    except Exception as exc:  # noqa: BLE001
        logger.warning("[llm_usage] Falha ao preparar registro de consumo (%s): %s", feature, exc)
