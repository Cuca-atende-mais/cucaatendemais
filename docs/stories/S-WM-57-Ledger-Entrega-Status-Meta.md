# S-WM-57 — Ledger por destinatário de disparo (`logs_disparo`) + consumir `statuses[]` da Meta

## Status
Ready for Review

## Origem
Investigação "Corrida da Juventude" (disparo de 724 leads, 24/07/2026) — `docs/qa/DIAGNOSTICO-disparo-corrida-juventude-2026-07-27.md`, achados arquiteturais nº 2 e nº 3 (seção 4) / achados B e C do diagnóstico arquitetural. Plano técnico completo, com a migration exata, os 6 passos e os 6 testes especificados, preservado integralmente em `docs/qa/planos-corrida-juventude/007-ledger-entrega-e-status-meta.md` — usar esse arquivo como referência técnica primária, não este resumo. Elaborado em 2026-07-26/27 (commit base `256d547`) — **não** dry-run executado ao vivo (sem Postgres disponível na sessão de origem); diff produzido por leitura direta do código, tratar com mais escrutínio que as demais stories da leva. Formalizada em story por @sm em 2026-07-27, setup de teste ("Equipe Interna — QA") já criado e confirmado.

## Complexidade
**L** — maior esforço da leva: 1 migration reativando tabela existente, mudança de assinatura de função com 4 call sites, 2 funções de disparo com novo controle de fluxo (criação de `disparos` antes do loop), novo consumo de webhook, 6 testes novos (nenhum teste prévio cobre as 2 funções de disparo em massa hoje).

## Prioridade
P1 — "maior alavanca" recomendada pelo diagnóstico arquitetural: hoje o sistema só sabe se o POST à Meta teve sucesso HTTP, nunca se a mensagem foi de fato entregue, lida ou falhou — sem isso, não há visibilidade de risco de qualidade/bloqueio do número.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - cd worker && python -c "import campanhas_engine; import meta_adapter_inbound; import main" → exit 0
  - cd worker && python -m pytest tests/ -v → exit 0, incluindo os 6 testes novos
  - grep -n "def _enviar_template_meta" -A 2 worker/campanhas_engine.py | grep "tuple\[bool, str | None\]" → assinatura atualizada
  - grep -c "logs_disparo" worker/campanhas_engine.py → pelo menos 2 (ambas as funções de disparo escrevem no ledger)
  - grep -n "statuses" worker/meta_adapter_inbound.py → novo bloco de tratamento
  - Query read-only em produção confirmando `logs_disparo` ainda com 0 linhas e sem FK, ANTES de escrever a migration do Step 1 (Task 0, ver abaixo)
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** um ledger por destinatário de cada disparo (capturando o `wamid`) e o consumo dos eventos `statuses[]` que a Meta manda (entregue/lido/falhou),
**para que** o sistema saiba, pela primeira vez, distinguir "a Meta aceitou o HTTP" de "a mensagem realmente chegou/foi lida/falhou" — hoje esse dado existe no webhook e é descartado sem leitura.

## Contexto e Problema

Hoje, quando um disparo em massa manda um template WhatsApp, o código só sabe se o **HTTP** da Graph API teve sucesso (`_enviar_template_meta` retorna `bool`) — nunca captura o `wamid` (ID da mensagem Meta) nem lê o array `statuses[]` que o webhook manda depois (entregue/lido/falhou/não-entregue). O handler do webhook já descarta explicitamente todo evento sem `messages[]` (`"Ignorar eventos de status (delivery, read) sem messages[]"`) — hoje isso inclui 100% dos eventos de status.

Duas consequências já observadas na investigação de 24/07: (1) não há como distinguir "aceito pela Meta" de "entregue à pessoa" — se um número está bloqueado/inatingível, o sistema não registra isso; (2) não há visibilidade de risco de qualidade do número (`quality_rating`/`messaging_limit_tier` já existem em `meta_phone_numbers`, nunca populados por nada no repo) — hoje só se percebe um problema de qualidade por reclamação humana.

**Descoberta em 2026-07-27:** a tabela pra isso já existe, abandonada — `public.logs_disparo` (`id, disparo_id, lead_id, telefone, status, erro, enviado_em, created_at`), 0 linhas em produção, código que escrevia nela removido no commit `b8282cd` (S-WM-05, migração UAZAPI→Meta). Esta story **reativa** essa tabela via `ALTER TABLE`, em vez de criar uma 3ª tabela sobreposta no schema.

**Escopo deliberadamente aditivo:** esta story não muda quando uma campanha pausa, retoma ou como leads são selecionados — só registra o que foi enviado, pra quem, e reage a status. A correção do truncamento de `daily_limit` (achado C — campanha marcada "concluída" mesmo com gente faltando) fica pra uma story futura (Plano 008, ainda não escrito), que depende deste ledger e de uma decisão de produto (retomada automática ou manual) ainda não tomada.

## Escopo

### IN
1. **Migration** `supabase/migrations/20260727000000_reativa_logs_disparo_ledger.sql` — `ALTER TABLE logs_disparo ADD COLUMN disparo_divulgacao_id uuid, ADD COLUMN wamid text, ADD COLUMN atualizado_em timestamptz NOT NULL DEFAULT now()`, mais `CHECK` garantindo exatamente um entre `disparo_id`/`disparo_divulgacao_id`, mais 3 índices (`wamid`, `lead_id`, `disparo_divulgacao_id`, todos `WHERE ... IS NOT NULL`). **Ajuste sobre o texto original do plano (Task 0, 2026-07-27):** a premissa "sem FK, mesmo padrão da tabela hoje" estava desatualizada — confirmado ao vivo que `disparo_id`/`lead_id` já têm FK (`ON DELETE CASCADE` pra `disparos`/`leads`, decisão de produto mantida pelo Junior sem mudança). A coluna nova `disparo_divulgacao_id` segue a mesma convenção: `REFERENCES disparos_divulgacao(id) ON DELETE CASCADE`.
2. `_enviar_template_meta` (`worker/campanhas_engine.py`) — mudar retorno de `bool` para `tuple[bool, str | None]` (captura `wamid` do body de sucesso da Graph API). Atualizar os **4 call sites** (`campanhas_engine.py:405` e `:601-603` usam o `wamid`; `main.py:330-332` e `meta_adapter_inbound.py:457-460` só desempacotam, ignoram).
3. `_processar_item_disparo_interno` — mover a criação da linha `disparos` (`_criar_disparo_sync`) para **antes** do loop de envio (status inicial `em_andamento`), permitindo que cada envio grave uma linha de ledger referenciando um `disparo_id` já existente desde o 1º envio. Finalizar via `UPDATE` (não `INSERT` novo) tanto no branch de pausa por `error_threshold` quanto no fim normal do loop.
4. `_processar_disparo_divulgacao_interno` — mais simples (`disparo_id` já é parâmetro, criado antes da função ser chamada): gravar 1 linha em `logs_disparo` por envio, com `disparo_divulgacao_id`.
5. Consumo de `statuses[]` em `worker/meta_adapter_inbound.py::processar_webhook_meta` — **antes** do early-return atual de "sem `messages[]`" — mapeando `sent/delivered/read/failed` para `enviado/entregue/lido/falhou`, atualizando `logs_disparo` por `wamid` (best-effort, `try/except`, nunca propaga exceção pra fora da task de background).
6. 6 testes novos (nenhuma das 2 funções de disparo em massa tem teste hoje): wamid em sucesso/falha, ledger gravado em ambos os motores de disparo, disparo criado **antes** do loop (não depois), consumo de status por webhook.

### OUT
- Mudar quando/como `daily_limit`/`error_threshold` pausam ou retomam uma campanha — isso é o Plano 008 (não escrito), decisão de produto separada. Se durante a implementação parecer necessário mudar esse comportamento pra "fazer esta story funcionar", é sinal de escopo indevido — parar e reportar.
- Popular `meta_phone_numbers.quality_rating`/`messaging_limit_tier` — API diferente (status do número, não `statuses[]` do webhook), trabalho separado.
- `_gravar_breadcrumb_disparo` e território da S-WM-55/S-WM-56 — não tocar.
- `supabase/functions/motor-agente/index.ts` — não tocado por esta story.

## Acceptance Criteria

1. **Given** `select count(*) from logs_disparo` executado no início da Task 0, **when** o resultado é `0` (confirmado), **then** a migration prossegue; **se for diferente de `0`**, a story para nesse ponto e é reportada para revisão antes de aplicar o `CHECK` (dado real pode não satisfazer a constraint).
2. **Given** um envio bem-sucedido via `_enviar_template_meta`, **when** a resposta da Graph API tem `messages[0].id`, **then** a função retorna `(True, wamid)`.
3. **Given** um disparo pontual (`eventos_pontuais`/`ouvidoria_eventos`) ou de divulgação mensal, **when** cada envio é processado (sucesso ou falha), **then** uma linha correspondente é gravada em `logs_disparo`, referenciando o `disparo_id`/`disparo_divulgacao_id` correto e o `wamid` quando houver.
4. **Given** o loop de `_processar_item_disparo_interno`, **when** inspecionado, **then** a linha `disparos` é criada **antes** do 1º envio (status `em_andamento`), não só ao final — inclusive quando o loop pausa por `error_threshold` (finalização via `UPDATE`, nunca deixa de existir uma linha `disparos` pra uma execução parcial).
5. **Given** um evento de webhook com `value.statuses[]` (sem `messages[]`), **when** processado, **then** `logs_disparo` é atualizado por `wamid` com o status mapeado (`delivered`→`entregue` etc.) — evento deixa de ser puramente descartado.
6. **Given** uma falha ao gravar o ledger (qualquer dos 2 motores) ou ao processar um status, **when** ocorre, **then** nunca afeta os contadores `sucessos`/`enviados`/`erros` nem propaga exceção pra fora do fluxo principal/background task.
7. `python -m pytest tests/ -v` (suíte completa do worker) → exit 0, incluindo os 6 testes novos.
8. Nenhum arquivo fora do escopo listado é modificado.

## Tasks / Subtasks

- [x] **Task 0 — Confirmar pré-requisitos, bloqueante** (AC: 1)
  - [x] Confirmado que a S-WM-56 (Plano 005) está `Done` (mergeada em `main`, `cuca-worker` redeployado).
  - [x] Rodado `SELECT conname, confrelid::regclass FROM pg_constraint WHERE conrelid = 'logs_disparo'::regclass` (read-only) — **achado**: ao contrário do texto do plano (que dizia "sem FK"), `logs_disparo_disparo_id_fkey`/`logs_disparo_lead_id_fkey` já existem, ambas `ON DELETE CASCADE`. `count(*) = 0` confirmado (2x, antes de cada aplicação). Reportado à Junior, que decidiu manter o CASCADE em `lead_id` como está (Opção A) e confirmou que a coluna nova deve seguir a mesma convenção (FK).
- [x] **Task 1 — Migration** (AC: 1)
  - [x] Criada e aplicada (via MCP, produção `cuca`) a migration reativando `logs_disparo`, com `disparo_divulgacao_id` já com FK (ajuste da Task 0).
- [x] **Task 2 — `_enviar_template_meta` retorna wamid** (AC: 2)
  - [x] Assinatura mudada, 4 call sites atualizados.
  - [x] `pytest tests/` → suíte passou sem regressão, após corrigir 2 testes da S-WM-56 que mockavam a função com retorno `bool` puro (não previstos pelo plano, criados depois dele).
- [x] **Task 3 — Ledger no disparo pontual** (AC: 3, 4, 6)
  - [x] Criação de `disparos` movida pra antes do loop (status `em_andamento`).
  - [x] `logs_disparo` gravado por envio, em `try/except` próprio.
  - [x] Finalização via `UPDATE` em ambos os pontos de saída (pausa por erro, fim normal).
- [x] **Task 4 — Ledger no disparo de divulgação mensal** (AC: 3, 6)
  - [x] `logs_disparo` gravado por envio (`disparo_divulgacao_id`), em `try/except` próprio.
- [x] **Task 5 — Consumo de `statuses[]`** (AC: 5, 6)
  - [x] Bloco adicionado antes do early-return de "sem `messages[]`".
- [x] **Task 6 — Testes** (AC: 2, 3, 4, 5, 7)
  - [x] 6 testes novos + **mutation check em cada um, sem exceção** (incluindo um mutation adicional, mais cirúrgico, isolando só a ordem de criação do `disparo_id` no teste 4).
- [x] **Task 7 — Fechamento** (AC: 7, 8)
  - [x] Suíte completa sem regressão: 153 passed (147 baseline + 6 novos), 3 falhas pré-existentes inalteradas.
  - [x] File List e Change Log atualizados.
  - [x] Anunciado conclusão e recomendado @qa.

## Dev Notes

- Migration exata (Step 1), diff completo de todos os 6 Steps, código antes/depois de cada função tocada, e os 6 testes especificados na íntegra: **`docs/qa/planos-corrida-juventude/007-ledger-entrega-e-status-meta.md`** — ler por completo antes de editar, é o mais denso e arriscado dos 6 planos.
- **Este plano é o de maior risco da leva** — tratar as mudanças de Python com mais escrutínio que as demais stories: o diff não foi dry-run executado ao vivo antes de ser especificado (diferente da S-WM-52), só produzido por leitura direta do código. Apoiar-se fortemente nos 6 testes da Task 6 pra pegar erro antes de considerar concluído.
- Padrão de mock a seguir: `worker/tests/test_campanhas_engine.py`, estilo `MagicMock()` + `monkeypatch.setattr(camp, "supabase", mock_sb)`.
- Revisor deve escrutinar: (a) que as gravações de ledger (Tasks 3/4) nunca afetam contadores nem propagam exceção; (b) que mover a criação de `disparo_id` pra antes do loop não muda o valor de `total_destinatarios` gravado (não deve — `total` é computado 1 vez, antes de qualquer um dos 2 pontos de criação); (c) que o tratamento de `statuses[]` (Task 5) nunca deixa uma exceção escapar da background task.
- Esta story é a fundação do Plano 008 (não escrito) — a correção do truncamento de `daily_limit` vai usar este ledger pra saber quem ainda falta, sem reenviar pra todo mundo. Não implementar isso agora.
- **Dependência real, não só sequenciamento:** a Task 4 usa `lead.get("id")`, que só existe em `_query_leads_divulgacao_sync` depois da S-WM-56. Sem isso, não há `lead_id` pra gravar no ledger de divulgação — por isso Task 0 é bloqueante, não apenas recomendação de ordem.

### Testing
`cd worker && python -c "import campanhas_engine; import meta_adapter_inbound; import main"` (sanity) e depois `python -m pytest tests/ -v` (suíte completa).

## Dependências
**BLOQUEADA pela S-WM-56** — precisa estar `Done` antes de iniciar (Task 0 confirma isso e faz a query read-only de `logs_disparo` antes de qualquer migration).

## Git workflow
Branch: `feat/ledger-entrega-status-meta`. Commits por passo (plano maior que os demais — preferir vários commits pequenos e revisáveis a um único grande), ex.: `feat(campanhas): captura wamid do envio Meta`, `feat(campanhas): grava ledger de destinatarios por disparo`, `feat(worker): consome statuses[] do webhook Meta`. Não dar push/PR sem autorização explícita.

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-27 | 0.1 | Story criada a partir do Plano 007 (investigação "Corrida da Juventude", 2026-07-26/27). 6ª e última story da leva — BLOQUEADA até a S-WM-56 fechar; Task 0 inclui verificação read-only obrigatória de `logs_disparo` antes da migration. | @sm River |
| 2026-07-27 | 0.2 | Task 0 executada: FK já existia (plano desatualizado), reportado à Junior. Decisão: manter CASCADE em `lead_id`, coluna nova segue a mesma convenção (FK). | @dev Dex |
| 2026-07-27 | 0.3 | Implementação completa (Tasks 1-7) em branch isolada `feat/ledger-entrega-status-meta` (a partir de `origin/main`, já com S-WM-52 a S-WM-56). Sem drift real (drift check mostrou só o acumulado das stories anteriores, todos os trechos "Estado atual" conferidos linha a linha, idênticos ao plano). 6 testes novos + mutation check em cada, sem exceção. Suíte: 153/0/3(pré-existentes). Status Draft → Ready for Review. | @dev Dex |

## Dev Agent Record

### Agent Model Used
Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References
- Drift check completo (`git diff --stat 256d547..HEAD -- worker/campanhas_engine.py worker/meta_adapter_inbound.py worker/main.py`) e conferência linha a linha de todos os trechos "Estado atual" do plano contra o código ao vivo: `_enviar_template_meta`, `_processar_item_disparo_interno` (0-leads branch, loop, error-threshold, fim), `_processar_disparo_divulgacao_interno` (já com o breadcrumb da S-WM-56), webhook discard point, e os 4 call sites (`campanhas_engine.py`×2, `main.py`, `meta_adapter_inbound.py`) — todos idênticos ao plano, só deslocados pelas stories anteriores. Confirmado também: exatamente 4 call sites de `_enviar_template_meta` no repo (nenhum 5º).
- Baseline: `pytest tests/test_campanhas_engine.py tests/test_meta_adapter_inbound.py -q` → 70 passed. `pytest tests/ -q` → 147 passed, 3 failed (pré-existentes).
- **Task 0 (executada em turno anterior, antes de liberar o resto da story):** `SELECT conname, confrelid::regclass FROM pg_constraint WHERE conrelid = 'logs_disparo'::regclass` confirmou `logs_disparo_disparo_id_fkey→disparos` e `logs_disparo_lead_id_fkey→leads`, ambas `ON DELETE CASCADE` — contradizendo o texto do plano ("sem FK"). `count(*) = 0` confirmado. Reportado à Junior, que decidiu manter o CASCADE (Opção A) e confirmou que `disparo_divulgacao_id` deve seguir a mesma convenção.
- Migration aplicada com o ajuste: `disparo_divulgacao_id uuid REFERENCES disparos_divulgacao(id) ON DELETE CASCADE`. Verificado ao vivo pós-aplicação: 3 FKs, CHECK constraint, 3 índices, todas as colunas com o tipo/nullability esperados.
- `_enviar_template_meta`: assinatura mudada pra `tuple[bool, str | None]`, captura `wamid` de `resp.json().get("messages", [{}])[0].get("id")` dentro de `try/except` próprio (não quebra se o body de sucesso não trouxer o campo). 4 call sites atualizados (2 usam `wamid`, 2 descartam via `_wamid`/ambos ignoram).
- **Achado não previsto pelo plano**: 2 testes da S-WM-56 (`test_disparo_divulgacao_grava_breadcrumb_apos_envio_com_sucesso`, `test_disparo_divulgacao_nao_grava_breadcrumb_quando_envio_falha`) mockavam `_enviar_template_meta` com `AsyncMock(return_value=True/False)` — quebraram com a nova assinatura de tupla. Corrigidos pra `(True, "wamid...")`/`(False, None)`.
- `_processar_item_disparo_interno`: criação de `disparos` movida pra logo após o branch de 0-leads (status `em_andamento`, `total_enviados`/`total_erros`=0, `concluido_em`=None). Ledger gravado por envio (`try/except` próprio). Finalização trocada de `INSERT` (`_criar_disparo_sync`) pra `UPDATE` (`_update_db_sync("disparos", ...)`) — tanto na pausa por `error_threshold` quanto no fim normal.
- `_processar_disparo_divulgacao_interno`: ledger gravado por envio (`disparo_divulgacao_id`), logo após o bloco de breadcrumb da S-WM-56, mesmo padrão de `try/except`.
- `meta_adapter_inbound.py`: bloco de `statuses[]` adicionado antes do early-return de "sem `messages[]`" — mapeamento `sent/delivered/read/failed`→`enviado/entregue/lido/falhou`, update em `logs_disparo` por `wamid`, `try/except` best-effort.
- **6 testes novos** (`test_enviar_template_meta_retorna_wamid_em_sucesso`, `test_enviar_template_meta_retorna_none_em_falha`, `test_disparo_pontual_grava_ledger_por_destinatario`, `test_disparo_pontual_cria_disparo_antes_do_loop_nao_depois`, `test_disparo_divulgacao_grava_ledger_por_destinatario`, `test_webhook_statuses_atualiza_ledger_por_wamid`) — todos passaram de primeira. Padrão de mock: `httpx.AsyncClient` real (pacote instalado, ao contrário de `supabase`/`postgrest`) mockado via `monkeypatch.setattr(camp.httpx, "AsyncClient", ...)`; `supabase` mockado com `.table()` roteado por nome (`side_effect`) quando o teste precisa inspecionar 2 tabelas diferentes de forma independente (`disparos` vs `logs_disparo`).
- **Mutation check em todos os 6, sem exceção**: (1+2) `_enviar_template_meta` revertida pro bool puro → ambos os testes de wamid falharam; restaurado → passaram. (3) bloco de ledger removido de `_processar_item_disparo_interno` → falhou (`logs_disparo` nunca chamado); restaurado → passou. (4) mutation **separada e mais cirúrgica** — reverti só a ORDEM (criação do disparo de volta pro fim, mantendo o ledger) → falhou exatamente na asserção de ordem (`assert 2 < 1`, `disparos` aparecendo depois de `logs_disparo`); restaurado → passou. (5) bloco de ledger removido da divulgação mensal → falhou; restaurado → passou. (6) bloco de `statuses[]` removido → falhou (`table('logs_disparo') call not found`); restaurado → passou.
- Suíte final: `pytest tests/ -q` → 153 passed, 3 failed (mesmas pré-existentes, documentadas desde a S-WM-53).
- Done criteria do plano, todos conferidos: import sanity OK (`campanhas_engine`/`meta_adapter_inbound`; `main.py` não importa isoladamente neste ambiente por falta de `openai`, limitação pré-existente não causada por esta story — sintaxe confirmada via `ast.parse`), assinatura `tuple[bool, str | None]` confirmada via grep, `grep -c "logs_disparo"` → 7 (≥2), `statuses` presente em `meta_adapter_inbound.py`, migration existe com as 3 colunas.

### Completion Notes List
- Implementado exatamente como especificado no plano preservado (`docs/qa/planos-corrida-juventude/007-ledger-entrega-e-status-meta.md`), com o único ajuste combinado explicitamente na Task 0 (FK de `disparo_divulgacao_id`).
- Reportei incrementalmente por Task, conforme pedido, dado o tamanho da story.
- O 1º desenho de um teste (não desta story, mas descoberto durante o trabalho aqui — ver histórico da S-WM-55) já tinha me ensinado a desconfiar de mutation checks "fracos"; apliquei a mesma disciplina aqui, criando uma mutation **separada** pro Test 4 (isolando só a ordem) em vez de confiar só na mutation de "remover o bloco inteiro", que teria mascarado a diferença entre "ledger ausente" e "ledger presente mas fora de ordem".
- Nenhum arquivo fora do escopo (`worker/campanhas_engine.py`, `worker/main.py`, `worker/meta_adapter_inbound.py`, `worker/tests/test_campanhas_engine.py`, `worker/tests/test_meta_adapter_inbound.py`, a migration) foi modificado.
- `daily_limit`/`error_threshold` — comportamento de pausa/retomada não tocado, conforme Out of Scope.

### File List
- `supabase/migrations/20260727000000_reativa_logs_disparo_ledger.sql` (novo — aplicado em produção, com FK ajustada)
- `worker/campanhas_engine.py` (modificado: `_enviar_template_meta` retorna tupla; ledger em ambos motores de disparo; `disparo_id` criado antes do loop em `_processar_item_disparo_interno`)
- `worker/main.py` (modificado: 1 call site desempacota a tupla)
- `worker/meta_adapter_inbound.py` (modificado: 1 call site desempacota a tupla; novo bloco de consumo de `statuses[]`)
- `worker/tests/test_campanhas_engine.py` (modificado: 2 mocks da S-WM-56 corrigidos pra tupla; 5 testes novos + 2 helpers)
- `worker/tests/test_meta_adapter_inbound.py` (modificado: 1 teste novo + helper de payload de status)

## QA Results
_A ser preenchido pelo @qa após a implementação._
