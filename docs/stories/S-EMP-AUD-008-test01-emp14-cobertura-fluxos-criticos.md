# S-EMP-AUD-008 — Cobertura nos 3 fluxos de maior risco + mocks passam a verificar payload (TEST-01 + achado #14)

**Status:** Ready for Review
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/008-test01-emp14-cobertura-fluxos-criticos.md`
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 008" — confirmada ausência de cobertura em `worker/tests/test_empregabilidade_engine.py`, inclusive de `empregabilidade_notify_loop` (também citado no Plano 017)
**Prioridade:** P1 | **Esforço:** M | **Risco:** MED
**Ordem de execução proposta:** Bloco 3 — antes do Bloco 4 (Plano 009). O achado #14 (mocks fracos) foi fundido a este plano por ser o mesmo trabalho (ver `plans/README.md`).

## Contexto

Os 3 fluxos de maior risco do módulo (identificados na auditoria) não têm cobertura de teste adequada, e os mocks existentes não verificam o payload real enviado às chamadas Supabase (podem passar mesmo com dado errado). Isso é pré-requisito de segurança para o refactor grande do Plano 009 (~49 pontos de código tocados).

## Valor de negócio

É pré-requisito de segurança para o refactor grande do Plano 009 (~49 pontos tocados) e para os próprios fixes 001-007 — sem essa rede, uma mudança futura nos 3 fluxos mais sensíveis do arquivo (cancelamento de vaga real, cadastro de empresa real, confirmação de entrevista) pode regredir sem que nenhum teste acuse.

## Dependência real

Nenhuma dependência de entrada. **É pré-requisito hard do Plano 009** — o 009 só deve começar depois deste fechado (ver "Depends on" do plano 009 e do README).

## Acceptance Criteria

- [x] 6 testes novos (2 por fluxo) cobrindo: `confirmando_cancelamento` (marca vaga como `cancelada`, irreversível), `confirmando_cadastro`/`confirmando_cadastro_com_correcao` (insere empresa real), confirmação/recusa de convite de entrevista (SQS-40 Task 3.4, grava `candidaturas.status`)
- [x] Helper novo de mock multi-tabela (não existe hoje — `side_effect` por tabela) documentado e reaproveitável
- [x] Mocks passam a verificar payload via `assert_called_with`/`assert_called_once_with` (hoje 0 ocorrências no arquivo) — não só o efeito final (mensagem enviada, etapa)
- [x] Suíte completa passando

## Escopo

**In:** `worker/tests/test_empregabilidade_engine.py` — 1 helper novo de mock multi-tabela + 6 testes novos (2 por fluxo). **Nenhuma mudança em código de produção.**
**Out:** os 3 fluxos em si (não são alterados, só testados); qualquer fluxo fora dos 3 citados.

## Test plan

Ver "Test plan" do plano.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Drift check executado: `git diff --stat 7b0b326..HEAD -- worker/empregabilidade_engine.py worker/tests/test_empregabilidade_engine.py` mostrou drift esperado dos Blocos 1-2; trechos atuais dos fluxos 008 foram conferidos antes dos testes.
- `cd worker && SUPABASE_URL=http://localhost SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.dummy ../.venv/bin/python -c "import empregabilidade_engine"` passou.
- `cd worker && ../.venv/bin/python -m pytest tests/test_empregabilidade_engine.py::TestConfirmandoCancelamento -v` resultou em `2 passed`.
- `cd worker && ../.venv/bin/python -m pytest tests/test_empregabilidade_engine.py::TestConfirmandoCadastro -v` resultou em `2 passed`.
- `cd worker && ../.venv/bin/python -m pytest tests/test_empregabilidade_engine.py::TestConfirmacaoEntrevista -v` resultou em `2 passed`.
- `cd worker && ../.venv/bin/python -m pytest tests/test_empregabilidade_engine.py -v` resultou em `47 passed, 2 warnings`.
- `cd worker && ../.venv/bin/python -m pytest tests/test_intencao_detector.py tests/test_empregabilidade_engine.py -v` resultou em `79 passed, 2 warnings`.

### Completion Notes

- Criado `_mock_sb_multi_tabela` como alias documentado sobre o helper multi-tabela já existente na suíte, preservando o padrão do Bloco 1 e dando nome explícito ao Plano 008.
- Adicionados 6 testes novos: cancelamento confirmado/abortado, cadastro confirmado/cadastro com correção confirmado, confirmação/recusa de entrevista.
- Os testes verificam payloads e filtros das escritas Supabase via `assert_called_once_with`, `assert_called_with` e inspeção de `call_args`.
- Nenhum código de produção foi alterado.

### File List

- `worker/tests/test_empregabilidade_engine.py`
- `docs/stories/S-EMP-AUD-008-test01-emp14-cobertura-fluxos-criticos.md`
- `docs/Auditoria Empregabilidade - Cuca Atende/plans/README.md`

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 008.
- v0.2 (2026-07-29): @po validou — NO-GO (5/10) por Escopo/Valor de negócio ausentes e AC genérico.
- v0.3 (2026-07-29): @po corrigiu as 3 pendências (3 fluxos nomeados, Valor de negócio adicionado, AC com os cenários específicos) — GO. Status Draft → Ready.
- v0.4 (2026-07-30): @dev implementou o Bloco 3/Plano 008 com helper multi-tabela nomeado, 6 testes novos e suíte focal verde. Status Ready → Ready for Review.
