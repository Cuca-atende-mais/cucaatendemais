# S-WM-50 — VAL-19: `decidirConversaEngajada` não distingue cortesia pura de `pergunta_geral` real

## Status
Ready for Review

## Origem
`docs/qa/DIAGNOSTICO-institucional-pendencias-auditoria-2026-07-19.md` (validação @dev Dex contra `origin/main` e produção, 2026-07-20) + `PENDENCIAS-institucional-2026-07-18.md` (sócio) — único item da seção 🔴 (bugs de UX confirmados) que seguia aberto depois da `S-WM-49` resolver VAL-20/VAL-22. Retomado por instrução direta do Junior em 2026-07-20, após pausa para a investigação do RAG institucional por unidade (`docs/qa/INVESTIGACAO-RAG-Institucional-Por-Unidade-2026-07-20.md`) — essa outra frente segue em paralelo, sem dependência entre as duas.

## Complexidade
**XS** — mudança isolada numa função pura já extraída e testada; nenhuma mudança em `handler()`.

## Prioridade
P1 — único bug de UX da leva confirmado como **ativo em produção agora** (não hipotético): confirmado no source deployado da Edge Function `motor-agente` v42, 2026-07-19 20:15 -03.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - deno test --no-check --allow-env --allow-read --allow-net . → mesma contagem de passed (3 testes existentes com asserção/mock corrigidos, ver Dev Notes) + testes novos, 0 failed
  - deno check index.ts → não piora baseline
  - inspeção manual de decidirConversaEngajada → confirma ordem de checagem idêntica à de decidirAguardandoUnidade (pergunta_geral antes do catch-all)
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** que `decidirConversaEngajada` distinga cortesia pura de uma pergunta institucional real, igual as outras 2 funções irmãs já fazem,
**para que** o bot não gaste uma chamada de GPT (com `resumo_rede` + FAQ carregados no prompt) toda vez que o lead manda uma cortesia solta numa conversa já engajada, e a resposta não soe como uma repetição da saudação anterior.

## Contexto e Problema

`decidirConversaEngajada` (`supabase/functions/motor-agente/index.ts:691-713`) é o 3º branch de roteamento de unidade (conversa já engajada — passou por cortesia ou `pergunta_geral` antes, sem `unidade_selecionada` nem `aguardando_unidade` pendentes; introduzido pela S-WM-31). Hoje só tem 2 saídas antes do catch-all:

1. `unidadeDetectada` → resolve a unidade normalmente.
2. `avaliacaoSemantica.pedido_depende_unidade` → pede a unidade (tom de continuação).
3. **Catch-all:** qualquer outra coisa → `perguntaGeralAtiva: true, resposta: null`.

As duas funções irmãs (`decidirAguardandoUnidade`, linha 627-669; `decidirPrimeiraMensagem`, linha 771+) têm uma 3ª saída **antes** do catch-all delas: `if (avaliacaoSemantica.pergunta_geral) { ...segue pro fluxo normal... }`, e só then o catch-all (`!pedido_depende_unidade` → resposta canned "Em que mais posso te ajudar? 😊", sem chamar GPT/RAG). `decidirConversaEngajada` nunca teve essa 3ª checagem — resultado: uma cortesia pura ("tudo bem?", sem unidade, sem pedido concreto, `pergunta_geral=false`) cai no mesmo catch-all que uma pergunta institucional real (`pergunta_geral=true`, ex.: "a rede CUCA é da prefeitura?"), ambas virando `perguntaGeralAtiva=true`.

**Impacto confirmado, não hipotético:** `perguntaGeralAtiva=true` dispara o branch `index.ts:1517-1537`, que carrega `resumo_rede` (documento inteiro) + busca vetorial de FAQ e injeta os dois no prompt antes de chamar `gpt-4o` — 1 chamada real de GPT por cortesia solta, com o mesmo contexto pesado de uma pergunta de rede de verdade. Isso encosta no gargalo de TPM (tokens/minuto da OpenAI) que a auditoria de capacidade (`AUDITORIA-capacidade-institucional-2026-07-18.md`) já mapeou como o ponto mais frágil do sistema — não é custo isolado.

**Confirmado em produção:** puxei o source deployado da function `motor-agente` (v42) nesta investigação — `decidirConversaEngajada` está idêntica ao `origin/main`, sem a checagem de `pergunta_geral`. O bug está ativo agora.

**Compatibilidade com a S-WM-31 (AC3), verificada, não presumida:** a AC3 daquela story diz "cortesia pura OU `pergunta_geral=true`... NÃO repete a saudação nem o menu — responde via o novo 3º branch". Essa AC exige só que as duas não voltem pro branch de 1ª mensagem — não exige que as duas cheguem ao RAG/GPT da mesma forma. O fix desta story continua satisfazendo a AC3 literalmente (nenhuma das duas repete saudação/menu; ambas continuam sendo tratadas pelo 3º branch); só refina o que o 3º branch faz com cada uma, replicando a distinção que as 2 funções irmãs já tinham desde o início. Não é uma reversão de decisão de produto anterior.

## Escopo

### IN
- Adicionar em `decidirConversaEngajada` a checagem `if (!avaliacaoSemantica.pergunta_geral) { return {..., perguntaGeralAtiva: false, resposta: "Em que mais posso te ajudar? 😊"} }` **antes** do catch-all atual — mesmo texto/padrão já usado no branch equivalente de `decidirAguardandoUnidade` (linha 658-663), pra manter tom consistente entre os 3 branches.
- O catch-all final (`perguntaGeralAtiva: true, resposta: null`) só é alcançado quando `pergunta_geral=true` de fato — comportamento correto preservado, sem mudar o texto/lógica desse retorno.
- Atualizar o teste unitário existente que hoje documenta o bug como comportamento esperado (`index.audit.test.ts:341-347`, título atual "nenhum dos dois (cortesia/vago) ativa perguntaGeralAtiva, sem resposta canned") — precisa **reescrever a asserção**, não só adicionar um teste novo ao lado (deixaria 2 testes contraditórios).
- Atualizar o teste de wiring no handler que também documenta o bug (`index.audit.test.ts:351-363`, "AC3: cortesia com conversa_engajada=true deveria seguir pro Passo 6 (RAG geral)") — mesma razão.
- **Achado da validação @po, 2026-07-20:** existe um **3º teste**, de outra story (`S-WM-32`), que quebra com este fix e não estava listado na versão anterior desta story — `index.audit.test.ts:1269-1280` ("S-WM-32 AC2: pergunta de rede dentro de conversa_engajada (3º branch) também carrega resumo_rede + FAQ"). O mock desse teste usa `pergunta_geral: false` pra mensagem "quais unidades ensinam karatê?" — hoje isso só funciona porque o catch-all buggy de `decidirConversaEngajada` ativa `perguntaGeralAtiva=true` mesmo com `pergunta_geral=false`. Os 2 testes irmãos (mesma S-WM-32) pro branch `1ª mensagem` (linha 1226-1244) e pro branch `aguardando_unidade` (linha 1254-1265) já usam `pergunta_geral: true` corretamente — só o de `conversa_engajada` ficou com o mock desalinhado, mascarado pelo próprio bug do VAL-19. Corrigir o mock desse teste pra `pergunta_geral: true` (consistente com os 2 irmãos e com o que o classificador real, já reforçado pela VAL-22, provavelmente retornaria pra essa frase) — não é regressão, é o mock ficando correto.
- Teste novo: cortesia pura (`pergunta_geral=false, pedido_depende_unidade=false`, sem unidade) em `decidirConversaEngajada` → `perguntaGeralAtiva=false`, `resposta` = canned, sem null.
- Teste de regressão: `pergunta_geral=true` real → `perguntaGeralAtiva=true`, `resposta=null` (comportamento correto preservado).
- Teste de wiring no handler (mesmo padrão do teste que será reescrito): cortesia pura com `conversa_engajada=true` → **NÃO** chama `rpc:buscar_chunks_similares` nem lê `documentos_rag` (prova que `resumo_rede`/FAQ não são carregados à toa).

### OUT
- **Nenhuma mudança em `handler()`** — o branch que consome `decisaoEngajada.resposta !== null` (`index.ts:1339-1344`) já faz early-return sem RAG/GPT corretamente; a mudança fica inteiramente dentro da função pura.
- Consolidação das 4 funções de decisão de unidade (Plano 017 / recomendação do `RELATORIO-5`) — decisão de produto separada, região de risco ALTO (histórico de bug de estado cruzado, S-WM-21), não reabrir agora.
- Qualquer parte do RAG institucional por unidade (`INVESTIGACAO-RAG-Institucional-Por-Unidade-2026-07-20.md`) — investigação paralela, ainda aguardando decisão do sócio, sem dependência técnica com esta story.
- `quer_sair` — `decidirConversaEngajada` não tem esse branch (diferente de `decidirAguardandoUnidade`); não é escopo desta story adicionar (não fazia parte do achado VAL-19, mudança não solicitada).
- Deploy automático.

## Acceptance Criteria

1. **Given** `decidirConversaEngajada` chamada com `unidade=null`, `pedido_depende_unidade=false`, `pergunta_geral=false` (cortesia pura, ex.: "tudo bem?"), **when** avaliada, **then** retorna `perguntaGeralAtiva=false` e `resposta` igual ao canned de continuação usado em `decidirAguardandoUnidade` (não `null`).
2. **Given** a mesma função chamada com `pergunta_geral=true` (pergunta institucional real, ex.: "a rede CUCA é da prefeitura?"), **when** avaliada, **then** retorna `perguntaGeralAtiva=true`, `resposta=null` — comportamento idêntico ao atual, sem regressão.
3. **Given** `pedido_depende_unidade=true` ou `unidadeDetectada` presente, **when** avaliada, **then** comportamento inalterado (regressão coberta pelos testes já existentes, sem necessidade de reescrever).
4. **Given** o handler completo com `conversa_engajada=true` e uma mensagem de cortesia pura, **when** processado (mock), **then** **não** dispara `rpc:buscar_chunks_similares` nem leitura de `documentos_rag` — prova que `resumo_rede`/FAQ não são carregados à toa.
5. **Given** o mesmo handler com `conversa_engajada=true` e `pergunta_geral=true` real, **when** processado (mock), **then** o caminho de RAG geral continua funcionando normalmente (regressão do comportamento correto).
6. Os **3** testes que hoje documentam o comportamento antigo (bug) como esperado ou dependem dele — `index.audit.test.ts:341-347`, `:351-363` e `:1269-1280` (este último da S-WM-32, achado na validação @po) — são **atualizados** (asserção/mock corrigidos), não deixados contraditórios com testes novos ao lado.
7. `deno test` → sem `failed` novo (contagem pode variar por causa da reescrita do item 6, mas sem regressão real).
8. `deno check index.ts` não piora vs. baseline.
9. Nenhum deploy é executado por esta story.

## Tasks / Subtasks

- [x] **Task 1 — Fix em `decidirConversaEngajada`** (AC: 1, 2, 3)
  - [x] Adicionar a checagem `!pergunta_geral` antes do catch-all, mesmo texto canned de `decidirAguardandoUnidade`.
  - [x] Confirmar que `unidadeDetectada` e `pedido_depende_unidade` continuam com o mesmo comportamento (sem mudança de código nesses branches).
- [x] **Task 2 — Testes unitários** (AC: 1, 2, 6)
  - [x] Reescrever a asserção de `index.audit.test.ts:341-347` (cortesia pura → agora `perguntaGeralAtiva=false` + resposta canned).
  - [x] Adicionar teste de regressão explícito para `pergunta_geral=true` (novo teste unitário dedicado, ao lado do reescrito).
- [x] **Task 3 — Teste de wiring no handler** (AC: 4, 5, 6)
  - [x] Reescrever `index.audit.test.ts:351-363` (cortesia + `conversa_engajada=true` → agora NÃO deveria chegar no RAG).
  - [x] Corrigir o mock de `index.audit.test.ts:1269-1280` (S-WM-32) de `pergunta_geral: false` para `pergunta_geral: true` — sem isso, este teste passa a falhar (resumo_rede deixaria de carregar pra esse mock, já que o catch-all buggy que hoje o fazia "passar" deixa de existir).
  - [x] Confirmado teste de regressão pra `pergunta_geral=true` real chegando no RAG normalmente — o próprio teste da S-WM-32 corrigido acima já cobre esse caso (conversa_engajada=true + pergunta_geral=true real → resumo_rede chega no prompt), não foi necessário duplicar.
- [x] **Task 4 — Fechamento** (AC: 7, 8, 9)
  - [x] Rodar suíte completa, registrar contagem antes/depois no Dev Agent Record.
  - [x] `deno check index.ts`, confirmar sem piora de baseline.
  - [x] Confirmar nenhum deploy/push executado.

## Dev Notes

- Base: `origin/main` pós-`S-WM-49` (commit `66db37f`).
- **Nenhuma mudança em `handler()` é necessária** — confirmado nesta investigação: o branch `index.ts:1339-1344` (`decisaoEngajada.resposta !== null`) já faz early-return correto (grava metadata, salva mensagem, retorna — sem tocar RAG/GPT) para qualquer `resposta` não-nula que `decidirConversaEngajada` devolva. A mudança fica 100% dentro da função pura.
- **Atenção ao reescrever os 2 testes da S-WM-31** (`index.audit.test.ts:341-347` e `:351-363`): eles não são testes "esquecidos" — foram escritos deliberadamente pra documentar o comportamento então considerado correto. Reescrever a asserção é o objetivo desta story, não um efeito colateral a evitar.
- **3º teste, de outra story, achado na validação @po:** `index.audit.test.ts:1269-1280` (S-WM-32) usa um mock com `pergunta_geral: false` pra uma pergunta que, na prática, deveria ser rede-inteira (`"quais unidades ensinam karatê?"`) — só "passava" hoje porque o catch-all buggy do VAL-19 não olhava pra esse campo. Os 2 testes irmãos da mesma S-WM-32 (branches `1ª mensagem` e `aguardando_unidade`, linhas 1226-1265) já usam `pergunta_geral: true` corretamente — alinhar este 3º ao mesmo padrão. Sem esse ajuste, este teste específico vira `failed` depois do fix, mesmo sem nenhuma regressão real de comportamento.
- Texto canned recomendado (consistência com `decidirAguardandoUnidade:661`): `"Em que mais posso te ajudar? 😊"` — mesma string, mesmo tom de continuação (nunca `SAUDACOES_ABERTURA` aqui, a conversa já está em andamento — regra já vale pro branch inteiro, sem mudança).
- `quer_sair` não existe em `decidirConversaEngajada` hoje (diferente de `decidirAguardandoUnidade`) — fora de escopo, não introduzir nesta story sem pedido explícito.

### Testing
- `deno test --no-check --allow-env --allow-read --allow-net .` em `supabase/functions/motor-agente`.

## Dependências
- Nenhuma dependência técnica com a investigação do RAG institucional por unidade (`INVESTIGACAO-RAG-Institucional-Por-Unidade-2026-07-20.md`) — podem seguir em paralelo, confirmado explicitamente pelo Junior ao retomar esta story.
- Consolidação das 4 funções (Plano 017) permanece fora de escopo e não é pré-requisito.

## Riscos
- Baixo — mudança isolada numa função pura já coberta por suíte de testes; sem alteração de schema, sem alteração de `handler()`, sem mudança de contrato de nenhuma outra função.
- Único risco real: esquecer de atualizar os 3 testes existentes (2 da S-WM-31 + 1 da S-WM-32, achado na validação @po) que hoje travam o comportamento antigo ou dependem dele — faria a suíte falhar (não é regressão silenciosa — falha visível, mas vale registrar como ponto de atenção pro @dev não se surpreender, em especial o teste da S-WM-32 por estar fora do arquivo/região onde o achado original (VAL-19) foi confirmado).

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-20 | 0.1 | Story criada a partir do achado VAL-19, confirmado em código e produção pelo @dev Dex (`DIAGNOSTICO-institucional-pendencias-auditoria-2026-07-19.md`) e validado tecnicamente (correção de baixo risco, sem mudança em `handler()`). Retomada após pausa para investigação paralela do RAG institucional por unidade, sem dependência entre as duas. | @sm River |
| 2026-07-20 | 0.2 | @po validate-story-draft: **GO condicional, correção já aplicada nesta mesma passada.** 9/10 pontos ok de cara (título objetivo, contexto completo com refs de código, AC testáveis, IN/OUT bem definidos, complexidade/prioridade justificadas, riscos documentados, alinhado ao diagnóstico e à S-WM-31/S-WM-49). 1 ponto exigiu correção antes do GO: revalidei os testes existentes que a story dizia precisar reescrever e achei um **3º teste não listado**, de outra story (`S-WM-32`, `index.audit.test.ts:1269-1280`) — mock com `pergunta_geral: false` que só "passa" hoje por causa do próprio bug do VAL-19, inconsistente com os 2 testes irmãos da mesma S-WM-32 (que já usam `pergunta_geral: true` corretamente). Sem essa correção, a story teria sido aprovada incompleta e o @dev só descobriria o teste quebrado (de outro arquivo/story) rodando a suíte depois do fix, sem contexto do porquê. Corrigido: Escopo IN, AC6, Task 3, Dev Notes e Riscos atualizados para cobrir os 3 testes (não 2). Status Draft → Ready. | @po Pax |
| 2026-07-20 | 0.3 | Implementado o fix em `decidirConversaEngajada` (checagem `pergunta_geral` antes do catch-all, mesmo padrão de `decidirAguardandoUnidade`). Reconfirmei a compatibilidade com AC3 da S-WM-31 antes de codar. Corrigidos os 3 testes mapeados (2 da S-WM-31 + 1 da S-WM-32) + 1 teste novo de regressão unitária. Suíte: 176→177 passed, 0 failed, 2 ignored. `deno check`: 36 erros, idêntico ao baseline. `deno lint`: 7 problemas, idêntico ao baseline. Nenhuma mudança em `handler()`. Status Ready → Ready for Review. | @dev Dex |

## Dev Agent Record

### Debug Log References

- Reconfirmei eu mesmo (não só herdando a validação do @po) a compatibilidade com a AC3 da S-WM-31 antes de implementar: li o texto exato da AC3 (`docs/stories/S-WM-31-...md:107`) — exige só "não repete SAUDACOES_ABERTURA nem o menu", nunca exigiu "sempre chamar RAG". O fix continua satisfazendo isso literalmente.
- Baseline ANTES do fix: `deno test --no-check --allow-env --allow-read --allow-net .` → 176 passed / 0 failed / 2 ignored. `deno check index.ts` → 36 erros. `deno lint index.ts index.test.ts index.audit.test.ts` → 7 problemas (baseline conhecido, mesmo da S-WM-49).
- Fix aplicado em `decidirConversaEngajada` (`index.ts:709-721`): 1 `if` novo antes do catch-all, mesmo texto/padrão de `decidirAguardandoUnidade`. Diff mínimo, conferido via `git diff` — nenhuma linha tocada fora da função.
- 3 testes existentes corrigidos, conforme mapeado pela validação @po: os 2 da S-WM-31 (`index.audit.test.ts`, cortesia pura unitário + wiring no handler) e o 1 da S-WM-32 (mock `pergunta_geral` corrigido de `false` para `true` em "quais unidades ensinam karatê?").
- 2 testes novos adicionados: regressão unitária `pergunta_geral=true` em `decidirConversaEngajada`, e asserção reforçada no teste de wiring (cortesia pura não lê `documentos_rag` nem chama `rpc:buscar_chunks_similares`, e a resposta do handler é o canned exato).
- DEPOIS do fix: `deno test --no-check --allow-env --allow-read --allow-net .` → **177 passed / 0 failed / 2 ignored** (era 176; net +1 — 2 testes reescritos no lugar + 1 novo genuíno). `deno check index.ts` → **36 erros**, idêntico ao baseline, nenhum erro novo. `deno lint` → **7 problemas**, idêntico ao baseline, nenhum novo.
- Nenhuma mudança em `handler()` — confirmado via `git diff`, só `index.ts` (função pura) e `index.audit.test.ts` foram tocados.

### Completion Notes List

- `decidirConversaEngajada` agora distingue cortesia pura (`pergunta_geral=false`) de pergunta institucional real (`pergunta_geral=true`), mesmo padrão de `decidirAguardandoUnidade`/`decidirPrimeiraMensagem`: cortesia pura responde com canned "Em que mais posso te ajudar? 😊" sem tocar RAG/GPT; `pergunta_geral=true` real continua seguindo pro Passo 6 normalmente.
- Nenhuma mudança em `handler()` foi necessária — o branch que já consome `resposta !== null` (`index.ts:1339-1344`) cobre o novo caso automaticamente.
- Achado da validação @po (teste da S-WM-32 com mock desalinhado) confirmado e corrigido durante a implementação — sem esse ajuste a suíte teria 1 `failed` inesperado, de outra story.
- Nenhum deploy/push executado por @dev — commit local, aguardando @qa.

### File List

- `supabase/functions/motor-agente/index.ts`
- `supabase/functions/motor-agente/index.audit.test.ts`
- `docs/stories/S-WM-50-VAL-19-DecidirConversaEngajada-Pergunta-Geral.md`

## QA Results

### Review Date: 2026-07-20

### Reviewed By: @qa Quinn

### Gate Decision

**PASS** — implementação aprovada para seguir para @devops.

### Requirements Traceability

- AC1 (cortesia pura → `perguntaGeralAtiva=false` + canned): coberto por `VAL-19 (S-WM-50): decidirConversaEngajada — cortesia pura (pergunta_geral=false) recebe resposta canned, NÃO ativa perguntaGeralAtiva` — validado.
- AC2 (`pergunta_geral=true` real → comportamento preservado): coberto por `VAL-19 (S-WM-50): decidirConversaEngajada — pergunta_geral=true real continua ativando perguntaGeralAtiva (regressão)` — validado.
- AC3 (`pedido_depende_unidade`/`unidadeDetectada` inalterados): os 2 testes já existentes (`S-WM-31: decidirConversaEngajada — unidade detectada...` e `...pedido_depende_unidade=true...`) continuam passando sem alteração — validado por inspeção + execução.
- AC4 (handler + cortesia pura → não chama RAG/`documentos_rag`): coberto por `VAL-19 (S-WM-50): conversa_engajada=true + cortesia pura → early-return canned...` — validado, inclusive com asserção nova (`leuDocumentosRag=false`) que o teste anterior não tinha.
- AC5 (handler + `pergunta_geral=true` real → RAG geral funciona): coberto pelo teste corrigido da S-WM-32 (`pergunta de rede dentro de conversa_engajada... também carrega resumo_rede + FAQ`) — validado.
- AC6 (3 testes atualizados, não deixados contraditórios): conferido via `git show` do diff — os 2 testes da S-WM-31 foram reescritos no lugar (não duplicados) e o mock da S-WM-32 foi corrigido inline. Nenhum teste contraditório na suíte.
- AC7 (deno test sem failed novo): validado, **177 passed / 0 failed / 2 ignored** (baseline era 176/0/2 — net +1: 2 reescritos no lugar + 1 unitário genuinamente novo).
- AC8 (deno check não piora): validado, **36 erros**, idêntico ao baseline pré-existente (mesmo count registrado na S-WM-49).
- AC9 (sem deploy): confirmado — `git status -sb` mostra branch local 1 commit à frente de `origin`, nenhum push executado.

### Verificação independente (não apenas conferência do relatado pelo @dev)

- **Mutation test**: revertei temporariamente `decidirConversaEngajada` pra versão anterior (`git show HEAD~1:...index.ts`) e rodei a suíte — os 2 testes que deveriam pegar a regressão **falharam exatamente como esperado** (`VAL-19 ... cortesia pura ... recebe resposta canned` e `VAL-19 ... conversa_engajada=true + cortesia pura ...`), enquanto o teste de regressão (`pergunta_geral=true`) e o teste corrigido da S-WM-32 continuaram passando (não dependem do fix, só do mock correto). Restaurei a versão corrigida em seguida — suíte voltou a 177/0/2. Prova que os testes novos/reescritos não são tautológicos.
- Conferi `git diff` linha a linha de `index.ts`: só a função `decidirConversaEngajada` foi tocada (13 linhas adicionadas), nenhuma mudança em `handler()` — consistente com o Escopo OUT da story.
- `grep` por todos os consumidores de `decidirConversaEngajada` no repo (worker Python incluso): só `handler()` (linha 1343, não alterada) e o próprio arquivo de teste — nenhum consumidor externo à Edge Function.
- Reconferi a string do canned response caractere-por-caractere contra `decidirAguardandoUnidade:661` — idênticas.
- Rodei eu mesmo `deno test`, `deno check` e `deno lint` (não confiei só no Dev Agent Record) — todos batem com o reportado.

### Risk Assessment

- Risco funcional: baixo. Mudança isolada numa função pura já coberta por suíte extensa; mutation test confirma cobertura real, não só de forma.
- Risco de regressão cruzada: baixo. Único consumidor é `handler()`, não alterado; único outro achado de acoplamento (teste da S-WM-32) já identificado e corrigido antes da implementação (achado do @po), não durante o QA.
- Segurança: N/A — nenhuma entrada de usuário nova, nenhuma interpolação de string, resposta canned é literal estático.
- Performance: melhora (remove 1 chamada de GPT + carregamento de `resumo_rede`/FAQ por mensagem de cortesia pura em conversa engajada) — consistente com o objetivo da story.
- Banco/produção: nenhuma mudança de schema, migration ou RLS — fix é 100% código de aplicação (Edge Function).

### Evidence

- `deno test --no-check --allow-env --allow-read --allow-net .` → 177 passed / 0 failed / 2 ignored.
- `deno check index.ts` → 36 erros (idêntico ao baseline).
- `deno lint index.ts index.test.ts index.audit.test.ts` → 7 problemas (idêntico ao baseline).
- Mutation test (reversão temporária de `index.ts` para `HEAD~1`): 2 testes falham como esperado, suíte volta a 175/2/2; restaurado, suíte volta a 177/0/2.
- `git status -sb`: branch local 1 commit à frente de `origin`, sem push.

### Notes

- Não há bloqueio para PR.
- `supabase/functions/motor-agente/index.ts` foi alterado — @devops deve redeployar a Edge Function `motor-agente` ao promover, conforme já observado na S-WM-49.
- Nenhuma ação de banco/migration necessária nesta story.
