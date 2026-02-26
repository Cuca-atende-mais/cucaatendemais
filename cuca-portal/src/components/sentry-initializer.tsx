"use client";

import { useEffect, useRef } from "react";

const SENTRY_DSN = "https://66d09daa120c1a5559c7af2ad28f8141@o4510948356653056.ingest.de.sentry.io/4510948592582736";

export function SentryInitializer() {
    const initialized = useRef(false);

    useEffect(() => {
        if (initialized.current) return;
        initialized.current = true;

        import("@sentry/nextjs").then((Sentry) => {
            if (Sentry.getClient()) return;

            Sentry.init({
                dsn: SENTRY_DSN,
                tracesSampleRate: 1.0, // 100% para garantir visibilidade inicial
                replaysSessionSampleRate: 0.1,
                replaysOnErrorSampleRate: 1.0,
                integrations: [
                    Sentry.replayIntegration({
                        maskAllText: false,
                        blockAllMedia: false,
                    }),
                ],
                sendDefaultPii: false,
                environment: "production",
                release: "cuca-portal@1.0.0",
            });
        });
    }, []);

    return null;
}
