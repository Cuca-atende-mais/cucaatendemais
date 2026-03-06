"""
uazapi_manager.py  (v2 — baseado no OpenAPI spec oficial uazapiGO v2.0)
──────────────────────────────────────────────────────────────────────
Autenticação (spec lines 15-19):
  - Endpoints admin   → header: admintoken: {UAZAPI_MASTER_TOKEN}
  - Endpoints instância → header: token: {INSTANCE_TOKEN}

Fluxo de criação (3 passos):
  A: POST /instance/init          (admintoken) → cria instância, retorna {token, name}
  B: POST /webhook                (token)      → configura webhook para nosso Worker
  C: POST /instance/connect       (token)      → inicia conexão e retorna QR em base64

Parear → webhook connection dispara GET /instance/status → ativa no banco
"""
import os
import logging
import asyncio
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from supabase import create_client, Client

logger = logging.getLogger("uazapi-manager")

# ─── Configuração ─────────────────────────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

UAZAPI_BASE_URL = os.getenv("UAZAPI_BASE_URL", "https://cucaatendemais.uazapi.com")
UAZAPI_MASTER_TOKEN = os.getenv("UAZAPI_MASTER_TOKEN", "")
WORKER_PUBLIC_URL = os.getenv("WORKER_PUBLIC_URL", os.getenv("NEXT_PUBLIC_WORKER_URL", "https://api.cucaatendemais.com.br"))

# Eventos que cada instância deve escutar
WEBHOOK_EVENTS = ["messages", "connection"]

# ─── Router FastAPI ───────────────────────────────────────────────────────────
router = APIRouter(prefix="/api/instancias", tags=["instancias"])


# ─── Schemas ─────────────────────────────────────────────────────────────────
class CriarInstanciaRequest(BaseModel):
    nome: str
    canal_tipo: str
    unidade_cuca: Optional[str] = None
    telefone: Optional[str] = None
    observacoes: Optional[str] = None


# ─── Helpers HTTP ─────────────────────────────────────────────────────────────
def _admin_headers() -> dict:
    """Header para endpoints administrativos (criar/listar instâncias)."""
    return {
        "Content-Type": "application/json",
        "admintoken": UAZAPI_MASTER_TOKEN,
    }


def _instance_headers(token: str) -> dict:
    """Header para endpoints de instância específica."""
    return {
        "Content-Type": "application/json",
        "token": token,
    }


async def _post(path: str, body: dict, headers: dict) -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(f"{UAZAPI_BASE_URL}{path}", headers=headers, json=body)
        resp.raise_for_status()
        return resp.json()


async def _get(path: str, headers: dict) -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(f"{UAZAPI_BASE_URL}{path}", headers=headers)
        resp.raise_for_status()
        return resp.json()


# ─── Lógica Interna ───────────────────────────────────────────────────────────

async def _criar_instancia_na_uazapi(nome: str) -> dict:
    """
    Passo A: POST /instance/init com admintoken.
    Retorna {token, name, instance, ...}
    """
    logger.info(f"[UAZAPI] Passo A — Criando instância: {nome}")
    result = await _post(
        "/instance/init",
        {"name": nome, "systemName": "cuca-atende-mais"},
        _admin_headers(),
    )
    token = result.get("token")
    if not token:
        logger.warning(f"[UAZAPI] Token ausente na resposta: {result}")
    return {"raw": result, "token": token}


async def _configurar_webhook(instance_token: str, webhook_url: str) -> dict:
    """
    Passo B: POST /webhook com token da instância.
    Modo simples: sem action/id — cria ou atualiza automaticamente.
    """
    logger.info(f"[UAZAPI] Passo B — Configurando webhook → {webhook_url}")
    body = {
        "url": webhook_url,
        "events": WEBHOOK_EVENTS,
        "excludeMessages": ["wasSentByApi", "isGroupYes"],
    }
    try:
        return await _post("/webhook", body, _instance_headers(instance_token))
    except Exception as e:
        logger.warning(f"[UAZAPI] Webhook config falhou (não crítico): {e}")
        return {}


async def _obter_qr_code(instance_token: str) -> dict:
    """
    Passo C: POST /instance/connect com token da instância.
    Sem body → gera QR Code (field qrcode em base64 na instância).
    """
    logger.info("[UAZAPI] Passo C — Iniciando conexão para gerar QR Code")
    result = await _post("/instance/connect", {}, _instance_headers(instance_token))
    # QR fica no objeto instance.qrcode
    instance_data = result.get("instance", {})
    qr_code = instance_data.get("qrcode")
    return {"qr_code": qr_code, "raw": result}


async def _verificar_status(instance_token: str) -> dict:
    """
    GET /instance/status com token da instância.
    Retorna {instance: {..., status, qrcode}, status: {connected, loggedIn, jid}}
    """
    result = await _get("/instance/status", _instance_headers(instance_token))
    instance_data = result.get("instance", {})
    status_data = result.get("status", {})
    state = instance_data.get("status", "unknown")
    is_connected = status_data.get("connected", False)
    jid = status_data.get("jid")
    phone = None
    if jid and isinstance(jid, dict):
        phone = jid.get("user")
    qr_code = instance_data.get("qrcode")
    return {
        "state": state,
        "is_connected": is_connected,
        "phone": phone,
        "qr_code": qr_code,
    }


async def _desconectar_na_uazapi(instance_token: str) -> bool:
    """POST /instance/disconnect com token da instância."""
    try:
        logger.info("[UAZAPI] Desconectando instância")
        await _post("/instance/disconnect", {}, _instance_headers(instance_token))
        return True
    except Exception as e:
        logger.error(f"[UAZAPI] Erro ao desconectar: {e}")
        return False


def _salvar_instancia_no_banco(
    nome: str, token: str, canal_tipo: str,
    unidade: Optional[str], telefone: Optional[str], obs: Optional[str],
    webhook_url: str,
) -> str:
    payload = {
        "nome": nome,
        "token": token,
        "canal_tipo": canal_tipo,
        "agente_tipo": canal_tipo,
        "unidade_cuca": unidade,
        "telefone": telefone,
        "ativa": False,
        "reserva": canal_tipo == "Reserva",
        "observacoes": obs,
        "webhook_url": webhook_url,
    }
    res = supabase.table("instancias_uazapi").insert(payload).execute()
    if res.data:
        return res.data[0]["id"]
    raise Exception("Falha ao persistir instância no banco.")


def _atualizar_status_banco(nome: str, ativa: bool, telefone: Optional[str] = None):
    """Atualiza status da instância. Detecta troca de número e reseta warmup_started_at."""
    dados: dict = {"ativa": ativa}

    if telefone:
        # Verificar se o número mudou (troca de chip ou ban+recuperação)
        existing = supabase.table("instancias_uazapi").select("telefone, warmup_started_at") \
            .eq("nome", nome).limit(1).execute()

        if existing.data:
            old_telefone = existing.data[0].get("telefone")
            old_warmup = existing.data[0].get("warmup_started_at")
            numero_mudou = old_telefone and old_telefone != telefone
            primeira_conexao = not old_warmup

            if primeira_conexao or numero_mudou:
                motivo = "primeira conexão" if primeira_conexao else f"troca {old_telefone} → {telefone}"
                logger.warning(f"[Warmup] '{nome}' {motivo} — warmup_started_at resetado.")
                dados["warmup_started_at"] = datetime.now(timezone.utc).isoformat()

        dados["telefone"] = telefone

    supabase.table("instancias_uazapi").update(dados).eq("nome", nome).execute()
    logger.info(f"[Banco] '{nome}' → ativa={ativa}, telefone={telefone}")


# ─── Endpoints FastAPI ────────────────────────────────────────────────────────

@router.post("/criar")
async def criar_instancia(req: CriarInstanciaRequest):
    """
    Fluxo completo de criação de instância:
      A) POST /instance/init      → cria e obtém token
      B) POST /webhook            → configura eventos
      C) POST /instance/connect   → gera QR Code
      D) Salva no banco como inativa
    """
    nome = req.nome.strip().replace(" ", "_").lower()

    # Verificar duplicata
    existing = supabase.table("instancias_uazapi").select("id").eq("nome", nome).execute()
    if existing.data:
        raise HTTPException(status_code=409, detail=f"Instância '{nome}' já existe.")

    try:
        # Passo A: criar na UAZAPI
        criacao = await _criar_instancia_na_uazapi(nome)
        token = criacao["token"]
        if not token:
            raise HTTPException(
                status_code=502,
                detail="UAZAPI não retornou token. Verifique UAZAPI_MASTER_TOKEN.",
            )

        # Passo B: configurar webhook
        webhook_url = f"{WORKER_PUBLIC_URL}/webhook/{token}"
        await _configurar_webhook(token, webhook_url)

        # Passo C: gerar QR Code
        qr_data = await _obter_qr_code(token)
        qr_code = qr_data.get("qr_code")

        # Passo D: persistir no banco
        inst_id = await asyncio.to_thread(
            _salvar_instancia_no_banco,
            nome, token, req.canal_tipo, req.unidade_cuca, req.telefone, req.observacoes, webhook_url,
        )

        logger.info(f"[✓] Instância '{nome}' criada. ID: {inst_id}. QR: {'sim' if qr_code else 'não'}")

        return {
            "success": True,
            "id": inst_id,
            "nome": nome,
            "token": token,
            "qr_code": qr_code,
            "webhook_url": webhook_url,
            "instrucao": "Escaneie o QR Code com o WhatsApp Business do celular desta instância.",
        }

    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        logger.error(f"[UAZAPI] Erro HTTP: {e.response.status_code} — {e.response.text[:300]}")
        raise HTTPException(
            status_code=502,
            detail=f"Erro na API UAZAPI: {e.response.status_code} — {e.response.text[:200]}",
        )
    except Exception as e:
        logger.error(f"[UAZAPI] Falha inesperada: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{nome}/status")
async def verificar_status(nome: str):
    """Verifica status e atualiza banco se necessário."""
    res = supabase.table("instancias_uazapi").select("id, token, ativa, telefone").eq("nome", nome).limit(1).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail=f"Instância '{nome}' não encontrada.")

    inst = res.data[0]
    token = inst.get("token")
    if not token:
        return {"nome": nome, "state": "sem_token", "ativa": inst["ativa"]}

    status = await _verificar_status(token)

    if status["is_connected"] and not inst["ativa"]:
        await asyncio.to_thread(_atualizar_status_banco, nome, True, status.get("phone"))
        logger.info(f"[Sync] '{nome}' detectado como conectado. Banco atualizado.")

    return {
        "nome": nome,
        "state": status["state"],
        "is_connected": status["is_connected"],
        "ativa": status["is_connected"],
        "telefone": inst.get("telefone") or status.get("phone"),
        "qr_code": status.get("qr_code"),
    }


@router.get("/{nome}/qrcode")
async def obter_qrcode(nome: str):
    """Gera novo QR Code para instância existente (quando o anterior expirou)."""
    res = supabase.table("instancias_uazapi").select("token, ativa").eq("nome", nome).limit(1).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail=f"Instância '{nome}' não encontrada.")

    inst = res.data[0]
    if inst.get("ativa"):
        return {"nome": nome, "qr_code": None, "ja_conectado": True}

    token = inst.get("token")
    if not token:
        raise HTTPException(status_code=400, detail="Instância sem token configurado.")

    # Busca QR via /instance/status (não precisa reconectar se ainda está connecting)
    status = await _verificar_status(token)
    qr_code = status.get("qr_code")

    # Se não houver QR no status, dispara novo connect
    if not qr_code:
        qr_data = await _obter_qr_code(token)
        qr_code = qr_data.get("qr_code")

    return {"nome": nome, "qr_code": qr_code, "ja_conectado": False}


@router.delete("/{nome}/logout")
async def logout_instancia(nome: str):
    """Desconecta instância com segurança."""
    res = supabase.table("instancias_uazapi").select("id, token").eq("nome", nome).limit(1).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail=f"Instância '{nome}' não encontrada.")

    token = res.data[0].get("token")
    if token:
        await _desconectar_na_uazapi(token)

    await asyncio.to_thread(_atualizar_status_banco, nome, False)
    supabase.table("instancias_uazapi").update({"telefone": None}).eq("nome", nome).execute()
    return {"success": True, "nome": nome, "mensagem": "Instância desconectada com segurança."}


@router.delete("/{nome}/excluir")
async def excluir_instancia(nome: str):
    """Desconecta + remove do banco. Irreversível."""
    try:
        res = supabase.table("instancias_uazapi").select("id, token").eq("nome", nome).limit(1).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail=f"Instância '{nome}' não encontrada.")

        token = res.data[0].get("token")
        inst_id = res.data[0]["id"]

        # Desconectar no UAZAPI (falha ignorada — instância pode já estar fora)
        if token:
            await _desconectar_na_uazapi(token)

        # Remover do banco
        supabase.table("instancias_uazapi").delete().eq("id", inst_id).execute()
        logger.info(f"[✓] Instância '{nome}' excluída permanentemente.")
        return {"success": True, "nome": nome}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[EXCLUIR] Erro inesperado ao excluir '{nome}': {type(e).__name__}: {e}")
        raise HTTPException(status_code=500, detail=f"Erro ao excluir instância: {str(e)}")



# ─── Handler interno: connection.update ────────────────────────────────────────
async def handle_connection_update(
    instance_name: str, status: str, token: str,
    phone: Optional[str] = None, bool_connected: bool = False
):
    """
    Chamado por main.py quando o Worker recebe evento connection do webhook da UAZAPI.
    Atualiza o banco automaticamente.
    Aceita tanto string status quanto bool_connected para maior robustez.
    """
    is_connected = bool_connected or status in ("open", "CONNECTED", "connected")
    try:
        await asyncio.to_thread(_atualizar_status_banco, instance_name, is_connected, phone if is_connected else None)
        logger.info(f"[connection.update] '{instance_name}' → status='{status}' | bool={bool_connected} | ativa={is_connected}")
    except Exception as e:
        logger.error(f"[connection.update] Erro ao atualizar banco: {e}")
