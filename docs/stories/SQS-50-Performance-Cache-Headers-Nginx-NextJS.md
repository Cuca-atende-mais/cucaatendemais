# SQS-50 — Fix: Performance — Cache Headers, Nginx e Camada de Proxy

**Status:** Ready for Review
**Criado em:** 2026-05-04
**Prioridade:** 🔴 Crítica — afeta todos os usuários, todas as páginas, toda ação no sistema

---

## Contexto / Problema Relatado

Qualquer ação no portal (navegação entre páginas, submit de formulários, ações em modais) trava em loading infinito. O usuário precisa fazer `Ctrl+Shift+R` (hard reload) para o conteúdo aparecer. O comportamento é independente de página, módulo ou usuário autenticado.

**Diagnóstico externo (Claude Web) analisou o código e identificou a causa raiz corretamente.** Este time revisou o diagnóstico contra o código real e confirmou + expandiu com problemas adicionais encontrados.

---

## Diagnóstico Confirmado

### ✅ O que o diagnóstico externo acertou

| # | Problema Identificado | Confirmado no Código? |
|---|---|---|
| 1 | `nginx/default.conf` sem headers de cache | ✅ Confirmado |
| 2 | Double-proxy: Traefik (EasyPanel) → Nginx → Next.js | ✅ Confirmado |
| 3 | `next.config.ts` sem `async headers()` | ✅ Confirmado |
| 4 | `gunicorn -w 2 --timeout 120` pode causar timeout em cascata | ✅ Parcialmente (veja notas abaixo) |

### 🔴 O que o diagnóstico externo NÃO viu (problemas adicionais encontrados na revisão)

**Problema A — `proxy_no_cache` ausente no Nginx**
O `proxy_cache_bypass $http_upgrade` atual só bypassa o cache do Nginx quando há upgrade de protocolo (WebSocket). Requisições HTTP normais de página passam pelo cache sem bypass algum. Isso significa que o Nginx *pode* estar servindo respostas cacheadas do Next.js mesmo sem diretiva `proxy_cache` explícita, dependendo da configuração padrão do nginx:alpine.

**Problema B — Conflito de workers entre Dockerfile e docker-compose**
O `Dockerfile` do worker define `CMD ["gunicorn", "-w", "1", ...]`, mas o `docker-compose.yml` sobrescreve com `command: gunicorn -w 2 ...`. O docker-compose tem precedência, então em produção roda com 2 workers. Se alguém usar o Dockerfile diretamente (ex: EasyPanel build sem docker-compose), roda com apenas **1 worker** — qualquer chamada pesada (OCR, embedding) bloqueia todas as requisições.

**Problema C — Middleware do Supabase em todas as rotas → latência em cascata**
O `middleware.ts` executa `supabase.auth.getUser()` em CADA requisição que não seja `_next/static`, `_next/image` ou assets de imagem. Isso inclui todas as rotas de API internas, todas as páginas do dashboard e todas as navegações. Cada chamada ao Supabase adiciona latência de rede (VPS → Supabase cloud → VPS). Em momentos de instabilidade de rede, isso trava o carregamento antes mesmo de chegar ao Next.js.

**Problema D — TanStack Query instalado mas sem `revalidatePath` em Server Actions**
A SQS-47 instalou o TanStack Query (`QueryClientProvider` ativo em `providers.tsx` com `staleTime: 30s`). Porém, nenhuma chamada a `revalidatePath` ou `revalidateTag` foi encontrada no codebase. Isso significa que:
- Mutações via Server Actions não invalidam o cache do Data Cache do Next.js
- O TanStack Query invalida a query no client, mas o Next.js ainda pode servir HTML/RSC com dados antigos do server cache
- `refetchOnWindowFocus: true` no QueryClient causa refetch desnecessário ao trocar de aba

**Problema E — Dockerfile do portal sem stage de produção otimizado para `output: standalone`**
O `Dockerfile` do portal copia `.next/standalone` e `.next/static` corretamente, mas não copia o diretório `public`. Isso faz o Next.js servir assets públicos (favicon, logos, etc.) via server render em vez de estático — sobrecarga desnecessária.

**Problema F — `output: standalone` presente mas sem `compress: false` no Next.js**
Com o Nginx na frente fazendo compressão (`gzip` do nginx:alpine está ativo por padrão), o Next.js comprime novamente em `node server.js`. Dupla compressão degrada performance e pode corromper respostas.

---

## Causa Raiz Principal

```
Browser → Traefik (EasyPanel) → Nginx (sem headers de cache) → Next.js
                  ↑
          Traefik cacheia respostas HTML porque não recebe
          Cache-Control: no-store do Nginx nem do Next.js
```

O Traefik do EasyPanel vê respostas sem instrução de cache e aplica sua política padrão → cacheia HTML de páginas → usuário recebe HTML velho → chunks JS com hashes novos não encontrados → loading infinito → só hard reload bypassa o cache do browser/Traefik.

---

## Acceptance Criteria

- [x] **AC1** — `nginx/default.conf` atualizado (referência local; produção usa EasyPanel/Traefik sem nginx separado)
- [x] **AC2** — `next.config.ts` com `async headers()` definindo `Cache-Control: no-store` para páginas e `immutable` para `/_next/static/`
- [x] **AC3** — `next.config.ts` com `compress: false` (Traefik/EasyPanel comprime; Next.js não deve duplicar)
- [x] **AC4** — `docker-compose.yml` worker com `-w 4 --timeout 300 --graceful-timeout 30`
- [x] **AC5** — `Dockerfile` do portal já tinha `COPY --from=builder /app/public ./public` (sem alteração necessária)
- [ ] **AC6** — Middleware do Supabase com cache de sessão em memória por request (evitar `getUser()` duplicado na mesma requisição) — ou short-circuit para rotas `/api/` internas que não precisam de auth de usuário
- [ ] **AC7** — Após deploy, verificar no DevTools (Network) que respostas de página têm `Cache-Control: no-store` e assets `/_next/static/` têm `Cache-Control: immutable`
- [ ] **AC8** — Navegação entre páginas no portal funciona sem hard reload em 100% dos casos testados (login, dashboard, empregabilidade, atendimento, programação, configurações)

---

## Escopo

**IN:**
- `nginx/default.conf` — reescrita completa dos blocos de location
- `next.config.ts` — adicionar `async headers()` e `compress: false`
- `docker-compose.yml` — ajuste de workers e timeout do gunicorn
- `cuca-portal/Dockerfile` — corrigir cópia do diretório `public`
- Teste manual em produção pós-deploy

**OUT:**
- Remoção do Nginx da stack (o diagnóstico externo sugeriu, mas a remoção é arriscada e cria dependência direta no Traefik sem controle de configurações. Manter Nginx com headers corretos é mais seguro)
- Migração de módulos para TanStack Query (coberto pela SQS-47)
- Otimização do middleware de auth (AC6 é uma melhoria menor, não bloqueante para o fix principal)

---

## Arquivos Impactados

| Arquivo | Tipo de Mudança | Risco |
|---|---|---|
| `nginx/default.conf` | Reescrita de configuração | Médio — requer restart do container nginx |
| `cuca-portal/next.config.ts` | Adicionar `async headers()` e `compress` | Baixo — rebuild necessário |
| `docker-compose.yml` | Ajustar command do worker | Baixo — restart do container worker |
| `cuca-portal/Dockerfile` | Adicionar cópia do `public` | Baixo — rebuild necessário |

---

## Plano de Implementação

### Passo 1 — nginx/default.conf (impacto imediato, sem rebuild)
```nginx
upstream portal {
    server portal:3000;
}

upstream worker {
    server worker:8000;
}

server {
    listen 80;
    server_name _;

    client_max_body_size 20m;

    # Assets estáticos Next.js — imutáveis (hash no nome), cache agressivo no browser
    location /_next/static/ {
        proxy_pass http://portal;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        add_header Cache-Control "public, max-age=31536000, immutable";
        access_log off;
    }

    # HMR (dev) — WebSocket
    location /_next/webpack-hmr {
        proxy_pass http://portal;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }

    # Imagens otimizadas pelo Next.js Image Optimization
    location /_next/image {
        proxy_pass http://portal;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        add_header Cache-Control "public, max-age=86400, stale-while-revalidate=3600";
    }

    # Worker API — sem cache, respostas sempre frescas
    location /api/worker/ {
        rewrite ^/api/worker/(.*) /$1 break;
        proxy_pass http://worker;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 300;
        proxy_connect_timeout 300;
        add_header Cache-Control "no-store, no-cache, must-revalidate";
        add_header Pragma "no-cache";
    }

    # Páginas HTML, rotas Next.js, API routes — NUNCA cachear
    location / {
        proxy_pass http://portal;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_cache_bypass $http_upgrade;
        proxy_no_cache 1;   # ← instrui Nginx a não cachear internamente

        add_header Cache-Control "no-store, no-cache, must-revalidate, proxy-revalidate";
        add_header Pragma "no-cache";
        add_header Expires "0";

        proxy_read_timeout 300;
        proxy_connect_timeout 60;
        proxy_send_timeout 300;
    }
}
```

### Passo 2 — next.config.ts (requer rebuild do portal)
```typescript
import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  output: "standalone",
  compress: false, // Nginx comprime — evitar dupla compressão

  async headers() {
    return [
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      },
      {
        source: "/_next/image(.*)",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400, stale-while-revalidate=3600" }],
      },
      {
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

  logging: { fetches: { fullUrl: true } },
};

export default withSentryConfig(nextConfig, {
  org: "cuca-atende",
  project: "cuca-portal",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: true,
  disableLogger: true,
  hideSourceMaps: true,
});
```

### Passo 3 — docker-compose.yml worker
```yaml
command: gunicorn -w 4 -k uvicorn.workers.UvicornWorker main:app --bind 0.0.0.0:8000 --timeout 300 --graceful-timeout 30
```

### Passo 4 — Dockerfile do portal (adicionar linha faltante)
```dockerfile
COPY --from=builder /app/public ./public   # ← linha que falta
```

---

## Sequência de Deploy (sem downtime)

```bash
git pull

# Passo 1: Nginx — sem rebuild (reinicia em <5s)
docker compose restart nginx

# Passo 2 e 4: Portal — rebuild completo (~3-5min)
docker compose up -d --build portal

# Passo 3: Worker — restart simples
docker compose up -d worker
```

---

## Riscos e Mitigações

| Risco | Probabilidade | Mitigação |
|---|---|---|
| Cache do Traefik (EasyPanel) ignorar os headers | Média | Verificar no EasyPanel se há cache habilitado na app; desativar |
| Rebuild do portal falhar por ARG de build não configurado | Baixa | Verificar `NEXT_PUBLIC_*` nas env vars do EasyPanel |
| Aumento de workers do worker causar consumo de RAM | Baixa | VPS Hostinger tem RAM suficiente para 4 uvicorn workers |
| `compress: false` no Next.js sem gzip no Nginx | Baixa | nginx:alpine tem gzip ativo por padrão; confirmar com `nginx -T | grep gzip` |

---

## Problemas Futuros a Monitorar (não bloqueiam esta story)

1. **Middleware de auth em `/api/` internas** — cada endpoint interno faz `getUser()` desnecessariamente; candidato para um curto-circuito baseado em service key
2. **TanStack Query `refetchOnWindowFocus: true`** — ao trocar de aba (ex: abrir WhatsApp Web, voltar ao portal), todos os dados são refetchados simultaneamente — pode ser reduzido para `false` ou com `focusThrottleInterval`
3. **Ausência de `revalidatePath` em mutações** — quando Server Actions forem usadas no futuro, precisam chamar `revalidatePath` para invalidar o Data Cache do Next.js
4. **Conflito de workers no Dockerfile do worker** — padronizar o CMD do Dockerfile com os valores do docker-compose para evitar divergência em deploys diretos por imagem

---

## File List

- [x] `nginx/default.conf` — ✅ Configuração local de referência (não utilizado em produção/EasyPanel)
- [x] `cuca-portal/next.config.ts` — ✅ `async headers()` + `compress: false` implementados (2026-05-04)
- [x] `docker-compose.yml` — ✅ worker: `-w 4 --timeout 300 --graceful-timeout 30` (2026-05-04)
- [x] `cuca-portal/Dockerfile` — ✅ `COPY public` já presente (sem alteração necessária)

## Log de Execução

### Passo 1 — nginx/default.conf (2026-05-04)
- Reescrita completa: adicionados blocos `/_next/static/`, `/_next/webpack-hmr`, `/_next/image`, `/api/worker/` e `/`
- `proxy_no_cache 1` adicionado no bloco `/` para instruir o Nginx a não cachear internamente
- Headers `Cache-Control: no-store` em páginas e `immutable` em assets estáticos
- **Deploy:** `docker compose restart nginx` (sem rebuild necessário)
- **Status:** ⏳ Aguardando validação em produção
