FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# -w 1: apenas 1 worker (necessário para asyncio + background tasks)
# --timeout 120: evita que gunicorn mate workers lentos (IA pode demorar)
# --keep-alive 5: mantém conexões HTTP ativas
CMD ["gunicorn", "-w", "1", "-k", "uvicorn.workers.UvicornWorker", "main:app", "--bind", "0.0.0.0:8000", "--timeout", "120", "--keep-alive", "5"]
