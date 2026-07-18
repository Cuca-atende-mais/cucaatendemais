# S-WM-46 — Extrair a formatação de chunks RAG (duplicada 4x) para função compartilhada

## Status
Ready for Review

## Origem
Auditoria independente `motor-agente` (2026-07-16), achado TD-03, Plano 012. Base: **`origin/main`** (`99f4395`).

## Complexidade
**M**

## Prioridade
P3 — tech-debt, risco LOW/MED (toca a montagem de contexto que alimenta o prompt do GPT em toda mensagem).

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - grep -c "fonte_tipo ? \"\[\" + c.fonte_tipo" index.ts → 0 (fora da função extraída)
  - deno test --no-check --allow-env --allow-read --allow-net . → mesma contagem de passed
  - deno check index.ts → não piora baseline
  - revisão manual do @qa: comparar o prompt final (promptFinal) antes/depois em pelo menos 1 cenário de cada um dos 4 branches — testes automatizados cobrem estrutura, não necessariamente cada caractere do texto final
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** eliminar a duplicação de formatação de chunks RAG (repetida 4x),
**para que** uma mudança futura no formato não precise ser replicada manualmente em 4 lugares — já há drift (só 1 dos 4 loga contagem de chunks).

## Contexto e Problema

`c.fonte_tipo ? "[" + c.fonte_tipo + "] " + c.conteudo : c.conteudo` aparece verbatim em 4 pontos (confirmado em `origin/main`): `index.ts:1414`, `1446`, `1475`, `1490`.

## Escopo

### IN
1. Extrair (nível de módulo, próximo a `carregarProgramacaoMensal`):
```ts
function formatarChunks(chunks: { conteudo: string; fonte_tipo?: string }[]): string {
  return chunks.map((c) => c.fonte_tipo ? "[" + c.fonte_tipo + "] " + c.conteudo : c.conteudo).join("\n");
}
```
2. Trocar os 4 sites (linhas 1414, 1446, 1475, 1490) para usar `formatarChunks(chunksX)`, mantendo cabeçalho e condição `if` de cada um exatamente como estão. **Não** tocar o `console.log` do 2º site (o único que já loga contagem) — diferença legítima entre os sites, não parte da duplicação.

### OUT
- Os textos de cabeçalho distintos ("--- EVENTOS E FAQ ---", "--- CONTEXTO ---", "--- CONTEXTO (FAQ) ---") e a lógica de decisão de qual branch executar — preservar exatamente qual texto é gerado em cada branch.
- Deploy automático.

## Acceptance Criteria

1. `grep -c "fonte_tipo ? \"\[\" + c.fonte_tipo" index.ts` retorna `0` fora de `formatarChunks`.
2. Os 4 sites chamam `formatarChunks`.
3. `deno test` → `0 failed`, mesma contagem de `passed` (extração comportamento-preservando, sem teste novo necessário — suíte existente já cobre os 4 branches).
4. `deno check index.ts` não piora vs. baseline.
5. `@qa` compara manualmente o `promptFinal` (não só rodar testes) em pelo menos 1 cenário de cada branch — texto byte-a-byte idêntico ao anterior, sem "aproveitar" pra normalizar formatação.
6. Nenhum deploy é executado por esta story.

## Tasks / Subtasks

- [x] **Task 1 — Extrair `formatarChunks`** (AC: 1)
  - [x] Adicionada próxima a `carregarProgramacaoMensal` (linha ~907).
- [x] **Task 2 — Trocar os 4 sites** (AC: 2, 3)
  - [x] Trocados os 4 sites (substituição textual exata, script único, não manual um por um — mas cada substituição confirmada única via `count==1` antes de aplicar).
- [x] **Task 3 — Fechamento** (AC: 4, 5, 6)
  - [x] Suíte: 165 passed, 0 failed, 2 ignored — idêntico à baseline (a suíte existente já assert `assertStringIncludes` sobre o texto exato do prompt final em vários cenários dos 4 branches — VAL-02/04/12, S-WM-32/34 — permanecerem verdes é evidência forte de preservação byte-a-byte). `deno check`: 36 erros, idêntico.
  - [x] **AC5 (comparação manual do @qa) permanece como item do gate do @qa** — é explicitamente atribuído a ele no `quality_gate_tools` desta story, não uma tarefa do @dev.

## Dev Notes
- Follow-up fora de escopo: os 4 sites também compartilham o padrão maior "embed query → RPC → formatar" — extração mais profunda possível como story futura, não nesta.

### Testing
- `deno test --no-check --allow-env --allow-read --allow-net .`

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-18 | 0.1 | Story criada a partir do Plano 012 da auditoria motor-agente (2026-07-16), aprovado pelo sócio. Base: origin/main. | @sm River |
| 2026-07-18 | 0.2 | @po validate-story-draft: **GO**. Nota (nice-to-have, não bloqueia): esta story toca linhas próximas (1413-1490) às que a S-WM-43/Par 3 mexe (1371-1405) na mesma seção de RAG — não há overlap de linha, mas quem aplicar por último deve reler o código real primeiro. Status Draft → Ready. | @po Pax |
| 2026-07-18 | 0.3 | Implementada em branch `fix/motor-agente-auditoria-2026-07-16`, sobre S-WM-42. Refactor puro, suíte inalterada. AC5 (comparação manual do prompt) fica como item pendente do gate do @qa. Status Ready → Ready for Review. | @dev Dex |

## Dev Agent Record

### Agent Model Used
Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References
- `deno test`: 165 passed, 0 failed, 2 ignored (idêntico à S-WM-42, sem teste novo, como previsto pela story).
- `deno check`: 36 erros, idêntico à baseline.
- `grep -c "fonte_tipo ? ..."`: 1 (era 4, agora só dentro de `formatarChunks`).

### Completion Notes List
- Refactor comportamento-preservando. A suíte existente inclui testes que já assertam `assertStringIncludes` sobre o texto exato do prompt final em cada um dos 4 branches (grupos VAL-02/04/12, S-WM-32/34) — continuarem verdes é evidência automatizada forte de preservação byte-a-byte, mas não substitui a comparação manual do @qa que a própria story atribui a ele (AC5).

### File List
- `supabase/functions/motor-agente/index.ts` (modificado: `formatarChunks` adicionada, 4 sites trocados para usá-la)
