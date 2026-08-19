"""
S29-S31 — Motor de Empregabilidade via WhatsApp
Instância unificada: atende empresa, candidato ativo e grande público no mesmo número.

Máquina de estados armazenada em conversas.metadata["empreg_fluxo"].
"""

import os
import re
import logging
import asyncio
import hashlib
import hmac
import time
import contextvars
import threading
from contextlib import asynccontextmanager
from datetime import date
from urllib.parse import urlencode
from supabase import create_client, Client

logger = logging.getLogger("empregabilidade_engine")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
PORTAL_URL = os.getenv("PORTAL_URL", "https://www.cucaatendemais.com.br")
_LINK_SECRET = os.getenv("EMPREGABILIDADE_LINK_SECRET", "")


class _EmptySupabaseResult:
    data: list = []


class _EmptySupabaseTable:
    def select(self, *args, **kwargs):
        return self

    def eq(self, *args, **kwargs):
        return self

    def ilike(self, *args, **kwargs):
        return self

    def in_(self, *args, **kwargs):
        return self

    def order(self, *args, **kwargs):
        return self

    def limit(self, *args, **kwargs):
        return self

    def single(self):
        return self

    def maybe_single(self):
        return self

    @property
    def not_(self):
        return self

    def execute(self):
        return _EmptySupabaseResult()


class _EmptySupabaseClient:
    def table(self, *args, **kwargs):
        return _EmptySupabaseTable()


supabase: Client | _EmptySupabaseClient = (
    create_client(SUPABASE_URL, SUPABASE_KEY)
    if SUPABASE_URL and SUPABASE_KEY
    else _EmptySupabaseClient()
)

_PALAVRAS_ENCERRAR = {
    "tchau", "até mais", "até logo", "encerrar", "finalizar", "obrigado",
    "obrigada", "valeu", "pronto", "pode fechar", "ok pode fechar",
    "nada mais", "só isso", "era isso",
}
_REGEX_NUMERO_VAGA_ISOLADO = re.compile(r"(?:^|\s)(\d{1,4})(?:\s|$)")

_MENU_ACOES_EMPRESA = (
    "1️⃣ Cadastrar nova vaga\n"
    "2️⃣ Consultar status de uma vaga\n"
    "3️⃣ Editar uma vaga\n"
    "4️⃣ Cancelar uma vaga\n\n"
    "Responda com *1*, *2*, *3* ou *4*."
)

_AFIRMATIVO_CONFIRMACAO = ("sim", "s", "confirmar", "confirmo", "ok")
_AFIRMATIVO_CONFIRMACAO_DETALHADA = (
    *_AFIRMATIVO_CONFIRMACAO,
    "correto",
    "certo",
    "isso",
)
_AFIRMATIVO_CANCELAMENTO = (*_AFIRMATIVO_CONFIRMACAO, "yes")
_AFIRMATIVO_CRIAR_VAGA = ("sim", "s", "quero", "vou", "yes", "ok", "1")
_AFIRMATIVO_ROTA = (*_AFIRMATIVO_CONFIRMACAO_DETALHADA, "exato")
_NEGATIVO_ATENDENTE_HUMANO = ("não", "nao", "n", "negativo")
_LIMIAR_FALHAS_OFERTA_ATENDENTE = 2
_ETAPAS_OFERTA_ATENDENTE = {
    "listou_categorias",
    "listando_cargos_selecao",
    "aguardando_escolha_unidade",
    # S-EMP-AUD-023 passo 2: novas etapas de listagem por cargo consolidado
    "listou_cargos_consolidados",
    "listou_ocorrencias_cargo",
}
_ETAPA_ANTERIOR = {
    "listou_categorias": "inicio",
    "listou_vagas": "listou_categorias",
    "listando_cargos_selecao": "listou_vagas",
    "aguardando_escolha_unidade": "listou_vagas",
    # S-EMP-AUD-023 passo 2 (seção 5, regra 6): "voltar" nas etapas novas
    "listou_cargos_consolidados": "inicio",
    "listou_ocorrencias_cargo": "listou_cargos_consolidados",
}
_RESPOSTAS_ENTREVISTA_BINARIA = ("sim", "s", "não", "nao", "n", "✅", "❌")
_CONFIRMA_ENTREVISTA = ("sim", "s", "✅")
_ETAPAS_NOTIFY_PORTAL = (
    "aguardando_retorno_vaga",
    "aguardando_retorno_edicao",
    "aguardando_confirmacao_candidatura",
    "aguardando_retorno_selecao",
)


def _assinar_link_portal(path: str, params: dict, ttl_horas: int = 48) -> str:
    """Gera link do portal com HMAC e expiração para evitar capability URL crua."""
    clean_params = {
        key: str(value)
        for key, value in params.items()
        if value is not None and str(value) != ""
    }
    if not _LINK_SECRET:
        logger.error(
            "[link-assinado] EMPREGABILIDADE_LINK_SECRET não configurada — gerando link SEM assinatura"
        )
        return f"{PORTAL_URL}{path}?{urlencode(clean_params)}"

    signed_params = {
        **clean_params,
        "exp": str(int(time.time()) + ttl_horas * 3600),
    }
    canonical = urlencode(sorted(signed_params.items()))
    sig = hmac.new(_LINK_SECRET.encode(), canonical.encode(), hashlib.sha256).hexdigest()
    return f"{PORTAL_URL}{path}?{urlencode({**signed_params, 'sig': sig})}"


def _criar_ou_recuperar_talent_bank(nome: str, telefone: str) -> str:
    """Cria/recupera candidato por telefone para o currículo público estruturado."""
    tel_norm = re.sub(r"\D", "", telefone or "")
    if (len(tel_norm) in (12, 13)) and tel_norm.startswith("55"):
        tel_norm = tel_norm[2:]
    if not tel_norm:
        raise RuntimeError("telefone obrigatório para criar currículo público")

    existing = (
        supabase.table("talent_bank")
        .select("id")
        .eq("telefone", tel_norm)
        .limit(1)
        .execute()
    )
    rows = existing.data or []
    payload = {
        "nome": nome,
        "telefone": tel_norm,
        "status": "disponivel",
    }
    if rows:
        talent_id = rows[0]["id"]
        supabase.table("talent_bank").update(payload).eq("id", talent_id).execute()
        return talent_id

    created = supabase.table("talent_bank").insert(payload).execute()
    created_rows = created.data or []
    if not created_rows:
        raise RuntimeError("não foi possível criar candidato no banco de talentos")
    return created_rows[0]["id"]


# ---------------------------------------------------------------------------
# Envio de mensagem de texto via Meta Cloud API (S-WM-02)
# ---------------------------------------------------------------------------

def _montar_historico(conversa_id: str, limite: int = 6) -> str:
    """Busca últimas mensagens da conversa e formata como histórico legível."""
    try:
        res = (
            supabase.table("mensagens")
            .select("remetente, conteudo, created_at")
            .eq("conversa_id", conversa_id)
            .order("created_at", desc=True)
            .limit(limite)
            .execute()
        )
        msgs = list(reversed(res.data or []))
        if not msgs:
            return "(sem histórico disponível)"
        linhas = []
        for m in msgs:
            quem = "👤 Lead" if m["remetente"] == "lead" else "🤖 IA"
            conteudo = (m["conteudo"] or "")[:120]
            linhas.append(f"{quem}: {conteudo}")
        return "\n".join(linhas)
    except Exception:
        return "(erro ao carregar histórico)"


def _ultima_mensagem_bot(conversa_id: str) -> str | None:
    """Busca a última mensagem enviada pelo agente, para dar contexto ao
    classificador semântico (S-WM-20 Task 3)."""
    try:
        res = (
            supabase.table("mensagens")
            .select("conteudo")
            .eq("conversa_id", conversa_id)
            .eq("remetente", "agente")
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        return rows[0]["conteudo"] if rows else None
    except Exception:
        return None


def _get_meta_phone(agente_tipo: str) -> tuple[str, str]:
    """Retorna (phone_number_id, system_token) para o agente desde meta_phone_numbers."""
    try:
        res = supabase.table("meta_phone_numbers") \
            .select("phone_number_id") \
            .eq("agente_tipo", agente_tipo) \
            .eq("ativo", True) \
            .order("phone_number_id") \
            .limit(1) \
            .single() \
            .execute()
        pnid = (res.data or {}).get("phone_number_id", "")
    except Exception as exc:
        logger.error("[meta-phone] Erro ao buscar phone_number_id para %s: %s", agente_tipo, exc)
        pnid = ""
    return pnid, os.getenv("META_SYSTEM_USER_TOKEN", "")


async def _enviar(instance_name: str, token: str, phone: str, texto: str, conversa_id: str = "", lead_id: str = "") -> bool:
    """Envia texto via Meta.

    `token` permanece na assinatura por compatibilidade com chamadas antigas;
    o envio real usa META_SYSTEM_USER_TOKEN, como já ocorria historicamente.
    """
    from meta_adapter_outbound import _meta_enviar  # noqa: PLC0415
    ok = await _meta_enviar(
        instance_name,
        phone,
        texto,
        os.getenv("META_SYSTEM_USER_TOKEN", ""),
    )
    # Gravar no painel somente em envio bem-sucedido (AC #8)
    if ok and conversa_id:
        def _inserir():
            return supabase.table("mensagens").insert({
                "conversa_id": conversa_id,
                "lead_id": lead_id or None,
                "remetente": "agente",
                "tipo": "text",
                "conteudo": texto,
            }).execute()
        try:
            await asyncio.to_thread(_inserir)
        except Exception as _e:
            logger.error(f"[_enviar] Falha ao gravar mensagem bot no DB: {_e}", exc_info=True)
    return ok


# ---------------------------------------------------------------------------
# Consulta CNPJ Brasil API (Receita Federal)
# ---------------------------------------------------------------------------

async def _consultar_cnpj(cnpj: str) -> dict | None:
    """Retorna dados da empresa pelo CNPJ via API pública cnpj.ws ou None se inválido/não encontrado."""
    cnpj_limpo = re.sub(r"\D", "", cnpj)
    if len(cnpj_limpo) != 14:
        return None
    try:
        import httpx  # noqa: PLC0415
        async with httpx.AsyncClient(timeout=10) as client:
            res = await client.get(f"https://publica.cnpj.ws/cnpj/{cnpj_limpo}")
            if res.status_code == 200:
                return res.json()
            return None
    except Exception as e:
        logger.warning(f"[CNPJ API] Erro ao consultar {cnpj_limpo[:6]}********: {e}")
        return None


def _formatar_dados_cnpj(dados: dict) -> str:
    """Formata os dados retornados pela API em uma mensagem legível."""
    nome = dados.get("razao_social") or dados.get("nome_fantasia") or "Não informado"
    fantasia = dados.get("nome_fantasia") or ""
    cnpj_fmt = dados.get("cnpj") or ""
    situacao = (dados.get("situacao_cadastral") or {}).get("descricao", "")
    endereco = dados.get("estabelecimento", {}) or {}
    logradouro = endereco.get("logradouro") or ""
    numero = endereco.get("numero") or ""
    municipio = (endereco.get("municipio") or {}).get("descricao", "")
    uf = endereco.get("uf") or ""
    email = endereco.get("email") or ""
    telefone1 = endereco.get("telefone1") or ""

    linhas = [
        "📋 *Dados encontrados na Receita Federal:*",
        f"🏢 *Razão Social:* {nome}",
    ]
    if fantasia and fantasia.upper() != nome.upper():
        linhas.append(f"🏷️ *Nome Fantasia:* {fantasia}")
    linhas.append(f"🔢 *CNPJ:* {cnpj_fmt}")
    if situacao:
        linhas.append(f"📌 *Situação:* {situacao}")
    if logradouro:
        linhas.append(f"📍 *Endereço:* {logradouro}, {numero} — {municipio}/{uf}")
    if email:
        linhas.append(f"📧 *E-mail:* {email}")
    if telefone1:
        linhas.append(f"📞 *Telefone:* {telefone1}")
    return "\n".join(linhas)


# ---------------------------------------------------------------------------
# Leitura e gravação do estado no banco
# ---------------------------------------------------------------------------

def _get_fluxo(conversa_id: str) -> dict:
    res = supabase.table("conversas").select("metadata").eq("id", conversa_id).single().execute()
    metadata = (res.data or {}).get("metadata") or {}
    return metadata.get("empreg_fluxo", {})


def _set_fluxo(conversa_id: str, fluxo: dict):
    res = supabase.table("conversas").select("metadata").eq("id", conversa_id).single().execute()
    metadata = (res.data or {}).get("metadata") or {}
    metadata["empreg_fluxo"] = fluxo
    supabase.table("conversas").update({"metadata": metadata}).eq("id", conversa_id).execute()


_GET_FLUXO_SYNC = _get_fluxo
_SET_FLUXO_SYNC = _set_fluxo
_ULTIMA_MENSAGEM_BOT_SYNC = _ultima_mensagem_bot
_FLUXO_LOCKS: dict[tuple[asyncio.AbstractEventLoop, str], asyncio.Lock] = {}
_FLUXO_LOCKS_GUARD = threading.Lock()
_FLUXO_LOCKS_HELD: contextvars.ContextVar[frozenset[str]] = contextvars.ContextVar(
    "empreg_fluxo_locks_held",
    default=frozenset(),
)


async def _obter_fluxo_lock(conversa_id: str) -> asyncio.Lock:
    key = (asyncio.get_running_loop(), conversa_id)
    with _FLUXO_LOCKS_GUARD:
        lock = _FLUXO_LOCKS.get(key)
        if lock is None:
            lock = asyncio.Lock()
            _FLUXO_LOCKS[key] = lock
        return lock


@asynccontextmanager
async def _fluxo_lock_context(conversa_id: str):
    if not conversa_id:
        yield
        return

    held = _FLUXO_LOCKS_HELD.get()
    if conversa_id in held:
        yield
        return

    lock = await _obter_fluxo_lock(conversa_id)
    await lock.acquire()
    token = _FLUXO_LOCKS_HELD.set(held | {conversa_id})
    try:
        yield
    finally:
        _FLUXO_LOCKS_HELD.reset(token)
        lock.release()


def _supabase_mockado_em_teste() -> bool:
    return isinstance(supabase, _EmptySupabaseClient) or type(supabase).__module__.startswith("unittest.mock")


async def _supabase_to_thread(fn):
    if _supabase_mockado_em_teste():
        return fn()
    return await asyncio.to_thread(fn)


async def _get_fluxo_async(conversa_id: str) -> dict:
    if _get_fluxo is not _GET_FLUXO_SYNC or _supabase_mockado_em_teste():
        return _get_fluxo(conversa_id)
    return await asyncio.to_thread(_get_fluxo, conversa_id)


async def _set_fluxo_async(conversa_id: str, fluxo: dict, etapa_esperada: str | None = None) -> bool:
    async with _fluxo_lock_context(conversa_id):
        if etapa_esperada is not None:
            fluxo_atual = await _get_fluxo_async(conversa_id)
            if fluxo_atual.get("etapa") != etapa_esperada:
                logger.info(
                    "[empreg-fluxo-lock] Escrita ignorada por etapa divergente",
                    extra={
                        "conversa_id": conversa_id,
                        "etapa_esperada": etapa_esperada,
                        "etapa_atual": fluxo_atual.get("etapa"),
                    },
                )
                return False
        if _set_fluxo is not _SET_FLUXO_SYNC or _supabase_mockado_em_teste():
            _set_fluxo(conversa_id, fluxo)
            return True
        await asyncio.to_thread(_set_fluxo, conversa_id, fluxo)
        return True


async def _ultima_mensagem_bot_async(conversa_id: str) -> str | None:
    if _ultima_mensagem_bot is not _ULTIMA_MENSAGEM_BOT_SYNC or _supabase_mockado_em_teste():
        return _ultima_mensagem_bot(conversa_id)
    return await asyncio.to_thread(_ultima_mensagem_bot, conversa_id)


_MSG_TRANSBORDO_FALHOU = (
    "Tentei acionar nossa equipe agora, mas não consegui confirmar o encaminhamento automático. "
    "Por favor, tente novamente em alguns minutos ou procure a equipe do CUCA pelo canal oficial."
)


async def _acionar_transbordo_empregabilidade(
    *,
    conversa_id: str,
    unidade_cuca: str | None,
    instance_name: str,
    token: str,
    phone: str,
    lead_id: str,
    motivo: str,
    mensagem_sucesso: str,
    metadata_update: dict | None = None,
    reset_fluxo: bool = False,
) -> bool:
    """Aciona handover real antes de prometer atendimento humano ao lead."""
    status_humano_marcado = False
    try:
        def _marcar_conversa_humana():
            if metadata_update is not None:
                supabase.table("conversas").update({"metadata": metadata_update}).eq("id", conversa_id).execute()
            supabase.table("conversas").update(
                {"status": "awaiting_human", "updated_at": "now()"}
            ).eq("id", conversa_id).execute()

        await _supabase_to_thread(_marcar_conversa_humana)
        status_humano_marcado = True
        from meta_adapter_inbound import _notificar_transbordo  # noqa: PLC0415
        notificado = await _notificar_transbordo(
            conversa_id, "Empregabilidade", unidade_cuca or None, instance_name, phone
        )
        if notificado is False:
            raise RuntimeError("notificacao_transbordo_nao_enviada")
        if reset_fluxo:
            await _set_fluxo_async(conversa_id, {})
    except Exception:
        logger.error(
            "[handover] Falha ao acionar transbordo de Empregabilidade",
            extra={
                "conversa_id": conversa_id,
                "unidade_cuca": unidade_cuca,
                "motivo": motivo,
                "telefone": phone[:6] + "****",
            },
            exc_info=True,
        )
        if status_humano_marcado:
            try:
                def _restaurar_conversa_ativa():
                    supabase.table("conversas").update(
                        {"status": "ativa", "updated_at": "now()"}
                    ).eq("id", conversa_id).execute()

                await _supabase_to_thread(_restaurar_conversa_ativa)
            except Exception:
                logger.error(
                    "[handover] Falha ao reverter status de transbordo de Empregabilidade",
                    extra={
                        "conversa_id": conversa_id,
                        "unidade_cuca": unidade_cuca,
                        "motivo": motivo,
                        "telefone": phone[:6] + "****",
                    },
                    exc_info=True,
                )
        await _enviar(
            instance_name, token, phone, _MSG_TRANSBORDO_FALHOU,
            conversa_id=conversa_id, lead_id=lead_id,
        )
        return False

    await _enviar(
        instance_name, token, phone, mensagem_sucesso,
        conversa_id=conversa_id, lead_id=lead_id,
    )
    logger.info(
        "[handover] %s",
        {"event": "handover_requested", "telefone": phone[:6] + "****",
         "conversa_id": conversa_id, "unidade_cuca": unidade_cuca, "motivo": motivo},
    )
    return True


async def _log_intencao_async(conversa_id: str, intencao: str) -> None:
    if (
        ("_LOG_INTENCAO_SYNC" in globals() and _log_intencao is not _LOG_INTENCAO_SYNC)
        or _supabase_mockado_em_teste()
    ):
        _log_intencao(conversa_id, intencao)
        return
    await asyncio.to_thread(_log_intencao, conversa_id, intencao)


def _quer_encerrar(texto: str) -> bool:
    t = texto.strip().lower()
    if t in _PALAVRAS_ENCERRAR:
        return True

    matches = [
        p for p in _PALAVRAS_ENCERRAR
        if re.search(rf"(?<!\w){re.escape(p)}(?!\w)", t)
    ]
    if not matches:
        return False

    resto = t
    for p in matches:
        resto = re.sub(rf"(?<!\w){re.escape(p)}(?!\w)", " ", resto)
    resto = re.sub(r"[^\wÀ-ÿ]+", " ", resto).strip()
    if not resto:
        return True
    if any(re.search(rf"(?<!\w){neg}(?!\w)", resto) for neg in ("não", "nao")):
        return False

    palavras_apoio = {
        "muito", "por", "favor", "pfv", "pf", "porfavor", "ok", "ta", "tá",
        "certo", "beleza", "blz", "so", "só", "isso", "era", "eu", "quero",
        "queria", "gostaria", "de",
    }
    return all(p in palavras_apoio for p in resto.split())


def _tem_palavra_encerramento(texto: str) -> bool:
    t = texto.strip().lower()
    return any(
        re.search(rf"(?<!\w){re.escape(p)}(?!\w)", t)
        for p in _PALAVRAS_ENCERRAR
    )


# ---------------------------------------------------------------------------
# Encerramento padronizado
# ---------------------------------------------------------------------------

async def _encerrar_fluxo(
    conversa_id: str,
    instance_name: str,
    token: str,
    phone: str,
    perfil: str,
):
    """Envia despedida contextualizada, limpa estado e encerra a conversa."""
    if perfil == "empresa":
        msg = (
            "Tudo certo! Quando precisar criar uma nova vaga ou acompanhar candidatos, "
            "é só nos enviar uma mensagem. 👷\n\nAté logo!"
        )
    else:
        msg = (
            "Boa sorte! Fique de olho nas mensagens da equipe CUCA. 🤝\n\n"
            "Se precisar de mais alguma coisa, é só chamar. Até logo! 👋"
        )
    await _enviar(instance_name, token, phone, msg, conversa_id=conversa_id)
    await _set_fluxo_async(conversa_id, {})


async def _mostrar_menu_opcoes(
    instance_name: str,
    token: str,
    phone: str,
    conversa_id: str,
    lead_id: str,
    intro: str = "Escolha uma das opções:",
) -> None:
    """Menu numérico de 5 opções, reutilizado pelo branch `ambiguo` de
    `_rotear_por_intencao`, pelo bypass global de "menu" e pelo fallback de
    `menu_inicial` — S-WM-20 Task 5 (ajuste 2): antes cada um tinha seu
    próprio texto ligeiramente diferente (ou nenhum), causando comportamento
    inconsistente ("menu" pulava direto pra vagas em vez de reabrir a escolha).
    `intro` permite variar a frase de abertura (ex.: saudação de boas-vindas
    na 1ª interação vs. "não entendi" numa mensagem ambígua repetida).

    S-EMP-AUD-025: copy reescrita a pedido do Junior — separa visualmente a
    opção 1 (único caminho de empresa) do resto (candidato), com uma linha em
    branco extra entre elas (em vez do separador de traços original, que
    quebra estranho em tela pequena de celular)."""
    await _enviar(
        instance_name, token, phone,
        f"{intro}\n\n"
        "1️⃣ *Sou Empresa* — Quero divulgar uma vaga ou marcar seleção\n\n\n"
        "2️⃣ *Verificar como esta minha candidatura* - Quero acompanhar minha candidatura\n\n"
        "3️⃣ *Ver Vagas Abertas* — Quero ver vagas abertas\n\n"
        "4️⃣ *Enviar Currículo Banco de Talentos* — Quero deixar meu currículo (arquivo pronto) para futuras oportunidades\n\n"
        "5️⃣ *Criar meu Currículo agora* — Não tenho currículo pronto, quero montar um pelo celular\n\n"
        "Digite *1*, *2*, *3*, *4* ou *5*, ou simplesmente me conte o que você precisa.",
        conversa_id=conversa_id, lead_id=lead_id,
    )


# ---------------------------------------------------------------------------
# S-WM-20 Task 5 — Escape hatch híbrido: parser determinístico primeiro,
# classificador semântico só quando o parser falha. Ver Change Log da story
# para o raciocínio completo (chamar o LLM em toda etapa, incluindo campos de
# DADO como nome/e-mail/CNPJ válidos, arriscaria classificar mal um valor
# correto e tirar o usuário de um estado onde ele já estava certo).
# ---------------------------------------------------------------------------

async def _escape_semantico_ou_none(
    texto: str,
    perfil: str,
    etapa: str,
    conversa_id: str,
    phone: str,
    instance_name: str,
    token: str,
    lead_id: str,
    unidade_cuca: str = "",
) -> bool:
    """Chama o classificador semântico quando o parser determinístico da etapa
    atual já falhou. Retorna True se tratou a mensagem (quer_sair encerra;
    mudou_de_assunto reroteia) — o chamador deve dar `return` em seguida.
    Retorna False se o classificador também não teve sinal claro (ambíguo) —
    o chamador mantém o comportamento original de pedir de novo."""
    from intencao_detector import avaliar_mensagem_contextual  # noqa: PLC0415
    sem = await avaliar_mensagem_contextual(
        texto, perfil=perfil, etapa=etapa, ultima_msg_bot=await _ultima_mensagem_bot_async(conversa_id),
    )
    if sem.get("quer_atendente_humano"):
        await _acionar_transbordo_empregabilidade(
            conversa_id=conversa_id, unidade_cuca=unidade_cuca,
            instance_name=instance_name, token=token, phone=phone, lead_id=lead_id,
            motivo="pedido_atendente_humano",
            mensagem_sucesso="Sua solicitação foi registrada. Em breve você será atendido por nossa equipe.",
        )
        return True
    if sem.get("quer_voltar") and etapa in _ETAPA_ANTERIOR:
        fluxo = await _get_fluxo_async(conversa_id)
        if await _voltar_etapa_publico(
            fluxo=fluxo, etapa=etapa, conversa_id=conversa_id,
            instance_name=instance_name, token=token, phone=phone, lead_id=lead_id,
        ):
            return True
    if sem["quer_sair"]:
        await _encerrar_fluxo(conversa_id, instance_name, token, phone, perfil)
        return True
    if sem["mudou_de_assunto"] and sem["intencao"] != "ambiguo":
        # S-WM-20 Task 5 (ajuste 3): antes reroteava direto e em silêncio
        # (`_rotear_por_intencao` já mandava a 1ª mensagem da rota nova, sem
        # nenhum "percebi que você mudou de assunto, é isso?"). Agora
        # pergunta e só reroteia de fato depois da confirmação — ver
        # `confirmando_troca_rota` em `processar_mensagem_empregabilidade`.
        await _perguntar_confirmacao_troca_rota(
            sem, conversa_id, phone, instance_name, token, lead_id, unidade_cuca,
        )
        return True
    return False


def _fluxo_sem_falhas_atendente(fluxo: dict) -> dict:
    return {
        k: v for k, v in fluxo.items()
        if k not in {
            "falhas_atendente_etapa",
            "falhas_atendente_nome_etapa",
            "_oferta_atendente_contexto",
        }
    }


async def _registrar_falha_e_oferecer_atendente(
    *,
    fluxo: dict,
    etapa: str,
    conversa_id: str,
    instance_name: str,
    token: str,
    phone: str,
    lead_id: str,
) -> bool:
    if etapa not in _ETAPAS_OFERTA_ATENDENTE:
        return False

    etapa_contador = fluxo.get("falhas_atendente_nome_etapa")
    falhas = int(fluxo.get("falhas_atendente_etapa") or 0)
    falhas = falhas + 1 if etapa_contador == etapa else 1

    fluxo_base = _fluxo_sem_falhas_atendente({**fluxo, "etapa": etapa})
    if falhas >= _LIMIAR_FALHAS_OFERTA_ATENDENTE:
        await _enviar(
            instance_name, token, phone,
            "Percebi que não consegui te ajudar por aqui. Quer que eu chame um atendente da nossa equipe "
            "para continuar o atendimento? "
            "Responda *sim* ou *não*.",
            conversa_id=conversa_id, lead_id=lead_id,
        )
        await _set_fluxo_async(conversa_id, {
            "perfil": "publico",
            "etapa": "oferecendo_atendente_humano",
            "_oferta_atendente_contexto": {
                "etapa_anterior": etapa,
                "fluxo_anterior": fluxo_base,
            },
        })
        return True

    await _set_fluxo_async(conversa_id, {
        **fluxo,
        "falhas_atendente_nome_etapa": etapa,
        "falhas_atendente_etapa": falhas,
    })
    return False


def _limpar_campos_navegacao_publico(fluxo: dict, *, manter_categoria: bool = True) -> dict:
    novo = _fluxo_sem_falhas_atendente(fluxo)
    for key in (
        "mapa_vagas",
        "ultima_vaga_id",
        "_vagas_meta",
        "vaga_id_selecionada",
        "cargos_disponiveis",
        "cargos_escolhidos",
        "unidade_id_escolhida",
        "unidades_opcoes",
    ):
        novo.pop(key, None)
    if not manter_categoria:
        novo.pop("categoria_escolhida", None)
    return novo


# ---------------------------------------------------------------------------
# S-EMP-AUD-023 (Vaga Direta) — motor de agrupamento por cargo consolidado.
#
# Passo 1 da story: só o motor de dados (agrupar vaga_normal + selecao_evento
# por cargo, somar quantidade, resolver rótulo de unidade/tipo, ordenar
# alfabético). AINDA NÃO plugado no fluxo de conversa ao vivo — nenhuma etapa
# chama essas funções ainda. Isso é intencional: troca de comportamento real
# do candidato (substituir _mostrar_categorias) é um passo à parte, revisado
# separadamente, dado o risco MÉDIO-ALTO da story.
#
# Normalização de cargo aqui é só o pré-passo barato (seção 8.1, passo 1:
# minúsculo + trim + espaços colapsados) — a normalização via IA (passo 2 da
# seção 8.1) é escopo de um commit futuro desta mesma story.
# ---------------------------------------------------------------------------

_REGEX_UUID = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


def _normalizar_cargo_basico(titulo: str) -> str:
    """Pré-passo barato de normalização de cargo (seção 8.1, passo 1) — roda
    sempre, sem custo de IA. Resolve casos óbvios de maiúscula/minúscula e
    espaçamento ("Porteiro"/"porteiro"), mas NÃO resolve erro de digitação
    real (ex.: "menutenção" vs "manutenção") — isso é o passo 2 (IA), fora
    do escopo deste commit."""
    return re.sub(r"\s+", " ", (titulo or "").strip().lower())


def _resolver_nome_unidade_cuca(valor: str | None, unidades_por_id: dict[str, str]) -> str | None:
    """`unidade_cuca` mistura UUID e texto literal nos dados reais (achado
    2.4 da story) — testa se parece UUID; se sim, resolve via
    `unidades_por_id` (pré-buscado em lote pelo chamador); se não, usa o
    texto direto. None permanece None (caso "Toda a Rede", tratado pelo
    chamador). Fail-safe: UUID não encontrado no mapa cai pro próprio valor
    bruto, em vez de quebrar a listagem."""
    if not valor:
        return None
    if _REGEX_UUID.match(valor):
        return unidades_por_id.get(valor, valor)
    return valor


def _gerar_rotulo_tipo_vaga(vaga: dict, unidades_por_id: dict[str, str]) -> str:
    """Implementa as 4 regras da seção 3 (story), na ordem:
    - selecao_evento + unidade_cuca nulo → "Toda a Rede"
    - selecao_evento + unidade_cuca preenchido → nome resolvido
    - vaga_normal + unidade_destino == "global" → "Vaga individual"
    - vaga_normal + unidade_destino específica → "Vaga individual — {nome}"
    """
    tipo = vaga.get("tipo")
    if tipo == "selecao_evento":
        nome_unidade = _resolver_nome_unidade_cuca(vaga.get("unidade_cuca"), unidades_por_id)
        if not nome_unidade:
            return "Processo seletivo Cuca: Toda a Rede"
        return f"Processo seletivo Cuca: {nome_unidade}"
    # vaga_normal
    unidade_destino = vaga.get("unidade_destino") or ""
    if unidade_destino == "global" or not unidade_destino:
        return "Vaga individual"
    nome_unidade = _resolver_nome_unidade_cuca(unidade_destino, unidades_por_id)
    if not nome_unidade:
        return "Vaga individual"
    return f"Vaga individual — {nome_unidade}"


def _construir_cargos_consolidados(
    vagas_db: list[dict],
    cargos_ja_candidatados_por_vaga: dict[str, set],
    vagas_ja_candidatadas_sem_cargo: set,
    empresas_por_id: dict[str, str],
    unidades_por_id: dict[str, str],
) -> dict:
    """Nível 1 da story: explode cada vaga em ocorrências de cargo (1 por
    `vaga_normal`, N por `cargos_lista` de `selecao_evento`), agrupa por
    cargo normalizado (pré-passo, seção 8.1), soma quantidade e monta o mapa
    numerado (`"1"`, `"2"`, ...) em ordem alfabética pelo nome de exibição
    (pergunta 2 da story).

    Exclusão por ocorrência, não por cargo inteiro (pergunta 5 da story):
    ocorrências já candidatadas pelo lead são removidas ANTES da soma — um
    cargo só some inteiro do mapa quando TODAS as suas ocorrências já foram
    candidatadas (consequência natural: soma zero)."""
    grupos: dict[str, dict] = {}

    for vaga in vagas_db:
        vaga_id = vaga["id"]
        tipo = vaga.get("tipo")
        empresa_nome = empresas_por_id.get(vaga.get("empresa_id"), "")
        rotulo_tipo = _gerar_rotulo_tipo_vaga(vaga, unidades_por_id)

        if tipo == "selecao_evento":
            cargos_ja_desse_lead = cargos_ja_candidatados_por_vaga.get(vaga_id, set())
            for item in (vaga.get("cargos_lista") or []):
                titulo_original = (item.get("titulo") or "").strip()
                if not titulo_original or titulo_original in cargos_ja_desse_lead:
                    continue
                try:
                    quantidade = int(item.get("quantidade") or 0)
                except (TypeError, ValueError):
                    quantidade = 0
                chave = _normalizar_cargo_basico(titulo_original)
                grupo = grupos.setdefault(chave, {
                    "cargo_exibicao": titulo_original,
                    "quantidade_total": 0,
                    "ocorrencias": [],
                })
                grupo["quantidade_total"] += quantidade
                grupo["ocorrencias"].append({
                    "vaga_id": vaga_id,
                    "tipo": tipo,
                    "cargo_titulo_original": titulo_original,
                    "quantidade": quantidade,
                    "empresa_nome": empresa_nome,
                    "rotulo_tipo": rotulo_tipo,
                })
        else:  # vaga_normal
            if vaga_id in vagas_ja_candidatadas_sem_cargo:
                continue
            titulo_original = (vaga.get("titulo") or "").strip()
            if not titulo_original:
                continue
            try:
                quantidade = int(vaga.get("total_vagas") or 0)
            except (TypeError, ValueError):
                quantidade = 0
            chave = _normalizar_cargo_basico(titulo_original)
            grupo = grupos.setdefault(chave, {
                "cargo_exibicao": titulo_original,
                "quantidade_total": 0,
                "ocorrencias": [],
            })
            grupo["quantidade_total"] += quantidade
            grupo["ocorrencias"].append({
                "vaga_id": vaga_id,
                "tipo": tipo,
                "cargo_titulo_original": titulo_original,
                "quantidade": quantidade,
                "empresa_nome": empresa_nome,
                "rotulo_tipo": rotulo_tipo,
            })

    cargos_ordenados = sorted(grupos.values(), key=lambda g: g["cargo_exibicao"].lower())
    return {str(i): grupo for i, grupo in enumerate(cargos_ordenados, start=1)}


# ---------------------------------------------------------------------------
# S-EMP-AUD-023 passo 2 — plugagem do motor no fluxo real (Nível 1 e Nível 2).
#
# Numeração do Nível 2: CONTÍNUA entre os blocos escolhidos (não reinicia em
# 1 a cada cargo). O exemplo literal do Junior (seção 1 da story) mostra cada
# bloco reiniciando em 1 — mas isso é ambíguo pra responder por texto: se o
# lead digitar só "1" com 2 blocos abertos, não dá pra saber qual bloco ele
# quer. Decisão registrada com o Junior nesta sessão: numeração única e
# corrida ao longo de todos os blocos (bloco 1 termina em N, bloco 2 continua
# em N+1...), preservando o cabeçalho por bloco (nome do cargo) como
# separador visual — só a numeração muda do exemplo original.
# ---------------------------------------------------------------------------

async def _mostrar_cargos_consolidados(
    instance_name: str,
    token: str,
    phone: str,
    conversa_id: str,
    lead_id: str,
    mapa_cargos: dict,
) -> None:
    """Nível 1 (seção 5, regra 1/2): 1 linha por cargo consolidado, com soma
    de quantidade já calculada por `_construir_cargos_consolidados`."""
    linhas = ["💼 *Vagas abertas na Rede CUCA — Escolha um ou mais cargos:*\n"]
    for k, v in mapa_cargos.items():
        qtd = v["quantidade_total"]
        linhas.append(f"*{k}.* {v['cargo_exibicao']} — {qtd} vaga{'s' if qtd != 1 else ''}")
    linhas.append(
        "\nDigite o *número* do cargo para ver as vagas. Para mais de um, separe por vírgula (ex: *1,3*).\n"
        "Digite *voltar* para ver outras opções.\n"
        "Ou diga *banco de talentos* para deixar seu currículo para futuras oportunidades."
    )
    await _enviar(instance_name, token, phone, "\n".join(linhas), conversa_id=conversa_id, lead_id=lead_id)


def _construir_mapa_ocorrencias(mapa_cargos: dict, chaves_escolhidas: list[str]) -> tuple[dict, list[str]]:
    """Nível 2 (seção 5, regras 3/4): monta o mapa achatado de ocorrências,
    numerado de forma contínua entre os blocos escolhidos (ver nota acima), e
    o texto de cada bloco (cabeçalho = cargo, 1 linha por ocorrência com
    quantidade, empresa e rótulo de tipo/unidade — seção 3)."""
    mapa_ocorrencias: dict = {}
    blocos_txt: list[str] = []
    contador = 1
    for chave in chaves_escolhidas:
        grupo = mapa_cargos.get(chave)
        if not grupo:
            continue
        linhas_bloco = [f"*{grupo['cargo_exibicao']}*\n"]
        for ocorrencia in grupo["ocorrencias"]:
            num = str(contador)
            mapa_ocorrencias[num] = {**ocorrencia, "cargo_exibicao": grupo["cargo_exibicao"]}
            qtd = ocorrencia["quantidade"]
            linhas_bloco.append(
                f"*{num}.* {qtd} vaga{'s' if qtd != 1 else ''} — "
                f"{ocorrencia['empresa_nome']} — {ocorrencia['rotulo_tipo']}"
            )
            contador += 1
        linhas_bloco.append(
            "\nEscolha uma ou mais vagas, caso queira mais de uma separe com vírgula (ex: *1,3*)."
        )
        blocos_txt.append("\n".join(linhas_bloco))
    return mapa_ocorrencias, blocos_txt


async def _mostrar_ocorrencias_cargo(
    instance_name: str,
    token: str,
    phone: str,
    conversa_id: str,
    lead_id: str,
    mapa_cargos: dict,
    chaves_escolhidas: list[str],
) -> dict:
    mapa_ocorrencias, blocos_txt = _construir_mapa_ocorrencias(mapa_cargos, chaves_escolhidas)
    corpo = "\n\n".join(blocos_txt) + "\n\nDigite *voltar* para ver outras opções."
    await _enviar(instance_name, token, phone, corpo, conversa_id=conversa_id, lead_id=lead_id)
    return {"mapa_ocorrencias": mapa_ocorrencias}


async def _confirmar_cargos_selecao_evento(
    *,
    fluxo: dict,
    vaga_id_ref: str,
    cargos_escolhidos: list[str],
    coleta_curriculo: bool,
    conversa_id: str,
    instance_name: str,
    token: str,
    phone: str,
    lead_id: str,
) -> None:
    """Compartilhado entre `listando_cargos_selecao` (SQS-49, escolha de cargo
    dentro de 1 seleção já aberta) e `listou_ocorrencias_cargo` (S-EMP-AUD-023
    passo 2, o cargo já vem escolhido desde o Nível 1/2) — decide a rota certa
    (SQS-56: com ou sem coleta prévia de currículo) depois que o(s) cargo(s)
    já estão definidos. Extraída sem mudar comportamento do call site
    original (`listando_cargos_selecao`)."""
    display_str = ", ".join(cargos_escolhidos)

    if coleta_curriculo is False:
        def _buscar_detalhes_convocacao():
            v_res = supabase.table("vagas").select(
                "observacoes_selecao, datas_selecao, local_entrevista, empresa_id"
            ).eq("id", vaga_id_ref).maybe_single().execute()
            v = v_res.data or {}
            empresa_nome_conv = ""
            empresa_id_v = v.get("empresa_id")
            if empresa_id_v:
                emp_res = supabase.table("empresas").select(
                    "nome, nome_fantasia"
                ).eq("id", empresa_id_v).maybe_single().execute()
                emp = emp_res.data or {}
                empresa_nome_conv = emp.get("nome_fantasia") or emp.get("nome") or ""
            return v, empresa_nome_conv

        detalhes_vaga, empresa_nome_conv = await _supabase_to_thread(_buscar_detalhes_convocacao)

        datas = detalhes_vaga.get("datas_selecao") or []
        data_hora_txt = ""
        if datas:
            d0 = datas[0]
            data_iso = d0.get("data", "")
            partes_data = data_iso.split("-")
            data_fmt = f"{partes_data[2]}/{partes_data[1]}/{partes_data[0]}" if len(partes_data) == 3 else data_iso
            hora_fmt = d0.get("hora", "")
            data_hora_txt = f"{data_fmt}" + (f" às {hora_fmt}" if hora_fmt else "")
        local_txt = detalhes_vaga.get("local_entrevista") or ""
        obs_txt = detalhes_vaga.get("observacoes_selecao") or ""

        linhas_convocacao = [
            f"🎉 Você está convocado(a) para o processo seletivo"
            + (f" *{empresa_nome_conv}*!" if empresa_nome_conv else "!") + "\n",
            f"📋 Cargo(s): *{display_str}*",
        ]
        if data_hora_txt:
            linhas_convocacao.append(f"📅 Data: *{data_hora_txt}*")
        if local_txt:
            linhas_convocacao.append(f"📍 Local: *{local_txt}*")
        if obs_txt:
            linhas_convocacao.append(f"ℹ️ Observações: {obs_txt}")
        linhas_convocacao.append("\nPara confirmar sua presença, digite seu *nome completo*:")
        await _enviar(
            instance_name, token, phone, "\n".join(linhas_convocacao),
            conversa_id=conversa_id, lead_id=lead_id,
        )

        await _set_fluxo_async(conversa_id, {
            **_fluxo_sem_falhas_atendente(fluxo),
            "etapa": "confirmando_presenca_nome",
            "cargos_escolhidos": cargos_escolhidos,
            "vaga_id_selecionada": vaga_id_ref,
            "empresa_nome_selecao": empresa_nome_conv,
            "tentativas_confirmacao_presenca": 0,
        })
        return

    await _enviar(
        instance_name, token, phone,
        f"Ótimo! Você escolheu: *{display_str}* ✅\n\nPara finalizar, preciso do seu *nome completo*:",
        conversa_id=conversa_id, lead_id=lead_id,
    )
    await _set_fluxo_async(conversa_id, {
        **_fluxo_sem_falhas_atendente(fluxo),
        "etapa": "coletando_nome_candidato",
        "cargos_escolhidos": cargos_escolhidos,  # lista — AC10 SQS-49
        "vaga_id_selecionada": vaga_id_ref,
        "banco_talentos": False,
    })


async def _mostrar_categorias(
    instance_name: str,
    token: str,
    phone: str,
    conversa_id: str,
    lead_id: str,
    mapa_categorias: dict,
) -> None:
    linhas = ["💼 *Vagas abertas na Rede CUCA — Escolha uma categoria:*\n"]
    for k, v in mapa_categorias.items():
        subcats = ", ".join(vg["titulo"].lower() for vg in v["vagas"][:3])
        total = len(v["vagas"])
        linhas.append(
            f"*{k}.* {v['categoria']} ({subcats}) - ({total} vaga{'s' if total > 1 else ''})"
        )
    linhas.append(
        "\nDigite o *número* da categoria para ver as vagas disponíveis.\n"
        "Digite *voltar* para ver outras opções.\n"
        "Ou diga *banco de talentos* para deixar seu currículo para futuras oportunidades."
    )
    await _enviar(instance_name, token, phone, "\n".join(linhas), conversa_id=conversa_id, lead_id=lead_id)


async def _mostrar_vagas_da_categoria(
    instance_name: str,
    token: str,
    phone: str,
    conversa_id: str,
    lead_id: str,
    cat_data: dict,
) -> dict:
    cat_vagas = cat_data["vagas"]  # list of {"id", "titulo", "unidade_destino"}
    linhas_cat = [f"💼 *{cat_data['categoria']} — Vagas disponíveis:*\n"]
    mapa_vagas_cat: dict = {}
    ultima_vaga_id_cat = None
    for ic, vc in enumerate(cat_vagas, start=1):
        linhas_cat.append(f"*{ic}.* {vc['titulo']}")
        mapa_vagas_cat[str(ic)] = vc["id"]
        ultima_vaga_id_cat = vc["id"]
    linhas_cat.append(
        "\nDigite o *número* da vaga para se candidatar.\n"
        "Digite *voltar* para ver outras opções."
    )
    await _enviar(instance_name, token, phone, "\n".join(linhas_cat), conversa_id=conversa_id, lead_id=lead_id)
    return {
        "mapa_vagas": mapa_vagas_cat,
        "ultima_vaga_id": ultima_vaga_id_cat,
        "_vagas_meta": {vc["id"]: vc for vc in cat_vagas},
        "categoria_escolhida": cat_data,
    }


async def _voltar_etapa_publico(
    *,
    fluxo: dict,
    etapa: str,
    conversa_id: str,
    instance_name: str,
    token: str,
    phone: str,
    lead_id: str,
) -> bool:
    etapa_anterior = _ETAPA_ANTERIOR.get(etapa)
    if not etapa_anterior:
        return False

    if etapa_anterior == "inicio":
        await _mostrar_menu_opcoes(instance_name, token, phone, conversa_id, lead_id)
        await _set_fluxo_async(conversa_id, {
            "perfil": "publico",
            "etapa": "inicio",
            "historico_vagas_aplicadas": fluxo.get("historico_vagas_aplicadas") or [],
            "nome_candidato_prefill": fluxo.get("nome_candidato_prefill", ""),
        })
        return True

    if etapa_anterior == "listou_categorias":
        mapa_categorias = fluxo.get("mapa_categorias") or {}
        if not mapa_categorias:
            return False
        await _mostrar_categorias(instance_name, token, phone, conversa_id, lead_id, mapa_categorias)
        novo_fluxo = _limpar_campos_navegacao_publico(fluxo, manter_categoria=False)
        await _set_fluxo_async(conversa_id, {
            **novo_fluxo,
            "perfil": "publico",
            "etapa": "listou_categorias",
            "mapa_categorias": mapa_categorias,
        })
        return True

    if etapa_anterior == "listou_vagas":
        cat_data = fluxo.get("categoria_escolhida")
        if not cat_data:
            mapa_categorias = fluxo.get("mapa_categorias") or {}
            if mapa_categorias:
                await _mostrar_categorias(instance_name, token, phone, conversa_id, lead_id, mapa_categorias)
                await _set_fluxo_async(conversa_id, {
                    **_limpar_campos_navegacao_publico(fluxo, manter_categoria=False),
                    "perfil": "publico",
                    "etapa": "listou_categorias",
                    "mapa_categorias": mapa_categorias,
                })
                return True
            return False
        meta_vagas = await _mostrar_vagas_da_categoria(
            instance_name, token, phone, conversa_id, lead_id, cat_data,
        )
        novo_fluxo = _limpar_campos_navegacao_publico(fluxo, manter_categoria=True)
        await _set_fluxo_async(conversa_id, {
            **novo_fluxo,
            "perfil": "publico",
            "etapa": "listou_vagas",
            **meta_vagas,
        })
        return True

    # S-EMP-AUD-023 passo 2 (seção 5, regra 6): voltar de listou_ocorrencias_cargo
    if etapa_anterior == "listou_cargos_consolidados":
        mapa_cargos = fluxo.get("mapa_cargos_consolidados") or {}
        if not mapa_cargos:
            return False
        await _mostrar_cargos_consolidados(instance_name, token, phone, conversa_id, lead_id, mapa_cargos)
        novo_fluxo = _limpar_campos_navegacao_publico(fluxo, manter_categoria=False)
        novo_fluxo.pop("mapa_ocorrencias", None)
        await _set_fluxo_async(conversa_id, {
            **novo_fluxo,
            "perfil": "publico",
            "etapa": "listou_cargos_consolidados",
            "mapa_cargos_consolidados": mapa_cargos,
        })
        return True

    return False


_MENSAGENS_CONFIRMACAO_TROCA_ROTA = {
    "empresa": "Percebi que você quer divulgar uma vaga ou marcar um processo seletivo, como empresa.",
    "candidato_vaga": "Percebi que você quer se candidatar a uma vaga.",
    "banco_talentos": "Percebi que você quer deixar seu currículo no banco de talentos.",
    "upload": "Percebi que você quer enviar seu currículo.",
}


async def _perguntar_confirmacao_troca_rota(
    sem: dict,
    conversa_id: str,
    phone: str,
    instance_name: str,
    token: str,
    lead_id: str,
    unidade_cuca: str = "",
) -> None:
    """Pergunta antes de trocar de rota no meio da conversa (S-WM-20 Task 5,
    ajuste 3), em vez de reroteirar em silêncio. Guarda a classificação
    pendente no fluxo; a confirmação real acontece em
    `confirmando_troca_rota` (`processar_mensagem_empregabilidade`)."""
    contexto = _MENSAGENS_CONFIRMACAO_TROCA_ROTA.get(
        sem.get("intencao", "ambiguo"), "Percebi que você quer falar sobre outro assunto.",
    )
    await _enviar(
        instance_name, token, phone,
        f"{contexto} É isso mesmo? Responda *sim* ou *não*.",
        conversa_id=conversa_id, lead_id=lead_id,
    )
    await _set_fluxo_async(conversa_id, {
        "etapa": "confirmando_troca_rota",
        "_troca_rota_pendente": sem,
        "_troca_rota_unidade_cuca": unidade_cuca,
    })


async def _quer_sair_semantico(
    texto: str,
    perfil: str,
    etapa: str,
    conversa_id: str,
    phone: str,
    instance_name: str,
    token: str,
) -> bool:
    """Variante de alta precisão para etapas de DADO livre (nome de candidato/
    terceiro): honra só `quer_sair`, nunca `mudou_de_assunto` — um nome
    incomum ou fora do padrão teria falso-positivo alto demais nesse sinal
    (qualquer texto é potencialmente um nome válido, diferente de CNPJ/e-mail/
    telefone, que têm formato verificável). Retorna True se encerrou o fluxo
    (chamador deve dar `return` em seguida)."""
    from intencao_detector import avaliar_mensagem_contextual  # noqa: PLC0415
    sem = await avaliar_mensagem_contextual(
        texto, perfil=perfil, etapa=etapa, ultima_msg_bot=await _ultima_mensagem_bot_async(conversa_id),
    )
    if sem["quer_sair"]:
        await _encerrar_fluxo(conversa_id, instance_name, token, phone, perfil)
        return True
    return False


# S-EMP-AUD-024: nas etapas de coleta de nome (DADO livre), qualquer texto é
# tratado como nome válido — não dá pra usar o sub-sinal `mudou_de_assunto`
# do classificador ali (falso-positivo alto em nome incomum, mesmo motivo de
# `_quer_sair_semantico` acima). Mas frases de troca de rota muito comuns
# ("quero ver vagas", "sou empresa"...) não são nomes de jeito nenhum — esse
# fast-path de padrões literais de alta precisão resolve isso SEM tocar no
# classificador semântico (zero risco de regredir a mitigação já existente
# pra nome incomum, que continua intocada: só cai aqui se o texto bater
# exatamente com um destes padrões).
_FRASES_ROTA_ALTA_PRECISAO_EMPRESA = (
    "sou empresa", "sou uma empresa", "eu sou empresa", "represento uma empresa",
    "represento a empresa", "quero divulgar vaga", "quero divulgar uma vaga",
    "quero cadastrar vaga", "quero cadastrar uma vaga", "sou empregador",
)
_FRASES_ROTA_ALTA_PRECISAO_VAGAS = (
    "ver vagas", "quero ver vagas", "quero ver outras vagas", "outras vagas",
    "ver outras vagas", "outra vaga", "outras vaga", "quero ver outra vaga",
    "vagas abertas", "quero ver as vagas", "ver as vagas",
)
_FRASES_ROTA_ALTA_PRECISAO_AMBIGUA = ("voltar", "quero voltar", "menu", "menu inicial")


def _deteccao_literal_troca_rota(texto: str) -> dict | None:
    """Reconhece, por comparação literal (sem LLM), frases de troca de rota
    de alta precisão que não podem ser confundidas com um nome. Retorna um
    dict no mesmo formato de `avaliar_mensagem_contextual` (pronto pra
    `_perguntar_confirmacao_troca_rota`) ou None se não bateu com nenhum
    padrão — nesse caso o chamador segue tratando o texto como nome,
    normalmente."""
    t = texto.strip().lower()
    if t in _FRASES_ROTA_ALTA_PRECISAO_EMPRESA:
        return {"intencao": "empresa", "quer_sair": False, "mudou_de_assunto": True}
    if t in _FRASES_ROTA_ALTA_PRECISAO_VAGAS:
        return {"intencao": "candidato_vaga", "quer_sair": False, "mudou_de_assunto": True}
    if t in _FRASES_ROTA_ALTA_PRECISAO_AMBIGUA:
        return {"intencao": "ambiguo", "quer_sair": False, "mudou_de_assunto": True}
    return None


async def _escape_literal_ou_none(
    texto: str,
    conversa_id: str,
    phone: str,
    instance_name: str,
    token: str,
    lead_id: str,
    unidade_cuca: str = "",
) -> bool:
    """Wrapper de conveniência: aplica `_deteccao_literal_troca_rota` e, se
    bateu, já dispara a pergunta de confirmação de troca de rota (mesmo
    mecanismo usado pelo classificador semântico). Retorna True se tratou a
    mensagem — o chamador deve dar `return` em seguida."""
    sem_literal = _deteccao_literal_troca_rota(texto)
    if sem_literal is None:
        return False
    await _perguntar_confirmacao_troca_rota(
        sem_literal, conversa_id, phone, instance_name, token, lead_id, unidade_cuca,
    )
    return True


# ---------------------------------------------------------------------------
# Fluxo de EMPRESA
# ---------------------------------------------------------------------------

async def _processar_empresa(
    texto: str,
    phone: str,
    instance_name: str,
    token: str,
    lead_id: str,
    conversa_id: str,
    unidade_cuca: str,
):
    fluxo = await _get_fluxo_async(conversa_id)
    etapa = fluxo.get("etapa", "solicitar_cnpj")

    async def e(msg: str):
        await _enviar(instance_name, token, phone, msg, conversa_id=conversa_id, lead_id=lead_id)

    # Encerramento em qualquer etapa pós-ação
    if _quer_encerrar(texto) and etapa not in ("aguardando_cnpj", "confirmando_cadastro", "confirmando_cadastro_com_correcao"):
        await _encerrar_fluxo(conversa_id, instance_name, token, phone, "empresa")
        return

    # --- RETOMADA: empresa já identificada voltando sem etapa ativa ---
    if etapa in ("", None) or etapa == "encerrado":
        empresa_id = fluxo.get("empresa_id")
        empresa_nome = fluxo.get("empresa_nome_exibicao") or fluxo.get("empresa_nome", "")
        if empresa_id and empresa_nome:
            await e(
                f"Olá! 👋 Que bom ter você de volta.\n\n"
                f"Vi que você já tem cadastro conosco como *{empresa_nome}*.\n\n"
                f"O que deseja fazer?\n\n{_MENU_ACOES_EMPRESA}"
            )
            fluxo["etapa"] = "menu_empresa_acoes"
            await _set_fluxo_async(conversa_id, fluxo)
            return

    # --- ETAPA: menu_empresa_retomada (legado — redireciona para menu_empresa_acoes) ---
    if etapa == "menu_empresa_retomada":
        empresa_id = fluxo.get("empresa_id")
        empresa_nome = fluxo.get("empresa_nome_exibicao") or fluxo.get("empresa_nome", "")
        await e(
            f"Olá! 👋 Que bom ter você de volta, *{empresa_nome}*.\n\n"
            f"O que deseja fazer?\n\n{_MENU_ACOES_EMPRESA}"
        )
        fluxo["etapa"] = "menu_empresa_acoes"
        await _set_fluxo_async(conversa_id, fluxo)
        return

    # --- ETAPA: menu_empresa_acoes ---
    if etapa == "menu_empresa_acoes":
        t = texto.strip().lower()
        empresa_id = fluxo.get("empresa_id")
        empresa_nome = fluxo.get("empresa_nome_exibicao") or fluxo.get("empresa_nome", "")
        if t in ("1", "nova vaga", "divulgar", "criar", "cadastrar"):
            # SQS-41: unidade escolhida no formulário web — vai direto coletar e-mail do responsável
            await e(
                "Ótimo! 🎯 Antes de gerar o link da vaga, preciso de algumas informações do *responsável pelo processo seletivo*.\n\n"
                "Qual é o *e-mail* para receber os currículos?\n"
                "(pode ser diferente do e-mail geral da empresa)"
            )
            await _set_fluxo_async(conversa_id, {
                "perfil": "empresa",
                "etapa": "coletando_email_responsavel",
                "empresa_id": empresa_id,
                "empresa_nome": fluxo.get("empresa_nome", ""),
                "empresa_nome_exibicao": empresa_nome,
                "cnpj": fluxo.get("cnpj"),
            })
        elif t in ("2", "consultar", "status", "acompanhar", "vagas"):
            await _set_fluxo_async(conversa_id, {**fluxo, "etapa": "consulta_empresa"})
            await _processar_consulta_empresa("todas", phone, instance_name, token, fluxo, conversa_id)
        elif t in ("3", "editar", "alterar", "modificar"):
            await _set_fluxo_async(conversa_id, {**fluxo, "etapa": "selecionando_vaga_edicao"})
            await _listar_vagas_para_acao(empresa_id, instance_name, token, phone, "edicao", conversa_id, fluxo)
        elif t in ("4", "cancelar", "encerrar vaga", "remover vaga"):
            await _set_fluxo_async(conversa_id, {**fluxo, "etapa": "selecionando_vaga_cancelamento"})
            await _listar_vagas_para_acao(empresa_id, instance_name, token, phone, "cancelamento", conversa_id, fluxo)
        else:
            # S-WM-20 Task 5: parser (match exato) falhou — antes ia direto para
            # _encerrar_fluxo em qualquer texto não reconhecido (o mais agressivo
            # dos casos, encerrava a conversa numa simples ambiguidade). Agora
            # tenta o classificador semântico antes; só encerra/reroteia se ele
            # tiver sinal claro, senão apenas re-apresenta o menu.
            tratado = await _escape_semantico_ou_none(
                texto, "empresa", etapa, conversa_id, phone, instance_name, token, lead_id,
                unidade_cuca,
            )
            if not tratado:
                await e(
                    f"Não entendi. Escolha uma das opções:\n\n{_MENU_ACOES_EMPRESA}"
                )
        return

    # --- ETAPA: perguntando_unidade_vaga (DEPRECADO — SQS-41 moveu seleção para o formulário web) ---
    # Redireciona conversas já neste estado para o novo fluxo de coleta de e-mail
    if etapa == "perguntando_unidade_vaga":
        empresa_id = fluxo.get("empresa_id")
        empresa_nome = fluxo.get("empresa_nome_exibicao") or fluxo.get("empresa_nome", "")
        await e(
            "Ótimo! 🎯 Antes de gerar o link da vaga, preciso de algumas informações do *responsável pelo processo seletivo*.\n\n"
            "Qual é o *e-mail* para receber os currículos?\n"
            "(pode ser diferente do e-mail geral da empresa)"
        )
        await _set_fluxo_async(conversa_id, {
            "perfil": "empresa",
            "etapa": "coletando_email_responsavel",
            "empresa_id": empresa_id,
            "empresa_nome": fluxo.get("empresa_nome", ""),
            "empresa_nome_exibicao": empresa_nome,
            "cnpj": fluxo.get("cnpj"),
        })
        return

    # --- ETAPA: selecionando_vaga_edicao ---
    if etapa == "selecionando_vaga_edicao":
        empresa_id = fluxo.get("empresa_id")
        match_num = _REGEX_NUMERO_VAGA_ISOLADO.search(texto)
        if not match_num:
            # S-WM-20 Task 5: sem número — antes só pedia de novo, sem entender
            # que o usuário pode ter mudado de assunto ou desistido.
            if await _escape_semantico_ou_none(
                texto, "empresa", etapa, conversa_id, phone, instance_name, token, lead_id,
                unidade_cuca,
            ):
                return
            await e("Por favor, informe o *número* da vaga que deseja editar (ex: 1, 2, 3...):")
            return
        num = match_num.group(1)
        def _buscar_vaga_edicao():
            vagas_res = supabase.table("vagas").select(
                "id, titulo, status, numero_vaga"
            ).eq("empresa_id", empresa_id).not_.in_("status", ["cancelada"]).execute()
            return next(
                (v for v in (vagas_res.data or []) if str(v.get("numero_vaga", "")) == num),
                None
            )

        vaga_match = await _supabase_to_thread(_buscar_vaga_edicao)
        if not vaga_match:
            await e("Vaga não encontrada ou não disponível para edição. Informe outro número:")
            return
        if vaga_match["status"] == "preenchida":
            await e(f"A vaga *{vaga_match['titulo']}* já está preenchida e não pode ser editada.")
            return
        link_edicao = _assinar_link_portal(
            "/empregabilidade/vagas/editar",
            {"vaga_id": vaga_match["id"], "empresa_id": empresa_id},
        )
        await e(
            f"🔗 Acesse o link abaixo para editar a vaga *{vaga_match['titulo']}*:\n\n"
            f"{link_edicao}\n\n"
            "Todos os dados já estarão preenchidos. Altere apenas o que deseja mudar e clique em *Salvar Alterações*.\n\n"
            "Após o envio, você receberá uma confirmação aqui. As alterações serão validadas pela equipe CUCA antes de a vaga voltar a aceitar candidaturas."
        )
        await _set_fluxo_async(conversa_id, {
            **fluxo,
            "etapa": "aguardando_retorno_edicao",
            "vaga_edicao_id": vaga_match["id"],
            "vaga_edicao_titulo": vaga_match["titulo"],
        })
        return

    # --- ETAPA: aguardando_retorno_edicao ---
    if etapa == "aguardando_retorno_edicao":
        fluxo_atual = await _get_fluxo_async(conversa_id)
        vaga_editada_id = fluxo_atual.get("vaga_editada_id")
        empresa_id = fluxo_atual.get("empresa_id")
        empresa_nome = fluxo_atual.get("empresa_nome_exibicao") or fluxo_atual.get("empresa_nome", "")
        vaga_titulo = fluxo_atual.get("vaga_editada_titulo") or fluxo_atual.get("vaga_edicao_titulo", "")

        if vaga_editada_id:
            # Portal já confirmou a edição — mensagem enviada pelo loop proativo
            # Se chegar aqui por mensagem manual, mostrar menu
            await e(
                "O que deseja fazer agora?\n\n"
                f"{_MENU_ACOES_EMPRESA}"
            )
            await _set_fluxo_async(conversa_id, {
                "perfil": "empresa",
                "etapa": "menu_empresa_acoes",
                "empresa_id": empresa_id,
                "empresa_nome": fluxo_atual.get("empresa_nome", ""),
                "empresa_nome_exibicao": empresa_nome,
                "cnpj": fluxo_atual.get("cnpj"),
            })
        else:
            empresa_id_ref = fluxo.get("empresa_id")
            vaga_id_ref = fluxo.get("vaga_edicao_id")
            link_edicao = _assinar_link_portal(
                "/empregabilidade/vagas/editar",
                {"vaga_id": vaga_id_ref, "empresa_id": empresa_id_ref},
            )
            await e(
                "Ainda aguardando o preenchimento do formulário de edição. 🕐\n\n"
                f"Caso precise do link novamente:\n🔗 {link_edicao}\n\n"
                "Se precisar de ajuda, entre em contato com a equipe da unidade. 🤝"
            )
        return

    # --- ETAPA: selecionando_vaga_cancelamento ---
    if etapa == "selecionando_vaga_cancelamento":
        empresa_id = fluxo.get("empresa_id")
        match_num = _REGEX_NUMERO_VAGA_ISOLADO.search(texto)
        if not match_num:
            # S-WM-20 Task 5: mesmo tratamento de selecionando_vaga_edicao.
            if await _escape_semantico_ou_none(
                texto, "empresa", etapa, conversa_id, phone, instance_name, token, lead_id,
                unidade_cuca,
            ):
                return
            await e("Por favor, informe o *número* da vaga que deseja cancelar (ex: 1, 2, 3...):")
            return
        num = match_num.group(1)
        def _buscar_vaga_cancelamento():
            vagas_res = supabase.table("vagas").select(
                "id, titulo, status, numero_vaga, created_at"
            ).eq("empresa_id", empresa_id).execute()
            return next(
                (v for v in (vagas_res.data or [])
                 if str(v.get("numero_vaga", "")) == num and v["status"] not in ("cancelada",)),
                None
            )

        vaga_match = await _supabase_to_thread(_buscar_vaga_cancelamento)
        if not vaga_match:
            await e("Vaga não encontrada ou já cancelada. Informe outro número ou diga *encerrar*.")
            return
        data_criacao = vaga_match.get("created_at", "")[:10] if vaga_match.get("created_at") else ""
        await e(
            f"⚠️ Você está prestes a *cancelar* a vaga:\n\n"
            f"📋 *{vaga_match['titulo']}*\n"
            f"📅 Criada em: {data_criacao}\n\n"
            "Uma vaga cancelada *não pode ser reativada*. Para publicar novamente no futuro, será necessário criar uma nova vaga.\n\n"
            "Confirma o cancelamento? Responda *sim* para confirmar ou *não* para voltar."
        )
        await _set_fluxo_async(conversa_id, {
            **fluxo,
            "etapa": "confirmando_cancelamento",
            "vaga_cancelar_id": vaga_match["id"],
            "vaga_cancelar_titulo": vaga_match["titulo"],
        })
        return

    # --- ETAPA: confirmando_cancelamento ---
    if etapa == "confirmando_cancelamento":
        t = texto.strip().lower()
        empresa_id = fluxo.get("empresa_id")
        empresa_nome = fluxo.get("empresa_nome_exibicao") or fluxo.get("empresa_nome", "")
        vaga_id_cancelar = fluxo.get("vaga_cancelar_id")
        vaga_titulo_cancelar = fluxo.get("vaga_cancelar_titulo", "")

        if t in _AFIRMATIVO_CANCELAMENTO:
            from datetime import datetime
            def _cancelar_vaga_e_buscar_lead():
                # Buscar histórico atual
                vaga_res = supabase.table("vagas").select(
                    "historico_alteracoes, created_by, unidade_cuca"
                ).eq("id", vaga_id_cancelar).single().execute()
                historico = (vaga_res.data or {}).get("historico_alteracoes") or []
                created_by = (vaga_res.data or {}).get("created_by")
                unidade_vaga = (vaga_res.data or {}).get("unidade_cuca", unidade_cuca)

                nova_entrada = {
                    "tipo": "cancelamento",
                    "canal": "whatsapp",
                    "ator": {"empresa_id": empresa_id},
                    "timestamp": datetime.utcnow().isoformat(),
                }

                supabase.table("vagas").update({
                    "status": "cancelada",
                    "historico_alteracoes": [*historico, nova_entrada],
                    "updated_at": datetime.utcnow().isoformat(),
                }).eq("id", vaga_id_cancelar).execute()

                lead_phone = None
                if created_by:
                    lead_res = supabase.table("leads").select("telefone").eq("id", created_by).single().execute()
                    lead_phone = (lead_res.data or {}).get("telefone")
                return created_by, lead_phone, unidade_vaga

            created_by, lead_phone, unidade_vaga = await _supabase_to_thread(_cancelar_vaga_e_buscar_lead)

            await e(
                f"✅ A vaga *{vaga_titulo_cancelar}* foi *cancelada*.\n\n"
                "Se quiser publicar essa oportunidade novamente no futuro, basta criar uma nova vaga pelo mesmo processo.\n\n"
                "O que deseja fazer agora?\n\n"
                f"{_MENU_ACOES_EMPRESA}"
            )

            # Notificar lead responsável
            if created_by:
                try:
                    if lead_phone:
                        tel_limpo = re.sub(r"\D", "", lead_phone)
                        tel_fmt = tel_limpo if tel_limpo.startswith("55") else f"55{tel_limpo}"
                        msg_lead = (
                            f"❌ *Vaga Cancelada*\n\n"
                            f"A empresa *{empresa_nome}* solicitou o cancelamento da vaga *{vaga_titulo_cancelar}*.\n\n"
                            "O histórico foi registrado. Nenhuma ação é necessária."
                        )
                        try:
                            from meta_adapter_outbound import _meta_enviar  # noqa: PLC0415
                            from campanhas_engine import _get_phone_by_canal_tipo_sync  # noqa: PLC0415
                            canal_info = _get_phone_by_canal_tipo_sync("Institucional")
                            if canal_info:
                                phone_number_id_inst, meta_token_inst = canal_info
                                await _meta_enviar(phone_number_id_inst, tel_fmt, msg_lead, meta_token_inst)
                        except Exception as e_meta:
                            logger.warning(f"Erro ao notificar lead via Meta: {e_meta}")
                except Exception as e_lead:
                    logger.warning(f"[cancelamento] Erro ao notificar lead: {e_lead}")

            await _set_fluxo_async(conversa_id, {
                "perfil": "empresa",
                "etapa": "menu_empresa_acoes",
                "empresa_id": empresa_id,
                "empresa_nome": fluxo.get("empresa_nome", ""),
                "empresa_nome_exibicao": empresa_nome,
                "cnpj": fluxo.get("cnpj"),
            })
        else:
            await e(
                "Cancelamento abortado. A vaga continua ativa.\n\n"
                f"O que deseja fazer?\n\n{_MENU_ACOES_EMPRESA}"
            )
            await _set_fluxo_async(conversa_id, {**fluxo, "etapa": "menu_empresa_acoes"})
        return

    # --- ETAPA: solicitar_cnpj ---
    if etapa == "solicitar_cnpj":
        await e(
            "Olá! 👋 Sou o assistente de empregabilidade do CUCA.\n\n"
            "Para verificar seu cadastro, por favor informe o *CNPJ* da sua empresa (somente números):"
        )
        await _set_fluxo_async(conversa_id, {"etapa": "aguardando_cnpj"})
        return

    # --- ETAPA: aguardando_cnpj ---
    if etapa == "aguardando_cnpj":
        # Escape: pessoa entrou no fluxo errado e indica que não é empresa
        _frases_nao_empresa = [
            "não sou empresa", "nao sou empresa", "não tenho empresa", "nao tenho empresa",
            "sou pessoa física", "pessoa fisica", "pessoa física",
            "busca de trabalho", "procurando emprego", "procuro emprego",
            "quero trabalhar", "quero emprego", "não tenho cnpj", "nao tenho cnpj",
            "sou candidato", "candidato", "busco emprego", "erro", "voltar", "menu",
        ]
        t_lower = texto.lower()
        if any(f in t_lower for f in _frases_nao_empresa):
            # S-WM-20 Task 5: corrigido o mesmo bug do menu_inicial (regressão
            # crítica já corrigida em _rotear_por_intencao) — aqui também
            # travava a conversa ao setar etapa="menu_inicial" (match exato,
            # sem entender frase livre). Não define fluxo: a próxima mensagem
            # sempre re-entra na detecção semântica, sem travar.
            # S-EMP-AUD-025: essa era uma 2ª cópia solta do texto do menu,
            # fora da função centralizada — o mesmo problema que a S-WM-20 já
            # tinha corrigido uma vez, voltando aqui. Agora chama
            # `_mostrar_menu_opcoes` (fonte única), prevenindo divergência
            # futura de novo.
            await _mostrar_menu_opcoes(
                instance_name, token, phone, conversa_id, lead_id,
                intro="Sem problema! 😊 Vamos recomeçar.\n\nComo posso te ajudar?",
            )
            await _set_fluxo_async(conversa_id, {})
            return

        cnpj_limpo = re.sub(r"\D", "", texto)
        if len(cnpj_limpo) != 14:
            # S-WM-20 Task 5 (achado do Junior em staging): "nao nao, sou uma
            # empresa e gostava de subir uma vaga aqui" não bate em nenhuma
            # frase de _frases_nao_empresa (elas cobrem NEGAÇÃO de ser empresa,
            # não afirmação com mudança de assunto) nem tem 14 dígitos —
            # respondia "CNPJ inválido" para sempre. Parser falhou → tenta o
            # classificador semântico antes de repetir o erro.
            if await _escape_semantico_ou_none(
                texto, "empresa", etapa, conversa_id, phone, instance_name, token, lead_id,
                unidade_cuca,
            ):
                return
            await e("CNPJ inválido. Por favor, informe os *14 dígitos* do CNPJ da sua empresa:\n\n_(Se entrou aqui por engano, digite *menu* para voltar ao início.)_")
            return

        def _buscar_empresa_e_autorizacao():
            emp_res = supabase.table("empresas").select("id, nome, nome_fantasia").eq("cnpj", cnpj_limpo).execute()
            if not emp_res.data:
                return None, set(), False
            empresa_db = emp_res.data[0]
            autorizados_res = supabase.table("empresa_whatsapp_autorizados") \
                .select("telefone").eq("empresa_id", empresa_db["id"]).execute()
            telefones = {row["telefone"] for row in (autorizados_res.data or [])}
            backfill = False
            if not telefones:
                # 1º toque nesse CNPJ (nunca autorizado antes) — vincula este número
                # automaticamente. Janela residual aceita pelo Junior (ver Plano 001,
                # "Why this matters").
                supabase.table("empresa_whatsapp_autorizados").insert({
                    "empresa_id": empresa_db["id"], "telefone": phone, "autorizado_por": None,
                }).execute()
                backfill = True
            return empresa_db, telefones, backfill

        empresa, telefones_autorizados, _backfill_autorizacao = await _supabase_to_thread(_buscar_empresa_e_autorizacao)
        if empresa:
            nome_exibicao = empresa.get("nome_fantasia") or empresa["nome"]

            # SEC-01 v2 (Plano 001): empresa_id não é mais concedido incondicionalmente
            # a quem souber o CNPJ — checa se este número (phone, do webhook) já está
            # na lista de autorizados dessa empresa.
            if telefones_autorizados and phone not in telefones_autorizados:
                # Número diferente dos já autorizados — aciona transbordo humano real
                # em vez de só bloquear (mesmo padrão de SQS-40, ver _processar_empregabilidade).
                logger.warning(
                    f"[SEC-01] Tentativa de acessar empresa {empresa['id']} (CNPJ {cnpj_limpo}) "
                    f"de um WhatsApp não autorizado. phone={phone[:6]}****"
                )
                await _acionar_transbordo_empregabilidade(
                    conversa_id=conversa_id,
                    unidade_cuca=unidade_cuca,
                    instance_name=instance_name,
                    token=token,
                    phone=phone,
                    lead_id=lead_id,
                    motivo="cnpj_numero_nao_autorizado",
                    mensagem_sucesso=(
                        "Esse CNPJ já está cadastrado com outro número de WhatsApp autorizado. 🔒\n\n"
                        "Encaminhamos seu contato para verificação da nossa equipe — em breve alguém "
                        "vai confirmar e liberar o acesso, se for o caso."
                    ),
                    reset_fluxo=True,
                )
                return

            await e(
                f"✅ Empresa *{nome_exibicao}* já está cadastrada!\n\n"
                "Deseja divulgar uma vaga agora? Responda *sim* ou *não*."
            )
            await _set_fluxo_async(conversa_id, {
                "etapa": "aguardando_criar_vaga",
                "cnpj": cnpj_limpo,
                "empresa_id": empresa["id"],
                "empresa_nome": empresa["nome"],
                "empresa_nome_exibicao": nome_exibicao,
            })
            return

        # Empresa não cadastrada — consultar CNPJ Brasil
        await e("🔍 Consultando dados na Receita Federal, aguarde...")
        dados_rf = await _consultar_cnpj(cnpj_limpo)

        if not dados_rf:
            await e(
                "Não encontrei dados para esse CNPJ na Receita Federal. "
                "Verifique se digitou corretamente e tente novamente:"
            )
            return

        situacao = (dados_rf.get("situacao_cadastral") or {}).get("descricao", "").upper()
        if "ATIVA" not in situacao and situacao:
            await e(
                f"⚠️ O CNPJ informado está com situação *{situacao}* na Receita Federal.\n"
                "Não é possível cadastrar empresas inativas. Se houver erro, entre em contato com a unidade."
            )
            await _set_fluxo_async(conversa_id, {})
            return

        msg_dados = _formatar_dados_cnpj(dados_rf)
        await e(
            f"{msg_dados}\n\n"
            "As informações estão corretas? Responda *sim* para confirmar o cadastro.\n"
            "Se algum dado estiver desatualizado, informe o que precisa ser corrigido."
        )

        # Extrair campos para pré-cadastro
        endereco = dados_rf.get("estabelecimento") or {}
        municipio = (endereco.get("municipio") or {}).get("descricao", "")
        uf = endereco.get("uf") or ""
        logradouro = endereco.get("logradouro") or ""
        numero_end = endereco.get("numero") or ""
        end_completo = f"{logradouro}, {numero_end} — {municipio}/{uf}".strip(" ,—/")

        await _set_fluxo_async(conversa_id, {
            "etapa": "confirmando_cadastro",
            "cnpj": cnpj_limpo,
            "dados_rf": {
                "nome": dados_rf.get("razao_social") or "",
                "nome_fantasia": dados_rf.get("nome_fantasia") or "",
                "email": (dados_rf.get("estabelecimento") or {}).get("email") or "",
                "telefone": (dados_rf.get("estabelecimento") or {}).get("telefone1") or "",
                "endereco": end_completo,
                "setor": (dados_rf.get("cnae_fiscal_descricao") or ""),
                "porte": (dados_rf.get("porte") or {}).get("descricao") or "",
            },
        })
        return

    # --- ETAPA: confirmando_cadastro ---
    if etapa == "confirmando_cadastro":
        t = texto.strip().lower()
        dados_rf = fluxo.get("dados_rf", {})
        cnpj = fluxo.get("cnpj", "")

        if t in _AFIRMATIVO_CONFIRMACAO_DETALHADA:
            nome_fantasia = dados_rf.get("nome_fantasia") or None
            def _inserir_empresa_e_autorizacao():
                emp_insert = supabase.table("empresas").insert({
                    "nome": dados_rf.get("nome"),
                    "nome_fantasia": nome_fantasia,
                    "cnpj": cnpj,
                    "email": dados_rf.get("email") or None,
                    "telefone": dados_rf.get("telefone") or None,
                    "endereco": dados_rf.get("endereco") or None,
                    "setor": dados_rf.get("setor") or None,
                    "porte": dados_rf.get("porte") or None,
                    "ativa": True,
                }).execute()
                empresa_id_db = emp_insert.data[0]["id"]
                # SEC-01 v2 (Plano 001): vincula este número como autorizado logo após
                # criar a empresa, antes de qualquer mensagem/estado — nenhuma empresa
                # nova fica com 0 números autorizados (janela que daria auto-bind pro
                # próximo número qualquer que tocasse esse CNPJ).
                supabase.table("empresa_whatsapp_autorizados").insert({
                    "empresa_id": empresa_id_db, "telefone": phone, "autorizado_por": None,
                }).execute()
                return empresa_id_db

            empresa_id = await _supabase_to_thread(_inserir_empresa_e_autorizacao)
            empresa_nome = dados_rf.get("nome", "")
            nome_exibicao = nome_fantasia or empresa_nome

            await e(
                f"✅ *Cadastro realizado com sucesso!*\n\n"
                f"🏢 *{nome_exibicao}* agora está na nossa base de parceiros.\n\n"
                "Deseja divulgar uma vaga agora? Responda *sim* ou *não*."
            )
            await _set_fluxo_async(conversa_id, {
                "etapa": "aguardando_criar_vaga",
                "cnpj": cnpj,
                "empresa_id": empresa_id,
                "empresa_nome": empresa_nome,
                "empresa_nome_exibicao": nome_exibicao,
            })
        else:
            dados_rf["correcao"] = texto
            await e(
                "Obrigado pela correção! Guardamos essa informação.\n\n"
                "Confirma o cadastro com a correção informada? Responda *sim* para confirmar:"
            )
            fluxo["dados_rf"] = dados_rf
            fluxo["etapa"] = "confirmando_cadastro_com_correcao"
            await _set_fluxo_async(conversa_id, fluxo)
        return

    # --- ETAPA: confirmando_cadastro_com_correcao ---
    if etapa == "confirmando_cadastro_com_correcao":
        t = texto.strip().lower()
        dados_rf = fluxo.get("dados_rf", {})
        cnpj = fluxo.get("cnpj", "")

        if t in _AFIRMATIVO_CONFIRMACAO:
            nome_fantasia = dados_rf.get("nome_fantasia") or None
            def _inserir_empresa_corrigida_e_autorizacao():
                emp_insert = supabase.table("empresas").insert({
                    "nome": dados_rf.get("nome"),
                    "nome_fantasia": nome_fantasia,
                    "cnpj": cnpj,
                    "email": dados_rf.get("email") or None,
                    "telefone": dados_rf.get("telefone") or None,
                    "endereco": dados_rf.get("endereco") or None,
                    "setor": dados_rf.get("setor") or None,
                    "porte": dados_rf.get("porte") or None,
                    "ativa": True,
                }).execute()
                empresa_id_db = emp_insert.data[0]["id"]
                # SEC-01 v2 (Plano 001): vincula este número como autorizado logo após
                # criar a empresa, antes de qualquer mensagem/estado — nenhuma empresa
                # nova fica com 0 números autorizados (janela que daria auto-bind pro
                # próximo número qualquer que tocasse esse CNPJ).
                supabase.table("empresa_whatsapp_autorizados").insert({
                    "empresa_id": empresa_id_db, "telefone": phone, "autorizado_por": None,
                }).execute()
                return empresa_id_db

            empresa_id = await _supabase_to_thread(_inserir_empresa_corrigida_e_autorizacao)
            empresa_nome = dados_rf.get("nome", "")
            nome_exibicao = nome_fantasia or empresa_nome

            await e(
                f"✅ *Cadastro realizado com sucesso!*\n\n"
                f"🏢 *{nome_exibicao}* agora está na nossa base.\n\n"
                "Deseja divulgar uma vaga agora? Responda *sim* ou *não*."
            )
            await _set_fluxo_async(conversa_id, {
                "etapa": "aguardando_criar_vaga",
                "cnpj": cnpj,
                "empresa_id": empresa_id,
                "empresa_nome": empresa_nome,
                "empresa_nome_exibicao": nome_exibicao,
            })
        else:
            await e("Entendido. Se precisar de ajuda, pode entrar em contato novamente. 👋")
            await _set_fluxo_async(conversa_id, {})
        return

    # --- ETAPA: aguardando_criar_vaga ---
    if etapa == "aguardando_criar_vaga":
        t = texto.strip().lower()
        empresa_id = fluxo.get("empresa_id")
        empresa_nome = fluxo.get("empresa_nome", "")
        nome_exibicao = fluxo.get("empresa_nome_exibicao") or empresa_nome

        if t in _AFIRMATIVO_CRIAR_VAGA:
            await e(
                "Ótimo! 🎯 Antes de gerar o link da vaga, preciso de algumas informações do *responsável pelo processo seletivo*.\n\n"
                "Qual é o *e-mail* para receber os currículos?\n"
                "(pode ser diferente do e-mail geral da empresa)"
            )
            await _set_fluxo_async(conversa_id, {
                "etapa": "coletando_email_responsavel",
                "empresa_id": empresa_id,
                "empresa_nome": empresa_nome,
                "empresa_nome_exibicao": nome_exibicao,
                "cnpj": fluxo.get("cnpj"),
            })
        else:
            await e(
                "Sem problema! O que deseja fazer?\n\n"
                f"{_MENU_ACOES_EMPRESA}"
            )
            await _set_fluxo_async(conversa_id, {
                "perfil": "empresa",
                "etapa": "menu_empresa_acoes",
                "cnpj": fluxo.get("cnpj"),
                "empresa_id": empresa_id,
                "empresa_nome": empresa_nome,
                "empresa_nome_exibicao": nome_exibicao,
            })
        return

    # --- ETAPA: coletando_email_responsavel ---
    if etapa == "coletando_email_responsavel":
        email_candidato = texto.strip()
        # Validação básica de e-mail
        if "@" not in email_candidato or "." not in email_candidato.split("@")[-1]:
            # S-WM-20 Task 5: e-mail inválido — antes só repetia o pedido.
            if await _escape_semantico_ou_none(
                texto, "empresa", etapa, conversa_id, phone, instance_name, token, lead_id,
                unidade_cuca,
            ):
                return
            await e(
                "⚠️ Esse e-mail não parece válido. Por favor, informe um e-mail no formato correto (ex: rh@empresa.com.br):"
            )
            return
        await e(
            f"Perfeito! E-mail registrado: *{email_candidato}*\n\n"
            "Agora informe o *telefone/WhatsApp do responsável* pela seleção:\n"
            "(com DDD, ex: 85999990000)"
        )
        await _set_fluxo_async(conversa_id, {
            **fluxo,
            "etapa": "coletando_telefone_responsavel",
            "email_responsavel": email_candidato,
        })
        return

    # --- ETAPA: coletando_telefone_responsavel ---
    if etapa == "coletando_telefone_responsavel":
        tel_digits = re.sub(r"\D", "", texto.strip())
        if len(tel_digits) < 10:
            # S-WM-20 Task 5: telefone inválido — antes só repetia o pedido.
            if await _escape_semantico_ou_none(
                texto, "empresa", etapa, conversa_id, phone, instance_name, token, lead_id,
                unidade_cuca,
            ):
                return
            await e(
                "⚠️ Telefone inválido. Por favor, informe o número com DDD (ex: 85999990000):"
            )
            return
        empresa_id = fluxo.get("empresa_id")
        empresa_nome = fluxo.get("empresa_nome", "")
        nome_exibicao = fluxo.get("empresa_nome_exibicao") or empresa_nome
        email_responsavel = fluxo.get("email_responsavel", "")
        # SQS-49: antes de enviar o link, perguntar qual tipo de divulgação
        await e(
            f"✅ Dados registrados!\n\n"
            f"📧 E-mail: {email_responsavel}\n"
            f"📱 Telefone: {tel_digits}\n\n"
            "Como deseja divulgar?\n\n"
            "1️⃣ *Criar uma vaga* — Para uma vaga específica com requisitos detalhados\n"
            "2️⃣ *Marcar seleção* — Processo seletivo com vários cargos e data definida\n\n"
            "Responda com *1* ou *2*."
        )
        await _set_fluxo_async(conversa_id, {
            "etapa": "escolhendo_tipo_vaga",
            "empresa_id": empresa_id,
            "empresa_nome": empresa_nome,
            "empresa_nome_exibicao": nome_exibicao,
            "cnpj": fluxo.get("cnpj"),
            "email_responsavel": email_responsavel,
            "telefone_responsavel": tel_digits,
            "perfil": "empresa",
        })
        return

    # --- ETAPA: escolhendo_tipo_vaga (SQS-49) ---
    if etapa == "escolhendo_tipo_vaga":
        t_tipo = texto.strip().lower()
        empresa_id = fluxo.get("empresa_id")
        email_responsavel = fluxo.get("email_responsavel", "")
        tel_digits = fluxo.get("telefone_responsavel", "")
        if t_tipo in ("1", "vaga", "criar", "criar vaga", "vaga normal"):
            link_vaga = _assinar_link_portal(
                "/empregabilidade/vagas/nova",
                {
                    "empresa_id": empresa_id,
                    "unidade_cuca": unidade_cuca,
                    "email_responsavel": email_responsavel,
                    "telefone_responsavel": tel_digits,
                },
            )
            await e(
                "Ótimo! 🎯 Acesse o link abaixo para preencher os dados completos da vaga:\n\n"
                f"🔗 {link_vaga}\n\n"
                "Após o preenchimento, você receberá aqui o *número da vaga* e a confirmação. "
                "A vaga será revisada pela equipe do CUCA antes de ser publicada."
            )
            await _set_fluxo_async(conversa_id, {
                **fluxo,
                "etapa": "aguardando_retorno_vaga",
            })
        elif t_tipo in ("2", "selecao", "seleção", "marcar", "marcar selecao", "marcar seleção", "evento"):
            link_selecao = _assinar_link_portal(
                "/empregabilidade/selecao/nova",
                {
                    "empresa_id": empresa_id,
                    "unidade_cuca": unidade_cuca,
                    "email_responsavel": email_responsavel,
                    "telefone_responsavel": tel_digits,
                },
            )
            await e(
                "Ótimo! 📋 Acesse o link abaixo para registrar o processo seletivo:\n\n"
                f"🔗 {link_selecao}\n\n"
                "Você poderá informar as datas, horários e cargos disponíveis. "
                "Após o preenchimento, você receberá aqui a confirmação."
            )
            await _set_fluxo_async(conversa_id, {
                **fluxo,
                "etapa": "aguardando_retorno_selecao",
            })
        else:
            # S-WM-20 Task 5: nem 1 nem 2 — antes só repetia o pedido para sempre.
            tratado = await _escape_semantico_ou_none(
                texto, "empresa", etapa, conversa_id, phone, instance_name, token, lead_id,
                unidade_cuca,
            )
            if not tratado:
                await e(
                    "Não entendi. Responda com *1* para criar uma vaga ou *2* para marcar seleção:"
                )
        return

    # --- ETAPA: aguardando_retorno_vaga (após link enviado) ---
    if etapa == "aguardando_retorno_vaga":
        # Verificar se o portal já notificou que a vaga foi criada
        fluxo_atual = await _get_fluxo_async(conversa_id)
        vaga_criada_id = fluxo_atual.get("vaga_criada_id")
        vaga_numero = fluxo_atual.get("vaga_numero")
        vaga_titulo = fluxo_atual.get("vaga_titulo", "")
        empresa_id = fluxo_atual.get("empresa_id")
        empresa_nome_exibicao = fluxo_atual.get("empresa_nome_exibicao") or fluxo_atual.get("empresa_nome", "")

        if vaga_criada_id:
            numero_ref = f"#{vaga_numero}" if vaga_numero else f"...{vaga_criada_id[-6:].upper()}"
            await e(
                f"✅ *Vaga cadastrada com sucesso!*\n\n"
                f"📋 *Título:* {vaga_titulo}\n"
                f"🔢 *Número da vaga:* {numero_ref}\n\n"
                "Guarde esse número para acompanhar as candidaturas aqui no WhatsApp.\n\n"
                "O que deseja fazer agora?\n\n"
                "1️⃣ Divulgar outra vaga\n"
                "2️⃣ Acompanhar candidatos desta vaga\n"
                "3️⃣ Encerrar\n\n"
                "Responda com *1*, *2* ou *3*."
            )
            await _set_fluxo_async(conversa_id, {
                "etapa": "menu_pos_vaga",
                "empresa_id": empresa_id,
                "empresa_nome": fluxo_atual.get("empresa_nome", ""),
                "empresa_nome_exibicao": empresa_nome_exibicao,
                "cnpj": fluxo_atual.get("cnpj"),
                "ultima_vaga_id": vaga_criada_id,
            })
        else:
            # Formulário ainda não preenchido — reenviar link como lembrete
            empresa_id = fluxo.get("empresa_id")
            link_vaga = _assinar_link_portal(
                "/empregabilidade/vagas/nova",
                {
                    "empresa_id": empresa_id,
                    "unidade_cuca": unidade_cuca,
                    "email_responsavel": fluxo.get("email_responsavel", ""),
                    "telefone_responsavel": fluxo.get("telefone_responsavel", ""),
                },
            )
            await e(
                "Ainda aguardando o preenchimento do formulário de vaga. 🕐\n\n"
                f"Caso precise do link novamente:\n🔗 {link_vaga}\n\n"
                "Se precisar de ajuda, entre em contato com a equipe da unidade. 🤝"
            )
        return

    # --- ETAPA: menu_pos_vaga ---
    if etapa == "menu_pos_vaga":
        t = texto.strip().lower()
        empresa_id = fluxo.get("empresa_id")
        empresa_nome = fluxo.get("empresa_nome_exibicao") or fluxo.get("empresa_nome", "")

        if t in ("1", "divulgar", "divulgar outra vaga", "nova vaga", "criar", "cadastrar"):
            await e(
                "Ótimo! 🎯 Antes de gerar o link da vaga, preciso de algumas informações do *responsável pelo processo seletivo*.\n\n"
                "Qual é o *e-mail* para receber os currículos?\n"
                "(pode ser diferente do e-mail geral da empresa)"
            )
            await _set_fluxo_async(conversa_id, {
                "perfil": "empresa",
                "etapa": "coletando_email_responsavel",
                "empresa_id": empresa_id,
                "empresa_nome": fluxo.get("empresa_nome", ""),
                "empresa_nome_exibicao": empresa_nome,
                "cnpj": fluxo.get("cnpj"),
            })
        elif t in ("2", "acompanhar", "acompanhar candidatos", "candidatos", "status"):
            await _set_fluxo_async(conversa_id, {**fluxo, "etapa": "consulta_empresa"})
            await _processar_consulta_empresa("todas", phone, instance_name, token, fluxo, conversa_id)
        elif t in ("3", "encerrar", "finalizar", "tchau", "sair"):
            await _encerrar_fluxo(conversa_id, instance_name, token, phone, "empresa")
        else:
            tratado = await _escape_semantico_ou_none(
                texto, "empresa", etapa, conversa_id, phone, instance_name, token, lead_id,
                unidade_cuca,
            )
            if not tratado:
                await e(
                    "Não entendi. Escolha uma das opções:\n\n"
                    "1️⃣ Divulgar outra vaga\n"
                    "2️⃣ Acompanhar candidatos desta vaga\n"
                    "3️⃣ Encerrar\n\n"
                    "Responda com *1*, *2* ou *3*."
                )
        return

    # --- ETAPA: aguardando_retorno_selecao (após link enviado, BUG-01) ---
    if etapa == "aguardando_retorno_selecao":
        # Verificar se o portal já notificou que a seleção foi criada — mesmo campo
        # compartilhado com vaga (confirmado em empregabilidade_notify_loop:2679 e em
        # selecao/route.ts, que grava vaga_criada_id/vaga_numero/vaga_titulo também
        # para seleção por evento, SQS-49; não existe coluna "selecao_criada_id" própria)
        fluxo_atual = await _get_fluxo_async(conversa_id)
        selecao_criada_id = fluxo_atual.get("vaga_criada_id")
        selecao_numero = fluxo_atual.get("vaga_numero")
        selecao_titulo = fluxo_atual.get("vaga_titulo", "")
        empresa_id = fluxo_atual.get("empresa_id")
        empresa_nome_exibicao = fluxo_atual.get("empresa_nome_exibicao") or fluxo_atual.get("empresa_nome", "")

        if selecao_criada_id:
            numero_ref = f"#{selecao_numero}" if selecao_numero else f"...{selecao_criada_id[-6:].upper()}"
            await e(
                f"✅ *Processo seletivo cadastrado com sucesso!*\n\n"
                f"📋 *Título:* {selecao_titulo}\n"
                f"🔢 *Número de referência:* {numero_ref}\n\n"
                "Guarde essa referência para acompanhar as candidaturas aqui no WhatsApp.\n\n"
                "O que deseja fazer agora?\n\n"
                "1️⃣ Divulgar outra vaga\n"
                "2️⃣ Acompanhar candidatos desta seleção\n"
                "3️⃣ Encerrar\n\n"
                "Responda com *1*, *2* ou *3*."
            )
            await _set_fluxo_async(conversa_id, {
                "etapa": "menu_pos_vaga",
                "empresa_id": empresa_id,
                "empresa_nome": fluxo_atual.get("empresa_nome", ""),
                "empresa_nome_exibicao": empresa_nome_exibicao,
                "cnpj": fluxo_atual.get("cnpj"),
                "ultima_vaga_id": selecao_criada_id,
            })
        else:
            # Formulário ainda não preenchido — reenviar link como lembrete
            empresa_id = fluxo.get("empresa_id")
            link_selecao = _assinar_link_portal(
                "/empregabilidade/selecao/nova",
                {
                    "empresa_id": empresa_id,
                    "unidade_cuca": unidade_cuca,
                    "email_responsavel": fluxo.get("email_responsavel", ""),
                    "telefone_responsavel": fluxo.get("telefone_responsavel", ""),
                },
            )
            await e(
                "Ainda aguardando o preenchimento do formulário de seleção. 🕐\n\n"
                f"Caso precise do link novamente:\n🔗 {link_selecao}\n\n"
                "Se precisar de ajuda, entre em contato com a equipe da unidade. 🤝"
            )
        return

    # --- ETAPA: consulta_empresa ---
    if etapa in ("consulta_empresa", "empresa_ativa"):
        await _processar_consulta_empresa(texto, phone, instance_name, token, fluxo, conversa_id)
        return

    # Fallback — iniciar fluxo empresa
    await _set_fluxo_async(conversa_id, {"etapa": "solicitar_cnpj"})
    await _processar_empresa(texto, phone, instance_name, token, lead_id, conversa_id, unidade_cuca)


# ---------------------------------------------------------------------------
# Helper: lista vagas da empresa para edição ou cancelamento
# ---------------------------------------------------------------------------

async def _listar_vagas_para_acao(
    empresa_id: str,
    instance_name: str,
    token: str,
    phone: str,
    acao: str,
    conversa_id: str,
    fluxo: dict,
):
    """Lista vagas disponíveis para edição ou cancelamento e aguarda escolha."""

    async def e(msg: str):
        await _enviar(instance_name, token, phone, msg, conversa_id=conversa_id)

    if acao == "edicao":
        status_excluidos = ["cancelada", "preenchida"]
        verbo = "editar"
        instrucao = "Informe o *número* da vaga que deseja editar:"
    else:
        status_excluidos = ["cancelada"]
        verbo = "cancelar"
        instrucao = "Informe o *número* da vaga que deseja cancelar:"

    def _buscar_vagas():
        return supabase.table("vagas").select(
            "id, titulo, status, numero_vaga"
        ).eq("empresa_id", empresa_id).not_.in_("status", status_excluidos).order("numero_vaga", desc=False).limit(10).execute()

    vagas_res = await _supabase_to_thread(_buscar_vagas)

    vagas = vagas_res.data or []
    if not vagas:
        msg_vazia = (
            "Não há vagas disponíveis para edição no momento."
            if acao == "edicao"
            else "Não há vagas ativas para cancelar."
        )
        await e(msg_vazia)
        return

    linhas = [f"📋 *Vagas disponíveis para {verbo}:*\n"]
    for v in vagas:
        numero_ref = f"#{v['numero_vaga']}" if v.get("numero_vaga") else f"...{v['id'][-6:].upper()}"
        linhas.append(f"• {numero_ref} *{v['titulo']}* — {v['status']}")
    linhas.append(f"\n{instrucao}")

    await e("\n".join(linhas))


# ---------------------------------------------------------------------------
# Consulta de vagas pela empresa
# ---------------------------------------------------------------------------

async def _processar_consulta_empresa(
    texto: str,
    phone: str,
    instance_name: str,
    token: str,
    fluxo: dict,
    conversa_id: str,
):
    t = texto.strip().lower()
    empresa_id = fluxo.get("empresa_id")

    async def e(msg: str):
        await _enviar(instance_name, token, phone, msg, conversa_id=conversa_id)

    # Encerrar se pedido
    if _quer_encerrar(texto):
        await _encerrar_fluxo(conversa_id, instance_name, token, phone, "empresa")
        return

    # Buscar pelo número da vaga sequencial ou ref UUID
    match_vaga = _REGEX_NUMERO_VAGA_ISOLADO.search(texto)
    if match_vaga and empresa_id:
        num = match_vaga.group(1)

        def _buscar_vaga_e_candidatos():
            vagas_res = supabase.table("vagas").select(
                "id, titulo, status, total_vagas, numero_vaga, created_at"
            ).eq("empresa_id", empresa_id).execute()

            vaga_match = None
            for v in (vagas_res.data or []):
                if str(v.get("numero_vaga", "")) == num or v["id"][-6:].upper() in texto.upper():
                    vaga_match = v
                    break
            if not vaga_match:
                return None, 0
            cands = supabase.table("candidaturas").select("status", count="exact").eq("vaga_id", vaga_match["id"]).execute()
            return vaga_match, cands.count or 0

        vaga_match, total_cands = await _supabase_to_thread(_buscar_vaga_e_candidatos)

        if vaga_match:
            numero_ref = f"#{vaga_match['numero_vaga']}" if vaga_match.get("numero_vaga") else f"...{vaga_match['id'][-6:].upper()}"
            await e(
                f"📋 *Vaga {numero_ref}:* {vaga_match['titulo']}\n"
                f"📌 *Status:* {vaga_match['status']}\n"
                f"👥 *Candidatos:* {total_cands}\n\n"
                "Deseja ver outra vaga, criar uma nova ou encerrar?"
            )
        else:
            await e("Não encontrei essa vaga. Informe o número da vaga ou *todas* para listar.")
        return

    # Listar todas as vagas da empresa
    if empresa_id:
        def _listar_vagas_com_contagens():
            vagas_res = supabase.table("vagas").select(
                "id, titulo, status, total_vagas, numero_vaga"
            ).eq("empresa_id", empresa_id).order("numero_vaga", desc=False).limit(10).execute()
            vagas = vagas_res.data or []
            vaga_ids = [v["id"] for v in vagas]
            contagens = {vaga_id: 0 for vaga_id in vaga_ids}
            if vaga_ids:
                cands_res = supabase.table("candidaturas").select("vaga_id").in_("vaga_id", vaga_ids).execute()
                for cand in cands_res.data or []:
                    vaga_id = cand.get("vaga_id")
                    if vaga_id in contagens:
                        contagens[vaga_id] += 1
            return vagas, contagens

        vagas, contagens = await _supabase_to_thread(_listar_vagas_com_contagens)

        if not vagas:
            await e("Sua empresa ainda não tem vagas cadastradas. Deseja criar uma? Responda *sim*.")
            await _set_fluxo_async(conversa_id, {**fluxo, "etapa": "aguardando_criar_vaga"})
            return

        linhas = ["📋 *Suas vagas cadastradas:*\n"]
        for v in vagas:
            numero_ref = f"#{v['numero_vaga']}" if v.get("numero_vaga") else f"...{v['id'][-6:].upper()}"
            linhas.append(
                f"• {numero_ref} *{v['titulo']}* — {v['status']} ({contagens.get(v['id'], 0)} candidatos)"
            )
        linhas.append("\nInforme o *número* da vaga para ver detalhes, ou diga *encerrar*.")
        await e("\n".join(linhas))
    else:
        await e("Para consultar suas vagas, informe o *CNPJ* da empresa:")
        await _set_fluxo_async(conversa_id, {"etapa": "aguardando_cnpj"})


# ---------------------------------------------------------------------------
# Fluxo de CANDIDATO ATIVO
# ---------------------------------------------------------------------------

def _telefone_normalizado_para_comparacao(valor: str) -> str:
    """SEC-02: normaliza telefone pros 2 lados de uma comparação de posse
    (phone do webhook vs. candidaturas.telefone, que tem formatação
    inconsistente em produção — confirmado ao vivo 2026-07-29: 46 linhas
    puro-dígito, 78 com formatação tipo "(85) 92146-7046"). Reaproveita
    `normalizar_telefone` (campanhas_engine) em vez de reinventar — mesma
    regra (só dígitos, prefixo 55 se for BR sem DDI) já usada no restante
    do projeto."""
    from campanhas_engine import normalizar_telefone  # noqa: PLC0415
    if not valor:
        return ""
    return normalizar_telefone(valor)


async def _processar_candidato(
    texto: str,
    phone: str,
    instance_name: str,
    token: str,
    lead_id: str,
    conversa_id: str,
):
    fluxo = await _get_fluxo_async(conversa_id)
    etapa = fluxo.get("etapa", "solicitar_identificacao")

    async def e(msg: str):
        await _enviar(instance_name, token, phone, msg, conversa_id=conversa_id, lead_id=lead_id)

    # Encerramento — S-WM-20 Task 2: exclusão de "aguardando_id_candidato" removida.
    # Não havia justificativa documentada (diferente de S37C-03 em pos_candidatura, ou
    # das frases_nao_empresa em aguardando_cnpj) — era exatamente o bug 3 do relatório:
    # lead preso no estado sem conseguir sair mesmo dizendo "tchau"/"obrigado".
    if _quer_encerrar(texto):
        await _encerrar_fluxo(conversa_id, instance_name, token, phone, "candidato")
        return

    if etapa == "solicitar_identificacao":
        await e(
            "Para consultar sua candidatura, informe:\n\n"
            "• O *número da candidatura* recebido (6 caracteres, ex: AB12CD)\n"
            "• Seu *nome completo*\n"
            "• Ou o *telefone* cadastrado no momento da inscrição"
        )
        await _set_fluxo_async(conversa_id, {"etapa": "aguardando_id_candidato"})
        return

    if etapa == "aguardando_id_candidato":
        # S-WM-20 Task 3: escape hatch semântico antes do parser sintático —
        # bug 3 do relatório ("nao nao, sou uma empresa" não batia com
        # _quer_encerrar nem com o parser de CPF/ref/telefone/nome, caindo
        # sempre em "não encontrei candidatura").
        #
        # S-WM-20 Task 5 (migração pós-achado de QA): esta etapa tinha sua
        # própria cópia inline da lógica de escape, escrita antes de
        # `_escape_semantico_ou_none` existir como helper compartilhado — por
        # isso nunca ganhou o ajuste 3 (pergunta de confirmação antes de
        # trocar de rota). Migrada para usar o helper e ficar consistente com
        # as outras 14 etapas.
        if await _escape_semantico_ou_none(
            texto, "candidato", etapa, conversa_id, phone, instance_name, token, lead_id,
        ):
            return

        apenas_digitos = re.sub(r"\D", "", texto)
        texto_limpo = texto.strip()

        candidaturas_encontradas = []

        def _buscar_candidaturas_e_vagas():
            candidaturas = []

            # Busca por CPF (histórico)
            if len(apenas_digitos) == 11:
                cand_pessoa = supabase.table("candidatos").select("id").eq("cpf", apenas_digitos).execute()
                ids_candidatos = [c["id"] for c in (cand_pessoa.data or [])]
                if ids_candidatos:
                    cand_res = supabase.table("candidaturas").select(
                        "id, status, vaga_id, created_at, observacoes"
                    ).in_("candidato_id", ids_candidatos).order("created_at", desc=True).limit(5).execute()
                    candidaturas = cand_res.data or []

            # Busca por número de candidatura (6+ chars alfanuméricos)
            elif re.match(r"^[A-Za-z0-9]{6}$", texto_limpo):
                ref = texto_limpo.upper()
                todas = supabase.table("candidaturas").select(
                    "id, status, vaga_id, created_at, observacoes"
                ).order("created_at", desc=True).limit(500).execute()
                candidaturas = [
                    c for c in (todas.data or [])
                    if c["id"].replace("-", "")[-6:].upper() == ref
                ]

            # Busca por telefone (10-11 dígitos) — SEC-02: só aceita se bater com quem
            # está perguntando. Normaliza os 2 lados (candidaturas.telefone tem
            # formatação inconsistente em produção) — por isso não dá pra filtrar
            # direto no banco com .eq(), traz um lote amplo e filtra em Python. O
            # `.limit()` aqui precisa cobrir a tabela inteira (mesmo padrão já usado
            # na busca por código de referência, algumas linhas acima) — um limit(5)
            # pego ANTES do filtro por telefone perderia a candidatura certa sempre
            # que ela não estiver entre as 5 mais recentes da tabela toda (a exibição
            # final já limita a 5 resultados, logo abaixo, depois do filtro).
            elif len(apenas_digitos) in (10, 11):
                telefone_quem_pergunta = _telefone_normalizado_para_comparacao(phone)
                cand_res = supabase.table("candidaturas").select(
                    "id, status, vaga_id, created_at, observacoes, telefone"
                ).order("created_at", desc=True).limit(500).execute()
                candidaturas = [
                    c for c in (cand_res.data or [])
                    if _telefone_normalizado_para_comparacao(c.get("telefone") or "") == telefone_quem_pergunta
                ]

            # Busca por nome (texto com espaço, 5+ chars) — SEC-02: nome sozinho não
            # basta, tem que bater também com o telefone de quem está perguntando
            # (mesma normalização dos 2 lados usada na busca por telefone acima).
            elif len(texto_limpo) >= 5 and " " in texto_limpo:
                cand_res = supabase.table("candidaturas").select(
                    "id, status, vaga_id, created_at, observacoes, nome, telefone"
                ).ilike("nome", f"%{texto_limpo}%").order("created_at", desc=True).limit(5).execute()
                telefone_quem_pergunta = _telefone_normalizado_para_comparacao(phone)
                candidaturas = [
                    c for c in (cand_res.data or [])
                    if _telefone_normalizado_para_comparacao(c.get("telefone") or "") == telefone_quem_pergunta
                ]

            vaga_ids = list({
                c["vaga_id"]
                for c in candidaturas[:5]
                if c.get("vaga_id")
            })
            titulos_por_vaga = {}
            if vaga_ids:
                vagas_res = supabase.table("vagas").select("id, titulo").in_("id", vaga_ids).execute()
                titulos_por_vaga = {
                    v["id"]: v.get("titulo", "Vaga")
                    for v in (vagas_res.data or [])
                }
            titulos = {
                c["id"]: titulos_por_vaga.get(c.get("vaga_id"), "Vaga")
                for c in candidaturas[:5]
            }
            return candidaturas, titulos

        candidaturas_encontradas, titulos_vagas = await _supabase_to_thread(_buscar_candidaturas_e_vagas)

        if not candidaturas_encontradas:
            await e(
                "Não encontrei candidatura com esse dado. 🔍\n\n"
                "Você pode tentar com:\n"
                "• *Número da candidatura* (6 caracteres, ex: AB12CD)\n"
                "• *Nome completo*\n"
                "• *Telefone* cadastrado\n\n"
                "Ou entre em contato diretamente com a unidade CUCA."
            )
            return

        linhas = ["📋 *Candidatura(s) encontrada(s):*\n"]
        for c in candidaturas_encontradas[:5]:
            titulo_vaga = titulos_vagas.get(c["id"], "Vaga")
            obs = c.get("observacoes") or ""
            if "banco_talentos" in obs:
                status_emoji = "⏳"
                status_label = "Em banco de talentos — aguardando oportunidade compatível"
            else:
                status_map = {
                    "pendente": ("⏳", "Pendente — em análise"),
                    "selecionado": ("✅", "Selecionado"),
                    "rejeitado": ("❌", "Não selecionado"),
                    "contratado": ("🎉", "Contratado"),
                }
                status_emoji, status_label = status_map.get(c.get("status", "pendente"), ("⏳", "Pendente"))
            linhas.append(
                f"{status_emoji} *{titulo_vaga}*\n"
                f"   Status: {status_label}\n"
                f"   Ref: {c['id'].replace('-','')[-6:].upper()}"
            )
        await e("\n".join(linhas))
        await e(
            "Deseja consultar outra candidatura ou encerrar?\n\n"
            "Responda com *outro* para nova consulta ou *encerrar* para finalizar."
        )
        await _set_fluxo_async(conversa_id, {"etapa": "candidato_consultado", "perfil": "candidato"})
        return

    # Estado consultado — oferecer nova consulta ou encerrar
    if etapa == "candidato_consultado":
        t = texto.strip().lower()
        if any(p in t for p in ("outro", "outra", "mais", "nova consulta", "consultar")):
            await e(
                "Informe o número da candidatura, nome completo ou telefone cadastrado:"
            )
            await _set_fluxo_async(conversa_id, {"etapa": "aguardando_id_candidato", "perfil": "candidato"})
        elif _tem_palavra_encerramento(texto):
            await e(
                "Fico feliz em ajudar. 😊\n\n"
                "Se quiser consultar outra candidatura, responda *outro*. "
                "Se quiser finalizar, responda *encerrar*."
            )
        else:
            # S-WM-20 Task 5: antes qualquer coisa que não fosse "outro/outra/
            # mais" encerrava direto — tenta o classificador semântico antes
            # (pode ser mudança de assunto, não necessariamente despedida).
            if not await _escape_semantico_ou_none(
                texto, "candidato", etapa, conversa_id, phone, instance_name, token, lead_id,
            ):
                await _encerrar_fluxo(conversa_id, instance_name, token, phone, "candidato")
        return

    # Fallback
    await _set_fluxo_async(conversa_id, {"perfil": "candidato", "etapa": "solicitar_identificacao"})
    await _processar_candidato(texto, phone, instance_name, token, lead_id, conversa_id)


# ---------------------------------------------------------------------------
# Fluxo de GRANDE PÚBLICO
# ---------------------------------------------------------------------------

_INTENCAO_BANCO_TALENTOS = {
    "nenhuma dessas", "nenhuma", "não encontrei", "nao encontrei",
    "guardar meu currículo", "guardar curriculo", "banco de talentos",
    "deixar currículo", "deixar curriculo", "quero me cadastrar",
    "não tem nada", "nao tem nada", "enviar currículo", "enviar curriculo",
    "mandar currículo", "mandar curriculo", "cadastrar currículo",
    "cadastrar curriculo", "opção 4", "opcao 4", "número 4", "numero 4",
    "menu 4", "opção quatro", "opcao quatro",
}


def _quer_banco_talentos(texto: str, etapa: str = "", fluxo: dict | None = None) -> bool:
    """Detecta correção de intenção para banco de talentos sem roubar opções válidas."""
    t = texto.strip().lower()
    # S-WM-20 Task 5: risco residual encontrado ao testar o fast-path quer_banco
    # de oferta_banco_talentos (apontado pelo @qa) — "não quero banco de talentos,
    # sou uma empresa" batia em "banco de talentos" aqui, ANTES de qualquer
    # dispatch por etapa, interceptando a mensagem antes mesmo do gate semântico
    # de oferta_banco_talentos ter chance de rodar.
    # Fix cuidadoso: alguns dos próprios gatilhos legítimos já contêm "não"/"nao"
    # por design ("não encontrei", "não tem nada") — um filtro cego de negação
    # quebraria esses casos. Em vez disso, remove os trechos que deram match e só
    # cancela se sobrar "não"/"nao" no resto da frase (negação de fato externa ao
    # gatilho, não parte dele).
    matched = [p for p in _INTENCAO_BANCO_TALENTOS if p in t]
    if matched:
        resto = t
        for p in matched:
            resto = resto.replace(p, "")
        if not any(neg in resto for neg in ("não", "nao")):
            return True

    # "4" puro é ambíguo em menus dinâmicos. Só redireciona se a etapa atual
    # não tiver uma opção 4 válida visível para o lead.
    if t not in ("4", "4.", "04"):
        return False

    fluxo = fluxo or {}
    if etapa == "listou_categorias" and "4" in (fluxo.get("mapa_categorias") or {}):
        return False
    if etapa == "listou_vagas" and "4" in (fluxo.get("mapa_vagas") or {}):
        return False
    if etapa == "aguardando_escolha_unidade" and len(fluxo.get("unidades_opcoes") or []) >= 4:
        return False
    if etapa == "listando_cargos_selecao" and len(fluxo.get("cargos_disponiveis") or []) >= 4:
        return False
    # S-EMP-AUD-023 passo 2: mesmas checagens para as etapas novas de cargo consolidado
    if etapa == "listou_cargos_consolidados" and "4" in (fluxo.get("mapa_cargos_consolidados") or {}):
        return False
    if etapa == "listou_ocorrencias_cargo" and "4" in (fluxo.get("mapa_ocorrencias") or {}):
        return False

    return etapa in {
        "inicio", "listou_categorias", "listou_vagas",
        "aguardando_escolha_unidade", "listando_cargos_selecao",
        "pos_candidatura", "candidatura_confirmada", "oferta_banco_talentos",
        "listou_cargos_consolidados", "listou_ocorrencias_cargo",
    }


async def _processar_publico(
    texto: str,
    phone: str,
    instance_name: str,
    token: str,
    lead_id: str,
    conversa_id: str,
    unidade_cuca: str,
):
    fluxo = await _get_fluxo_async(conversa_id)
    etapa = fluxo.get("etapa", "inicio")
    t_lower = texto.strip().lower()

    # Helper local: envia e grava automaticamente no DB para exibição no painel
    async def e(msg: str):
        return await _enviar(instance_name, token, phone, msg, conversa_id=conversa_id, lead_id=lead_id)

    async def iniciar_banco_talentos():
        historico_aplicadas = list(fluxo.get("historico_vagas_aplicadas") or [])
        await e(
            "📁 *Banco de Talentos CUCA*\n\n"
            "Podemos cadastrar seu currículo no banco de talentos. "
            "Quando surgir uma vaga compatível com seu perfil, a equipe entrará em contato.\n\n"
            "Para continuar, preciso do seu *nome completo*:"
        )
        await _set_fluxo_async(conversa_id, {
            "perfil": "publico",
            "etapa": "coletando_nome_candidato",
            "banco_talentos": True,
            "historico_vagas_aplicadas": historico_aplicadas,
            "nome_candidato_prefill": fluxo.get("nome_candidato_prefill", ""),
        })

    if t_lower in ("voltar", "volta") and etapa in _ETAPA_ANTERIOR:
        if await _voltar_etapa_publico(
            fluxo=fluxo, etapa=etapa, conversa_id=conversa_id,
            instance_name=instance_name, token=token, phone=phone, lead_id=lead_id,
        ):
            return

    if etapa == "oferecendo_atendente_humano":
        if t_lower in _AFIRMATIVO_CONFIRMACAO:
            await _acionar_transbordo_empregabilidade(
                conversa_id=conversa_id, unidade_cuca=unidade_cuca,
                instance_name=instance_name, token=token, phone=phone, lead_id=lead_id,
                motivo="oferta_proativa_falhas",
                mensagem_sucesso="Sua solicitação foi registrada. Em breve você será atendido por nossa equipe.",
            )
            return
        if t_lower in _NEGATIVO_ATENDENTE_HUMANO:
            contexto = fluxo.get("_oferta_atendente_contexto") or {}
            fluxo_anterior = contexto.get("fluxo_anterior") or {}
            etapa_anterior = contexto.get("etapa_anterior") or fluxo_anterior.get("etapa", "inicio")
            await e("Tudo bem, seguimos por aqui.")
            await _set_fluxo_async(conversa_id, _fluxo_sem_falhas_atendente({
                **fluxo_anterior,
                "perfil": "publico",
                "etapa": etapa_anterior,
            }))
            return
        await e("Quer que eu chame nossa equipe para continuar o atendimento? Responda *sim* ou *não*.")
        return

    # Encerramento
    # S37C-03: pos_candidatura é tolerante — "obrigado", "valeu" não encerram o fluxo
    if _quer_encerrar(texto) and etapa not in (
        "coletando_nome_candidato", "confirmando_terceiro", "pos_candidatura",
        "coletando_nome_curriculo_publico",
    ):
        await _encerrar_fluxo(conversa_id, instance_name, token, phone, "publico")
        return

    # SQS-53: correção de rota quando o lead escolheu vagas por engano e depois
    # expressa intenção de enviar currículo para o banco de talentos.
    if _quer_banco_talentos(texto, etapa, fluxo):
        await iniciar_banco_talentos()
        return

    # --- ETAPA: aguardando_confirmacao_candidatura ---
    # Verifica se o portal já registrou a candidatura e envia o número
    if etapa == "aguardando_confirmacao_candidatura":
        fluxo_atual = await _get_fluxo_async(conversa_id)
        candidatura_id = fluxo_atual.get("candidatura_criada_id")
        candidatura_codigo = fluxo_atual.get("candidatura_codigo")
        curriculo_publico_salvo = fluxo_atual.get("curriculo_publico_salvo")

        if candidatura_id or curriculo_publico_salvo:
            eh_banco_talentos = fluxo_atual.get("banco_talentos", False)
            if eh_banco_talentos:
                await e(
                    "✅ *Currículo salvo com sucesso!*\n\n"
                    "Seu currículo foi cadastrado no banco de talentos da rede CUCA. "
                    "Assim que surgir uma oportunidade compatível com seu perfil e área de interesse, "
                    "nossa equipe entrará em contato diretamente por aqui. 🎯\n\n"
                    "Obrigado por confiar na CUCA!\n\n"
                    "Deseja ver as *vagas abertas* ou encerrar por aqui?\n"
                    "Responda *vagas* para ver oportunidades ou *encerrar*."
                )
                await _set_fluxo_async(conversa_id, {
                    "etapa": "candidatura_confirmada",
                    "perfil": "publico",
                })
            else:
                codigo = candidatura_codigo or candidatura_id.replace("-", "")[-6:].upper()
                # S37C-02: Mensagem 1 — confirmação com o código de acompanhamento
                await e(
                    f"🎉 *Candidatura recebida com sucesso!*\n\n"
                    f"🔢 *Número de acompanhamento:* *{codigo}*\n\n"
                    "Guarde esse número! Com ele você pode verificar o status da sua candidatura a qualquer momento. ✅"
                )
                # S37C-02: Mensagem 2 — oferta de nova candidatura (separada para melhor UX)
                await e(
                    "Deseja se candidatar a outra vaga da CUCA? 👀\n\n"
                    "Responda *outra* para ver mais vagas ou *encerrar* para finalizar."
                )
                # S37C-04/05: salva histórico de vagas e prefill do nome para o próximo ciclo
                vaga_confirmada = fluxo_atual.get("vaga_id_selecionada")
                historico = list(fluxo_atual.get("historico_vagas_aplicadas") or [])
                if vaga_confirmada and vaga_confirmada not in historico:
                    historico.append(vaga_confirmada)
                await _set_fluxo_async(conversa_id, {
                    "etapa": "pos_candidatura",  # S37C-01
                    "perfil": "publico",
                    "ultima_candidatura_codigo": codigo,
                    "historico_vagas_aplicadas": historico,
                    "nome_candidato_prefill": fluxo_atual.get("nome_candidato", ""),
                })
        else:
            tem_negacao = any(p in t_lower for p in ("não", "nao"))
            if not tem_negacao and any(
                p in t_lower for p in ("outra", "mais", "ver vagas", "outras vagas", "vagas", "vaga")
            ):
                await _set_fluxo_async(conversa_id, {
                    "perfil": "publico",
                    "etapa": "inicio",
                    "historico_vagas_aplicadas": fluxo_atual.get("historico_vagas_aplicadas") or [],
                    "nome_candidato_prefill": fluxo_atual.get("nome_candidato_prefill", ""),
                })
                await _processar_publico("vagas", phone, instance_name, token, lead_id, conversa_id, unidade_cuca)
                return

            if await _escape_semantico_ou_none(
                texto, "publico", etapa, conversa_id, phone, instance_name, token, lead_id, unidade_cuca,
            ):
                return

            # Ainda aguardando — link reenviado se necessário
            link_reenviado = fluxo_atual.get("link_candidatura", "")
            await e(
                "Ainda aguardando o envio do seu currículo. 🕐\n\n"
                f"{'Acesse o link para preencher: 🔗 ' + link_reenviado if link_reenviado else ''}\n\n"
                "Após o envio, você receberá aqui o número de acompanhamento."
            )
        return

    # --- ETAPA: candidatura_confirmada (S37C-06: alias de retrocompatibilidade) ---
    # Mantido para não quebrar leads que estavam nesta etapa durante o deploy.
    # Comportamento idêntico ao antigo — redireciona para pos_candidatura de forma transparente.
    if etapa == "candidatura_confirmada":
        if any(p in t_lower for p in ("outra", "mais", "ver vagas", "outras vagas", "vagas", "vaga")):
            await _set_fluxo_async(conversa_id, {
                "perfil": "publico",
                "etapa": "pos_candidatura",
                "historico_vagas_aplicadas": fluxo.get("historico_vagas_aplicadas") or [],
                "nome_candidato_prefill": fluxo.get("nome_candidato_prefill", ""),
            })
            await _processar_publico("vagas", phone, instance_name, token, lead_id, conversa_id, unidade_cuca)
        else:
            # S-WM-20 Task 5: antes qualquer coisa fora de "outra/vagas/mais"
            # encerrava direto — tenta o classificador semântico primeiro.
            if not await _escape_semantico_ou_none(
                texto, "publico", etapa, conversa_id, phone, instance_name, token, lead_id, unidade_cuca,
            ):
                await _encerrar_fluxo(conversa_id, instance_name, token, phone, "publico")
        return

    # --- ETAPA: pos_candidatura (S37C-01) ---
    if etapa == "pos_candidatura":
        tem_negacao = any(p in t_lower for p in ("não", "nao"))
        quer_mais_vagas = not tem_negacao and any(p in t_lower for p in (
            "outra", "mais", "ver vagas", "outras vagas", "vagas", "vaga", "sim", "quero", "ok"
        ))
        quer_encerrar_claro = any(p in t_lower for p in (
            "não", "nao", "encerrar", "tchau", "até mais", "até logo", "finalizar", "pode fechar"
        ))

        if quer_mais_vagas:
            # S37C-04/05: preserva histórico e prefill, reinicia listagem de vagas
            await _set_fluxo_async(conversa_id, {
                "perfil": "publico",
                "etapa": "inicio",
                "historico_vagas_aplicadas": fluxo.get("historico_vagas_aplicadas") or [],
                "nome_candidato_prefill": fluxo.get("nome_candidato_prefill", ""),
            })
            await _processar_publico("vagas", phone, instance_name, token, lead_id, conversa_id, unidade_cuca)
        elif quer_encerrar_claro:
            await _encerrar_fluxo(conversa_id, instance_name, token, phone, "publico")
        else:
            # S37C-03 + S-WM-20 Task 5: mensagem ambígua (ex: "obrigado",
            # "valeu") — antes de reapresentar as opções, tenta o classificador
            # semântico (pode ser uma mudança de assunto real, ex.: "na
            # verdade eu sou uma empresa", não apenas um agradecimento).
            if not await _escape_semantico_ou_none(
                texto, "publico", etapa, conversa_id, phone, instance_name, token, lead_id, unidade_cuca,
            ):
                await e(
                    "Fico feliz em ter ajudado! 😊\n\n"
                    "Ainda quer se candidatar a outra vaga?\n"
                    "Responda *outra* para ver mais vagas ou *encerrar* para finalizar."
                )
        return

    # --- ETAPA: oferta_banco_talentos ---
    if etapa == "oferta_banco_talentos":
        # S-WM-20 Task 5: risco residual apontado pelo @qa no gate da Task 3/4 —
        # "não quero banco de talentos, sou empresa" batia em "banco"/"talentos"
        # e disparava o fast-path antes de chegar ao gate semântico. Reproduzido
        # e confirmado real (ver Dev Agent Record). Fix: presença de negação
        # desativa o fast-path e deixa a decisão para o classificador semântico,
        # que lê a frase inteira em vez de uma palavra isolada.
        tem_negacao = any(p in t_lower for p in ("não", "nao"))
        quer_banco = not tem_negacao and any(
            p in t_lower for p in ("sim", "quero", "ok", "claro", "pode", "banco", "talentos", "cadastrar")
        )
        if quer_banco:
            await e("Para continuar, preciso do seu *nome completo*:")
            await _set_fluxo_async(conversa_id, {
                "perfil": "publico",
                "etapa": "coletando_nome_candidato",
                "banco_talentos": True,
                "historico_vagas_aplicadas": fluxo.get("historico_vagas_aplicadas") or [],
                "nome_candidato_prefill": fluxo.get("nome_candidato_prefill", ""),
            })
            return

        # S-WM-20 Task 3: gate semântico substitui a checagem de negação por
        # substring isolada (bug 5 do relatório: "nao nao, eu sou uma empresa
        # e gostava de subir uma vaga aqui" encerrava o fluxo por causa da
        # substring "nao", ignorando o resto da frase).
        #
        # S-WM-20 Task 5 (migração pós-achado de QA): esta etapa tinha sua
        # própria cópia inline da lógica de escape (com uma exclusão extra de
        # "banco_talentos" que o helper compartilhado não tem — nessa etapa
        # específica, se o classificador já detecta banco_talentos por vias
        # indiretas que o fast-path `quer_banco` não pegou, faz mais sentido
        # perguntar/confirmar do que simplesmente encerrar, que era o
        # comportamento anterior). Migrada para `_escape_semantico_ou_none`
        # para ganhar o ajuste 3 (pergunta de confirmação) e ficar consistente
        # com as outras 14 etapas.
        if await _escape_semantico_ou_none(
            texto, "publico", etapa, conversa_id, phone, instance_name, token, lead_id, unidade_cuca,
        ):
            return

        # Recusa ou mensagem ambígua → única despedida e encerramento
        await _encerrar_fluxo(conversa_id, instance_name, token, phone, "publico")
        return

    # --- ETAPA: coletando_nome_candidato ---
    if etapa == "coletando_nome_candidato":
        # S-WM-20 Task 5, categoria (b): qualquer texto é um nome "válido" —
        # não dá pra usar mudou_de_assunto (falso-positivo alto em nomes
        # incomuns). Checa só quer_sair, de alta precisão, antes de aceitar.
        if await _quer_sair_semantico(texto, "publico", etapa, conversa_id, phone, instance_name, token):
            return
        # S-EMP-AUD-024: fast-path literal antes de tratar como nome — ver
        # `_escape_literal_ou_none`.
        if await _escape_literal_ou_none(texto, conversa_id, phone, instance_name, token, lead_id, unidade_cuca):
            return
        nome_coletado = texto.strip()
        vaga_id_ref = fluxo.get("vaga_id_selecionada")
        eh_banco_talentos = fluxo.get("banco_talentos", False)

        # Achado em produção 2026-08-18: mesma classe de bug já corrigida em
        # coletando_nome_curriculo_publico (2026-08-13, ConnectTimeout esporádico
        # pra Graph API) — aqui o envio da pergunta "eu ou outra pessoa?" não era
        # checado, e a etapa avançava pra confirmando_terceiro mesmo se a
        # mensagem nunca tivesse saído. O candidato ficava esperando uma
        # pergunta que nunca chegou, sem qualquer sinal de erro (caso real:
        # lead informou o nome e não recebeu mais nada).
        # Retry agora é centralizado em `_meta_enviar` (mesmo dia) — cobre
        # este e todos os outros handlers automaticamente. Aqui só resta
        # checar o resultado final e logar se, mesmo com o retry interno,
        # o envio não saiu.
        enviado = await e(
            f"Obrigado, *{nome_coletado}*!\n\n"
            "Esse currículo é para *você mesmo(a)* ou para outra pessoa?\n\n"
            "Responda *eu* ou *outra pessoa*."
        )
        if not enviado:
            logger.error(
                "[coletando_nome_candidato] Falha ao enviar pergunta eu/outra pessoa (mesmo após retry) para %s — "
                "avança etapa mesmo assim; qualquer mensagem seguinte do candidato em confirmando_terceiro "
                "é interpretada como resposta (default 'é pra mim mesmo' se não disser 'outra pessoa').",
                phone[:6] + "****",
            )
        await _set_fluxo_async(conversa_id, {
            **fluxo,
            "etapa": "confirmando_terceiro",
            "nome_candidato": nome_coletado,
            "vaga_id_selecionada": vaga_id_ref,
            "banco_talentos": eh_banco_talentos,
        })
        return

    # --- ETAPA: coletando_nome_curriculo_publico (SQS-58, opção 5) ---
    if etapa == "coletando_nome_curriculo_publico":
        if await _quer_sair_semantico(texto, "publico", etapa, conversa_id, phone, instance_name, token):
            return
        # S-EMP-AUD-024: fast-path literal antes de tratar como nome.
        if await _escape_literal_ou_none(texto, conversa_id, phone, instance_name, token, lead_id, unidade_cuca):
            return
        nome_coletado = texto.strip()
        talent_id = _criar_ou_recuperar_talent_bank(nome_coletado, phone)
        link = _assinar_link_portal(
            "/empregabilidade/curriculo",
            {
                "nome": nome_coletado,
                "talent_id": talent_id,
                "conversa_id": conversa_id,
                # origem_tel só preenche o campo telefone por padrão no formulário —
                # o candidato pode trocar, não é mais validado como travamento (a
                # pedido do Junior: o link pode ser aberto de um telefone diferente
                # do que deve constar no currículo).
                "origem_tel": re.sub(r"\D", "", phone),
            },
            ttl_horas=24,
        )
        mensagem_link = (
            f"Perfeito, *{nome_coletado}*! 📝\n\n"
            f"Acesse o link abaixo pelo celular para montar seu currículo:\n\n"
            f"🔗 {link}\n\n"
            "Seu nome já vem preenchido. Preencha o restante (inclusive o telefone de contato — "
            "pode ser diferente deste WhatsApp, sem problema). Ao salvar, você recebe o PDF e o "
            "currículo já entra no banco de talentos da rede CUCA. ✅"
        )
        # Achado em produção 2026-08-13: ConnectTimeout esporádico pra Graph API
        # deixava o candidato "travado" — o fluxo avançava pra
        # aguardando_confirmacao_candidatura mesmo sem a mensagem nunca ter
        # saído (nenhum retry, resultado de `e()` nunca checado). Uma nova
        # mensagem do candidato ainda reenviaria o link (fallback já existente
        # em aguardando_confirmacao_candidatura), mas o candidato não tinha
        # motivo pra saber disso — o bot simplesmente parou de responder.
        # Retry único como mitigação de baixo risco (falha transitória de rede
        # costuma se resolver em segundos); não introduz busy-loop nem trava
        # a etapa se as duas tentativas falharem.
        enviado = await e(mensagem_link)
        if not enviado:
            logger.warning(
                "[curriculo_publico] Falha ao enviar link (1ª tentativa) para %s — retry único",
                phone[:6] + "****",
            )
            enviado = await e(mensagem_link)
            if not enviado:
                # Duas tentativas falharam. Não deixa a etapa em
                # coletando_nome_curriculo_publico — a próxima mensagem do
                # candidato seria mal-interpretada como um novo nome. Avança
                # para aguardando_confirmacao_candidatura mesmo assim: essa
                # etapa já reenvia `link_candidatura` na próxima mensagem
                # recebida (ver bloco "Ainda aguardando..." abaixo), servindo
                # de rede de segurança para esta falha de envio.
                logger.error(
                    "[curriculo_publico] Falha ao enviar link (2 tentativas) para %s — "
                    "avança etapa mesmo assim; link será reenviado na próxima mensagem "
                    "do candidato via fallback de aguardando_confirmacao_candidatura.",
                    phone[:6] + "****",
                )
        await _set_fluxo_async(conversa_id, {
            "perfil": "publico",
            "etapa": "aguardando_confirmacao_candidatura",
            "nome_candidato": nome_coletado,
            "link_candidatura": link,
            "banco_talentos": True,
            "talent_id": talent_id,
        })
        return

    # --- ETAPA: confirmando_terceiro ---
    if etapa == "confirmando_terceiro":
        nome_candidato = fluxo.get("nome_candidato", "")
        vaga_id_ref = fluxo.get("vaga_id_selecionada")
        eh_banco_talentos = fluxo.get("banco_talentos", False)

        if any(p in t_lower for p in ("outra", "outro", "outra pessoa", "amigo", "familiar", "parente", "não")):
            # Mesma mitigação de 2026-08-18 aplicada em coletando_nome_candidato —
            # sem isso, se o envio falhasse o candidato ficava em
            # coletando_nome_terceiro sem nunca ter visto o pedido do nome.
            # Retry agora é centralizado em `_meta_enviar` — aqui só resta logar
            # se, mesmo com o retry interno, o envio não saiu.
            enviado = await e("Tudo certo! Informe o *nome completo* da pessoa para quem você está enviando o currículo:")
            if not enviado:
                logger.error(
                    "[confirmando_terceiro] Falha ao enviar pedido de nome do terceiro (mesmo após retry) para %s.",
                    phone[:6] + "****",
                )
            await _set_fluxo_async(conversa_id, {
                **fluxo,
                "etapa": "coletando_nome_terceiro",
                "vaga_id_selecionada": vaga_id_ref,
                "banco_talentos": eh_banco_talentos,
            })
            return

        # S-WM-20 Task 5: diferente das etapas de coleta de nome (qualquer
        # texto é um nome válido), aqui a resposta esperada é um binário
        # eu/outra pessoa — se não bateu com o "outra pessoa" acima, o código
        # assumia sempre "é para si mesmo" e disparava a candidatura em
        # silêncio, mesmo numa mudança de assunto real. Checa o classificador
        # completo (não só quer_sair) antes desse default silencioso.
        if await _escape_semantico_ou_none(
            texto, "publico", etapa, conversa_id, phone, instance_name, token, lead_id, unidade_cuca,
        ):
            return

        # É para si mesmo — enviar link
        await _enviar_link_candidatura(
            instance_name, token, phone, conversa_id, fluxo,
            nome_candidato, phone, vaga_id_ref, eh_banco_talentos, lead_id=lead_id
        )
        return

    # --- ETAPA: coletando_nome_terceiro ---
    if etapa == "coletando_nome_terceiro":
        # S-WM-20 Task 5, categoria (b): mesmo tratamento de coletando_nome_candidato.
        if await _quer_sair_semantico(texto, "publico", etapa, conversa_id, phone, instance_name, token):
            return
        # S-EMP-AUD-024: fast-path literal antes de tratar como nome.
        if await _escape_literal_ou_none(texto, conversa_id, phone, instance_name, token, lead_id, unidade_cuca):
            return
        nome_terceiro = texto.strip()
        vaga_id_ref = fluxo.get("vaga_id_selecionada")
        eh_banco_talentos = fluxo.get("banco_talentos", False)

        await _enviar_link_candidatura(
            instance_name, token, phone, conversa_id, fluxo,
            nome_terceiro, phone, vaga_id_ref, eh_banco_talentos, lead_id=lead_id
        )
        return

    # --- ETAPA: listando_cargos_selecao (SQS-49) ---
    # Candidato escolheu uma vaga do tipo selecao_evento e agora escolhe o(s) cargo(s)
    if etapa == "listando_cargos_selecao":
        cargos_disponiveis = fluxo.get("cargos_disponiveis", [])
        vaga_id_ref = fluxo.get("vaga_id_selecionada")
        escolhas_raw = re.findall(r"\d+", texto)
        cargos_escolhidos = []
        for n in escolhas_raw:
            idx = int(n) - 1
            if 0 <= idx < len(cargos_disponiveis):
                titulo = cargos_disponiveis[idx].get("titulo", "")
                if titulo:
                    cargos_escolhidos.append(titulo)
        if not cargos_escolhidos:
            # S-WM-20 Task 5: nenhum número reconhecido — antes só repetia a lista.
            if await _escape_semantico_ou_none(
                texto, "publico", etapa, conversa_id, phone, instance_name, token, lead_id, unidade_cuca,
            ):
                return
            if await _registrar_falha_e_oferecer_atendente(
                fluxo=fluxo, etapa=etapa, conversa_id=conversa_id,
                instance_name=instance_name, token=token, phone=phone, lead_id=lead_id,
            ):
                return
            linhas_re = ["Não entendi. Digite o número do cargo de interesse. Ex: *1* ou *1,3*\n"]
            for idx_c, c in enumerate(cargos_disponiveis, start=1):
                linhas_re.append(f"{idx_c}️⃣ {c.get('titulo', '')}")
            linhas_re.append("\nDigite *voltar* para ver outras opções.")
            await e("\n".join(linhas_re))
            return
        # SQS-56: `coleta_curriculo is False` desvia para confirmação de
        # presença (nome + telefone), sem passar por
        # coletando_nome_candidato/_enviar_link_candidatura. `is False`
        # explícito: qualquer valor que não seja False (None incluído)
        # mantém o comportamento atual. Lógica compartilhada com
        # `listou_ocorrencias_cargo` (S-EMP-AUD-023 passo 2) via
        # `_confirmar_cargos_selecao_evento`.
        await _confirmar_cargos_selecao_evento(
            fluxo=fluxo,
            vaga_id_ref=vaga_id_ref,
            cargos_escolhidos=cargos_escolhidos,
            coleta_curriculo=fluxo.get("coleta_curriculo") is not False,
            conversa_id=conversa_id,
            instance_name=instance_name, token=token, phone=phone, lead_id=lead_id,
        )
        return

    # --- ETAPA: confirmando_presenca_nome (SQS-56) ---
    if etapa == "confirmando_presenca_nome":
        # Campo de DADO livre (nome) — mesma variante de alta precisão usada
        # em coletando_nome_candidato/coletando_nome_terceiro: só honra
        # quer_sair, nunca mudou_de_assunto (nome incomum teria falso-positivo
        # alto nesse sinal).
        if await _quer_sair_semantico(texto, "publico", etapa, conversa_id, phone, instance_name, token):
            return
        # S-EMP-AUD-024: fast-path literal antes de tratar como nome — tem
        # que vir antes da checagem de nome_invalido/tamanho, senão frases
        # de 2+ palavras ("quero ver vagas") passariam como nome válido.
        if await _escape_literal_ou_none(texto, conversa_id, phone, instance_name, token, lead_id, unidade_cuca):
            return

        texto_limpo = texto.strip()
        t_lower_nome = texto_limpo.lower()
        tentativas = fluxo.get("tentativas_confirmacao_presenca", 0)

        # AC6: uma afirmação isolada ("sim", "ok", "confirmar"...) não é um
        # nome — reconduz pedindo o nome completo, não registra.
        nome_invalido = (
            not texto_limpo
            or t_lower_nome in _AFIRMATIVO_CONFIRMACAO
            or len(texto_limpo.split()) < 2
        )
        if nome_invalido:
            tentativas += 1
            if tentativas >= 2:
                # AC9 gatilho (a): 2 respostas consecutivas não reconhecidas
                # na mesma etapa — transbordo imediato + pausa da IA.
                await _acionar_transbordo_empregabilidade(
                    conversa_id=conversa_id, unidade_cuca=unidade_cuca,
                    instance_name=instance_name, token=token, phone=phone, lead_id=lead_id,
                    motivo="selecao_presenca_confusao",
                    mensagem_sucesso="Sua solicitação foi registrada. Em breve você será atendido por nossa equipe.",
                )
                return
            await e(
                "Não consegui identificar seu nome completo. 🙏\n\n"
                "Para confirmar sua presença, digite seu *nome completo* (nome e sobrenome):"
            )
            await _set_fluxo_async(conversa_id, {**fluxo, "tentativas_confirmacao_presenca": tentativas})
            return

        await e(f"Obrigado, *{texto_limpo}*!\n\nAgora preciso do seu *telefone para contato* (com DDD):")
        await _set_fluxo_async(conversa_id, {
            **fluxo,
            "etapa": "confirmando_presenca_telefone",
            "nome_confirmacao_presenca": texto_limpo,
            "tentativas_confirmacao_presenca": 0,
        })
        return

    # --- ETAPA: confirmando_presenca_telefone (SQS-56) ---
    if etapa == "confirmando_presenca_telefone":
        from campanhas_engine import normalizar_telefone  # noqa: PLC0415
        from meta_adapter_outbound import _normalizar_telefone_br  # noqa: PLC0415

        digits_tel = re.sub(r"\D", "", texto)
        tel_com_ddi = normalizar_telefone(digits_tel) if digits_tel else ""
        local_tel = tel_com_ddi[2:] if tel_com_ddi.startswith("55") else tel_com_ddi

        # AC7: valida o FORMATO de celular antes de normalizar — o número
        # de 9 dígitos é obrigatório desde a resolução da Anatel de 2016.
        # _normalizar_telefone_br insere o "9" cegamente quando ausente,
        # o que criaria um "celular" falso a partir de um fixo (ex.:
        # 8532001234 → 85932001234) se não filtrarmos antes.
        mobile_valido = bool(local_tel) and (
            (len(local_tel) == 11 and local_tel[2] == "9")
            or (len(local_tel) == 10 and local_tel[2] in "6789")
        )
        tel_norm = _normalizar_telefone_br(tel_com_ddi) if mobile_valido else ""
        telefone_valido = mobile_valido and tel_norm.startswith("55") and len(tel_norm) == 13

        if not telefone_valido:
            # Parser determinístico falhou — tenta o classificador semântico
            # (mesmo padrão de listando_cargos_selecao/pos_candidatura) antes
            # de reexplicar; telefone tem formato verificável, então
            # _escape_semantico_ou_none (não _quer_sair_semantico) é o
            # correto aqui.
            if await _escape_semantico_ou_none(
                texto, "publico", etapa, conversa_id, phone, instance_name, token, lead_id, unidade_cuca,
            ):
                return
            tentativas_tel = fluxo.get("tentativas_confirmacao_presenca", 0) + 1
            if tentativas_tel >= 2:
                # AC9 gatilho (a)
                await _acionar_transbordo_empregabilidade(
                    conversa_id=conversa_id, unidade_cuca=unidade_cuca,
                    instance_name=instance_name, token=token, phone=phone, lead_id=lead_id,
                    motivo="selecao_presenca_confusao",
                    mensagem_sucesso="Sua solicitação foi registrada. Em breve você será atendido por nossa equipe.",
                )
                return
            await e(
                "Não consegui reconhecer esse telefone. 🙏\n\n"
                "Digite o telefone com DDD, só números (ex: 85999998888):"
            )
            await _set_fluxo_async(conversa_id, {**fluxo, "tentativas_confirmacao_presenca": tentativas_tel})
            return

        # AC8: só grava com nome E telefone — os dois já garantidos aqui.
        nome_final = fluxo.get("nome_confirmacao_presenca", "")
        cargos_finais = fluxo.get("cargos_escolhidos") or []
        vaga_id_final = fluxo.get("vaga_id_selecionada")
        empresa_nome_final = fluxo.get("empresa_nome_selecao", "")

        # candidaturas.telefone é a identidade (número do WhatsApp, igual a
        # todo o resto do fluxo) — telefone_contato é o número digitado
        # (Item 3 da análise de impacto da story). NUNCA status != "pendente".
        phone_local_grav = phone[2:] if phone.startswith("55") and len(phone) > 11 else phone

        def _gravar_presencas():
            gravados = []
            for cargo in (cargos_finais or [None]):
                # Mesmo guard anti-duplicidade de candidaturas/route.ts
                # (vaga_id, telefone, cargo_escolhido) — não há índice único
                # no banco para isso, então replica o check-then-insert.
                query_dup = supabase.table("candidaturas").select("id").eq(
                    "vaga_id", vaga_id_final
                ).eq("telefone", phone_local_grav)
                query_dup = query_dup.eq("cargo_escolhido", cargo) if cargo else query_dup.is_("cargo_escolhido", "null")
                existe = query_dup.limit(1).execute()
                if existe.data:
                    gravados.append(cargo)
                    continue
                supabase.table("candidaturas").insert({
                    "vaga_id": vaga_id_final,
                    "nome": nome_final,
                    "telefone": phone_local_grav,
                    "telefone_contato": tel_norm,
                    "cargo_escolhido": cargo,
                    "status": "pendente",
                    "confirmacao_presenca": "confirmado",
                    "unidade_cuca": unidade_cuca or None,
                }).execute()
                gravados.append(cargo)
            return gravados

        await _supabase_to_thread(_gravar_presencas)

        linhas_final = [f"✅ Presença confirmada, *{nome_final}*!\n"]
        if empresa_nome_final:
            linhas_final.append(f"Você está registrado(a) no processo seletivo *{empresa_nome_final}*.")
        linhas_final.append(
            "\nQuer continuar procurando outras vagas ou prefere encerrar por aqui?\n"
            "Responda *outra* para ver mais vagas ou *encerrar* para finalizar."
        )
        await e("\n".join(linhas_final))

        # AC10: reusa a mesma etapa pos_candidatura já existente (S37C-01)
        # para a pergunta "continuar ou encerrar" interpretada por IA — sem
        # duplicar lógica que já está madura e testada.
        await _set_fluxo_async(conversa_id, {
            "perfil": "publico",
            "etapa": "pos_candidatura",
            "historico_vagas_aplicadas": fluxo.get("historico_vagas_aplicadas") or [],
            "nome_candidato_prefill": nome_final,
        })
        return

    # --- ETAPA: listou_categorias (SQS-41 Ação 2.1) ---
    if etapa == "listou_categorias":
        mapa_cat = fluxo.get("mapa_categorias", {})
        match_cat = re.search(r"\b(\d{1,2})\b", texto)
        if match_cat and match_cat.group(1) in mapa_cat:
            cat_data = mapa_cat[match_cat.group(1)]
            meta_vagas = await _mostrar_vagas_da_categoria(
                instance_name, token, phone, conversa_id, lead_id, cat_data,
            )
            await _set_fluxo_async(conversa_id, {
                **_fluxo_sem_falhas_atendente(fluxo),
                "etapa": "listou_vagas",
                **meta_vagas,
            })
        else:
            # Re-exibe o menu de categorias
            if await _registrar_falha_e_oferecer_atendente(
                fluxo=fluxo, etapa=etapa, conversa_id=conversa_id,
                instance_name=instance_name, token=token, phone=phone, lead_id=lead_id,
            ):
                return
            await _mostrar_categorias(instance_name, token, phone, conversa_id, lead_id, mapa_cat)
        return

    # --- ETAPA: aguardando_escolha_unidade (SQS-41 Ação 2.3) ---
    if etapa == "aguardando_escolha_unidade":
        unidades_opcoes: list = fluxo.get("unidades_opcoes", [])
        vaga_id_global = fluxo.get("vaga_id_selecionada")
        match_unid = re.search(r"\b([1-5])\b", t_lower)
        if match_unid and unidades_opcoes:
            idx_escolha = int(match_unid.group(1)) - 1
            if 0 <= idx_escolha < len(unidades_opcoes):
                unidade_escolhida = unidades_opcoes[idx_escolha]
                unidade_id_escolhida: str = unidade_escolhida["id"]
                nome_prefill = fluxo.get("nome_candidato_prefill", "")
                novo_fluxo = {
                    **_fluxo_sem_falhas_atendente(fluxo),
                    "unidade_id_escolhida": unidade_id_escolhida,
                }
                if nome_prefill:
                    await _enviar_link_candidatura(
                        instance_name, token, phone, conversa_id, novo_fluxo,
                        nome_prefill, phone, vaga_id_global, False, lead_id=lead_id
                    )
                else:
                    if await e("Para finalizar sua candidatura, preciso do seu *nome completo*:"):
                        await _set_fluxo_async(conversa_id, {
                            **novo_fluxo,
                            "etapa": "coletando_nome_candidato",
                            "banco_talentos": False,
                        })
                return
        # Resposta inválida — re-exibe as opções
        if await _escape_semantico_ou_none(
            texto, "publico", etapa, conversa_id, phone, instance_name, token, lead_id, unidade_cuca,
        ):
            return
        if await _registrar_falha_e_oferecer_atendente(
            fluxo=fluxo, etapa=etapa, conversa_id=conversa_id,
            instance_name=instance_name, token=token, phone=phone, lead_id=lead_id,
        ):
            return
        linhas_re_unid = [
            "Não entendi. Por favor, escolha a unidade CUCA mais próxima de você:\n"
        ]
        for idx_ru, u in enumerate(unidades_opcoes, start=1):
            linhas_re_unid.append(f"*{idx_ru}.* {u['nome']}")
        linhas_re_unid.append("\nDigite *voltar* para ver outras opções.")
        await e("\n".join(linhas_re_unid))
        return

    # --- ETAPA: listou_cargos_consolidados (S-EMP-AUD-023 passo 2, Nível 1) ---
    if etapa == "listou_cargos_consolidados":
        mapa_cargos_fluxo = fluxo.get("mapa_cargos_consolidados", {})
        escolhas_raw_n1 = re.findall(r"\d+", texto)
        chaves_escolhidas = [n for n in escolhas_raw_n1 if n in mapa_cargos_fluxo]
        if chaves_escolhidas:
            meta_ocorrencias = await _mostrar_ocorrencias_cargo(
                instance_name, token, phone, conversa_id, lead_id, mapa_cargos_fluxo, chaves_escolhidas,
            )
            await _set_fluxo_async(conversa_id, {
                **_fluxo_sem_falhas_atendente(fluxo),
                "etapa": "listou_ocorrencias_cargo",
                **meta_ocorrencias,
            })
            return
        # S-EMP-AUD-024: escape semântico ligado desde o nascimento da etapa
        # (seção 5, regra 7 da story — não repetir o gap que a 024 corrigiu).
        if await _escape_semantico_ou_none(
            texto, "publico", etapa, conversa_id, phone, instance_name, token, lead_id, unidade_cuca,
        ):
            return
        if await _registrar_falha_e_oferecer_atendente(
            fluxo=fluxo, etapa=etapa, conversa_id=conversa_id,
            instance_name=instance_name, token=token, phone=phone, lead_id=lead_id,
        ):
            return
        await _mostrar_cargos_consolidados(instance_name, token, phone, conversa_id, lead_id, mapa_cargos_fluxo)
        return

    # --- ETAPA: listou_ocorrencias_cargo (S-EMP-AUD-023 passo 2, Nível 2) ---
    if etapa == "listou_ocorrencias_cargo":
        mapa_ocorrencias_fluxo = fluxo.get("mapa_ocorrencias", {})
        escolhas_raw_n2 = re.findall(r"\d+", texto)
        numeros_validos = [n for n in escolhas_raw_n2 if n in mapa_ocorrencias_fluxo]
        if not numeros_validos:
            if await _escape_semantico_ou_none(
                texto, "publico", etapa, conversa_id, phone, instance_name, token, lead_id, unidade_cuca,
            ):
                return
            if await _registrar_falha_e_oferecer_atendente(
                fluxo=fluxo, etapa=etapa, conversa_id=conversa_id,
                instance_name=instance_name, token=token, phone=phone, lead_id=lead_id,
            ):
                return
            await e(
                "Não entendi. Digite o *número* da vaga de interesse. Ex: *1* ou *1,3*\n\n"
                "Digite *voltar* para ver outras opções."
            )
            return

        # Seção 5, regra 5 — PARCIAL nesta etapa (passo 2/5 da story): a rota
        # completa por tipo é processada 1 ocorrência de cada vez. A fila que
        # encadeia automaticamente as demais escolhas após concluir a 1ª
        # (mecanismo novo, maior risco da story) é escopo do passo 3, ainda
        # não implementado — aqui só a 1ª escolha é roteada; se o lead marcou
        # mais de uma, ele é avisado e escolhe a próxima depois de terminar.
        ocorrencia_escolhida = mapa_ocorrencias_fluxo[numeros_validos[0]]
        if len(numeros_validos) > 1:
            await e(
                f"Vou te ajudar primeiro com *{ocorrencia_escolhida['cargo_exibicao']}* "
                f"({ocorrencia_escolhida['empresa_nome']}). Ao concluir essa candidatura, "
                "é só escolher a próxima vaga que você marcou."
            )

        vaga_id_escolhida = ocorrencia_escolhida["vaga_id"]
        cargo_escolhido = ocorrencia_escolhida["cargo_titulo_original"]

        if ocorrencia_escolhida["tipo"] == "selecao_evento":
            def _buscar_coleta_curriculo():
                res = supabase.table("vagas").select("coleta_curriculo").eq(
                    "id", vaga_id_escolhida
                ).maybe_single().execute()
                return (res.data or {}).get("coleta_curriculo", True)

            coleta_curriculo_v = await _supabase_to_thread(_buscar_coleta_curriculo)
            await _confirmar_cargos_selecao_evento(
                fluxo=fluxo,
                vaga_id_ref=vaga_id_escolhida,
                cargos_escolhidos=[cargo_escolhido],
                coleta_curriculo=coleta_curriculo_v,
                conversa_id=conversa_id,
                instance_name=instance_name, token=token, phone=phone, lead_id=lead_id,
            )
            return

        # vaga_normal — mesma rota de sempre (SQS-41 Ação 2.3: pergunta
        # unidade quando a vaga é global; senão coleta nome direto).
        def _buscar_unidade_destino_e_unidades():
            v_res = supabase.table("vagas").select("id, unidade_destino").eq(
                "id", vaga_id_escolhida
            ).maybe_single().execute()
            unidade_destino_v = (v_res.data or {}).get("unidade_destino", "")
            unidades_disp = []
            if unidade_destino_v == "global":
                u_res = supabase.table("unidades_cuca").select("id, nome").eq(
                    "ativo", True
                ).order("nome").execute()
                unidades_disp = u_res.data or []
            return unidade_destino_v, unidades_disp

        unidade_destino_v, unidades_disponiveis = await _supabase_to_thread(
            _buscar_unidade_destino_e_unidades
        )

        if unidade_destino_v == "global":
            linhas_unid = [
                "🌐 *Esta vaga é para toda a Rede CUCA!*\n\n"
                "Qual unidade fica mais próxima da sua residência?\n"
            ]
            for idx_u, u in enumerate(unidades_disponiveis, start=1):
                linhas_unid.append(f"*{idx_u}.* {u['nome']}")
            linhas_unid.append("\nDigite *voltar* para ver outras opções.")
            if await e("\n".join(linhas_unid)):
                await _set_fluxo_async(conversa_id, {
                    **_fluxo_sem_falhas_atendente(fluxo),
                    "etapa": "aguardando_escolha_unidade",
                    "vaga_id_selecionada": vaga_id_escolhida,
                    "banco_talentos": False,
                    "historico_vagas_aplicadas": fluxo.get("historico_vagas_aplicadas") or [],
                    "unidades_opcoes": unidades_disponiveis,
                })
            return

        nome_prefill = fluxo.get("nome_candidato_prefill", "")
        if nome_prefill:
            await _enviar_link_candidatura(
                instance_name, token, phone, conversa_id, fluxo,
                nome_prefill, phone, vaga_id_escolhida, False, lead_id=lead_id
            )
        else:
            if await e("Para finalizar sua candidatura, preciso do seu *nome completo*:"):
                await _set_fluxo_async(conversa_id, {
                    "perfil": "publico",
                    "etapa": "coletando_nome_candidato",
                    "vaga_id_selecionada": vaga_id_escolhida,
                    "banco_talentos": False,
                    "historico_vagas_aplicadas": fluxo.get("historico_vagas_aplicadas") or [],
                })
        return

    # Candidatos veem TODAS as vagas abertas de qualquer unidade.
    # unidade_destino controla apenas qual equipe CUCA gerencia a candidatura — não a visibilidade pública.
    def _buscar_vagas_abertas_e_candidaturas():
        # Ordem dos campos deliberada: "cargos_lista" antes de "tipo" evita
        # colisão de substring com a query de metadado avulso mais abaixo
        # (`"tipo, cargos_lista, coleta_curriculo"`) nos testes/mocks que
        # roteiam por conteúdo de `select_cols`.
        vagas_res = supabase.table("vagas").select(
            "id, titulo, tipo_contrato, salario, escolaridade_minima, total_vagas, faixa_etaria, setor, "
            "unidade_destino, cargos_lista, tipo, empresa_id, unidade_cuca"
        ).eq("status", "aberta").order("created_at", desc=True).limit(50).execute()
        vagas_db = vagas_res.data or []

        # HF37-06: Sincronizar com o banco — buscar vagas já candidatadas por este telefone
        # (captura candidaturas de sessões anteriores que não estão na memória da sessão atual)
        # Filtro de status feito em Python puro para evitar incompatibilidade com postgrest-py
        STATUS_INATIVOS = {"rejeitado", "cancelado", "excluido", "inativo"}
        # Remove todos os não-dígitos e normaliza: candidaturas são salvas sem o "55" do Brasil
        telefone_limpo = re.sub(r"\D", "", phone)
        if telefone_limpo.startswith("55") and len(telefone_limpo) > 11:
            telefone_limpo = telefone_limpo[2:]
        db_cands_res = supabase.table("candidaturas").select("vaga_id, status, cargo_escolhido").eq(
            "telefone", telefone_limpo
        ).execute()
        vagas_ids = set()
        # SQS-49: selecao_evento — rastrear cargos já inscritos por vaga (não ocultar a vaga inteira)
        cargos_por_vaga: dict[str, set] = {}
        for c in (db_cands_res.data or []):
            if not c.get("vaga_id") or c.get("status") in STATUS_INATIVOS:
                continue
            cargo = c.get("cargo_escolhido")
            if cargo:
                # candidatura com cargo: registra o cargo, não bloqueia a vaga inteira
                cargos_por_vaga.setdefault(c["vaga_id"], set()).add(cargo)
            else:
                # candidatura sem cargo (vaga_normal): bloqueia a vaga normalmente
                vagas_ids.add(c["vaga_id"])

        # S-EMP-AUD-023 passo 2: nome de empresa/unidade em lote, pro rótulo
        # do Nível 2 (seção 3) e resolução de unidade_cuca (seção 2.4). Nomes
        # de unidade são resolvidos SEM filtro de "ativo" — aqui é resolução
        # de rótulo, não oferta de escolha pro candidato (diferente da busca
        # em aguardando_escolha_unidade, que só oferece unidade ativa).
        empresa_ids = {v["empresa_id"] for v in vagas_db if v.get("empresa_id")}
        unidade_ids = set()
        for v in vagas_db:
            for campo in ("unidade_cuca", "unidade_destino"):
                valor = v.get(campo)
                if valor and _REGEX_UUID.match(valor):
                    unidade_ids.add(valor)

        empresas_por_id: dict[str, str] = {}
        if empresa_ids:
            emp_res = supabase.table("empresas").select("id, nome, nome_fantasia").in_(
                "id", list(empresa_ids)
            ).execute()
            for row in (emp_res.data or []):
                empresas_por_id[row["id"]] = row.get("nome_fantasia") or row.get("nome") or ""

        unidades_por_id: dict[str, str] = {}
        if unidade_ids:
            unid_res = supabase.table("unidades_cuca").select("id, nome").in_(
                "id", list(unidade_ids)
            ).execute()
            for row in (unid_res.data or []):
                unidades_por_id[row["id"]] = row.get("nome") or ""

        return vagas_db, vagas_ids, cargos_por_vaga, empresas_por_id, unidades_por_id

    (
        vagas, db_vagas_ids, db_cargos_por_vaga, empresas_por_id, unidades_por_id,
    ) = await _supabase_to_thread(_buscar_vagas_abertas_e_candidaturas)
    # Referência ao resultado NÃO filtrado — o motor de cargo consolidado faz
    # sua própria exclusão por ocorrência (pergunta 5 da story); o filtro
    # abaixo (`ids_excluir`, por vaga inteira) só serve à listagem antiga
    # (categoria/setor), mantida viva só pra conversas legadas em andamento.
    vagas_raw = vagas

    # S37C-04: Combinar histórico da sessão com IDs do banco e filtrar vagas
    historico_aplicadas = list(fluxo.get("historico_vagas_aplicadas") or [])
    ids_excluir = db_vagas_ids | set(historico_aplicadas)
    if ids_excluir:
        vagas = [v for v in vagas if v["id"] not in ids_excluir]

    # Intenção de banco de talentos
    if _quer_banco_talentos(texto, etapa, fluxo):
        await iniciar_banco_talentos()
        return

    # Verificar se quer se candidatar a vaga específica (por número sequencial, título ou "quero essa")
    vaga_id_ref = None
    match_num_seq = re.search(r"\b(\d{1,2})\b", texto)

    if etapa == "listou_vagas":
        mapa_vagas = fluxo.get("mapa_vagas", {})  # {"1": vaga_id, "2": vaga_id, ...}

        # Candidatura por número da lista (ex: "1", "2", "quero a 1")
        if match_num_seq:
            num_digitado = match_num_seq.group(1)
            if num_digitado in mapa_vagas:
                vaga_id_ref = mapa_vagas[num_digitado]

        # Candidatura por nome parcial da vaga
        if not vaga_id_ref:
            for v in vagas:
                titulo_lower = v["titulo"].lower()
                palavras = [p for p in titulo_lower.split() if len(p) > 3]
                if any(p in t_lower for p in palavras):
                    vaga_id_ref = v["id"]
                    break

        # "quero essa" → última vaga listada
        if not vaga_id_ref and ("quero essa" in t_lower or "candidatar" in t_lower or "quero" in t_lower):
            vaga_id_ref = fluxo.get("ultima_vaga_id")

    if vaga_id_ref:
        # SQS-49: verificar se vaga é selecao_evento antes de qualquer outra coisa
        def _buscar_meta_vaga_e_unidades():
            vaga_tipo_res = supabase.table("vagas").select(
                "tipo, cargos_lista, coleta_curriculo"
            ).eq("id", vaga_id_ref).maybe_single().execute()
            vaga_tipo = vaga_tipo_res.data or {}
            vaga_meta_db = next((v for v in vagas if v["id"] == vaga_id_ref), None)
            if not vaga_meta_db:
                _vr = supabase.table("vagas").select("id, unidade_destino").eq("id", vaga_id_ref).maybe_single().execute()
                vaga_meta_db = _vr.data or {}
            unidades = []
            if (vaga_meta_db or {}).get("unidade_destino", "") == "global":
                _unid_res = supabase.table("unidades_cuca").select("id, nome").eq("ativo", True).order("nome").execute()
                unidades = _unid_res.data or []
            return vaga_tipo, vaga_meta_db, unidades

        vaga_tipo, vaga_meta, unidades_disponiveis = await _supabase_to_thread(_buscar_meta_vaga_e_unidades)
        if vaga_tipo and vaga_tipo.get("tipo") == "selecao_evento":
            cargos = vaga_tipo.get("cargos_lista") or []
            # SQS-49: excluir cargos que o candidato já se inscreveu
            cargos_ja_inscritos = db_cargos_por_vaga.get(vaga_id_ref, set())
            cargos_disponiveis = [c for c in cargos if c.get("titulo") not in cargos_ja_inscritos]
            if cargos_disponiveis:
                linhas_cargos = [
                    "🎯 *Escolha o cargo para o qual deseja se candidatar:*\n",
                ]
                if cargos_ja_inscritos:
                    inscritos_txt = ", ".join(cargos_ja_inscritos)
                    linhas_cargos.append(f"_(Já inscrito: {inscritos_txt})_\n")
                for idx_c, cargo in enumerate(cargos_disponiveis, start=1):
                    qtd = cargo.get("quantidade", "")
                    faixa = cargo.get("faixa_etaria", "")
                    qtd_txt = f" · {qtd} vagas" if qtd else ""
                    faixa_txt = f" · {faixa}" if faixa else ""
                    linhas_cargos.append(f"*{idx_c}.* {cargo.get('titulo', '')}{qtd_txt}{faixa_txt}")
                linhas_cargos.append(
                    "\nDigite o *número* do cargo. Para mais de um, separe por vírgula (ex: *1,3*).\n"
                    "Digite *voltar* para ver outras opções."
                )
                await _set_fluxo_async(conversa_id, {
                    **fluxo,
                    "etapa": "listando_cargos_selecao",
                    "vaga_id_selecionada": vaga_id_ref,
                    "cargos_disponiveis": cargos_disponiveis,
                    "historico_vagas_aplicadas": historico_aplicadas,
                    # SQS-56: guardado aqui (não recalculado depois) para a
                    # ramificação em listando_cargos_selecao. Checagem sempre
                    # "is False" — coluna é NOT NULL DEFAULT true, mas o `is`
                    # explícito garante que nunca vira o ramo novo por engano
                    # (fail-safe: qualquer coisa que não seja False literal
                    # mantém o comportamento atual, AC3/AC17).
                    "coleta_curriculo": vaga_tipo.get("coleta_curriculo", True),
                })
                await e("\n".join(linhas_cargos))
                return
            # Se não tiver cargos estruturados, cai no fluxo normal de candidatura

        # SQS-41 Ação 2.3: verificar se vaga é global antes de coletar nome/enviar link
        unidade_destino_vaga = (vaga_meta or {}).get("unidade_destino", "")

        if unidade_destino_vaga == "global":
            # Perguntar ao candidato qual unidade fica mais próxima
            linhas_unid = [
                "🌐 *Esta vaga é para toda a Rede CUCA!*\n\n"
                "Qual unidade fica mais próxima da sua residência?\n"
            ]
            for idx_u, u in enumerate(unidades_disponiveis, start=1):
                linhas_unid.append(f"*{idx_u}.* {u['nome']}")
            linhas_unid.append("\nDigite *voltar* para ver outras opções.")
            if await e("\n".join(linhas_unid)):
                await _set_fluxo_async(conversa_id, {
                    **fluxo,
                    "etapa": "aguardando_escolha_unidade",
                    "vaga_id_selecionada": vaga_id_ref,
                    "banco_talentos": False,
                    "historico_vagas_aplicadas": historico_aplicadas,
                    "unidades_opcoes": unidades_disponiveis,
                })
            return

        # S37C-05: vaga com unidade definida — fluxo normal
        nome_prefill = fluxo.get("nome_candidato_prefill", "")
        if nome_prefill:
            await _enviar_link_candidatura(
                instance_name, token, phone, conversa_id, fluxo,
                nome_prefill, phone, vaga_id_ref, False, lead_id=lead_id
            )
        else:
            if await e("Para finalizar sua candidatura, preciso do seu *nome completo*:"):
                await _set_fluxo_async(conversa_id, {
                    "perfil": "publico",
                    "etapa": "coletando_nome_candidato",
                    "vaga_id_selecionada": vaga_id_ref,
                    "banco_talentos": False,
                    "historico_vagas_aplicadas": historico_aplicadas,
                })
        return

    # S-EMP-AUD-023 passo 2: ponto de entrada novo (Nível 1, cargo
    # consolidado) substitui o menu por categoria/setor (SQS-41 Ação 2.1).
    # Usa `vagas_raw` (NÃO o `vagas` filtrado por vaga inteira acima) — o
    # motor de agrupamento já faz exclusão por ocorrência (pergunta 5 da
    # story), que é mais correta: o filtro por vaga inteira escondia TODOS os
    # cargos de uma seleção quando só 1 cargo dela já tinha sido aplicado.
    tipos_por_vaga_id = {v["id"]: v.get("tipo") for v in vagas_raw}
    historico_vaga_normal = {
        vid for vid in historico_aplicadas if tipos_por_vaga_id.get(vid) != "selecao_evento"
    }
    vagas_ja_candidatadas_sem_cargo = db_vagas_ids | historico_vaga_normal

    mapa_cargos = _construir_cargos_consolidados(
        vagas_raw, db_cargos_por_vaga, vagas_ja_candidatadas_sem_cargo,
        empresas_por_id, unidades_por_id,
    )

    if not mapa_cargos:
        # HF37-06: distingue "sem vagas no sistema" de "candidato já aplicou a todas"
        if vagas_ja_candidatadas_sem_cargo or db_cargos_por_vaga:
            await e(
                "Você já se candidatou a todas as nossas vagas abertas no momento! 🎉\n\n"
                "Assim que novas oportunidades surgirem, entraremos em contato pelo WhatsApp.\n\n"
                "Deseja deixar seu currículo no banco de talentos para futuras vagas?\n"
                "Responda *sim* ou *não*."
            )
        else:
            await e(
                "No momento não há vagas abertas nesta unidade.\n"
                "Posso cadastrar seu currículo no banco de talentos para oportunidades futuras.\n\n"
                "Deseja? Responda *sim* ou *não*."
            )
        await _set_fluxo_async(conversa_id, {
            "perfil": "publico",
            "etapa": "oferta_banco_talentos",
            "historico_vagas_aplicadas": historico_aplicadas,
            "nome_candidato_prefill": fluxo.get("nome_candidato_prefill", ""),
        })
        return

    await _mostrar_cargos_consolidados(instance_name, token, phone, conversa_id, lead_id, mapa_cargos)
    await _set_fluxo_async(conversa_id, {
        "perfil": "publico",
        "etapa": "listou_cargos_consolidados",
        "mapa_cargos_consolidados": mapa_cargos,
        # HF37-02: propaga histórico para que ciclos seguintes não reofereçam vagas já aplicadas
        "historico_vagas_aplicadas": historico_aplicadas,
        "nome_candidato_prefill": fluxo.get("nome_candidato_prefill", ""),
    })


async def _enviar_link_candidatura(
    instance_name: str,
    token: str,
    phone: str,
    conversa_id: str,
    fluxo: dict,
    nome_candidato: str,
    telefone_origem: str,
    vaga_id: str | None,
    banco_talentos: bool,
    lead_id: str = "",
):
    """Monta e envia o link de candidatura com nome e telefone pré-preenchidos."""
    params = {
        "nome": nome_candidato,
        "origem_tel": re.sub(r"\D", "", telefone_origem),
        "conversa_id": conversa_id,
    }
    if vaga_id:
        params["vaga_id"] = vaga_id
    if banco_talentos:
        params["banco_talentos"] = "1"
    # SQS-41 Ação 2.3: unidade escolhida pelo candidato em vagas globais
    unidade_id_link = fluxo.get("unidade_id_escolhida", "")
    if unidade_id_link:
        params["unidade_id"] = unidade_id_link
    # SQS-49 AC10: lista de cargos escolhidos em selecao_evento
    cargos_escolhidos_link = fluxo.get("cargos_escolhidos") or []
    if cargos_escolhidos_link:
        params["cargos_escolhidos"] = ",".join(cargos_escolhidos_link)

    link = _assinar_link_portal("/empregabilidade/candidatura", params)

    if banco_talentos:
        mensagem_link = (
            f"Ótimo! 📁 Acesse o link abaixo para enviar o currículo de *{nome_candidato}*:\n\n"
            f"🔗 {link}\n\n"
            "Após o envio, seu currículo será salvo no banco de talentos da rede CUCA. ✅"
        )
    else:
        mensagem_link = (
            f"Ótimo! 🎯 Acesse o link abaixo para enviar o currículo de *{nome_candidato}*:\n\n"
            f"🔗 {link}\n\n"
            "Após o envio, você receberá aqui o *número de acompanhamento* da candidatura. ✅"
        )
    await _enviar(instance_name, token, phone, mensagem_link, conversa_id=conversa_id, lead_id=lead_id)
    await _set_fluxo_async(conversa_id, {
        "perfil": "publico",
        "etapa": "aguardando_confirmacao_candidatura",
        "nome_candidato": nome_candidato,
        "link_candidatura": link,
        "vaga_id_selecionada": vaga_id,
        "banco_talentos": banco_talentos,
        # S37C-04/05: preserva histórico e atualiza prefill para o próximo ciclo
        "historico_vagas_aplicadas": fluxo.get("historico_vagas_aplicadas") or [],
        "nome_candidato_prefill": nome_candidato,
    })


# ---------------------------------------------------------------------------
# Ponto de entrada principal
# ---------------------------------------------------------------------------

_ETAPAS_EMPRESA = {
    "solicitar_cnpj", "aguardando_cnpj", "confirmando_cadastro",
    "confirmando_cadastro_com_correcao", "aguardando_criar_vaga",
    "aguardando_retorno_vaga", "consulta_empresa", "empresa_ativa",
    "menu_empresa_retomada", "menu_pos_vaga", "menu_empresa_acoes", "perguntando_unidade_vaga",
    "selecionando_vaga_edicao", "aguardando_retorno_edicao",
    "selecionando_vaga_cancelamento", "confirmando_cancelamento",
    # SQS-49: novos estados de seleção por evento
    "escolhendo_tipo_vaga", "aguardando_retorno_selecao",
}
_ETAPAS_CANDIDATO = {
    "solicitar_identificacao", "aguardando_id_candidato", "candidato_consultado",
}
_ETAPAS_PUBLICO = {
    "inicio", "listou_vagas", "candidatura_enviada",
    "coletando_nome_candidato", "confirmando_terceiro", "coletando_nome_terceiro",
    "aguardando_confirmacao_candidatura", "candidatura_confirmada",
    "pos_candidatura",            # S37C-01: novo estado para fluxo cíclico
    "oferta_banco_talentos",
    "listou_categorias",          # SQS-41: menu dinâmico por categoria
    "aguardando_escolha_unidade", # SQS-41: roteamento de vaga global
    "listando_cargos_selecao",    # SQS-49: escolha de cargo dentro de selecao_evento
    "confirmando_presenca_nome",     # SQS-56: seleção sem coleta de currículo
    "confirmando_presenca_telefone", # SQS-56: seleção sem coleta de currículo
    "coletando_nome_curriculo_publico", # SQS-58: opção 5, montar currículo pelo celular
    "listou_cargos_consolidados", # S-EMP-AUD-023 passo 2: Nível 1, cargo consolidado
    "listou_ocorrencias_cargo",   # S-EMP-AUD-023 passo 2: Nível 2, ocorrências do(s) cargo(s) escolhido(s)
}


async def processar_mensagem_empregabilidade(
    texto: str,
    phone: str,
    instance_name: str,
    token: str,
    lead_id: str,
    conversa_id: str,
    unidade_cuca: str,
    push_name: str = "Cidadão",
    midia_tipo: str = "",
):
    async with _fluxo_lock_context(conversa_id):
        return await _processar_mensagem_empregabilidade_locked(
            texto,
            phone,
            instance_name,
            token,
            lead_id,
            conversa_id,
            unidade_cuca,
            push_name,
            midia_tipo,
        )


async def _processar_mensagem_empregabilidade_locked(
    texto: str,
    phone: str,
    instance_name: str,
    token: str,
    lead_id: str,
    conversa_id: str,
    unidade_cuca: str,
    push_name: str = "Cidadão",
    midia_tipo: str = "",
):
    """
    Entry point chamado pelo main.py quando agente_tipo = 'Empregabilidade'.
    Identifica o perfil e roteia para o fluxo correto.
    """
    fluxo = await _get_fluxo_async(conversa_id)
    perfil_atual = fluxo.get("perfil")
    etapa_atual = fluxo.get("etapa", "")

    # SQS-40 Task 3.3: Handover por Dúvida
    from datetime import datetime, timezone
    def _buscar_metadata_conversa():
        return supabase.table("conversas").select("metadata").eq("id", conversa_id).single().execute()

    cm_res = await _supabase_to_thread(_buscar_metadata_conversa)
    cm_meta = (cm_res.data or {}).get("metadata") or {}
    
    if cm_meta.get("ultima_intencao") == "duvida":
        cm_meta["ultima_intencao"] = None
        logger.info(f"[SQS-40] Disparando transbordo por dúvida — lead {phone[:6]}****")
        await _acionar_transbordo_empregabilidade(
            conversa_id=conversa_id,
            unidade_cuca=unidade_cuca,
            instance_name=instance_name,
            token=token,
            phone=phone,
            lead_id=lead_id,
            motivo="duvida",
            mensagem_sucesso="Sua solicitação foi registrada. Em breve você será atendido por nossa equipe.",
            metadata_update=cm_meta,
        )
        return

    # Detecção por expressão natural: usuário pede explicitamente atendimento humano
    _texto_lower = texto.strip().lower()
    _CONTAINS_HANDOVER = {
        "falar com humano", "falar com um humano", "atendente humano", "falar com atendente",
        "falar com o atendente", "falar com um atendente", "falar com a atendente",
        "quero atendente", "quero humano", "humano por favor", "pessoa real",
        "quero falar com atendente", "quero falar com o atendente",
        "preciso de atendente", "chamar atendente", "atendente por favor",
        "falar com pessoa", "atendimento humano", "preciso de ajuda humana",
        "falar com alguem", "falar com alguém", "falar com um alguem", "falar com um alguém",
        "quero falar com alguem", "quero falar com alguém", "quero falar com um humano",
        "me passa para humano", "me passa para atendente", "falar com uma pessoa",
        "quero atendimento", "preciso de atendimento", "falar com suporte",
    }
    if any(kw in _texto_lower for kw in _CONTAINS_HANDOVER):
        logger.info(f"[HANDOVER-KW] Transbordo por palavra-chave — lead {phone[:6]}****")
        await _acionar_transbordo_empregabilidade(
            conversa_id=conversa_id,
            unidade_cuca=unidade_cuca,
            instance_name=instance_name,
            token=token,
            phone=phone,
            lead_id=lead_id,
            motivo="palavra_chave",
            mensagem_sucesso="Sua solicitação foi registrada. Em breve você será atendido por nossa equipe.",
        )
        return

    # SQS-40 Task 3.4: Interceptar respostas ao convite de entrevista
    texto_norm = texto.strip()
    # candidaturas.telefone é salvo sem o código de país (55); phone do JID tem "55" prefixado
    phone_local = phone[2:] if phone.startswith("55") and len(phone) > 11 else phone
    def _buscar_convites_entrevista():
        return (
            supabase.table("candidaturas")
            .select("id, nome")
            .eq("telefone", phone_local)
            .eq("status", "convite_enviado")
            .execute().data or []
        )

    cands_convite = await _supabase_to_thread(_buscar_convites_entrevista)

    if cands_convite:
        cand = cands_convite[0]
        cand_id = cand["id"]
        cand_nome = cand.get("nome", "Candidato")

        if texto_norm in ("1", "1.", "sim", "sim!", "confirmar", "confirmado"):
            def _confirmar_entrevista():
                supabase.table("candidaturas").update({"status": "entrevista_confirmada"}).eq("id", cand_id).execute()

            await _supabase_to_thread(_confirmar_entrevista)
            await _set_fluxo_async(conversa_id, {"perfil": "encerrado"})
            await _enviar(
                instance_name, token, phone,
                f"✅ Recebemos sua confirmação, *{cand_nome}*! Sua presença na entrevista foi registrada com sucesso. "
                f"Boa sorte! Em caso de dúvidas, pode chamar aqui. 🍀",
                conversa_id=conversa_id, lead_id=lead_id
            )
            return
        elif texto_norm in ("2", "2.", "não", "nao", "não posso", "nao posso", "recusar"):
            def _recusar_entrevista():
                supabase.table("candidaturas").update({"status": "entrevista_recusada"}).eq("id", cand_id).execute()

            await _supabase_to_thread(_recusar_entrevista)
            await _set_fluxo_async(conversa_id, {"perfil": "encerrado"})
            await _enviar(
                instance_name, token, phone,
                f"Entendido, *{cand_nome}*. Recebemos sua resposta e registramos que você não poderá comparecer desta vez. "
                f"Continue acompanhando novas oportunidades pelo CUCA! 💙",
                conversa_id=conversa_id, lead_id=lead_id
            )
            return
        elif texto_norm in ("3", "3.", "dúvida", "duvida", "?"):
            # Marcar dúvida e deixar o fluxo normal de transbordo tratar
            def _marcar_duvida_convite():
                cm_res2 = supabase.table("conversas").select("metadata").eq("id", conversa_id).single().execute()
                cm_meta2 = (cm_res2.data or {}).get("metadata") or {}
                cm_meta2["ultima_intencao"] = "duvida"
                supabase.table("conversas").update({"metadata": cm_meta2}).eq("id", conversa_id).execute()

            await _supabase_to_thread(_marcar_duvida_convite)
            # Reprocessar com a flag de dúvida agora setada (vai cair no bloco acima)
            await processar_mensagem_empregabilidade(
                texto, phone, instance_name, token, lead_id, conversa_id, unidade_cuca, push_name
            )
            return
        else:
            # Resposta não reconhecida — re-exibir opções
            await _enviar(
                instance_name, token, phone,
                f"Olá, *{cand_nome}*! 👋 Você possui um convite de entrevista pendente. Por favor, responda:\n\n"
                f"*1* - ✅ Confirmar presença\n"
                f"*2* - ❌ Não poderei comparecer\n"
                f"*3* - ❓ Tenho uma dúvida",
                conversa_id=conversa_id, lead_id=lead_id
            )
            return

    # S-WM-20 Task 5 (ajuste 3): resposta de confirmação de troca de rota
    # pendente (ver _perguntar_confirmacao_troca_rota). Checado antes do
    # roteamento por perfil/etapa porque essa etapa não pertence a nenhum
    # perfil — é um estado transitório entre fluxos.
    if etapa_atual == "confirmando_troca_rota":
        t_conf_rota = texto.strip().lower()
        sem_pendente = fluxo.get("_troca_rota_pendente") or {}
        unidade_pendente = fluxo.get("_troca_rota_unidade_cuca", "")
        if t_conf_rota in _AFIRMATIVO_ROTA:
            from intencao_detector import extrair_setor_da_mensagem  # noqa: PLC0415
            await _rotear_por_intencao(
                sem_pendente, texto, phone, instance_name, token, lead_id, conversa_id,
                unidade_pendente, extrair_setor_da_mensagem,
            )
            return
        # Não confirmou (ou resposta que não seja um "sim" claro) — não travar
        # aqui: volta pro menu geral em vez de insistir na mesma pergunta.
        await _mostrar_menu_opcoes(instance_name, token, phone, conversa_id, lead_id)
        await _set_fluxo_async(conversa_id, {})
        return

    # SQS-41 Ação 2.2: Bypass global — "menu" reabre o menu de 4 opções a
    # qualquer momento. S-WM-20 Task 5 (ajuste 2): antes pulava direto para a
    # listagem de vagas (`_processar_publico("vagas", ...)`), sem nunca
    # mostrar as 4 opções — conflitava com a expectativa de "menu" reabrir a
    # escolha entre as rotas.
    if texto.strip().lower() == "menu":
        await _mostrar_menu_opcoes(instance_name, token, phone, conversa_id, lead_id)
        await _set_fluxo_async(conversa_id, {"etapa": "menu_inicial"})
        return

    # Rotear pelo perfil salvo OU pela etapa (evita loop quando _set_fluxo não preservou perfil)
    if perfil_atual == "empresa" or etapa_atual in _ETAPAS_EMPRESA:
        await _processar_empresa(texto, phone, instance_name, token, lead_id, conversa_id, unidade_cuca)
        return
    if perfil_atual == "candidato" or etapa_atual in _ETAPAS_CANDIDATO:
        await _processar_candidato(texto, phone, instance_name, token, lead_id, conversa_id)
        return
    if perfil_atual == "publico" or etapa_atual in _ETAPAS_PUBLICO:
        await _processar_publico(texto, phone, instance_name, token, lead_id, conversa_id, unidade_cuca)
        return

    # Retomada de empresa sem etapa ativa mas com empresa_id salvo
    empresa_id_salvo = fluxo.get("empresa_id")
    if empresa_id_salvo:
        await _processar_empresa(texto, phone, instance_name, token, lead_id, conversa_id, unidade_cuca)
        return

    # Usuário respondeu ao menu inicial com número ou palavra-chave
    if etapa_atual == "menu_inicial":
        await _processar_menu_inicial(texto, phone, instance_name, token, lead_id, conversa_id, unidade_cuca)
        return

    # SQS-49: detectar resposta de confirmação de presença (SIM/NÃO) para selecao_evento
    # Só intercepta quando fluxo está vazio e resposta é exatamente SIM ou NÃO/NAO.
    # Risco de falso positivo é mínimo pois exige candidatura selecionada com cargo_escolhido.
    t_conf = texto.strip().lower()
    if not fluxo and t_conf in _RESPOSTAS_ENTREVISTA_BINARIA:
        tel_limpo = re.sub(r"\D", "", phone)
        if tel_limpo.startswith("55") and len(tel_limpo) > 11:
            tel_limpo = tel_limpo[2:]
        def _buscar_candidatura_evento():
            return supabase.table("candidaturas").select(
                "id, cargo_escolhido, confirmacao_presenca"
            ).eq("telefone", tel_limpo).eq("status", "selecionado").not_.is_(
                "cargo_escolhido", "null"
            ).is_("confirmacao_presenca", "null").order("updated_at", desc=True).limit(1).execute()

        cand_event = await _supabase_to_thread(_buscar_candidatura_evento)
        if cand_event.data:
            cand = cand_event.data[0]
            confirmacao = "confirmado" if t_conf in _CONFIRMA_ENTREVISTA else "recusado"
            def _atualizar_confirmacao_presenca():
                supabase.table("candidaturas").update({
                    "confirmacao_presenca": confirmacao
                }).eq("id", cand["id"]).execute()

            await _supabase_to_thread(_atualizar_confirmacao_presenca)
            cargo = cand.get("cargo_escolhido", "")
            if confirmacao == "confirmado":
                await _enviar(
                    instance_name, token, phone,
                    f"✅ *Presença confirmada!*\n\n"
                    f"Sua participação no processo seletivo{' para ' + cargo if cargo else ''} está registrada.\n\n"
                    "Fique atento ao dia e horário informados. Boa sorte! 💪\n\n"
                    "_Qualquer dúvida, entre em contato com a unidade CUCA._",
                    conversa_id=conversa_id, lead_id=lead_id
                )
            else:
                await _enviar(
                    instance_name, token, phone,
                    f"❌ *Ausência registrada.*\n\n"
                    "Tudo bem! Seu registro foi atualizado. Se mudar de ideia ou quiser ver outras oportunidades, é só nos chamar. 🤝",
                    conversa_id=conversa_id, lead_id=lead_id
                )
            logger.info(f"[SQS-49] Confirmação de presença '{confirmacao}' registrada para candidatura {cand['id']}")
            return

    # S-EMP-01-01 / S-WM-20 Task 3: Detector de intenção — primeira interação ou perfil indefinido
    from intencao_detector import avaliar_mensagem_contextual, extrair_nome_heuristico, extrair_setor_da_mensagem  # noqa: PLC0415
    def _buscar_lead_nome():
        return supabase.table("leads").select("nome").eq("id", lead_id).maybe_single().execute()

    lead_res = await _supabase_to_thread(_buscar_lead_nome)
    lead_nome = (lead_res.data or {}).get("nome") or extrair_nome_heuristico(texto)
    intencao_res = await avaliar_mensagem_contextual(
        texto, midia_tipo, perfil=None, etapa=None,
        ultima_msg_bot=await _ultima_mensagem_bot_async(conversa_id), lead_nome=lead_nome,
    )
    await _log_intencao_async(conversa_id, intencao_res["intencao"])
    await _rotear_por_intencao(
        intencao_res, texto, phone, instance_name, token, lead_id, conversa_id, unidade_cuca,
        extrair_setor_da_mensagem,
    )


# ---------------------------------------------------------------------------
# S-EMP-01-01 — Helpers de intenção
# ---------------------------------------------------------------------------

async def _processar_menu_inicial(
    texto: str,
    phone: str,
    instance_name: str,
    token: str,
    lead_id: str,
    conversa_id: str,
    unidade_cuca: str,
) -> None:
    """Dispatch da etapa `menu_inicial` (extraído de
    `processar_mensagem_empregabilidade` para ser testável isoladamente,
    mesmo padrão de `_processar_empresa`/`_processar_candidato`/
    `_processar_publico`). Dígito/palavra-chave exata primeiro (rápido, sem
    LLM); só na falha do parser chama o classificador semântico — S-WM-20
    Task 5 (ajuste 1): antes desse ajuste, qualquer frase que não batesse
    exatamente reexibia este mesmo menu para sempre (achado do Junior em
    staging: '3' também não escapava, porque o atalho de dígito em
    `avaliar_mensagem_contextual` só evita a chamada ao LLM, não interpreta o
    dígito — quem interpretava era só este dispatch)."""
    t = texto.strip().lower()
    if t in ("1", "empresa", "divulgar", "divulgar vaga", "quero divulgar",
             "marcar selecao", "marcar seleção", "selecao", "seleção"):
        await _set_fluxo_async(conversa_id, {"perfil": "empresa", "etapa": "solicitar_cnpj"})
        await _processar_empresa(texto, phone, instance_name, token, lead_id, conversa_id, unidade_cuca)
        return
    if t in ("2", "candidato", "candidatura", "minha candidatura", "acompanhar"):
        await _set_fluxo_async(conversa_id, {"perfil": "candidato", "etapa": "solicitar_identificacao"})
        await _processar_candidato(texto, phone, instance_name, token, lead_id, conversa_id)
        return
    if t in ("3", "vagas", "vaga", "ver vagas", "vagas abertas", "quero trabalhar", "emprego"):
        await _set_fluxo_async(conversa_id, {"perfil": "publico", "etapa": "inicio"})
        await _processar_publico(texto, phone, instance_name, token, lead_id, conversa_id, unidade_cuca)
        return
    if t in ("4", "enviar curriculo", "enviar currículo", "deixar curriculo", "deixar currículo",
             "sem vaga", "curriculo sem vaga", "currículo sem vaga", "banco", "cadastrar curriculo",
             "cadastrar currículo"):
        await _set_fluxo_async(conversa_id, {
            "perfil": "publico",
            "etapa": "coletando_nome_candidato",
            "banco_talentos": True,
        })
        await _enviar(
            instance_name, token, phone,
            "📁 *Enviar Currículo (sem vaga)*\n\n"
            "Vamos cadastrar seu currículo no banco de talentos da rede CUCA. "
            "Quando surgir uma oportunidade compatível com seu perfil, a equipe entrará em contato.\n\n"
            "Para começar, preciso do seu *nome completo*:",
            conversa_id=conversa_id, lead_id=lead_id,
        )
        return
    # SQS-58: opção 5 — candidato sem currículo pronto monta o próprio pelo
    # celular (link público, formulário estruturado, PDF automático). Rota
    # separada da opção 4 (upload de arquivo pronto + triagem da IA antes de
    # entrar no banco) — não reaproveita a mesma etapa/mensagem.
    if t in ("5", "criar meu curriculo agora", "criar meu currículo agora",
             "criar curriculo", "criar currículo", "criar curriculo agora",
             "criar currículo agora", "montar curriculo", "montar currículo",
             "não tenho curriculo", "nao tenho curriculo", "não tenho currículo",
             "nao tenho currículo"):
        await _set_fluxo_async(conversa_id, {
            "perfil": "publico",
            "etapa": "coletando_nome_curriculo_publico",
        })
        await _enviar(
            instance_name, token, phone,
            "📝 *Criar meu Currículo agora*\n\n"
            "Vamos montar seu currículo pelo celular: você preenche um formulário rápido, "
            "recebe o PDF pronto e ele já entra no banco de talentos da rede CUCA.\n\n"
            "Para começar, preciso do seu *nome completo*:",
            conversa_id=conversa_id, lead_id=lead_id,
        )
        return
    # S-WM-20 Task 5 (ajuste 1): nenhum dígito/palavra-chave exata bateu —
    # antes disso encerrava numa correspondência EXATA sem nunca chamar o
    # classificador. Parser falhou → tenta o classificador semântico antes de
    # repetir o erro, mesmo padrão híbrido usado no resto do arquivo.
    from intencao_detector import avaliar_mensagem_contextual, extrair_setor_da_mensagem  # noqa: PLC0415
    sem_menu = await avaliar_mensagem_contextual(
        texto, perfil=None, etapa="menu_inicial", ultima_msg_bot=await _ultima_mensagem_bot_async(conversa_id),
    )
    if sem_menu["quer_sair"]:
        await _encerrar_fluxo(conversa_id, instance_name, token, phone, "publico")
        return
    await _rotear_por_intencao(
        sem_menu, texto, phone, instance_name, token, lead_id, conversa_id, unidade_cuca,
        extrair_setor_da_mensagem,
    )


def _log_intencao(conversa_id: str, intencao: str) -> None:
    """Grava intencao_detectada em conversas.metadata para rastreabilidade (AC#7)."""
    try:
        res = supabase.table("conversas").select("metadata").eq("id", conversa_id).single().execute()
        metadata = (res.data or {}).get("metadata") or {}
        metadata["intencao_detectada"] = intencao
        supabase.table("conversas").update({"metadata": metadata}).eq("id", conversa_id).execute()
    except Exception as exc:
        logger.warning("[intencao] Falha ao gravar intencao_detectada: %s", exc)


_LOG_INTENCAO_SYNC = _log_intencao


async def _rotear_por_intencao(
    intencao_res: dict,
    texto: str,
    phone: str,
    instance_name: str,
    token: str,
    lead_id: str,
    conversa_id: str,
    unidade_cuca: str,
    extrair_setor_fn=None,
) -> None:
    """Roteia a primeira mensagem com base na intenção detectada (S-EMP-01-01)."""
    intencao = intencao_res.get("intencao", "ambiguo")
    nome = intencao_res.get("nome") or ""
    saudacao_nome = f" {nome}!" if nome else "!"

    async def e(msg: str) -> None:
        await _enviar(instance_name, token, phone, msg, conversa_id=conversa_id, lead_id=lead_id)

    logger.info("[intencao] %s → %s", phone[:6] + "****", intencao)

    if intencao == "empresa":
        # AC#5 — pede CNPJ diretamente, humanizado
        await e(f"Olá{saudacao_nome} Me passa o CNPJ da empresa (somente números) para verificar seu cadastro:")
        await _set_fluxo_async(conversa_id, {"perfil": "empresa", "etapa": "aguardando_cnpj"})

    elif intencao == "candidato_vaga":
        # AC#1 — lista até 5 vagas abertas (com filtro de setor quando mencionado)
        setor_kw, setor_canonical = extrair_setor_fn(texto) if extrair_setor_fn else (None, None)

        if setor_canonical:
            # busca mais vagas para filtrar por setor em Python (substring match)
            def _buscar_vagas_setor():
                return (
                    supabase.table("vagas").select("id, titulo, descricao, setor")
                    .eq("status", "aberta").order("created_at", desc=True).limit(50).execute().data or []
                )

            vagas_pool = await _supabase_to_thread(_buscar_vagas_setor)
            vagas = [
                v for v in vagas_pool
                if any(setor_canonical.lower() in (s or "").lower() for s in (v.get("setor") or []))
            ][:5]
        else:
            def _buscar_vagas_recentes():
                return (
                    supabase.table("vagas").select("id, titulo, descricao")
                    .eq("status", "aberta").order("created_at", desc=True).limit(5).execute().data or []
                )

            vagas = await _supabase_to_thread(_buscar_vagas_recentes)

        if not vagas:
            if setor_canonical:
                await e(
                    f"Não temos vagas de *{setor_kw}* no momento. 😕\n\n"
                    "Deseja ver outras vagas disponíveis?"
                )
                await _set_fluxo_async(conversa_id, {"perfil": "publico", "etapa": "inicio"})
            else:
                await e(
                    f"Olá{saudacao_nome} No momento não há vagas abertas. 😕\n\n"
                    "Posso cadastrar seu currículo no banco de talentos para quando surgir uma oportunidade.\n\n"
                    "Deseja? Responda *sim* ou *não*."
                )
                await _set_fluxo_async(conversa_id, {"perfil": "publico", "etapa": "oferta_banco_talentos"})
            return

        mapa_vagas: dict[str, str] = {}
        prefixo = f"de *{setor_kw}* " if setor_kw else ""
        linhas = [f"Olá{saudacao_nome} Segue as vagas {prefixo}abertas hoje — digite o número:\n"]
        for i, v in enumerate(vagas, start=1):
            descricao_curta = (v.get("descricao") or "")[:60].rstrip()
            sufixo = "..." if len(v.get("descricao") or "") > 60 else ""
            linhas.append(f"*{i}* - {v['titulo']}" + (f": {descricao_curta}{sufixo}" if descricao_curta else ""))
            mapa_vagas[str(i)] = v["id"]

        linhas.append("\nDigite o *número da vaga* para se candidatar.")
        await e("\n".join(linhas))
        await _set_fluxo_async(conversa_id, {
            "perfil": "publico",
            "etapa": "listou_vagas",
            "mapa_vagas": mapa_vagas,
            "ultima_vaga_id": vagas[-1]["id"] if vagas else None,
        })

    elif intencao == "banco_talentos":
        # Correção: perguntar contexto (vaga específica ou banco) antes de ir direto ao nome
        await e(
            f"Olá{saudacao_nome} Você quer se candidatar a uma *vaga específica* "
            "ou deixar seu currículo no *Banco de Talentos*?\n\n"
            "Responda *vaga* ou *banco de talentos*."
        )
        await _set_fluxo_async(conversa_id, {"perfil": "publico", "etapa": "inicio"})

    elif intencao == "upload":
        # AC#3 — pergunta contexto antes de processar o arquivo
        await e(
            f"Olá{saudacao_nome} antes de subir seu currículo: você quer se candidatar a uma "
            "*vaga específica* ou deixar no *Banco de Talentos*?\n\n"
            "Responda *vaga* ou *banco de talentos*."
        )
        await _set_fluxo_async(conversa_id, {"perfil": "publico", "etapa": "inicio", "arquivo_pendente": True})

    else:
        # AC#4 / bug 1 (S-WM-20 Task 3): ambíguo — menu determinístico em vez
        # de pergunta aberta. O LLM sem contexto (primeira mensagem) não é
        # confiável o bastante para decidir sozinho; o menu numérico dá uma
        # opção clara.
        #
        # S-WM-20 Task 5 (ajuste 1 e 4): a etapa "menu_inicial" agora tem
        # fallback com classificador semântico (não trava mais em texto livre
        # — ver processar_mensagem_empregabilidade), então voltou a ser seguro
        # setá-la aqui, restaurando o atalho de dígito puro (1-4) que ficou
        # órfão quando essa linha foi removida na correção da regressão
        # crítica. Também diferencia a 1ª interação real (nenhuma mensagem do
        # bot ainda existe nesta conversa) de uma ambiguidade repetida — "Não
        # entendi" não faz sentido quando é a primeira coisa que o lead
        # escreveu.
        eh_primeira_interacao = await _ultima_mensagem_bot_async(conversa_id) is None
        intro = (
            f"Olá{saudacao_nome} Para eu te ajudar melhor, escolha uma das opções:"
            if eh_primeira_interacao
            else f"Olá{saudacao_nome} Não entendi bem o que você precisa. Escolha uma das opções:"
        )
        await _mostrar_menu_opcoes(instance_name, token, phone, conversa_id, lead_id, intro)
        await _set_fluxo_async(conversa_id, {"etapa": "menu_inicial"})


# ---------------------------------------------------------------------------
# Loop proativo: detecta vagas criadas e notifica empresa via WhatsApp
# ---------------------------------------------------------------------------

async def _empregabilidade_notify_tick():
    """Executa uma iteração do loop proativo de empregabilidade."""
    def _buscar_conversas_pendentes():
        return supabase.table("conversas").select(
            "id, metadata, origem_id, lead_id"
        ).eq("agente_tipo", "Empregabilidade").in_("status", ["ativa", "aberta"]).limit(200).execute()

    res = await _supabase_to_thread(_buscar_conversas_pendentes)

    conversas_elegiveis = []
    lead_ids = []
    for c in res.data or []:
        metadata = c.get("metadata") or {}
        fluxo = metadata.get("empreg_fluxo") or {}
        etapa_c = fluxo.get("etapa", "")
        if etapa_c not in _ETAPAS_NOTIFY_PORTAL:
            continue
        conversa_id = c["id"]
        lead_id = c.get("lead_id", "")
        instance_name = c.get("origem_id", "")
        if not instance_name:
            logger.warning("[empreg-notify] origem_id ausente na conversa %s — skipping", conversa_id)
            continue
        conversas_elegiveis.append((c, fluxo, etapa_c))
        if lead_id:
            lead_ids.append(lead_id)

    telefone_por_lead = {}
    if lead_ids:
        def _buscar_telefones_leads():
            return supabase.table("leads").select("id, telefone").in_("id", list(dict.fromkeys(lead_ids))).execute()

        leads_res = await _supabase_to_thread(_buscar_telefones_leads)
        telefone_por_lead = {
            row["id"]: row.get("telefone", "")
            for row in (leads_res.data or [])
        }

    for c, fluxo, etapa_c in conversas_elegiveis:
        conversa_id = c["id"]
        lead_id = c.get("lead_id", "")
        instance_name = c.get("origem_id", "")
        token = ""
        unidade_cuca = ""
        phone = telefone_por_lead.get(lead_id, "")

        if not phone:
            logger.warning("[empreg-notify] telefone do lead ausente — conversa %s skipped", conversa_id)
            continue

        empresa_id = fluxo.get("empresa_id")
        empresa_nome = fluxo.get("empresa_nome_exibicao") or fluxo.get("empresa_nome", "")

        # --- Notificação de vaga criada ---
        if etapa_c == "aguardando_retorno_vaga":
            vaga_criada_id = fluxo.get("vaga_criada_id")
            if not vaga_criada_id:
                continue
            vaga_numero = fluxo.get("vaga_numero")
            vaga_titulo = fluxo.get("vaga_titulo", "")
            numero_ref = f"#{vaga_numero}" if vaga_numero else f"...{vaga_criada_id[-6:].upper()}"

            _ok = await _enviar(
                instance_name, token, phone,
                f"✅ *Vaga cadastrada com sucesso!*\n\n"
                f"📋 *Título:* {vaga_titulo}\n"
                f"🔢 *Número da vaga:* {numero_ref}\n\n"
                "Nossa equipe irá revisar e publicar a vaga em breve.\n\n"
                f"O que deseja fazer agora?\n{_MENU_ACOES_EMPRESA}",
                conversa_id=conversa_id, lead_id=lead_id,
            )
            if _ok:
                await _set_fluxo_async(conversa_id, {
                    "perfil": "empresa",
                    "etapa": "menu_empresa_acoes",
                    "empresa_id": empresa_id,
                    "empresa_nome": fluxo.get("empresa_nome", ""),
                    "empresa_nome_exibicao": empresa_nome,
                    "cnpj": fluxo.get("cnpj"),
                    "ultima_vaga_id": vaga_criada_id,
                }, etapa_esperada=etapa_c)
                logger.info(f"[empreg-notify] Notificação de criação enviada para conversa {conversa_id} — vaga {numero_ref}")

        # --- SQS-49: Notificação de seleção por evento criada ---
        elif etapa_c == "aguardando_retorno_selecao":
            selecao_criada_id = fluxo.get("vaga_criada_id")
            if not selecao_criada_id:
                continue
            selecao_titulo = fluxo.get("vaga_titulo", "Processo Seletivo")
            selecao_numero = fluxo.get("vaga_numero")
            numero_ref = f"#{selecao_numero}" if selecao_numero else f"...{selecao_criada_id[-6:].upper()}"
            _ok = await _enviar(
                instance_name, token, phone,
                f"✅ *Processo seletivo cadastrado com sucesso!*\n\n"
                f"📋 *Título:* {selecao_titulo}\n"
                f"🔢 *Número de referência:* {numero_ref}\n\n"
                "A seleção já está visível para todas as unidades da rede CUCA. "
                "Os candidatos poderão se inscrever e a equipe irá gerenciar as candidaturas pelo portal.\n\n"
                f"O que deseja fazer agora?\n{_MENU_ACOES_EMPRESA}",
                conversa_id=conversa_id, lead_id=lead_id,
            )
            if _ok:
                await _set_fluxo_async(conversa_id, {
                    "perfil": "empresa",
                    "etapa": "menu_empresa_acoes",
                    "empresa_id": empresa_id,
                    "empresa_nome": fluxo.get("empresa_nome", ""),
                    "empresa_nome_exibicao": empresa_nome,
                    "cnpj": fluxo.get("cnpj"),
                    "ultima_vaga_id": selecao_criada_id,
                }, etapa_esperada=etapa_c)
                logger.info(f"[empreg-notify] Seleção por evento confirmada para conversa {conversa_id} — ref {numero_ref}")

        # --- Notificação de edição confirmada ---
        elif etapa_c == "aguardando_retorno_edicao":
            vaga_editada_id = fluxo.get("vaga_editada_id")
            if not vaga_editada_id:
                continue
            vaga_titulo = fluxo.get("vaga_editada_titulo", "")
            vaga_unidade = fluxo.get("vaga_editada_unidade", "")

            _ok = await _enviar(
                instance_name, token, phone,
                f"✅ *Alterações recebidas com sucesso!*\n\n"
                f"📋 *Vaga:* {vaga_titulo}\n\n"
                f"A equipe CUCA {vaga_unidade or unidade_cuca} irá revisar as alterações antes de a vaga voltar a aceitar candidaturas.\n\n"
                f"O que deseja fazer agora?\n{_MENU_ACOES_EMPRESA}",
                conversa_id=conversa_id, lead_id=lead_id,
            )
            if _ok:
                await _set_fluxo_async(conversa_id, {
                    "perfil": "empresa",
                    "etapa": "menu_empresa_acoes",
                    "empresa_id": empresa_id,
                    "empresa_nome": fluxo.get("empresa_nome", ""),
                    "empresa_nome_exibicao": empresa_nome,
                    "cnpj": fluxo.get("cnpj"),
                }, etapa_esperada=etapa_c)
                logger.info(f"[empreg-notify] Confirmação de edição enviada para conversa {conversa_id} — vaga {vaga_editada_id}")

        # --- Notificação de candidatura confirmada (candidato) ---
        elif etapa_c == "aguardando_confirmacao_candidatura":
            candidatura_id = fluxo.get("candidatura_criada_id")
            # SQS-58 (achado do Junior 2026-08-13): o currículo público não
            # preenche candidatura_criada_id — preenche curriculo_publico_salvo
            # (gravado pela rota /api/empregabilidade/curriculo/publico). Sem
            # isso, o loop proativo nunca disparava pra esse fluxo: o
            # candidato só recebia a confirmação se mandasse outra mensagem
            # (fallback reativo em _processar_publico), nunca sozinho ao
            # voltar pro WhatsApp — o "não volta" reportado.
            curriculo_publico_salvo = fluxo.get("curriculo_publico_salvo")
            if not candidatura_id and not curriculo_publico_salvo:
                continue
            eh_banco_talentos = fluxo.get("banco_talentos", False)
            if eh_banco_talentos:
                _ok = await _enviar(
                    instance_name, token, phone,
                    "✅ *Currículo salvo com sucesso!*\n\n"
                    "Seu currículo foi cadastrado no banco de talentos da rede CUCA. "
                    "Assim que surgir uma oportunidade compatível com seu perfil e área de interesse, "
                    "nossa equipe entrará em contato diretamente por aqui. 🎯\n\n"
                    "Obrigado por confiar na CUCA!\n\n"
                    "Deseja ver as *vagas abertas* ou encerrar por aqui?\n"
                    "Responda *vagas* para ver oportunidades ou *encerrar*.",
                    conversa_id=conversa_id, lead_id=lead_id,
                )
                if _ok:
                    await _set_fluxo_async(conversa_id, {
                        "etapa": "candidatura_confirmada",
                        "perfil": "publico",
                    }, etapa_esperada=etapa_c)
                    logger.info(f"[empreg-notify] Banco de talentos confirmado para conversa {conversa_id}")
            else:
                candidatura_codigo = fluxo.get("candidatura_codigo")
                codigo = candidatura_codigo or candidatura_id.replace("-", "")[-6:].upper()
                # S37C-02: Mensagem 1 — confirmação com o código
                _ok = await _enviar(
                    instance_name, token, phone,
                    f"🎉 *Candidatura recebida com sucesso!*\n\n"
                    f"🔢 *Número de acompanhamento:* *{codigo}*\n\n"
                    "Guarde esse número! Com ele você pode verificar o status da sua candidatura a qualquer momento. ✅",
                    conversa_id=conversa_id, lead_id=lead_id,
                )
                # S37C-02: Mensagem 2 — oferta de nova candidatura (best-effort)
                await _enviar(
                    instance_name, token, phone,
                    "Deseja se candidatar a outra vaga da CUCA? 👀\n\n"
                    "Responda *outra* para ver mais vagas ou *encerrar* para finalizar.",
                    conversa_id=conversa_id, lead_id=lead_id,
                )
                # S37C-04/05: salva histórico e prefill somente após envio principal (AC #11)
                if _ok:
                    vaga_confirmada = fluxo.get("vaga_id_selecionada")
                    historico = list(fluxo.get("historico_vagas_aplicadas") or [])
                    if vaga_confirmada and vaga_confirmada not in historico:
                        historico.append(vaga_confirmada)
                    await _set_fluxo_async(conversa_id, {
                        "etapa": "pos_candidatura",  # S37C-01
                        "perfil": "publico",
                        "ultima_candidatura_codigo": codigo,
                        "historico_vagas_aplicadas": historico,
                        "nome_candidato_prefill": fluxo.get("nome_candidato", ""),
                    }, etapa_esperada=etapa_c)
                    logger.info(f"[empreg-notify] Confirmação enviada → pos_candidatura para conversa {conversa_id} — código {codigo}")


async def empregabilidade_notify_loop():
    """
    Roda em background a cada 20s.
    Detecta conversas em aguardando_retorno_vaga com vaga_criada_id já preenchido
    pelo portal e envia a confirmação via WhatsApp sem esperar nova mensagem.
    """
    import asyncio

    logger.info("[empreg-notify] Loop de notificação de vagas iniciado.")
    while True:
        try:
            await _empregabilidade_notify_tick()
        except Exception as e:
            logger.error(f"[empreg-notify] Erro no loop: {e}")

        await asyncio.sleep(20)
