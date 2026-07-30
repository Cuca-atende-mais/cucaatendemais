# S-EMP-AUD-008 — Cobertura nos 3 fluxos de maior risco + mocks passam a verificar payload (TEST-01 + achado #14)

**Status:** Draft
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/008-test01-emp14-cobertura-fluxos-criticos.md`
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 008" — confirmada ausência de cobertura em `worker/tests/test_empregabilidade_engine.py`, inclusive de `empregabilidade_notify_loop` (também citado no Plano 017)
**Prioridade:** P1 | **Esforço:** M | **Risco:** MED
**Ordem de execução proposta:** Bloco 3 — antes do Bloco 4 (Plano 009). O achado #14 (mocks fracos) foi fundido a este plano por ser o mesmo trabalho (ver `plans/README.md`).

## Contexto

Os 3 fluxos de maior risco do módulo (identificados na auditoria) não têm cobertura de teste adequada, e os mocks existentes não verificam o payload real enviado às chamadas Supabase (podem passar mesmo com dado errado). Isso é pré-requisito de segurança para o refactor grande do Plano 009 (~49 pontos de código tocados).

## Dependência real

Nenhuma dependência de entrada. **É pré-requisito hard do Plano 009** — o 009 só deve começar depois deste fechado (ver "Depends on" do plano 009 e do README).

## Acceptance Criteria

- [ ] Cobertura adicionada nos 3 fluxos de maior risco identificados na auditoria
- [ ] Mocks passam a verificar payload (não só que a chamada aconteceu)
- [ ] Suíte completa passando

## Escopo

Ver "Scope" do plano.

## Test plan

Ver "Test plan" do plano.

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 008.
