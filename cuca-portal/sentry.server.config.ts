// sentry.server.config.ts
// Execute no servidor Node.js (Server Components, API Routes, Server Actions)
import * as Sentry from "@sentry/nextjs";

Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

    // Captura 10% das transações de servidor
    tracesSampleRate: 0.1,

    // Habilita apenas em produção
    enabled: process.env.NODE_ENV === "production",

    environment: process.env.NODE_ENV,

    release: process.env.NEXT_PUBLIC_APP_VERSION ?? "1.0.0",
});
