# S-WM-54 — Não continuar o dispatch em silêncio quando o insert da mensagem do lead falha

## Status
Ready for Review

## Origem
Investigação "Corrida da Juventude" (disparo de 724 leads, 24/07/2026) — `docs/qa/DIAGNOSTICO-disparo-corrida-juventude-2026-07-27.md`, achado #2 (confirmado na prática — print "Mandar oq? Kkkk", lead De Meneses). Plano técnico completo, com o trade-off documentado e o diff exato, preservado integralmente em `docs/qa/planos-corrida-juventude/003-nao-perder-mensagem-lead-silenciosamente.md` — usar esse arquivo como referência técnica primária, não este resumo. Elaborado em 2026-07-25 (commit base `256d547`). Formalizada em story por @sm em 2026-07-27, setup de teste ("Equipe Interna — QA") já criado e confirmado.

## Complexidade
**S** — 1 bloco de log alterado, mas a **decisão de comportamento** (não a implementação) tem peso real — ver Contexto.

## Prioridade
P2 — resiliência/observabilidade, não é bug de comportamento incorreto (o lead ainda recebe resposta), mas hoje a perda do registro é 100% silenciosa.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - cd worker && pytest tests/test_meta_adapter_inbound.py -v → todos passam, incluindo o teste novo
  - cd worker && pytest tests/ -v → suíte completa sem regressão
  - grep -n "DATA-LOSS" worker/meta_adapter_inbound.py → pelo menos 1 ocorrência
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** que uma falha ao salvar a mensagem do lead no histórico (`mensagens`) pare de ser 100% silenciosa,
**para que** eu (ou quem monitorar os logs) consiga perceber e reconstruir manualmente o que aconteceu, mesmo quando o dispatch da IA continua normalmente.

## Contexto e Problema

`worker/meta_adapter_inbound.py::processar_webhook_meta`, bloco "DB C" (insert em `mensagens` + `increment_nao_lidas`): se o insert falhar, o código atual só loga em nível `error` e **continua** o processamento como se a mensagem tivesse sido salva — o dispatch pro `motor-agente` é agendado normalmente. Resultado possível: a mensagem original do lead nunca fica registrada no histórico, sem alertar ninguém, mesmo o sistema tentando responder a ela.

**Trade-off que esta story pede pra decidir com cuidado, não assumir:** interromper o processamento (`return` logo após a falha) significa que o lead **não recebe nenhuma resposta** — nem a mensagem de fallback técnico. Isso pode ser pior que a situação atual. A abordagem padrão desta story é a 2ª: manter o fluxo, mas tornar a falha **visível/rastreável** de verdade (subir de `logger.error` para `logger.critical`, com marcador `[DATA-LOSS]` e todo o contexto necessário pra reconstrução manual).

Padrão já existente no mesmo arquivo, em blocos vizinhos ("DB A" — Lead, "DB B" — Conversa): falhas que são pré-requisito de dado pra continuar → `return`. A mensagem em si não é pré-requisito técnico (o dispatch usa `contrato_v2["mensagem"]`, já montado antes, independente do insert) — só o **registro** no histórico se perde. Por isso o comportamento aqui é deliberadamente diferente — mas hoje sem nenhuma forma de alerta.

## Escopo

### IN
1. Trocar `logger.error(f"[meta-inbound] Erro ao salvar Mensagem: {exc}")` por `logger.critical(...)` com marcador `[DATA-LOSS]`, incluindo `conversa_id`, `lead_id`, `midia_tipo`, `mensagem` (o conteúdo que não foi salvo) e o erro — o log precisa ser autossuficiente pra reconstrução manual.
2. **Não** adicionar `return` — decisão desta story é manter a tentativa de resposta mesmo sem o registro salvo. Se durante a implementação ficar claro que interromper seria mais seguro, **não decidir sozinho**: parar e trazer a recomendação de volta (decisão de produto, não só técnica).
3. Teste forçando exceção no insert de `mensagens`, confirmando (a) o processamento continua (dispatch ainda agendado) e (b) o log `CRITICAL` contém `conversa_id`/`lead_id`/`DATA-LOSS`.
4. Mutation check manual: reverter, confirmar falha do teste; restaurar, confirmar passa.

### OUT
- Os blocos "DB A" (Lead) e "DB B" (Conversa) — já corretos (interrompem com `return`), não mexer.
- Qualquer sistema de alerta externo (Sentry, Slack) — se `sentry-sdk` já estiver em `requirements.txt` **e** já inicializado em algum lugar de `worker/`, avaliar antes de decidir; se não houver uso nenhum de Sentry em `worker/` hoje, não introduzir a dependência agora.

## Acceptance Criteria

1. **Given** o insert de `mensagens` falha, **when** o `except` captura a exceção, **then** o log é `CRITICAL`, contém o marcador `[DATA-LOSS]`, `conversa_id`, `lead_id` e o conteúdo perdido.
2. **Given** essa mesma falha, **when** o processamento segue, **then** o dispatch pro `motor-agente` continua sendo agendado (sem `return` antecipado) — comportamento mantido, só a visibilidade muda.
3. **Given** o teste revertido (log volta ao `logger.error` sem `DATA-LOSS`), **when** rodado, **then** falha.
4. **Given** a decisão de manter o fluxo (não interromper) se mostrar, durante a implementação, claramente pior que interromper, **then** o @dev não troca silenciosamente — reporta a recomendação antes de decidir.
5. `pytest tests/` sai com exit 0, incluindo o teste novo, sem regressão nos demais.
6. Nenhum arquivo fora de `worker/meta_adapter_inbound.py` e `worker/tests/test_meta_adapter_inbound.py` é modificado.

## Tasks / Subtasks

- [x] **Task 1 — Decidir e implementar** (AC: 1, 2, 4)
  - [x] Lido o trade-off (Contexto) antes de escrever código — decisão do plano confirmada (não interromper), nada indicou que interromper seria mais seguro.
  - [x] Aplicado `logger.critical` com `[DATA-LOSS]` + contexto completo (`conversa_id`, `lead_id`, `midia_tipo`, `mensagem`, `erro`), sem `return`.
- [x] **Task 2 — Teste + mutation check** (AC: 3, 5)
  - [x] Teste forçando exceção no insert de `mensagens`, usando `caplog` e o padrão de mock de webhook completo já existente no arquivo (mesmo padrão da S-WM-53).
  - [x] Reverter → falhou corretamente; restaurar → passou.
- [x] **Task 3 — Fechamento** (AC: 5, 6)
  - [x] Suíte completa sem regressão: 142 passed (141 baseline pós-S-WM-53 + 1 novo), 3 falhas pré-existentes (fora de escopo, já documentadas na S-WM-53) inalteradas.
  - [x] File List e Change Log atualizados.
  - [x] Anunciado conclusão e recomendado @qa.

## Dev Notes

- Trecho de código antes/depois exato, estrutura do teste e do mutation check: **`docs/qa/planos-corrida-juventude/003-nao-perder-mensagem-lead-silenciosamente.md`** — ler por completo antes de editar.
- Se não existir nenhum teste prévio de `processar_webhook_meta` completo pra copiar o padrão de mock — **parar e perguntar** antes de inventar um payload Meta do zero.
- Revisor (@qa) deve confirmar que o `return` **não** foi adicionado sem essa decisão estar documentada explicitamente na story/PR.
- **Achado que corrige uma premissa do plano original:** o plano assumia que não havia Sentry ativo em `worker/` — na verdade, `worker/main.py` já inicializa `sentry_sdk` (condicionado a `SENTRY_DSN_WORKER`, que **está configurado**, `LoggingIntegration(level=WARNING, event_level=ERROR)`). Isso significa que o `logger.error` antigo **já disparava** um evento ERROR no Sentry pra essa falha; a mudança pra `logger.critical` não introduz uma dependência nova nem um alerta que não existia — só eleva a severidade do evento já existente no Sentry (de ERROR pra CRITICAL), o que ajuda a diferenciar esse caso dos demais `logger.error` genéricos do arquivo, exatamente a motivação original do Step 1. Nenhuma chamada nova a `sentry_sdk` foi adicionada — a captura é passiva, via a integração de logging já configurada globalmente.
- **Sequenciamento:** mesmo arquivo que a S-WM-53 (`worker/meta_adapter_inbound.py`) — mergear a S-WM-53 primeiro evita conflito. Sem dependência técnica real, é só sequência de merge.

### Testing
`cd worker && pytest tests/test_meta_adapter_inbound.py -v` e depois `pytest tests/` (suíte completa).

## Dependências
Sequenciada **depois da S-WM-53** (mesmo arquivo, evitar conflito de merge) — sem dependência técnica de fato.

## Git workflow
Branch: `fix/nao-perder-mensagem-lead-silenciosamente` (seguir o padrão `fix/<slug>` do repo). Commit único, ex.: `fix(worker): loga falha ao salvar mensagem do lead como critical, sem perder o dado silenciosamente`. Não dar push/PR sem autorização explícita.

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-27 | 0.1 | Story criada a partir do Plano 003 (investigação "Corrida da Juventude", 2026-07-25). 3ª story da leva — mesmo arquivo da S-WM-53, sequenciada depois dela para evitar conflito de merge. | @sm River |
| 2026-07-27 | 0.2 | Implementada em branch isolada `fix/nao-perder-mensagem-lead-silenciosamente` (a partir de `origin/main`, já com S-WM-52 e S-WM-53 mergeadas). Sem drift real (bloco "DB C" idêntico ao plano, só deslocado pela S-WM-53). Decisão do plano mantida (sem `return`). 1 teste novo + mutation check. Achado: Sentry já ativo em `worker/main.py` — corrigida a premissa do plano nos Dev Notes. Suíte: 142/0/3(pré-existentes). Status Draft → Ready for Review. | @dev Dex |

## Dev Agent Record

### Agent Model Used
Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References
- Drift check (`git diff --stat 256d547..HEAD -- worker/meta_adapter_inbound.py worker/tests/test_meta_adapter_inbound.py`): mostra a S-WM-53 (esperado). Bloco "DB C" específico conferido linha a linha contra o "Estado atual" do plano — idêntico, só deslocado +18 linhas. Sem drift real.
- Baseline: `pytest tests/test_meta_adapter_inbound.py -q` → 47 passed. `pytest tests/ -q` → 141 passed, 3 failed (pré-existentes, já documentadas na S-WM-53).
- Verificado `requirements.txt`/`worker/*.py` por Sentry antes de decidir (per Escopo/OUT): `sentry-sdk[fastapi]` presente, **inicializado em `worker/main.py`** com `SENTRY_DSN_WORKER` configurado (`.env` real) e `LoggingIntegration(level=WARNING, event_level=ERROR)`. Ou seja, o `logger.error` antigo já virava evento ERROR no Sentry — a mudança pra `critical` só eleva a severidade do evento já existente, não introduz captura nova. Nenhuma chamada `sentry_sdk.*` adicionada (fora de escopo, captura é passiva via a integração já configurada).
- Implementado: `logger.critical` com `[DATA-LOSS]`, `conversa_id`, `lead_id`, `midia_tipo`, `mensagem` (`%r`), `erro` — sem `return` (decisão do plano mantida, nada na implementação sugeriu que interromper seria mais seguro).
- Teste novo: `test_falha_ao_salvar_mensagem_continua_processamento_com_log_critico` — webhook completo mockado (mesmo padrão da S-WM-53), `insert().execute()` de `mensagens` força exceção via `side_effect` (só esse `.insert()`, não afeta os `.upsert()` de leads/conversas), confirma `mock_motor.assert_called_once()` (dispatch continua) + `CRITICAL` + `DATA-LOSS` + `conversa_id`/`lead_id` no log.
- Suíte pós-mudança: `pytest tests/test_meta_adapter_inbound.py -q` → 48 passed (47 + 1 novo). `pytest tests/ -q` → 142 passed, mesmas 3 falhas pré-existentes.
- Mutation check: revertido pro `logger.error` antigo sem `DATA-LOSS` → teste falhou (`assert any(r.levelname == "CRITICAL"...)` → False). Restaurado → passou. Suíte completa reconfirmada 142/3(pré-existentes) após restaurar.
- `grep -n "DATA-LOSS" meta_adapter_inbound.py` → 1 ocorrência.

### Completion Notes List
- Implementado exatamente como especificado no plano preservado (`docs/qa/planos-corrida-juventude/003-nao-perder-mensagem-lead-silenciosamente.md`).
- Decisão de não interromper (sem `return`) mantida — nada na implementação ou nos testes sugeriu que seria mais seguro interromper; documentado explicitamente aqui, conforme pedido pelo plano (Step 1) e pela story (AC4).
- Achado que atualiza uma premissa do plano original: Sentry já está ativo no worker (`worker/main.py`), não é uma dependência hipotética futura — o `logger.critical` novo já é capturado passivamente pela integração existente, sem nenhum código novo de Sentry adicionado.
- Nenhum arquivo fora de `worker/meta_adapter_inbound.py` e `worker/tests/test_meta_adapter_inbound.py` foi modificado.

### File List
- `worker/meta_adapter_inbound.py` (modificado: `logger.error` → `logger.critical` com marcador `[DATA-LOSS]` no bloco "DB C")
- `worker/tests/test_meta_adapter_inbound.py` (modificado: 1 teste novo, dentro de `TestDispatchMotorAgente`)

## QA Results
### Review Date: 2026-07-27

### Reviewed By: @qa Quinn

### Gate Decision: PASS

### Summary

Gate aprovado. A implementação atende a intenção da S-WM-54: falha no insert da mensagem do lead deixa de ser silenciosa, passa a emitir log `CRITICAL` com marcador `[DATA-LOSS]` e contexto suficiente para reconstrução manual, sem interromper o dispatch para o `motor-agente`.

### Evidence

- Código revisado em `worker/meta_adapter_inbound.py`: bloco "DB C" usa `logger.critical(...)` com `[DATA-LOSS]`, `conversa_id`, `lead_id`, `midia_tipo`, `mensagem` e `erro`.
- Confirmado que não foi adicionado `return` no `except` do insert de `mensagens`; o fluxo continua para preservar a tentativa de resposta ao lead.
- Teste novo revisado em `worker/tests/test_meta_adapter_inbound.py`: força exceção no insert de `mensagens`, valida log `CRITICAL` com `[DATA-LOSS]` e confirma `mock_motor.assert_called_once()`.
- Escopo de arquivos conferido nos caminhos da story.

### Tests Executed by QA

- `cd worker && pytest tests/test_meta_adapter_inbound.py::TestDispatchMotorAgente::test_falha_ao_salvar_mensagem_continua_processamento_com_log_critico -q` → `1 passed`.
- `cd worker && pytest tests/ -q` → `142 passed, 3 failed, 1 warning`.
  - As 3 falhas são as mesmas falhas pré-existentes fora do escopo, em `tests/test_meta_adapter_outbound.py::TestSendMessageEndpoint`, por `ModuleNotFoundError: No module named 'worker'`.

### Risk / Notes

- Sem bloqueio para PR. A mudança aumenta observabilidade e severidade de alerta sem alterar o contrato funcional do atendimento.
- Como a alteração é em `worker/meta_adapter_inbound.py`, após merge em `main` o serviço impactado para redeploy é o backend/worker (`cuca-worker`) no EasyPanel; não há alteração de Supabase Edge Function nesta story.
