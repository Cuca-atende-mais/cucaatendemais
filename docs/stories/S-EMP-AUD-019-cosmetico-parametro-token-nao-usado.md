# S-EMP-AUD-019 — Parâmetro `token` de `_enviar()` nunca usado (cosmético)

**Status:** Ready
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/019-cosmetico-parametro-token-nao-usado.md`
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 019" — confirmado em `worker/empregabilidade_engine.py:96-97`
**Prioridade:** P5 (mais baixa de todas) | **Esforço:** S | **Risco:** NENHUM
**Ordem de execução proposta:** Bloco 6, última — pode ficar por último ou ser descartada se a equipe preferir não gastar um ciclo nisso

## Contexto

`_enviar(instance_name, token, phone, texto, ...)` recebe `token` mas nunca repassa para `_meta_enviar` (autenticação real usa outro mecanismo). Puramente cosmético.

## Valor de negócio

Remove confusão de manutenção: um parâmetro `token` presente na assinatura sugere autenticação por token que não existe de fato — quem for mexer na função pode perder tempo investigando um mecanismo que não é usado.

## Dependência real

Nenhuma.

## Acceptance Criteria

- [ ] Parâmetro `token` removido (ou justificativa registrada para mantê-lo, se algum caller externo depender da assinatura)
- [ ] Suíte completa passando

## Escopo

Ver "Scope" do plano.

## Test plan

Ver "Test plan" do plano.

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 019.
- v0.2 (2026-07-29): @po validou — GO (7/10). Status Draft → Ready. Story trivial e de baixo risco, escopo mínimo o suficiente pra não precisar de mais detalhe.
- v0.3 (2026-07-29): @po adicionou "Valor de negócio" explícito.
