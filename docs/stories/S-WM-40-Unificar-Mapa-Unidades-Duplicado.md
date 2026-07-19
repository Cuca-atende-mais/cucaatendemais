# S-WM-40 — Unificar `UNIDADES_MAP` e `nomesUnidades` (elimina duplicação)

## Status
Ready for Review

## Origem
Auditoria independente `motor-agente` (2026-07-16), achado TD-02, Plano 007. Base: **`origin/main`** (`99f4395`).

## Complexidade
**S**

## Prioridade
P3 — tech-debt, baixo risco.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - deno test --no-check --allow-env --allow-read --allow-net . → mesma contagem de passed de antes
  - deno check index.ts → não piora baseline
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** eliminar a duplicação entre `UNIDADES_MAP` e `nomesUnidades`,
**para que** um rename de unidade ou correção de typo precise ser aplicado em 1 lugar só, não 2.

## Contexto e Problema

`UNIDADES_MAP` (`index.ts:17-22`) e `nomesUnidades` (dentro de `detectarTrocaUnidade`, `index.ts:254-257`) contêm os mesmos 6 pares chave→label, diferindo só em `UNIDADES_MAP` também ter as chaves de dígito (`'1'`-`'5'`). Já há drift de formatação entre as duas (sinal de origem copy-paste).

## Escopo

### IN
1. Derivar `nomesUnidades` de `UNIDADES_MAP`, filtrando chaves numéricas, no nível de módulo (logo após `UNIDADES_MAP`, linha 22):
```ts
const NOMES_UNIDADES_POR_PALAVRA: Record<string, string> = Object.fromEntries(
  Object.entries(UNIDADES_MAP).filter(([chave]) => !/^\d$/.test(chave))
);
```
2. Trocar o corpo de `detectarTrocaUnidade` (linhas 252-270) para usar `NOMES_UNIDADES_POR_PALAVRA` em vez do literal local.

### OUT
- Qualquer outro uso de `UNIDADES_MAP` (ex.: `detectarUnidadeDireta`, linha 693) — não deve mudar de comportamento.
- Deploy automático.

## Acceptance Criteria

1. `grep -n "'barra': 'Cuca Barra'" index.ts` retorna só 1 ocorrência (antes eram 2).
2. A suíte existente para `detectarTrocaUnidade` (`index.test.ts`, cobre exact-match e typo-tolerant) continua 100% verde sem alteração — extração comportamento-preservando, sem teste novo necessário.
3. `deno check index.ts` não piora vs. baseline.
4. `detectarUnidadeDireta` continua recebendo as chaves numéricas normalmente (a filtragem só afeta a constante derivada nova).
5. Nenhum deploy é executado por esta story.

## Tasks / Subtasks

- [x] **Task 1 — Derivar e trocar** (AC: 1, 2, 4)
  - [x] Confirmado: as 6 chaves de texto batiam exatamente entre os dois literais originais.
  - [x] `NOMES_UNIDADES_POR_PALAVRA` adicionada, corpo de `detectarTrocaUnidade` trocado.
- [x] **Task 2 — Fechamento** (AC: 2, 3, 5)
  - [x] Suíte: 161 passed, 0 failed, 2 ignored — idêntico à baseline (refactor comportamento-preservando confirmado). `deno check`: 36 erros, idêntico.
  - [x] `grep -c "'barra': 'Cuca Barra'" index.ts` → 1 (era 2).

## Dev Notes
- Teste-referência: `index.test.ts` (busque `detectarTrocaUnidade` no arquivo).

### Testing
- `deno test --no-check --allow-env --allow-read --allow-net .`

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-18 | 0.1 | Story criada a partir do Plano 007 da auditoria motor-agente (2026-07-16), aprovado pelo sócio. Base: origin/main. | @sm River |
| 2026-07-18 | 0.2 | @po validate-story-draft: **GO**. Refactor puro, baixo risco, independente. Status Draft → Ready. | @po Pax |
| 2026-07-18 | 0.3 | Implementada em branch `fix/motor-agente-auditoria-2026-07-16`, sobre S-WM-38. Refactor puro, suíte inalterada. Status Ready → Ready for Review. | @dev Dex |

## Dev Agent Record

### Agent Model Used
Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References
- `deno test`: 161 passed, 0 failed, 2 ignored (idêntico à S-WM-38, sem teste novo, como previsto pela story).
- `deno check`: 36 erros, idêntico à baseline.

### Completion Notes List
- Refactor comportamento-preservando confirmado pela suíte existente permanecer 100% verde sem alteração.

### File List
- `supabase/functions/motor-agente/index.ts` (modificado: `NOMES_UNIDADES_POR_PALAVRA` adicionada, `detectarTrocaUnidade` usa a constante derivada)

## QA Results

**Revisão:** @qa Quinn, 2026-07-18 — review em lote das 12 stories da leva.

Refactor puro confirmado por inspeção: `NOMES_UNIDADES_POR_PALAVRA` é derivada de `UNIDADES_MAP` filtrando chaves de 1 dígito (`/^\d$/`) — as 6 chaves de texto remanescentes batem exatamente com o literal antigo removido de `detectarTrocaUnidade`. `detectarUnidadeDireta` (outro consumidor de `UNIDADES_MAP`) não foi tocado, continua recebendo as chaves numéricas normalmente. Zero teste novo necessário, corretamente — a suíte existente já fixa o comportamento.

AC1-5 atendidos.

**Veredito: PASS**

— Quinn, guardião da qualidade 🛡️
