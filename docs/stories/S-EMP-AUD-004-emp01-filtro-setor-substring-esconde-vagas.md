# S-EMP-AUD-004 — Filtro de setor por substring esconde vagas já na 1ª mensagem (EMP-01)

**Status:** Ready for Review
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/004-emp01-filtro-setor-substring-esconde-vagas.md`
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 004" — confirmado em `worker/empregabilidade_engine.py:2508`
**Prioridade:** P1 | **Esforço:** S | **Risco:** BAIXO
**Ordem de execução proposta:** Bloco 2 (junto com 005, 006, 007) — independentes entre si e dos blocos 1/3/4

## Contexto

`worker/intencao_detector.py:extrair_setor_da_mensagem` casa setor por substring solta (`setor_canonical.lower() in (s or "").lower()`, usado em `empregabilidade_engine.py:2508`) — "entregar" (verbo comum em "quero entregar meu currículo") contém "entrega" e é lido como menção ao setor Logística, escondendo vagas de outras áreas.

## Valor de negócio

Candidato que digita algo com "entregar" (ex.: "entregar meu currículo") para de ter vagas de outras áreas escondidas por engano logo na 1ª mensagem — reduz abandono no primeiro contato.

## Dependência real

**Bloqueada pelo Passo 0 (commit dos testes locais) — já resolvido em 2026-07-29** (commit `3ab3b96`, `worker/tests/`). Teste vermelho já existe e está commitado: `test_entregar_curriculo_nao_deveria_disparar_filtro_de_logistica` em `worker/tests/test_intencao_detector.py`.

## Acceptance Criteria

- [x] `test_entregar_curriculo_nao_deveria_disparar_filtro_de_logistica` (`worker/tests/test_intencao_detector.py`) passa
- [x] Suíte completa passando, sem regressão nas outras checagens de setor

## Escopo

**In:** `worker/intencao_detector.py::extrair_setor_da_mensagem` (troca de substring solta por comparação com limite de palavra) e o ponto de uso em `worker/empregabilidade_engine.py:2508`.
**Out:** qualquer outro achado da auditoria; lista de setores em si (não muda quais setores existem, só como são detectados no texto).

## Test plan

Teste já escrito e commitado — só rodar `cd worker && python -m pytest tests/test_intencao_detector.py -v` e confirmar verde após o fix.

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 004. Passo 0 (commit do teste) já resolvido nesta mesma rodada.
- v0.2 (2026-07-29): @po validou — NO-GO (6/10) por Escopo/Valor de negócio ausentes.
- v0.3 (2026-07-29): @po corrigiu as pendências (Escopo restatado, Valor de negócio adicionado) — GO. Status Draft → Ready.
- v0.4 (2026-07-30): @dev implementou limite de palavra em `extrair_setor_da_mensagem`. Status Ready → Ready for Review.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `cd worker && ../.venv/bin/python -m pytest tests/test_intencao_detector.py tests/test_empregabilidade_engine.py -v` — passou: 72 passed.

### Completion Notes List

- `extrair_setor_da_mensagem` deixou de usar substring solta e passou a casar keywords com bordas de palavra via regex.
- A lista de setores não foi alterada.

### File List

- `worker/intencao_detector.py`

## QA Results

### Review 2026-07-30 — @qa Quinn — Gate: PASS

**Resultado:** a correção atende ao Plano 004. `extrair_setor_da_mensagem` deixou de casar keyword por substring solta e passou a exigir bordas de palavra, mantendo a lista de setores intacta. O caso `"entregar"` não dispara mais `"entrega" -> Logística`, e as regressões existentes de setor continuam verdes.

**Evidência:** `cd worker && ../.venv/bin/python -m pytest tests/test_intencao_detector.py tests/test_empregabilidade_engine.py -v` resultou em `72 passed`.

### Re-review 2026-07-30 — @qa Quinn — Gate: PASS

**Resultado:** PASS mantido no re-review do Bloco 2 inteiro. Nenhuma regressão identificada para o filtro de setor após o ajuste posterior da S-EMP-AUD-005.

**Evidência:** `cd worker && ../.venv/bin/python -m pytest tests/test_intencao_detector.py tests/test_empregabilidade_engine.py -v` resultou em `73 passed`.
