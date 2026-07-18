# S-WM-41 — Aplicar retry/backoff em `gerarEmbedding`

## Status
Ready for Review

## Origem
Auditoria independente `motor-agente` (2026-07-16), achado BUG-04, Plano 009. Base: **`origin/main`** (`99f4395`).

## Complexidade
**M**

## Prioridade
P2 — independente, baixo risco.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - deno test --no-check --allow-env --allow-read --allow-net . → testes novos + suíte existente verdes, em tempo razoável (segundos, não minutos)
  - deno check index.ts → não piora baseline
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** que `gerarEmbedding` tente novamente em 429/5xx transitório da OpenAI, igual `chamarGPT`/`avaliarSelecaoUnidade` já fazem,
**para que** um rate-limit passageiro não aborte a resposta inteira e devolva "problema técnico" ao lead sem necessidade.

## Contexto e Problema

O arquivo já tem retry com backoff para 429/500/502/503 (`deveTentarNovamente`/`parseRetryAfterSegundos`, `index.ts:801-819`), aplicado em `chamarGPT` (`index.ts:821-837`) e `avaliarSelecaoUnidade`. **Não** está aplicado em `gerarEmbedding` (`index.ts:788-795`), chamada em 4 pontos do `handler()` — 2º integração OpenAI mais usada do arquivo.

## Escopo

### IN
1. Aplicar o mesmo padrão de retry em `gerarEmbedding`:
```ts
async function gerarEmbedding(texto: string, apiKey: string, tentativa = 0): Promise<number[]> {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST", headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texto.slice(0, 8000) }),
  });

  if (deveTentarNovamente(resp.status, tentativa)) {
    const corpoErro = await resp.text();
    const esperaSegundos = Math.min(parseRetryAfterSegundos(resp.headers.get("retry-after"), corpoErro), GPT_ESPERA_MAX_SEGUNDOS);
    console.log("[motor-agente v18] Rate limit OpenAI/embeddings (tentativa " + (tentativa + 1) + "/" + GPT_MAX_TENTATIVAS + "), aguardando " + esperaSegundos + "s antes de tentar de novo");
    await new Promise((resolve) => setTimeout(resolve, esperaSegundos * 1000));
    return gerarEmbedding(texto, apiKey, tentativa + 1);
  }

  if (!resp.ok) throw new Error("Embedding error: " + await resp.text());
  return (await resp.json()).data[0].embedding;
}
```
Reaproveita `GPT_MAX_TENTATIVAS`/`GPT_ESPERA_MAX_SEGUNDOS` (`index.ts:797-798`) — não renomear.

### OUT
- `chamarGPT`/`avaliarSelecaoUnidade` — já corretos.
- Deploy automático.

## Acceptance Criteria

1. **Given** 429 na 1ª chamada, 200 na 2ª, **when** `gerarEmbedding` roda, **then** resolve com o embedding da 2ª tentativa, `fetch` chamado 2x.
2. **Given** erro não-transitório (ex.: 400), **when** rodado, **then** rejeita imediatamente, sem 2ª tentativa.
3. **Given** 429 em todas as tentativas, **when** esgotadas, **then** rejeita com "Embedding error".
4. `grep -n "deveTentarNovamente" index.ts` retorna 3 ocorrências (2 já existentes + esta nova).
5. `deno test` → `0 failed`, incluindo os 3 novos, em tempo razoável.
6. `deno check index.ts` não piora vs. baseline.
7. Nenhum deploy é executado por esta story.

## Tasks / Subtasks

- [x] **Task 1 — Aplicar retry** (AC: 1, 2, 3, 4)
  - [x] `gerarEmbedding` editada (linha 777, deslocada); exportada (não estava, precisava estar pra testar diretamente, mesmo padrão de `avaliarSelecaoUnidade`).
- [x] **Task 2 — Testes** (AC: 1, 2, 3, 5)
  - [x] Modelado no padrão AUD-13 existente (`retry-after: "0"` mantém o teste rápido, mesmo truque já usado ali — sem precisar de mock de tempo novo).
  - [x] Mutation testing: fix revertido → os 2 testes de retry (cenário 1 e 3) falharam como esperado; o de erro não-transitório (cenário 2) continuou passando (correto, não deveria mudar). Restaurado e reconfirmado verde.
- [x] **Task 3 — Fechamento** (AC: 6, 7)
  - [x] Suíte: 164 passed, 0 failed, 2 ignored, ~900ms (rápido, sem espera real). `deno check`: 36 erros, idêntico à baseline.

## Dev Notes
- Follow-up fora de escopo (registrar, não implementar): os 3 call sites de retry (`chamarGPT`, `avaliarSelecaoUnidade`, `gerarEmbedding`) compartilham a mesma lógica copiada 3x — candidato a extração futura (`comRetryOpenAI`), fora desta story.

### Testing
- `deno test --no-check --allow-env --allow-read --allow-net .`

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-18 | 0.1 | Story criada a partir do Plano 009 da auditoria motor-agente (2026-07-16), aprovado pelo sócio. Base: origin/main. | @sm River |
| 2026-07-18 | 0.2 | @po validate-story-draft: **GO**. Padrão já estabelecido no código (chamarGPT/avaliarSelecaoUnidade), independente. Status Draft → Ready. | @po Pax |
| 2026-07-18 | 0.3 | Implementada em branch `fix/motor-agente-auditoria-2026-07-16`, sobre S-WM-40. `gerarEmbedding` exportada pra permitir teste direto. Mutation testing confirmou. Suíte: 164/0/2. Status Ready → Ready for Review. | @dev Dex |

## Dev Agent Record

### Agent Model Used
Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References
- `deno test`: 164 passed, 0 failed, 2 ignored (161 baseline S-WM-40 + 3 novos), ~900ms.
- Mutation testing: fix revertido → 2/3 testes falharam como esperado (retry e esgotamento); o de erro não-transitório continuou passando corretamente. Restaurado → verde.
- `deno check`: 36 erros, idêntico à baseline.

### Completion Notes List
- `gerarEmbedding` precisou ser exportada (não estava) para o teste direto, mesmo padrão já usado em `avaliarSelecaoUnidade`/`evitarRepeticaoLiteral` — não estava no escopo literal da story mas é consistente com a convenção do arquivo.

### File List
- `supabase/functions/motor-agente/index.ts` (modificado: `gerarEmbedding` ganhou retry/backoff + `export`)
- `supabase/functions/motor-agente/index.audit.test.ts` (modificado: import de `gerarEmbedding`; 3 testes novos S-WM-41 adicionados ao final)
