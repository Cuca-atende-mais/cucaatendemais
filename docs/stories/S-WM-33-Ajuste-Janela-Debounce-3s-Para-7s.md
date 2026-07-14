# S-WM-33 — Ajuste da janela de debounce de dispatch (3s → 7s)

## Status
InReview

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
| 2026-07-14 | 0.3 | QA Gate: **PASS**. Reproduzido independentemente: diff mínimo confirmado, suíte completa (131/0/3-skip), mutation testing #1 (janela do teste revertida pra 3s equivalente, falha corretamente) e mutation testing #2 adicional (valor de produção revertido pra 3, teste de configuração falha corretamente) — confirma que os 2 testes novos, juntos, protegem AC1 e AC2 de forma complementar. Achado não-bloqueante registrado: esta story muda `worker/`, não Edge Function — deploy correspondente é redeploy do worker no EasyPanel, não `supabase functions deploy`; sinalizado para @devops confirmar antes de considerar o fix "no ar". Status Ready for Review → InReview. | @qa Quinn |

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

**Revisor:** @qa Quinn · **Data:** 2026-07-14 · **Verdict: PASS**

Reprodução independente (não confiei no relato do @dev):

- **Code review:** `git show ba0615a` — diff mínimo e exatamente como descrito: 1 caractere trocado em `meta_adapter_inbound.py:493` (`"3"` → `"7"`), 1 comentário corrigido em `conftest.py:18`, 2 testes novos em `test_meta_adapter_inbound.py`. Nenhuma mudança fora do escopo declarado (mecanismo de `_agendar_dispatch_debounced`/`_DEBOUNCE_TASKS` intocado, confirmado por leitura).
- **Suíte completa, rodada do zero:** `pytest worker/tests/` → **131 passed, 0 failed, 3 skipped** (baseline 129/0/3-skip + 2 testes novos, sem regressão). Confirmei também que `META_DEBOUNCE_SECONDS` não está setada no ambiente de teste (evita falso-positivo por override mascarando o default).
- **Mutation testing #1 (reproduzido independentemente):** troquei a janela hardcoded do teste de cenário (`0.07` → `0.03`, equivalente ao valor antigo de 3s) mantendo o intervalo em `0.06` (6s) — teste falhou corretamente, `_chamar_motor_agente` chamado 2 vezes (uma com "Não precisa", outra com "Obrigado") — reproduz exatamente o sintoma do incidente original. Restaurado, suíte volta ao verde.
- **Mutation testing #2 (adicional, não reportado pelo @dev — fiz por conta própria):** reverti o valor de produção em `meta_adapter_inbound.py` (`"7"` → `"3"`) mantendo os testes intactos — `test_debounce_segundos_default_e_7s` falhou corretamente (`assert 3.0 == 7.0`). Isso prova que os 2 testes novos, juntos, protegem tanto o valor de configuração real (AC1) quanto o comportamento de agrupamento na proporção 6s/7s (AC2) — nenhum dos dois sozinho cobriria as duas coisas (o teste de cenário usa uma janela hardcoded independente do valor de produção).
- **AC1:** confirmado — `_debounce_segundos()` retorna `7.0` sem override de ambiente.
- **AC2:** confirmado — cenário do incidente (6s dentro de janela de 7s) gera exatamente 1 dispatch, com o conteúdo da última mensagem.
- **AC3:** confirmado — suíte completa sem regressão (129→131, só os 2 testes novos a mais).
- **AC4 (trade-off):** documentado explicitamente na story, não escondido — conferido que o texto está presente e correto.
- **Segurança/OWASP:** não aplicável — mudança é só um valor numérico de configuração interna, sem superfície nova de entrada/saída, sem dado sensível envolvido.
- **Documentação:** story completa e consistente com o diff real (Status, Dev Agent Record por Task, File List, Change Log) — nada divergente entre o que a story diz e o que o código mostra.

### Achado adicional (não-bloqueante, mas importante para @devops)

Diferente da S-WM-31/S-WM-32 (que tocaram Edge Functions no Supabase), **esta story só muda código em `worker/`** — o deploy correspondente é **redeploy do worker no EasyPanel** (`cuca-worker-staging` em `develop`, `cuca-worker` em `main` após promoção), não `supabase functions deploy`. Sem esse redeploy, o valor novo (7s) não entra em vigor em nenhum ambiente real — a mudança fica só no código até o próximo deploy do worker. Vale confirmar com @devops que esse redeploy específico (worker, não Edge Function) está no radar antes de considerar o fix "no ar".

### Veredito

**PASS.** Mudança mínima, bem contida, com testes que provadamente (mutation-tested em ambas as direções) protegem tanto o valor de configuração quanto o comportamento de agrupamento na proporção real do incidente. Sem regressão, sem risco de segurança, trade-off documentado como pedido. Próximo passo: @devops — commit já feito (`ba0615a`), branch limpa a partir de `origin/develop`, push + PR. Lembrar do redeploy do **worker** (não Edge Function) no EasyPanel como próximo passo pós-merge.

**Status:** Ready for Review → InReview.
