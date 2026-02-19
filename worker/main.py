from fastapi import FastAPI, Request, Header, HTTPException
import os
import json
import logging
from dotenv import load_dotenv

load_dotenv()

# Configuração de Logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("worker-cuca")

app = FastAPI(title="Worker Sistema CUCA")

@app.get("/health")
async def health_check():
    return {"status": "healthy", "service": "worker-cuca"}

@app.post("/webhook/{token}")
async def uazapi_webhook(token: str, request: Request):
    # 1. Resposta 200 OK imediata (Requisito Crítico UAZAPI)
    # Nota: Em produção, validaremos o token no banco antes de processar
    
    try:
        payload = await request.json()
        logger.info(f"Webhook recebido para token: {token}")
        
        # TODO: Implementar lógica de salvamento e roteamento
        # - Validar token no Supabase
        # - Salvar em message_logs
        # - Roteador de eventos (messages.upsert, messages.update)
        
        return {"status": "received"}
    except Exception as e:
        logger.error(f"Erro ao processar webhook: {str(e)}")
        # Mesmo com erro, retornamos 200 ou um status que não trave o retry da UAZAPI se for erro de payload
        return {"status": "error", "message": str(e)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
