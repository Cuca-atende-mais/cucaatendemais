# S-WM-64 — Endurecer gatilhos de transbordo (ordem + tratamento de erro), Empregabilidade e Institucional

## Status
Ready for Review

## Origem
Diagnóstico de transbordo (Empregabilidade + Institucional), sessão de 2026-07-31/08-01. Reproduzido ao vivo: lead entrou com CNPJ já cadastrado por outro número, o bot respondeu prometendo encaminhamento humano, mas nada foi de fato acionado (status não mudou, sem notificação) — mesmo antes de saber da causa raiz do trigger (S-WM-61), esse trecho de código já era estruturalmente frágil.

## Complexidade
M — mexe em lógica de fluxo conversacional real em 2 arquivos (`empregabilidade_engine.py`, `motor-agente/index.ts`), precisa de teste cuidadoso.

## Prioridade
P1 — necessário mesmo depois da S-WM-61 corrigir o bug pontual do trigger, porque **qualquer outra falha futura** nesse trecho (rede, timeout, erro de permissão, etc.) repetiria o mesmo sintoma: bot promete, nada acontece, lead fica sem resposta real.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - cd worker && python -m pytest tests/test_empregabilidade_engine.py -v → exit 0, incluindo testes novos de falha simulada
  - grep -n "try" worker/empregabilidade_engine.py (nos 3 blocos de transbordo) → confirmar try/except local, não só o wrapper genérico do chamador
  - Teste real: simular falha proposital (ex.: telefone inválido no template) e confirmar que o lead recebe mensagem de erro honesta, não a promessa de encaminhamento
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** que a IA só confirme ao lead que ele foi encaminhado para um humano DEPOIS que isso realmente aconteceu (status gravado + notificação enviada),
**para que** nunca mais aconteça de o bot prometer algo que não se concretizou, deixando o lead esperando uma resposta humana que nunca vai chegar.

## Contexto e Problema

**Empregabilidade** (`worker/empregabilidade_engine.py`) — os 3 gatilhos de transbordo (CNPJ duplicado `:954-975`, dúvida SQS-40 `:2619-2649`, palavra-chave "falar com atendente" `:2651-2685`) seguem o mesmo padrão:
1. Manda a mensagem de confirmação pro lead (`await e(...)`) **primeiro**.
2. **Depois** tenta: `UPDATE conversas SET status='awaiting_human'`, chama `_notificar_transbordo(...)`, e (só no caso do CNPJ) reseta o fluxo (`_set_fluxo_async`).
3. Nenhuma dessas 3 ações tem `try/except` local.
4. O chamador (`worker/meta_adapter_inbound.py:857-872`) envolve TODO o dispatch em um `except Exception` genérico que só loga e segue — qualquer falha nas 3 ações acima é engolida silenciosamente.

Resultado observado ao vivo: o lead recebeu "encaminhamos seu contato para verificação da nossa equipe", mas `status` continuou `ativa` e o fluxo voltou para `aguardando_cnpj` — nada do que foi prometido aconteceu.

**Institucional** (`motor-agente/index.ts:1806`) — ordem inversa (mais segura): tenta a ação **antes** de responder ao lead. Mas o `.update()` do supabase-js **não lança exceção** em erro de query/trigger (só em falha de rede), e o código **não checa o `error`** retornado — se o UPDATE falhar (ex.: o próprio bug do trigger antes da S-WM-61, ou qualquer erro futuro), a função segue normalmente e retorna `success:true, handover:true` pro Python, como se tivesse funcionado. `status` nunca muda de fato, mas ninguém percebe.

## Escopo

### IN
1. **Empregabilidade** — nos 3 blocos: envolver as 3 ações (update status, notificar, reset de fluxo) em `try/except` próprio; só enviar a mensagem de confirmação ao lead **depois** de confirmado sucesso; em caso de falha, enviar mensagem de erro honesta (não a promessa de encaminhamento) e logar em nível `ERROR` (não silencioso).
2. **Institucional** — em `index.ts:1806`: checar o `error` retornado pelo `.update()`; se falhar, logar em nível apropriado (a decidir se deve também mudar a mensagem que já foi enviada ao lead, dado que ali a ordem já é "notificar antes" — ver Dev Notes).
3. Testes novos simulando falha em cada um dos 3 blocos de Empregabilidade + no bloco de Institucional.

### OUT
- Não muda a lógica de **quando** o transbordo é acionado (gatilhos continuam os mesmos: CNPJ duplicado, dúvida, palavra-chave, tag `[[HANDOVER]]`).
- Não muda de onde vem o contato notificado (território da S-WM-63).
- Não corrige o trigger do banco (S-WM-61, pré-requisito para testar de ponta a ponta).

## Acceptance Criteria

1. **Given** qualquer um dos 3 gatilhos de Empregabilidade, **when** a gravação de status/notificação/reset falha (simulado em teste), **then** o lead recebe uma mensagem de erro honesta, não a promessa de encaminhamento — e o erro é logado em nível `ERROR`, não engolido silenciosamente sem rastro.
2. **Given** o mesmo cenário, **when** a gravação/notificação tem sucesso, **then** a mensagem de confirmação é enviada **depois**, não antes.
3. **Given** o Institucional (`index.ts:1806`), **when** o `.update()` retorna `error`, **then** isso é logado (nível apropriado a definir com @dev/@qa) em vez de ser descartado silenciosamente.
4. Nenhuma regressão nos 3 gatilhos de Empregabilidade nem no fluxo de handover do Institucional — suíte completa sem falhas novas.
5. Testes novos cobrindo os 4 cenários de falha (3 Empregabilidade + 1 Institucional, se houver suíte de teste aplicável ao `index.ts` — confirmar com @dev).

## Tasks / Subtasks

- [x] **Task 1 — Empregabilidade: bloco CNPJ duplicado** (AC: 1, 2)
  - [x] Reordenar: tentar as 3 ações primeiro, só confirmar ao lead depois.
  - [x] `try/except` local, log `ERROR` em falha, mensagem de fallback honesta ao lead.
- [x] **Task 2 — Empregabilidade: bloco dúvida (SQS-40) e palavra-chave** (AC: 1, 2)
  - [x] Mesmo tratamento dos 2 blocos restantes.
- [x] **Task 3 — Institucional: checar erro do update** (AC: 3)
  - [x] Adicionar checagem de `error` em `index.ts:1806`, decidir com @qa o nível de log/alerta apropriado (dado que a Edge Function já roda em ambiente com `get_logs` observável).
- [x] **Task 4 — Testes** (AC: 4, 5)
  - [x] Testes novos simulando falha em cada bloco.
  - [x] Rodar suíte completa, confirmar sem regressão.
- [x] **Task 5 — Fechamento**

## Dev Notes

- Padrão de referência pra "não presumir sucesso": olhar como `_processar_disparo_divulgacao_interno`/`_processar_item_disparo_interno` (`campanhas_engine.py`) já tratam erro de envio via `logs_disparo` — não precisa ser idêntico, mas é o padrão mais robusto já existente no worker pra "registrar o que realmente aconteceu".
- **Decisão de escopo (@po, validação de 2026-08-01):** no Institucional, a ordem hoje já é "notificar antes de responder ao lead" — mais segura que a Empregabilidade. Optado por **não inverter essa ordem** nesta story — só adicionar a checagem/log de erro (Task 3), mantendo o fluxo de resposta como está. Justificativa: menor mudança, menor risco de regressão no fluxo de resposta do motor-agente, e o objetivo principal (tentar notificar o humano) já acontece antes de qualquer coisa. Se no futuro isso se provar insuficiente (ex.: erro recorrente que precise mudar a resposta ao lead), abrir story separada — não reabrir esta.
- Esta story só é testável de ponta a ponta depois da **S-WM-61** (senão qualquer teste real bate no trigger quebrado e mascara se o tratamento de erro novo está funcionando ou só escondendo o bug antigo).

### Testing
`cd worker && python -m pytest tests/test_empregabilidade_engine.py -v`. Para o `index.ts`, confirmar com @dev se existe suíte de teste aplicável (`motor-agente/index.audit.test.ts`, mencionado em sessões anteriores) e seguir o padrão já usado lá.

## Dependências
**Depende da S-WM-61** para validação real de ponta a ponta (não bloqueia o desenvolvimento do código em si, só a validação final).

## Git workflow
Branch: `fix/endurecer-gatilhos-transbordo`. Não dar push/PR sem autorização explícita.

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-08-01 | 0.1 | Story criada a partir do diagnóstico de transbordo — cobre os 2 canais (Empregabilidade e Institucional), já que ambos compartilham o mesmo padrão de risco (mensagem otimista sem confirmação de sucesso). | @sm River |
| 2026-08-01 | 0.2 | **Validado por @po — GO.** 9/10 no checklist original; único ponto em aberto (ordem de resposta do Institucional) resolvido nesta validação com decisão de escopo de menor risco (não inverter a ordem, só logar erro — ver Dev Notes), evitando reabrir pergunta de produto para uma nuance de implementação. AC testáveis, escopo IN/OUT claro, dependência com S-WM-61 explicitada. Status Draft → Ready. | @po Pax |
| 2026-08-01 | 0.3 | **Implementado por @dev.** Empregabilidade passa a acionar status/notificação/reset antes de prometer atendimento; falhas recebem mensagem honesta e log `ERROR`. Institucional passa a logar erro retornado pelo `.update()`. Testes novos cobrem os 4 cenários de falha. Status Ready → Ready for Review. | @dev Dex |

## Dev Agent Record

### Agent Model Used
GPT-5 Codex

### Debug Log References
- `cd worker && ../.venv/bin/python -m pytest tests/test_empregabilidade_engine.py -v` → 63 passed, 2 warnings preexistentes de `datetime.utcnow()`.
- `cd worker && ../.venv/bin/python -m pytest tests/test_meta_adapter_inbound.py -q` → 52 passed, 1 warning preexistente de `gotrue`.
- `cd supabase/functions/motor-agente && deno test --no-check --allow-env --allow-net index.audit.test.ts` → 136 passed.
- `git diff --check` → passou.
- Tentativa informativa: `deno test --allow-env --allow-net index.audit.test.ts --filter "S-WM-64"` falhou no typecheck global preexistente do arquivo; reexecutado com `--no-check` conforme suíte audit runtime.

### Completion Notes List
- `_notificar_transbordo` agora retorna `bool`, preservando compatibilidade dos call sites que ignoram retorno e permitindo à Empregabilidade detectar notificação não enviada.
- Os 3 gatilhos de Empregabilidade usam `_acionar_transbordo_empregabilidade`, que só envia a mensagem de sucesso após status/notificação/reset concluírem; em falha, loga `ERROR` com `exc_info` e envia fallback honesto.
- No Institucional, o fluxo de resposta foi preservado conforme decisão de escopo; apenas o `error` do update para `awaiting_human` passou a ser logado.
- Teste real ponta a ponta ainda depende de execução em produção pelo Junior após deploy, conforme dependência operacional já documentada.

### File List
- `worker/empregabilidade_engine.py`
- `worker/meta_adapter_inbound.py`
- `worker/tests/test_empregabilidade_engine.py`
- `supabase/functions/motor-agente/index.ts`
- `supabase/functions/motor-agente/index.audit.test.ts`

## QA Results
_A preencher pelo @qa._
