# S-EMP-AUD-008 — Cobertura nos 3 fluxos de maior risco + mocks passam a verificar payload (TEST-01 + achado #14)

**Status:** Ready
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/008-test01-emp14-cobertura-fluxos-criticos.md`
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 008" — confirmada ausência de cobertura em `worker/tests/test_empregabilidade_engine.py`, inclusive de `empregabilidade_notify_loop` (também citado no Plano 017)
**Prioridade:** P1 | **Esforço:** M | **Risco:** MED
**Ordem de execução proposta:** Bloco 3 — antes do Bloco 4 (Plano 009). O achado #14 (mocks fracos) foi fundido a este plano por ser o mesmo trabalho (ver `plans/README.md`).

## Contexto

Os 3 fluxos de maior risco do módulo (identificados na auditoria) não têm cobertura de teste adequada, e os mocks existentes não verificam o payload real enviado às chamadas Supabase (podem passar mesmo com dado errado). Isso é pré-requisito de segurança para o refactor grande do Plano 009 (~49 pontos de código tocados).

## Valor de negócio

É pré-requisito de segurança para o refactor grande do Plano 009 (~49 pontos tocados) e para os próprios fixes 001-007 — sem essa rede, uma mudança futura nos 3 fluxos mais sensíveis do arquivo (cancelamento de vaga real, cadastro de empresa real, confirmação de entrevista) pode regredir sem que nenhum teste acuse.

## Dependência real

Nenhuma dependência de entrada. **É pré-requisito hard do Plano 009** — o 009 só deve começar depois deste fechado (ver "Depends on" do plano 009 e do README).

## Acceptance Criteria

- [ ] 6 testes novos (2 por fluxo) cobrindo: `confirmando_cancelamento` (marca vaga como `cancelada`, irreversível), `confirmando_cadastro`/`confirmando_cadastro_com_correcao` (insere empresa real), confirmação/recusa de convite de entrevista (SQS-40 Task 3.4, grava `candidaturas.status`)
- [ ] Helper novo de mock multi-tabela (não existe hoje — `side_effect` por tabela) documentado e reaproveitável
- [ ] Mocks passam a verificar payload via `assert_called_with`/`assert_called_once_with` (hoje 0 ocorrências no arquivo) — não só o efeito final (mensagem enviada, etapa)
- [ ] Suíte completa passando

## Escopo

**In:** `worker/tests/test_empregabilidade_engine.py` — 1 helper novo de mock multi-tabela + 6 testes novos (2 por fluxo). **Nenhuma mudança em código de produção.**
**Out:** os 3 fluxos em si (não são alterados, só testados); qualquer fluxo fora dos 3 citados.

## Test plan

Ver "Test plan" do plano.

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 008.
- v0.2 (2026-07-29): @po validou — NO-GO (5/10) por Escopo/Valor de negócio ausentes e AC genérico.
- v0.3 (2026-07-29): @po corrigiu as 3 pendências (3 fluxos nomeados, Valor de negócio adicionado, AC com os cenários específicos) — GO. Status Draft → Ready.
