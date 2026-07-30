# S-EMP-AUD-017 — Cobertura dos 4 branches principais de `_rotear_por_intencao` (achado #16, escopo reduzido)

**Status:** Review
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/017-achado16-cobertura-rotear-por-intencao.md`
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 017" — confirmado que `_rotear_por_intencao` só aparece coberto em `TestFallbackAmbiguoPrimeiroContato` (3 ocorrências) no arquivo committed
**Prioridade:** P3 | **Esforço:** S | **Risco:** BAIXO
**Ordem de execução proposta:** Bloco 6 — qualquer ordem, sem dependência com os demais. Complementar ao Plano 008 (mesma frente de cobertura de teste), mas não bloqueante.

## Contexto

`_rotear_por_intencao` só tem cobertura de teste para o branch de fallback ambíguo — os outros branches principais não têm teste.

## Valor de negócio

Reduz risco de regressão silenciosa no roteador de intenção (`_rotear_por_intencao`) — hoje é o ponto que decide entre 4 caminhos completamente diferentes do bot, e só 1 desses caminhos tem teste.

## Dependência real

Nenhuma dependência hard. Complementa o Plano 008, mas pode ser feito independentemente.

## Acceptance Criteria

- [x] Teste novo cobrindo o branch `intencao == "empresa"` (`:2493`)
- [x] Teste novo cobrindo o branch `intencao == "candidato_vaga"` (`:2498`)
- [x] Teste novo cobrindo o branch `intencao == "banco_talentos"` (`:2548`)
- [x] Teste novo cobrindo o branch `intencao == "upload"` (`:2557`)
- [x] Suíte completa passando (branch `ambiguo` já coberto por `TestFallbackAmbiguoPrimeiroContato`, não precisa de teste novo)

## Escopo

**In:** os 4 branches de `_rotear_por_intencao` citados acima, em `worker/tests/test_empregabilidade_engine.py`.
**Out:** o branch `ambiguo` (já coberto); mudança de comportamento em `_rotear_por_intencao` em si (só teste, sem alterar produção).

## Test plan

Ver "Test plan" do plano.

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 017.
- v0.2 (2026-07-29): @po validou — NO-GO (5/10) por Escopo/Valor de negócio ausentes e AC genérico.
- v0.3 (2026-07-29): @po corrigiu as 3 pendências (4 branches nomeados com linha exata, Valor de negócio adicionado, AC por branch) — GO. Status Draft → Ready.
- v1.0 (2026-07-30): @dev adicionou cobertura dos 4 branches principais de `_rotear_por_intencao`. Status Ready → Review.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `cd worker && ../.venv/bin/python -m pytest tests/test_intencao_detector.py tests/test_empregabilidade_engine.py -v` — 92 passed, 2 warnings preexistentes.

### Completion Notes

- Testes novos cobrem `empresa`, `candidato_vaga`, `banco_talentos` e `upload` sem alterar comportamento de produção do roteador.

### File List

- `worker/tests/test_empregabilidade_engine.py`
