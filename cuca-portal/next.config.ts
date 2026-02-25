import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  output: "standalone",
};

// Configuração do Sentry para o bundler Next.js
// Docs: https://docs.sentry.io/platforms/javascript/guides/nextjs/
export default withSentryConfig(nextConfig, {
  // Organização e projeto no Sentry (preencher após criar o projeto)
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,

  // Auth token para upload de source maps (necessário para stack traces legíveis)
  // Gere em: https://sentry.io/orgredirect/organizations/:orgslug/settings/auth-tokens/
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Silencia logs do Sentry durante o build
  silent: !process.env.CI,

  // Upload de source maps habilitado apenas em produção
  sourcemaps: {
    disable: process.env.NODE_ENV !== "production",
  },

  // Não abre o browser automaticamente durante o build
  autoInstrumentServerFunctions: true,

  // Desabilita o wizard interativo do Sentry no build
  disableLogger: true,

  // Tunnel para evitar bloqueio de ad-blockers
  tunnelRoute: "/monitoring",
});
