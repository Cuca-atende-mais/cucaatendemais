import os
import re
import random
import asyncio
import logging
import httpx
from datetime import datetime, timezone, timedelta
from postgrest.exceptions import APIError
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

    Achado 2026-07-25: o ramo de criação (abaixo) usava INSERT simples, não
    atômico — se o fluxo inbound (upsert atômico, meta_adapter_inbound.py:604-613)
    criasse a mesma linha entre o SELECT acima e o INSERT deste ramo (corrida real:
    resposta automática de WhatsApp Business do lead chegando quase junto do
    disparo), o INSERT falhava por violação de UNIQUE(lead_id, origem_id), a
    exceção era engolida pelo try/except do chamador, e o breadcrumb nunca era
    gravado — visto em produção (lead real sem `ultimo_disparo` na metadata,
    apesar de ter recebido o disparo).
    Corrigido: se o INSERT falhar, tenta de novo como update — mas só quando a
    causa for de fato uma violação de UNIQUE (SQLSTATE 23505, via
    `postgrest.exceptions.APIError.code`), não um `except Exception:` genérico —
    erro de rede/timeout do supabase-py levanta uma exceção do httpx, não
    `APIError`, e por isso nunca cai neste except; sobe direto pro try/except do
    chamador, sem ser mascarado como "corrida" indevidamente.
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
        return

    try:
        supabase.table("conversas").insert({
            "lead_id": lead_id,
            "origem_id": origem_id,
            "agente_tipo": "Institucional",
            "canal_ativo": "meta",
            "status": "ativa",
            "metadata": breadcrumb,
        }).execute()
    except APIError as exc:
        if exc.code != "23505":
            raise  # não é violação de UNIQUE — erro real, propaga sem mascarar
        # Corrida: outra escrita (fluxo inbound) criou a linha entre o SELECT
        # acima e este INSERT. Re-busca e mescla em vez de perder o breadcrumb.
        existente_retry = supabase.table("conversas").select("id, metadata").eq(
            "lead_id", lead_id
        ).eq("origem_id", origem_id).limit(1).execute()
        if not existente_retry.data:
            raise  # não era uma corrida de verdade — propaga o erro original
        row = existente_retry.data[0]
        metadata = row.get("metadata") or {}
        metadata.update(breadcrumb)
        supabase.table("conversas").update(
            {"metadata": metadata}
        ).eq("id", row["id"]).execute()


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
        .select("id, telefone, nome")
        .eq("opt_in", True)
        .eq("bloqueado", False)
        .execute()
    )


_POSTGREST_PAGE_SIZE = 1000  # default de max rows do PostgREST/Supabase — ver _fetch_all_lead_ids_tentados_sync


def _fetch_all_lead_ids_tentados_sync(coluna_disparo: str, disparo_id: str) -> set:
    """Pagina logs_disparo em blocos de _POSTGREST_PAGE_SIZE (achado da revisão pré-QA): um
    .select() sem .range() é sujeito ao limite padrão de linhas do PostgREST/Supabase — com
    daily_limit agora podendo chegar a milhares por número (Step 6), um único disparo pode
    legitimamente passar de 1000 linhas em logs_disparo. Sem paginação, o conjunto de
    "já tentados" seria truncado silenciosamente e a retomada reenviaria mensagem real de
    WhatsApp pra quem já recebeu — não é uma hipótese, é o comportamento documentado do
    PostgREST quando o limite de linhas é atingido sem paginação explícita."""
    ids: set = set()
    offset = 0
    while True:
        res = (
            supabase.table("logs_disparo")
            .select("lead_id")
            .eq(coluna_disparo, disparo_id)
            .range(offset, offset + _POSTGREST_PAGE_SIZE - 1)
            .execute()
        )
        rows = res.data or []
        ids.update(row["lead_id"] for row in rows if row.get("lead_id"))
        if len(rows) < _POSTGREST_PAGE_SIZE:
            break
        offset += _POSTGREST_PAGE_SIZE
    return ids


def _query_leads_pendentes_sync(unidade, categorias_alvo, disparo_id):
    """Plano 008/S-WM-60 (Step 3): leads do alvo original de um item que ainda não têm
    nenhuma linha em logs_disparo pra este disparo_id — não tentados, nem com sucesso nem
    com falha (retry de quem falhou é escopo separado, não coberto aqui)."""
    leads_res = _query_leads_sync(unidade, categorias_alvo)
    leads = leads_res.data or []
    ids_ja_tentados = _fetch_all_lead_ids_tentados_sync("disparo_id", disparo_id)
    return [lead for lead in leads if lead.get("id") not in ids_ja_tentados]


def _query_leads_divulgacao_pendentes_sync(disparo_divulgacao_id):
    """Mesma ideia de _query_leads_pendentes_sync, pro motor de divulgação mensal —
    filtra por logs_disparo.disparo_divulgacao_id em vez de disparo_id."""
    leads_res = _query_leads_divulgacao_sync()
    leads = leads_res.data or []
    ids_ja_tentados = _fetch_all_lead_ids_tentados_sync("disparo_divulgacao_id", disparo_divulgacao_id)
    return [lead for lead in leads if lead.get("id") not in ids_ja_tentados]


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


# Plano 008/S-WM-60 (Step 6): daily_limit deixa de ser 1 valor global (configuracoes) e passa a
# ser por phone_number_id (meta_phone_numbers) — resolvido aqui, não mais 1x por tick do loop.
_DAILY_LIMIT_FALLBACK = 500  # decisão confirmada com Junior (2026-07-29): conservador, não bloqueia.


def _get_daily_limit_by_phone_sync(phone_number_id: str) -> int:
    """daily_limit do número; cai no fallback conservador se não configurado (NULL) ou em
    caso de erro de leitura — mesmo padrão de fail-safe já usado por _get_config_sync/
    _get_phone_by_canal_tipo_sync neste arquivo (nunca deixa uma falha de leitura travar
    o disparo inteiro)."""
    try:
        res = (
            supabase.table("meta_phone_numbers")
            .select("daily_limit")
            .eq("phone_number_id", phone_number_id)
            .limit(1)
            .execute()
        )
        if res.data and res.data[0].get("daily_limit") is not None:
            return int(res.data[0]["daily_limit"])
    except Exception as exc:
        logger.warning(f"[Campanhas] Erro ao ler daily_limit de meta_phone_numbers ({phone_number_id}): {exc}")
    return _DAILY_LIMIT_FALLBACK


def _warn_if_daily_limit_above_tier_sync(phone_number_id: str, daily_limit: int) -> None:
    """Log de observabilidade (não bloqueia disparo): daily_limit configurado acima da
    camada de mensageria confirmada no Business Manager pra este número. Silencioso quando
    messaging_limit_tier ainda não foi registrado (NULL) — isso é "não sei", não "inconsistente"."""
    try:
        res = (
            supabase.table("meta_phone_numbers")
            .select("messaging_limit_tier, messaging_limit_tier_confirmado_em")
            .eq("phone_number_id", phone_number_id)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        logger.warning(f"[Campanhas] Erro ao ler messaging_limit_tier ({phone_number_id}): {exc}")
        return
    if not res.data:
        return
    tier_registrado = res.data[0].get("messaging_limit_tier")
    if tier_registrado is not None and daily_limit > tier_registrado:
        logger.warning(
            f"[campanhas] daily_limit ({daily_limit}) do phone_number_id={phone_number_id} está acima da camada "
            f"de mensageria confirmada ({tier_registrado}, em {res.data[0].get('messaging_limit_tier_confirmado_em')}) — "
            f"confirmar no Business Manager antes de continuar disparando neste volume."
        )


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
) -> tuple[bool, str | None]:
    """POST Graph API v23.0 com type=template. Retorna (sucesso, wamid).

    S-WM-57: captura o wamid (WhatsApp message ID) da resposta de sucesso da Graph
    API — necessário pra correlacionar com os eventos statuses[] (entregue/lido/
    falhou) que o webhook da Meta manda depois, ver worker/meta_adapter_inbound.py.
    """
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
            wamid = None
            try:
                wamid = resp.json().get("messages", [{}])[0].get("id")
            except Exception:
                pass
            return True, wamid
        logger.warning(f"[Meta] HTTP {resp.status_code} para {to}: {resp.text[:200]}")
        return False, None
    except Exception as exc:
        logger.error(f"[Meta] Erro ao enviar template {template_name!r} para {to}: {type(exc).__name__}")
        return False, None


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

    # S-WM-57: disparo_id criado ANTES do loop (não mais só no fim) — cada linha do
    # ledger (logs_disparo) grava referenciando um disparo_id que já existe desde o
    # 1º envio, mesmo se o loop pausar/truncar no meio (error_threshold/daily_limit).
    tipo_disparo = "pontual" if origem == "eventos_pontuais" else "mensal"
    disparo_id = await asyncio.to_thread(_criar_disparo_sync, {
        "tipo": tipo_disparo,
        "evento_id": item_id if origem == "eventos_pontuais" else None,
        "campanha_mensal_id": item_id if origem == "campanhas_mensais" else None,
        "instancia_uazapi": phone_number_id,
        "mensagem_template": template_name,
        "midia_url": None,
        "total_destinatarios": total,
        "total_enviados": 0,
        "total_erros": 0,
        "status": "em_andamento",
        "iniciado_em": datetime.now(timezone.utc).isoformat(),
        "concluido_em": None,
    })

    logger.info(
        f"Item {item_id} ({origem}): Disparando para {total} leads | "
        f"Template: {template_name} | phone={phone_number_id}"
    )

    # Plano 008/S-WM-60 (Step 1+3): loop de envio extraído pra _enviar_para_leads_pendentes,
    # compartilhado com a retomada manual (retomar_disparo_pausado) — ver a função abaixo
    # pra status pausada_limite_diario (em vez de concluida falso) e resolução de daily_limit
    # por número.
    await _enviar_para_leads_pendentes(item, origem, disparo_id, leads, delay_min, delay_max, daily_limit, error_threshold)


async def _enviar_para_leads_pendentes(
    item: dict,
    origem: str,
    disparo_id: str,
    leads: list,
    delay_min: int,
    delay_max: int,
    daily_limit: int | None,
    error_threshold: int,
    usar_contagem_cumulativa: bool = False,
) -> dict:
    """Loop de envio compartilhado entre o caminho fresco (_processar_item_disparo_interno)
    e a retomada manual (retomar_disparo_pausado) — extraído no Plano 008/S-WM-60 pra não
    duplicar envio/breadcrumb/ledger/pausa entre os 2 caminhos.

    `leads` é a lista de destinatários A ENVIAR nesta chamada (todos os elegíveis no
    caminho fresco; só os pendentes, sem logs_disparo, na retomada). daily_limit/
    error_threshold se aplicam a esta chamada — uma retomada que bate o limite de novo
    pausa de novo, comportamento esperado, não um bug.

    Resolve canal_info/template de novo internamente (mesma resolução que o caminho fresco
    já fez em _processar_item_disparo_interno antes de chegar aqui) — redundante mas
    inofensivo: por essa altura a resolução já foi confirmada bem-sucedida uma vez (senão
    a função chamadora já teria retornado antes de chegar aqui), e a retomada precisa da
    própria resolução de qualquer forma (não passou por _processar_item_disparo_interno).

    usar_contagem_cumulativa=True (só na retomada) faz a finalização de sucesso reler
    total_enviados/total_erros de logs_disparo (histórico completo do disparo, caminho
    fresco + qualquer retomada anterior) em vez dos contadores locais desta chamada, que
    numa retomada só refletem o que ELA enviou. Default False preserva o caminho fresco
    idêntico ao comportamento anterior a esta extração (sem chamada extra a logs_disparo)."""
    item_id = item.get("id")
    unidade = item.get("unidade_cuca") or item.get("unidade_cuca_id") or item.get("unidade_id")

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
        return {"status": "pausada", "motivo": "sem phone_number_id ativo"}

    phone_number_id, meta_token = canal_info

    if daily_limit is None:
        daily_limit = await asyncio.to_thread(_get_daily_limit_by_phone_sync, phone_number_id)
        await asyncio.to_thread(_warn_if_daily_limit_above_tier_sync, phone_number_id, daily_limit)

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
        return {"status": "pausada", "motivo": "sem template aprovado"}
    _tpl_row = _tpl_res.data[0]
    template_name = _tpl_row["nome"]
    variaveis_item = _tpl_row.get("variaveis")

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
            logger.warning(f"Limite diário atingido ({daily_limit}). Pausando (retomada manual).")
            await asyncio.to_thread(_update_db_sync, origem, item_id, {"status": "pausada_limite_diario"})
            await asyncio.to_thread(_update_db_sync, "disparos", disparo_id, {
                "status": "pausada_limite_diario",
                "total_enviados": sucessos,
                "total_erros": erros,
                "concluido_em": datetime.now(timezone.utc).isoformat(),
            })
            return {"status": "pausada_limite_diario", "sucessos": sucessos, "erros": erros}

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

        ok, wamid = await _enviar_template_meta(phone_number_id, numero, meta_token, template_name, components)
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

        # S-WM-57: ledger por destinatário (logs_disparo) — sempre em try/except próprio,
        # nunca deixa uma falha de gravação virar erro contado nem parar o loop.
        lead_id_ledger = lead.get("id")
        if lead_id_ledger:
            try:
                await asyncio.to_thread(
                    lambda: supabase.table("logs_disparo").insert({
                        "disparo_id": disparo_id,
                        "lead_id": lead_id_ledger,
                        "telefone": numero,
                        "wamid": wamid,
                        "status": "enviado" if ok else "falhou",
                    }).execute()
                )
            except Exception as ledger_err:
                logger.warning(f"[Ledger] Erro ao gravar logs_disparo: {ledger_err}")

        if (i + 1) > 5:
            taxa_erro = (erros / (i + 1)) * 100
            if taxa_erro > error_threshold:
                logger.error(f"Taxa de erro {taxa_erro:.1f}% > {error_threshold}%. Pausando!")
                await asyncio.to_thread(_update_db_sync, origem, item_id, {"status": "pausada"})
                await asyncio.to_thread(_update_db_sync, "disparos", disparo_id, {
                    "status": "pausada",
                    "total_enviados": sucessos,
                    "total_erros": erros,
                    "concluido_em": datetime.now(timezone.utc).isoformat(),
                })
                return {"status": "pausada", "sucessos": sucessos, "erros": erros}

    total_enviados_final = sucessos
    total_erros_final = erros
    if usar_contagem_cumulativa:
        # Plano 008 (Step 3) pede contagem cumulativa de logs_disparo aqui, mas a query
        # literal do plano (status = 'enviado') SUBCONTA: o webhook da Meta (S-WM-57) avança
        # o status de 'enviado' pra 'entregue'/'lido'/'apagada' assim que a confirmação
        # chega — linhas de uma retomada anterior quase sempre já deixaram de estar em
        # 'enviado'. Confirmado com dado real (disparo 91ed62f2, 2026-07-29): total_enviados
        # real = 4, mas count(status='enviado') = 3 (1 já tinha virado 'entregue'). Por isso
        # uso aqui a convenção já validada na RPC listar_disparos_acompanhamento (S-WM-58):
        # enviados = status <> 'falhou', erros = status IN ('falhou', 'aviso') — desvio
        # deliberado da query literal do plano, não um erro de leitura.
        enviados_res = await asyncio.to_thread(
            lambda: supabase.table("logs_disparo").select("id", count="exact")
            .eq("disparo_id", disparo_id).neq("status", "falhou").execute()
        )
        erros_res = await asyncio.to_thread(
            lambda: supabase.table("logs_disparo").select("id", count="exact")
            .eq("disparo_id", disparo_id).in_("status", ["falhou", "aviso"]).execute()
        )
        total_enviados_final = enviados_res.count or 0
        total_erros_final = erros_res.count or 0

    await asyncio.to_thread(_update_db_sync, "disparos", disparo_id, {
        "status": "concluida",
        "total_enviados": total_enviados_final,
        "total_erros": total_erros_final,
        "concluido_em": datetime.now(timezone.utc).isoformat(),
    })
    await asyncio.to_thread(_update_db_sync, origem, item_id, {
        "status": "concluida",
        "disparo_id": disparo_id,
    })
    logger.info(f"Disparo {item_id} concluído. Sucessos: {total_enviados_final} | Erros: {total_erros_final}")
    return {"status": "concluida", "sucessos": total_enviados_final, "erros": total_erros_final}


async def retomar_disparo_pausado(
    item_id: str,
    origem: str,
    delay_min: int,
    delay_max: int,
    daily_limit: int | None,
    error_threshold: int,
) -> dict:
    """Plano 008/S-WM-60 (Step 3): retomada manual (nunca automática) de um item pausado
    por daily_limit. Chamada só pelo endpoint /retomar-disparo/{origem}/{item_id}
    (worker/main.py) — não faz parte do campanhas_loop() nem dos claims automáticos."""
    item_res = supabase.table(origem).select("*").eq("id", item_id).limit(1).execute()
    if not item_res.data:
        return {"status": "erro", "motivo": "item não encontrado"}
    item = item_res.data[0]
    if item.get("status") != "pausada_limite_diario":
        return {"status": "erro", "motivo": f"item não está pausado por limite diário (status atual: {item.get('status')!r})"}
    disparo_id = item.get("disparo_id")
    if not disparo_id:
        return {"status": "erro", "motivo": "item pausado sem disparo_id associado — não deveria acontecer, investigar manualmente"}

    unidade = item.get("unidade_cuca") or item.get("unidade_cuca_id") or item.get("unidade_id")
    categorias_alvo = item.get("categorias_alvo") or None
    if isinstance(categorias_alvo, list) and len(categorias_alvo) == 0:
        categorias_alvo = None

    pendentes = await asyncio.to_thread(_query_leads_pendentes_sync, unidade, categorias_alvo, disparo_id)
    if not pendentes:
        # Todo mundo já foi tentado (situação rara: pausou, mas nada realmente ficou de
        # fora) — fecha usando contagem cumulativa, não os contadores locais (não há
        # execução local nesta chamada — nada foi enviado agora).
        enviados_res = await asyncio.to_thread(
            lambda: supabase.table("logs_disparo").select("id", count="exact")
            .eq("disparo_id", disparo_id).neq("status", "falhou").execute()
        )
        erros_res = await asyncio.to_thread(
            lambda: supabase.table("logs_disparo").select("id", count="exact")
            .eq("disparo_id", disparo_id).in_("status", ["falhou", "aviso"]).execute()
        )
        await asyncio.to_thread(_update_db_sync, "disparos", disparo_id, {
            "status": "concluida",
            "total_enviados": enviados_res.count or 0,
            "total_erros": erros_res.count or 0,
            "concluido_em": datetime.now(timezone.utc).isoformat(),
        })
        await asyncio.to_thread(_update_db_sync, origem, item_id, {"status": "concluida"})
        return {"status": "concluida", "pendentes_encontrados": 0}

    await asyncio.to_thread(_update_db_sync, origem, item_id, {"status": "em_andamento"})
    await asyncio.to_thread(_update_db_sync, "disparos", disparo_id, {"status": "em_andamento"})
    resultado = await _enviar_para_leads_pendentes(
        item, origem, disparo_id, pendentes, delay_min, delay_max, daily_limit, error_threshold,
        usar_contagem_cumulativa=True,
    )
    return {"status": "retomado", "pendentes_encontrados": len(pendentes), **resultado}


# ─── Loop de Campanhas ────────────────────────────────────────────────────────

async def campanhas_loop():
    """Loop principal: checa aprovações a cada 30s sem bloquear o event loop."""
    logger.info("Iniciando Motor de Campanhas Meta...")
    await asyncio.sleep(5)

    while True:
        try:
            delay_min = await get_config("anti_ban_delay_min", 2000)
            delay_max = await get_config("anti_ban_delay_max", 5000)
            error_threshold = await get_config("anti_ban_error_threshold", 10)
            # Plano 008/S-WM-60 (Step 6): daily_limit deixa de ser lido aqui (1 valor global,
            # 1x por tick) — None é passado adiante e cada função de disparo/retomada resolve
            # por phone_number_id (_get_daily_limit_by_phone_sync), depois de saber qual
            # número Meta está usando. configuracoes.anti_ban_daily_limit não é mais lido
            # pra decisão de disparo (pode continuar na tabela por histórico).
            daily_limit = None

            # Plano 008/S-WM-60 (Step 5): visibilidade (log CRITICAL), sem nenhuma ação
            # automática — não desbloqueia a linha, não retenta nada. Um disparo travado em
            # em_andamento por mais de 2h é sinal de queda do worker no meio do envio;
            # decisão de o que fazer é manual (ver Maintenance notes do plano).
            stuck_res = await asyncio.to_thread(
                lambda: supabase.table("disparos").select("id, tipo, iniciado_em")
                .eq("status", "em_andamento")
                .lt("iniciado_em", (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat())
                .execute()
            )
            for stuck in (stuck_res.data or []):
                logger.critical(
                    f"[campanhas][DISPARO-TRAVADO] disparo {stuck['id']} (tipo={stuck.get('tipo')}) "
                    f"em 'em_andamento' desde {stuck.get('iniciado_em')} — provável queda do worker "
                    f"no meio do envio. Requer investigação manual (não há retomada automática)."
                )

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

# Plano 008/S-WM-60: içado pra nível de módulo (antes local a processar_disparos_divulgacao)
# porque retomar_disparo_divulgacao_pausado também precisa resolver mes_nome a partir de
# disparos_divulgacao.mes — o endpoint de retomada (Step 4) só recebe disparo_id, sem mes_nome.
_MESES = {
    1: "Janeiro", 2: "Fevereiro", 3: "Março", 4: "Abril",
    5: "Maio", 6: "Junho", 7: "Julho", 8: "Agosto",
    9: "Setembro", 10: "Outubro", 11: "Novembro", 12: "Dezembro",
}


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
    leads_res = await asyncio.to_thread(_query_leads_divulgacao_sync)
    leads = leads_res.data or []

    if len(leads) == 0:
        logger.info(f"[Divulgação] Sem leads elegíveis. Concluindo.")
        await asyncio.to_thread(_update_metricas_sync, disparo_id, 0, 0, 0, "concluido")
        return

    # Plano 008/S-WM-60 (Step 2+3): loop de envio extraído pra
    # _enviar_divulgacao_para_leads_pendentes, compartilhado com a retomada manual
    # (retomar_disparo_divulgacao_pausado) — não pedido explicitamente pelo Step 3 do plano
    # (que só detalha a extração do lado pontual), mas necessário aqui pelo mesmo motivo:
    # não duplicar a lógica de envio/breadcrumb/ledger entre os 2 caminhos.
    await _enviar_divulgacao_para_leads_pendentes(
        disparo_id, mes_nome, leads, delay_min, delay_max, daily_limit, error_threshold
    )


async def _enviar_divulgacao_para_leads_pendentes(
    disparo_id: str,
    mes_nome: str,
    leads: list,
    delay_min: int,
    delay_max: int,
    daily_limit: int | None,
    error_threshold: int,
    usar_contagem_cumulativa: bool = False,
) -> dict:
    """Loop de envio compartilhado entre o caminho fresco (_processar_disparo_divulgacao_interno)
    e a retomada manual (retomar_disparo_divulgacao_pausado) — mesma lógica de
    _enviar_para_leads_pendentes (lado pontual), adaptada ao formato de divulgação
    (leads[:total] em vez de break no meio do loop, _update_metricas_sync em vez de
    _update_db_sync em 2 tabelas)."""
    canal_info = await asyncio.to_thread(_get_phone_by_canal_tipo_sync, "Institucional")
    if not canal_info:
        logger.error(f"[Divulgação] Nenhum phone_number_id Meta ativo para Institucional. Pausando {disparo_id}.")
        await asyncio.to_thread(_update_metricas_sync, disparo_id, 0, 0, 0, "pausado")
        return {"status": "pausado", "motivo": "sem phone_number_id ativo"}

    phone_number_id, meta_token = canal_info

    if daily_limit is None:
        daily_limit = await asyncio.to_thread(_get_daily_limit_by_phone_sync, phone_number_id)
        await asyncio.to_thread(_warn_if_daily_limit_above_tier_sync, phone_number_id, daily_limit)

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
        return {"status": "pausado", "motivo": "sem template aprovado"}
    _tpl_div_row = _tpl_div.data[0]
    template_divulgacao = _tpl_div_row["nome"]
    variaveis_divulgacao = _tpl_div_row.get("variaveis")

    limitado_por_daily_limit = len(leads) > daily_limit
    total = min(len(leads), daily_limit)

    if total == 0:
        logger.info(f"[Divulgação] Sem leads elegíveis. Concluindo.")
        await asyncio.to_thread(_update_metricas_sync, disparo_id, 0, 0, 0, "concluido")
        return {"status": "concluido", "enviados": 0, "erros": 0}

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

        ok, wamid = await _enviar_template_meta(
            phone_number_id, telefone, meta_token, template_divulgacao, components
        )
        if ok:
            enviados += 1
            # S-WM-56 (Plano 005): paridade com eventos_pontuais/ouvidoria_eventos — sem este
            # breadcrumb, deveReconhecerDisparoRecente (motor-agente) não tem como reconhecer
            # que o lead acabou de receber este disparo, e ele cai na cortesia canned genérica.
            lead_id = lead.get("id")
            if lead_id:
                tz_fortaleza = timezone(timedelta(hours=-3))
                breadcrumb = {"ultimo_disparo": {
                    "tipo": "divulgacao_mensal",
                    "id": str(disparo_id),
                    "titulo": f"Programação de {mes_nome}",
                    "enviado_em": datetime.now(tz_fortaleza).isoformat(),
                }}
                try:
                    _gravar_breadcrumb_disparo(lead_id, phone_number_id, breadcrumb)
                except Exception as bc_err:
                    logger.warning(f"[Breadcrumb] Erro ao gravar contexto (divulgacao): {bc_err}")
        else:
            erros += 1

        # S-WM-57: ledger por destinatário (logs_disparo) — mesmo padrão do motor
        # eventos_pontuais/ouvidoria, sempre em try/except próprio.
        lead_id_ledger = lead.get("id")
        if lead_id_ledger:
            try:
                await asyncio.to_thread(
                    lambda: supabase.table("logs_disparo").insert({
                        "disparo_divulgacao_id": disparo_id,
                        "lead_id": lead_id_ledger,
                        "telefone": telefone,
                        "wamid": wamid,
                        "status": "enviado" if ok else "falhou",
                    }).execute()
                )
            except Exception as ledger_err:
                logger.warning(f"[Ledger] Erro ao gravar logs_disparo (divulgacao): {ledger_err}")

        if (i + 1) > 5:
            taxa_erro = (erros / (i + 1)) * 100
            if taxa_erro > error_threshold:
                logger.error(f"[Divulgação] Taxa de erro {taxa_erro:.1f}% > {error_threshold}%. Pausando!")
                await asyncio.to_thread(_update_metricas_sync, disparo_id, enviados, erros, 0, "pausado")
                return {"status": "pausado", "enviados": enviados, "erros": erros}

    if limitado_por_daily_limit:
        logger.warning(
            f"[Divulgação] {len(leads)} elegíveis > limite diário ({daily_limit}) — "
            f"{len(leads) - total} não enviados nesta rodada. Pausando (retomada manual)."
        )
        await asyncio.to_thread(_update_metricas_sync, disparo_id, enviados, erros, 0, "pausado_limite_diario")
        return {"status": "pausado_limite_diario", "enviados": enviados, "erros": erros}

    enviados_final = enviados
    erros_final = erros
    if usar_contagem_cumulativa:
        # Mesmo desvio deliberado do lado pontual (ver _enviar_para_leads_pendentes) —
        # status <> 'falhou' / IN ('falhou','aviso'), não a query literal do plano
        # (status = 'enviado'), que subconta linhas já avançadas pelo webhook da Meta.
        enviados_res = await asyncio.to_thread(
            lambda: supabase.table("logs_disparo").select("id", count="exact")
            .eq("disparo_divulgacao_id", disparo_id).neq("status", "falhou").execute()
        )
        erros_res = await asyncio.to_thread(
            lambda: supabase.table("logs_disparo").select("id", count="exact")
            .eq("disparo_divulgacao_id", disparo_id).in_("status", ["falhou", "aviso"]).execute()
        )
        enviados_final = enviados_res.count or 0
        erros_final = erros_res.count or 0

    logger.info(f"[Divulgação] Disparo {disparo_id} concluído. Enviados: {enviados_final} | Erros: {erros_final}")
    await asyncio.to_thread(_update_metricas_sync, disparo_id, enviados_final, erros_final, 0, "concluido")
    return {"status": "concluido", "enviados": enviados_final, "erros": erros_final}


async def retomar_disparo_divulgacao_pausado(
    disparo_id: str,
    delay_min: int,
    delay_max: int,
    daily_limit: int | None,
    error_threshold: int,
) -> dict:
    """Plano 008/S-WM-60 (Step 3): retomada manual de um disparo de divulgação mensal
    pausado por daily_limit. mes_nome não vem como parâmetro (o endpoint de retomada só
    recebe disparo_id, sem mes_nome — Step 4) — resolvido aqui a partir de
    disparos_divulgacao.mes, usando o mesmo _MESES de processar_disparos_divulgacao."""
    disparo_res = supabase.table("disparos_divulgacao").select("*").eq("id", disparo_id).limit(1).execute()
    if not disparo_res.data:
        return {"status": "erro", "motivo": "disparo não encontrado"}
    disparo = disparo_res.data[0]
    if disparo.get("status") != "pausado_limite_diario":
        return {"status": "erro", "motivo": f"disparo não está pausado por limite diário (status atual: {disparo.get('status')!r})"}

    mes_nome = _MESES.get(disparo.get("mes", 0), str(disparo.get("mes", 0)))

    pendentes = await asyncio.to_thread(_query_leads_divulgacao_pendentes_sync, disparo_id)
    if not pendentes:
        enviados_res = await asyncio.to_thread(
            lambda: supabase.table("logs_disparo").select("id", count="exact")
            .eq("disparo_divulgacao_id", disparo_id).neq("status", "falhou").execute()
        )
        erros_res = await asyncio.to_thread(
            lambda: supabase.table("logs_disparo").select("id", count="exact")
            .eq("disparo_divulgacao_id", disparo_id).in_("status", ["falhou", "aviso"]).execute()
        )
        await asyncio.to_thread(_update_metricas_sync, disparo_id, enviados_res.count or 0, erros_res.count or 0, 0, "concluido")
        return {"status": "concluida", "pendentes_encontrados": 0}

    # Guarda de concorrência (achado da revisão pré-QA): sem isto, 2 chamadas simultâneas ao
    # endpoint de retomada (fire-and-forget, retorna 200 antes de terminar) passam ambas pelo
    # check de status acima antes de qualquer uma escrever — a 2ª só falharia depois de reenviar
    # pra todo mundo. O lado pontual (retomar_disparo_pausado) já flipa pra em_andamento antes de
    # despachar; aqui faltava o espelho. Fecha a janela: 2ª chamada concorrente encontra
    # status='em_andamento' (não mais 'pausado_limite_diario') e é rejeitada pelo check acima.
    # Update direto (não _update_metricas_sync) porque este só escreve status — reusar
    # _update_metricas_sync zeraria total_enviados/total_erros já acumulados na 1ª rodada.
    await asyncio.to_thread(_update_db_sync, "disparos_divulgacao", disparo_id, {"status": "em_andamento"})

    resultado = await _enviar_divulgacao_para_leads_pendentes(
        disparo_id, mes_nome, pendentes, delay_min, delay_max, daily_limit, error_threshold,
        usar_contagem_cumulativa=True,
    )
    return {"status": "retomado", "pendentes_encontrados": len(pendentes), **resultado}
