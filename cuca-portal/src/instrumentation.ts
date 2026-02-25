// instrumentation.ts
// Arquivo necessário para o Next.js App Router inicializar o Sentry no servidor.
// Ref: https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

import * as Sentry from "@sentry/nextjs";

export async function register() {
    if (process.env.NEXT_RUNTIME === "nodejs") {
        // Inicializa Sentry no servidor Node.js (Server Components, API Routes)
        Sentry.init({
            dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
            tracesSampleRate: 0.1,
            sendDefaultPii: false,
        });
    }

    if (process.env.NEXT_RUNTIME === "edge") {
        // Inicializa Sentry no Edge Runtime (middleware)
        Sentry.init({
            dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
            tracesSampleRate: 0.1,
            sendDefaultPii: false,
        });
    }
}

// Captura erros de request HTTP (404, 500, etc.) no App Router
export const onRequestError = Sentry.captureRequestError;
