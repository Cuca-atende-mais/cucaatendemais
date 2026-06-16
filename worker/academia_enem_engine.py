"""
S-AE-04 — Automação de Entrada Humanizada (Academia Enem / WhatsApp Oficial via AuctaFlux).

Engine PRÓPRIO, independente do worker/main.py do uazapi (camada uazapi BLINDADA).
- Acionado pelo webhook AuctaFlux do portal (POST /academia-enem/process com {ae_conversa_id}).
- Estado da conversa em ae_conversas.estado + metadata['ae_fluxo'] (espelha a mecânica de empreg_fluxo).
- Envio via AuctaFlux REST (mesmo contrato de cuca-portal/src/lib/auctaflux/client.ts: POST
  /workspaces/{id}/messages {to, text}, Bearer reseller key) e gravação em ae_mensagens (remetente='ia').
- SEM menu numérico: saudação humanizada + coleta de nome. Após o nome, hand-off ao classificador
  (S-AE-10) pelo seam classificar() — SEM responder dúvida aqui (no-invention; o "cérebro" é a S-AE-10).
"""

import os
import re
import logging
import httpx
from datetime import datetime, timezone
from supabase import create_client, Client

logger = logging.getLogger("academia_enem_engine")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
AUCTAFLUX_BASE_URL = os.getenv("AUCTAFLUX_BASE_URL", "https://api-flux.aucta.tech/api/v1/reseller/v1").rstrip("/")
AUCTAFLUX_KEY = os.getenv("AUCTAFLUX_RESELLER_API_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# Reuso da mecânica do empregabilidade_engine — palavras de encerramento.
_PALAVRAS_ENCERRAR = {
    "tchau", "até mais", "até logo", "encerrar", "finalizar", "obrigado",
    "obrigada", "valeu", "pronto", "pode fechar", "nada mais", "só isso", "era isso",
}

SAUDACAO = (
    "Olá! 👋 Seja muito bem-vindo(a) à Academia Enem. "
    "Pra te atender direitinho, como você se chama?"
)

# Prefixos comuns que o lead usa ao dizer o nome ("meu nome é joão" -> "joão").
_PREFIXOS_NOME = re.compile(
    r"^\s*(?:"
    r"meu nome\s+(?:é|e|eh)?\s*|"
    r"me chamo\s+|"
    r"(?:eu\s+)?sou\s+(?:o|a)?\s*|"
    r"aqui\s+(?:é|e)\s+(?:o|a)?\s*|"
    r"nome\s*:?\s*"
    r")",
    re.IGNORECASE,
)


def _quer_encerrar(texto: str) -> bool:
    t = (texto or "").strip().lower()
    return t in _PALAVRAS_ENCERRAR or any(p in t for p in _PALAVRAS_ENCERRAR)


def _extrair_nome(texto: str) -> str:
    """Extrai um nome legível da mensagem do lead (sem inventar — só limpa/normaliza)."""
    bruto = _PREFIXOS_NOME.sub("", (texto or "").strip())
    bruto = bruto.splitlines()[0] if bruto else ""
    # Mantém só a primeira parte curta (evita capturar uma frase inteira como "nome").
    palavras = [p for p in re.split(r"\s+", bruto) if p][:3]
    nome = " ".join(palavras).strip(" .,!?-")[:60]
    return nome.title() if nome else ""


# ---------------------------------------------------------------------------
# Máquina de estados — FUNÇÃO PURA (testável sem IO). Decide a ação a partir do
# estado atual + texto recebido. Não faz rede nem banco.
# ---------------------------------------------------------------------------

def decidir(estado: str | None, texto: str, fluxo: dict | None) -> dict:
    """
    Retorna a decisão da máquina de estados:
      { acao: 'saudar'|'coletar_nome'|'classificar'|'encerrar',
        proximo_estado: str, mensagem: str|None, fluxo: dict }
    'classificar' tem mensagem=None: hand-off SILENCIOSO ao seam (S-AE-10 responde, não aqui).
    """
    estado = estado or "novo"
    fluxo = dict(fluxo or {})
    texto_norm = (texto or "").strip()

    # Encerramento só faz sentido depois do diálogo ter começado.
    # 'encerrada' é ciclo de vida → vai em `status` (não em `estado`, que é a etapa do fluxo).
    if estado in ("aguardando_nome", "ativo") and _quer_encerrar(texto_norm):
        return {
            "acao": "encerrar",
            "proximo_estado": "ativo",
            "proximo_status": "encerrada",
            "mensagem": "Tudo certo! Quando quiser falar sobre o Enem, é só me chamar por aqui. 👋",
            "fluxo": {**fluxo, "etapa": "encerrada"},
        }

    if estado in ("novo", "", None):
        return {
            "acao": "saudar",
            "proximo_estado": "aguardando_nome",
            "mensagem": SAUDACAO,
            "fluxo": {**fluxo, "etapa": "aguardando_nome"},
        }

    if estado == "aguardando_nome":
        nome = _extrair_nome(texto_norm)
        saud = f"Prazer, {nome}!" if nome else "Prazer!"
        return {
            "acao": "coletar_nome",
            "proximo_estado": "ativo",
            "mensagem": f"{saud} 😊 Pode me mandar sua dúvida sobre o Enem que eu te ajudo.",
            "fluxo": {**fluxo, "nome": nome, "etapa": "ativo"},
        }

    # estado 'ativo' (ou qualquer estado pós-nome): hand-off ao classificador (S-AE-10).
    # Seam SILENCIOSO — a S-AE-04 não responde dúvidas (no-invention). A S-AE-10 assume o roteamento.
    return {"acao": "classificar", "proximo_estado": "ativo", "mensagem": None, "fluxo": fluxo}


# ---------------------------------------------------------------------------
# SEAM de roteamento (S-AE-10) — interface estável, no-op até a S-AE-10 existir.
# NÃO adicionar lógica de RAG/disparo/transbordo aqui: isso é a S-AE-10 (integrador).
# ---------------------------------------------------------------------------

async def classificar(ae_conversa_id: str) -> None:
    """Hand-off ao classificador disparo-vs-RAG (S-AE-10). No-op por enquanto (silêncio proposital)."""
    logger.info(
        f"[AE engine] seam classificar() acionado p/ conversa {ae_conversa_id} — "
        "roteamento será implementado na S-AE-10 (no-op no momento)."
    )
    return None


# ---------------------------------------------------------------------------
# Envio via AuctaFlux (mesmo contrato do client.ts) + gravação em ae_mensagens.
# ---------------------------------------------------------------------------

async def _enviar(ae_conversa_id: str, workspace_id: str, to: str, texto: str) -> bool:
    """Envia texto via AuctaFlux e grava em ae_mensagens. Retorna True só se enviou de fato."""
    if not AUCTAFLUX_KEY:
        logger.error("[AE engine] AUCTAFLUX_RESELLER_API_KEY não configurada — envio abortado (configure no worker).")
        return False
    resultado: dict = {}
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            res = await client.post(
                f"{AUCTAFLUX_BASE_URL}/workspaces/{workspace_id}/messages",
                headers={
                    "Authorization": f"Bearer {AUCTAFLUX_KEY}",
                    "Content-Type": "application/json",
                    "Accept": "application/json",
                },
                json={"to": to, "text": texto},
            )
            res.raise_for_status()
            resultado = res.json() if res.content else {}
    except Exception as e:
        logger.error(f"[AE engine] Falha ao enviar via AuctaFlux (conversa {ae_conversa_id}): {e}", exc_info=True)
        return False

    # Grava a mensagem enviada para o painel (S-AE-03). remetente='ia' (enum ae_mensagens).
    try:
        supabase.table("ae_mensagens").insert({
            "ae_conversa_id": ae_conversa_id,
            "wa_message_id": resultado.get("wamid"),
            "remetente": "ia",
            "tipo": "text",
            "conteudo": texto,
            "status": resultado.get("status"),
            "metadata": {"passthrough_id": resultado.get("passthrough_id")},
        }).execute()
        # Agregados: outbound atualiza ultima_mensagem_em/updated_at — NÃO ultima_entrada_em (só inbound).
        agora = datetime.now(timezone.utc).isoformat()
        supabase.table("ae_conversas").update(
            {"ultima_mensagem_em": agora, "updated_at": agora}
        ).eq("id", ae_conversa_id).execute()
    except Exception as e:
        logger.error(f"[AE engine] Falha ao gravar mensagem da IA (conversa {ae_conversa_id}): {e}", exc_info=True)
    return True


def _persistir_estado(ae_conversa_id: str, estado: str, fluxo: dict, status: str | None = None) -> None:
    """Atualiza a etapa do fluxo (`estado`) + `metadata.ae_fluxo`. `status` (ciclo de vida:
    ativa|encerrada|awaiting_human) só é tocado quando informado — não confundir com `estado`."""
    res = supabase.table("ae_conversas").select("metadata").eq("id", ae_conversa_id).single().execute()
    metadata = (res.data or {}).get("metadata") or {}
    metadata["ae_fluxo"] = fluxo
    update: dict = {"estado": estado, "metadata": metadata, "updated_at": datetime.now(timezone.utc).isoformat()}
    if status is not None:
        update["status"] = status
    supabase.table("ae_conversas").update(update).eq("id", ae_conversa_id).execute()


# ---------------------------------------------------------------------------
# Entrada do engine — relê o estado FRESCO do banco (fonte única; lida com 2 triggers seguidos).
# ---------------------------------------------------------------------------

async def processar_mensagem_academia_enem(ae_conversa_id: str) -> None:
    # 1) Carrega a conversa (estado/metadata/contato/instância).
    try:
        conv_res = (
            supabase.table("ae_conversas")
            .select("id, wa_contact, status, estado, metadata, lead_id, ae_instancia_id")
            .eq("id", ae_conversa_id)
            .single()
            .execute()
        )
    except Exception as e:
        logger.error(f"[AE engine] Conversa {ae_conversa_id} não carregada: {e}")
        return
    conv = conv_res.data
    if not conv:
        logger.warning(f"[AE engine] Conversa {ae_conversa_id} inexistente.")
        return

    # awaiting_human: humano assumiu (S-AE-03/S-AE-06) — IA silenciada.
    # CRÍTICO: takeover vive em `status` (o painel S-AE-03 grava status), NÃO em `estado` (etapa do fluxo).
    if conv.get("status") == "awaiting_human":
        logger.info(f"[AE engine] Conversa {ae_conversa_id} em awaiting_human — IA silenciada.")
        return

    # 2) Última mensagem: só age sobre inbound de lead (evita loop com o próprio outbound).
    msg_res = (
        supabase.table("ae_mensagens")
        .select("remetente, conteudo")
        .eq("ae_conversa_id", ae_conversa_id)
        .order("created_at", desc=True)
        .limit(1)
        .execute()
    )
    ultima = (msg_res.data or [{}])[0]
    if ultima.get("remetente") != "lead":
        logger.info(f"[AE engine] Última mensagem não é do lead (conversa {ae_conversa_id}) — nada a fazer.")
        return
    texto = ultima.get("conteudo") or ""

    # 3) workspace_id da instância (para enviar).
    ws_res = (
        supabase.table("ae_instancias")
        .select("workspace_id")
        .eq("id", conv["ae_instancia_id"])
        .single()
        .execute()
    )
    workspace_id = (ws_res.data or {}).get("workspace_id")

    # 4) Decide (puro) a partir do estado fresco.
    fluxo = (conv.get("metadata") or {}).get("ae_fluxo") or {}
    decisao = decidir(conv.get("estado"), texto, fluxo)

    # 5) Seam de roteamento (sem envio): só avança o fluxo e chama a S-AE-10.
    if decisao["acao"] == "classificar":
        _persistir_estado(ae_conversa_id, decisao["proximo_estado"], decisao["fluxo"])
        await classificar(ae_conversa_id)
        return

    # 6) Ações com mensagem: ENVIA primeiro; só avança o estado se o envio funcionou
    #    (evita "consumir" a saudação sem o lead receber quando a key/serviço falha).
    if not decisao.get("mensagem"):
        return
    if not workspace_id:
        logger.error(f"[AE engine] Conversa {ae_conversa_id} sem workspace_id — não há como enviar.")
        return
    enviado = await _enviar(ae_conversa_id, workspace_id, conv["wa_contact"], decisao["mensagem"])
    if enviado:
        _persistir_estado(
            ae_conversa_id, decisao["proximo_estado"], decisao["fluxo"], status=decisao.get("proximo_status")
        )
