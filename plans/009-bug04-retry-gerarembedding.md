# Plan 009: Aplicar retry/backoff em `gerarEmbedding` (mesma proteção dos outros 2 call sites de OpenAI)

> **Executor instructions**: Siga passo a passo, verifique cada passo. STOP conditions → pare e reporte.
>
> **Drift check**: `git diff --stat bf8b152..HEAD -- supabase/functions/motor-agente/index.ts` antes de começar.

## Status
- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `bf8b152`, 2026-07-16

## Por que isso importa

O arquivo já tem um mecanismo de retry com backoff para 429/500/502/503 (`deveTentarNovamente`/`parseRetryAfterSegundos`, `index.ts:718-736`, adicionado pela AUD-13 especificamente porque "um 503 em pico de carga virava 'problema técnico' imediato pro lead sem nenhuma tentativa de repetição"). Esse mecanismo está aplicado em `chamarGPT` (`index.ts:738-754`) — mas **não** em `gerarEmbedding` (`index.ts:705-712`), que lança na primeira falha, sem retry.

`gerarEmbedding` é chamado em 4 pontos do `handler()` (linhas 1233, 1255, 1284, 1302) — é o segundo integração OpenAI mais usada do arquivo depois de `chamarGPT`. Um 429/503 transitório da OpenAI nessa chamada aborta a request inteira via o catch top-level, descartando qualquer escrita de metadata já feita no mesmo turno e devolvendo "problema técnico" ao lead — exatamente o cenário que a AUD-13 already fixed para `chamarGPT`, deixado de fora aqui.

## Estado atual

```ts
// index.ts:705-712
async function gerarEmbedding(texto: string, apiKey: string): Promise<number[]> {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST", headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texto.slice(0, 8000) }),
  });
  if (!resp.ok) throw new Error("Embedding error: " + await resp.text());
  return (await resp.json()).data[0].embedding;
}
```

Padrão já existente a seguir (`chamarGPT`, `index.ts:738-754`):
```ts
async function chamarGPT(prompt_sistema: string, historico: { role: string; content: string }[], apiKey: string, temperatura: number, max_tokens: number, tentativa = 0): Promise<{ texto: string }> {
  const resp = await fetch("https://api.openai.com/v1/chat/completions", { ... });

  if (deveTentarNovamente(resp.status, tentativa)) {
    const corpoErro = await resp.text();
    const esperaSegundos = Math.min(parseRetryAfterSegundos(resp.headers.get("retry-after"), corpoErro), GPT_ESPERA_MAX_SEGUNDOS);
    console.log("[motor-agente v18] Rate limit OpenAI (tentativa " + (tentativa + 1) + "/" + GPT_MAX_TENTATIVAS + "), aguardando " + esperaSegundos + "s antes de tentar de novo");
    await new Promise((resolve) => setTimeout(resolve, esperaSegundos * 1000));
    return chamarGPT(prompt_sistema, historico, apiKey, temperatura, max_tokens, tentativa + 1);
  }

  if (!resp.ok) throw new Error("GPT-4o error: " + await resp.text());
  return { texto: (await resp.json()).choices[0].message.content };
}
```
`GPT_MAX_TENTATIVAS = 2` e `GPT_ESPERA_MAX_SEGUNDOS = 10` (`index.ts:714-715`) já são constantes de módulo compartilháveis — não são específicas de `chamarGPT` no nome, então podem ser reaproveitadas.

Teste existente pra usar como referência de estrutura: procure por `AUD-13` em `index.audit.test.ts:594-648` (testa o retry em `chamarGPT`/`avaliarSelecaoUnidade` — mesmo padrão de mock de `fetch` retornando 429 na 1ª chamada e 200 na 2ª).

## Comandos que você vai precisar

| Propósito | Comando | Esperado |
|---|---|---|
| Testes | `deno test --no-check --allow-env --allow-read --allow-net .` | `0 failed`, incluindo os novos |
| Typecheck | `deno check index.ts` | não piora vs. baseline |

## Escopo
**No escopo:** `gerarEmbedding` (`index.ts:705-712`); testes novos em `index.audit.test.ts`.
**Fora do escopo:** `chamarGPT`/`avaliarSelecaoUnidade` (já corretos); qualquer mudança nas constantes `GPT_MAX_TENTATIVAS`/`GPT_ESPERA_MAX_SEGUNDOS` além de reaproveitá-las (não renomeie sem necessidade — se quiser um nome mais genérico, tudo bem, mas então precisa atualizar os 2 call sites existentes também, o que amplia o escopo; prefira reaproveitar como está).

## Fluxo git
- Branch: `advisor/009-bug04-retry-embedding`
- Commit único (fix + testes).

## Passos

### Passo 1: aplicar o mesmo padrão de retry

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

**Verify**: `grep -n "deveTentarNovamente" index.ts` retorna 3 ocorrências (as 2 já existentes + esta nova).

## Test plan

Em `index.audit.test.ts`, adicione um teste modelado no padrão AUD-13 existente (mesmo arquivo, procure `deveTentarNovamente`/`429` para achar o teste de `chamarGPT` e replicar a estrutura de mock):

1. **Retry em 429**: mock de `fetch` pra `api.openai.com/v1/embeddings` retorna status 429 na 1ª chamada, 200 com embedding válido na 2ª. Assert: `gerarEmbedding` resolve com o embedding da 2ª tentativa, e o `fetch` foi chamado 2 vezes para essa URL.
2. **Sem retry em erro não-transitório** (ex.: 400): assert que `gerarEmbedding` rejeita imediatamente, sem 2ª tentativa (`fetch` chamado só 1 vez).
3. **Esgota tentativas**: 429 em todas as `GPT_MAX_TENTATIVAS + 1` chamadas → rejeita com "Embedding error" depois de esgotar.

Use um relógio de teste falso/reduzido se o `setTimeout` real (até 10s por tentativa) tornar o teste lento — verifique se `comFetchMockado` ou outro teste já existente lida com isso (procure `setTimeout` mockado nos testes AUD-13 existentes) e siga o mesmo padrão; se não houver, um teste que aceite a espera real de poucos segundos é aceitável dado que o teto é `GPT_ESPERA_MAX_SEGUNDOS=10`, mas prefira mockar se o padrão existente já fizer isso.

**Verify**: `deno test --no-check --allow-env --allow-read --allow-net .` → todos passam, incluindo os novos, em tempo razoável (segundos, não minutos).

## Done criteria
- [ ] `gerarEmbedding` usa `deveTentarNovamente`/`parseRetryAfterSegundos`
- [ ] Os 3 testes do Test plan passam
- [ ] `deno test --no-check --allow-env --allow-read --allow-net .` → `0 failed`
- [ ] `deno check index.ts` não piora vs. baseline
- [ ] Nenhum arquivo fora do escopo modificado
- [ ] `plans/README.md` atualizado

## STOP conditions
- Se os testes de retry ficarem lentos demais por causa do `setTimeout` real e não houver um padrão de mock de tempo já estabelecido no arquivo — pare e reporte em vez de inventar um mecanismo de mock de tempo não usado em nenhum lugar do repo.
- Se o código em `index.ts:705-712` ou `738-754` não bater com os trechos citados.

## Maintenance notes
- Os 3 call sites de `chamarGPT`-like retry (`chamarGPT`, `avaliarSelecaoUnidade`, e agora `gerarEmbedding`) compartilham a mesma lógica de retry copiada 3 vezes — um candidato natural para extração futura numa função `comRetryOpenAI(fn, tentativa)`, mas isso é escopo maior que este plano (fora de escopo aqui, mencionar como observação pro Valmir se quiser considerar depois).
