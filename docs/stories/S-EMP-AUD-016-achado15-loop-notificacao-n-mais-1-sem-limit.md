# S-EMP-AUD-016 — Loop de notificação: N+1 de lead + query externa sem `.limit()` (achado #15)

**Status:** Draft
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/016-achado15-loop-notificacao-n-mais-1-sem-limit.md`
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 016" — confirmado em `worker/empregabilidade_engine.py:2606-2608`; volume real hoje é 0 (nota: reflete a limitação de retenção da tabela `conversas`, não confirma ausência histórica de volume — ver seção de abertura do documento de proposta)
**Prioridade:** P3 | **Esforço:** S/M | **Risco:** BAIXO
**Ordem de execução proposta:** Bloco 6 — qualquer ordem, sem dependência com os demais

## Contexto

`empregabilidade_notify_loop` consulta `conversas` sem `.limit()` e faz N+1 de `leads` por conversa — sem paginação, pode crescer sem controle.

## Dependência real

Nenhuma.

## Acceptance Criteria

- [ ] Query de `conversas` com `.limit()` adequado
- [ ] N+1 de `leads` resolvido (batching)
- [ ] Suíte completa passando

## Escopo

Ver "Scope" do plano.

## Test plan

Ver "Test plan" do plano.

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 016.
