# Plan 012: Extrair a formatação de chunks RAG (duplicada 4x) para uma função compartilhada

> **Executor instructions**: Siga passo a passo, verifique cada passo. STOP conditions → pare e reporte.
>
> **Drift check**: `git diff --stat bf8b152..HEAD -- supabase/functions/motor-agente/index.ts` antes de começar.

## Status
- **Priority**: P3
- **Effort**: M
- **Risk**: LOW/MED (toca a montagem de contexto que alimenta o prompt do LLM em toda mensagem — ver STOP conditions)
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `bf8b152`, 2026-07-16

## Por que isso importa

A expressão `c.fonte_tipo ? "[" + c.fonte_tipo + "] " + c.conteudo : c.conteudo` (formata um chunk RAG com prefixo de fonte) aparece **verbatim em 4 lugares**: `index.ts:1242`, `1267`, `1296`, `1311`. Cada um desses 4 pontos também repete o padrão "embed a query → chama `buscar_chunks_similares` → formata resultado", variando só `p_tipos`/`p_unidade_cuca`/`p_limite`. Já há drift observável entre eles: só 1 dos 4 pontos (`index.ts:1264`) loga a contagem de chunks retornados, os outros 3 não. Qualquer mudança futura na formatação (ex.: mudar como `fonte_tipo` é exibido) precisa ser replicada em 4 lugares manualmente.

## Estado atual

Os 4 sites (todos dentro do `handler()`, seção "6. RAG"):

```ts
// index.ts:1233-1244 (branch precisaVisaoGeral)
const embedding = await gerarEmbedding(textoFinal, openaiKey);
const { data: chunksEventos } = await supabase.rpc("buscar_chunks_similares", {
  query_embedding: "[" + embedding.join(",") + "]", p_tipos: ["eventos_pontuais", "FAQ"], p_unidade_cuca: unidadeEfetiva, p_limite: 3,
});
if (chunksEventos && chunksEventos.length > 0) {
  contextRAG += "\n\n--- EVENTOS E FAQ ---\n" + chunksEventos.map((c: { conteudo: string; fonte_tipo?: string }) =>
    c.fonte_tipo ? "[" + c.fonte_tipo + "] " + c.conteudo : c.conteudo
  ).join("\n");
}
```
```ts
// index.ts:1255-1269 (branch acompanhamento, fallback vetorial)
const embedding = await gerarEmbedding(textoFinal, openaiKey);
const { data: chunksPrograma } = await supabase.rpc("buscar_chunks_similares", {
  query_embedding: "[" + embedding.join(",") + "]", p_tipos: ["monthly_program", "eventos_pontuais", "FAQ"], p_unidade_cuca: unidadeEfetiva, p_limite: 5,
});
console.log("[motor-agente v18] Busca vetorial acompanhamento: " + (chunksPrograma?.length ?? 0) + " chunks (unidade=" + unidadeEfetiva + ")");
if (chunksPrograma && chunksPrograma.length > 0) {
  contextRAG = "\n\n--- CONTEXTO ---\n" + chunksPrograma.map((c: { conteudo: string; fonte_tipo?: string }) =>
    c.fonte_tipo ? "[" + c.fonte_tipo + "] " + c.conteudo : c.conteudo
  ).join("\n");
}
```
```ts
// index.ts:1284-1298 (branch perguntaGeralAtiva)
const embedding = await gerarEmbedding(textoFinal, openaiKey);
const { data: chunksFaq } = await supabase.rpc("buscar_chunks_similares", {
  query_embedding: "[" + embedding.join(",") + "]", p_tipos: ["FAQ"], p_unidade_cuca: null, p_limite: 5,
});
// ...
if (chunksFaq && chunksFaq.length > 0) {
  blocosRede.push("--- CONTEXTO (FAQ) ---\n" + chunksFaq.map((c: { conteudo: string; fonte_tipo?: string }) =>
    c.fonte_tipo ? "[" + c.fonte_tipo + "] " + c.conteudo : c.conteudo
  ).join("\n"));
}
```
```ts
// index.ts:1301-1313 (branch default)
const embedding = await gerarEmbedding(textoFinal, openaiKey);
const { data: chunks } = await supabase.rpc("buscar_chunks_similares", {
  query_embedding: "[" + embedding.join(",") + "]", p_tipos: fontes, p_unidade_cuca: temUnidadeDefinida ? unidadeEfetiva : null, p_limite: 5,
});
if (chunks && chunks.length > 0) {
  contextRAG = "\n\n--- CONTEXTO ---\n" + chunks.map((c: { conteudo: string; fonte_tipo?: string }) =>
    c.fonte_tipo ? "[" + c.fonte_tipo + "] " + c.conteudo : c.conteudo
  ).join("\n");
}
```

## Comandos que você vai precisar

| Propósito | Comando | Esperado |
|---|---|---|
| Testes | `deno test --no-check --allow-env --allow-read --allow-net .` | `0 failed`, mesma contagem de antes |
| Typecheck | `deno check index.ts` | não piora vs. baseline |

## Escopo
**No escopo:** os 4 blocos citados, dentro do `handler()`; uma nova função auxiliar (nível de módulo) para a parte comum.
**Fora do escopo:** os textos de cabeçalho distintos (`"--- EVENTOS E FAQ ---"`, `"--- CONTEXTO ---"`, `"--- CONTEXTO (FAQ) ---"`) e a lógica de decisão de qual branch executar (`if/else if` que envolve os 4 blocos) — a extração deve preservar exatamente qual texto é gerado em cada branch, só eliminar a duplicação da formatação de chunk.

## Fluxo git
- Branch: `advisor/012-td03-extrair-formatacao-rag`
- Commit único.

## Passos

### Passo 1: extrair a formatação de chunk

Adicione, próximo a `carregarProgramacaoMensal`/`buscarAtividadeEspecifica` (nível de módulo):
```ts
function formatarChunks(chunks: { conteudo: string; fonte_tipo?: string }[]): string {
  return chunks.map((c) => c.fonte_tipo ? "[" + c.fonte_tipo + "] " + c.conteudo : c.conteudo).join("\n");
}
```

### Passo 2: trocar os 4 sites para usar `formatarChunks`

Substitua cada `.map((c) => c.fonte_tipo ? ... : c.conteudo).join("\n")` pela chamada `formatarChunks(chunksX)`, mantendo o cabeçalho (`"--- EVENTOS E FAQ ---\n"`, etc.) e a lógica condicional (`if (chunksX && chunksX.length > 0)`) exatamente como estão em cada um dos 4 pontos. Não toque no `console.log` do 2º site (linha ~1264) — ele já é uma diferença legítima entre os sites, não faz parte da duplicação sendo removida.

**Verify após cada site**: `deno test --no-check --allow-env --allow-read --allow-net .` → `0 failed` (rode incrementalmente, um site por vez, pra isolar qualquer regressão).

## Test plan

Nenhum teste novo necessário — extração comportamento-preservando. A suíte existente já cobre os 4 branches via testes de grupo VAL-02/VAL-04/VAL-12/S-WM-32/S-WM-34 em `index.audit.test.ts` (mencionados no relatório de auditoria como os testes que exercitam a montagem de RAG) — se todos continuarem verdes, a extração preservou o comportamento exato, incluindo o texto final enviado ao GPT.

**Verify**: `deno test --no-check --allow-env --allow-read --allow-net .` → `0 failed`, mesma contagem de `passed` de antes.

## Done criteria
- [ ] `grep -c "fonte_tipo ? \"\[\" + c.fonte_tipo" index.ts` retorna `0` (a expressão duplicada não existe mais fora da função `formatarChunks`)
- [ ] Os 4 sites chamam `formatarChunks`
- [ ] `deno test --no-check --allow-env --allow-read --allow-net .` → `0 failed`
- [ ] `deno check index.ts` não piora vs. baseline
- [ ] Nenhum arquivo fora do escopo modificado
- [ ] `plans/README.md` atualizado

## STOP conditions
- Se qualquer teste do grupo VAL-02/VAL-04/VAL-12/S-WM-32/S-WM-34 falhar depois da extração de um site específico — pare nesse site, não continue para os outros 3 até entender a causa (provavelmente um cabeçalho ou condição que você alterou por engano).
- Se o texto final gerado por `formatarChunks` diferir em qualquer espaço/quebra de linha do original em algum dos 4 sites — a extração deve ser byte-a-byte idêntica ao comportamento anterior; não "aproveite" pra normalizar formatação.

## Maintenance notes
- Os 4 sites também compartilham o padrão maior "embed query → RPC → formatar" — uma extração mais profunda (função única cobrindo embed+RPC+format, com heading deixado a cargo do call site) é possível como follow-up, mas fora do escopo deste plano, que só resolve a duplicação de formatação já confirmada.
- Revisor deve comparar a saída do prompt final (`promptFinal`, linha 1330) antes/depois em pelo menos 1 cenário de cada branch, não só rodar os testes — testes automatizados cobrem estrutura, não necessariamente cada caractere do texto final enviado ao GPT.
