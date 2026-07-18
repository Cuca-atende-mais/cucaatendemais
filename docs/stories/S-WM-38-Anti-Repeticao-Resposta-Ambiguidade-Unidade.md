# S-WM-38 — Aplicar `evitarRepeticaoLiteral` na resposta de ambiguidade de unidade

## Status
Ready for Review

## Origem
Auditoria independente `motor-agente` (2026-07-16), achado BUG-01, Plano 004. Base: **`origin/main`** (`99f4395`).

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
**quero** que a resposta de ambiguidade de unidade também tenha proteção anti-repetição literal,
**para que** um lead que responde de forma ambígua duas vezes seguidas não receba o texto idêntico, palavra por palavra.

## Contexto e Problema

`evitarRepeticaoLiteral` (`index.ts:892-898`) existe pra evitar que o bot mande a mesma frase literal duas vezes seguidas (TOM-05) — aplicada em 3 dos 4 pontos onde uma resposta enlatada é enviada. O 4º ponto (`index.ts:1202-1204`, resposta de ambiguidade real de unidade) grava e retorna direto, sem o wrapper:

```ts
const respostaAmbiguidade = "Só pra confirmar: você quer saber sobre outra unidade CUCA? Me diz qual! 😊\n\n" + MENU_UNIDADES;
await salvarMensagemAgente(supabase, conversa.id, lead.id, respostaAmbiguidade);
return new Response(JSON.stringify({ success: true, resposta: respostaAmbiguidade, handover: false }), { headers: { "Content-Type": "application/json" } });
```

**Achado lateral:** nenhum dos 4 usos de `evitarRepeticaoLiteral` tem teste hoje (confirmado por grep). O teste desta story é, na prática, o primeiro do mecanismo como um todo.

## Escopo

### IN
1. Trocar `index.ts:1202-1204` para envolver a resposta com `evitarRepeticaoLiteral`:
```ts
const respostaAmbiguidade = evitarRepeticaoLiteral("Só pra confirmar: você quer saber sobre outra unidade CUCA? Me diz qual! 😊\n\n" + MENU_UNIDADES, historico);
await salvarMensagemAgente(supabase, conversa.id, lead.id, respostaAmbiguidade);
return new Response(JSON.stringify({ success: true, resposta: respostaAmbiguidade, handover: false }), { headers: { "Content-Type": "application/json" } });
```

### OUT
- Os outros 3 call sites de `evitarRepeticaoLiteral` — já corretos.
- Cobertura de teste retroativa para os outros 3 — fora desta story (backlog separado, se quiser).
- Qualquer mudança na lógica de detecção de ambiguidade (`avaliacaoTroca.mudou_de_assunto` etc.).
- Deploy automático.

## Acceptance Criteria

1. **Given** o histórico com a última mensagem do agente idêntica ao texto de ambiguidade, **when** o branch de ambiguidade dispara de novo, **then** a resposta começa com "De novo, foi mal! 😅".
2. **Given** o histórico sem repetição, **when** o branch dispara, **then** a resposta é o texto original, sem prefixo.
3. Teste do cenário 1 falha se o fix for revertido (confirmar antes/depois).
4. `deno test` → `0 failed`, incluindo os novos.
5. `deno check index.ts` não piora vs. baseline.
6. Nenhum deploy é executado por esta story.

## Tasks / Subtasks

- [x] **Task 1 — Aplicar o wrapper** (AC: 1, 2)
  - [x] Editado `index.ts:1196` (deslocado pela S-WM-36/37/39/44).
- [x] **Task 2 — Testes** (AC: 1, 2, 3)
  - [x] Tentei primeiro o unit test isolado de `evitarRepeticaoLiteral` (alternativa sancionada pela story) — **descartado**: passava mesmo com o fix revertido, porque não exercitava a integração no handler (a função em si já funcionava antes desta story). Troquei para teste e2e via `handler()` com `avaliarSelecaoUnidade` mockado via `comFetchMockado`, mensagem "quero trocar de unidade" (dispara `pareceIntencaoTrocaUnidade`, sem match direto de unidade) — cenário não exigiu mais que 2 condições simultâneas, não foi tão frágil quanto a story antecipava.
  - [x] Mutation testing: fix revertido → teste e2e falhou corretamente (confirma que a versão unit-test isolada NÃO teria pego essa regressão); restaurado e reconfirmado verde.
- [x] **Task 3 — Fechamento** (AC: 4, 5, 6)
  - [x] Suíte: 161 passed, 0 failed, 2 ignored. `deno check`: 36 erros (idêntico à baseline).

## Dev Notes
- Padrão de mock: `respostasBaseHandler`/`criarSupabaseMock`/`comFetchMockado` em `index.audit.test.ts`. `MENU_UNIDADES` já é exportado.

### Testing
- `deno test --no-check --allow-env --allow-read --allow-net .`

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-18 | 0.1 | Story criada a partir do Plano 004 da auditoria motor-agente (2026-07-16), aprovado pelo sócio. Base: origin/main. | @sm River |
| 2026-07-18 | 0.2 | @po validate-story-draft: **GO**. Pequena, self-contained, independente. Status Draft → Ready. | @po Pax |
| 2026-07-18 | 0.3 | Implementada em branch `fix/motor-agente-auditoria-2026-07-16`, sobre S-WM-44. Achado durante o dev: a alternativa "unit test isolado" que a própria story sancionava não provava a integração — troquei para e2e via handler(). Mutation testing confirmou. Suíte: 161/0/2. Status Ready → Ready for Review. | @dev Dex |

## Dev Agent Record

### Agent Model Used
Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References
- `deno test`: 161 passed, 0 failed, 2 ignored (159 baseline S-WM-44 + 2 novos).
- Mutation testing: fix revertido → teste e2e falhou; restaurado → verde.
- `deno check`: 36 erros, idêntico à baseline.

### Completion Notes List
- **Desvio da Task 2 original, justificado:** a story previa, como alternativa aceitável, testar `evitarRepeticaoLiteral` isoladamente se o cenário e2e fosse "muito complexo". Tentei essa rota primeiro — o teste passava mesmo com o fix revertido no handler (a função em si não mudou, só o call site novo), ou seja, não provava nada sobre esta story. Descartei e montei o e2e via `handler()`, que acabou não sendo tão complexo quanto antecipado (2 condições: `unidade_selecionada` salva + `avaliarSelecaoUnidade` mockado).

### File List
- `supabase/functions/motor-agente/index.ts` (modificado: wrapper `evitarRepeticaoLiteral` na resposta de ambiguidade)
- `supabase/functions/motor-agente/index.audit.test.ts` (modificado: 2 testes novos e2e S-WM-38 adicionados ao final)
