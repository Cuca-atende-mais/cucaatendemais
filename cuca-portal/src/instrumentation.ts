// instrumentation.ts — necessário para Next.js App Router inicializar Sentry no servidor
import * as Sentry from "@sentry/nextjs";

// DSN fixo: Easypanel não passa build-args ao docker build,
// então variáveis NEXT_PUBLIC_ ficam vazias no bundle mesmo configuradas no painel
const SENTRY_DSN = "https://66d09daa120c1a5559c7af2ad28f8141@o4510948356653056.ingest.de.sentry.io/4510948592582736";

export async function register() {
    if (process.env.NEXT_RUNTIME === "nodejs") {
        Sentry.init({
            dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || SENTRY_DSN,
            tracesSampleRate: 0.1,
            sendDefaultPii: false,
        });
    }

    if (process.env.NEXT_RUNTIME === "edge") {
        Sentry.init({
            dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || SENTRY_DSN,
            tracesSampleRate: 0.1,
            sendDefaultPii: false,
        });
    }
}

// Captura erros 404, 500 etc. do App Router automaticamente
export const onRequestError = Sentry.captureRequestError;
