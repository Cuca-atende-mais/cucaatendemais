# S-WM-42 — Não repassar texto de erro upstream (OpenAI) na resposta HTTP

## Status
Ready for Review

## Origem
Auditoria independente `motor-agente` (2026-07-16), achado SEC-04, Plano 011. Diagnóstico: `docs/qa/DIAGNOSTICO-motor-agente-2026-07-18.md` (seção 2.3). Base: **`origin/main`** (`99f4395`).

## Complexidade
**S**

## Prioridade
P3 — segurança, baixo impacto isolado.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - deno test --no-check --allow-env --allow-read --allow-net . → 0 failed
  - grep -n "details: errMsg" index.ts → não deve retornar nada após o fix
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** que o catch top-level do `motor-agente` não repasse texto de erro cru de terceiros (OpenAI) na resposta HTTP,
**para que** detalhes internos de diagnóstico não vazem para fora do limite de confiança da função.

## Contexto e Problema

`index.ts:1614-1618`:
```ts
} catch (error: unknown) {
  const errMsg = error instanceof Error ? error.message : String(error);
  console.error("[motor-agente v18]", errMsg);
  return new Response(JSON.stringify({ error: "Erro interno", details: errMsg }), { status: 500 });
}
```
`errMsg` pode conter texto cru de erro da OpenAI (`"GPT-4o error: " + resp.text()`, `"Whisper error: ..."`, `"Embedding error: ..."`), repassado verbatim ao caller HTTP — hoje o worker, potencialmente qualquer chamador (ver S-WM-37/reachability).

**Impacto real verificado no worker:** `worker/meta_adapter_inbound.py` loga `resp.text[:200]` (corpo truncado) quando a resposta não é 2xx — isso inclui hoje `details` no próprio log do worker. Depois desta story, o worker também perde esse detalhe específico no seu log (mantém `resp.status_code` + o restante do corpo) — o detalhe completo continua preservado no `console.error` da Edge Function (Supabase), só deixa de existir em 2 lugares.

## Escopo

### IN
1. Remover `details: errMsg` da resposta:
```ts
} catch (error: unknown) {
  const errMsg = error instanceof Error ? error.message : String(error);
  console.error("[motor-agente v18]", errMsg);
  return new Response(JSON.stringify({ error: "Erro interno" }), { status: 500 });
}
```

### OUT
- Os `throw new Error(...)` que geram `errMsg` — continuam lançando o texto completo (correto pro `console.error`).
- Deploy automático.

## Acceptance Criteria

1. Resposta de erro do catch top-level não inclui `details`.
2. `console.error` continua logando o `errMsg` completo.
3. `grep -rn "details" worker/meta_adapter_inbound.py` confirmado antes do fix — se o worker depender especificamente do campo `details` (não só `error`/status), PARAR e reportar em vez de quebrar o consumidor.
4. Se algum teste existente depende de `details` na resposta, atualizado para não mais assertar sobre ele (ou assertar ausência).
5. `deno test` → `0 failed`.
6. Nenhum deploy é executado por esta story.

## Tasks / Subtasks

- [x] **Task 1 — Confirmar consumo de `details` no worker** (AC: 3)
  - [x] `grep -rn "details" worker/meta_adapter_inbound.py` → vazio, worker não depende do campo.
- [x] **Task 2 — Remover `details` da resposta** (AC: 1, 2)
  - [x] Editado o catch top-level (linha 1622, deslocada).
- [x] **Task 3 — Testes** (AC: 4, 5)
  - [x] `grep -n "details" index.audit.test.ts index.test.ts` → vazio, nenhum teste existente dependia. Teste novo adicionado confirmando ausência.
  - [x] Mutation testing: fix revertido → teste falhou como esperado; restaurado → verde.
- [x] **Task 4 — Fechamento** (AC: 6)
  - [x] Suíte: 165 passed, 0 failed, 2 ignored. `deno check`: 36 erros, idêntico.

## Dev Notes
- Se o time quiser manter algum nível de detalhe estruturado pro caller no futuro (ex.: código de erro), é decisão de design separada — fora desta story.

### Testing
- `deno test --no-check --allow-env --allow-read --allow-net .`

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-18 | 0.1 | Story criada a partir do Plano 011 da auditoria motor-agente (2026-07-16), aprovado pelo sócio. Base: origin/main. Impacto real no worker (perda de detalhe no log local) verificado e documentado. | @sm River |
| 2026-07-18 | 0.2 | @po validate-story-draft: **GO**. Pequena, isolada, impacto já mapeado. Status Draft → Ready. | @po Pax |
| 2026-07-18 | 0.3 | Implementada em branch `fix/motor-agente-auditoria-2026-07-16`, sobre S-WM-41. Mutation testing confirmou. Suíte: 165/0/2. Status Ready → Ready for Review. | @dev Dex |

## Dev Agent Record

### Agent Model Used
Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References
- `deno test`: 165 passed, 0 failed, 2 ignored (164 baseline S-WM-41 + 1 novo).
- Mutation testing: fix revertido → teste falhou; restaurado → verde.
- `deno check`: 36 erros, idêntico à baseline.

### Completion Notes List
- Implementado exatamente como especificado. Worker confirmado sem dependência de `details`.

### File List
- `supabase/functions/motor-agente/index.ts` (modificado: catch top-level não inclui mais `details`)
- `supabase/functions/motor-agente/index.audit.test.ts` (modificado: 1 teste novo S-WM-42 adicionado ao final)

## QA Results

**Revisão:** @qa Quinn, 2026-07-18 — review em lote das 12 stories da leva.

Mudança mínima e cirúrgica confirmada no diff: só o corpo da `Response` do catch top-level perdeu `details`; `console.error("[motor-agente v18]", errMsg)` continua intacto (detalhe completo preservado nos logs do Supabase). Confirmei eu mesmo `grep -rn "details" worker/meta_adapter_inbound.py` → vazio, consistente com o que o @dev reportou.

AC1-6 atendidos.

**Veredito: PASS**

— Quinn, guardião da qualidade 🛡️
