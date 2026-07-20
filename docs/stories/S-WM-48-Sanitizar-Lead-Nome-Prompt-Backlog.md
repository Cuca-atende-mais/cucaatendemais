# S-WM-48 — Endurecer isolamento de `lead.nome` no prompt (BACKLOG, baixa prioridade)

## Status
Ready for Review

## Origem
Auditoria independente `motor-agente` (2026-07-16), achado SEC-03, Plano 015. Decisão do sócio (2026-07-18): **backlog de baixa prioridade** — reforço de uma mitigação que já existe (TOM-04), não corrige bug. **Fora da leva inicial (S-WM-36 a S-WM-47)** — não sequenciar junto, avaliar quando houver capacidade.

## Complexidade
**S/M**

## Prioridade
P3 — backlog, não bloqueante.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - grep -n "sanitizarNomeLead" index.ts → linhas novas presentes
  - deno test --no-check --allow-env --allow-read --allow-net . → 0 failed
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** sanitizar `lead.nome` antes de interpolá-lo no prompt do GPT,
**para que** uma superfície teórica de prompt injection via nome de exibição do WhatsApp (`push_name`, controlado pelo usuário) fique mais protegida — reforço, não correção de um bug ativo.

## Contexto e Problema

`lead.nome` é interpolado num turno `role: "user"` do histórico (`index.ts:1553-1555`):
```ts
const contextoNomeLead = {
  role: "user",
  content: "[CONTEXTO INTERNO — nao e mensagem do lead] NOME DO LEAD: " + (lead.nome || "Nao informado"),
};
```
Já é uma decisão deliberada e documentada (TOM-04, comentário em `index.ts:~1513-1519`): separar dado de instrução reduz risco de prompt injection. **É uma mitigação real, mas só textual** — o rótulo "[CONTEXTO INTERNO]" não impede um `lead.nome` malicioso de tentar se passar por instrução.

## Escopo

### IN
1. Adicionar sanitização antes da interpolação:
```ts
function sanitizarNomeLead(nome: string | null | undefined): string {
  if (!nome) return "Nao informado";
  return nome
    .replace(/[\[\]]/g, "")
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 80);
}

const contextoNomeLead = {
  role: "user",
  content: "[CONTEXTO INTERNO — nao e mensagem do lead] NOME DO LEAD: " + sanitizarNomeLead(lead.nome),
};
```

### OUT
- A decisão TOM-04 de separar dado de instrução (já correta, não mexer).
- Qualquer mudança em como o prompt de sistema instrui o uso do nome.

## Acceptance Criteria

1. Nome normal ("Maria Silva") → passa inalterado (exceto trim).
2. Nome com colchetes → colchetes removidos.
3. Nome com quebra de linha → achatado para espaço.
4. Nome muito longo (200 caracteres) → truncado para 80.
5. `null`/`undefined`/vazio → "Nao informado" (comportamento atual preservado).
6. `deno test` → `0 failed`, incluindo os novos.
7. Nenhum deploy é executado por esta story.

## Tasks / Subtasks

- [x] **Task 1 — Implementar `sanitizarNomeLead`** (AC: 1-5)
- [x] **Task 2 — Testes** (AC: 1-6)
- [x] **Task 3 — Fechamento** (AC: 7)

## Dev Notes
- Esta sanitização é defesa em profundidade sobre uma mitigação já existente — não substitui a necessidade do prompt de sistema continuar resistente a esse tipo de conteúdo.
- **Story explicitamente de backlog** — @po não precisa priorizar esta junto da leva S-WM-36–47; incluir no board como baixa prioridade.

### Testing
- `deno test --no-check --allow-env --allow-read --allow-net .`

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-18 | 0.1 | Story criada a partir do Plano 015 da auditoria motor-agente (2026-07-16). Sócio decidiu: backlog de baixa prioridade, fora da leva inicial. Base: origin/main. | @sm River |
| 2026-07-19 | 0.2 | @po validate-story-draft: **GO** (9/10 — prioridade P3/backlog explícita conta como risco documentado, não penaliza). Título objetivo, contexto/problema claros (mitigação TOM-04 existente vs. sanitização literal faltante), AC testáveis e específicos (5 casos de sanitização + regressão), escopo IN/OUT bem delimitado (não mexe na decisão TOM-04), complexidade S/M, valor de negócio (defesa em profundidade) claro. Sequenciada junto com S-WM-49 a pedido do Junior. Status Draft → Ready. | @po Pax |
| 2026-07-19 | 0.3 | Implementada sanitização de `lead.nome` antes do contexto interno enviado ao GPT; testes de nome normal, colchetes, quebra de linha, truncamento e fallback vazio/null adicionados. Status Ready → Ready for Review. | @dev Dex |

## Dev Agent Record

### Debug Log References

- `deno test --no-check --allow-env --allow-read --allow-net supabase/functions/motor-agente/index.test.ts supabase/functions/motor-agente/index.audit.test.ts` → 176 passed / 0 failed / 2 ignored.
- `deno test --no-check --allow-env --allow-read --allow-net .` em `supabase/functions/motor-agente` → 176 passed / 0 failed / 2 ignored.
- `deno lint supabase/functions/motor-agente/index.ts supabase/functions/motor-agente/index.test.ts supabase/functions/motor-agente/index.audit.test.ts` → falha no baseline conhecido de 7 problemas (imports inline jsr/https e `midia_url`/`midia_tipo` não usados), sem problema novo desta story.
- `deno check index.ts` em `supabase/functions/motor-agente` → falha no baseline conhecido de tipagem estrutural do handler/Supabase (`conversa` possivelmente null, `metadata` Json vs Record etc.), sem erro novo na sanitização.

### Completion Notes List

- `sanitizarNomeLead` adicionada em `index.ts`.
- `contextoNomeLead` agora usa `sanitizarNomeLead(lead.nome)`.
- Sanitização remove colchetes, achata quebras de linha, aplica `trim`, limita a 80 caracteres e preserva `"Nao informado"` para null/undefined/vazio.
- Nenhum deploy/push executado por @dev.

### File List

- `supabase/functions/motor-agente/index.ts`
- `supabase/functions/motor-agente/index.test.ts`
- `docs/stories/S-WM-48-Sanitizar-Lead-Nome-Prompt-Backlog.md`

## QA Results

### Review Date: 2026-07-19

### Reviewed By: @qa Quinn

### Gate Decision

PASS — implementação aprovada para seguir para @devops junto da S-WM-49.

### Requirements Traceability

- AC1 nome normal/trim: coberto por `sanitizarNomeLead: nome normal passa com trim`.
- AC2 colchetes removidos: coberto por `sanitizarNomeLead: remove colchetes e achata quebra de linha`.
- AC3 quebra de linha achatada: coberto pelo mesmo teste acima.
- AC4 truncamento em 80 caracteres: coberto por `sanitizarNomeLead: trunca nome muito longo em 80 caracteres`.
- AC5 null/undefined/vazio: coberto por `sanitizarNomeLead: null undefined e vazio viram Nao informado`.
- AC6 suíte Deno: validada, 176 passed / 0 failed / 2 ignored.
- AC7 sem deploy: confirmado; QA não identificou ação de deploy/push nesta etapa.

### Risk Assessment

- Segurança: melhora incremental real, reduz superfície de prompt injection por `lead.nome` sem alterar TOM-04.
- Regressão funcional: baixa; mudança isolada no valor textual interpolado no contexto interno.
- Banco/produção: sem migration, sem alteração de schema, sem relação 1:N nova.

### Evidence

- `deno test --no-check --allow-env --allow-read --allow-net .` em `supabase/functions/motor-agente` → 176 passed / 0 failed / 2 ignored.
- `deno lint supabase/functions/motor-agente/index.ts supabase/functions/motor-agente/index.test.ts supabase/functions/motor-agente/index.audit.test.ts` → 7 problemas baseline conhecidos, sem achado novo do patch.
- `deno check index.ts` → 36 erros baseline conhecidos de tipagem estrutural do handler/Supabase, sem erro novo na sanitização.
- `git diff --check` nos arquivos alterados → sem problemas.

### Notes

- Não há bloqueio QA para PR. Recomendação: @devops deve criar PR com nota explícita de que a Edge Function `motor-agente` precisa ser redeployada por alterar `supabase/functions/motor-agente/index.ts`.
