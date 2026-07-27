# S-WM-53 — Logar `telefone`/`conversa_id` e se lead/conversa são novos, quando `motor-agente` rejeita com HTTP 400

## Status
Ready for Review

## Origem
Investigação "Corrida da Juventude" (disparo de 724 leads, 24/07/2026) — `docs/qa/DIAGNOSTICO-disparo-corrida-juventude-2026-07-27.md`, achado #1. Plano técnico completo, com trechos de código antes/depois e comandos de verificação, preservado integralmente em `docs/qa/planos-corrida-juventude/002-log-telefone-vazio-motor-agente-400.md` — usar esse arquivo como referência técnica primária, não este resumo. Elaborado em 2026-07-25/26 (commit base `256d547`). Formalizada em story por @sm em 2026-07-27, setup de teste ("Equipe Interna — QA") já criado e confirmado.

## Complexidade
**S** — 2 pontos de instrumentação (logs), sem mudança de comportamento.

## Prioridade
P1 — 32 de ~69 chamadas do worker ao `motor-agente` falharam com HTTP 400 (`"telefone e agente_tipo sao obrigatorios"`) durante o disparo de 24/07 (46% de falha, 30 pessoas reais atingidas). Causa raiz **não confirmada** — este plano é só a instrumentação que vai fechar a causa na próxima ocorrência.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - cd worker && pytest tests/test_meta_adapter_inbound.py -v → todos passam, incluindo os 2 testes novos
  - cd worker && pytest tests/ -v → suíte completa sem regressão
  - grep -n "telefone=" worker/meta_adapter_inbound.py → pelo menos 1 ocorrência dentro de _chamar_motor_agente
  - grep -n "DIAG-achado1" worker/meta_adapter_inbound.py → pelo menos 2 ocorrências (log de sucesso + log do except)
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** que o worker logue `telefone`/`conversa_id` quando o `motor-agente` rejeita uma chamada com HTTP 400, e também se o lead/conversa envolvidos eram novos ou já existiam,
**para que** a próxima ocorrência real do bug de "telefone vazio" tenha o dado que falta pra fechar a causa raiz de vez — hoje não há acesso a SSH/`docker logs` do host pra reconstruir isso depois do fato.

## Contexto e Problema

`worker/meta_adapter_inbound.py::_chamar_motor_agente` (linha ~292) já loga toda falha não-2xx do `motor-agente`, mas **sem** `telefone`/`conversa_id` — exatamente os 2 dados que faltam pra saber se o problema é o valor vazio, truncado, ou outra coisa (o próprio erro devolvido já é literalmente `{"error": "telefone e agente_tipo sao obrigatorios"}`).

Achados que já restringem a busca, mas não fecham a causa: 27 de 32 casos têm 11-12,5s entre `leads.created_at` e a falha (bate com debounce 10s + processamento — forte correlação com "1ª mensagem de lead recém-criado"), mas **não é 100% determinístico** (alguns leads novos não falham) e o bug se repete fora de disparo em massa. Já descartado por leitura de código: corrida no debounce, estado compartilhado no FastAPI, tipo de mensagem não suportado, e triggers de banco em `leads`/`conversas`/`mensagens` (`information_schema.triggers` vazio para as 3 tabelas).

## Escopo

### IN
1. **Log de falha existente** (`_chamar_motor_agente`, bloco `if not resp.is_success:`) — adicionar `conversa_id` e `telefone` (via `contrato_v2.get("telefone")`, não `[...]`, e com `%r` não `%s` — se o valor for `None` em vez de `""`, isso aparece diferente no log e pode ser a pista).
2. **Log novo de diagnóstico** (`processar_webhook_meta`, logo depois do bloco "DB B" — conversa resolvida, antes do "DB C") — `[meta-inbound][DIAG-achado1]` indicando se lead e conversa foram criados agora (`created_at == updated_at`) ou já existiam, correlacionável com o log de falha via `conversa_id`. Dispara em **toda mensagem recebida**, não só nas que falham depois (proposital — precisa da taxa de falha entre "novo" vs "existente" nos dois grupos, não só nos que já falharam). Requer adicionar `created_at, updated_at` ao select de `conv_fresh`.
3. Testes: 1 confirmando que o log de falha inclui os 2 campos novos; 1 confirmando que o log `[DIAG-achado1]` aparece com `lead_novo=True` no cenário de lead novo.
4. Mutation check manual: reverter cada mudança isoladamente, confirmar que o teste correspondente falha; restaurar, confirmar que volta a passar.

### OUT
- Qualquer tentativa de corrigir a causa raiz do "telefone vazio" — **ainda não confirmada**. Corrigir às cegas seria chute; este plano é só o log que revela a causa na próxima ocorrência.
- `supabase/functions/motor-agente/index.ts` — a validação que rejeita com 400 está correta e não muda.
- Qualquer outro log/print do arquivo fora dos 2 pontos acima.
- Sentry ou qualquer alerta externo — não introduzir a dependência agora.

## Acceptance Criteria

1. **Given** o `motor-agente` responde HTTP 400, **when** `_chamar_motor_agente` loga a falha, **then** o log contém `conversa_id` e `telefone` (via `%r`, distinguindo `None` de `""`).
2. **Given** um webhook Meta processado, **when** lead e conversa são resolvidos, **then** um log `INFO` com tag `[DIAG-achado1]` registra `conversa_id`, `lead_id`, `lead_novo`, `conversa_nova` — em **toda** mensagem, não só nas que falham depois.
3. **Given** o teste do cenário 1 revertido (log volta ao formato antigo), **when** rodado, **then** falha — prova que o teste exercita a proteção de verdade. Mesmo para o cenário 2.
4. **Given** `created_at`/`updated_at` ausentes por qualquer motivo no retorno do supabase-py, **when** o cálculo de `lead_novo`/`conversa_nova` roda, **then** não quebra o fluxo normal (try/except em volta, log de warning).
5. `pytest tests/` (de dentro de `worker/`) sai com exit 0, incluindo os 2 testes novos.
6. Nenhum arquivo fora de `worker/meta_adapter_inbound.py` e `worker/tests/test_meta_adapter_inbound.py` é modificado.

## Tasks / Subtasks

- [x] **Task 1 — Log de falha com telefone/conversa_id** (AC: 1, 3)
  - [x] Adicionados os 2 campos ao log existente em `_chamar_motor_agente` (linha 350).
  - [x] Teste + mutation check (revertido → falhou corretamente; restaurado → passou).
- [x] **Task 2 — Log de diagnóstico lead_novo/conversa_nova** (AC: 2, 3, 4)
  - [x] Adicionado `created_at, updated_at` ao select de `conv_fresh`.
  - [x] Adicionado o bloco `[DIAG-achado1]` com try/except.
  - [x] Teste + mutation check (revertido → falhou corretamente; restaurado → passou).
- [x] **Task 3 — Fechamento** (AC: 5, 6)
  - [x] Suíte completa (`pytest tests/`) sem regressão: 141 passed (139 baseline + 2 novos), as 3 falhas pré-existentes de `test_meta_adapter_outbound.py` (`ModuleNotFoundError: No module named 'worker'`, arquivo fora de escopo, ambiente de import, não código) continuam idênticas, não são desta story.
  - [x] File List e Change Log atualizados.
  - [x] Anunciado conclusão e recomendado @qa.

## Dev Notes

- Trechos de código antes/depois exatos (linhas 173-183, 199-222), estrutura completa dos 2 testes e do mutation check: **`docs/qa/planos-corrida-juventude/002-log-telefone-vazio-motor-agente-400.md`** — ler por completo antes de editar.
- Padrão de mock a reaproveitar: procurar testes já existentes de `_chamar_motor_agente` e de `processar_webhook_meta` completo no mesmo arquivo de teste — copiar o padrão de mock do cliente HTTP assíncrono, não inventar um novo. Se nenhum existir, **parar e perguntar** antes de criar um payload Meta mockado do zero (não é decisão pra tomar sozinho).
- Comparação `created_at == updated_at` é aproximação (ambos vêm de `now()` no mesmo INSERT; num UPDATE via upsert, só `updated_at` muda) — não precisa ser exata ao milissegundo, só classificar novo vs. existente.
- Esses logs são **temporários**, tag `[DIAG-achado1]` de propósito para filtrar/remover fácil quando a causa do achado #1 for confirmada. Quando a próxima ocorrência real acontecer: cruzar os 2 logs por `conversa_id` — se `lead_novo=True`/`conversa_nova=True` aparecer sempre que a falha disparar (e nunca quando não falha), causa confirmada; se aparecer misturado (como hoje, ~75-80%), o próximo passo é olhar o que mais difere dentro do subconjunto "lead novo".
- Sem dependência técnica com as demais stories da leva, mas **sequenciada antes da S-WM-54** (Plano 003) — mesmo arquivo (`worker/meta_adapter_inbound.py`), pra evitar conflito de merge. Mergear esta primeiro.

### Testing
`cd worker && pytest tests/test_meta_adapter_inbound.py -v` e depois `pytest tests/` (suíte completa).

## Dependências
Nenhuma tecnicamente. **Bloqueia (por sequenciamento, não por dependência técnica) a S-WM-54** — mesmo arquivo, mergear esta antes para evitar conflito.

## Git workflow
Branch: `fix/log-telefone-vazio-motor-agente-400`. Commit único: `fix(worker): loga telefone/conversa_id quando motor-agente rejeita requisicao com 400`. Não dar push/PR sem autorização explícita.

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-27 | 0.1 | Story criada a partir do Plano 002 (investigação "Corrida da Juventude", 2026-07-25/26). 2ª story da leva — sem dependência técnica, mas sequenciada antes da S-WM-54 (mesmo arquivo). | @sm River |
| 2026-07-27 | 0.2 | Implementada em branch isolada `fix/log-telefone-vazio-motor-agente-400` (a partir de `origin/main`, já com a S-WM-52 mergeada). Sem drift contra o plano (`git diff --stat 256d547..HEAD` vazio). 2 blocos de log + 2 testes novos, mutation check em ambos. Suíte: 141/0/2 novos (3 falhas pré-existentes, arquivo/módulo fora de escopo, inalteradas). Status Draft → Ready for Review. | @dev Dex |

## Dev Agent Record

### Agent Model Used
Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References
- Drift check (`git diff --stat 256d547..HEAD -- worker/meta_adapter_inbound.py worker/tests/test_meta_adapter_inbound.py`): vazio — sem drift.
- Baseline: `pytest tests/test_meta_adapter_inbound.py -q` → 45 passed. `pytest tests/ -q` (suíte completa) → 139 passed, 3 failed (pré-existente: `test_meta_adapter_outbound.py::TestSendMessageEndpoint::{test_envia_via_meta_com_contrato_novo, test_rejeita_contrato_antigo_phone_message, test_rejeita_token_invalido}`, todas com `ModuleNotFoundError: No module named 'worker'` — falha de import do módulo `worker.main`, reproduzida idêntica rodando tanto de dentro de `worker/` quanto da raiz do repo com `python3 -m pytest worker/tests/`; não é código desta story, arquivo fora de escopo, não introduzida por mim).
- Step 1: `logger.error` em `_chamar_motor_agente` ganhou `conversa_id=%s telefone=%r`.
- Step 2: select de `conv_fresh` ganhou `created_at, updated_at`; bloco `[DIAG-achado1]` adicionado com `try/except (IndexError, KeyError, AttributeError)`.
- 2 testes novos: `test_log_de_falha_400_inclui_telefone_e_conversa_id` (mock de `httpx.AsyncClient` via `_make_mock_httpx`, já existente na classe `TestDispatchMotorAgente`) e `test_log_diagnostico_indica_lead_novo` (webhook completo, mock de `supabase` no mesmo padrão de `test_processar_webhook_agentes_motor_agente`, `created_at == updated_at` pra simular lead/conversa novos).
- Suíte pós-mudança: `pytest tests/test_meta_adapter_inbound.py -q` → 47 passed (45 baseline + 2 novos). `pytest tests/ -q` → 141 passed, mesmas 3 falhas pré-existentes.
- Mutation check: Step 1 revertido isoladamente → `test_log_de_falha_400_inclui_telefone_e_conversa_id` falhou (`assert "conversa-teste-123" in caplog.text` — não achou, log no formato antigo). Restaurado → passou. Step 2 revertido isoladamente → `test_log_diagnostico_indica_lead_novo` falhou (`assert "DIAG-achado1" in caplog.text` — não achou, bloco removido). Restaurado → passou. Suíte completa reconfirmada 141/3(pré-existentes)/0(novas) após restaurar ambos.
- `grep -n "telefone=" meta_adapter_inbound.py` → linha 350 (dentro de `_chamar_motor_agente`). `grep -n "DIAG-achado1"` → linhas 666 e 670 (log de sucesso + log do `except`).

### Completion Notes List
- Implementado exatamente como especificado no plano preservado (`docs/qa/planos-corrida-juventude/002-log-telefone-vazio-motor-agente-400.md`), sem drift — trechos "Estado atual" conferidos linha a linha contra o código ao vivo antes de editar.
- As 3 falhas pré-existentes em `test_meta_adapter_outbound.py` são um problema de import de ambiente (`worker.main`), não relacionado a este arquivo/story — confirmadas idênticas antes e depois da mudança, em 2 formas de invocação diferentes (de dentro de `worker/` e da raiz do repo via `python3 -m pytest`). Não corrigidas aqui (fora de escopo desta story).
- Nenhum arquivo fora de `worker/meta_adapter_inbound.py` e `worker/tests/test_meta_adapter_inbound.py` foi modificado.

### File List
- `worker/meta_adapter_inbound.py` (modificado: 2 blocos de log de instrumentação)
- `worker/tests/test_meta_adapter_inbound.py` (modificado: 2 testes novos, dentro de `TestDispatchMotorAgente`)

## QA Results

**Revisão:** @qa Quinn, 2026-07-27 — branch `fix/log-telefone-vazio-motor-agente-400`, commit `be6db05`.

**Verificação independente (não me baseei só no relato do @dev):**

1. **Drift check** — confirmei eu mesma `git diff --stat 256d547..70af62b -- worker/meta_adapter_inbound.py worker/tests/test_meta_adapter_inbound.py` (entre o commit-base do plano e o commit-pai desta story, ANTES do diff do @dev) → vazio. Sem drift real.
2. **Diff revisado linha a linha** (`git show be6db05`) — os 2 blocos batem exatamente com o plano preservado (`docs/qa/planos-corrida-juventude/002-...md`): `%r` pro telefone (distingue `None` de `""`), `.get("telefone")` (não `[...]`), `try/except (IndexError, KeyError, AttributeError)` em volta do cálculo de `lead_novo`/`conversa_nova`. Contei os placeholders `%s`/`%r` de cada log contra os argumentos passados — batem (5 e 5; 4 e 4).
3. **Suíte — rodei eu mesma**: `pytest tests/test_meta_adapter_inbound.py -q` → 47 passed. `pytest tests/ -q` (completa) → 141 passed, 3 failed. Bate com o relatado.
4. **As 3 falhas pré-existentes — investiguei a causa raiz, não só confirmei a contagem**: `test_meta_adapter_outbound.py::TestSendMessageEndpoint::{test_envia_via_meta_com_contrato_novo, test_rejeita_contrato_antigo_phone_message, test_rejeita_token_invalido}`, todas com `ModuleNotFoundError: No module named 'worker'` na linha `import worker.main as main_module`. Confirmei que **não existe `worker/__init__.py`** — `worker` não é um pacote Python de verdade, então esse `import` está estruturalmente quebrado independente de CWD ou forma de invocação (testei `pytest` de dentro de `worker/` e `python3 -m pytest worker/tests/` da raiz — mesmo resultado nos dois). Confirmei também, fazendo checkout temporário das versões desses 2 arquivos no commit-pai (`70af62b`, antes do diff desta story) e rodando a suíte completa: **as mesmas 3 falhas, com os mesmos nomes**, já existiam antes (139 passed/3 failed) — restaurei os arquivos pro estado do commit logo depois. `git log` do arquivo de teste que falha mostra a última mudança relevante em `8a144bf` (S-WM-31), muito antes desta leva. **Confirmado: fora de escopo desta story, ambiental (import de pacote), idêntico antes e depois — não bloqueante.**
5. **Escopo** — `git show be6db05 --stat` e `git diff --stat 70af62b..HEAD -- worker/` confirmam só `worker/meta_adapter_inbound.py` e `worker/tests/test_meta_adapter_inbound.py` tocados (fora o arquivo da própria story).
6. **Mutation check reproduzido por mim, independentemente** — revertei o Step 1 isoladamente: `test_log_de_falha_400_inclui_telefone_e_conversa_id` falhou (log no formato antigo, sem `conversa_id`). Restaurei → passou. Revertei o Step 2 isoladamente: `test_log_diagnostico_indica_lead_novo` falhou (sem `DIAG-achado1` no log). Restaurei → passou. Suíte completa reconfirmada 141/3(pré-existentes)/0(novas) depois de restaurar tudo.
7. **Compatibilidade com o resto do pipeline (pedido 4)** — busquei no repo inteiro por qualquer parser/regex/dashboard que dependesse do formato textual antigo dessas 2 linhas de log (`grep` por `"motor-agente HTTP"`, `"DIAG-achado1"`, sistemas de log parsing/alerting) — **nada encontrado**. Consistente com o que o próprio diagnóstico da leva já registra: este projeto não tem nenhuma monitoração automatizada de log, só checagem manual no EasyPanel. Os 2 logs novos só **adicionam campos ao final da string formatada** (não removem nem reordenam nada que já existia) — mesmo que houvesse um parser textual em algum lugar não encontrado por mim, um parser que dependesse só do prefixo (`"[meta-inbound] motor-agente HTTP %s"`) continuaria funcionando; um que dependesse do sufixo exato quebraria, mas não achei nenhum.

**AC1-6:** todos atendidos, com verificação independente de cada um.

**Verdict: PASS**

— Quinn, guardiã da qualidade 🛡️
