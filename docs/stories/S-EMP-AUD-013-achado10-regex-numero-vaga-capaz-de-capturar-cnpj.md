# S-EMP-AUD-013 — Regex de número de vaga pode capturar dígito de CNPJ (achado #10)

**Status:** Review
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/013-achado10-regex-numero-vaga-capaz-de-capturar-cnpj.md`
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 013" — confirmado em `worker/empregabilidade_engine.py:487, 570, 1192` (`re.search(r"\b(\d{1,4})\b", texto)`)
**Prioridade:** P3 | **Esforço:** S | **Risco:** BAIXO
**Ordem de execução proposta:** Bloco 6 — qualquer ordem, sem dependência com os demais

## Contexto

`\b(\d{1,4})\b` captura sequências de 1-4 dígitos cercadas por fronteira de palavra — pontuação conta como fronteira, então um CNPJ como `12.345.678/0001-90` pode ter um trecho capturado como se fosse "número da vaga". Diferente do EMP-01 (Plano 004, palavra-dentro-de-palavra): aqui o problema é dígito-embutido-em-sequência-pontuada — a correção é `(?:^|\s)...(?:\s|$)`, não `\b` (que já está presente e não resolve).

## Valor de negócio

Evita que uma empresa/candidato colando um CNPJ (ou outro número pontuado) numa mensagem receba resposta como se tivesse pedido informação sobre uma vaga aleatória — resposta incoerente e confusa no meio do fluxo.

## Dependência real

Nenhuma.

## Acceptance Criteria

- [x] Os 3 pontos citados (`:487, 570, 1192`) usam o padrão correto (`(?:^|\s)...(?:\s|$)`), não mais só `\b`
- [x] Teste confirmando que um CNPJ formatado (ex.: `12.345.678/0001-90`) não é interpretado como número de vaga em nenhum dos 3 pontos
- [x] Suíte completa passando

## Escopo

**In:** os 3 pontos de `re.search(r"\b(\d{1,4})\b", texto)` (`:487, 570, 1192`).
**Out:** qualquer outro uso de regex no arquivo fora desses 3 pontos.

## Test plan

Ver "Test plan" do plano.

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 013.
- v0.2 (2026-07-29): @po validou — NO-GO (6/10) por Escopo/Valor de negócio ausentes.
- v0.3 (2026-07-29): @po corrigiu as pendências — GO. Status Draft → Ready.
- v1.0 (2026-07-30): @dev substituiu regex por número isolado e adicionou regressão com CNPJ formatado. Status Ready → Review.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `cd worker && ../.venv/bin/python -m pytest tests/test_intencao_detector.py tests/test_empregabilidade_engine.py -v` — 92 passed, 2 warnings preexistentes.

### Completion Notes

- Criada `_REGEX_NUMERO_VAGA_ISOLADO` com boundary por início/fim ou whitespace.
- Seleção de edição, cancelamento e consulta de vaga usam o padrão compartilhado.

### File List

- `worker/empregabilidade_engine.py`
- `worker/tests/test_empregabilidade_engine.py`
