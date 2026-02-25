// sentry.client.config.ts — Captura erros no browser (client components)
import * as Sentry from "@sentry/nextjs";

Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

    // 10% das transações para performance monitoring
    tracesSampleRate: 0.1,

    // Replay: captura reprodução visual das sessões com erro
    replaysSessionSampleRate: 0.05,
    replaysOnErrorSampleRate: 1.0,

    integrations: [
        Sentry.replayIntegration({
            maskAllText: false,
            blockAllMedia: false,
        }),
    ],

    // Não capturar dados pessoais (tokens, senhas)
    sendDefaultPii: false,
});
