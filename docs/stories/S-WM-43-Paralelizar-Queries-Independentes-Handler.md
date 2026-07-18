# S-WM-43 — Paralelizar pares de queries independentes no `handler()`

## Status
Ready for Review

## Origem
Auditoria independente `motor-agente` (2026-07-16), achado PERF-02, Plano 006. Base: **`origin/main`** (`99f4395`).

## Complexidade
**S**

## Prioridade
P2 — independente, mas com um par de risco MED (ver Task 3).

## ⚠️ Dependência de sequenciamento (achada na validação do @po) — mergear POR ÚLTIMO neste grupo
O **Par 1** (`getOpenAIKey` + lead select, linhas 1065/1073) toca a **mesma região de código** que:
- **S-WM-39** (diferenciar erro técnico de lead bloqueado) — modifica a desestruturação do select/insert de `leads` (linhas 1073-1078) para capturar `error`.
- **S-WM-44** (remover `transcreverAudio`) — remove o branch de mídia (linha 1069) que hoje fica **entre** a resolução de `openaiKey` e a de `lead`.

**Ordem recomendada:** mergear S-WM-39 e S-WM-44 primeiro (ambas pequenas, simplificam essa região), **depois** aplicar o Par 1 desta story sobre o resultado final. Vantagem prática: depois da S-WM-44 remover o branch de mídia, não sobra nenhuma chamada assíncrona entre `openaiKey` e `lead` — a ressalva abaixo sobre reordenar em torno de `transcreverAudio` deixa de existir, simplificando o Par 1. Se esta story for aplicada antes, reler o código real e reconciliar manualmente com as outras duas na hora do merge.

## ⚠️ Atenção — código mudou desde o plano original da auditoria
O par 3 (`carregarProgramacaoMensal` + embedding/RPC) hoje tem uma chamada adicional **entre** os dois (`buscarAtividadeDeterministica`, feature S-WM-35, também sem dependência de `conteudoPrograma`) que não existia quando a auditoria original foi escrita. Reler o código real (linhas abaixo, já verificadas em `origin/main`) antes de aplicar — não usar cegamente snippets de outra fonte.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - deno test --no-check --allow-env --allow-read --allow-net . → 0 failed, mesma contagem de passed (nenhum teste novo necessário)
  - deno check index.ts → não piora baseline
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** reduzir a latência sentida pelo lead paralelizando queries independentes no `handler()`,
**para que** o `motor-agente` responda mais rápido no caminho síncrono de cada mensagem do WhatsApp.

## Contexto e Problema

3 pares de queries independentes rodam sequenciais em vez de `Promise.all`:
1. `getOpenAIKey` (`index.ts:1065`) → lead select (`index.ts:1073`).
2. Histórico (`index.ts:1123`) → prompt (`index.ts:1127`).
3. `carregarProgramacaoMensal` (`index.ts:1371`) → [`buscarAtividadeDeterministica`, condicional, `index.ts:~1398`] → embedding/RPC (`index.ts:~1405`).

## Escopo

### IN
1. **Par 1:**
```ts
const [openaiKey, { data: lead }] = await Promise.all([
  getOpenAIKey(supabase),
  supabase.from("leads").select("id,nome,opt_in,bloqueado").eq("telefone", telefone).single(),
]);
if (!openaiKey) throw new Error("OPENAI_API_KEY nao encontrada");
```
⚠️ Reconfirmar: hoje `transcreverAudio` (que usa `openaiKey`) roda **entre** a resolução de `openaiKey` e a resolução de `lead` (`midia_url`/`midia_tipo` check, linha ~1069) — o `Promise.all` acima precisa vir ANTES dessa checagem de mídia, não depois; reordenar com cuidado pra `openaiKey` estar disponível quando `transcreverAudio` for chamado.
2. **Par 2:**
```ts
const [{ data: hist }, { data: prompt }] = await Promise.all([
  supabase.from("mensagens").select("conteudo,remetente").eq("conversa_id", conversa.id).order("created_at", { ascending: false }).limit(MAX_HISTORICO),
  supabase.from("prompts_agentes").select("prompt_sistema,prompt_contexto,temperatura,max_tokens,menu_boas_vindas").eq("agente_tipo", agente_tipo).eq("ativo", true).single(),
]);
```
3. **Par 3 (risco MED — reler o código atual antes de aplicar):** `carregarProgramacaoMensal` e a chamada de embedding não têm dependência de dado real entre si (o embedding usa `textoFinal`, não `conteudoPrograma`). Avaliar se `buscarAtividadeDeterministica` (também sem dependência de `conteudoPrograma`) entra no mesmo `Promise.all` ou fica de fora — decisão do @dev na hora, documentando o porquê.

### OUT
- Qualquer outra query do arquivo fora desses pares — não paralelizar oportunisticamente.
- Os padrões sequenciais legítimos (embedding → RPC que depende do embedding, nos outros 3 branches de RAG) — não confundir com este plano.

## Acceptance Criteria

1. Os 3 pares aplicados (ou os que não quebrarem nenhum teste — ver STOP abaixo).
2. `deno test` → `0 failed`, mesma contagem de `passed` de antes (nenhum teste depende de ordem estrita de `chamadas` no mock — se algum depender, revisar esse teste especificamente antes de mudar).
3. `deno check index.ts` não piora vs. baseline.
4. Nenhum deploy é executado por esta story.

## Tasks / Subtasks

- [x] **Task 1 — Par 1** (AC: 1, 2)
  - [x] Mergeada após S-WM-39 e S-WM-44 (ordem recomendada seguida) — a ressalva de `transcreverAudio` já não existia mais (removido pela S-WM-44), Par 1 ficou mais simples que o previsto.
  - [x] Achado durante a implementação: destructuring direto `{ data: lead, ... }` dentro do `const [openaiKey, ...]` do `Promise.all` tornava `lead` um binding `const`, quebrando a reatribuição `lead = data` no branch de insert-fallback (herdado da S-WM-39). Corrigido usando uma variável intermediária (`leadSelectResult`) e desestruturando com `let` depois, preservando 100% da lógica da S-WM-39 sem tocá-la.
- [x] **Task 2 — Par 2** (AC: 1, 2) — aplicado exatamente como especificado.
- [x] **Task 3 — Par 3** (AC: 1, 2)
  - [x] Reli o código atual: confirmado que `buscarAtividadeDeterministica` continua sem dependência de `conteudoPrograma`. **Decisão: deixei fora do Promise.all** — é condicional (só roda quando `trocaComPedidoEspecifico || trocouUnidade`) e incluí-la aumentaria a concorrência de rede no trecho para um ganho marginal (só dispara numa fração dos turnos). Só `carregarProgramacaoMensal` + `gerarEmbedding` paralelizados, documentado inline no código.
- [x] **Task 4 — Fechamento** (AC: 3, 4)
  - [x] Suíte rodada após cada par individualmente — 165/0/2 em todos os pontos, nenhum teste dependia de ordem estrita de `chamadas`. `deno check`: 36 erros, idêntico à baseline em todos os pontos.

## Dev Notes
- STOP condition: se `deno test` quebrar por um teste que assume ordem sequencial de `chamadas` no mock, parar e avaliar se o teste testa ordem por acidente ou necessidade real antes de reescrever.

### Testing
- `deno test --no-check --allow-env --allow-read --allow-net .`

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-18 | 0.1 | Story criada a partir do Plano 006 da auditoria motor-agente (2026-07-16), aprovado pelo sócio. Base: origin/main. Drift do par 3 desde a auditoria original documentado explicitamente. | @sm River |
| 2026-07-18 | 0.2 | @po validate-story-draft: **GO com ajuste aplicado**. Achado de sequenciamento real: Par 1 toca a mesma região que S-WM-39 e S-WM-44 — nota de dependência adicionada (mergear esta por último no grupo). Status Draft → Ready. | @po Pax |
| 2026-07-18 | 0.3 | Implementada em branch `fix/motor-agente-auditoria-2026-07-16`, sobre S-WM-47 (última do grupo — S-WM-39/44 já mergeadas antes, conforme sequenciamento). Par 3: decisão de deixar `buscarAtividadeDeterministica` fora do Promise.all, documentada. Bug de `const` vs `let` no Par 1 encontrado e corrigido durante o dev. Suíte: 165/0/2 em todos os pontos. Status Ready → Ready for Review. | @dev Dex |

## Dev Agent Record

### Agent Model Used
Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References
- `deno test` após Par 1: 165 passed, 0 failed, 2 ignored.
- `deno test` após Par 2: 165 passed, 0 failed, 2 ignored.
- `deno test` após Par 3: 165 passed, 0 failed, 2 ignored.
- `deno check` em todos os pontos: 36 erros, idêntico à baseline.

### Completion Notes List
- Ordem de sequenciamento seguida à risca (S-WM-39, S-WM-44 antes desta) — eliminou a complicação de `transcreverAudio` que o Par 1 original previa.
- Bug pego durante o dev (não pelo `deno check`, já que `lead` reatribuído como `const` é erro de sintaxe/tipo real que o compilador acusaria, mas eu percebi antes de rodar): destructuring direto no `Promise.all` tornaria `lead` imutável, quebrando a reatribuição herdada da S-WM-39. Resolvido com variável intermediária.
- Par 3: `buscarAtividadeDeterministica` deixado fora do `Promise.all` por ser condicional — decisão documentada inline no código e na story.

### File List
- `supabase/functions/motor-agente/index.ts` (modificado: 3 pares de queries paralelizadas — resolução de lead+openaiKey, histórico+prompt, programação+embedding)
