# S-EMP-AUD-012 — N+1 em 2 telas de listagem (achado #9)

**Status:** Draft
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/012-achado09-n-mais-1-listagens.md`
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 012" — confirmado em `worker/empregabilidade_engine.py:1219` e `:1349`
**Prioridade:** P3 | **Esforço:** S | **Risco:** BAIXO
**Ordem de execução proposta:** Bloco 6 — qualquer ordem, sem dependência com os demais. Sugestão de sequência (não bloqueante): depois do Plano 007, que toca código próximo (`_listar_vagas_para_acao`), pra evitar conflito de merge.

## Contexto

2 pontos de listagem fazem consulta dentro de loop (N+1), sem batching.

## Dependência real

Nenhuma dependência real. Sugestão de sequência com o Plano 007 é só cortesia de merge, não bloqueante.

## Acceptance Criteria

- [ ] Os 2 pontos citados (`:1219`, `:1349`) passam a usar batching em vez de consulta dentro de loop
- [ ] Suíte completa passando, sem regressão de comportamento visível

## Escopo

Ver "Scope" do plano.

## Test plan

Ver "Test plan" do plano.

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 012.
