# Auditoria — `motor-agente` (arquivo completo, foco correção/segurança/performance/testes/tech-debt)

**Data:** 2026-07-16
**Autor:** Auditoria independente (João/sócio + Claude Code), não-implementação — este documento reporta diagnóstico e propõe planos, não aplica fixes.
**Escopo:** `supabase/functions/motor-agente/index.ts` (1437 linhas, estado no commit `bf8b152`) — a Edge Function que roda o motor conversacional do WhatsApp. Categorias auditadas: correctness/bugs, security, performance, test coverage, tech debt/arquitetura. **Não auditado neste escopo**: dependências/migrations, DX/tooling além do typecheck, docs, direção/features — ficou fora de propósito, focamos no arquivo pedido.
**Método:** leitura completa do arquivo (2 subagents paralelos, cada um cobrindo metade das categorias, mais uma passada de vetting minha própria sobre cada achado citado) + execução real da suíte de testes (`deno test`) e do typecheck (`deno check`) para confirmar baseline, não só ler o código e supor.
**Ferramenta usada:** skill `improve` (`shadcn/improve`), instalada nesta sessão — audita e propõe planos, nunca implementa. Os 17 planos mecânicos e auto-contidos (formato pensado para outro Claude Code executar sem contexto desta conversa) estão em [`plans/001` a `plans/017`](../../plans/README.md).

---

## Diagnóstico

### Baseline confirmada antes de auditar

- `deno test --no-check --allow-env --allow-read --allow-net .` → **127 passed, 0 failed, 2 ignored**. Suíte limpa.
- `deno check index.ts` → **75 erros de tipo**. Todos rastreados a uma única causa raiz (ver DX-01 abaixo) — não são 75 bugs distintos, mas o efeito é que hoje **não existe nenhum typecheck funcional rodando sobre o arquivo mais crítico do repo** (por isso os testes rodam com `--no-check`).

### 🔴 Achados de maior alavancagem (viraram plano neste lote — ver Prognóstico)

#### DX-01 — `deno check` quebrado: `createClient()` sem generic `Database`
**Arquivo:** `index.ts:906` (e `ReturnType<typeof createClient>` repetido em 7 pontos: linhas 183, 687, 756, 818, 842, 871, 895)

Sem o generic `Database`, todo método do query builder (`.update()`, `.insert()`) infere tipo de retorno `never` — daí os 75 erros (`TS2339`, `TS2345`, `TS18047`, `TS2353`). Fix: gerar `database.types.ts` via `supabase gen types typescript` e tipar o client. **Plano:** [`plans/001`](../../plans/001-typecheck-database-generic.md).

#### SEC-01 — `conversa_id` aceito sem checar ownership contra o `lead` resolvido
**Arquivo:** `index.ts:938-939` (contraste com `index.ts:940`, que checa `lead_id` no branch sem `conversa_id`)

Quando o request inclui `conversa_id`, a conversa é buscada só por `id`, sem confirmar que pertence ao `lead` resolvido pelo `telefone` do mesmo request. **Confirmei que isso é alcançável de fora do worker**: `supabase/config.toml` não tem override de `verify_jwt` para `motor-agente`, e a `anon key` do projeto está exposta publicamente no `cuca-portal` (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) — qualquer request com JWT válido (a anon key pública serve) alcança a função direto, sem depender da `SUPABASE_SERVICE_ROLE_KEY`. Um `conversa_id` de outro lead permite gravar mensagem, encerrar/forçar handover, e sobrescrever `metadata` de conversa alheia. **Plano:** [`plans/002`](../../plans/002-sec01-conversa-id-ownership-check.md).

#### SEC-02 — SSRF via `midia_url` em `transcreverAudio` — **e uma descoberta que muda a prioridade**
**Arquivo:** `index.ts:692-703`, entrada em `index.ts:911`

`fetch(audioUrl)` sem allowlist de domínio, `audioUrl` vindo direto do body. Mesma reachability do SEC-01. **Mas**: investigando o fluxo real, `worker/meta_adapter_inbound.py:142-163` já baixa e transcreve áudio inteiramente no worker (com o Bearer token correto que a Meta exige) e manda `midia_tipo="voz"` + `midia_url=None` — nunca `"audio"`/`"ptt"`, os únicos valores que ativam esse branch no `motor-agente`. **Esse caminho pode ser código morto da arquitetura pré-Meta.** Isso é uma pergunta para o Valmir responder antes do fix (remover vs. allowlist) — ver o plano. **Plano:** [`plans/003`](../../plans/003-sec02-ssrf-midia-url.md).

#### BUG-01 — Resposta de ambiguidade não passa por `evitarRepeticaoLiteral`
**Arquivo:** `index.ts:1044-1046` (contraste com os outros 3 usos: linhas 1074, 1120, 1148)

Se o lead responder de forma ambígua duas vezes seguidas, recebe o texto idêntico — exatamente o padrão que TOM-05 corrigiu nos outros 3 pontos. Descoberta lateral: **nenhum dos 4 usos de `evitarRepeticaoLiteral` tem teste hoje** (confirmado por grep nos dois arquivos de teste). **Plano:** [`plans/004`](../../plans/004-bug01-ambiguidade-anti-repeticao.md).

#### BUG-02 — Erro no lookup/insert de lead é ignorado → falha técnica vira "bloqueado"
**Arquivo:** `index.ts:915-920`

`supabase-js` não lança exceção em erro de query — retorna `{data: null, error}`. Se o `select` e o `insert` de fallback falharem (erro transiente, corrida de constraint), `lead` fica nulo e a função retorna `{blocked: true}` com status 200, indistinguível de um bloqueio real, sem log, sem alerta. **Plano:** [`plans/005`](../../plans/005-bug02-lead-lookup-error-handling.md).

### 🟠 Demais achados vetados (planos 006-017 — mesmo padrão auto-contido dos 5 acima)

| # | Achado | Categoria | Esforço | Plano | Nota |
|---|---|---|---|---|---|
| 6 | `PERF-02` — 3 pares de queries independentes sequenciais em vez de `Promise.all` (linhas 907/915, 965/969, 1213/1233) | performance | S | [006](../../plans/006-perf02-paralelizar-queries-independentes.md) | latência extra em toda mensagem |
| 7 | `TD-02` — mapa de unidades duplicado (`UNIDADES_MAP:17-22` vs `nomesUnidades` local em `254-257`) | tech-debt | S | [007](../../plans/007-td02-unificar-mapa-unidades.md) | já com drift de formatação |
| 8 | `TEST-02` — transcrição de áudio sem nenhuma cobertura de teste | cobertura | S | [008](../../plans/008-test02-cobertura-transcricao-audio.md) | condicional ao resultado do plano 003 |
| 9 | `BUG-04` — `gerarEmbedding` (linha 705) sem retry/backoff, diferente de `chamarGPT`/`avaliarSelecaoUnidade` (já endurecidos por AUD-13) | correção | M | [009](../../plans/009-bug04-retry-gerarembedding.md) | mesma classe de falha corrigida 2x, esquecida na 3ª |
| 10 | `TEST-01` — branches de erro/saída antecipada do `handler()` sem teste (405, prompt ausente, catch top-level, boas-vindas Sofia) | cobertura | M | [010](../../plans/010-test01-cobertura-branches-erro-handler.md) | pré-requisito do plano 017 |
| 11 | `SEC-04` — texto de erro da OpenAI repassado cru na resposta HTTP (linha 1432-1436) | segurança | S | [011](../../plans/011-sec04-nao-expor-erro-upstream.md) | baixo impacto |
| 12 | `TD-03` — montagem de contexto RAG copiada quase idêntica em 4 lugares (linhas 1242/1267/1296/1311) | tech-debt | M | [012](../../plans/012-td03-extrair-montagem-contexto-rag.md) | já com drift leve (log só em 1 dos 4) |
| 13 | `BUG-03` — falha no lookup de `conversa_id` cai silenciosamente em criar conversa nova | correção | S/M | [013](../../plans/013-bug03-erro-lookup-conversa-cria-orfa.md) | mesma família do BUG-02, mas em `conversa` |
| 14 | `PERF-03` — inserts de partes de mensagem em loop sequencial | performance | S | [014](../../plans/014-perf03-batch-insert-partes-mensagem.md) | batch arrisca embaralhar ordem do histórico |
| 15 | `SEC-03` — `lead.nome` interpolado em prompt com só rótulo textual como proteção | segurança | S/M | [015](../../plans/015-sec03-sanitizar-nome-lead-prompt.md) | mitigação já é decisão deliberada e documentada (linha 1334-1339) — revisitar, não bug |
| 16 | `BUG-05` *(investigar)* — corrida check-then-act pode duplicar `conversas` se caller futuro não mandar `conversa_id` | correção | M | [016](../../plans/016-bug05-investigar-corrida-conversa-duplicada.md) | hoje só 1 caller, sempre manda |
| 17 | `TD-01` — `handler()` é uma função de ~540 linhas com múltiplas flags cruzadas | tech-debt | L | [017](../../plans/017-td01-extrair-secoes-handler.md) | plano em estágios, **depois** de fechar o 010 |

**Rejeitado (não é achado):** `buscarAtividadeEspecifica` sem `.limit()` (`index.ts:846`) — decisão documentada de propósito no próprio código (`index.ts:835-837`): buscar todos os chunks evita truncar atividades espalhadas em chunks não-contíguos (S-WM-34/VAL-09).

---

## Prognóstico

**Todos os 17 achados vetados viraram plano** — em `plans/001` a `plans/017` — cada um auto-contido (código atual citado, comandos de verificação, critérios de "pronto" checáveis por máquina, condições de STOP) para o Claude Code do Valmir executar sem precisar desta conversa como contexto. Índice completo com ordem recomendada e dependências: [`plans/README.md`](../../plans/README.md).

| Plano | Título | Prioridade | Esforço | Risco |
|---|---|---|---|---|
| [001](../../plans/001-typecheck-database-generic.md) | Restaurar `deno check` funcional (gerar tipos do Supabase) | P1 | M | LOW |
| [002](../../plans/002-sec01-conversa-id-ownership-check.md) | Impedir `conversa_id` de outro lead (ownership check) | P1 | S | LOW |
| [003](../../plans/003-sec02-ssrf-midia-url.md) | Allowlist/remoção do SSRF em `transcreverAudio` — **tem pergunta em aberto pro Valmir** | P2 | S | LOW |
| [004](../../plans/004-bug01-ambiguidade-anti-repeticao.md) | Anti-repetição na resposta de ambiguidade de unidade | P2 | S | LOW |
| [005](../../plans/005-bug02-lead-lookup-error-handling.md) | Diferenciar erro técnico de "lead bloqueado" | P2 | S | LOW |
| [006](../../plans/006-perf02-paralelizar-queries-independentes.md) | Paralelizar 3 pares de queries independentes | P2 | S | LOW/MED |
| [007](../../plans/007-td02-unificar-mapa-unidades.md) | Unificar `UNIDADES_MAP`/`nomesUnidades` duplicados | P3 | S | LOW |
| [008](../../plans/008-test02-cobertura-transcricao-audio.md) | Cobertura de teste p/ transcrição de áudio — **condicional ao 003** | P3 | S | LOW |
| [009](../../plans/009-bug04-retry-gerarembedding.md) | Retry/backoff em `gerarEmbedding` | P2 | M | LOW |
| [010](../../plans/010-test01-cobertura-branches-erro-handler.md) | Cobertura de teste p/ branches de erro do `handler()` | P2 | M | LOW |
| [011](../../plans/011-sec04-nao-expor-erro-upstream.md) | Não expor erro upstream (OpenAI) na resposta HTTP | P3 | S | LOW |
| [012](../../plans/012-td03-extrair-montagem-contexto-rag.md) | Extrair formatação de chunks RAG (duplicada 4x) | P3 | M | LOW/MED |
| [013](../../plans/013-bug03-erro-lookup-conversa-cria-orfa.md) | Erro no lookup de `conversa_id` não deve criar conversa órfã | P2 | S/M | MED |
| [014](../../plans/014-perf03-batch-insert-partes-mensagem.md) | Avaliar batch dos inserts de partes de mensagem | P3 | S | MED |
| [015](../../plans/015-sec03-sanitizar-nome-lead-prompt.md) | Endurecer isolamento de `lead.nome` no prompt | P3 | S/M | LOW |
| [016](../../plans/016-bug05-investigar-corrida-conversa-duplicada.md) | *(investigar)* Corrida pode duplicar `conversas` no caminho legado | P3 | M | MED se agir |
| [017](../../plans/017-td01-extrair-secoes-handler.md) | *(plano em estágios)* Extrair seções do `handler()` de ~540 linhas | P3 | L | HIGH |

**Ordem recomendada:** 001 primeiro (restaura a rede de segurança de tipos para todos os demais) → 002 (segurança crítica) → 004/005/006/007/009/011 (independentes, baixo risco) → 003 (lê 002 antes) → 008 (depende do resultado de 003) → 013 (mesma região de código do 002) → 010 (prepara terreno pro 017) → 012 (independente) → 014/015/016 (baixa prioridade, avaliar caso a caso) → 017 por último, em estágios, só depois de 010 concluído.

**Uma pergunta direta para o Valmir, fora do escopo mecânico de qualquer plano**: existe algum caller real (hoje ou planejado) que manda `midia_tipo: "audio"` ou `"ptt"` para o `motor-agente`? Não achei nenhum em `worker/`. Se não existir, o caminho em `index.ts:692-703` parece ser resíduo da arquitetura anterior à migração Meta — vale mais **remover** do que proteger com allowlist. A resposta a essa pergunta também decide se o plano 008 é executado ou rejeitado.
