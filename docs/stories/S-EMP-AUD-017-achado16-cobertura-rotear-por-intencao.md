# S-EMP-AUD-017 — Cobertura dos 4 branches principais de `_rotear_por_intencao` (achado #16, escopo reduzido)

**Status:** Draft
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/017-achado16-cobertura-rotear-por-intencao.md`
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 017" — confirmado que `_rotear_por_intencao` só aparece coberto em `TestFallbackAmbiguoPrimeiroContato` (3 ocorrências) no arquivo committed
**Prioridade:** P3 | **Esforço:** S | **Risco:** BAIXO
**Ordem de execução proposta:** Bloco 6 — qualquer ordem, sem dependência com os demais. Complementar ao Plano 008 (mesma frente de cobertura de teste), mas não bloqueante.

## Contexto

`_rotear_por_intencao` só tem cobertura de teste para o branch de fallback ambíguo — os outros branches principais não têm teste.

## Dependência real

Nenhuma dependência hard. Complementa o Plano 008, mas pode ser feito independentemente.

## Acceptance Criteria

- [ ] Cobertura adicionada para os 4 branches principais de `_rotear_por_intencao` (escopo reduzido, ver plano)
- [ ] Suíte completa passando

## Escopo

Ver "Scope" do plano.

## Test plan

Ver "Test plan" do plano.

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 017.
- v0.2 (2026-07-29): @po validou — NO-GO (5/10). Permanece em Draft. Pendências: (1) "Escopo" só remete ao plano — nomear os 4 branches diretamente; (2) "Valor de negócio" ausente; (3) AC genérico ("Cobertura adicionada") — trocar por nomes de teste/cenário esperados.
