# S-WM-52 — Merge atômico de `conversas.metadata` via RPC (não mais overwrite de coluna inteira)

## Status
Draft

## Origem
Investigação "Corrida da Juventude" (disparo de 724 leads, 24/07/2026) — `docs/qa/DIAGNOSTICO-disparo-corrida-juventude-2026-07-27.md`, achado arquitetural nº 1 (seção 4). Plano técnico completo, com o diff exato linha-a-linha (**dry-run verificado ao vivo** num worktree descartável: 196/196 testes passando antes de escrever o plano), preservado integralmente em `docs/qa/planos-corrida-juventude/006-merge-atomico-metadata-conversas.md` — usar esse arquivo como referência técnica primária (Steps, Verify, STOP conditions), não este resumo. Elaborado em 2026-07-26 (commit base `256d547`). Formalizada em story por @sm em 2026-07-27, setup de teste ("Equipe Interna — QA") já criado e confirmado.

## Complexidade
**M** — 14 pontos de call-site idênticos (substituição mecânica) + 9 assertions de teste a migrar + 1 migration nova. Mecânico, mas superfície ampla (edge function que atende todo o tráfego institucional).

## Prioridade
P1 — bug de corrida de dados (lost update) que hoje pode apagar, silenciosamente, qualquer campo gravado por outro processo (`worker/campanhas_engine.py`) enquanto uma requisição do motor-agente para o mesmo lead está em andamento.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - cd supabase/functions/motor-agente && deno test --no-check --allow-net --allow-env --allow-read . → 196 passed | 0 failed | 2 ignored (baseline inalterada — este plano não adiciona/remove teste, só muda o que 9 já existentes verificam)
  - grep -c "await supabase.from('conversas').update({ metadata: metadataAtual })" index.ts → 0
  - grep -c "await supabase.rpc('merge_conversa_metadata'" index.ts → 14
  - grep -n 'metodo === "update"' index.audit.test.ts → só a linha de "mensagens" deve sobrar
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** que a gravação de `conversas.metadata` no `motor-agente` seja um merge atômico no banco em vez de "ler uma vez, sobrescrever a coluna inteira até 14 vezes por request",
**para que** uma escrita concorrente do worker (ex.: breadcrumb de disparo) nunca seja apagada por uma requisição do motor-agente que já estava em andamento pro mesmo lead.

## Contexto e Problema

`conversas.metadata` (JSONB) é escrita por **3 processos concorrentes** que compartilham o mesmo número Institucional: o `motor-agente` (edge function) e dois caminhos do worker (`_processar_item_disparo_interno` e, após a S-WM-56/Plano 005, `_processar_disparo_divulgacao_interno`), ambos via `_gravar_breadcrumb_disparo`.

`supabase/functions/motor-agente/index.ts` lê `conversa.metadata` **1 única vez**, no início do request (linha 1277: `let metadataAtual = conversa?.metadata || {}`), e ao longo dos segundos seguintes (chamadas GPT + lógica de negócio) grava esse snapshot em memória de volta no banco **14 vezes**, sempre com a mesma linha literal:

```typescript
await supabase.from('conversas').update({ metadata: metadataAtual }).eq('id', conversa.id);
```

`.update()` do PostgREST **substitui a coluna inteira** — não faz merge de JSONB. Se o worker gravar `metadata.ultimo_disparo` **enquanto** um request do motor-agente pro mesmo lead já está em voo (rotineiro: debounce 10s + latência de GPT), o próximo dos 14 `.update()` apaga esse campo, porque o snapshot em memória nunca o teve. É a mesma classe de bug do achado #3/Plano 004 (S-WM-55), só que aqui com **14 pontos de exposição** em vez de 1.

Confirmado por `grep -c` contra o commit `256d547`: exatamente 14 ocorrências, linhas 1287, 1304, 1341, 1360, 1376, 1384, 1403, 1417, 1422, 1442, 1461, 1475, 1482, 1536.

**Este diff foi efetivamente executado** (não é só desenhado) num worktree descartável antes deste plano ser escrito: `deno test` rodou 196 passed / 0 failed / 2 ignored, idêntico à baseline.

## Escopo

### IN
1. **Migration** `supabase/migrations/20260726000000_merge_atomico_metadata_conversas.sql` — nova função `public.merge_conversa_metadata(p_conversa_id uuid, p_patch jsonb)`, `LANGUAGE sql`, fazendo `UPDATE conversas SET metadata = COALESCE(metadata, '{}'::jsonb) || p_patch WHERE id = p_conversa_id` (estilo igual ao exemplar `claim_evento_pontual`/`claim_ouvidoria_evento` de `20260706000000_claim_atomico_disparos_race_condition.sql` — sem `SECURITY DEFINER`, sem `search_path`).
2. Substituir, mecanicamente, as **14 ocorrências** de `await supabase.from('conversas').update({ metadata: metadataAtual }).eq('id', conversa.id);` por `await supabase.rpc('merge_conversa_metadata', { p_conversa_id: conversa.id, p_patch: metadataAtual });` em `supabase/functions/motor-agente/index.ts`. A lógica que monta `metadataAtual` em memória (os spreads `{ ...metadataAtual, campo: valor }`) **não muda** — só o `.update()` final.
3. Migrar as **9 assertions** de `index.audit.test.ts` que hoje checam `c.tabela === "conversas" && c.metodo === "update"` para checar `c.tabela === "rpc:merge_conversa_metadata"` (o mock harness já suporta `.rpc()` nativamente, registrando `{ tabela: "rpc:"+nome, args }` — não precisa mudar o harness). Sites: 372, 386, 406, 420, 434, 899, 919+921, 942+944, 1845, 2350 — o antes/depois exato de cada padrão está documentado no plano original (ver Dev Notes).
4. Aplicar a migration em produção via `apply_migration` (MCP Supabase), seguindo a exceção vigente de banco (`.claude/rules/cuca-deploy-environments.md`).

### OUT
- `worker/campanhas_engine.py` / `worker/tests/test_campanhas_engine.py` — território da S-WM-55 (Plano 004) e S-WM-56 (Plano 005). Não migrar `_gravar_breadcrumb_disparo` para chamar essa mesma RPC como parte desta story (fica anotado como follow-up).
- Os 43 erros pré-existentes de `deno test` com type-check (`--no-check` é obrigatório e não esconde regressão desta story — confirmado na baseline antes do plano).
- `supabase/functions/motor-agente/index.test.ts` — não mocka o handler, não toca `conversas`, confirmar que `grep -c "conversas" index.test.ts` continua `0`.
- A lógica de montagem de `metadataAtual` em memória — só o `.update()`/`.rpc()` final muda.
- Linha 1806-1807 (`conversas.update({status: ...})`, sem `metadata`) e qualquer outra escrita de `conversas` que não toque `metadata`.

## Acceptance Criteria

1. **Given** a migration aplicada, **when** dois patches diferentes (ex.: `{unidade_selecionada: X}` de um processo e `{ultimo_disparo: Y}` de outro) chegam via `merge_conversa_metadata` para a mesma conversa, **then** ambos os campos coexistem em `metadata` — nenhum apaga o outro.
2. **Given** o código de `index.ts` após a Task 2, **then** `grep -c` confirma 0 ocorrências do `.update()` antigo e 14 ocorrências da nova chamada `.rpc('merge_conversa_metadata'`.
3. **Given** os 9 sites de teste migrados, **when** `deno test` roda, **then** `196 passed | 0 failed | 2 ignored` — mesma contagem da baseline, nenhuma regressão.
4. **Given** a assertion de "não deveria gravar nada" (linha ~1845), **when** revisada, **then** também cobre o novo formato RPC (não fica um false-negative que passaria mesmo se o código gravasse via RPC indevidamente).
5. Nenhum 15º call site com variável diferente de `metadataAtual` é "corrigido às cegas" — se encontrado, é um achado novo, reportado, não aplicado sem revisão.
6. Nenhum arquivo fora do escopo (`index.ts`, `index.audit.test.ts`, a migration) é modificado.

## Tasks / Subtasks

- [ ] **Task 1 — Migration** (AC: 1)
  - [ ] Criar `supabase/migrations/20260726000000_merge_atomico_metadata_conversas.sql` com `merge_conversa_metadata`.
  - [ ] Aplicar via `apply_migration` (MCP Supabase, produção `cuca`).
  - [ ] Confirmar por `execute_sql` que a função existe e resolve merge sem apagar chave não mencionada (teste manual com 2 patches).
- [ ] **Task 2 — 14 call sites** (AC: 2, 5)
  - [ ] Drift check: `grep -c` do literal antigo → deve dar exatamente 14 antes de começar. Se diferente, HALT e reportar.
  - [ ] Substituição mecânica única (find-and-replace-all) — não tratar nenhum site diferente.
  - [ ] Confirmar 0/14 via grep pós-mudança.
- [ ] **Task 3 — 9 assertions de teste** (AC: 3, 4)
  - [ ] Migrar os 6 sites do padrão `.some(...)` (372, 386, 406, 420, 434, 2350).
  - [ ] Migrar o site de contagem (899) e os 2 sites de "filter + último update" (919/921, 942/944).
  - [ ] Estender a assertion negativa (1845) para cobrir também `rpc:merge_conversa_metadata`.
  - [ ] Rodar suíte completa → 196/0/2.
- [ ] **Task 4 — Fechamento**
  - [ ] `git status` confirma só os 3 arquivos em escopo modificados.
  - [ ] File List e Change Log atualizados.
  - [ ] Anunciar conclusão e recomendar @qa.

## Dev Notes

- Diff completo, código antes/depois de cada um dos 9 sites de teste, comandos de verificação linha por linha: **`docs/qa/planos-corrida-juventude/006-merge-atomico-metadata-conversas.md`** (plano original, 2026-07-26, base commit `256d547`) — ler esse arquivo por completo antes de editar, os padrões de find/replace exatos (Steps 1-3) estão lá, não reproduzidos aqui.
- Drift check obrigatório antes de começar: `git diff --stat 256d547..HEAD -- supabase/functions/motor-agente/index.ts supabase/functions/motor-agente/index.audit.test.ts`. Se qualquer um mudou desde 2026-07-26, reconferir os trechos "Estado atual" contra o código ao vivo antes de prosseguir.
- Residual conhecido, aceito: a RPC resolve last-write-wins por chave — se dois processos escrevem a **mesma** chave quase ao mesmo tempo, não há fila/versão, só garante que chaves *diferentes* nunca se apagam. Isso é uma janela muito mais estreita que o bug corrigido aqui (hoje QUALQUER dos 14 writes apaga QUALQUER write concorrente, independente da chave).
- Sem dependência técnica com S-WM-55/S-WM-56/S-WM-57 (arquivos diferentes) — pode rodar em paralelo com qualquer uma delas.

### Testing
`cd supabase/functions/motor-agente && deno test --no-check --allow-net --allow-env --allow-read .`

## Dependências
Nenhuma — pode começar a qualquer momento, em paralelo com as demais stories desta leva.

## Git workflow
Branch: `fix/merge-atomico-metadata-conversas`. Commit único: `fix(motor-agente): grava metadata de conversas via merge atomico no banco, nao mais update de coluna inteira`. Não dar push/PR sem autorização explícita (fluxo `@devops`).

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-27 | 0.1 | Story criada a partir do Plano 006 (investigação "Corrida da Juventude", 2026-07-26), diff dry-run verificado antes da escrita do plano. 1ª story da leva (execução independente). | @sm River |

## Dev Agent Record
_A ser preenchido pelo @dev durante a implementação._

## QA Results
_A ser preenchido pelo @qa após a implementação._
