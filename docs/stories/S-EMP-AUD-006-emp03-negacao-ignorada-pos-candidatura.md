# S-EMP-AUD-006 — Negação ignorada em `pos_candidatura` reabre busca de vagas (EMP-03)

**Status:** Ready for Review
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/006-emp03-negacao-ignorada-pos-candidatura.md`
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 006" — confirmado em torno de `worker/empregabilidade_engine.py:1583-1619`
**Prioridade:** P1 | **Esforço:** S | **Risco:** BAIXO
**Ordem de execução proposta:** Bloco 2 (junto com 004, 005, 007) — independentes entre si e dos blocos 1/3/4

## Contexto

Na etapa `pos_candidatura`, "quero" como substring marca `quer_mais_vagas=True` sem checar negação — "não quero mais vagas, obrigado" contém "quero" e é lido como pedido de mais vagas. A etapa seguinte (`oferta_banco_talentos`) já tem a proteção de negação pra esse padrão; só não foi aplicada de volta aqui.

## Valor de negócio

Candidato que recusa mais vagas ("não quero mais, obrigado") para de ter a busca reaberta contra a vontade — evita atrito/confusão no fim do fluxo de candidatura.

## Dependência real

**Bloqueada pelo Passo 0 (commit dos testes locais) — já resolvido em 2026-07-29** (commit `3ab3b96`). Teste vermelho commitado: `TestPosCandidaturaNegacaoIgnorada` em `worker/tests/test_empregabilidade_engine.py`.

## Acceptance Criteria

- [x] `test_nao_quero_mais_vagas_nao_deveria_reabrir_busca_de_vagas` passa
- [x] Suíte completa passando

## Escopo

**In:** etapa `pos_candidatura` (`worker/empregabilidade_engine.py:1583-1619`) — replicar a proteção de negação já existente em `oferta_banco_talentos` (`:1626-1629`).
**Out:** qualquer outra etapa; a proteção de `oferta_banco_talentos`, já correta e usada como referência.

## Test plan

Teste já escrito e commitado.

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 006. Passo 0 já resolvido.
- v0.2 (2026-07-29): @po validou — NO-GO (6/10) por Escopo/Valor de negócio ausentes.
- v0.3 (2026-07-29): @po corrigiu as pendências — GO. Status Draft → Ready.
- v0.4 (2026-07-30): @dev replicou o guard de negação em `pos_candidatura`. Status Ready → Ready for Review.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `cd worker && ../.venv/bin/python -m pytest tests/test_intencao_detector.py tests/test_empregabilidade_engine.py -v` — passou: 72 passed.

### Completion Notes List

- `quer_mais_vagas` agora é desativado quando a mensagem contém negação (`não`/`nao`), permitindo que o branch de encerramento trate “não quero mais vagas”.

### File List

- `worker/empregabilidade_engine.py`

## QA Results

### Review 2026-07-30 — @qa Quinn — Gate: PASS

**Resultado:** a implementação atende ao Plano 006. `pos_candidatura` agora calcula `tem_negacao` antes do fast-path positivo e impede que `"não quero mais vagas"` reabra a busca por conter `"quero"`, `"mais"` ou `"vagas"`.

**Evidência:** `cd worker && ../.venv/bin/python -m pytest tests/test_intencao_detector.py tests/test_empregabilidade_engine.py -v` resultou em `72 passed`; `TestPosCandidaturaNegacaoIgnorada::test_nao_quero_mais_vagas_nao_deveria_reabrir_busca_de_vagas` passou.
