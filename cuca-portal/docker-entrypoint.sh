#!/bin/sh
# SQS-51 (A4): runtime injection de NEXT_PUBLIC_* no bundle Next.js.
#
# Por quê: NEXT_PUBLIC_* é inlinado por `next build` em build time. EasyPanel
# (versão atual do cliente) não expõe `--build-arg` na UI, então o build sai
# com placeholders (ver Dockerfile). Este script substitui os placeholders
# pelos valores reais das variáveis de ambiente antes do servidor subir.
#
# Idempotente: pode rodar várias vezes; se já foi substituído, sed não muda
# nada. Custo desprezível (poucos MB de JS).

set -e

# Diretórios onde o Next.js coloca os bundles que vão pro browser.
TARGET_DIRS="/app/.next /app/public"

replace_var () {
    var_name="$1"
    placeholder="__${var_name}__"
    value="$(printenv "$var_name" || true)"

    if [ -z "$value" ]; then
        echo "[entrypoint] aviso: $var_name não definido em runtime; placeholder permanecerá."
        return 0
    fi

    # Escapa caracteres especiais do sed (|, &, \) para usar como replacement seguro.
    escaped="$(printf '%s\n' "$value" | sed -e 's/[\\&|]/\\&/g')"

    # Substitui em todos os .js, .json e .html. Usa | como delimitador para
    # evitar conflito com URLs (que contêm /).
    find $TARGET_DIRS -type f \( -name "*.js" -o -name "*.json" -o -name "*.html" \) \
        -exec sed -i "s|${placeholder}|${escaped}|g" {} +

    echo "[entrypoint] $var_name injetado."
}

echo "[entrypoint] iniciando injeção de NEXT_PUBLIC_* em runtime..."

replace_var NEXT_PUBLIC_SUPABASE_URL
replace_var NEXT_PUBLIC_SUPABASE_ANON_KEY
replace_var NEXT_PUBLIC_SENTRY_DSN
replace_var NEXT_PUBLIC_APP_VERSION
replace_var NEXT_PUBLIC_WORKER_URL
replace_var NEXT_PUBLIC_APP_URL
replace_var NEXT_PUBLIC_INTERNAL_TOKEN

echo "[entrypoint] injeção concluída. Iniciando: $*"
exec "$@"
