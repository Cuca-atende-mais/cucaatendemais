# Plan 006: Merge atômico de `conversas.metadata` no banco, em vez de "ler, mesclar em memória, escrever"

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **Drift check (run first)**: `git diff --stat 256d547..HEAD -- supabase/functions/motor-agente/index.ts supabase/functions/motor-agente/index.audit.test.ts`
> If either file changed since this plan was written, compare the "Current
> state" excerpts below against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. This plan's exact diff was
> verified by actually running it (see "Why this matters") — if the live
> code doesn't match byte-for-byte, the pre-verified diff may not apply
> cleanly.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED (touches 14 call sites in a production edge function handling all institucional WhatsApp traffic, plus 9 test assertions — but the exact change was dry-run verified end-to-end before this plan was written; see below)
- **Depends on**: none technically. Complements (does not conflict with) `plans/004-race-breadcrumb-insert-nao-atomico.md` and `plans/005-breadcrumb-disparo-divulgacao-mensal.md`, which fix a related but distinct problem in `worker/campanhas_engine.py` (the worker side). This plan only touches `supabase/functions/motor-agente/index.ts` (the edge function side). See "Maintenance notes" for how they relate.
- **Category**: bug (data race / lost update between concurrent processes)
- **Planned at**: commit `256d547`, 2026-07-26

## Why this matters

`conversas.metadata` (a JSONB column) is written by **3 different concurrent processes** that share the same WhatsApp number: the `motor-agente` edge function (inbound conversation logic), and two worker dispatch paths in `worker/campanhas_engine.py` (`_processar_item_disparo_interno` for eventos_pontuais/ouvidoria, and — after Plan 005 lands — `_processar_disparo_divulgacao_interno` for the monthly broadcast). Both worker paths already write via `_gravar_breadcrumb_disparo`, which reads-then-writes but at least reads immediately before writing (Plan 004 fixes its remaining atomicity gap).

`motor-agente/index.ts` is different and worse: it reads `conversa.metadata` **once**, at the top of the request (line 1277: `let metadataAtual: Record<string, unknown> = conversa?.metadata || {}`), then over the following seconds of GPT calls and business logic, writes to that same row up to **14 separate times**, each write sending `.update({ metadata: metadataAtual })` — which **replaces the entire JSONB column** with whatever `metadataAtual` looked like at that point in memory (confirmed by reading the column: Supabase/PostgREST's `.update()` does not merge JSONB, it overwrites the column). A comment at lines 1267-1276 documents that this was already partially fixed for the *intra-request* case (S-WM-21: two writes in the same request now correctly build on each other via the shared `metadataAtual` tracker, instead of each one re-reading the stale `conversa.metadata`). But there is **no protection between processes**: if the worker's `_gravar_breadcrumb_disparo` writes `metadata.ultimo_disparo` to this same row **while a motor-agente request for the same lead is already in flight** (which routinely takes several seconds — debounce window + GPT latency), the very next of motor-agente's 14 `.update({ metadata: metadataAtual })` calls will overwrite that breadcrumb, because `metadataAtual` was captured before the worker's write happened and never contains `ultimo_disparo`.

This is a broader version of the exact mechanism documented as the root cause of achado #5 ("De novo, foi mal!") in `docs/qa/INVESTIGACAO-comportamento-conversas-disparo-corrida-2026-07-25.md` — that investigation found and fixed (via Plan 004) one specific narrow race (the INSERT branch of `_gravar_breadcrumb_disparo`). This plan fixes the same class of problem from the other side, at its 14 points of exposure instead of 1, using an atomic database-side merge so that **no single write ever needs a full, fresh copy of the row to avoid clobbering a concurrent writer**.

**This plan's fix was fully dry-run verified before being written** — every code and test change described below was actually applied in a disposable git worktree at commit `256d547` and the full `deno test` suite was run afterward: **196 passed, 0 failed, 2 ignored**, identical to the baseline before the change. This is not a proposed-but-unverified design — it is a verified diff, written out below exactly as tested.

## Current state

- `supabase/functions/motor-agente/index.ts` — the edge function handler. All 14 writes are the **exact same literal line**, repeated:
  ```typescript
  await supabase.from('conversas').update({ metadata: metadataAtual }).eq('id', conversa.id);
  ```
  Confirmed via `grep -c` against commit `256d547`: **exactly 14 occurrences**, at lines 1287, 1304, 1341, 1360, 1376, 1384, 1403, 1417, 1422, 1442, 1461, 1475, 1482, 1536. The `metadataAtual` tracker itself (line 1277, quoted above) and its documented intent (lines 1267-1276) are correct and must not change — this plan only changes how the tracker's current value reaches the database, not how it's built in memory.

- `supabase/functions/motor-agente/index.audit.test.ts` — the mock-based handler test suite (2470 lines). The mock harness (lines 53-81) already supports `.rpc()` calls out of the box:
  ```typescript
  function criarSupabaseMock(respostasPorTabela: Record<string, { data: unknown; error?: { message: string } | null }>, chamadas: ChamadaRegistrada[]): any {
    function criarChain(tabela: string) {
      const chain: any = {};
      for (const metodo of ["select", "eq", "order", "limit", "single"]) { /* ... */ }
      for (const metodo of ["insert", "update"]) {
        chain[metodo] = (payload: unknown) => {
          chamadas.push({ tabela, metodo, payload });
          return chain;
        };
      }
      chain.then = (resolve) => resolve({ data: respostasPorTabela[tabela]?.data ?? null, error: respostasPorTabela[tabela]?.error ?? null });
      return chain;
    }
    return {
      from: (tabela: string) => criarChain(tabela),
      rpc: (nome: string, ...args: unknown[]) => {
        chamadas.push({ tabela: "rpc:" + nome, metodo: "rpc", args });
        const resposta = respostasPorTabela["rpc:" + nome];
        return { then: (resolve) => resolve({ data: resposta?.data ?? null, error: null }) };
      },
    };
  }
  ```
  RPC calls are recorded with `tabela: "rpc:" + nome` and `args` (the array of arguments passed to `.rpc(name, ...args)`) — no harness change is needed, it already does exactly what this plan needs.

  9 existing assertions currently key off `c.metodo === "update"` on the `conversas` table to check what motor-agente wrote — these **must** change to key off the new RPC call instead, or they will start failing once Step 2 lands (not because behavior regressed, but because they're looking at the wrong mock call). The 9 sites (confirmed by direct reading, not by a subagent) are at lines 372, 386, 406, 420, 434, 899, 919+921, 942+944, 1845, 2350 — the exact before/after for each is in Step 3 below. A related assertion at line 1844 checks the **`mensagens`** table (not `conversas`) and must NOT be touched.

- No existing migration creates or reads a merge-style RPC for `conversas.metadata` — this plan adds the first one. Repo convention for simple atomic-update RPCs (see `supabase/migrations/20260706000000_claim_atomico_disparos_race_condition.sql`, the `claim_evento_pontual`/`claim_ouvidoria_evento`/`claim_disparo_divulgacao` functions): plain `LANGUAGE sql`, `CREATE OR REPLACE FUNCTION public.<name>(...)`, no explicit `SECURITY DEFINER` needed for a same-schema table write. Match this style — do not add `SECURITY DEFINER` or a `search_path` clause, neither is needed here and the exemplar doesn't use them for comparable simple single-table writes.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Run motor-agente test suite | `cd supabase/functions/motor-agente && deno test --no-check --allow-net --allow-env --allow-read .` | `196 passed \| 0 failed \| 2 ignored` (baseline, unchanged count — this plan doesn't add or remove tests, only changes what 9 of them assert) |
| Sanity-check occurrence count before editing | `grep -c "await supabase.from('conversas').update({ metadata: metadataAtual }).eq('id', conversa.id);" supabase/functions/motor-agente/index.ts` | `14` — if this number is different, STOP (see STOP conditions) |
| Confirm no old-style call sites remain after Step 2 | `grep -c "await supabase.from('conversas').update({ metadata: metadataAtual })" supabase/functions/motor-agente/index.ts` | `0` |
| Confirm new call sites after Step 2 | `grep -c "await supabase.rpc('merge_conversa_metadata'" supabase/functions/motor-agente/index.ts` | `14` |

`--no-check` is required and is **not** hiding a problem introduced by this plan: at baseline (before any change from this plan), `deno test` without `--no-check` already reports 43 pre-existing type errors unrelated to `conversas.metadata` (e.g. `database.types.ts` narrowing issues on unrelated fields, `conversa` possibly-null warnings on unrelated lines). This was confirmed by running the type-checked command against the unmodified baseline before writing this plan. Do not attempt to fix those 43 errors as part of this plan — out of scope (see Scope below).

## Scope

**In scope** (the only files you should modify):
- `supabase/functions/motor-agente/index.ts` — the 14 call-site replacements (Step 2).
- `supabase/functions/motor-agente/index.audit.test.ts` — the 9 assertion updates (Step 3).
- One new migration file (Step 1).

**Out of scope** (do NOT touch, even though they look related):
- `worker/campanhas_engine.py` and `worker/tests/test_campanhas_engine.py` — Plan 004 and Plan 005's territory. Do not migrate `_gravar_breadcrumb_disparo` to call this new RPC as part of this plan, even though it could in principle reuse it — that's a follow-up decision noted in "Maintenance notes", not part of this plan's done criteria.
- The 43 pre-existing `deno test` (type-checked) errors — pre-existing, unrelated, not introduced by this plan.
- `supabase/functions/motor-agente/index.test.ts` — only tests pure/extracted functions, doesn't mock the handler or touch `conversas`, not affected by this change. Confirm this remains true (`grep -c "conversas" supabase/functions/motor-agente/index.test.ts` should still be `0` after your changes) but do not edit it.
- The `metadataAtual` tracker's in-memory construction logic (the `{ ...metadataAtual, someField: someValue }` spreads at each of the 14 sites) — do not change what fields are computed or how; only change the final `.update(...)` call that persists it.
- Line 1806-1807 (`conversas` `.update({ status: ... })` calls, no `metadata` key) and any other `conversas` write that doesn't touch `metadata` — not part of this plan's problem, leave untouched.

## Git workflow

- Branch: `fix/merge-atomico-metadata-conversas` (matches repo's `fix/<slug>` convention, e.g. `fix/breadcrumb-nao-reconhecido-cortesia`)
- Single commit, conventional-commits style matching repo history: `fix(motor-agente): grava metadata de conversas via merge atomico no banco, nao mais update de coluna inteira`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the atomic merge RPC migration

Create `supabase/migrations/20260726000000_merge_atomico_metadata_conversas.sql`:

```sql
-- Fix: conversas.metadata é escrita por 3 processos concorrentes (motor-agente,
-- worker/campanhas_engine.py::_processar_item_disparo_interno,
-- worker/campanhas_engine.py::_processar_disparo_divulgacao_interno) que compartilham
-- o mesmo número WhatsApp Institucional. motor-agente lê conversa.metadata 1x no início
-- da requisição e depois grava esse snapshot em memória de volta até 14 vezes ao longo
-- do mesmo turno (.update({metadata: ...}) substitui a coluna JSONB inteira — não faz
-- merge no banco). Se um dos workers gravar um campo (ex.: ultimo_disparo) enquanto uma
-- requisição do motor-agente pro mesmo lead já está em andamento, o próximo .update() do
-- motor-agente apaga esse campo, porque o snapshot em memória nunca o teve.
--
-- Esta função faz o merge no próprio Postgres, atomicamente: cada chamador manda só as
-- chaves que ele quer definir/alterar (não a linha inteira), e o banco funde isso sobre o
-- valor ATUAL da coluna (não sobre uma cópia antiga) — nenhuma chave que o chamador não
-- menciona é tocada, então uma chave gravada por outro processo entre o read e o write do
-- chamador atual nunca é apagada por este merge.

CREATE OR REPLACE FUNCTION public.merge_conversa_metadata(p_conversa_id uuid, p_patch jsonb)
RETURNS void
LANGUAGE sql
AS $$
  UPDATE public.conversas
  SET metadata = COALESCE(metadata, '{}'::jsonb) || p_patch
  WHERE id = p_conversa_id;
$$;
```

**Verify**: this is a new file, no live Supabase project to apply it against in this environment — confirm only that it parses as valid SQL syntactically (no trailing errors) by visual review against the exemplar in "Current state". Do not attempt to run `supabase db push` or apply it to any remote project as part of this plan (matches the repo's existing pattern of migrations awaiting manual application — see `supabase/migrations/20260708000001_aud06_versiona_rpcs_motor_agente.sql`'s note "NÃO aplicar automaticamente").

### Step 2: Replace all 14 call sites in `index.ts`

In `supabase/functions/motor-agente/index.ts`, replace **every** occurrence of:

```typescript
await supabase.from('conversas').update({ metadata: metadataAtual }).eq('id', conversa.id);
```

with:

```typescript
await supabase.rpc('merge_conversa_metadata', { p_conversa_id: conversa.id, p_patch: metadataAtual });
```

This is a uniform, mechanical replacement — the line is byte-for-byte identical at all 14 sites, so a single find-and-replace-all across the file is correct and sufficient. Do not special-case any of the 14 sites differently; they were all verified to work identically with this replacement (see "Why this matters").

**Verify**:
```
grep -c "await supabase.from('conversas').update({ metadata: metadataAtual })" supabase/functions/motor-agente/index.ts
```
→ `0`, and
```
grep -c "await supabase.rpc('merge_conversa_metadata'" supabase/functions/motor-agente/index.ts
```
→ `14`

### Step 3: Update the 9 test assertions in `index.audit.test.ts`

Each change below was verified to make the affected test still pass with the exact same semantic meaning (checking what motor-agente wrote to `conversas.metadata`), just reading it from the new RPC call shape (`{ tabela: "rpc:merge_conversa_metadata", args: [{ p_conversa_id, p_patch }] }`) instead of the old `.update()` shape (`{ tabela: "conversas", metodo: "update", payload: { metadata } }`).

**3a. Lines 372, 386, 406, 420, 434, 2350** (six occurrences of the same pattern shape — single-line or multi-line `.some(...)` checking a specific field on the written metadata):

Before (example, line 372 — apply the same substitution at all six lines):
```typescript
const gravouUnidade = chamadas.some((c) => c.tabela === "conversas" && c.metodo === "update" && (c.payload as { metadata?: Record<string, unknown> })?.metadata?.unidade_selecionada);
```
After:
```typescript
const gravouUnidade = chamadas.some((c) => c.tabela === "rpc:merge_conversa_metadata" && (c.args?.[0] as { p_patch?: Record<string, unknown> })?.p_patch?.unidade_selecionada);
```
The pattern to find-and-replace across all six sites is exactly:
- Find: `c.tabela === "conversas" && c.metodo === "update" && (c.payload as { metadata?: Record<string, unknown> })?.metadata?.`
- Replace: `c.tabela === "rpc:merge_conversa_metadata" && (c.args?.[0] as { p_patch?: Record<string, unknown> })?.p_patch?.`
(the field name after the final `?.` — `unidade_selecionada`, `aguardando_unidade`, `conversa_engajada` — stays as-is in each of the 6 sites, only the prefix shown above changes)

**3b. Line 899** (count-only, no payload inspection):

Before:
```typescript
const updatesDeConversas = chamadas.filter((c) => c.tabela === "conversas" && c.metodo === "update").length;
```
After:
```typescript
const updatesDeConversas = chamadas.filter((c) => c.tabela === "rpc:merge_conversa_metadata").length;
```

**3c. Lines 919 and 942** (filter without `.length`, followed a few lines later by extracting the last call's payload — lines 921 and 944 respectively):

Before (appears twice, once near line 919/921 and once near line 942/944):
```typescript
const updatesDeConversas = chamadas.filter((c) => c.tabela === "conversas" && c.metodo === "update");
const ultimoUpdate = updatesDeConversas[updatesDeConversas.length - 1];
const metadataFinal = (ultimoUpdate?.payload as { metadata?: Record<string, unknown> } | undefined)?.metadata;
```
After:
```typescript
const updatesDeConversas = chamadas.filter((c) => c.tabela === "rpc:merge_conversa_metadata");
const ultimoUpdate = updatesDeConversas[updatesDeConversas.length - 1];
const metadataFinal = (ultimoUpdate?.args?.[0] as { p_patch?: Record<string, unknown> } | undefined)?.p_patch;
```

**3d. Line 1845** (asserts NO write happened — extend it to also cover the new RPC, don't just leave it as a same-behavior no-op):

Before:
```typescript
assertEquals(chamadas.some((c) => c.tabela === "conversas" && (c.metodo === "insert" || c.metodo === "update")), false, "não deveria inserir/atualizar conversa");
```
After:
```typescript
assertEquals(chamadas.some((c) => c.tabela === "conversas" && (c.metodo === "insert" || c.metodo === "update") || c.tabela === "rpc:merge_conversa_metadata"), false, "não deveria inserir/atualizar conversa");
```
Note: the line immediately above this one (checking `c.tabela === "mensagens"`) is a different assertion and must NOT be changed.

**Verify**:
```
grep -n 'metodo === "update"' supabase/functions/motor-agente/index.audit.test.ts
```
→ exactly one remaining line, containing `"mensagens"` (not `"conversas"`) — this is the untouched, unrelated assertion. If any other line still contains `metodo === "update"` referencing `"conversas"`, a site was missed — go back and fix it.
```
grep -c 'rpc:merge_conversa_metadata' supabase/functions/motor-agente/index.audit.test.ts
```
→ `10` (6 from 3a + 1 from 3b + 2 from 3c + 1 from 3d)

Then run the full suite:
```
cd supabase/functions/motor-agente && deno test --no-check --allow-net --allow-env --allow-read .
```
→ `196 passed | 0 failed | 2 ignored` — identical pass count to baseline (confirmed by the author of this plan in a disposable worktree before writing it).

## Test plan

- No new test files or new test cases are needed — this plan changes *how* existing, already-correct assertions observe the write (RPC call instead of raw `.update()`), it does not change what correct behavior looks like. The 9 sites modified in Step 3 already fully cover the scenarios that matter (S-WM-21 same-turn double-write regression guard, S-WM-31 engagement-flag writes, S-WM-37 conversa-ownership rejection).
- If you want extra confidence beyond what this plan requires, you may add one new test asserting that a `metadata` field the mock harness pre-populates in `conversas` (e.g. a hypothetical `ultimo_disparo` key set in `respostasBaseHandler`'s input) is passed through in `p_patch` only if motor-agente actually touches it — but this is optional, not part of Done criteria, since the underlying merge semantics (only sent keys are touched) are a property of the SQL function (Step 1), not of `index.ts`'s logic, and are enforced by Postgres itself, not by this test suite's mock (the mock doesn't simulate real jsonb `||` merge behavior).
- Verification: `cd supabase/functions/motor-agente && deno test --no-check --allow-net --allow-env --allow-read .` → all pass, count unchanged (196 passed, 0 failed, 2 ignored).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -c "await supabase.from('conversas').update({ metadata: metadataAtual })" supabase/functions/motor-agente/index.ts` → `0`
- [ ] `grep -c "await supabase.rpc('merge_conversa_metadata'" supabase/functions/motor-agente/index.ts` → `14`
- [ ] `grep -n 'metodo === "update"' supabase/functions/motor-agente/index.audit.test.ts` → only the `"mensagens"` line remains
- [ ] `cd supabase/functions/motor-agente && deno test --no-check --allow-net --allow-env --allow-read .` → exits 0, `196 passed | 0 failed | 2 ignored`
- [ ] `supabase/migrations/20260726000000_merge_atomico_metadata_conversas.sql` exists and defines `public.merge_conversa_metadata(p_conversa_id uuid, p_patch jsonb)`
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for Plan 006 updated

## STOP conditions

Stop and report back (do not improvise) if:

- `grep -c` on the literal `.update({ metadata: metadataAtual })` line does not return exactly `14` before you start Step 2 — the codebase has drifted since this plan was written (see the drift check at the top of this file), and the pre-verified diff may not apply the same way.
- After Step 3, `deno test` reports a different pass/fail/ignored count than `196 passed | 0 failed | 2 ignored` — this plan was verified to produce exactly that result at commit `256d547`; any deviation means either a site was missed or the codebase has drifted.
- You find any 15th call site matching `.update({ metadata: ...}).eq('id', conversa.id)` with a variable name other than `metadataAtual` — this plan's verification only covered the 14 sites using that exact tracker variable; a differently-named write path wasn't part of the verified diff and needs separate review before blindly applying the same fix.
- `worker/campanhas_engine.py` seems like it needs a change to make this plan's fix "complete" — it doesn't; that's explicitly out of scope (see Scope and Maintenance notes). Report instead of expanding scope.

## Maintenance notes

- **This does not achieve perfect linearizability**, and that's an accepted, documented residual limitation, not an oversight: if two processes both try to set the *same* metadata key at nearly the same instant (e.g. two overlapping campaign dispatches both writing `ultimo_disparo` for the same lead within the same few seconds), the atomic merge still resolves it as last-write-wins on that specific key — jsonb `||` merge doesn't queue or version conflicting writes to the same key, it just makes sure writes to *different* keys never clobber each other. This is a much narrower and rarer window than the bug this plan fixes (today, ANY of the 14 motor-agente writes clobbers ANY concurrent worker write, regardless of which keys are involved) — closing the narrower residual race, if it's ever observed in practice, would need application-level conflict resolution, not another database-level tweak.
- A reviewer should scrutinize: that no 15th call site was missed (STOP condition above), and that the migration's `COALESCE(metadata, '{}'::jsonb)` handles a `NULL` metadata column gracefully (defensive, matches the existing pattern in `worker/campanhas_engine.py::_gravar_breadcrumb_disparo`'s `row.get("metadata") or {}`).
- **Follow-up worth considering, explicitly not part of this plan**: `worker/campanhas_engine.py::_gravar_breadcrumb_disparo` (Plan 004's target) could eventually be simplified to call this same `merge_conversa_metadata` RPC for its "conversa already exists" branch instead of its own read-then-update — but Plan 004 already defines a specific, narrower fix for that function's INSERT-branch race, and changing its update branch too is scope creep relative to that plan. Revisit only after Plan 004 has landed and only as a deliberate follow-up, not silently inside either plan.
