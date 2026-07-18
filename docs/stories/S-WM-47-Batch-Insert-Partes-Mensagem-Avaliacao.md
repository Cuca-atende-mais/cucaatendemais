# S-WM-47 — Avaliar batch dos inserts de partes de mensagem (decisão: manter sequencial)

## Status
Ready for Review

## Origem
Auditoria independente `motor-agente` (2026-07-16), achado PERF-03, Plano 014. Diagnóstico já fez a investigação de schema necessária: `docs/qa/DIAGNOSTICO-motor-agente-2026-07-18.md`, item "Plano 014". Base: **`origin/main`** (`99f4395`).

## Complexidade
**S**

## Prioridade
P3 — baixa (decisão de "não mexer, documentar por quê", já suportada por checagem real).

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - grep -n "Sequencial de propósito" index.ts → confirma o comentário novo presente
  - deno test --no-check --allow-env --allow-read --allow-net . → 0 failed (nenhuma mudança de comportamento)
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** documentar explicitamente por que o insert de partes de mensagem é sequencial, e não paralelizado,
**para que** isso não volte a ser reportado como achado de performance numa próxima auditoria sem contexto.

## Contexto e Problema

`index.ts:1606-1608`:
```ts
for (const parte of mensagens) {
  await salvarMensagemAgente(supabase, conversa.id, lead.id, parte);
}
```
Insere cada parte de uma resposta dividida (até 3, via `dividirRespostaEmPartes`) em loop sequencial — até 2 round-trips extras de latência.

**Checagem de schema já feita (diagnóstico 2026-07-18):** não há coluna de sequência explícita em `mensagens` além de `created_at` (nenhuma migration cria algo como `sequencia`/`ordem` nessa tabela). Sem essa garantia, um `Promise.all` arriscaria embaralhar a ordem lógica das partes (abertura/lista/fechamento) na leitura de histórico do próximo turno (`index.ts:1123`, `.order("created_at", { ascending: false })`). **Decisão, já suportada por essa checagem: manter sequencial (caminho 2a do plano original), só documentar.**

## Escopo

### IN
1. Adicionar comentário explicando a decisão, sem mudar o comportamento:
```ts
// Sequencial de propósito: a ordem das partes (abertura/lista/fechamento) precisa bater com
// created_at na leitura de histórico (linha ~1123) — um Promise.all aqui arriscaria embaralhar
// a ordem lógica. Não há coluna de sequência explícita em `mensagens` (confirmado em
// supabase/migrations/, 2026-07-18) que garantisse ordem determinística num insert em lote.
// Custo aceito: até 2 round-trips extras por resposta dividida (máx. 3 partes,
// dividirRespostaEmPartes). Ver S-WM-47 para o raciocínio completo.
for (const parte of mensagens) {
  await salvarMensagemAgente(supabase, conversa.id, lead.id, parte);
}
```

### OUT
- Qualquer implementação de batch/coluna de sequência — decisão é explicitamente NÃO fazer isso agora.
- `dividirRespostaEmPartes` (lógica de divisão em si) — não mexer.
- A leitura de histórico (`index.ts:1123`) — não mudar o `order by`.
- Deploy automático.

## Acceptance Criteria

1. `grep -n "Sequencial de propósito" index.ts` retorna a linha nova.
2. Nenhuma mudança de comportamento — `deno test` → `0 failed`, mesma contagem de `passed`.
3. Nenhum deploy é executado por esta story.

## Tasks / Subtasks

- [x] **Task 1 — Adicionar o comentário** (AC: 1)
  - [x] Adicionado no loop (linha ~1612, deslocada).
- [x] **Task 2 — Confirmar zero mudança de comportamento** (AC: 2, 3)
  - [x] Suíte: 165 passed, 0 failed, 2 ignored — idêntico à baseline (só comentário, sem mudança de código executável).

## Dev Notes
- Se no futuro uma coluna de sequência explícita for adicionada a `mensagens` por outro motivo, esta decisão pode ser revisitada — não é permanente por design, é permanente pela ausência de garantia hoje.

### Testing
- `deno test --no-check --allow-env --allow-read --allow-net .`

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-18 | 0.1 | Story criada a partir do Plano 014 da auditoria motor-agente (2026-07-16), aprovado pelo sócio. Base: origin/main. Checagem de schema (ausência de coluna de sequência) já feita no diagnóstico, suportando a decisão de manter sequencial. | @sm River |
| 2026-07-18 | 0.2 | @po validate-story-draft: **GO**. Mudança mínima (comentário), decisão já suportada por evidência. Status Draft → Ready. | @po Pax |
| 2026-07-18 | 0.3 | Implementada em branch `fix/motor-agente-auditoria-2026-07-16`, sobre S-WM-46. Suíte: 165/0/2, sem mudança (esperado). Status Ready → Ready for Review. | @dev Dex |

## Dev Agent Record

### Agent Model Used
Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References
- `deno test`: 165 passed, 0 failed, 2 ignored (sem mudança em relação à S-WM-46 — confirma que é só comentário).
- `deno check`: 36 erros, idêntico à baseline.

### Completion Notes List
- Mudança puramente documental, como especificado pela story.

### File List
- `supabase/functions/motor-agente/index.ts` (modificado: comentário explicando a decisão de manter o insert sequencial)

## QA Results

**Revisão:** @qa Quinn, 2026-07-18 — review em lote das 12 stories da leva.

Mudança puramente documental confirmada no diff (só comentário adicionado, nenhuma linha de código executável mudou). Raciocínio do comentário é consistente com a checagem de schema já feita no diagnóstico (ausência de coluna de sequência em `mensagens`). Decisão de não implementar batch é a correta dado o risco de embaralhar ordem sem essa garantia.

AC1-3 atendidos.

**Veredito: PASS**

— Quinn, guardião da qualidade 🛡️
