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

#: Status de `logs_disparo` que a Meta confirma como entrega de verdade (AC2).
#: `enviado` (aceito, sem confirmação), `falhou`, `aviso` e `apagada` NÃO contam.
STATUS_ENTREGUE = ("entregue", "lido")

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


def _ids_disparos_da_campanha(supabase, evento_id: str) -> list[str]:
    """Disparos da campanha = disparos do evento pontual do simulado (achado 6 do @po).

    `logs_disparo` é compartilhado com Institucional/Divulgação/Ouvidoria: sem esta restrição,
    qualquer disparo institucional entregue faria o lead passar por "recebeu o convite".
    """
    res = supabase.table("disparos").select("id").eq("evento_id", evento_id).execute()
    return [row["id"] for row in (res.data or [])]


def registrar_resposta(supabase, *, lead_id_respondente: str, telefone: str, mensagem: str) -> dict | None:
    """O porteiro. Devolve a linha gravada, ou None quando não é caso de anotar.

    Nunca levanta exceção de regra de negócio: quando não dá para anotar com segurança, loga o
    motivo (`sem_categoria`, `sem_entrega`, `pos_fechamento`, `chave_ambigua`) e devolve None —
    os motivos são distinguíveis de propósito, cada um é um cenário de teste diferente.
    """
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

    variantes = variantes_telefone(telefone)
    if not variantes:
        return None

    leads_res = supabase.table("leads").select("id, telefone").in_("telefone", variantes).execute()
    candidatos = {row["id"]: row["telefone"] for row in (leads_res.data or [])}
    if not candidatos:
        return None

    ids = list(candidatos)
    cat_res = supabase.table("lead_interesses").select("lead_id") \
        .eq("categoria_id", cfg["categoria_evento_id"]).in_("lead_id", ids).execute()
    na_categoria = {row["lead_id"] for row in (cat_res.data or [])}
    if not na_categoria:
        logger.info("[AE-porteiro][sem_categoria] %s não está na categoria do evento — ignorado", telefone)
        return None

    disparos = _ids_disparos_da_campanha(supabase, cfg["evento_id"])
    if not disparos:
        logger.warning("[AE-porteiro] Evento %s sem disparo nenhum — nada a conferir", cfg["evento_id"])
        return None

    entregas_res = supabase.table("logs_disparo") \
        .select("lead_id, disparo_id, created_at") \
        .in_("lead_id", list(na_categoria)) \
        .in_("disparo_id", disparos) \
        .in_("status", list(STATUS_ENTREGUE)) \
        .order("created_at", desc=True).execute()
    entregas = entregas_res.data or []
    if not entregas:
        # Também cobre o callback de `delivered` perdido: quem respondeu de verdade mas ficou
        # com status `enviado` cai aqui — por isso o log, nunca descarte silencioso.
        logger.info(
            "[AE-porteiro][sem_entrega] %s está na categoria mas não tem entrega comprovada de "
            "disparo da campanha — resposta %r não anotada", telefone, resposta,
        )
        return None

    convidados = {e["lead_id"] for e in entregas}
    if len(convidados) > 1:
        logger.warning(
            "[AE-porteiro][chave_ambigua] %s casa com mais de um convidado (%s) — não anotado, "
            "para não creditar a confirmação na pessoa errada", telefone, sorted(convidados),
        )
        return None

    entrega = entregas[0]  # mais recente — define o lote (AC1/AC2.4)
    lead_convidado = entrega["lead_id"]
    linha = {
        "evento_id": cfg["evento_id"],
        "lead_id": lead_convidado,
        "lead_respondente_id": lead_id_respondente,
        "disparo_id": entrega["disparo_id"],
        "lote": (cfg.get("lotes") or {}).get(entrega["disparo_id"]),
        "resposta": resposta,
        "origem": origem_da_resposta(mensagem),
        "mensagem": mensagem,
        "telefone_convite": candidatos.get(lead_convidado),
        "telefone_resposta": telefone,
        "respondido_em": datetime.now(timezone.utc).isoformat(),
        "atualizado_em": datetime.now(timezone.utc).isoformat(),
    }
    # AC5 — a última resposta vale, sem duplicar a pessoa (unique em evento_id + lead_id).
    supabase.table(TABELA).upsert(linha, on_conflict="evento_id,lead_id").execute()
    logger.info(
        "[AE-porteiro] Resposta %r (%s) anotada para lead convidado %s — lote=%s",
        resposta, linha["origem"], lead_convidado, linha["lote"],
    )
    return linha
