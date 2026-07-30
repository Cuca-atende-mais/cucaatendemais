# S-EMP-AUD-003 — `aguardando_retorno_selecao` ganha handler síncrono (BUG-01)

**Status:** InReview
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/003-bug01-aguardando-retorno-selecao-sem-handler.md`
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 003" — confirmamos ao vivo que o lado assíncrono (`empregabilidade_notify_loop`, `:2678-2709`) já lê/escreve `vaga_criada_id`/`vaga_numero` corretamente para o fluxo de seleção (o portal grava esses campos em `selecao/route.ts:84-101`, mesmo padrão de `vagas/route.ts`) — não é código morto, só falta o lado síncrono.
**Prioridade:** P1 | **Esforço:** S | **Risco:** BAIXO-MED
**Ordem de execução proposta:** Bloco 1 (junto com 001, 002) — independente das demais

## Contexto

Falta um handler síncrono para a etapa `aguardando_retorno_selecao` — se o usuário manda mensagem manualmente antes do loop assíncrono (`empregabilidade_notify_loop`, roda a cada 20s) notificar, a mensagem cai em algum handler genérico/errado em vez de ser tratada corretamente.

## Valor de negócio

Evita resposta errada/travada para uma empresa que usa o fluxo de seleção por evento (SQS-49) e manda mensagem manualmente antes do bot notificar — hoje essa mensagem cai num handler genérico.

## Dependência real

Nenhuma. Pode ser implementada isoladamente.

## Acceptance Criteria

- [ ] Handler síncrono adicionado para `aguardando_retorno_selecao`, espelhando o tratamento já existente pra `aguardando_retorno_vaga`
- [ ] Teste confirmando que uma mensagem manual nessa etapa recebe resposta coerente (não cai em handler genérico/errado)
- [ ] Suíte completa passando, sem regressão no lado assíncrono já funcional (`empregabilidade_notify_loop`)

## Escopo

**In:** handler síncrono para a etapa `aguardando_retorno_selecao` em `_processar_empresa` (ou função equivalente), espelhando o padrão já usado por `aguardando_retorno_vaga`.
**Out:** o lado assíncrono (`empregabilidade_notify_loop`), já funcional e não tocado por este plano.

## Test plan

Ver "Test plan" do plano.

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 003.
- v0.2 (2026-07-29): @po validou — NO-GO (5/10) por Escopo/Valor de negócio ausentes e AC genérico.
- v0.3 (2026-07-29): @po corrigiu as 3 pendências (Escopo restatado, Valor de negócio adicionado, AC trocado por asserção testável) — GO. Status Draft → Ready. Critério aplicado de forma consistente com as demais 18 stories nesta rodada.
- v0.4 (2026-07-29): @dev implementou (commit `d4d634d`, branch `feat/auditoria-empregabilidade-p1`). Confirmado que o campo é `vaga_criada_id`/`vaga_numero`/`vaga_titulo` compartilhado com vaga (não existe `selecao_criada_id` próprio) — já sabido da verificação anterior, não foi necessário grep novo. 3 testes novos, mutation check ok. Status → InReview, recomendado @qa.

## QA Results

### Review 2026-07-29 — @qa Quinn — Gate: PASS

**Resultado:** o novo handler síncrono para `aguardando_retorno_selecao` espelha o padrão de `aguardando_retorno_vaga`, preserva `empresa_id`/contexto quando a empresa manda mensagem manual antes do formulário ser concluído, e avança para `menu_pos_vaga` quando o portal já gravou `vaga_criada_id`/`vaga_numero`/`vaga_titulo`. O lado assíncrono não foi tocado.

**Evidência:** `../.venv/bin/python -m pytest tests/test_empregabilidade_engine.py -v` resultou em 34 passed / 3 failed esperados do Bloco 2; os 3 testes de `TestAguardandoRetornoSelecao` passaram, incluindo a regressão de `aguardando_retorno_vaga`.
