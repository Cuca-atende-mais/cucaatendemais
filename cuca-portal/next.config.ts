import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  output: "standalone",
  compress: false, // Traefik (EasyPanel) comprime — evitar dupla compressão

  async headers() {
    return [
      {
        // Assets com hash no nome — imutáveis, cache agressivo no browser
        source: "/_next/static/:path*",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
        ],
      },
      {
        // Imagens otimizadas pelo Next.js Image Optimization
        source: "/_next/image(.*)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=3600" },
        ],
      },
      {
        // Páginas HTML e rotas de API — nunca cachear (Traefik não deve reter)
        source: "/(.*)",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate, proxy-revalidate" },
          { key: "Pragma", value: "no-cache" },
          { key: "Expires", value: "0" },
          { key: "Surrogate-Control", value: "no-store" },
        ],
      },
    ];
  },
};

export default withSentryConfig(nextConfig, {
  org: "cuca-atende",
  project: "cuca-portal",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  disableLogger: true,
  hideSourceMaps: true,
});
