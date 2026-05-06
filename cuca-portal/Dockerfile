FROM node:20-alpine AS base

# Install ALL dependencies (including dev for build)
FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# Build
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1

# SQS-51 (A4): EasyPanel não expõe --build-arg na UI. Build com placeholders;
# o entrypoint do container substitui pelos valores reais em runtime
# (Variáveis de Ambiente do EasyPanel).
ENV NEXT_PUBLIC_SUPABASE_URL=__NEXT_PUBLIC_SUPABASE_URL__
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=__NEXT_PUBLIC_SUPABASE_ANON_KEY__
ENV NEXT_PUBLIC_SENTRY_DSN=__NEXT_PUBLIC_SENTRY_DSN__
ENV NEXT_PUBLIC_APP_VERSION=__NEXT_PUBLIC_APP_VERSION__
ENV NEXT_PUBLIC_WORKER_URL=__NEXT_PUBLIC_WORKER_URL__
ENV NEXT_PUBLIC_APP_URL=__NEXT_PUBLIC_APP_URL__
ENV NEXT_PUBLIC_INTERNAL_TOKEN=__NEXT_PUBLIC_INTERNAL_TOKEN__

RUN npm run build


# Production
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# SQS-51 (A4): entrypoint substitui placeholders pelos valores reais antes
# de iniciar o servidor Next.js.
COPY --chown=nextjs:nodejs docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

USER nextjs
EXPOSE 3000

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "server.js"]
