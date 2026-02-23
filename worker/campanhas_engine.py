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

async def get_config(key: str, default_val: int) -> int:
    try:
        res = supabase.table("configuracoes").select("valor").eq("chave", key).execute()
        if res.data and len(res.data) > 0 and res.data[0].get("valor") is not None:
            return int(res.data[0]["valor"])
    except Exception as e:
        logger.warning(f"Erro ao ler config {key}: {e}")
    return default_val

async def campanhas_loop():
    logger.info("Iniciando Motor de Campanhas e Anti-Ban...")
    while True:
        try:
            # Ler configs de delay e error_threshold
            delay_min = await get_config("anti_ban_delay_min", 2000)
            delay_max = await get_config("anti_ban_delay_max", 5000)
            daily_limit = await get_config("anti_ban_daily_limit", 500)
            error_threshold = await get_config("anti_ban_error_threshold", 10)

            now_iso = datetime.now(timezone.utc).isoformat()
            
            # 1. Checar Campanhas Legadas
            res_camp = supabase.table("campanhas").select("*").in_("status", ["aprovada", "em_andamento"]).execute()
            for camp in res_camp.data:
                await processar_item_disparo(camp, "campanhas", delay_min, delay_max, daily_limit, error_threshold)

            # 2. Checar Programação Pontual (Aprovada)
            res_pontuais = supabase.table("eventos_pontuais").select("*").eq("status", "aprovado").is_("disparo_id", "null").execute()
            for evento in res_pontuais.data:
                await processar_item_disparo(evento, "eventos_pontuais", delay_min, delay_max, daily_limit, error_threshold)

            # 3. Checar Programação Mensal (Aprovada)
            res_mensais = supabase.table("campanhas_mensais").select("*").eq("status", "aprovado").is_("disparo_id", "null").execute()
            for mensal in res_mensais.data:
                await processar_item_disparo(mensal, "campanhas_mensais", delay_min, delay_max, daily_limit, error_threshold)

            # 4. Checar Ouvidoria (Super Admin)
            res_ouvidoria = supabase.table("ouvidoria_eventos").select("*").eq("status", "aprovado").is_("disparo_id", "null").execute()
            for ouv in res_ouvidoria.data:
                await processar_item_disparo(ouv, "ouvidoria_eventos", delay_min, delay_max, daily_limit, error_threshold)

        except Exception as e:
            logger.error(f"Erro no loop de disparos: {str(e)}")
        
        await asyncio.sleep(30) # Checa a cada 30 segundos

async def processar_item_disparo(item: dict, origem: str, delay_min: int, delay_max: int, daily_limit: int, error_threshold: int):
    item_id = item["id"]
    unidade_id = item.get("unidade_cuca_id") or item.get("unidade_id") # compatibilidade com nomes de colunas
    
    if item["status"] == "aprovado" or item["status"] == "aprovada":
        supabase.table(origem).update({"status": "em_andamento"}).eq("id", item_id).execute()

    # Buscar instância
    inst_res = supabase.table("instancias_uazapi").select("nome, token").eq("cuca_unit_id", unidade_id).execute()
    if not inst_res.data:
        logger.error(f"Nenhuma instância UAZAPI vinculada à unidade {unidade_id}")
        supabase.table("campanhas").update({"status": "pausada"}).eq("id", camp_id).execute()
        return
    
    instance_name = inst_res.data[0]["nome"]
    inst_token = inst_res.data[0]["token"]

    # Buscar apenas leads com opt_in e não bloqueados
    # Obs: Se tiver milhões de leads, ideal era paginação. Para o MVP, pega tudo.
    leads_res = supabase.table("leads").select("telefone, nome").eq("opt_in", True).eq("bloqueado", False).execute()
    leads = leads_res.data or []
    
    sucessos = 0
    erros = 0
    total = len(leads)

    if total == 0:
        supabase.table("campanhas").update({"status": "concluida"}).eq("id", camp_id).execute()
        return

    logger.info(f"Campanha {camp_id}: Disparando para {total} leads com delay de {delay_min} a {delay_max}ms")

    try:
        async with httpx.AsyncClient() as client:
            for i, lead in enumerate(leads):
                if i >= daily_limit:
                    logger.warning("Limite diário anti-ban atingido nesta run.")
                    break

                # Aplicar Delay Aleatório (Anti-Ban Warmup)
                sleep_time = random.uniform(delay_min / 1000.0, delay_max / 1000.0)
                await asyncio.sleep(sleep_time)

                texto = camp["template_texto"].replace("{{nome}}", lead["nome"] or "cidadão")

                try:
                    if camp.get("midia_url"):
                        resp = await client.post(
                            f"{UAZAPI_URL}/message/sendMedia/{instance_name}",
                            headers={"apikey": inst_token, "Content-Type": "application/json"},
                            json={
                                "number": lead["telefone"],
                                "options": {"delay": 1200, "presence": "composing"},
                                "mediaMessage": {
                                    "mediatype": "image",
                                    "caption": texto,
                                    "media": camp["midia_url"]
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

                except Exception as req_err:
                    erros += 1
                    logger.error(f"Erro request UAZAPI: {str(req_err)}")

                # Monitoramento de Erros e Bloqueio Automático
                current_rate = (erros / (i + 1)) * 100
                if current_rate > error_threshold and (i + 1) > 5:
                    logger.error(f"ALERTA: Taxa de erro alta ({current_rate}%). Pausando disparo!")
                    supabase.table(origem).update({"status": "pausada"}).eq("id", item_id).execute()
                    return

            # Finalização do disparo
            supabase.table(origem).update({"status": "concluida", "disparo_id": "DISP-" + str(int(time.time()))}).eq("id", item_id).execute()
            logger.info(f"Disparo {item_id} concluído. Sucessos: {sucessos}, Erros: {erros}")

    except Exception as exc:
        logger.error(f"Falha fatal no processar_item_disparo: {str(exc)}")
        supabase.table(origem).update({"status": "pausada"}).eq("id", item_id).execute()
