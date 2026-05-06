# SQS-51 — Empregabilidade: Loops Infinitos, Falhas ao Salvar e Perda de Dados

**Status:** Draft
**Tipo:** Bugfix crítico (P0)
**Epic:** Sprint 37 (estabilização produção)
**Owner sugerido:** @dev (com gate de @qa antes de push)
**Branch sugerida:** `fix/sqs-51-empregabilidade-loops`

---

## 1. Contexto

Cliente em produção (CUCA Atende Mais, VPS Hostinger KVM4 + EasyPanel) reporta no módulo **Empregabilidade**:

- páginas que travam em "loading" infinito;
- formulário de currículo que fica "salvando" e nunca conclui;
- perda de dados ao tentar salvar;
- dashboard de empregabilidade que não carrega.

Volume atual no Supabase (project `svzkrkfzpiqcesloukgb`): `talent_bank=658`, `curriculos=6`, `vagas=2`, `candidaturas=3`. **Volume é irrisório** — a hipótese de saturação de VPS/Banco está descartada. KVM4 com Postgres remoto (Supabase) suporta ordens de magnitude a mais.

**Diagnóstico:** problema é de **código + configuração de deploy**, não de infra.

Esta story consolida e expande o levantamento prévio feito por outra IA, validando cada achado contra o código atual e logs reais do Postgres.

---

## 2. Evidências validadas (logs Postgres últimas 24h via MCP)

```
ERROR  column vagas_1.empresa_nome does not exist           (2 ocorrências recentes)
ERROR  new row violates row-level security policy for table "talent_bank"   (2 ocorrências recentes)
```

Sem sinal de saturação, sem timeouts de checkpoint anormais, sem deadlocks. Apenas erros funcionais.

---

## 3. Achados (validados)

### A1. RLS bloqueia criação de candidato pelo browser  — **CRÍTICO**

- Arquivo: `cuca-portal/src/app/(dashboard)/empregabilidade/criar-curriculo/page.tsx:128`
- Código faz `supabase.from("talent_bank").insert(...)` direto do **client component**.
- Policy real (consultada agora):
  ```sql
  -- talent_bank: "Colaboradores autenticados podem gerenciar..."
  -- USING/WITHCHECK: EXISTS (SELECT 1 FROM colaboradores WHERE colaboradores.user_id = auth.uid())
  ```
- Se a sessão estiver expirada, o usuário não estiver registrado em `colaboradores`, ou o cliente Supabase do browser não tiver `NEXT_PUBLIC_SUPABASE_*` válidas (ver A4), o INSERT é rejeitado com a mensagem que aparece nos logs. Para o usuário, o toast genérico aparece e os dados se "perdem".

### A2. Editor de currículo entra em loop de loading infinito — **CRÍTICO**

- Arquivo: `cuca-portal/src/app/(dashboard)/empregabilidade/criar-curriculo/[id]/page.tsx:162-198`
- `init()` não tem `try/catch/finally` e só chama `setLoadingInit(false)` no caminho feliz (linha 195).
- Se a query a `talent_bank` ou `curriculos` falhar (rede, RLS, env ausente, timeout), `setLoadingInit(false)` nunca executa e o spinner roda eternamente.
- Adicionalmente, o `useEffect` tem dependência apenas `[talentId]` mas usa `reset` do react-hook-form e `router` — risco de stale closure (eslint exhaustive-deps deve estar suprimido).

### A3. Analytics consulta coluna inexistente — **ALTO**

- Arquivo: `cuca-portal/src/app/api/empregabilidade/analytics/route.ts:42`
- Query: `.select("vaga_id, vagas(titulo, empresa_nome)")`
- Verificado em `information_schema.columns`: tabela `vagas` tem **`empresa_id` (uuid)**, não `empresa_nome`. Confere com migrations: nenhuma cria `empresa_nome` em `vagas`.
- Resultado: `Promise.all` no analytics derruba **todo** o painel (uma rejeição mata todas as métricas paralelas), gerando o erro do log e dashboard vazio.

### A4. Build do Next.js não recebe NEXT_PUBLIC_* — **CRÍTICO**

- Arquivo: `cuca-portal/Dockerfile:17-26` declara `ARG` e `ENV` para `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SENTRY_DSN`, `NEXT_PUBLIC_APP_VERSION`, `NEXT_PUBLIC_WORKER_URL`.
- Arquivo: `docker-compose.yml:4-15` (root) só passa as vars em `environment:` — **não em `build.args:`**.
- Next.js inlina `NEXT_PUBLIC_*` em **build time**. Sem build-args, o bundle do browser sai com strings vazias / undefined → cliente Supabase do browser não consegue autenticar → todas as chamadas client-side falham silenciosamente ou caem em RLS (A1) e/ou no loop (A2).
- **No EasyPanel:** confirmar que as variáveis estão configuradas em **Build Variables**, não só em **Environment**, ou ajustar o build para receber via `build.args` no manifest do EasyPanel.

### A5. Portal sem `SUPABASE_SERVICE_ROLE_KEY` no compose — **ALTO**

- 25 referências a `SUPABASE_SERVICE_ROLE_KEY` em `cuca-portal/src/app/api/` (rotas server-side privilegiadas: `vagas`, `candidaturas`, `talent-bank`, `enviar-cv-lote`, `triar-banco-talentos`, `selecao`, etc.).
- `docker-compose.yml` do portal não injeta a variável. Se o EasyPanel não estiver injetando manualmente, **todas essas APIs retornam 500** e o frontend acaba ou em loading infinito (A2) ou em toasts genéricos. Validar configuração no EasyPanel.

### A6. Middleware libera todo `/empregabilidade` como público — **ALTO (segurança + funcional)**

- Arquivo: `cuca-portal/src/lib/supabase/middleware.ts:46`
- Regra: `pathname.startsWith('/empregabilidade')` → marca como rota pública.
- **Mas** existem dois conjuntos de rotas com mesmo prefixo:
  - `cuca-portal/src/app/(dashboard)/empregabilidade/...` (internas, exigem auth: banco-talentos, candidatos, categorias, criar-curriculo, empresas, mensagens, vagas)
  - `cuca-portal/src/app/empregabilidade/...` (públicas: candidatura, print, selecao, vagas)
- Como Route Groups `(dashboard)` somem da URL, **ambos resolvem para `/empregabilidade/*`** e o middleware deixa todos passar sem auth.
- Consequência funcional: usuário sem sessão consegue abrir `/empregabilidade/criar-curriculo` → o cliente Supabase no browser sem JWT tenta INSERT em `talent_bank` → cai em RLS (A1) → toast erro / dados perdidos.
- Consequência de segurança: páginas internas (banco de talentos, candidatos, mensagens) acessíveis sem login — exposição de PII.

### A7. Token Supabase versionado em `.mcp.json` — **SEGURANÇA**

- Levantamento anterior aponta token de acesso em `.mcp.json:6`. **Rotacionar imediatamente** e remover do versionamento. Mover para `.mcp.local.json` (gitignored) ou variável de ambiente do Claude Code.

---

## 4. Achados adicionais (não vistos pelo levantamento prévio)

### A8. Outras `useEffect`/init sem `finally` no módulo

A mesma anti-pattern de A2 (fetch sem `try/finally`) deve ser auditada em:
- `cuca-portal/src/app/(dashboard)/empregabilidade/criar-curriculo/page.tsx` — `fetchCurriculos` chama `setLoading(false)` apenas no caminho final, mas há um `await` com tratamento de erro razoável; ainda assim, exceções em runtime (rede caindo) deixam o estado preso.
- Banco de talentos, candidatos, vagas — auditar todos os `useEffect` que setam loading.

**Padrão alvo:**
```ts
const init = async () => {
  try {
    // ... fetches
  } catch (e) {
    console.error(e); toast.error("Falha ao carregar.");
    router.back(); // ou estado de erro renderizável
  } finally {
    setLoadingInit(false);
  }
}
```

### A9. Risco de loop de re-render em `useEffect` com `reset`

`reset` do react-hook-form é estável, mas `router` não está nas deps em `[id]/page.tsx:198`. Acrescentar regra ESLint `react-hooks/exhaustive-deps` ou listar deps corretamente.

### A10. Sem timeout no client Supabase do browser

Se a VPS estiver com latência intermitente para `*.supabase.co`, requests do browser podem ficar pendurados sem timeout. Considerar `AbortController` com timeout (15s) nos fetches críticos do editor de currículo.

### A11. `SECURITY DEFINER` em RPCs — auditar

Quando a tela tem que criar `talent_bank` a partir do dashboard interno, a alternativa correta para contornar o overhead de RLS sem ampliar policies é uma **RPC `SECURITY DEFINER`** que valide `auth.uid()` ∈ `colaboradores` antes de inserir. Recomendar essa migração em vez de quebrar RLS.

### A12. Falta de Sentry/observabilidade efetiva

`NEXT_PUBLIC_SENTRY_DSN` está no Dockerfile mas, se A4 vale, o DSN nunca chega no bundle. Resultado: erros do browser não chegam ao Sentry — daí a dificuldade de diagnosticar remotamente. Corrigir A4 já restaura observabilidade.

---

## 5. Plano de correção (Acceptance Criteria)

> **Princípio:** corrigir do mais barato/maior impacto para o mais caro. A4+A6 sozinhos provavelmente derrubam a maioria dos sintomas.

### AC1 — Deploy/Config (resolve A4, A5, A7)

- [ ] Adicionar `build.args` ao manifest de deploy (EasyPanel) **ou** a `docker-compose.yml` para o serviço `portal`, repassando todas as `NEXT_PUBLIC_*` no build.
- [ ] Garantir injeção de `SUPABASE_SERVICE_ROLE_KEY` (runtime) no portal via EasyPanel. Validar com `docker exec cuca-portal env | grep SUPABASE`.
- [ ] Rotacionar token Supabase em `.mcp.json`; mover para `.mcp.local.json` ou env; adicionar ao `.gitignore`.
- [ ] Documentar variáveis obrigatórias em `cuca-portal/.env.example` (já existe — auditar completude).

### AC2 — Middleware de auth (resolve A6)

- [ ] Em `cuca-portal/src/lib/supabase/middleware.ts:46`, **substituir** `pathname.startsWith('/empregabilidade')` pela lista exata das rotas públicas:
  ```ts
  const publicEmpregabilidade = [
    '/empregabilidade/vagas',           // pública
    '/empregabilidade/candidatura',
    '/empregabilidade/print',
    '/empregabilidade/selecao',
  ]
  const isPublicEmpregabilidade = publicEmpregabilidade.some(p => pathname.startsWith(p))
  ```
- [ ] Validar manualmente que cada rota pública continua acessível anonimamente e cada rota interna redireciona para `/login`.
- [ ] Adicionar teste e2e (Playwright) cobrindo: rota pública anônima, rota interna anônima → redirect, rota interna autenticada → 200.

### AC3 — Analytics (resolve A3)

- [ ] Em `cuca-portal/src/app/api/empregabilidade/analytics/route.ts:42`, trocar:
  ```ts
  .select("vaga_id, vagas(titulo, empresa_nome)")
  ```
  por:
  ```ts
  .select("vaga_id, vagas(titulo, empresa_id, empresas(nome))")
  ```
  e ajustar o consumidor para ler `vagas.empresas.nome`. Alternativa: armazenar `empresa_nome` denormalizado em `vagas` via trigger se for hot-path.
- [ ] Envolver cada query do `Promise.all` em `Promise.allSettled` para uma falha não derrubar todo o painel.

### AC4 — Editor de currículo (resolve A2)

- [ ] Em `cuca-portal/src/app/(dashboard)/empregabilidade/criar-curriculo/[id]/page.tsx:162`, refatorar `init()` para `try/catch/finally` com `setLoadingInit(false)` no `finally`.
- [ ] Tratar `error` retornado por `supabase.from(...).single()` (hoje só desestrutura `data`).
- [ ] Adicionar timeout (AbortController, 15s) nos fetches.
- [ ] Estado de erro renderizável (não só toast + redirect).

### AC5 — Criação de candidato com SECURITY DEFINER (resolve A1, raiz)

- [ ] Criar migration com função RPC `criar_candidato_e_curriculo(nome, telefone, data_nascimento, area)` `SECURITY DEFINER` que:
  - valida `EXISTS (SELECT 1 FROM colaboradores WHERE user_id = auth.uid())` (mesma check da policy);
  - insere em `talent_bank` e `curriculos` em transação;
  - retorna `talent_id`.
- [ ] Atualizar `criar-curriculo/page.tsx:128` para chamar `supabase.rpc('criar_candidato_e_curriculo', ...)` em vez de 2 INSERTs separados.
- [ ] Manter policy atual (não relaxar RLS).

### AC6 — Auditoria de loops em outras telas (resolve A8)

- [ ] Audit `cuca-portal/src/app/(dashboard)/empregabilidade/**/page.tsx` para `useEffect` com fetch + setLoading. Aplicar padrão `try/finally`.

### AC7 — Observabilidade (resolve A12)

- [ ] Após AC1, validar que erros do browser chegam ao Sentry.
- [ ] Adicionar log estruturado nas APIs de empregabilidade (request id + user id + stack).

---

## 6. Riscos e mitigação

| Risco | Mitigação |
|-------|-----------|
| Mudar middleware quebra rota pública existente | AC2 inclui smoke test manual + e2e antes do push |
| RPC `SECURITY DEFINER` mal escrita ⇒ bypass de RLS | Validar `auth.uid()` na função; @qa revisar antes de aplicar migration |
| Variáveis `NEXT_PUBLIC_*` configuradas no EasyPanel mas só em runtime ⇒ build continua quebrado | AC1 requer validação concreta: `docker logs` do build mostrando vars + checagem do bundle (`grep` por URL no `.next/standalone`) |
| Cliente em produção durante a correção | Deploy em janela; rollback via tag git anterior |

---

## 7. Estratégia de validação

1. **Reproduzir local** (com `.env` apontando para Supabase de homologação): criar candidato → editor abre → salvar funciona → analytics carrega.
2. **Deploy em staging** no EasyPanel (clonar serviço): repetir fluxo.
3. **Smoke em produção** após deploy: criar candidato de teste, abrir editor, salvar, abrir dashboard de empregabilidade.
4. **Monitorar Postgres logs** por 24h: zero ocorrências de `empresa_nome does not exist` e `violates row-level security`.

---

## 8. Pendências / Perguntas para o usuário

- [ ] Confirmar quais `NEXT_PUBLIC_*` e `SUPABASE_SERVICE_ROLE_KEY` estão atualmente configurados no EasyPanel (pedir screenshot da aba Environment + Build).
- [ ] Confirmar se o cliente está logado quando reproduz o erro, ou se está acessando via link direto.
- [ ] Capturar `console` do browser (rede + erros) durante a falha — fechará o diagnóstico definitivamente.

---

## 9. File List (preencher durante implementação)

- [ ] `cuca-portal/src/lib/supabase/middleware.ts`
- [ ] `cuca-portal/src/app/(dashboard)/empregabilidade/criar-curriculo/[id]/page.tsx`
- [ ] `cuca-portal/src/app/(dashboard)/empregabilidade/criar-curriculo/page.tsx`
- [ ] `cuca-portal/src/app/api/empregabilidade/analytics/route.ts`
- [ ] `docker-compose.yml`
- [ ] `cuca-portal/Dockerfile` (se necessário)
- [ ] `supabase/migrations/<timestamp>_rpc_criar_candidato_e_curriculo.sql`
- [ ] `.mcp.json` / `.gitignore`

---

## 10. Resumo executivo (1 parágrafo)

A causa-raiz dos travamentos no módulo Empregabilidade é uma **combinação de configuração de deploy quebrada (NEXT_PUBLIC_* não chegam no build, SERVICE_ROLE_KEY ausente) com um middleware permissivo demais que faz o app expor páginas internas sem sessão**, o que dispara violações de RLS no `talent_bank` e quebra os formulários. A isso se somam dois bugs pontuais — `init()` sem `finally` no editor (gera o spinner infinito) e uma coluna inexistente (`vagas.empresa_nome`) na rota de analytics. **Não é VPS, não é volume de dados, não é Supabase.** A KVM4 está superdimensionada para o volume atual (658 talentos, 6 currículos). Com AC1+AC2+AC3+AC4 deployados, o usuário deve ver os sintomas desaparecerem; AC5 endurece a raiz do problema de RLS.
