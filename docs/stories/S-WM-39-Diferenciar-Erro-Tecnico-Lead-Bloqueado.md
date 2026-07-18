# S-WM-39 — Diferenciar falha técnica de "lead bloqueado" na resolução do lead

## Status
Ready for Review

## Origem
Auditoria independente `motor-agente` (2026-07-16), achado BUG-02, Plano 005. Diagnóstico: `docs/qa/DIAGNOSTICO-motor-agente-2026-07-18.md` (seção 2.3). Base: **`origin/main`** (`99f4395`).

## Complexidade
**S**

## Prioridade
P2 — independente, baixo risco.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - deno test --no-check --allow-env --allow-read --allow-net . → testes novos + suíte existente verdes
  - deno check index.ts → não piora baseline
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** que uma falha técnica na resolução do lead (não um bloqueio genuíno) gere um erro visível nos logs, em vez de virar `{blocked: true}` silenciosamente,
**para que** eu consiga diferenciar, pelos logs do Supabase, um problema técnico real de um lead de fato bloqueado.

## Contexto e Problema

`index.ts:1073-1078`:
```ts
let { data: lead } = await supabase.from("leads").select("id,nome,opt_in,bloqueado").eq("telefone", telefone).single();
if (!lead) {
  const { data } = await supabase.from("leads").insert({ telefone, unidade_cuca, origem: "whatsapp", opt_in: true }).select("id,nome,opt_in,bloqueado").single();
  lead = data;
}
if (!lead || lead.bloqueado) return new Response(JSON.stringify({ blocked: true }), { status: 200 });
```
`supabase-js` não lança em erro de query — retorna `{data: null, error}`. Se `select` E o `insert` de fallback falharem (erro transiente, corrida de constraint), `lead` fica nulo e a linha 1078 trata isso como "bloqueado", status 200, sem log, sem alerta.

**Impacto real verificado (worker, `worker/meta_adapter_inbound.py:334-365,823-836`):** o worker checa `if not resp.is_success` (cobre 500) e `if not data.get("success")` — hoje `{blocked:true}` (sem campo `success`) JÁ cai nesse mesmo caminho de "erro" e o worker já manda o fallback genérico "problema técnico" ao lead. **Esta story não muda o que o lead vê** (mesmo fallback antes e depois) — o ganho é só observabilidade: os logs do Supabase passam a diferenciar "erro real" de "bloqueio genuíno", hoje indistinguíveis mesmo nos logs.

## Escopo

### IN
1. Capturar `error` nas duas queries e lançar quando o insert de fallback falhar com erro real:
```ts
let { data: lead, error: leadSelectError } = await supabase.from("leads").select("id,nome,opt_in,bloqueado").eq("telefone", telefone).single();
if (!lead) {
  const { data, error: leadInsertError } = await supabase.from("leads").insert({ telefone, unidade_cuca, origem: "whatsapp", opt_in: true }).select("id,nome,opt_in,bloqueado").single();
  lead = data;
  if (!lead && leadInsertError) {
    throw new Error("Falha ao resolver lead (select: " + (leadSelectError?.message ?? "sem linha") + "; insert: " + leadInsertError.message + ")");
  }
}
if (!lead || lead.bloqueado) return new Response(JSON.stringify({ blocked: true }), { status: 200 });
```
(O `throw` reaproveita o catch top-level já existente, `index.ts:1614-1618`, que já loga e retorna 500 formatado.)

### OUT
- O bloco de resolução de `conversa` (mesmo padrão, achado relacionado = Plano 013/S-WM-45) — story separada, não misturar.
- `worker/meta_adapter_inbound.py` — já trata qualquer não-200 corretamente.
- Deploy automático.

### ⚠️ Sequenciamento (achado na validação do @po)
Esta story toca a mesma região (linhas 1073-1078) que a **S-WM-43** (paralelizar Par 1: `getOpenAIKey` + lead select). Mergear **esta story antes** da S-WM-43 — a S-WM-43 já está instruída a aplicar seu Par 1 por último neste grupo, sobre o resultado final desta story.

## Acceptance Criteria

1. **Given** select e insert de `leads` falhando com erro real, **when** processado, **then** `status 500`, corpo `{error: "Erro interno", ...}` — **não** `{blocked: true}` com 200.
2. **Given** lead genuinamente bloqueado (`bloqueado: true`, sem erro), **when** processado, **then** `status 200`, `{blocked: true}` — mesmo comportamento de hoje.
3. **Given** lead novo, insert funciona, **when** processado, **then** segue normalmente — sem regressão.
4. Teste do cenário 1 falha se o fix for revertido.
5. `deno test` → `0 failed`, incluindo os novos.
6. `deno check index.ts` não piora vs. baseline.
7. Nenhum deploy é executado por esta story.

## Tasks / Subtasks

- [x] **Task 1 — Capturar e checar `error`** (AC: 1, 2, 3)
  - [x] Editado `index.ts:1074-1080` (deslocado +1 pela S-WM-36).
- [x] **Task 2 — Testes** (AC: 1, 2, 3, 4)
  - [x] Estendido `criarSupabaseMock` (`index.audit.test.ts`) para aceitar `error` opcional por tabela — aditivo, default `null`, não quebrou nenhum teste existente.
  - [x] Mutation testing: fix revertido temporariamente → teste do cenário 1 falhou como esperado; restaurado e reconfirmado verde.
- [x] **Task 3 — Fechamento** (AC: 5, 6, 7)
  - [x] Suíte: 159 passed, 0 failed, 2 ignored. `deno check`: 36 erros (idêntico à baseline S-WM-36/37, nenhum novo).

## Dev Notes
- Mesmo padrão (`.single()` sem checar `error`) se repete na resolução de `conversa` (Plano 013/S-WM-45) — usei esta story como referência de como tratar lá.

### Testing
- `deno test --no-check --allow-env --allow-read --allow-net .`

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-18 | 0.1 | Story criada a partir do Plano 005 da auditoria motor-agente (2026-07-16), aprovado pelo sócio. Base: origin/main. Impacto real no worker verificado: sem mudança para o lead, ganho é só observabilidade de backend. | @sm River |
| 2026-07-18 | 0.2 | @po validate-story-draft: **GO com ajuste aplicado**. Achado de sequenciamento: mesma região de código que a S-WM-43 (Par 1) — nota de dependência adicionada (mergear esta antes). Status Draft → Ready. | @po Pax |
| 2026-07-18 | 0.3 | Implementada em branch `fix/motor-agente-auditoria-2026-07-16`, sobre S-WM-37. Mutation testing confirmou a proteção. Suíte: 159/0/2. Status Ready → Ready for Review. | @dev Dex |

## Dev Agent Record

### Agent Model Used
Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References
- `deno test`: 159 passed, 0 failed, 2 ignored (156 baseline S-WM-37 + 3 novos).
- Mutation testing: fix revertido → cenário 1 falhou como esperado; restaurado → verde.
- `deno check`: 36 erros, idêntico à baseline (nenhum novo).

### Completion Notes List
- Implementado exatamente como especificado. `criarSupabaseMock` estendido com `error` opcional por tabela (aditivo).

### File List
- `supabase/functions/motor-agente/index.ts` (modificado: captura e checagem de `error` na resolução do lead)
- `supabase/functions/motor-agente/index.audit.test.ts` (modificado: `criarSupabaseMock` ganhou suporte a `error`; 3 testes novos S-WM-39 adicionados ao final)
