# S-WM-45 — Erro no lookup de `conversa_id` não deve criar conversa órfã silenciosamente

## Status
Ready for Review

## Origem
Auditoria independente `motor-agente` (2026-07-16), achado BUG-03, Plano 013. Base: **`origin/main`** (`99f4395`).

## Complexidade
**S/M**

## Prioridade
P2 — mesma família do BUG-02 (S-WM-39), mas em `conversa`. **Depende da S-WM-37** (mesma região de código).

## ⚠️ Dependência de sequenciamento — NÃO aplicar antes da S-WM-37
Esta story toca o mesmo bloco (`index.ts:1096-1101`) que a S-WM-37 já modifica (adiciona `lead_id` ao select + checagem de ownership). Aplicar fora de ordem gera conflito de merge. Mergear S-WM-37 primeiro, reler o código real antes de aplicar esta.

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
**quero** que uma falha técnica na busca de `conversa_id` não caia silenciosamente em criar uma conversa nova,
**para que** um erro transiente de banco não gere uma conversa órfã duplicada, perdendo o histórico da conversa real.

## Contexto e Problema

Mesma família do BUG-02 (S-WM-39): `.single()` não lança em erro, retorna `{data: null, error}`. Se a busca de `conversa_id` (`index.ts:1096`, ou já modificada pela S-WM-37) falhar por erro transiente (não "não encontrado"), o código cai no branch de criar conversa nova (`index.ts:1099-1101`), gerando conversa órfã e perdendo o histórico — quando `conversa_id` era válido, só a query falhou.

O comentário em `index.ts:1091-1095` explica que `conversa_id` existe justamente pra "resolver por PK e cair fora de qualquer corrida" (S-WM-31/32) — um erro de query tratado como "não encontrado" contorna essa garantia.

## Escopo

### IN
1. Capturar e checar `error` só no caminho **com** `conversa_id` (o caminho sem, fallback legado, é menos crítico — hoje só 1 caller, sempre manda):
```ts
let { data: conversa, error: conversaSelectError } = conversa_id
  ? await supabase.from("conversas").select("id, status, metadata" /* + lead_id, já adicionado pela S-WM-37 */).eq("id", conversa_id).single()
  : await supabase.from("conversas").select("id, status, metadata" /* idem */).eq("lead_id", lead.id).eq("origem_id", canal_origem || "test").single();

if (conversa_id && !conversa && conversaSelectError) {
  throw new Error("Falha ao buscar conversa_id=" + conversa_id + ": " + conversaSelectError.message);
}

if (!conversa) {
  const { data } = await supabase.from("conversas").insert({ lead_id: lead.id, origem_id: canal_origem || "test", agente_tipo, canal_ativo: "meta", status: "ativa" }).select("id, status, metadata" /* idem */).single();
  conversa = data; conversaJustCreated = true; conversaGenuinamenteNova = true;
}
```
**Reler o código real após a S-WM-37 estar mergeada** — o select já terá `lead_id` e a checagem de ownership; o princípio da correção é o mesmo, só a linha exata muda.

### OUT
- O bloco de resolução de `lead` (já coberto pela S-WM-39, não duplicar).
- O caminho sem `conversa_id` (fallback legado) — não endurecido nesta story (baixo risco hoje, só 1 caller e sempre manda `conversa_id`).

## Acceptance Criteria

1. **Given** `conversa_id` informado e select retorna erro real, **when** processado, **then** `status 500` — **não** deve chamar `insert` em `conversas`.
2. **Given** `conversa_id` informado, não encontrado sem erro (`{data: null, error: null}`), **when** processado, **then** comportamento atual preservado (insert de conversa nova).
3. **Given** `conversa_id` informado, encontrado com sucesso, **when** processado, **then** segue fluxo normal, sem regressão.
4. Teste do cenário 1 falha se o fix for revertido.
5. `deno test` → `0 failed`, incluindo os novos.
6. `deno check index.ts` não piora vs. baseline.
7. Nenhum deploy é executado por esta story.

## Tasks / Subtasks

- [x] **Task 0 — Confirmar S-WM-37 mergeada, reler código real** (pré-requisito)
  - [x] S-WM-37 já estava mergeada nesta branch (aplicada antes, na ordem correta). Código real relido: select já com `lead_id` + checagem de ownership, exatamente como a S-WM-37 deixou.
- [x] **Task 1 — Capturar e checar `error`** (AC: 1, 2, 3)
  - [x] Aplicado sobre o código pós-S-WM-37 (linha 1112, deslocada).
- [x] **Task 2 — Testes** (AC: 1, 2, 3, 4)
  - [x] Achado durante o dev: `criarSupabaseMock` compartilha a mesma resposta configurada por tabela entre select/insert — não conseguia expressar "select não encontra (null, sem erro), insert cria com sucesso" pro teste do cenário 2. Usei um mock inline diferenciado por contagem de chamada, só nesse teste (documentado no próprio teste), em vez de estender o mock genérico globalmente (risco de afetar outros testes) ou pular a cobertura.
  - [x] Mutation testing: fix revertido → teste do cenário 1 falhou como esperado; restaurado → verde.
- [x] **Task 3 — Fechamento** (AC: 5, 6, 7)
  - [x] Suíte: 168 passed, 0 failed, 2 ignored. `deno check`: 36 erros, idêntico à baseline.

## Dev Notes
- **Achado a reportar, não reverter silenciosamente:** se tornar esse erro "visível" (500 em vez de criar conversa nova silenciosamente) causar um volume inesperado de falhas em produção depois do deploy, isso é uma descoberta importante para reportar ao Junior — não um motivo para reverter o fix sem avisar.
- O `throw` novo não deve afetar o branch `else if (conversa.status === "encerrada")` (`index.ts:~1102`) — esse branch só roda quando `conversa` foi resolvida com sucesso.

### Testing
- `deno test --no-check --allow-env --allow-read --allow-net .`

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-18 | 0.1 | Story criada a partir do Plano 013 da auditoria motor-agente (2026-07-16), aprovado pelo sócio. Base: origin/main. Dependência de sequenciamento com S-WM-37 documentada explicitamente. | @sm River |
| 2026-07-18 | 0.2 | @po validate-story-draft: **GO**. Dependência com S-WM-37 já bem documentada pelo @sm. Status Draft → Ready. | @po Pax |
| 2026-07-18 | 0.3 | Implementada em branch `fix/motor-agente-auditoria-2026-07-16`, sobre S-WM-43 (última das 12 stories desta leva). Mock inline necessário pro cenário 2 (limitação do mock genérico compartilhado). Mutation testing confirmou. Suíte: 168/0/2. Status Ready → Ready for Review. | @dev Dex |
| 2026-07-18 | 0.4 | Fix do achado CONCERNS do @qa aplicado (mesma causa raiz da S-WM-39, corrigida lá — esta story só herdava o problema por reusar o mock estendido). Nenhuma mudança adicional necessária nesta story especificamente. Suíte: 168/0/2, sem mudança. | @dev Dex |

## Dev Agent Record

### Agent Model Used
Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References
- `deno test`: 168 passed, 0 failed, 2 ignored (165 baseline S-WM-43 + 3 novos).
- Mutation testing: fix revertido → cenário 1 falhou como esperado; restaurado → verde.
- `deno check`: 36 erros, idêntico à baseline.
- **Follow-up (achado CONCERNS do @qa):** os 4 `TS2353` que o @qa encontrou tinham causa raiz na S-WM-39 (`respostasBaseHandler` sem `error?` no tipo de retorno) — esta story só herdava o sintoma por reusar o mesmo mock estendido. Fix aplicado uma única vez, na S-WM-39 (ver lá). Reverifiquei aqui: `deno check index.audit.test.ts` limpo de `TS2353`, suíte 168/0/2 inalterada.

### Completion Notes List
- Implementado exatamente como especificado, sobre o código já modificado pela S-WM-37 (select com `lead_id`, checagem de ownership já presente).
- Limitação do mock genérico encontrada e documentada: `criarSupabaseMock` não diferencia select de insert na mesma tabela — para o cenário "não encontrado sem erro, insert cria com sucesso", precisei de um mock inline pontual (só nesse teste) em vez de arriscar estender o mock global.
- **Follow-up:** achado CONCERNS do @qa (tipo de retorno de `respostasBaseHandler`) resolvido na S-WM-39, de onde a causa raiz vinha — nenhuma mudança de código adicional nesta story.

### File List
- `supabase/functions/motor-agente/index.ts` (modificado: captura e checagem de `error` na resolução de `conversa` via `conversa_id`)
- `supabase/functions/motor-agente/index.audit.test.ts` (modificado: 3 testes novos S-WM-45 adicionados ao final)

## QA Results

**Revisão:** @qa Quinn, 2026-07-18 — review em lote das 12 stories da leva.

**Mesmo achado transversal da S-WM-39 (ver detalhes lá):** os 2 testes desta story que fazem `respostas["conversas"] = { data: null, error: {...} }` também disparam o erro `TS2353` no arquivo de teste (herdado da mesma causa: `respostasBaseHandler` sem `error` no tipo de retorno). Não é um achado novo desta story especificamente — é a mesma lacuna, só mais um consumidor dela.

**Achado à parte, positivo:** o mock inline diferenciado por contagem de chamada (teste "não encontrado sem erro → cria conversa nova") é uma solução correta e bem documentada para uma limitação real do mock genérico (`criarSupabaseMock` não diferencia select/insert na mesma tabela). Revisei a lógica: `chamadasConversas === 1` (select) retorna `null`/sem erro, `> 1` (insert) retorna sucesso — captura exatamente o cenário pretendido. Escopo do hack é local ao teste (não vaza pra outros), risco de fragilidade aceitável.

**Verificação independente:** revertei o fix (`if (conversa_id && !conversa && conversaSelectError)`) e confirmei que o teste do cenário 1 falha (`500` esperado, `200`/crash obtido) — mutation testing do @dev reproduzido com sucesso.

**AC1-7:** todos atendidos. Composição com a S-WM-37 (aplicada antes, mesma região) confirmada correta no diff — nenhum conflito, a checagem de ownership (403) e a checagem de erro-real (500) são mutuamente exclusivas por construção.

**Veredito (revisão original): CONCERNS** — mesmo motivo da S-WM-39 (herdado, não novo aqui): o gap de tipo em `respostasBaseHandler` também afeta os testes desta story. Mesma recomendação: 1 correção de tipo (ver S-WM-39) resolve para as duas de uma vez.

---

### Revalidação — @qa Quinn, 2026-07-18 (pós-fix do @dev, commit `a9d606c`)

Fix aplicado uma única vez na S-WM-39 (causa raiz de lá) resolve também esta story, que só herdava o sintoma. Reproduzi de forma independente: `deno check index.audit.test.ts` → 37 erros, zero `TS2353` (os 2 testes desta story que usavam `error` no mock de `conversas` não geram mais erro de tipo). `deno test`: 168/0/2, inalterado. `index.ts`: 36 erros, intocado.

**Veredito final: PASS**

— Quinn, guardião da qualidade 🛡️
