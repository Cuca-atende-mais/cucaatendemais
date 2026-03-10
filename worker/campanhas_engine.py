import os
import re
import time
import random
import asyncio
import logging
import uuid as _uuid
from datetime import datetime, timezone, timedelta
from supabase import create_client, Client
import httpx


def normalizar_telefone(tel: str) -> str:
    """
    Normaliza o telefone para o formato exigido pelo UAZAPI v2: somente dígitos com DDI.
    - Remove +, (, ), -, espaços e qualquer caractere não numérico.
    - Números brasileiros sem DDI (10 ou 11 dígitos) recebem o prefixo '55'.
    - Números de outros países (já com DDI) são mantidos como estão.
    - Garante compatibilidade com leads inseridos manualmente, via API externa
      ou capturados por webhook do próprio UAZAPI.
    """
    digits = re.sub(r'\D', '', tel)
    # Brasil: DDD (2 dígitos) + número (8 ou 9 dígitos) = 10 ou 11 dígitos sem DDI
    if len(digits) in (10, 11) and not digits.startswith('55'):
        return '55' + digits
    return digits

logger = logging.getLogger("campanhas_engine")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
UAZAPI_URL = os.getenv("UAZAPI_BASE_URL", "https://cucaatendemais.uazapi.com")


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


def _query_instancia_by_id_sync(instancia_id: str):
    """S14-03: Busca instância UAZAPI específica pelo ID (roteamento manual)."""
    return (
        supabase.table("instancias_uazapi")
        .select("nome, token, warmup_started_at")
        .eq("id", instancia_id)
        .eq("ativa", True)
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


def _query_leads_sync(unidade: str | None = None, categorias_alvo: list | None = None):
    """Busca leads com opt_in ativo, filtrados pela unidade e/ou categorias de interesse."""
    if categorias_alvo:
        # S13-13: Buscar leads via lead_interesses quando há categorias_alvo definidas
        interesses_res = (
            supabase.table("lead_interesses")
            .select("lead_id")
            .in_("categoria_id", categorias_alvo)
            .execute()
        )
        lead_ids = list(set(r["lead_id"] for r in (interesses_res.data or [])))
        if not lead_ids:
            # Sem leads com esses interesses
            class _EmptyResult:
                data = []
            return _EmptyResult()
        query = (
            supabase.table("leads")
            .select("id, telefone, nome")
            .eq("opt_in", True)
            .eq("bloqueado", False)
            .in_("id", lead_ids)
        )
    else:
        query = (
            supabase.table("leads")
            .select("id, telefone, nome")
            .eq("opt_in", True)
            .eq("bloqueado", False)
        )
    # Bug 2 corrigido: filtrar por unidade para não vazar mensagens entre unidades
    if unidade:
        query = query.eq("unidade_cuca", unidade)
    return query.execute()


def _criar_disparo_sync(dados: dict) -> str:
    """S24-01: Cria registro em disparos e retorna o ID gerado (resolve FK constraint)."""
    res = supabase.table("disparos").insert(dados).execute()
    return res.data[0]["id"]


async def processar_item_disparo(item: dict, origem: str, delay_min: int, delay_max: int, daily_limit: int, error_threshold: int):
    """Processa e dispara mensagem para um evento aprovado."""
    item_id = item.get("id")
    unidade = item.get("unidade_cuca") or item.get("unidade_cuca_id") or item.get("unidade_id")
    midia_url = item.get("midia_url") or item.get("flyer_url")

    # S24-02: Para pontual, usar descricao como corpo (é o conteúdo completo da mensagem)
    titulo_item = item.get("titulo", "")
    descricao_item = item.get("descricao", "")
    if origem == "eventos_pontuais" and descricao_item:
        template_texto = f"*{titulo_item}*\n\n{descricao_item}" if titulo_item else descricao_item
    else:
        template_texto = item.get("template_texto") or item.get("titulo") or item.get("descricao") or "Olá, {{nome}}!"

    # Marcar como em andamento (em thread separada para não bloquear)
    await asyncio.to_thread(_update_db_sync, origem, item_id, {"status": "em_andamento"})

    # S24-03: Roteamento — pontual sempre usa Divulgação; mensal/ouvidoria mantém lógica anterior
    if origem == "eventos_pontuais":
        inst_res = await asyncio.to_thread(_query_instancia_divulgacao_sync)
        if not inst_res.data:
            logger.error(f"Nenhuma instância Divulgação ativa. Pausando item {item_id}.")
            await asyncio.to_thread(_update_db_sync, origem, item_id, {"status": "pausada"})
            return
    elif origem == "campanhas_mensais":
        inst_res = await asyncio.to_thread(_query_instancia_divulgacao_sync)
        if not inst_res.data:
            logger.error(f"Nenhuma instância UAZAPI 'Divulgação' ativa. Pausando item {item_id}.")
            await asyncio.to_thread(_update_db_sync, origem, item_id, {"status": "pausada"})
            return
    else:
        inst_res = await asyncio.to_thread(_query_instancia_sync, unidade)
        if not inst_res.data:
            logger.error(f"Nenhuma instância Institucional ativa para unidade '{unidade}'. Pausando item {item_id}.")
            await asyncio.to_thread(_update_db_sync, origem, item_id, {"status": "pausada"})
            return

    instance_name = inst_res.data[0]["nome"]
    inst_token = inst_res.data[0]["token"]
    warmup_started = inst_res.data[0].get("warmup_started_at")

    # Limitão diária por instância (warm-up individual, não global)
    inst_daily_limit = _calcular_limite_warmup(warmup_started, daily_limit)
    logger.info(f"[Warmup] '{instance_name}': limite hoje = {inst_daily_limit} msgs (warmup_started={warmup_started})")

    # S13-13: Filtrar por categorias_alvo se definido no evento pontual
    categorias_alvo = item.get("categorias_alvo") or None
    if isinstance(categorias_alvo, list) and len(categorias_alvo) == 0:
        categorias_alvo = None

    # Buscar leads da unidade com opt_in (e filtro de interesses se pontual)
    leads_res = await asyncio.to_thread(_query_leads_sync, unidade, categorias_alvo)
    leads = leads_res.data or []
    total = len(leads)

    if total == 0:
        logger.info(f"Item {item_id}: Sem leads para disparar. Marcando como concluída.")
        tipo_disparo_vazio = "pontual" if origem == "eventos_pontuais" else "mensal"
        disparo_id_vazio = await asyncio.to_thread(_criar_disparo_sync, {
            "tipo": tipo_disparo_vazio,
            "evento_id": item_id if origem == "eventos_pontuais" else None,
            "campanha_mensal_id": item_id if origem == "campanhas_mensais" else None,
            "instancia_uazapi": instance_name,
            "mensagem_template": template_texto,
            "midia_url": midia_url,
            "total_destinatarios": 0,
            "total_enviados": 0,
            "total_erros": 0,
            "status": "concluida",
            "iniciado_em": datetime.now(timezone.utc).isoformat(),
            "concluido_em": datetime.now(timezone.utc).isoformat(),
        })
        await asyncio.to_thread(_update_db_sync, origem, item_id, {
            "status": "concluida",
            "disparo_id": disparo_id_vazio
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
                numero = normalizar_telefone(lead["telefone"])

                try:
                    if midia_url:
                        # 1) Envia o flyer
                        resp_img = await client.post(
                            f"{UAZAPI_URL}/send/media",
                            headers={"token": inst_token, "Content-Type": "application/json"},
                            json={
                                "number": numero,
                                "type": "image",
                                "file": midia_url,
                                "delay": 1200
                            }
                        )
                        # 2) Envia o texto completo logo após
                        await asyncio.sleep(1.5)
                        resp = await client.post(
                            f"{UAZAPI_URL}/send/text",
                            headers={"token": inst_token, "Content-Type": "application/json"},
                            json={
                                "number": numero,
                                "text": texto,
                                "delay": 1200
                            }
                        )
                        # Sucesso se pelo menos o texto foi enviado
                        if resp_img.status_code != 200:
                            logger.warning(f"Flyer HTTP {resp_img.status_code} para {lead['telefone']}")
                    else:
                        resp = await client.post(
                            f"{UAZAPI_URL}/send/text",
                            headers={"token": inst_token, "Content-Type": "application/json"},
                            json={
                                "number": numero,
                                "text": texto,
                                "delay": 1200
                            }
                        )

                    if resp.status_code == 200:
                        sucessos += 1
                        # S23-05: Breadcrumb de disparo — grava contexto na conversa do lead
                        lead_id = lead.get("id")
                        if lead_id:
                            titulo_disparo = (item.get("titulo") or item.get("descricao", ""))[:80]
                            tz_fortaleza = timezone(timedelta(hours=-3))
                            breadcrumb = {
                                "ultimo_disparo": {
                                    "tipo": origem,
                                    "id": str(item_id),
                                    "titulo": titulo_disparo,
                                    "enviado_em": datetime.now(tz_fortaleza).isoformat()
                                }
                            }
                            try:
                                supabase.table("conversas").upsert({
                                    "lead_id": lead_id,
                                    "instancia_uazapi": instance_name,
                                    "agente_tipo": "Institucional",
                                    "status": "ativa",
                                    "metadata": breadcrumb
                                }, on_conflict="lead_id,instancia_uazapi").execute()
                            except Exception as bc_err:
                                logger.warning(f"[Breadcrumb] Erro ao gravar contexto: {bc_err}")
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

        # S24-01: Criar registro em disparos antes de atualizar eventos_pontuais (resolve FK constraint)
        # Mapear origem para os valores aceitos pelo check constraint: 'pontual' | 'mensal'
        tipo_disparo = "pontual" if origem == "eventos_pontuais" else "mensal"
        disparo_id = await asyncio.to_thread(_criar_disparo_sync, {
            "tipo": tipo_disparo,
            "evento_id": item_id if origem == "eventos_pontuais" else None,
            "campanha_mensal_id": item_id if origem == "campanhas_mensais" else None,
            "instancia_uazapi": instance_name,
            "mensagem_template": template_texto,
            "midia_url": midia_url,
            "total_destinatarios": total,
            "total_enviados": sucessos,
            "total_erros": erros,
            "status": "concluida",
            "iniciado_em": datetime.now(timezone.utc).isoformat(),
            "concluido_em": datetime.now(timezone.utc).isoformat(),
        })
        await asyncio.to_thread(_update_db_sync, origem, item_id, {
            "status": "concluida",
            "disparo_id": disparo_id
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

            # 1. Programação Pontual (aprovada pelo Gerente da Unidade → dispara via Institucional)
            res_pontuais = await asyncio.to_thread(_query_db_sync, "eventos_pontuais", "aprovado")
            for evento in (res_pontuais.data or []):
                await processar_item_disparo(evento, "eventos_pontuais", delay_min, delay_max, daily_limit, error_threshold)

            # 2. Ouvidoria (aprovada pelo Super Admin CUCA)
            res_ouvidoria = await asyncio.to_thread(_query_db_sync, "ouvidoria_eventos", "aprovado")
            for ouv in (res_ouvidoria.data or []):
                await processar_item_disparo(ouv, "ouvidoria_eventos", delay_min, delay_max, daily_limit, error_threshold)

            # 3. Divulgação Global (S9-05): acionado manualmente pelo Gestor Geral
            #    Campanha mensal NÃO é mais processada automaticamente — passou para o canal Divulgação
            await processar_disparos_divulgacao(delay_min, delay_max, daily_limit, error_threshold)

        except Exception as e:
            logger.error(f"Erro no loop de disparos: {str(e)}")

        # Aguarda 30 segundos antes da próxima verificação
        await asyncio.sleep(30)


# ─────────────────────────────────────────────────────────────────────────────
# S9-05: Motor de Disparo Global via canal Divulgação
# ─────────────────────────────────────────────────────────────────────────────

PALAVRAS_STOP = {"stop", "parar", "sair", "cancelar", "nao quero", "não quero",
                 "remover", "descadastrar", "descadastre", "chega", "pare"}

SPINTAX_SAUDACOES = [
    "Olá, {nome}!", "Oi, {nome}!", "Tudo bem, {nome}?",
    "Bom dia, {nome}!", "Boa tarde, {nome}!", "Boa noite, {nome}!",
    "Olá {nome}, tudo certo?",
]

LIMITE_SESSAO_HORA = 80      # S9-07: max msgs por hora
PAUSA_SESSAO_SEGUNDOS = 600  # S9-07: pausa de 10min entre sessões
STOP_ALERTA_THRESHOLD = 5    # S9-09: % de STOP para pausar sessão
STOP_CHECK_INTERVALO = 50    # S9-09: checar a cada N mensagens


def _aplicar_spintax(template: str, nome: str) -> str:
    """S9-06: Aplica saudação aleatória e substitui {nome}."""
    saudacao = random.choice(SPINTAX_SAUDACOES).format(nome=nome)
    # Remove a primeira linha se não for saudação, insere saudação no início
    linhas = template.strip().split("\n")
    # Se as primeiras palavras já são uma saudação, substitui; senão, prepend
    primeira = linhas[0].lower() if linhas else ""
    if any(s in primeira for s in ["olá", "oi", "tudo", "bom dia", "boa tarde", "boa noite"]):
        linhas[0] = saudacao
    else:
        linhas.insert(0, saudacao)
    return "\n".join(linhas)


def _query_leads_divulgacao_sync():
    """S9-10: Leads opt-in com interação nos últimos 60 dias (sem filtro de unidade)."""
    from datetime import datetime, timezone, timedelta
    corte = (datetime.now(timezone.utc) - timedelta(days=60)).isoformat()
    return (
        supabase.table("leads")
        .select("telefone, nome")
        .eq("opt_in", True)
        .eq("bloqueado", False)
        .execute()
    )


def _query_instancia_divulgacao_sync():
    """Busca instância UAZAPI do tipo Divulgação ativa."""
    return (
        supabase.table("instancias_uazapi")
        .select("nome, token, warmup_started_at")
        .eq("canal_tipo", "Divulgação")
        .eq("ativa", True)
        .eq("reserva", False)
        .limit(1)
        .execute()
    )


def _marcar_opt_out_sync(telefone: str):
    """S9-08: Marca lead como opt_in=False após STOP."""
    try:
        supabase.table("leads").update({"opt_in": False}).eq("telefone", telefone).execute()
    except Exception as e:
        logger.warning(f"Erro ao marcar opt_out para {telefone}: {e}")


def _update_metricas_sync(disparo_id: str, enviados: int, erros: int, stop: int, status: str):
    """Atualiza métricas do disparo em progresso."""
    try:
        supabase.table("disparos_divulgacao").update({
            "total_enviados": enviados,
            "total_erros": erros,
            "total_stop": stop,
            "status": status,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }).eq("id", disparo_id).execute()
    except Exception as e:
        logger.warning(f"Erro ao atualizar métricas do disparo {disparo_id}: {e}")


async def processar_disparos_divulgacao(delay_min: int, delay_max: int, daily_limit: int, error_threshold: int):
    """S9-05: Processa fila de disparos globais da tabela disparos_divulgacao."""
    # Buscar disparo pendente
    res = await asyncio.to_thread(
        lambda: supabase.table("disparos_divulgacao")
        .select("*")
        .eq("status", "pendente")
        .order("created_at", desc=False)
        .limit(1)
        .execute()
    )
    if not res.data:
        return  # Nada a processar

    disparo = res.data[0]
    disparo_id = disparo["id"]
    template = disparo.get("mensagem_template", "")
    inst_nome_salvo = disparo.get("instancia_uazapi")

    logger.info(f"[Divulgação] Iniciando disparo global {disparo_id}")

    # Marcar como em andamento
    await asyncio.to_thread(_update_metricas_sync, disparo_id, 0, 0, 0, "em_andamento")

    # Buscar instância Divulgação
    inst_res = await asyncio.to_thread(_query_instancia_divulgacao_sync)
    if not inst_res.data:
        logger.error(f"[Divulgação] Nenhuma instância Divulgação ativa. Pausando disparo {disparo_id}.")
        await asyncio.to_thread(_update_metricas_sync, disparo_id, 0, 0, 0, "pausado")
        return

    instancia = inst_res.data[0]
    inst_nome = instancia["nome"]
    inst_token = instancia["token"]
    warmup_started = instancia.get("warmup_started_at")

    # Limite diário (warmup da instância Divulgação)
    inst_daily_limit = _calcular_limite_warmup(warmup_started, daily_limit)
    logger.info(f"[Divulgação] Instância: {inst_nome} | Limite: {inst_daily_limit}/dia")

    # Buscar leads (filtro 60 dias)
    leads_res = await asyncio.to_thread(_query_leads_divulgacao_sync)
    leads = leads_res.data or []
    total = min(len(leads), inst_daily_limit)

    if total == 0:
        logger.info(f"[Divulgação] Sem leads elegíveis. Concluindo.")
        await asyncio.to_thread(_update_metricas_sync, disparo_id, 0, 0, 0, "concluido")
        return

    logger.info(f"[Divulgação] {len(leads)} leads elegíveis → enviando {total}")

    enviados = 0
    erros = 0
    total_stop = 0
    msgs_na_sessao = 0

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            for i, lead in enumerate(leads[:total]):
                # S9-07: Pausa entre sessões (80/hora)
                if msgs_na_sessao >= LIMITE_SESSAO_HORA:
                    logger.info(f"[Divulgação] Sessão de {LIMITE_SESSAO_HORA} msgs concluída. Pausando {PAUSA_SESSAO_SEGUNDOS}s...")
                    await asyncio.to_thread(_update_metricas_sync, disparo_id, enviados, erros, total_stop, "em_andamento")
                    await asyncio.sleep(PAUSA_SESSAO_SEGUNDOS)
                    msgs_na_sessao = 0

                # S9-09: Alerta de saúde a cada STOP_CHECK_INTERVALO msgs
                if (i + 1) % STOP_CHECK_INTERVALO == 0 and (i + 1) > 0:
                    taxa_stop = (total_stop / (i + 1)) * 100
                    if taxa_stop > STOP_ALERTA_THRESHOLD:
                        logger.error(f"[Divulgação] ALERTA: {taxa_stop:.1f}% STOP em {i+1} msgs. Pausando sessão!")
                        await asyncio.to_thread(_update_metricas_sync, disparo_id, enviados, erros, total_stop, "pausado")
                        return

                # Delay anti-ban aleatório
                sleep_s = random.uniform(delay_min / 1000.0, delay_max / 1000.0)
                await asyncio.sleep(sleep_s)

                nome = lead.get("nome") or "jovem"
                telefone_raw = lead.get("telefone", "")
                if not telefone_raw:
                    continue
                telefone = normalizar_telefone(telefone_raw)

                # S9-06: Spintax — mensagem única por lead
                texto = _aplicar_spintax(template, nome)

                try:
                    UAZAPI_URL = os.getenv("UAZAPI_BASE_URL", "https://cucaatendemais.uazapi.com")
                    resp = await client.post(
                        f"{UAZAPI_URL}/send/text",
                        headers={"token": inst_token, "Content-Type": "application/json"},
                        json={
                            "number": telefone,
                            "text": texto,
                            "delay": 1200
                        }
                    )
                    if resp.status_code == 200:
                        enviados += 1
                        msgs_na_sessao += 1
                    else:
                        erros += 1
                        logger.warning(f"[Divulgação] HTTP {resp.status_code} para {telefone}")

                except Exception as req_err:
                    erros += 1
                    logger.error(f"[Divulgação] Erro request: {req_err}")

                # Anti-ban: checar taxa de erro técnico
                if (i + 1) > 5:
                    taxa_erro = (erros / (i + 1)) * 100
                    if taxa_erro > error_threshold:
                        logger.error(f"[Divulgação] Taxa de erro {taxa_erro:.1f}% > {error_threshold}%. Pausando!")
                        await asyncio.to_thread(_update_metricas_sync, disparo_id, enviados, erros, total_stop, "pausado")
                        return

        logger.info(f"[Divulgação] Disparo {disparo_id} concluído! Enviados: {enviados} | Erros: {erros}")
        await asyncio.to_thread(_update_metricas_sync, disparo_id, enviados, erros, total_stop, "concluido")
        logger.info(f"[Divulgação] Disparo {disparo_id} concluído. Enviados: {enviados} | Erros: {erros} | STOP: {total_stop}")

    except Exception as exc:
        logger.error(f"[Divulgação] Falha fatal: {exc}")
        await asyncio.to_thread(_update_metricas_sync, disparo_id, enviados, erros, total_stop, "erro")
