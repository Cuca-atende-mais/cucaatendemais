# S-WM-33 — Ajuste da janela de debounce de dispatch (3s → 7s)

## Status
Ready for Review

## Complexidade
**PP** (muito pequena) — 1 valor de configuração + testes. Sem mudança no mecanismo de debounce em si (`_agendar_dispatch_debounced` continua igual).

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - pytest worker/tests/ → sem regressão no baseline vigente, teste novo do cenário 6-7s cobrindo o caso real
  - grep -n "META_DEBOUNCE_SECONDS" worker/ → confirmar valor 7 aplicado e nenhum outro lugar do repo hardcoda 3
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** que a janela de debounce de dispatch cubra intervalos reais de ~6-7s entre mensagens do mesmo lead,
**para que** mensagens de acompanhamento rápido (mas não instantâneo) continuem sendo agrupadas numa única resposta do bot, em vez de gerar respostas separadas e um pouco robóticas.

## Contexto e Problema

Teste ao vivo em produção (2026-07-14, 22:25-22:28 Fortaleza) reportou 2 respostas separadas do bot para 2 mensagens do mesmo lead ("Não precisa" / "Obrigado") enviadas em sequência rápida — sintoma parecia bug do debounce (VAL-05/PR#29).

**Diagnóstico do @dev, reproduzido com dado real do banco (antes do cron de reset diário apagar as linhas):** o intervalo real entre as duas mensagens foi de **6,127 segundos**, não menos de 5s como estimado inicialmente. Com a janela de debounce configurada em 3s (`META_DEBOUNCE_SECONDS`, default no código), o timer da 1ª mensagem já tinha disparado sozinho (~3s depois dela, antes da 2ª mensagem chegar) — **não havia bug**: o debounce funcionou exatamente como desenhado para um intervalo maior que a janela. A matemática bateu com precisão: cada resposta chegou ~3,47-3,49s depois do disparo do respectivo timer (tempo de processamento GPT/embedding), valores praticamente idênticos entre os 2 dispatches — forte evidência de que o modelo estava correto.

Decisão do Junior, dado o diagnóstico: em vez de deixar o comportamento como está (correto, mas com janela curta demais pro intervalo real observado), **ampliar a janela de debounce para 7 segundos** — cobre o caso real testado (6,13s) com margem, dentro do intervalo de 6-7s que o Junior definiu como aceitável.

## Escopo

### IN
1. Alterar o valor default de `META_DEBOUNCE_SECONDS` de 3 para 7 em `worker/meta_adapter_inbound.py`.
2. Conferir se algum teste existente depende implicitamente do valor 3s (nenhum encontrado na investigação prévia — `worker/tests/conftest.py` já stuba `_dormir_debounce` como instantâneo por padrão, então o valor numérico da janela não afeta a maioria dos testes).
3. Teste novo cobrindo especificamente o cenário que motivou a mudança: duas mensagens do mesmo lead com um intervalo real (~6s, testado em escala reduzida — ver Dev Notes) MENOR que a nova janela (7s) devem gerar **1 dispatch agrupado**, não 2 separados.
4. Atualizar comentário em `worker/tests/conftest.py` que documenta o valor default (dizia "3s", precisa dizer "7s").

### OUT
- Qualquer mudança no mecanismo de debounce em si (`_agendar_dispatch_debounced`, `_DEBOUNCE_TASKS`, cancelamento/reagendamento) — só o valor numérico da janela muda.
- Migração do debounce pra um mecanismo compartilhado (Redis/tabela) para suportar múltiplas réplicas — débito técnico já documentado e aceito, fora de escopo aqui.
- Deploy — nenhum deploy é executado por esta story (worker precisa de redeploy no EasyPanel para o valor novo valer em produção, mas isso é decisão de @devops/usuário, não executado automaticamente).

## Acceptance Criteria

1. **Given** o worker sem override de `META_DEBOUNCE_SECONDS` no ambiente, **when** `_debounce_segundos()` é chamado, **then** retorna `7.0` (era `3.0`).
2. **Given** duas mensagens do mesmo lead (mesmo `conversa_id`) com um intervalo real menor que a janela de debounce configurada, **when** processadas pelo worker, **then** geram **1 só dispatch** ao motor-agente (com o conteúdo da última mensagem) — não 2 dispatches separados. Teste cobre especificamente a proporção do cenário real (~6s de intervalo dentro de uma janela de 7s).
3. **Given** a suíte `pytest worker/tests/`, **when** executada após a mudança, **then** passa sem regressão — nenhum teste existente dependia do valor antigo (3s) de forma que quebre com 7s.
4. **(Trade-off, registrado explicitamente — não é efeito colateral escondido)** Aumentar a janela de 3s para 7s significa que **toda** mensagem — inclusive uma mensagem solitária, sem sequência — agora espera até 7s (em vez de 3s) antes do bot responder. Um lead que manda 1 única mensagem sente a resposta ~4s mais lenta que antes. Este é o preço aceito para agrupar corretamente mensagens mais espaçadas (até ~7s), decisão consciente do Junior após o diagnóstico confirmar que não havia bug, só uma janela curta demais.

## Tasks / Subtasks

- [x] **Task 1 — Alterar o valor default** (AC: 1)
  - [x] `worker/meta_adapter_inbound.py:493`: `META_DEBOUNCE_SECONDS` default de `"3"` para `"7"`.
- [x] **Task 2 — Conferir testes existentes que hardcodam expectativa de 3s** (AC: 3)
  - [x] `grep` confirmou: nenhum teste asserta o valor numérico da janela nem depende de timing real (`conftest.py` já stuba `_dormir_debounce` como instantâneo por padrão, autouse). Único ponto textual: comentário em `conftest.py` mencionando "default 3s" — atualizado para "7s" (Task 4).
- [x] **Task 3 — Teste novo do cenário 6-7s → 1 dispatch agrupado** (AC: 2)
  - [x] `test_debounce_segundos_default_e_7s` — confirma o valor de configuração.
  - [x] `test_mensagens_com_intervalo_de_6s_ficam_dentro_da_janela_de_7s_e_agrupam` — reproduz em escala reduzida (fator 100x, sem esperar segundos reais) o cenário exato do incidente: intervalo de ~6s dentro de uma janela de 7s → 1 só dispatch, com o conteúdo da última mensagem.
- [x] **Task 4 — Atualizar comentário desatualizado** (AC: —, consistência)
  - [x] `worker/tests/conftest.py:18`: "default 3s" → "default 7s".

## Dev Notes

### Diagnóstico prévio (não é parte desta story, mas motiva a mudança)
Ver conversa de investigação: intervalo real de 6,127s entre "Não precisa" (01:27:57.701 UTC) e "Obrigado" (01:28:03.828 UTC), lead `valmirmoreirajunior` (558591733321), conversa `b428d3d0-d89e-43b3-9042-242f6fee07a2`. Debounce de 3s funcionou corretamente por desenho — não era bug. `S-WM-31` (Task 2, `8a144bf`) não tocou o mecanismo de debounce por proximidade de código (diff isolado no bloco de upsert de `conversas` e no payload de `_chamar_motor_agente`).

### Teste em escala reduzida (Task 3)
Testar a proporção intervalo/janela sem esperar segundos reais: `_debounce_segundos` é monkeypatched para retornar `0.07` (7s ÷ 100) e `_dormir_debounce` é substituído por um wrapper que realmente chama `asyncio.sleep` (não o stub instantâneo do autouse), sincronizado por um `asyncio.Event` que confirma que o debounce da 1ª mensagem já começou antes de medir o intervalo de `0.06` (6s ÷ 100) até a 2ª mensagem chegar. Preserva a razão real (6 < 7) que é o que importa para o comportamento testado, mantendo a suíte rápida.

### Testing
- `pytest worker/tests/`: a rodar e reportar no Dev Agent Record.

## Riscos
- Trade-off de latência (AC4) — mensagem solitária ~4s mais lenta. Aceito conscientemente pelo Junior.
- Limitação já conhecida e documentada (fora de escopo): `_DEBOUNCE_TASKS` é um dict em memória, só funciona com `gunicorn -w 1` (processo único) — não muda com esta story.

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-14 | 0.1 | Story criada diretamente pelo @dev a pedido do Junior (incidente ao vivo + diagnóstico + decisão de ampliar a janela) — formato leve, sem ciclo completo @sm/@po dado o tamanho da mudança e a urgência; validação de conteúdo feita pelo próprio Junior ao longo da conversa. Status Draft → InProgress. | @dev Dex |
| 2026-07-14 | 0.2 | Implementação completa (Tasks 1-4): valor default alterado de 3s para 7s, nenhum teste dependia do valor antigo, 2 testes novos cobrindo o cenário real (6s dentro da janela de 7s → 1 dispatch agrupado), mutation testing confirmou o teste distingue corretamente janela antiga (3s, reproduz o bug) de janela nova (7s, agrupa). Suíte completa verde (131 passed, 0 failed, 3 skipped). Nenhum commit feito ainda nesta sessão — a seguir. Status InProgress → Ready for Review. | @dev Dex |

## Dev Agent Record

### Task 1 — Alterar o valor default (2026-07-14)
- `worker/meta_adapter_inbound.py:493`: `META_DEBOUNCE_SECONDS` default `"3"` → `"7"`.
- `pytest worker/tests/`: **129 passed, 0 failed, 3 skipped** (baseline igual ao final da S-WM-32, sem regressão) — confirma Task 2 na prática: nenhum teste dependia do valor numérico antigo.

### Task 2 — Conferência de testes hardcoded (2026-07-14)
- `grep -rn "3s\|3 segundos" worker/*.py worker/tests/*.py`: único ponto textual foi o comentário em `conftest.py:18` ("default 3s") — não é asserção de teste, só documentação desatualizada (corrigido na Task 4). Nenhum teste asserta o valor numérico de `_debounce_segundos()` nem depende de timing real por padrão (`_dormir_debounce` já é stubado como instantâneo via fixture `autouse` em `conftest.py`).

### Task 3 — Testes novos (2026-07-14)
- `test_debounce_segundos_default_e_7s`: confirma `_debounce_segundos() == 7.0` sem override de ambiente.
- `test_mensagens_com_intervalo_de_6s_ficam_dentro_da_janela_de_7s_e_agrupam`: reproduz o cenário do incidente em escala reduzida (fator 100x) — janela 0,07s (7s), intervalo real medido 0,06s (6s) entre as duas mensagens, sincronizado por `asyncio.Event` (garante que o debounce da 1ª mensagem já começou antes de medir o intervalo). Resultado: 1 só dispatch, com o conteúdo da última mensagem ("Obrigado").
- **Mutation testing:** alterei temporariamente a janela do teste pra `0.03` (equivalente a 3s, o valor antigo) mantendo o intervalo em `0.06` (6s) — teste falhou corretamente, confirmando 2 dispatches separados (`_chamar_motor_agente` called 2 times, uma com "Não precisa" e outra com "Obrigado") — reproduz exatamente o sintoma do incidente original. Restaurado para `0.07` (7s) e reconfirmado verde.
- `pytest worker/tests/test_meta_adapter_inbound.py -k debounce`: **5 passed** (3 testes já existentes de VAL-05 + 2 novos desta story).
- `pytest worker/tests/` (suíte completa): **131 passed, 0 failed, 3 skipped**.

### Task 4 — Comentário desatualizado (2026-07-14)
- `worker/tests/conftest.py:18`: "default 3s" → "default 7s — S-WM-33".

### File List
- `worker/meta_adapter_inbound.py` (modificado — Task 1)
- `worker/tests/conftest.py` (modificado — Task 4)
- `worker/tests/test_meta_adapter_inbound.py` (modificado — Task 3, 2 testes novos)
- `docs/stories/S-WM-33-Ajuste-Janela-Debounce-3s-Para-7s.md` (novo)

Nenhum commit/push/deploy executado ainda nesta sessão de story — aguardando @qa.

## QA Results
_A ser preenchido pelo @qa após a implementação._
