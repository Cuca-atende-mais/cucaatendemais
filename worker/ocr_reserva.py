"""Reserva atômica do processamento de currículo (PLANO-028, frente custo-llm).

O loop `ocr_pending_loop` e o endpoint `POST /process-cv` podiam processar o mesmo currículo ao
mesmo tempo — pagando a análise de IA duas vezes e gravando um resultado arbitrário (a última
execução vencia). Agora os dois passam por aqui:

1. `reservar_ocr_candidatura` (função do banco): um UPDATE condicional que só um executor vence.
   Incrementa `ocr_tentativas` na mesma operação e devolve um token novo.
2. `process_cv_ocr(..., ocr_token=token)`: toda gravação na candidatura confere o token.
3. `finalizar_ocr_candidatura`: marca `ok`/`erro` — só vale para o dono da reserva. Roda em
   `finally`, então a reserva é liberada mesmo em exceção.

Quem perde a reserva não é erro: é outro executor trabalhando, candidatura já analisada ou teto de
tentativas atingido. Só loga e sai.
"""
from __future__ import annotations

import logging
import os
import socket

logger = logging.getLogger("ocr_reserva")

OCR_MAX_TENTATIVAS = 3


def _executor(origem: str) -> str:
    return f"{socket.gethostname()}:{os.getpid()}:{origem}"


def reservar(supabase, candidatura_id: str, origem: str, max_tentativas: int = OCR_MAX_TENTATIVAS) -> str | None:
    """Devolve o token da reserva, ou None se este executor não ganhou."""
    res = supabase.rpc("reservar_ocr_candidatura", {
        "p_candidatura_id": candidatura_id,
        "p_executor": _executor(origem),
        "p_max_tentativas": max_tentativas,
    }).execute()
    return res.data or None


def finalizar(supabase, candidatura_id: str, token: str, sucesso: bool) -> bool:
    res = supabase.rpc("finalizar_ocr_candidatura", {
        "p_candidatura_id": candidatura_id,
        "p_token": token,
        "p_status": "ok" if sucesso else "erro",
    }).execute()
    return bool(res.data)


async def processar_cv_com_reserva(candidatura_id: str, cv_url: str, vaga_id: str,
                                   cargo_escolhido: str = "", origem: str = "endpoint") -> bool:
    """Reserva, processa e fecha a reserva. Devolve True só se o resultado foi gravado."""
    from cv_processor import process_cv_ocr, supabase  # noqa: PLC0415
    try:
        token = reservar(supabase, candidatura_id, origem)
    except Exception as exc:  # noqa: BLE001
        logger.error(f"[ocr-reserva] Falha ao reservar {candidatura_id} ({origem}): {exc}")
        return False
    if not token:
        logger.info(f"[ocr-reserva] {candidatura_id} não reservada ({origem}): em processamento, já analisada ou no teto")
        return False

    sucesso = False
    try:
        sucesso = await process_cv_ocr(candidatura_id, cv_url, vaga_id, cargo_escolhido, ocr_token=token)
        return sucesso
    finally:
        try:
            if not finalizar(supabase, candidatura_id, token, sucesso):
                logger.warning(f"[ocr-reserva] Reserva de {candidatura_id} já não era deste executor ao finalizar")
        except Exception as exc:  # noqa: BLE001
            logger.error(f"[ocr-reserva] Falha ao finalizar reserva de {candidatura_id}: {exc}")
