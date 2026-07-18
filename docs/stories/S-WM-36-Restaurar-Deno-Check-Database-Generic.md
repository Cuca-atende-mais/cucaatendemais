# S-WM-36 — Restaurar `deno check` funcional no `motor-agente` (gerar tipos do Supabase)

## Status
Ready for Review

## Origem
Auditoria independente `motor-agente` (sócio + skill `improve`, 2026-07-16) — achado DX-01, Plano 001. Diagnóstico e verificação cruzada: `docs/qa/DIAGNOSTICO-motor-agente-2026-07-18.md`. Base de código: **`origin/main`** (commit `99f4395`, decisão do sócio — ver diagnóstico, seção "Decisões Finais").

## Complexidade
**M** — mecânico (gerar tipos + plugar generic), mas o arquivo (`index.ts`, 1619 linhas) é o motor conversacional em produção do canal Institucional. Qualquer erro residual de tipo real que aparecer depois do fix é achado novo, não desta story.

## Prioridade
P1 — primeira da leva. Restaura a rede de segurança de tipos que todas as demais stories desta leva (S-WM-37 em diante) se beneficiam.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - deno check supabase/functions/motor-agente/index.ts → hoje 75 erros (confirmado em origin/main@99f4395), meta: exit 0 ou lista fechada de erros REAIS reportados como achado separado
  - deno test --no-check --allow-env --allow-read --allow-net . → 153 passed, 0 failed, 2 ignored (baseline confirmada em origin/main@99f4395) — não pode regredir
  - npx supabase gen types typescript --project-id cucaatendemais --schema public → gera supabase/functions/motor-agente/database.types.ts
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** que `deno check` pare de acusar 75 erros de tipo no `motor-agente`,
**para que** o typecheck volte a ser um sinal confiável (hoje qualquer regressão de tipo nova se perde no meio do ruído) e a suíte de testes deixe de depender de `--no-check`.

## Contexto e Problema

`createClient(...)` (`index.ts:1064`) e as 8 ocorrências de `ReturnType<typeof createClient>` (linhas 183, 770, 839, 924, 951, 995, 1029, 1053) são declarados **sem o generic `Database`**. Sem ele, `supabase-js` v2 infere `never` para o retorno de qualquer `.update()`/`.insert()`, causando os 75 erros hoje (`TS2339`, `TS2345`, `TS18047`, `TS2353`). Não são 75 bugs distintos — é 1 causa raiz. Não existe `database.types.ts` (ou equivalente) em nenhum lugar do repo hoje.

## Escopo

### IN
1. Gerar `supabase/functions/motor-agente/database.types.ts` via `supabase gen types typescript --project-id cucaatendemais --schema public` (requer `supabase login`/`SUPABASE_ACCESS_TOKEN` — se falhar por auth, PARAR e reportar, não inventar tipos manualmente).
2. Importar `import type { Database } from "./database.types.ts";`.
3. Trocar as 8 ocorrências de `ReturnType<typeof createClient>` por `ReturnType<typeof createClient<Database>>` (linhas 183, 770, 839, 924, 951, 995, 1029, 1053 — reconfirmar com `grep -n "ReturnType<typeof createClient>" index.ts` antes de editar, pois a numeração pode ter mudado desde 2026-07-18).
4. Trocar `createClient(...)` por `createClient<Database>(...)` na linha 1064.
5. Rodar `deno check index.ts`. A maioria dos 75 erros deve desaparecer. Se sobrar algum erro **real** (não é `never`-typed, ex.: campo nullable mal tratado), documentar como achado separado — **não corrigir lógica de negócio nesta story** e não usar `as any`/`@ts-ignore` para calar o erro.

### OUT
- Qualquer erro de tipo real que sobrar após o Passo 5 — reportar, não corrigir aqui.
- `index.test.ts`/`index.audit.test.ts` — continuam rodando com `--no-check`, não precisam mudar.
- Qualquer outra Edge Function do repo (mesmo padrão, se existir) — fora de escopo.
- Deploy automático.

## Acceptance Criteria

1. **Given** `supabase/functions/motor-agente/database.types.ts` gerado, **when** inspecionado, **then** contém `export type Database = { public: { Tables: { ... } } }` válido, não vazio.
2. **Given** o client tipado (`createClient<Database>`), **when** `deno check index.ts` roda, **then** sai com exit 0 **ou** a lista de erros reais restantes está documentada explicitamente no Dev Agent Record (não escondida).
3. **Given** a suíte completa, **when** `deno test --no-check --allow-env --allow-read --allow-net .` roda, **then** continua `0 failed` (mesma contagem de `passed` da baseline, 153, ou mais se outra story desta leva já rodou antes).
4. **Given** o código final, **when** `grep -n "ReturnType<typeof createClient>" index.ts` roda, **then** só retorna ocorrências com `<Database>` explícito.
5. Nenhum arquivo fora do escopo listado foi modificado (`git status` limpo pra qualquer coisa além de `index.ts`, `database.types.ts`, e possivelmente `deno.json` se precisar de import map).
6. Nenhum deploy é executado por esta story.

## Tasks / Subtasks

- [x] **Task 1 — Gerar tipos** (AC: 1)
  - [x] Gerado via `mcp__supabase__generate_typescript_types` (equivalente ao `supabase gen types` do plano — MCP evita depender de `supabase login` local; operação read-only, sem risco de drift). `database.types.ts` criado (110.351 bytes), confirmado `Database`/`Json` exportados e tabelas reais presentes (`conversas`, `leads`, `mensagens`).
- [x] **Task 2 — Tipar o client** (AC: 2, 4)
  - [x] Import `import type { Database } from "./database.types.ts";` adicionado.
  - [x] 8 ocorrências de `ReturnType<typeof createClient>` → `<Database>` (linhas 183, 770, 839, 924, 951, 995, 1029, 1053 — bateram exatamente com a numeração da story).
  - [x] `createClient(...)` → `createClient<Database>(...)` na linha 1064.
  - [x] `deno check index.ts`: 75 → 36 erros.
- [x] **Task 3 — Triagem de erros residuais** (AC: 2)
  - [x] 36 erros documentados em Dev Agent Record, categorizados em 6 causas-raiz — nenhuma corrigida (fora de escopo desta story, ver AC2/STOP condition).
- [x] **Task 4 — Regressão** (AC: 3, 5)
  - [x] `deno test --no-check ...`: 153 passed, 0 failed, 2 ignored — idêntico à baseline, sem regressão.
  - [x] `git status`: só `index.ts` (modificado) e `database.types.ts` (novo) — escopo respeitado.

## Dev Notes

- Baseline confirmada em `origin/main@99f4395` (worktree isolado, 2026-07-18): `deno check` → 75 erros, mesma causa raiz. `deno test --no-check` → 153 passed, 0 failed, 2 ignored.
- Existe um rascunho não-commitado anterior sobre este mesmo tema (`docs/stories/S-WM-28-Correcao-Deno-Check-Tipagem-Supabase.md`, arquivo local não versionado, nunca chegou a `origin/main` nem `origin/develop`, datado de 2026-07-15, referente a uma baseline antiga de 67 erros de uma auditoria anterior 07-07). Não é a mesma story — não editar/reaproveitar aquele arquivo; ele documenta um bloqueio ("não começar antes de S-WM-24/25/26 mergeadas") que não se aplica aqui, já que aquelas stories nunca foram formalizadas nesta numeração real. Esta S-WM-36 é a story válida e atual para este achado.

### Testing
- `deno test --no-check --allow-env --allow-read --allow-net .` dentro de `supabase/functions/motor-agente/`.
- `deno check index.ts` mesma pasta.

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-18 | 0.1 | Story criada a partir do Plano 001 da auditoria motor-agente (2026-07-16), aprovado pelo sócio em 2026-07-18. Base: origin/main. | @sm River |
| 2026-07-18 | 0.2 | @po validate-story-draft: **GO**. Escopo claro, AC testáveis, self-contained, sem dependência de outra story desta leva. Status Draft → Ready. | @po Pax |
| 2026-07-18 | 0.3 | Implementada em branch `fix/motor-agente-auditoria-2026-07-16` (worktree isolado, base origin/main@99f4395). `deno check`: 75 → 36 erros (causa raiz `never` eliminada; 36 erros reais residuais documentados, não corrigidos — fora de escopo). `deno test`: 153/0/2, sem regressão. Status Ready → Ready for Review. | @dev Dex |

## Dev Agent Record

### Agent Model Used
Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References
- `deno check index.ts` antes do fix: 75 erros (baseline).
- `deno check index.ts` depois do fix: 36 erros (todos residuais, documentados abaixo).
- `deno test --no-check --allow-env --allow-read --allow-net .`: 153 passed, 0 failed, 2 ignored (idêntico à baseline).

### Completion Notes List

**Achado separado (AC2, não corrigido nesta story) — 36 erros de tipo reais restantes após o generic `Database`, agrupados em 6 causas-raiz:**

1. **`conversa` possivelmente `null` (TS18047, 20 ocorrências)** — `conversa` vem de `.single()` (tipado `T | null` pelo `supabase-js`); depois do branch `if (!conversa) { ...cria... }`, o TS não consegue provar que `conversa` deixou de ser `null` (a reatribuição `conversa = data` dentro do `if` não estreita o tipo fora dele). Comportamento em runtime já é seguro (o código sempre resolve `conversa` antes de usar `.id`), mas a garantia não é visível ao compilador. Linhas: 1124, 1133, 1170(x2), 1187(x2), 1204, 1224(x2), 1246(x2), 1247, 1254(x2), 1273(x2), 1281(x2), 1282, 1301(x2), 1318(x2), 1319, 1325(x2), 1367(x2), 1608, 1610, 1611.
2. **`metadataAtual` (`Record<string, unknown>`) não é atribuível a `Json` (TS2322, 11 ocorrências)** — a coluna `conversas.metadata` agora é tipada estritamente como `Json` (união recursiva gerada pelo schema real); `Record<string, unknown>` não satisfaz essa união estruturalmente sem cast. Ocorre em todo `.update({ metadata: metadataAtual })` (linhas 1170, 1187, 1224, 1246, 1254, 1273, 1281, 1301, 1318, 1325, 1367) e na leitura inversa (`conversa?.metadata || {}`, linha 1160).
3. **`hist.map(...)` — `conteudo: string` vs `conteudo: string | null` (TS2345, linha 1125)** — a coluna `mensagens.conteudo` é nullable no schema real; a assinatura do callback inline declara `conteudo: string` (não-nulo). Em runtime já há fallback (`m.conteudo || ""`), mas a assinatura do parâmetro não reflete a nulidade real da coluna.
4. **`p_unidade_cuca: null` vs `string | undefined` esperado pela RPC (TS2322, linha 1468)** — o tipo gerado da function `buscar_chunks_similares` declara o parâmetro como opcional (`?:`), não nullable (`| null`). O código passa `null` explicitamente (branch de pergunta geral, sem unidade). Requer confirmar com o Junior se `null` e "parâmetro omitido" têm o mesmo efeito na function real antes de decidir a correção (fora de escopo desta story).
5. **`conversa?.metadata?.ultimo_disparo` (TS2339, linha 1504)** — mesma causa da #2: `metadata` agora é `Json` estrito, sem a propriedade dinâmica `ultimo_disparo` que o app grava.
6. **`number | null` vs `number` esperado por `chamarGPT` (TS2345, linha 1560)** — `prompt.temperatura`/`prompt.max_tokens` são nullable no schema real (`prompts_agentes`), mas `chamarGPT` espera `number` não-nulo. Risco real a avaliar: se alguma linha de `prompts_agentes` tiver esses campos `null`, a chamada à OpenAI receberia `null` em vez de número.

**Por que não corrigi:** a story (Passo 5/STOP conditions) instrui explicitamente a não corrigir lógica de negócio nem usar `as any`/`@ts-ignore` para calar erros reais — só documentar. Itens #1 e #2/#5 são primariamente gaps de anotação de tipo (sem mudança de comportamento óbvia); #3, #4 e #6 podem refletir nulidade real de coluna que vale investigar antes de decidir a correção (ex.: `prompts_agentes.temperatura` pode legitimamente nunca ser `null` na prática, mas o schema permite — isso é uma pergunta pro Junior, não uma decisão unilateral do @dev). Recomendo uma story de follow-up dedicada a isso (fora da leva atual).

### File List
- `supabase/functions/motor-agente/database.types.ts` (novo, gerado via MCP)
- `supabase/functions/motor-agente/index.ts` (modificado: import do tipo `Database`, 8x `ReturnType<typeof createClient<Database>>`, `createClient<Database>(...)`)
