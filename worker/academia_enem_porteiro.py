"""
Porteiro da confirmação de presença — Simulado Academia Enem 2026 (S-AE-CONF-03).

Quando uma mensagem chega, olha o crachá: se for lead da campanha, guarda a resposta
(confirmou / não vai) numa tabela de acompanhamento. Qualquer outra mensagem segue para o
atendimento normal, sem nenhuma mudança de comportamento (AC6).

O porteiro NUNCA responde ao lead e NUNCA interrompe o fluxo do Institucional: toda falha aqui
é logada e engolida por quem chama (ver `meta_adapter_inbound.processar_webhook_meta`).

Caminho C (decisão do Junior, 17/09): a identificação da pessoa por formato de telefone vive só
dentro deste módulo. `_normalizar_telefone_br` (porta de entrada) não é tocada — o cadastro
duplicado continua sendo criado, e isso é intencional (ver "O que esta story não resolve").
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

CHAVE_CONFIG = "academia_enem_confirmacao"
TABELA = "confirmacoes_simulado_ae"

RESPOSTA_CONFIRMOU = "confirmou"
RESPOSTA_NAO_VAI = "nao_vai"

ORIGEM_BOTAO = "botao"
ORIGEM_TEXTO = "texto"

#: Rótulos exatos dos botões do template `ae_simulado_v2` (confirmados no teste de 17/09).
BOTAO_CONFIRMA = "sim, eu vou!"
BOTAO_RECUSA = "nao poderei comparecer"

# Negação vence afirmação (AC3, decisão do Junior em 17/09): "não sei se confirmo" é `nao_vai`,
# não é descartado. Por isso estes padrões são avaliados ANTES dos de confirmação.
_PADROES_NEGACAO = (
    r"\bnao\s+poderei\b", r"\bnao\s+posso\b", r"\bnao\s+vou\b", r"\bnao\s+consigo\b",
    r"\bnao\s+da\b", r"\bnao\s+vai\s+dar\b", r"\bnao\s+irei\b", r"\bnao\s+sei\b",
    r"\bnao\s+comparecerei\b", r"\bnao\b.*\bcomparecer\b", r"\bnao\b.*\bconfirm",
    r"\binfelizmente\b", r"\bdesisti", r"\bcancelar\b",
)
_PADROES_CONFIRMACAO = (
    r"\bsim\b", r"\bconfirm", r"\bvou\b", r"\birei\b", r"\bestarei\b", r"\bcompareco\b",
    r"\bcomparecerei\b", r"\bpode\s+contar\b", r"\bcerteza\b", r"\bclaro\b", r"\bbora\b",
)

_ACENTOS = str.maketrans("áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ",
                         "aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC")


def _sem_acento(texto: str) -> str:
    return texto.translate(_ACENTOS).lower().strip()


def variantes_telefone(telefone: str) -> list[str]:
    """As duas escritas possíveis do mesmo celular: com e sem o nono dígito.

    A Meta devolve o número **sem** o nono dígito para DDD 31+ (Fortaleza inclusa) e **com**
    para DDD 11-30 — conferido contra 400 envios reais. Em vez de normalizar (o que exigiria
    coluna nova em `leads` e backfill), gero as duas formas e comparo por igualdade exata, que
    usa o índice que já existe em `leads.telefone`.

    Formato inesperado (nem 12 nem 13 dígitos, DDI que não é 55) → devolve só o próprio número:
    comparação exata, nunca chave parcial (AC2.2). Melhor não achar do que achar a pessoa errada.
    """
    numero = re.sub(r"\D", "", telefone or "")
    if not numero.startswith("55"):
        return [numero] if numero else []

    if len(numero) == 13:
        # 55 DD 9 XXXXXXXX → tira o nono dígito (índice 4), sem olhar qual é o dígito:
        # `_normalizar_telefone_br` errou justamente por testar `telefone[4] != '9'`, e no caso
        # real de 17/09 o índice 4 já era um 9 (do antigo 9173-3321).
        return [numero, numero[:4] + numero[5:]]
    if len(numero) == 12:
        return [numero, numero[:4] + "9" + numero[4:]]
    return [numero]


def classificar_resposta(mensagem: str) -> str | None:
    """`confirmou`, `nao_vai` ou None (AC3/AC4).

    None = não é sim nem não (dúvida, agradecimento, assunto qualquer) — não vira resposta,
    não inventa (AC4).
    """
    texto = _sem_acento(mensagem or "")
    if not texto:
        return None
    if texto == BOTAO_CONFIRMA:
        return RESPOSTA_CONFIRMOU
    if texto == BOTAO_RECUSA:
        return RESPOSTA_NAO_VAI
    for padrao in _PADROES_NEGACAO:
        if re.search(padrao, texto):
            return RESPOSTA_NAO_VAI
    for padrao in _PADROES_CONFIRMACAO:
        if re.search(padrao, texto):
            return RESPOSTA_CONFIRMOU
    return None


def origem_da_resposta(mensagem: str) -> str:
    """Botão do template ou texto digitado (AC1/AC3)."""
    texto = _sem_acento(mensagem or "")
    return ORIGEM_BOTAO if texto in (BOTAO_CONFIRMA, BOTAO_RECUSA) else ORIGEM_TEXTO


def carregar_config(supabase) -> dict | None:
    """Configuração da campanha, em `configuracoes` (jsonb), editável sem redeploy (AC2.1).

    {"evento_id", "categoria_evento_id", "fechamento", "lotes": {disparo_id: nome}}
    Sem a linha, ou sem evento/categoria, o porteiro fica desligado — que é o comportamento
    correto fora da campanha.
    """
    try:
        res = supabase.table("configuracoes").select("valor").eq("chave", CHAVE_CONFIG).limit(1).execute()
    except Exception as exc:
        logger.warning("[AE-porteiro] Erro ao ler configuração %s: %s", CHAVE_CONFIG, exc)
        return None
    if not res.data:
        return None
    cfg = res.data[0].get("valor") or {}
    if not cfg.get("evento_id") or not cfg.get("categoria_evento_id"):
        return None
    return cfg


def campanha_aberta(cfg: dict, agora: datetime | None = None) -> bool:
    """AC2.1 — passado o fechamento, o porteiro para de anotar.

    Sem data configurada, considera FECHADA: é a leitura segura. Uma campanha sem fim anota
    para sempre, que é exatamente o cenário que a AC2.1 existe para impedir.
    """
    bruto = (cfg or {}).get("fechamento")
    if not bruto:
        return False
    try:
        limite = datetime.fromisoformat(str(bruto))
    except ValueError:
        logger.warning("[AE-porteiro] `fechamento` inválido na configuração: %r", bruto)
        return False
    if limite.tzinfo is None:
        limite = limite.replace(tzinfo=timezone.utc)
    return (agora or datetime.now(timezone.utc)) < limite


def _resolver_lead_da_campanha(supabase, cfg: dict, telefone: str, contexto: str):
    """Acha o lead da campanha a partir do telefone de quem mandou a mensagem.

    **O gatilho é a categoria do evento, e só ela** (decisão do Junior, 17/09). O túnel é:
    o disparo sai mirando a categoria do lote; a resposta entra e é reconhecida pela categoria do
    evento. Não há conferência de registro de envio — a categoria é curada à mão, só tem gente do
    edital, e depender do histórico de disparo tornava tudo frágil: cada envio novo cria um evento
    pontual novo (a programação pontual não reabre), e esquecer de registrar um deles deixava a
    planilha vazia sem dar erro nenhum.

    Devolve `{lead_id, telefone, lotes}` ou None (com o motivo no log).
    """
    variantes = variantes_telefone(telefone)
    if not variantes:
        return None

    leads_res = supabase.table("leads").select("id, telefone").in_("telefone", variantes).execute()
    candidatos = {row["id"]: row["telefone"] for row in (leads_res.data or [])}
    if not candidatos:
        return None

    # Todas as categorias dos candidatos, de uma vez: serve para o gate (categoria do evento) e
    # para descobrir o lote, sem consulta extra.
    cat_res = supabase.table("lead_interesses").select("lead_id, categoria_id") \
        .in_("lead_id", list(candidatos)).execute()
    vinculos = cat_res.data or []

    na_campanha = {v["lead_id"] for v in vinculos if v["categoria_id"] == cfg["categoria_evento_id"]}
    if not na_campanha:
        logger.info("[AE-porteiro][sem_categoria] %s não está na categoria do evento (%s)", telefone, contexto)
        return None

    if len(na_campanha) > 1:
        logger.warning(
            "[AE-porteiro][chave_ambigua] %s casa com mais de um lead da campanha (%s) — não "
            "anotado, para não creditar a resposta na pessoa errada", telefone, sorted(na_campanha),
        )
        return None

    lead_id = next(iter(na_campanha))
    mapa_lotes = cfg.get("lotes") or {}
    lote = next(
        (mapa_lotes[v["categoria_id"]] for v in vinculos
         if v["lead_id"] == lead_id and v["categoria_id"] in mapa_lotes),
        None,
    )
    return {"lead_id": lead_id, "telefone": candidatos.get(lead_id), "lote": lote}


def registrar_resposta(supabase, *, lead_id_respondente: str, telefone: str, mensagem: str) -> dict | None:
    """Anota a resposta de quem é da campanha. Devolve a linha gravada, ou None."""
    # Classificação PRIMEIRO, de propósito: é a única etapa que não toca no banco, e descarta a
    # maioria esmagadora do tráfego do Institucional ("bom dia", áudio, foto — ~460 mensagens de
    # lead por dia, medidas em produção) antes de qualquer consulta. Inverter isso custaria um
    # SELECT em `configuracoes` por mensagem que entra (achado 1 do @qa, 17/09).
    resposta = classificar_resposta(mensagem)
    if resposta is None:
        return None  # AC4 — não é sim nem não, não vira resposta

    cfg = carregar_config(supabase)
    if not cfg:
        return None

    if not campanha_aberta(cfg):
        logger.info(
            "[AE-porteiro][pos_fechamento] Resposta %r de %s chegou depois do fechamento — não anotada",
            resposta, telefone,
        )
        return None

    achado = _resolver_lead_da_campanha(supabase, cfg, telefone, contexto=f"resposta={resposta!r}")
    if not achado:
        return None

    linha = {
        "evento_id": cfg["evento_id"],
        "lead_id": achado["lead_id"],
        "lead_respondente_id": lead_id_respondente,
        "lote": achado["lote"],
        "resposta": resposta,
        "origem": origem_da_resposta(mensagem),
        "mensagem": mensagem,
        "telefone_convite": achado["telefone"],
        "telefone_resposta": telefone,
        "respondido_em": datetime.now(timezone.utc).isoformat(),
        "atualizado_em": datetime.now(timezone.utc).isoformat(),
    }
    # AC5 — a última resposta vale, sem duplicar a pessoa (unique em evento_id + lead_id).
    supabase.table(TABELA).upsert(linha, on_conflict="evento_id,lead_id").execute()
    logger.info(
        "[AE-porteiro] Resposta %r (%s) anotada para lead convidado %s — lote=%s",
        resposta, linha["origem"], achado["lead_id"], linha["lote"],
    )
    return linha


# ── Pergunta de horário ────────────────────────────────────────────────────
# Os horários não entraram no template (não deu tempo de aprovar a edição na Meta) e, no teste
# real de 17/09, deixar o agente responder não funcionou: perguntado "Qual o horario?", ele
# respondeu sobre turma de natação — o assunto anterior da conversa pesou mais que o documento
# de FAQ. Para quem é da campanha, o porteiro responde direto, com texto fixo.

_PADROES_HORARIO = (
    r"\bque\s+horas?\b", r"\bqual\s+(o\s+)?hor[aá]rio\b", r"\bhor[aá]rio\b", r"\bhoras?\b",
    r"\bque\s+hora\b", r"\bcomeca\b.*\bque\b", r"\babre\b.*\bport[oõ]es\b",
    r"\bport[oõ]es\b", r"\btermina\b", r"\bacaba\b",
)

TEXTO_HORARIOS = (
    "Aqui estão os horários do Simulado Academia Enem 👇\n\n"
    "*20 de setembro (sábado)*\n"
    "12:00 — portões abrem\n"
    "13:00 — alunos em sala\n"
    "13:30 — início da prova\n"
    "15:00 — liberação para deixar o local\n"
    "19:00 — fim da prova (alunos com necessidades especiais)\n"
    "20:00 — fim da prova (demais alunos)\n\n"
    "*27 de setembro (sábado)*\n"
    "12:00 — portões abrem\n"
    "13:00 — alunos em sala\n"
    "13:30 — início da prova\n"
    "15:00 — liberação para deixar o local\n"
    "18:30 — fim da prova (alunos com necessidades especiais)\n"
    "19:30 — fim da prova (demais alunos)\n\n"
    "📍 Unichristus — Campus Benfica, Rua Princesa Isabel, 1920 "
    "(entrada pela Rua Luís de Miranda, 536)"
)


def pergunta_horario(mensagem: str) -> bool:
    """True quando a mensagem é pergunta de horário."""
    texto = _sem_acento(mensagem or "")
    if not texto:
        return False
    return any(re.search(padrao, texto) for padrao in _PADROES_HORARIO)


def processar_mensagem_campanha(supabase, *, lead_id_respondente: str, telefone: str, mensagem: str) -> dict | None:
    """Ponto de entrada único do porteiro, usado pelo inbound.

    - Resposta de presença (sim/não) → anota e devolve `{"anotou": ...}`; o atendimento segue
      normal (AC6).
    - Pergunta de horário de quem é da campanha → devolve `{"responder": TEXTO_HORARIOS}`, e aí
      o inbound responde isso **no lugar** do agente.
    - Qualquer outra coisa → None, nada muda.
    """
    anotado = registrar_resposta(
        supabase, lead_id_respondente=lead_id_respondente, telefone=telefone, mensagem=mensagem,
    )
    if anotado:
        return {"anotou": anotado}

    if not pergunta_horario(mensagem):
        return None

    cfg = carregar_config(supabase)
    if not cfg or not campanha_aberta(cfg):
        return None
    if not _resolver_lead_da_campanha(supabase, cfg, telefone, contexto="pergunta de horário"):
        return None

    logger.info("[AE-porteiro] Pergunta de horário de %s respondida com texto fixo", telefone)
    return {"responder": TEXTO_HORARIOS}


def eh_lead_da_campanha(supabase, telefone: str) -> bool:
    """True se o telefone é de alguém da campanha e a campanha ainda está aberta.

    Usado num caminho raro (quando o agente decide encerrar a conversa), por isso pode pagar as
    consultas — não roda em toda mensagem.
    """
    cfg = carregar_config(supabase)
    if not cfg or not campanha_aberta(cfg):
        return False
    return _resolver_lead_da_campanha(supabase, cfg, telefone, contexto="checagem de encerramento") is not None
