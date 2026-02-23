FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Healthcheck: usa Python puro (sem curl/wget) para verificar o endpoint /health
# --start-period=30s: aguarda 30s após start antes da primeira checagem
# --interval=30s: checa a cada 30s
# --timeout=10s: timeout por checagem
# --retries=3: falha após 3 tentativas consecutivas
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=5)" || exit 1

CMD ["gunicorn", "-w", "1", "-k", "uvicorn.workers.UvicornWorker", "main:app", "--bind", "0.0.0.0:8000", "--timeout", "120", "--keep-alive", "5"]
