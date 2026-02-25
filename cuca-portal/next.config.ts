import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  output: "standalone",
};

export default withSentryConfig(nextConfig, {
  // Organização e projeto no Sentry
  org: "cuca-atende",
  project: "cuca-portal",

  // Auth token para upload de source maps
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Silencia o output verbose do Sentry durante o build
  silent: true,

  // Desativa source maps em desenvolvimento (ativa apenas no build de produção)
  sourcemaps: {
    disable: false,
  },

  // Oculta logs do Sentry no terminal
  disableLogger: true,
});
