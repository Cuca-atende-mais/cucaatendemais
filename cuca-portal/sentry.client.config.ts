// sentry.client.config.ts — Captura erros no browser (client components)
import * as Sentry from "@sentry/nextjs";

// DSN é valor público — pode e deve ser fixado no código para ambientes Docker
// onde build args não são passados pelo Easypanel
const SENTRY_DSN = "https://66d09daa120c1a5559c7af2ad28f8141@o4510948356653056.ingest.de.sentry.io/4510948592582736";

Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || SENTRY_DSN,

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
