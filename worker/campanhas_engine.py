import os
import re
import random
import asyncio
import logging
import httpx
from datetime import datetime, timezone, timedelta
from supabase import create_client, Client


def normalizar_telefone(tel: str) -> str:
    """
    Normaliza o telefone: só dígitos com DDI.
    Números BR sem DDI (10 ou 11 dígitos) recebem prefixo '55'.
    """
    digits = re.sub(r'\D', '', tel)
    if len(digits) in (10, 11) and not digits.startswith('55'):
        return '55' + digits
    return digits


def _normalizar_numero_meta(tel: str) -> str:
    """Normaliza para o formato Meta: DDI 55 + nono dígito BR se ausente."""
    digits = normalizar_telefone(tel)
    if len(digits) == 12 and digits.startswith('55') and digits[4] != '9':
        digits = digits[:4] + '9' + digits[4:]
    return digits


logger = logging.getLogger("campanhas_engine")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def _get_config_sync(key: str, default_val: int) -> int:
    try:
        res = supabase.table("configuracoes").select("valor").eq("chave", key).execute()
        if res.data and len(res.data) > 0 and res.data[0].get("valor") is not None:
            return int(res.data[0]["valor"])
    except Exception as e:
        logger.warning(f"Erro ao ler config {key}: {e}")
    return default_val


async def get_config(key: str, default_val: int) -> int:
    return await asyncio.to_thread(_get_config_sync, key, default_val)


def _update_db_sync(tabela: str, item_id: str, dados: dict):
    return supabase.table(tabela).update(dados).eq("id", item_id).execute()


def _claim_evento_pontual_sync():
    return supabase.rpc("claim_evento_pontual").execute()


def _claim_ouvidoria_evento_sync():
    return supabase.rpc("claim_ouvidoria_evento").execute()


def _gravar_breadcrumb_disparo(lead_id: str, origem_id: str, breadcrumb: dict) -> None:
    """
    Grava o breadcrumb do disparo na conversa do lead sem apagar o estado que o
    motor-agente gerencia em metadata (conversa_engajada, unidade_selecionada,
    aguardando_unidade — S-WM-31). Um upsert com "metadata" completo substitui a
    coluna inteira (Postgrest não faz merge de jsonb) — por isso lê o metadata
    atual e mescla em memória antes de escrever.

    Usa .limit(1) em vez do modo "single object" do Postgrest: com 0 linhas, esse
    modo devolve None como o próprio retorno de .execute() (não um objeto com
    .data=None) — acessar .data quebra com AttributeError, silenciosamente
    engolido pelo try/except do chamador. .limit(1).execute() sempre devolve um
    objeto com .data como lista.
    """
    existente = supabase.table("conversas").select("id, metadata").eq(
        "lead_id", lead_id
    ).eq("origem_id", origem_id).limit(1).execute()

    if existente.data:
        row = existente.data[0]
        metadata = row.get("metadata") or {}
        metadata.update(breadcrumb)
        supabase.table("conversas").update(
            {"metadata": metadata}
        ).eq("id", row["id"]).execute()
    else:
        supabase.table("conversas").insert({
            "lead_id": lead_id,
            "origem_id": origem_id,
            "agente_tipo": "Institucional",
            "canal_ativo": "meta",
            "status": "ativa",
            "metadata": breadcrumb,
        }).execute()


def _claim_disparo_divulgacao_sync():
    return supabase.rpc("claim_disparo_divulgacao").execute()


def _query_leads_sync(unidade: str | None = None, categorias_alvo: list | None = None):
    """
    Achado 2026-07-24: a versão anterior buscava lead_id em lead_interesses e montava um
    filtro .in_("id", lead_ids) com TODOS os ids num único GET — com uma categoria de
    centenas de leads (ex.: 722, planilha Corrida da Juventude) a URL resultante passa do
    limite do gateway/PostgREST, a API devolve corpo vazio/inválido e o parse de JSON quebra
    no cliente, derrubando o disparo inteiro (status vira "pausada", sem nenhum envio).
    A RPC buscar_leads_por_categoria (migration 20260724200000) faz o join no Postgres — o
    corpo da requisição (POST) só carrega os UUIDs de categoria (sempre poucos), nunca a
    lista de leads que fizer match, então o volume de leads elegíveis nunca mais afeta o
    tamanho da requisição.
    """
    if categorias_alvo:
        return supabase.rpc("buscar_leads_por_categoria", {
            "p_categorias": categorias_alvo,
            "p_unidade": unidade,
        }).execute()
    query = (
        supabase.table("leads")
        .select("id, telefone, nome")
        .eq("opt_in", True)
        .eq("bloqueado", False)
    )
    if unidade:
        query = query.eq("unidade_cuca", unidade)
    return query.execute()


def _criar_disparo_sync(dados: dict) -> str:
    res = supabase.table("disparos").insert(dados).execute()
    return res.data[0]["id"]


def _query_leads_divulgacao_sync():
    return (
        supabase.table("leads")
        .select("telefone, nome")
        .eq("opt_in", True)
        .eq("bloqueado", False)
        .execute()
    )


def _update_metricas_sync(disparo_id: str, enviados: int, erros: int, stop: int, status: str):
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


# ─── Meta Template Dispatch ───────────────────────────────────────────────────

def _get_phone_by_canal_tipo_sync(canal_tipo: str) -> tuple[str, str] | None:
    """Retorna (phone_number_id, META_SYSTEM_USER_TOKEN) ou None se não configurado."""
    try:
        res = (
            supabase.table("meta_phone_numbers")
            .select("phone_number_id")
            .eq("canal_tipo", canal_tipo)
            .eq("ativo", True)
            .limit(1)
            .execute()
        )
        if not res.data:
            return None
        token = os.getenv("META_SYSTEM_USER_TOKEN", "")
        if not token:
            logger.error("[Campanhas] META_SYSTEM_USER_TOKEN não configurado")
            return None
        return res.data[0]["phone_number_id"], token
    except Exception as exc:
        logger.error(f"[Campanhas] Erro ao buscar phone_number_id canal_tipo={canal_tipo!r}: {exc}")
        return None


def _montar_parametros_named(variaveis: list[dict] | None, valores: list[str]) -> list[dict]:
    """Monta os parameters do body com parameter_name a partir de meta_templates.variaveis.

    Necessário porque os templates Meta aqui usados foram aprovados com variáveis
    NOMEADAS (ex.: {{nome}}, {{mes}}), não posicionais numéricas — a Graph API rejeita
    o envio com HTTP 400 "(#100) Parameter name is missing or empty" se o parâmetro não
    tiver parameter_name. A ordem de valores segue a posição declarada em `variaveis`
    (não hardcoded), então funciona para qualquer template futuro com o mesmo formato.
    """
    ordenadas = sorted(variaveis or [], key=lambda v: v.get("posicao", 0))
    return [
        {"type": "text", "parameter_name": v.get("descricao", f"var{i + 1}"), "text": valor}
        for i, (v, valor) in enumerate(zip(ordenadas, valores))
    ]


async def _enviar_template_meta(
    phone_number_id: str,
    to: str,
    token: str,
    template_name: str,
    components: list,
) -> bool:
    """POST Graph API v23.0 com type=template. Retorna True em sucesso."""
    numero = _normalizar_numero_meta(to)
    url = f"https://graph.facebook.com/v23.0/{phone_number_id}/messages"
    body = {
        "messaging_product": "whatsapp",
        "to": numero,
        "type": "template",
        "template": {
            "name": template_name,
            "language": {"code": "pt_BR"},
            "components": components,
        },
    }
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                url,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=body,
            )
        if resp.status_code in (200, 201):
            return True
        logger.warning(f"[Meta] HTTP {resp.status_code} para {to}: {resp.text[:200]}")
        return False
    except Exception as exc:
        logger.error(f"[Meta] Erro ao enviar template {template_name!r} para {to}: {type(exc).__name__}")
        return False


# ─── Processamento de itens de disparo ───────────────────────────────────────

async def processar_item_disparo(
    item: dict,
    origem: str,
    delay_min: int,
    delay_max: int,
    daily_limit: int,
    error_threshold: int,
):
    """Processa e dispara mensagem Meta para um evento já reivindicado atomicamente (claim RPC)."""
    item_id = item.get("id")
    try:
        await _processar_item_disparo_interno(item, origem, delay_min, delay_max, daily_limit, error_threshold)
    except Exception as exc:
        logger.exception(f"[campanhas] Erro inesperado processando item {item_id} ({origem}): {exc}")
        await asyncio.to_thread(_update_db_sync, origem, item_id, {"status": "pausada"})


async def _processar_item_disparo_interno(
    item: dict,
    origem: str,
    delay_min: int,
    delay_max: int,
    daily_limit: int,
    error_threshold: int,
):
    item_id = item.get("id")
    unidade = item.get("unidade_cuca") or item.get("unidade_cuca_id") or item.get("unidade_id")

    # Selecionar canal Meta e automação-alvo por origem (S-WM-16: zero nome hardcoded)
    # S-WM-19 Task 4: canal_tipo="Divulgação" e automacao_tag="Divulgação" nunca
    # existiram em meta_phone_numbers.canal_tipo nem em meta_templates.automacoes
    # (confirmado por consulta direta ao cuca-dev) — o template real para
    # eventos_pontuais é institucional_programacao_pontual_v1, automacoes
    # ["Institucional", "Pontual"], vinculado ao número canal_tipo="Institucional".
    if origem == "eventos_pontuais":
        canal_tipo = "Institucional"
        automacao_tags = ["Institucional", "Pontual"]
    elif origem == "ouvidoria_eventos":
        canal_tipo = "Institucional"
        automacao_tags = ["Ouvidoria"]
    else:
        canal_tipo = "Institucional"
        automacao_tags = ["Divulgação"]

    canal_info = await asyncio.to_thread(_get_phone_by_canal_tipo_sync, canal_tipo)
    if not canal_info:
        logger.error(
            f"Nenhum phone_number_id Meta ativo para canal_tipo={canal_tipo!r}. "
            f"Pausando item {item_id}."
        )
        await asyncio.to_thread(_update_db_sync, origem, item_id, {"status": "pausada"})
        return

    phone_number_id, meta_token = canal_info

    # Lookup relacional (automação + phone_number_id, zero nome hardcoded). Se nenhum
    # template corresponder, pula graciosamente (loga e segue) — não há template
    # cadastrado hoje para "eventos_pontuais"/"ouvidoria_eventos" pós-migração S-WM-16.
    # Filtro de igualdade exata em coluna array precisa da sintaxe de array literal do
    # Postgres (ex.: '{"Institucional"}'), não de uma lista Python — o postgrest-py
    # serializa lista como str(list) ("['Institucional']"), que o Postgrest rejeita com
    # 400 (malformed array literal). .contains() não serve aqui: combinaria também com
    # templates multi-tag (ex.: ["Institucional", "Transbordo"]), quebrando o match
    # exato que este lookup exige.
    automacao_filtro = '{' + ','.join(f'"{tag}"' for tag in automacao_tags) + '}'
    _tpl_res = supabase.table("meta_templates").select("nome, corpo_texto, variaveis") \
        .eq("automacoes", automacao_filtro) \
        .contains("phone_number_ids", [phone_number_id]) \
        .eq("ativo", True).eq("status", "aprovado") \
        .limit(1).execute()
    if not _tpl_res.data:
        logger.warning(
            f"[campanhas] Nenhum template aprovado para automação={automacao_tags!r} "
            f"phone_number_id={phone_number_id!r} — item {item_id} pulado"
        )
        await asyncio.to_thread(_update_db_sync, origem, item_id, {"status": "pausada"})
        return
    _tpl_row = _tpl_res.data[0]
    template_name = _tpl_row["nome"]
    variaveis_item = _tpl_row.get("variaveis")

    categorias_alvo = item.get("categorias_alvo") or None
    if isinstance(categorias_alvo, list) and len(categorias_alvo) == 0:
        categorias_alvo = None
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
            "instancia_uazapi": phone_number_id,
            "mensagem_template": template_name,
            "midia_url": None,
            "total_destinatarios": 0,
            "total_enviados": 0,
            "total_erros": 0,
            "status": "concluida",
            "iniciado_em": datetime.now(timezone.utc).isoformat(),
            "concluido_em": datetime.now(timezone.utc).isoformat(),
        })
        await asyncio.to_thread(_update_db_sync, origem, item_id, {
            "status": "concluida",
            "disparo_id": disparo_id_vazio,
        })
        return

    logger.info(
        f"Item {item_id} ({origem}): Disparando para {total} leads | "
        f"Template: {template_name} | phone={phone_number_id}"
    )

    # Extrair campos para template
    titulo = item.get("titulo", "")
    descricao = item.get("descricao", "")
    texto_pesquisa = item.get("descricao") or item.get("titulo") or ""

    def _fmt_data_br(iso: str) -> str:
        try:
            y, m, d = iso.split("-")
            return f"{d}/{m}/{y}"
        except Exception:
            return iso

    data_inicio = item.get("data_inicio") or item.get("data_evento") or ""
    hora_inicio = item.get("hora_inicio") or ""
    local_evento = item.get("local") or unidade or ""
    data_fmt = _fmt_data_br(data_inicio) if data_inicio else ""

    sucessos = 0
    erros = 0

    for i, lead in enumerate(leads):
        if i >= daily_limit:
            logger.warning(f"Limite diário atingido ({daily_limit}). Pausando.")
            break

        sleep_time = random.uniform(delay_min / 1000.0, delay_max / 1000.0)
        await asyncio.sleep(sleep_time)

        nome_lead = lead.get("nome") or "cidadão"
        numero = normalizar_telefone(lead["telefone"])

        # Componentes montados por origem (não por nome de template — S-WM-16)
        if origem == "ouvidoria_eventos":
            components = [{
                "type": "body",
                "parameters": _montar_parametros_named(variaveis_item, [nome_lead, texto_pesquisa]),
            }]
        else:
            # S-WM-19 Task 5: institucional_programacao_pontual_v1.variaveis é
            # [nome, titulo_evento, descricao_evento, data_evento, horario_evento,
            # local_evento] (confirmado no cuca-dev) — a lista antiga começava em
            # `titulo` (sem `nome_lead`) e terminava com `unidade` fora de posição,
            # desalinhando as 6 posições inteiras, não só a 1ª.
            components = [{
                "type": "body",
                "parameters": _montar_parametros_named(
                    variaveis_item,
                    [nome_lead, titulo, descricao, data_fmt, hora_inicio, local_evento],
                ),
            }]

        ok = await _enviar_template_meta(phone_number_id, numero, meta_token, template_name, components)
        if ok:
            sucessos += 1
            # Breadcrumb na conversa do lead
            lead_id = lead.get("id")
            if lead_id:
                titulo_disparo = (item.get("titulo") or item.get("descricao", ""))[:80]
                tz_fortaleza = timezone(timedelta(hours=-3))
                breadcrumb = {"ultimo_disparo": {
                    "tipo": origem,
                    "id": str(item_id),
                    "titulo": titulo_disparo,
                    "enviado_em": datetime.now(tz_fortaleza).isoformat(),
                }}
                try:
                    _gravar_breadcrumb_disparo(lead_id, phone_number_id, breadcrumb)
                except Exception as bc_err:
                    logger.warning(f"[Breadcrumb] Erro ao gravar contexto: {bc_err}")
        else:
            erros += 1

        if (i + 1) > 5:
            taxa_erro = (erros / (i + 1)) * 100
            if taxa_erro > error_threshold:
                logger.error(f"Taxa de erro {taxa_erro:.1f}% > {error_threshold}%. Pausando!")
                await asyncio.to_thread(_update_db_sync, origem, item_id, {"status": "pausada"})
                return

    tipo_disparo = "pontual" if origem == "eventos_pontuais" else "mensal"
    disparo_id = await asyncio.to_thread(_criar_disparo_sync, {
        "tipo": tipo_disparo,
        "evento_id": item_id if origem == "eventos_pontuais" else None,
        "campanha_mensal_id": item_id if origem == "campanhas_mensais" else None,
        "instancia_uazapi": phone_number_id,
        "mensagem_template": template_name,
        "midia_url": None,
        "total_destinatarios": total,
        "total_enviados": sucessos,
        "total_erros": erros,
        "status": "concluida",
        "iniciado_em": datetime.now(timezone.utc).isoformat(),
        "concluido_em": datetime.now(timezone.utc).isoformat(),
    })
    await asyncio.to_thread(_update_db_sync, origem, item_id, {
        "status": "concluida",
        "disparo_id": disparo_id,
    })
    logger.info(f"Disparo {item_id} concluído. Sucessos: {sucessos} | Erros: {erros}")


# ─── Loop de Campanhas ────────────────────────────────────────────────────────

async def campanhas_loop():
    """Loop principal: checa aprovações a cada 30s sem bloquear o event loop."""
    logger.info("Iniciando Motor de Campanhas Meta...")
    await asyncio.sleep(5)

    while True:
        try:
            delay_min = await get_config("anti_ban_delay_min", 2000)
            delay_max = await get_config("anti_ban_delay_max", 5000)
            daily_limit = await get_config("anti_ban_daily_limit", 500)
            error_threshold = await get_config("anti_ban_error_threshold", 10)

            while True:
                res_pontual = await asyncio.to_thread(_claim_evento_pontual_sync)
                itens_pontuais = res_pontual.data or []
                if not itens_pontuais:
                    break
                await processar_item_disparo(
                    itens_pontuais[0], "eventos_pontuais", delay_min, delay_max, daily_limit, error_threshold
                )

            while True:
                res_ouvidoria = await asyncio.to_thread(_claim_ouvidoria_evento_sync)
                itens_ouvidoria = res_ouvidoria.data or []
                if not itens_ouvidoria:
                    break
                await processar_item_disparo(
                    itens_ouvidoria[0], "ouvidoria_eventos", delay_min, delay_max, daily_limit, error_threshold
                )

            await processar_disparos_divulgacao(delay_min, delay_max, daily_limit, error_threshold)

        except Exception as e:
            logger.error(f"Erro no loop de disparos: {str(e)}")

        await asyncio.sleep(30)


# ─── Disparo Global de Divulgação (programação mensal) ───────────────────────

LINK_PROGRAMACAO_MENSAL = "https://portaldajuventude.fortaleza.ce.gov.br/portal-web/#/"


async def processar_disparos_divulgacao(
    delay_min: int,
    delay_max: int,
    daily_limit: int,
    error_threshold: int,
):
    """Processa fila de disparos globais com o template de programação mensal (lookup relacional)."""
    res = await asyncio.to_thread(_claim_disparo_divulgacao_sync)
    if not res.data:
        return

    disparo = res.data[0]
    disparo_id = disparo["id"]
    mes_num = disparo.get("mes", 0)

    _MESES = {
        1: "Janeiro", 2: "Fevereiro", 3: "Março", 4: "Abril",
        5: "Maio", 6: "Junho", 7: "Julho", 8: "Agosto",
        9: "Setembro", 10: "Outubro", 11: "Novembro", 12: "Dezembro",
    }
    mes_nome = _MESES.get(mes_num, str(mes_num))

    logger.info(f"[Divulgação] Iniciando disparo global {disparo_id} — mês: {mes_nome}")

    try:
        await _processar_disparo_divulgacao_interno(
            disparo_id, mes_nome, delay_min, delay_max, daily_limit, error_threshold
        )
    except Exception as exc:
        logger.exception(f"[Divulgação] Erro inesperado processando disparo {disparo_id}: {exc}")
        await asyncio.to_thread(_update_metricas_sync, disparo_id, 0, 0, 0, "erro")


async def _processar_disparo_divulgacao_interno(
    disparo_id: str,
    mes_nome: str,
    delay_min: int,
    delay_max: int,
    daily_limit: int,
    error_threshold: int,
):
    canal_info = await asyncio.to_thread(_get_phone_by_canal_tipo_sync, "Institucional")
    if not canal_info:
        logger.error(f"[Divulgação] Nenhum phone_number_id Meta ativo para Institucional. Pausando {disparo_id}.")
        await asyncio.to_thread(_update_metricas_sync, disparo_id, 0, 0, 0, "pausado")
        return

    phone_number_id, meta_token = canal_info

    # Lookup relacional do template de programação mensal (automação + número — zero nome hardcoded).
    # automacoes=["Institucional"] exato (não .contains) para não colidir com templates que também
    # usam o canal Institucional mas carregam uma 2ª tag (ex.: transbordo, evento pontual).
    # Filtro de igualdade exata em coluna array precisa da sintaxe de array literal do Postgres
    # (ex.: '{"Institucional"}'), não de uma lista Python — o postgrest-py serializa lista como
    # str(list) ("['Institucional']"), que o Postgrest rejeita com 400 (malformed array literal).
    _tpl_div = await asyncio.to_thread(
        lambda: supabase.table("meta_templates").select("nome, corpo_texto, variaveis")
        .eq("automacoes", '{"Institucional"}')
        .contains("phone_number_ids", [phone_number_id])
        .eq("ativo", True).eq("status", "aprovado")
        .limit(1).execute()
    )
    if not _tpl_div.data:
        logger.warning(f"[Divulgação] Nenhum template aprovado para Institucional/{phone_number_id} — disparo {disparo_id} cancelado")
        await asyncio.to_thread(_update_metricas_sync, disparo_id, 0, 0, 0, "pausado")
        return
    _tpl_div_row = _tpl_div.data[0]
    template_divulgacao = _tpl_div_row["nome"]
    variaveis_divulgacao = _tpl_div_row.get("variaveis")

    leads_res = await asyncio.to_thread(_query_leads_divulgacao_sync)
    leads = leads_res.data or []
    total = min(len(leads), daily_limit)

    if total == 0:
        logger.info(f"[Divulgação] Sem leads elegíveis. Concluindo.")
        await asyncio.to_thread(_update_metricas_sync, disparo_id, 0, 0, 0, "concluido")
        return

    logger.info(f"[Divulgação] {len(leads)} leads elegíveis → enviando {total}")

    enviados = 0
    erros = 0

    for i, lead in enumerate(leads[:total]):
        sleep_s = random.uniform(delay_min / 1000.0, delay_max / 1000.0)
        await asyncio.sleep(sleep_s)

        nome = lead.get("nome") or "jovem"
        telefone_raw = lead.get("telefone", "")
        if not telefone_raw:
            continue
        telefone = normalizar_telefone(telefone_raw)

        components = [{
            "type": "body",
            "parameters": _montar_parametros_named(
                variaveis_divulgacao, [nome, mes_nome, LINK_PROGRAMACAO_MENSAL]
            ),
        }]

        ok = await _enviar_template_meta(
            phone_number_id, telefone, meta_token, template_divulgacao, components
        )
        if ok:
            enviados += 1
        else:
            erros += 1

        if (i + 1) > 5:
            taxa_erro = (erros / (i + 1)) * 100
            if taxa_erro > error_threshold:
                logger.error(f"[Divulgação] Taxa de erro {taxa_erro:.1f}% > {error_threshold}%. Pausando!")
                await asyncio.to_thread(_update_metricas_sync, disparo_id, enviados, erros, 0, "pausado")
                return

    logger.info(f"[Divulgação] Disparo {disparo_id} concluído. Enviados: {enviados} | Erros: {erros}")
    await asyncio.to_thread(_update_metricas_sync, disparo_id, enviados, erros, 0, "concluido")
