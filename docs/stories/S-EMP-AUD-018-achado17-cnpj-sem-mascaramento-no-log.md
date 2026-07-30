# S-EMP-AUD-018 — CNPJ sem mascaramento no log (achado #17)

**Status:** Ready
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/018-achado17-cnpj-sem-mascaramento-no-log.md`
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 018" — confirmado em `worker/empregabilidade_engine.py:138`
**Prioridade:** P4 | **Esforço:** S | **Risco:** BAIXO
**Ordem de execução proposta:** Bloco 6 — qualquer ordem, sem dependência com os demais

## Contexto

CNPJ aparece completo em texto puro no log (`worker/empregabilidade_engine.py:138`), enquanto o padrão já estabelecido no mesmo arquivo mascara telefone (`phone[:6]` + `"****"`).

## Dependência real

Nenhuma.

## Acceptance Criteria

- [ ] CNPJ mascarado no log, seguindo o mesmo padrão já usado para telefone
- [ ] Suíte completa passando

## Escopo

Ver "Scope" do plano.

## Test plan

Ver "Test plan" do plano.

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 018.
- v0.2 (2026-07-29): @po validou — GO (7/10). Status Draft → Ready. Story pequena e autocontida, AC direto e verificável, risco trivial. Não bloqueante: "Valor de negócio" (compliance/exposição de dado em log) não está em seção própria.
