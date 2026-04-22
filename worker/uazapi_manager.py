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
    CRÍTICO: falha aqui propaga exceção — instância não deve ser criada sem webhook ativo.
    """
    logger.info(f"[UAZAPI] Passo B — Configurando webhook → {webhook_url}")
    body = {
        "enabled": True,
        "url": webhook_url,
        "events": WEBHOOK_EVENTS,
        "excludeMessages": ["wasSentByApi", "isGroupYes"],
    }
    return await _post("/webhook", body, _instance_headers(instance_token))


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


async def _desconectar_na_uazapi(instance_token: str, instance_nome: str = "") -> bool:
    """
    Desconecta instância na UAZAPI com dois níveis de tentativa:
      1) POST /instance/disconnect com token da instância (padrão)
      2) POST /instance/disconnect com admintoken + nome (fallback se token recusado)
    Verifica o status após desconexão para confirmar o resultado real.
    """
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Tentativa 1: token da instância
            logger.info(f"[UAZAPI] Desconectando '{instance_nome}' via instance token")
            resp1 = await client.post(
                f"{UAZAPI_BASE_URL}/instance/disconnect",
                headers=_instance_headers(instance_token),
                json={},
            )
            logger.info(f"[UAZAPI] Disconnect v1: {resp1.status_code} — {resp1.text[:200]}")

            if resp1.status_code not in (200, 204):
                # Fallback: admintoken + nome
                if instance_nome:
                    logger.warning(f"[UAZAPI] Token recusado ({resp1.status_code}). Tentando admintoken para '{instance_nome}'")
                    resp2 = await client.post(
                        f"{UAZAPI_BASE_URL}/instance/disconnect",
                        headers=_admin_headers(),
                        json={"name": instance_nome},
                    )
                    logger.info(f"[UAZAPI] Disconnect v2 (admin): {resp2.status_code} — {resp2.text[:200]}")
                    if resp2.status_code not in (200, 204):
                        logger.error(f"[UAZAPI] Falha em ambas tentativas de desconexão para '{instance_nome}'")
                        return False

            # Verifica status real após desconexão (aguarda 1s para propagar)
            await asyncio.sleep(1)
            status = await _verificar_status(instance_token)
            if status["is_connected"]:
                logger.warning(f"[UAZAPI] '{instance_nome}' ainda conectado após disconnect. UAZAPI não desconectou.")
                return False

            logger.info(f"[UAZAPI] '{instance_nome}' confirmado como desconectado.")
            return True

    except Exception as e:
        logger.error(f"[UAZAPI] Erro ao desconectar '{instance_nome}': {e}")
        return False


async def _deletar_na_uazapi(instance_name: str) -> bool:
    """DELETE /instance/delete/:instance (Requer Admin Token). Limpa permanentemente no painel remoto."""
    try:
        logger.info(f"[UAZAPI] Deletando instância definitivamente: {instance_name}")
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Tentativa 1: DELETE /instance/delete/{nome} com admintoken (padrão UAZAPI GO v2)
            resp = await client.delete(
                f"{UAZAPI_BASE_URL}/instance/delete/{instance_name}",
                headers=_admin_headers()
            )
            logger.info(f"[UAZAPI] Delete v1 response: {resp.status_code} — {resp.text[:300]}")

            if resp.status_code in (200, 204):
                # Verifica se realmente foi deletado (UAZAPI às vezes retorna 200 mas só desconecta)
                check = await client.get(
                    f"{UAZAPI_BASE_URL}/instance/status",
                    headers=_instance_headers(instance_name),
                )
                if check.status_code == 404:
                    logger.info(f"[UAZAPI] Instância '{instance_name}' confirmada como deletada.")
                    return True
                else:
                    logger.warning(f"[UAZAPI] Instância ainda existe após DELETE (status {check.status_code}). Tentando via POST /instance/logout.")

            # Tentativa 2: POST /instance/logout com admintoken (endpoint alternativo)
            resp2 = await client.post(
                f"{UAZAPI_BASE_URL}/instance/delete",
                headers=_admin_headers(),
                json={"name": instance_name}
            )
            logger.info(f"[UAZAPI] Delete v2 response: {resp2.status_code} — {resp2.text[:300]}")
            return resp2.status_code in (200, 204, 404)

    except Exception as e:
        logger.error(f"[UAZAPI] Erro ao deletar do painel UAZAPI: {e}")
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

    if status["is_connected"]:
        phone = status.get("phone")

        # Race condition: jid pode ser null por 1-3s logo após a conexão do QR.
        # Se conectado mas sem phone, aguarda 3s e consulta novamente.
        if not phone:
            await asyncio.sleep(3)
            status_retry = await _verificar_status(token)
            phone = status_retry.get("phone")
            if phone:
                logger.info(f"[Sync] '{nome}' phone capturado na segunda tentativa: {phone}")

        if not inst["ativa"]:
            # Primeira conexão: marca ativa + salva telefone
            await asyncio.to_thread(_atualizar_status_banco, nome, True, phone)
            logger.info(f"[Sync] '{nome}' conectado. ativa=True. Telefone: {phone}")
        elif not inst.get("telefone") and phone:
            # Já estava ativa mas sem telefone (ex: criado via polling anterior sem jid)
            await asyncio.to_thread(
                lambda: supabase.table("instancias_uazapi")
                    .update({"telefone": phone, "updated_at": datetime.now(timezone.utc).isoformat()})
                    .eq("nome", nome).execute()
            )
            logger.info(f"[Sync] '{nome}' telefone preenchido retroativamente: {phone}")
    elif not status["is_connected"] and inst["ativa"]:
        # Instância desconectada na UAZAPI mas banco mostra ativa — corrige inconsistência
        await asyncio.to_thread(_atualizar_status_banco, nome, False, None)
        logger.warning(f"[Sync] '{nome}' desconectado na UAZAPI. Banco corrigido para ativa=False.")

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
    """Gera novo QR Code para instância existente (quando o anterior expirou).
    Reconfigura o webhook defensivamente antes de gerar QR — garante que
    reconexão após troca de chip ou queda mantém o webhook ativo."""
    res = supabase.table("instancias_uazapi").select("token, ativa").eq("nome", nome).limit(1).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail=f"Instância '{nome}' não encontrada.")

    inst = res.data[0]
    if inst.get("ativa"):
        return {"nome": nome, "qr_code": None, "ja_conectado": True}

    token = inst.get("token")
    if not token:
        raise HTTPException(status_code=400, detail="Instância sem token configurado.")

    # Reconfigurar webhook defensivamente antes de gerar QR
    webhook_url = f"{WORKER_PUBLIC_URL}/webhook/{token}"
    try:
        await _configurar_webhook(token, webhook_url)
        await asyncio.to_thread(
            lambda: supabase.table("instancias_uazapi").update({"webhook_url": webhook_url}).eq("nome", nome).execute()
        )
        logger.info(f"[QRCode] Webhook reconfigurado para '{nome}' antes do QR.")
    except Exception as wh_err:
        logger.warning(f"[QRCode] Falha ao reconfigurar webhook para '{nome}': {wh_err}")

    # Busca QR via /instance/status (não precisa reconectar se ainda está connecting)
    try:
        status = await _verificar_status(token)
    except httpx.HTTPStatusError as e:
        status_code = e.response.status_code
        detail = e.response.text[:300]
        if status_code in (401, 403, 404):
            raise HTTPException(
                status_code=502,
                detail=f"Token da instância '{nome}' inválido ou instância não existe na UAZAPI (HTTP {status_code}). "
                       f"A instância pode ter sido deletada do painel UAZAPI. Exclua e recrie a instância.",
            )
        raise HTTPException(status_code=502, detail=f"UAZAPI retornou erro ao verificar status: HTTP {status_code} — {detail}")

    qr_code = status.get("qr_code")

    # Se já conectou enquanto aguardávamos (race condition)
    if status.get("is_connected"):
        await asyncio.to_thread(_atualizar_status_banco, nome, True)
        return {"nome": nome, "qr_code": None, "ja_conectado": True}

    # Se não houver QR no status, dispara novo connect
    if not qr_code:
        try:
            qr_data = await _obter_qr_code(token)
            qr_code = qr_data.get("qr_code")
        except httpx.HTTPStatusError as e:
            status_code = e.response.status_code
            detail = e.response.text[:300]
            raise HTTPException(
                status_code=502,
                detail=f"UAZAPI não gerou QR Code para '{nome}' (HTTP {status_code}): {detail}",
            )

    return {"nome": nome, "qr_code": qr_code, "ja_conectado": False}


@router.post("/{nome}/reconfigurar-webhook")
async def reconfigurar_webhook(nome: str):
    """
    Reconfigura o webhook de uma instância existente na UAZAPI.
    Usado para corrigir instâncias com webhook perdido ou mal configurado,
    sem precisar recriar a instância inteira.
    """
    res = supabase.table("instancias_uazapi").select("token").eq("nome", nome).limit(1).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail=f"Instância '{nome}' não encontrada.")

    token = res.data[0].get("token")
    if not token:
        raise HTTPException(status_code=400, detail="Instância sem token. Configure o token primeiro no painel UAZAPI.")

    webhook_url = f"{WORKER_PUBLIC_URL}/webhook/{token}"
    try:
        result = await _configurar_webhook(token, webhook_url)
        await asyncio.to_thread(
            lambda: supabase.table("instancias_uazapi").update({"webhook_url": webhook_url}).eq("nome", nome).execute()
        )
        logger.info(f"[✓] Webhook reconfigurado manualmente para '{nome}': {webhook_url}")
        return {"success": True, "nome": nome, "webhook_url": webhook_url, "uazapi": result}
    except Exception as e:
        logger.error(f"[WEBHOOK] Falha ao reconfigurar '{nome}': {e}")
        raise HTTPException(status_code=502, detail=f"Falha ao configurar webhook na UAZAPI: {str(e)}")


@router.delete("/{nome}/logout")
async def logout_instancia(nome: str):
    """
    Desconecta instância com segurança.
    Só atualiza o banco para ativa=False após confirmar que a UAZAPI desconectou.
    Se a UAZAPI falhar, retorna erro 502 com detalhes para diagnóstico.
    """
    res = supabase.table("instancias_uazapi").select("id, token, ativa").eq("nome", nome).limit(1).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail=f"Instância '{nome}' não encontrada.")

    inst = res.data[0]
    token = inst.get("token")

    if not token:
        # Sem token: só atualiza banco (instância nunca foi conectada)
        await asyncio.to_thread(_atualizar_status_banco, nome, False)
        return {"success": True, "nome": nome, "mensagem": "Instância marcada como inativa (sem token registrado)."}

    ok = await _desconectar_na_uazapi(token, instance_nome=nome)

    if not ok:
        # UAZAPI não confirmou desconexão — atualiza banco mesmo assim mas avisa o cliente
        logger.warning(f"[Logout] UAZAPI não confirmou desconexão de '{nome}'. Banco atualizado com aviso.")
        await asyncio.to_thread(_atualizar_status_banco, nome, False)
        raise HTTPException(
            status_code=502,
            detail=f"A sessão WhatsApp de '{nome}' pode ainda estar ativa na UAZAPI. "
                   f"Banco atualizado para inativo. Verifique manualmente no painel UAZAPI."
        )

    await asyncio.to_thread(_atualizar_status_banco, nome, False)
    return {"success": True, "nome": nome, "mensagem": "Instância desconectada com segurança e confirmada."}


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
            await _desconectar_na_uazapi(token, instance_nome=nome)

        # Deletar da UAZAPI definitivamente (limpa do painel deles)
        await _deletar_na_uazapi(nome)

        # Remover do banco
        supabase.table("instancias_uazapi").delete().eq("id", inst_id).execute()
        logger.info(f"[✓] Instância '{nome}' excluída permanentemente.")
        return {"success": True, "nome": nome}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[EXCLUIR] Erro inesperado ao excluir '{nome}': {type(e).__name__}: {e}")
        raise HTTPException(status_code=500, detail=f"Erro ao excluir instância: {str(e)}")



# Razões que indicam ban/expulsão forçada pelo WhatsApp
_BAN_REASONS = ("401", "logged out", "banned", "forbidden", "replaced")

def _is_ban_reason(reason: str) -> bool:
    r = reason.lower()
    return any(k in r for k in _BAN_REASONS)

def _marcar_ban_banco(nome: str, motivo: str):
    """Persiste detecção de ban sem alterar warmup ou telefone."""
    supabase.table("instancias_uazapi").update({
        "ativa": False,
        "ban_detectado_em": datetime.now(timezone.utc).isoformat(),
        "ban_motivo": motivo,
    }).eq("nome", nome).execute()
    logger.critical(
        f"[BAN DETECTADO] Instância '{nome}' banida/expulsa pelo WhatsApp. "
        f"Motivo: '{motivo}'. Instância marcada como inativa. "
        f"Não reconecte sem investigar — aguarde ao menos 48h."
    )


# ─── Handler interno: connection.update ────────────────────────────────────────
async def handle_connection_update(
    instance_name: str, status: str, token: str,
    phone: Optional[str] = None, bool_connected: bool = False,
    disconnect_reason: Optional[str] = None,
):
    """
    Chamado por main.py quando o Worker recebe evento connection do webhook da UAZAPI.
    Atualiza o banco automaticamente.
    Aceita tanto string status quanto bool_connected para maior robustez.
    Se disconnect_reason indicar ban, marca ban_detectado_em e loga em CRITICAL.
    """
    is_connected = bool_connected or status in ("open", "CONNECTED", "connected")

    # Detectar ban antes de qualquer outra lógica
    if not is_connected and disconnect_reason and _is_ban_reason(disconnect_reason):
        try:
            await asyncio.to_thread(_marcar_ban_banco, instance_name, disconnect_reason)
        except Exception as e:
            logger.error(f"[connection.update] Erro ao marcar ban no banco: {e}")
        return  # _marcar_ban_banco já define ativa=False; não sobrescrever

    try:
        await asyncio.to_thread(_atualizar_status_banco, instance_name, is_connected, phone if is_connected else None)
        logger.info(f"[connection.update] '{instance_name}' → status='{status}' | bool={bool_connected} | ativa={is_connected}")
    except Exception as e:
        logger.error(f"[connection.update] Erro ao atualizar banco: {e}")
