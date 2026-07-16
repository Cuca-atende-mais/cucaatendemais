# Plan 006: Paralelizar pares de queries independentes no `handler()`

> **Executor instructions**: Siga passo a passo, rode cada verificação antes de avançar. STOP conditions → pare e reporte, não improvise.
>
> **Drift check**: `git diff --stat bf8b152..HEAD -- supabase/functions/motor-agente/index.ts` — se mudou, revalide os trechos abaixo antes de prosseguir.

## Status
- **Priority**: P2
- **Effort**: S
- **Risk**: LOW/MED (ver nota no Passo 3 sobre o par com risco MED)
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `bf8b152`, 2026-07-16

## Por que isso importa

`motor-agente` roda de forma síncrona no caminho de cada mensagem do WhatsApp — o worker espera a resposta HTTP antes de responder ao lead. Três pares de queries independentes (sem dependência de dado entre si) rodam sequenciais em vez de `Promise.all`, cada um adicionando 1 round-trip de rede de latência sentida pelo usuário final:

1. `getOpenAIKey` (linha 907) → lead select (linha 915) — nenhuma depende da outra.
2. Histórico de mensagens (linha 965) → prompt do agente (linha 969) — ambas só precisam de `conversa.id`/`agente_tipo`, já resolvidos antes.
3. `carregarProgramacaoMensal` (linha 1213, ela mesma faz 2 round-trips internos) → `gerarEmbedding`+RPC (linhas 1233-1239) — fontes de dado completamente diferentes.

## Estado atual

```ts
// linha 907
const openaiKey = await getOpenAIKey(supabase);
if (!openaiKey) throw new Error("OPENAI_API_KEY nao encontrada");
// ...
// linha 915
let { data: lead } = await supabase.from("leads").select("id,nome,opt_in,bloqueado").eq("telefone", telefone).single();
```
```ts
// linha 965
const { data: hist } = await supabase.from("mensagens").select("conteudo,remetente").eq("conversa_id", conversa.id).order("created_at", { ascending: false }).limit(MAX_HISTORICO);
const historico = (hist || []).reverse().map(...);
// linha 969
const { data: prompt } = await supabase.from("prompts_agentes").select("prompt_sistema,prompt_contexto,temperatura,max_tokens,menu_boas_vindas").eq("agente_tipo", agente_tipo).eq("ativo", true).single();
```
```ts
// linha 1213
const conteudoPrograma = await carregarProgramacaoMensal(supabase, unidadeEfetiva);
// ... (linhas 1215-1231, monta instrucaoArea/contextRAG a partir de conteudoPrograma)
// linha 1233
const embedding = await gerarEmbedding(textoFinal, openaiKey);
const { data: chunksEventos } = await supabase.rpc("buscar_chunks_similares", { ... });
```

## Comandos que você vai precisar

| Propósito | Comando | Esperado |
|---|---|---|
| Testes | `deno test --no-check --allow-env --allow-read --allow-net .` (pasta `motor-agente`) | `0 failed` |
| Typecheck | `deno check index.ts` | não piora vs. baseline |

## Escopo

**No escopo:** os 3 pares citados em `index.ts`, dentro do `handler()`.
**Fora do escopo:** qualquer outra query do arquivo que não esteja nesses 3 pares — não vá "paralelizando" oportunisticamente além do que está listado, cada par precisa ser confirmado independente antes de mexer.

## Fluxo git
- Branch: `advisor/006-perf02-paralelizar-queries`
- Commit por par (3 commits) ou 1 commit único — sua escolha, mas mantenha a suíte verde entre mudanças se fizer em commits separados.
- Não faça push/PR sem instrução.

## Passos

### Passo 1: par `getOpenAIKey` + lead select
```ts
const [openaiKey, { data: lead }] = await Promise.all([
  getOpenAIKey(supabase),
  supabase.from("leads").select("id,nome,opt_in,bloqueado").eq("telefone", telefone).single(),
]);
if (!openaiKey) throw new Error("OPENAI_API_KEY nao encontrada");
```
Note que o bloco de criação de lead (`if (!lead) { ... }`, linha 916-919) continua igual, só depende do `lead` resolvido acima.

**Verify**: `deno test ...` → `0 failed`.

### Passo 2: par histórico + prompt
```ts
const [{ data: hist }, { data: prompt }] = await Promise.all([
  supabase.from("mensagens").select("conteudo,remetente").eq("conversa_id", conversa.id).order("created_at", { ascending: false }).limit(MAX_HISTORICO),
  supabase.from("prompts_agentes").select("prompt_sistema,prompt_contexto,temperatura,max_tokens,menu_boas_vindas").eq("agente_tipo", agente_tipo).eq("ativo", true).single(),
]);
const historico = (hist || []).reverse().map((m: { conteudo: string; remetente: string }) => ({ role: m.remetente === "lead" ? "user" : "assistant", content: m.conteudo || "" }));
if (!prompt) throw new Error("Prompt nao encontrado para: " + agente_tipo);
```

**Verify**: `deno test ...` → `0 failed`.

### Passo 3 (risco MED — leia antes de aplicar): par `carregarProgramacaoMensal` + embedding/RPC

Diferente dos passos 1-2, aqui `contextRAG`/`instrucaoArea` (linhas 1215-1230) são montados a partir de `conteudoPrograma` **antes** de decidir o texto que precede o bloco de eventos — mas a chamada de embedding (linha 1233) usa `textoFinal`, não `conteudoPrograma`, então não há dependência de dado real, só de ordem de execução no código atual. Paralelize assim:

```ts
const [conteudoPrograma, embedding] = await Promise.all([
  carregarProgramacaoMensal(supabase, unidadeEfetiva),
  gerarEmbedding(textoFinal, openaiKey),
]);
// ... instrucaoArea/contextRAG montados a partir de conteudoPrograma, igual antes ...
const { data: chunksEventos } = await supabase.rpc("buscar_chunks_similares", {
  query_embedding: "[" + embedding.join(",") + "]",
  p_tipos: ["eventos_pontuais", "FAQ"],
  p_unidade_cuca: unidadeEfetiva,
  p_limite: 3,
});
```
A RPC `buscar_chunks_similares` continua sequencial depois (depende do `embedding` resolvido). Risco MED aqui porque isso aumenta a concorrência de queries simultâneas no pool de conexões do Supabase nesse trecho específico (2 chamadas rede — 1 Postgres, 1 OpenAI — em paralelo) — não deveria ter efeito colateral funcional, mas vale o Valmir confirmar headroom do pool antes de considerar isso "seguro por padrão" pra outros pontos do arquivo.

**Verify**: `deno test ...` → `0 failed`.

## Test plan

Não são necessários testes novos — este plano não muda comportamento observável, só ordem/concorrência de chamadas já mockadas. A suíte existente (`index.audit.test.ts`, que usa `criarSupabaseMock`/`comFetchMockado`) já exercita todos os 3 pares indiretamente via `handler()`; se algum teste depender de ordem estrita de chamadas (`chamadas` array), reveja esse teste especificamente — `Promise.all` não garante ordem de conclusão, só de disparo.

**Verify**: `deno test --no-check --allow-env --allow-read --allow-net .` → `0 failed`, mesma contagem de `passed` de antes (nenhum teste quebrado, nenhum novo necessário).

## Done criteria
- [ ] Os 3 pares aplicados (ou os que não quebrarem nenhum teste — ver STOP conditions)
- [ ] `deno test --no-check --allow-env --allow-read --allow-net .` → `0 failed`
- [ ] `deno check index.ts` não piora vs. baseline
- [ ] Nenhum arquivo fora do escopo modificado
- [ ] `plans/README.md` atualizado

## STOP conditions
- Se `deno test` quebrar por causa de um teste que assume ORDEM sequencial de `chamadas` no mock (ex.: `assertEquals(chamadas[0].tabela, "leads")` de forma rígida) — pare, avalie se o teste está testando ordem por acidente ou por necessidade real, e reporte em vez de reescrever o teste sem entender por quê ele existia assim.
- Se o Passo 3 causar qualquer teste a falhar de forma que sugira dependência de dado entre `conteudoPrograma` e `embedding` que eu não identifiquei — pare, não force.

## Maintenance notes
- Outros pontos do arquivo (linhas 1255/1284/1302, dentro dos outros 3 branches de RAG) têm o mesmo padrão sequencial `gerarEmbedding` → RPC, mas aí a RPC genuinamente depende do embedding — não paralelizável do mesmo jeito, não confundir com este plano.
- Revisor deve escrutinar: nenhuma leitura usa um valor antes dele estar resolvido (`await Promise.all` desestruturado corretamente).
