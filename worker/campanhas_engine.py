import os
import time
import random
import asyncio
import logging
from datetime import datetime, timezone
from supabase import create_client, Client
import httpx

logger = logging.getLogger("campanhas_engine")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
UAZAPI_URL = os.getenv("UAZAPI_BASE_URL", "https://uazapi.com.br")


def _get_config_sync(key: str, default_val: int) -> int:
    """Lê configuração do banco (síncrono - deve ser chamado via asyncio.to_thread)."""
    try:
        res = supabase.table("configuracoes").select("valor").eq("chave", key).execute()
        if res.data and len(res.data) > 0 and res.data[0].get("valor") is not None:
            return int(res.data[0]["valor"])
    except Exception as e:
        logger.warning(f"Erro ao ler config {key}: {e}")
    return default_val


async def get_config(key: str, default_val: int) -> int:
    """Lê configuração sem bloquear o event loop."""
    return await asyncio.to_thread(_get_config_sync, key, default_val)


def _query_db_sync(tabela: str, status: str):
    """Query síncrona - deve ser chamada via asyncio.to_thread."""
    return supabase.table(tabela).select("*").eq("status", status).is_("disparo_id", "null").execute()


def _update_db_sync(tabela: str, item_id: str, dados: dict):
    """Update síncrono - deve ser chamado via asyncio.to_thread."""
    return supabase.table(tabela).update(dados).eq("id", item_id).execute()


def _query_instancia_sync(unidade: str):
    """Busca instância UAZAPI Institucional ativa vinculada à unidade."""
    return (
        supabase.table("instancias_uazapi")
        .select("nome, token, warmup_started_at")
        .eq("unidade_cuca", unidade)
        .eq("canal_tipo", "Institucional")
        .eq("ativa", True)
        .eq("reserva", False)
        .limit(1)
        .execute()
    )


def _calcular_limite_warmup(warmup_started_at: str | None, global_limit: int) -> int:
    """
    Progressão de warm-up por instância (PLANO S8-06):
      Semana 1 (0-7d):   50 msgs/dia
      Semana 2 (8-14d):  150 msgs/dia
      Semana 3 (15-21d): 500 msgs/dia
      Semana 4 (22-28d): 1500 msgs/dia
      Semana 5+ (29d+):  usa o limite global do banco (sem restrição de warmup)
    """
    if not warmup_started_at:
        # Sem warmup registrado: aplica limite conservador da semana 1
        logger.warning("[Warmup] warmup_started_at não definido — aplicando limite conservador (50/dia).")
        return 50

    try:
        from datetime import datetime, timezone
        # Supabase retorna ISO string; parsear com ou sem 'Z'
        ts = warmup_started_at.replace("Z", "+00:00")
        started = datetime.fromisoformat(ts)
        dias = (datetime.now(timezone.utc) - started).days

        if dias < 8:   return 50
        if dias < 15:  return 150
        if dias < 22:  return 500
        if dias < 29:  return 1500
        return global_limit  # warmup concluído
    except Exception as e:
        logger.warning(f"[Warmup] Erro ao calcular limite: {e} — usando 50/dia.")
        return 50


def _query_leads_sync(unidade: str | None = None):
    """Busca leads com opt_in ativo, filtrados pela unidade da campanha."""
    query = (
        supabase.table("leads")
        .select("telefone, nome")
        .eq("opt_in", True)
        .eq("bloqueado", False)
    )
    # Bug 2 corrigido: filtrar por unidade para não vazar mensagens entre unidades
    if unidade:
        query = query.eq("unidade_cuca", unidade)
    return query.execute()


async def processar_item_disparo(item: dict, origem: str, delay_min: int, delay_max: int, daily_limit: int, error_threshold: int):
    """Processa e dispara mensagem para um evento aprovado."""
    item_id = item.get("id")
    # Bug extra corrigido: campo real é unidade_cuca (não unidade_cuca_id nem unidade_id)
    unidade = item.get("unidade_cuca") or item.get("unidade_cuca_id") or item.get("unidade_id")
    template_texto = item.get("template_texto") or item.get("titulo") or item.get("descricao") or "Olá, {{nome}}!"
    midia_url = item.get("midia_url") or item.get("flyer_url")

    # Marcar como em andamento (em thread separada para não bloquear)
    await asyncio.to_thread(_update_db_sync, origem, item_id, {"status": "em_andamento"})

    # Buscar instância UAZAPI
    inst_res = await asyncio.to_thread(_query_instancia_sync, unidade)
    if not inst_res.data:
        logger.error(f"Nenhuma instância UAZAPI Institucional ativa para unidade '{unidade}'. Pausando item {item_id}.")
        await asyncio.to_thread(_update_db_sync, origem, item_id, {"status": "pausada"})
        return

    instance_name = inst_res.data[0]["nome"]
    inst_token = inst_res.data[0]["token"]
    warmup_started = inst_res.data[0].get("warmup_started_at")

    # Limitão diária por instância (warm-up individual, não global)
    inst_daily_limit = _calcular_limite_warmup(warmup_started, daily_limit)
    logger.info(f"[Warmup] '{instance_name}': limite hoje = {inst_daily_limit} msgs (warmup_started={warmup_started})")

    # Buscar leads da unidade com opt_in
    leads_res = await asyncio.to_thread(_query_leads_sync, unidade)
    leads = leads_res.data or []
    total = len(leads)

    if total == 0:
        logger.info(f"Item {item_id}: Sem leads para disparar. Marcando como concluída.")
        await asyncio.to_thread(_update_db_sync, origem, item_id, {
            "status": "concluida",
            "disparo_id": f"DISP-{int(time.time())}"
        })
        return

    logger.info(f"Item {item_id} ({origem}): Disparando para {total} leads | Delay: {delay_min}-{delay_max}ms")

    sucessos = 0
    erros = 0

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            for i, lead in enumerate(leads):
                if i >= inst_daily_limit:
                    logger.warning(f"Limite warm-up diário da instância atingido ({inst_daily_limit}). Pausando.")                    
                    break

                # Delay aleatório anti-ban
                sleep_time = random.uniform(delay_min / 1000.0, delay_max / 1000.0)
                await asyncio.sleep(sleep_time)

                nome_lead = lead.get("nome") or "cidadão"
                texto = template_texto.replace("{{nome}}", nome_lead)

                try:
                    if midia_url:
                        resp = await client.post(
                            f"{UAZAPI_URL}/message/sendMedia/{instance_name}",
                            headers={"apikey": inst_token, "Content-Type": "application/json"},
                            json={
                                "number": lead["telefone"],
                                "options": {"delay": 1200, "presence": "composing"},
                                "mediaMessage": {
                                    "mediatype": "image",
                                    "caption": texto,
                                    "media": midia_url
                                }
                            }
                        )
                    else:
                        resp = await client.post(
                            f"{UAZAPI_URL}/message/sendText/{instance_name}",
                            headers={"apikey": inst_token, "Content-Type": "application/json"},
                            json={
                                "number": lead["telefone"],
                                "options": {"delay": 1200, "presence": "composing"},
                                "textMessage": {"text": texto}
                            }
                        )

                    if resp.status_code == 200:
                        sucessos += 1
                    else:
                        erros += 1
                        logger.warning(f"UAZAPI HTTP {resp.status_code} para {lead['telefone']}")

                except Exception as req_err:
                    erros += 1
                    logger.error(f"Erro request UAZAPI: {str(req_err)}")

                # Monitorar taxa de erro anti-ban
                if (i + 1) > 5:
                    taxa_erro = (erros / (i + 1)) * 100
                    if taxa_erro > error_threshold:
                        logger.error(f"ALERTA: Taxa de erro {taxa_erro:.1f}% > {error_threshold}%. Pausando!")
                        await asyncio.to_thread(_update_db_sync, origem, item_id, {"status": "pausada"})
                        return

        # Finalizar disparo com sucesso
        await asyncio.to_thread(_update_db_sync, origem, item_id, {
            "status": "concluida",
            "disparo_id": f"DISP-{int(time.time())}"
        })
        logger.info(f"Disparo {item_id} concluído. Sucessos: {sucessos} | Erros: {erros}")

    except Exception as exc:
        logger.error(f"Falha fatal em processar_item_disparo: {str(exc)}")
        await asyncio.to_thread(_update_db_sync, origem, item_id, {"status": "pausada"})


async def campanhas_loop():
    """Loop principal: checa aprovações a cada 30s sem bloquear o event loop."""
    logger.info("Iniciando Motor de Campanhas e Anti-Ban...")

    # Aguarda 5s após startup para deixar o servidor estabilizar
    await asyncio.sleep(5)

    while True:
        try:
            # Ler configurações anti-ban
            delay_min = await get_config("anti_ban_delay_min", 2000)
            delay_max = await get_config("anti_ban_delay_max", 5000)
            daily_limit = await get_config("anti_ban_daily_limit", 500)
            error_threshold = await get_config("anti_ban_error_threshold", 10)

            # 1. Programação Pontual (aprovada pelo Gerente da Unidade)
            res_pontuais = await asyncio.to_thread(_query_db_sync, "eventos_pontuais", "aprovado")
            for evento in (res_pontuais.data or []):
                await processar_item_disparo(evento, "eventos_pontuais", delay_min, delay_max, daily_limit, error_threshold)

            # 2. Programação Mensal (aprovada pela Comissão/Excel)
            res_mensais = await asyncio.to_thread(_query_db_sync, "campanhas_mensais", "aprovado")
            for mensal in (res_mensais.data or []):
                await processar_item_disparo(mensal, "campanhas_mensais", delay_min, delay_max, daily_limit, error_threshold)

            # 3. Ouvidoria (aprovada pelo Super Admin CUCA)
            res_ouvidoria = await asyncio.to_thread(_query_db_sync, "ouvidoria_eventos", "aprovado")
            for ouv in (res_ouvidoria.data or []):
                await processar_item_disparo(ouv, "ouvidoria_eventos", delay_min, delay_max, daily_limit, error_threshold)

        except Exception as e:
            logger.error(f"Erro no loop de disparos: {str(e)}")

        # Aguarda 30 segundos antes da próxima verificação
        await asyncio.sleep(30)
