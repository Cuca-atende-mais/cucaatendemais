# S-EMP-AUD-007 — `menu_pos_vaga` reinterpreta resposta contra menu errado (EMP-04)

**Status:** Ready for Review
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/007-emp04-menu-pos-vaga-menu-errado.md`
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 007" — confirmado em `worker/empregabilidade_engine.py:1076-1082` (menu mostrado) e `:1101-1102` (dispatch errado)
**Prioridade:** P1 | **Esforço:** S | **Risco:** BAIXO-MED
**Ordem de execução proposta:** Bloco 2 (junto com 004, 005, 006) — independentes entre si e dos blocos 1/3/4. Sugestão de sequência (não bloqueante): implementar antes do Plano 012, que mexe em código próximo (`_listar_vagas_para_acao`), pra evitar conflito de merge.

## Contexto

Depois de criar uma vaga, a etapa vira `menu_pos_vaga` (menu de 4 opções, "3 = Encerrar"), mas o dispatch dessa etapa redireciona para o handler de `menu_empresa_acoes`, onde "3 = Editar uma vaga". Uma empresa que responde "3" querendo encerrar acaba, sem saber, no fluxo de edição.

## Valor de negócio

Empresa que responde "3" pra encerrar para de cair sem saber no fluxo de edição de vaga — evita alteração indesejada de dado real por confusão de menu.

## Dependência real

**Bloqueada pelo Passo 0 (commit dos testes locais) — já resolvido em 2026-07-29** (commit `3ab3b96`). Teste vermelho commitado: `TestMenuPosVagaReinterpretaResposta` em `worker/tests/test_empregabilidade_engine.py`.

## Acceptance Criteria

- [x] `test_resposta_3_para_encerrar_e_reinterpretada_como_editar_vaga` passa
- [x] Suíte completa passando

## Escopo

Ver "Scope" do plano — branch `if etapa == "menu_pos_vaga"` (`:1101`). Não inclui o handler de `menu_empresa_acoes` em si.

## Test plan

Teste já escrito e commitado.

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 007. Passo 0 já resolvido.
- v0.2 (2026-07-29): @po validou — NO-GO (6/10) por Valor de negócio ausente (Escopo já era específico o suficiente).
- v0.3 (2026-07-29): @po adicionou "Valor de negócio" — GO. Status Draft → Ready.
- v0.4 (2026-07-30): @dev implementou dispatch próprio para `menu_pos_vaga`, com testes para opções 1, 2 e 3. Status Ready → Ready for Review.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `cd worker && ../.venv/bin/python -m pytest tests/test_empregabilidade_engine.py::TestMenuPosVagaReinterpretaResposta -v` — passou: 3 passed.
- `cd worker && ../.venv/bin/python -m pytest tests/test_intencao_detector.py tests/test_empregabilidade_engine.py -v` — passou: 72 passed.

### Completion Notes List

- `menu_pos_vaga` não delega mais o texto cru para `menu_empresa_acoes`.
- Opção 1 segue para divulgar outra vaga/coleta de e-mail; opção 2 consulta vagas; opção 3 encerra o fluxo da empresa.
- Follow-up mantido do plano: opção 2 ainda lista vagas da empresa no padrão existente, não exclusivamente a última vaga.

### File List

- `worker/empregabilidade_engine.py`
- `worker/tests/test_empregabilidade_engine.py`

## QA Results

### Review 2026-07-30 — @qa Quinn — Gate: PASS com follow-up

**Resultado:** a implementação atende ao Plano 007. `menu_pos_vaga` não delega mais o texto cru para `menu_empresa_acoes`; as opções 1, 2 e 3 agora são interpretadas contra o menu mostrado ao usuário. A opção `3` encerra o fluxo e não cai mais em edição de vaga.

**Evidência:** `cd worker && ../.venv/bin/python -m pytest tests/test_empregabilidade_engine.py::TestMenuPosVagaReinterpretaResposta -v` resultou em `3 passed`; `cd worker && ../.venv/bin/python -m pytest tests/test_intencao_detector.py tests/test_empregabilidade_engine.py -v` resultou em `72 passed`.

**Follow-up mantido:** a opção 2 ainda consulta/lista no padrão existente da empresa, não exclusivamente a última vaga recém-criada, apesar do texto “desta vaga”. Isso já estava registrado como fora de escopo no plano e não bloqueia esta story.

### Re-review 2026-07-30 — @qa Quinn — Gate: PASS com follow-up

**Resultado:** PASS com follow-up mantido no re-review do Bloco 2 inteiro. O menu `menu_pos_vaga` continua interpretando as opções 1, 2 e 3 contra o menu correto.

**Evidência:** `cd worker && ../.venv/bin/python -m pytest tests/test_intencao_detector.py tests/test_empregabilidade_engine.py -v` resultou em `73 passed`.

**Follow-up mantido:** opção 2 ainda lista no padrão existente da empresa, não exclusivamente a última vaga recém-criada; segue fora do escopo bloqueante desta story.
