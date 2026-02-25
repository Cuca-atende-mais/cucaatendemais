"use client";

// Componente responsável por inicializar o Sentry no lado cliente.
// Necessário no Next.js 16 + Turbopack porque o webpack plugin do Sentry
// não roda com Turbopack, impedindo a injeção automática do sentry.client.config.ts.
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

const SENTRY_DSN = "https://66d09daa120c1a5559c7af2ad28f8141@o4510948356653056.ingest.de.sentry.io/4510948592582736";

export function SentryInitializer() {
    useEffect(() => {
        // Inicializa apenas uma vez, evita redcalls em HMR
        if (Sentry.getClient()) return;

        Sentry.init({
            dsn: SENTRY_DSN,
            tracesSampleRate: 0.1,
            replaysSessionSampleRate: 0.05,
            replaysOnErrorSampleRate: 1.0,
            integrations: [
                Sentry.replayIntegration({
                    maskAllText: false,
                    blockAllMedia: false,
                }),
            ],
            sendDefaultPii: false,
        });
    }, []);

    return null; // Sem UI
}
