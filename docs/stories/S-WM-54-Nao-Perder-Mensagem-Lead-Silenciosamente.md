# S-WM-54 — Não continuar o dispatch em silêncio quando o insert da mensagem do lead falha

## Status
Draft

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

- [ ] **Task 1 — Decidir e implementar** (AC: 1, 2, 4)
  - [ ] Ler o trade-off (Contexto) antes de escrever código.
  - [ ] Aplicar o `logger.critical` com `[DATA-LOSS]` + contexto completo, sem `return`.
- [ ] **Task 2 — Teste + mutation check** (AC: 3, 5)
  - [ ] Teste forçando exceção no insert de `mensagens`, usando `caplog` e o padrão de mock de webhook completo já existente no arquivo.
  - [ ] Reverter → falha; restaurar → passa.
- [ ] **Task 3 — Fechamento** (AC: 5, 6)
  - [ ] Suíte completa sem regressão.
  - [ ] File List e Change Log atualizados.
  - [ ] Anunciar conclusão e recomendar @qa.

## Dev Notes

- Trecho de código antes/depois exato, estrutura do teste e do mutation check: **`docs/qa/planos-corrida-juventude/003-nao-perder-mensagem-lead-silenciosamente.md`** — ler por completo antes de editar.
- Se não existir nenhum teste prévio de `processar_webhook_meta` completo pra copiar o padrão de mock — **parar e perguntar** antes de inventar um payload Meta do zero.
- Revisor (@qa) deve confirmar que o `return` **não** foi adicionado sem essa decisão estar documentada explicitamente na story/PR.
- Se este projeto adotar Sentry (ou similar) de forma mais ampla no futuro, este `logger.critical` é o ponto natural pra também disparar alerta externo — hoje fica só no log, é o que já existe no arquivo.
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

## Dev Agent Record
_A ser preenchido pelo @dev durante a implementação._

## QA Results
_A ser preenchido pelo @qa após a implementação._
