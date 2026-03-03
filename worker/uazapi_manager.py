"""
uazapi_manager.py
─────────────────
Módulo de integração real com a API uazapiGO.

Fluxo de criação de instância (conforme documentação oficial):
  Passo A: POST /instance/create         → Cria a instância no servidor UAZAPI
  Passo B: POST /webhook/set/{instance}  → Configura eventos do webhook
  Passo C: GET  /instance/connect/{instance} → Retorna QR Code em base64

O cliente nunca entra no painel UAZAPI — tudo é feito via este módulo.
"""
import os
import json
import logging
import asyncio
from typing import Optional
import httpx
from fastapi import APIRouter, Request, Response, HTTPException
from pydantic import BaseModel
from supabase import create_client, Client

logger = logging.getLogger("uazapi-manager")

# ─── Configuração ─────────────────────────────────────────────────────────────
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY") or os.getenv("SUPABASE_ANON_KEY")
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

UAZAPI_BASE_URL = os.getenv("UAZAPI_BASE_URL", "https://uazapi.com.br")
UAZAPI_MASTER_TOKEN = os.getenv("UAZAPI_MASTER_TOKEN", "")  # Token global do painel UAZAPI
WORKER_PUBLIC_URL = os.getenv("NEXT_PUBLIC_WORKER_URL", "https://api.cucaatendemais.com.br")

# URL do webhook que a UAZAPI chamará para cada instância
# (O worker usa a mesma rota /webhook/{token} que já existe em main.py)
WEBHOOK_BASE_URL = f"{WORKER_PUBLIC_URL}/webhook"

# Eventos que cada instância deve escutar
WEBHOOK_EVENTS = [
    "messages.upsert",     # Nova mensagem recebida
    "messages.update",     # Status de entrega (enviado, entregue, lido)
    "connection.update",   # Conexão/desconexão da instância
    "qrcode.updated",      # QR Code expirou — novo gerado
]

# Tempo máximo para polling de conexão (segundos)
QR_TIMEOUT_S = 120

# ─── Router FastAPI ───────────────────────────────────────────────────────────
router = APIRouter(prefix="/api/instancias", tags=["instancias"])


# ─── Schemas ─────────────────────────────────────────────────────────────────
class CriarInstanciaRequest(BaseModel):
    nome: str               # Nome da instância (Ex: "cuca_barra_institucional")
    canal_tipo: str         # Institucional | Empregabilidade | Acesso | Ouvidoria | Reserva
    unidade_cuca: Optional[str] = None  # None = Global (Ouvidoria/Acesso)
    observacoes: Optional[str] = None


class AtualizarTokenRequest(BaseModel):
    instance_nome: str
    token: str


# ─── Helpers HTTP ─────────────────────────────────────────────────────────────
def _headers(token: Optional[str] = None) -> dict:
    """Monta o cabeçalho de autenticação para a API UAZAPI."""
    return {
        "Content-Type": "application/json",
        "apikey": token or UAZAPI_MASTER_TOKEN,
    }


async def _uazapi_get(path: str, token: Optional[str] = None) -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.get(f"{UAZAPI_BASE_URL}{path}", headers=_headers(token))
        resp.raise_for_status()
        return resp.json()


async def _uazapi_post(path: str, body: dict, token: Optional[str] = None) -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            f"{UAZAPI_BASE_URL}{path}",
            headers=_headers(token),
            json=body
        )
        resp.raise_for_status()
        return resp.json()


async def _uazapi_delete(path: str, token: Optional[str] = None) -> dict:
    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.delete(f"{UAZAPI_BASE_URL}{path}", headers=_headers(token))
        resp.raise_for_status()
        return resp.json()


# ─── Lógica Interna ───────────────────────────────────────────────────────────
async def _criar_instancia_na_uazapi(nome: str) -> dict:
    """Passo A: Cria a instância no servidor UAZAPI."""
    logger.info(f"[UAZAPI] Criando instância: {nome}")
    result = await _uazapi_post("/instance/create", {"instanceName": nome})
    # Retorna o token da instância criada
    token = result.get("hash") or result.get("apikey") or result.get("token")
    if not token:
        logger.warning(f"[UAZAPI] Token não retornado na criação. Resposta: {result}")
    return {"raw": result, "token": token}


async def _configurar_webhook(nome: str, token: str) -> dict:
    """Passo B: Configura o webhook da instância para apontar para nosso Worker."""
    webhook_url = f"{WEBHOOK_BASE_URL}/{token}"
    logger.info(f"[UAZAPI] Configurando webhook de {nome} → {webhook_url}")
    body = {
        "webhook": {
            "enabled": True,
            "url": webhook_url,
            "byEvents": False,
            "events": WEBHOOK_EVENTS,
        }
    }
    return await _uazapi_post(f"/webhook/set/{nome}", body, token=token)


async def _obter_qr_code(nome: str, token: str) -> dict:
    """Passo C: Obtém o QR Code em base64 para exibir no modal do portal."""
    logger.info(f"[UAZAPI] Obtendo QR Code para: {nome}")
    result = await _uazapi_get(f"/instance/connect/{nome}", token=token)
    # O QR pode vir em campos diferentes dependendo da versão da API
    qr_code = (
        result.get("base64")
        or result.get("qrcode", {}).get("base64")
        or result.get("qr")
    )
    return {"qr_code": qr_code, "raw": result}


async def _verificar_conexao_na_uazapi(nome: str, token: str) -> str:
    """Consulta o estado atual da conexão de uma instância."""
    try:
        result = await _uazapi_get(f"/instance/connectionState/{nome}", token=token)
        state = result.get("state") or result.get("status") or "unknown"
        return state
    except Exception as e:
        logger.warning(f"[UAZAPI] Erro ao verificar conexão de {nome}: {e}")
        return "error"


async def _logout_na_uazapi(nome: str, token: str) -> bool:
    """Executa logout seguro da instância antes de deletar."""
    try:
        logger.info(f"[UAZAPI] Logout seguro: {nome}")
        await _uazapi_delete(f"/instance/logout/{nome}", token=token)
        return True
    except Exception as e:
        logger.error(f"[UAZAPI] Erro no logout de {nome}: {e}")
        return False


def _salvar_instancia_no_banco(nome: str, token: str, canal_tipo: str, unidade: Optional[str], obs: Optional[str]) -> str:
    """Persiste a nova instância no Supabase e retorna o ID gerado."""
    payload = {
        "nome": nome,
        "token": token,
        "canal_tipo": canal_tipo,
        "agente_tipo": canal_tipo,   # retrocompatibilidade
        "unidade_cuca": unidade,
        "ativa": False,              # Só ativará após parear o celular
        "reserva": canal_tipo == "Reserva",
        "observacoes": obs,
        "webhook_url": f"{WEBHOOK_BASE_URL}/{token}",
    }
    res = supabase.table("instancias_uazapi").insert(payload).execute()
    if res.data:
        return res.data[0]["id"]
    raise Exception("Falha ao persistir instância no banco.")


def _atualizar_status_banco(
    nome: str,
    ativa: bool,
    telefone: Optional[str] = None,
    token: Optional[str] = None,
):
    """Atualiza status da instância no banco após evento de conexão."""
    dados: dict = {"ativa": ativa}
    if telefone:
        dados["telefone"] = telefone
    if token:
        dados["token"] = token

    supabase.table("instancias_uazapi").update(dados).eq("nome", nome).execute()
    logger.info(f"[Banco] Instância '{nome}' → ativa={ativa}, telefone={telefone}")


# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/criar")
async def criar_instancia(req: CriarInstanciaRequest):
    """
    Cria uma nova instância no servidor UAZAPI e retorna o QR Code.

    Fluxo:
      1. POST /instance/create          → obtém token da instância
      2. POST /webhook/set/{instance}   → aponta webhook para nosso Worker
      3. GET  /instance/connect/{inst}  → retorna QR Code em base64
      4. Salva no banco como inativa    → ativará via connection.update
    """
    nome = req.nome.strip().replace(" ", "_").lower()

    # Verificar se já existe
    existing = supabase.table("instancias_uazapi").select("id").eq("nome", nome).execute()
    if existing.data:
        raise HTTPException(status_code=409, detail=f"Instância '{nome}' já existe.")

    try:
        # Passo A: Criar na UAZAPI
        criacao = await _criar_instancia_na_uazapi(nome)
        token = criacao["token"]

        if not token:
            raise HTTPException(
                status_code=502,
                detail="UAZAPI não retornou token. Verifique UAZAPI_MASTER_TOKEN."
            )

        # Passo B: Configurar Webhook
        try:
            await _configurar_webhook(nome, token)
        except Exception as wh_err:
            logger.warning(f"[UAZAPI] Webhook possivelmente não configurado: {wh_err}")
            # Não falha — prossegue para gerar QR Code

        # Passo C: Obter QR Code
        qr_data = await _obter_qr_code(nome, token)
        qr_code = qr_data.get("qr_code")

        # Passo D: Salvar no banco
        inst_id = await asyncio.to_thread(
            _salvar_instancia_no_banco,
            nome, token, req.canal_tipo, req.unidade_cuca, req.observacoes
        )

        logger.info(f"[✓] Instância '{nome}' criada. ID: {inst_id}. QR Code: {'sim' if qr_code else 'não'}")

        return {
            "success": True,
            "id": inst_id,
            "nome": nome,
            "token": token,
            "qr_code": qr_code,   # base64 — o frontend renderiza como <img>
            "webhook_url": f"{WEBHOOK_BASE_URL}/{token}",
            "instrucao": "Escaneie o QR Code com o WhatsApp do celular desta instância.",
        }

    except HTTPException:
        raise
    except httpx.HTTPStatusError as e:
        logger.error(f"[UAZAPI] Erro HTTP ao criar instância: {e.response.text}")
        raise HTTPException(
            status_code=502,
            detail=f"Erro na API UAZAPI: {e.response.status_code} — {e.response.text[:200]}"
        )
    except Exception as e:
        logger.error(f"[UAZAPI] Falha inesperada ao criar instância: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{nome}/status")
async def verificar_status(nome: str):
    """
    Verifica o estado atual de conexão de uma instância.
    Atualiza o banco automaticamente se o estado mudar.

    Estados possíveis: 'open' (conectado), 'close', 'connecting', 'error'
    """
    # Buscar token no banco
    res = supabase.table("instancias_uazapi").select("id, token, ativa, telefone").eq("nome", nome).maybeSingle().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail=f"Instância '{nome}' não encontrada.")

    inst = res.data
    token = inst.get("token")

    if not token:
        return {"nome": nome, "state": "sem_token", "ativa": inst["ativa"]}

    # Verificar na UAZAPI
    state = await _verificar_conexao_na_uazapi(nome, token)

    # Se connectou (state == "open") mas banco ainda marca inativa → sincronizar
    is_connected = state in ("open", "CONNECTED", "connected")
    if is_connected and not inst["ativa"]:
        await asyncio.to_thread(_atualizar_status_banco, nome, True)
        logger.info(f"[Sync] '{nome}' detectado como conectado. Banco atualizado.")

    return {
        "nome": nome,
        "state": state,
        "is_connected": is_connected,
        "ativa": is_connected,
        "telefone": inst.get("telefone"),
    }


@router.get("/{nome}/qrcode")
async def obter_qrcode(nome: str):
    """
    Gera um novo QR Code para uma instância existente.
    Útil quando o QR anterior expirou (30 segundos).
    """
    res = supabase.table("instancias_uazapi").select("token, ativa").eq("nome", nome).maybeSingle().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail=f"Instância '{nome}' não encontrada.")

    inst = res.data
    if inst.get("ativa"):
        return {"nome": nome, "qr_code": None, "ja_conectado": True}

    token = inst.get("token")
    if not token:
        raise HTTPException(status_code=400, detail="Instância sem token configurado.")

    qr_data = await _obter_qr_code(nome, token)
    return {
        "nome": nome,
        "qr_code": qr_data.get("qr_code"),
        "ja_conectado": False,
    }


@router.delete("/{nome}/logout")
async def logout_instancia(nome: str):
    """
    Desconecta a instância com segurança da sessão WhatsApp.
    Deve ser chamado ANTES de deletar ou trocar o chip.
    """
    res = supabase.table("instancias_uazapi").select("id, token").eq("nome", nome).maybeSingle().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail=f"Instância '{nome}' não encontrada.")

    token = res.data.get("token")
    if token:
        await _logout_na_uazapi(nome, token)

    # Marcar como inativa no banco e limpar telefone
    await asyncio.to_thread(
        _atualizar_status_banco, nome, False, None, None
    )
    supabase.table("instancias_uazapi").update({"telefone": None}).eq("nome", nome).execute()

    logger.info(f"[✓] Logout de '{nome}' concluído.")
    return {"success": True, "nome": nome, "mensagem": "Instância desconectada com segurança."}


@router.delete("/{nome}/excluir")
async def excluir_instancia(nome: str):
    """
    Faz logout + remove a instância do banco.
    Irreversível.
    """
    res = supabase.table("instancias_uazapi").select("id, token").eq("nome", nome).maybeSingle().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail=f"Instância '{nome}' não encontrada.")

    token = res.data.get("token")
    inst_id = res.data["id"]

    # Logout seguro antes de deletar
    if token:
        await _logout_na_uazapi(nome, token)

    # Excluir também transbordos vinculados e mensagens
    supabase.table("instancias_uazapi").delete().eq("id", inst_id).execute()

    logger.info(f"[✓] Instância '{nome}' excluída permanentemente.")
    return {"success": True, "nome": nome}


# ─── Handler interno: chamado pelo webhook quando connection.update ────────────
async def handle_connection_update(instance_name: str, status: str, token: str, phone: Optional[str] = None):
    """
    Chamado por main.py quando o Worker recebe connection.update da UAZAPI.
    Atualiza o banco automaticamente — o Gerente não precisa fazer nada.
    """
    is_connected = status in ("open", "CONNECTED")

    try:
        await asyncio.to_thread(
            _atualizar_status_banco,
            instance_name,
            is_connected,
            phone if is_connected else None,
        )
        logger.info(f"[connection.update] '{instance_name}' → status={status} | ativa={is_connected}")
    except Exception as e:
        logger.error(f"[connection.update] Erro ao atualizar banco: {e}")
