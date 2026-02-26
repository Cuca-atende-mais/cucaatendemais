"use client";

// Inicializa o Sentry no lado cliente (browser).
// Necessário como Client Component porque o Turbopack do Next.js 16
// não executa o webpack plugin que normalmente injeta sentry.client.config.ts.
import { useEffect, useRef } from "react";

const SENTRY_DSN = "https://66d09daa120c1a5559c7af2ad28f8141@o4510948356653056.ingest.de.sentry.io/4510948592582736";

export function SentryInitializer() {
    const initialized = useRef(false);

    useEffect(() => {
        if (initialized.current) return;
        initialized.current = true;

        // Import dinâmico para garantir que roda apenas no browser
        import("@sentry/nextjs").then((Sentry) => {
            // Verifica se já foi inicializado por outro caminho
            if (Sentry.getClient()) {
                console.log("[Sentry] Já inicializado");
                return;
            }

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
                debug: true, // Temporário: mostra logs no console
            });

            console.log("[Sentry] Inicializado com sucesso, client:", !!Sentry.getClient());
        }).catch((err) => {
            console.error("[Sentry] Erro ao inicializar:", err);
        });
    }, []);

    return null;
}
