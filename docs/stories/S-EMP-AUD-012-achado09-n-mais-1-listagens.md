# S-EMP-AUD-012 — N+1 em 2 telas de listagem (achado #9)

**Status:** Review
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/012-achado09-n-mais-1-listagens.md`
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 012" — confirmado em `worker/empregabilidade_engine.py:1219` e `:1349`
**Prioridade:** P3 | **Esforço:** S | **Risco:** BAIXO
**Ordem de execução proposta:** Bloco 6 — qualquer ordem, sem dependência com os demais. Sugestão de sequência (não bloqueante): depois do Plano 007, que toca código próximo (`_listar_vagas_para_acao`), pra evitar conflito de merge.

## Contexto

2 pontos fazem consulta dentro de loop (N+1), sem batching: `:1219-1237` (listagem de vagas da empresa — pra cada vaga, até 10, 1 query separada em `candidaturas` só pra contar candidatos) e `:1349-1352` (busca de candidatura por nome — pra cada candidatura encontrada, até 5, 1 query separada em `vagas` só pra pegar o título).

## Valor de negócio

Reduz latência e carga no banco nas 2 telas de listagem mais usadas pela empresa (consultar vagas cadastradas, buscar candidatura) — hoje cada listagem gera até 10 queries extras.

## Dependência real

Nenhuma dependência real. Sugestão de sequência com o Plano 007 é só cortesia de merge, não bloqueante.

## Acceptance Criteria

- [x] `:1219-1237` — contagem de candidatos por vaga vira 1 query batelada (ex.: `.in_("vaga_id", [ids])` + agrupamento em Python), não mais 1 por vaga
- [x] `:1349-1352` — título de vaga por candidatura vira 1 query batelada, não mais 1 por candidatura
- [x] Suíte completa passando, sem regressão de comportamento visível (mesmos dados exibidos, só menos queries)

## Escopo

**In:** os 2 pontos citados (`:1219-1237`, `:1349-1352`).
**Out:** qualquer outra tela de listagem fora dessas 2; mudança de layout/dado exibido.

## Test plan

Ver "Test plan" do plano.

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 012.
- v0.2 (2026-07-29): @po validou — NO-GO (5/10) por Escopo/Valor de negócio ausentes e AC genérico.
- v0.3 (2026-07-29): @po corrigiu as 3 pendências (os 2 pontos detalhados, Valor de negócio adicionado, AC específico) — GO. Status Draft → Ready.
- v1.0 (2026-07-30): @dev implementou batching nas 2 listagens e adicionou regressões. Status Ready → Review.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `cd worker && ../.venv/bin/python -m pytest tests/test_intencao_detector.py tests/test_empregabilidade_engine.py -v` — 92 passed, 2 warnings preexistentes.
- `cd worker && SUPABASE_URL=http://localhost SUPABASE_SERVICE_ROLE_KEY=<dummy-jwt> ../.venv/bin/python -c "import empregabilidade_engine; print('import ok')"` — passou.

### Completion Notes

- Contagem de candidaturas por vaga usa uma única consulta `.in_("vaga_id", vaga_ids)` e agrupamento em Python.
- Títulos das vagas em consulta de candidatura usam uma única consulta `.in_("id", vaga_ids)`.

### File List

- `worker/empregabilidade_engine.py`
- `worker/tests/test_empregabilidade_engine.py`

## QA Results

### Review Date: 2026-07-30

### Reviewed By: Quinn (Test Architect)

### Gate Status

PASS

### Evidence

- Revisado batching em `worker/empregabilidade_engine.py`: listagem de vagas usa `.in_("vaga_id", vaga_ids)` e busca de títulos usa `.in_("id", vaga_ids)`.
- Testes novos cobrem contagens agregadas e títulos em lote.
- `cd worker && ../.venv/bin/python -m pytest tests/test_intencao_detector.py tests/test_empregabilidade_engine.py -v` — 92 passed, 2 warnings preexistentes de `datetime.utcnow()`.
- Import sanity passou com `import empregabilidade_engine`.

### Notes

- Sem achados bloqueantes.
