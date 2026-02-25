// sentry.client.config.ts
// Execute no navegador (componentes client-side)
import * as Sentry from "@sentry/nextjs";

Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

    // Performance monitoring
    tracesSampleRate: 0.1, // 10% das transações em produção

    // Session Replay — captura reprodução dos erros
    replaysSessionSampleRate: 0.05, // 5% das sessões normais
    replaysOnErrorSampleRate: 1.0,  // 100% das sessões com erro

    integrations: [
        Sentry.replayIntegration({
            // Mascara dados sensíveis automaticamente
            maskAllText: false,
            blockAllMedia: false,
        }),
    ],

    // Habilita apenas em produção
    enabled: process.env.NODE_ENV === "production",

    // Rótulo do ambiente
    environment: process.env.NODE_ENV,

    // Identifica a release (útil para rastrear quando o bug foi introduzido)
    release: process.env.NEXT_PUBLIC_APP_VERSION ?? "1.0.0",

    // Não captura erros de console.log, apenas exceções reais
    beforeSend(event) {
        // Ignora erros de rede comuns (ex: usuário offline)
        if (event.exception?.values?.[0]?.type === "NetworkError") {
            return null;
        }
        return event;
    },
});
