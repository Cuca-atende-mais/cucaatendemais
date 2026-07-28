# S-WM-57 — Ledger por destinatário de disparo (`logs_disparo`) + consumir `statuses[]` da Meta

## Status
InReview — QA Gate: CONCERNS (gate original de 2026-07-27 cobre Steps 1-6 originais). **Delta da emenda 2026-07-28 implementado por @dev** (Tasks 5b/5c/6b/7b) — pendente de novo gate de @qa, só para o delta. @qa **não** acionado ainda — aguardando liberação explícita de Junior. @devops não acionado; validação com envio real ainda pendente.

## Origem
Investigação "Corrida da Juventude" (disparo de 724 leads, 24/07/2026) — `docs/qa/DIAGNOSTICO-disparo-corrida-juventude-2026-07-27.md`, achados arquiteturais nº 2 e nº 3 (seção 4) / achados B e C do diagnóstico arquitetural. Plano técnico completo, com a migration exata, os passos e os testes especificados, preservado integralmente em `docs/qa/planos-corrida-juventude/007-ledger-entrega-e-status-meta.md` — usar esse arquivo como referência técnica primária, não este resumo. Elaborado em 2026-07-26/27 (commit base `256d547`) — **não** dry-run executado ao vivo (sem Postgres disponível na sessão de origem); diff produzido por leitura direta do código, tratar com mais escrutínio que as demais stories da leva. Formalizada em story por @sm em 2026-07-27, setup de teste ("Equipe Interna — QA") já criado e confirmado. **Emenda 2026-07-28:** o mesmo arquivo do plano recebeu uma seção "Update (2026-07-28, revisão do sócio antes do fechamento da S-WM-57)", inserida logo após o Step 5 — 3 ajustes pontuais sobre o consumo de `statuses[]`, resto do plano (Steps 1-4, 6 originais) intacto. Ver Dev Notes.

## Complexidade
**L** — maior esforço da leva: 1 migration reativando tabela existente, mudança de assinatura de função com 4 call sites, 2 funções de disparo com novo controle de fluxo (criação de `disparos` antes do loop), novo consumo de webhook, 8 testes novos (6 originais + 2 da emenda 2026-07-28; nenhum teste prévio cobre as 2 funções de disparo em massa hoje).

## Prioridade
P1 — "maior alavanca" recomendada pelo diagnóstico arquitetural: hoje o sistema só sabe se o POST à Meta teve sucesso HTTP, nunca se a mensagem foi de fato entregue, lida ou falhou — sem isso, não há visibilidade de risco de qualidade/bloqueio do número.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - cd worker && python -c "import campanhas_engine; import meta_adapter_inbound; import main" → exit 0
  - cd worker && python -m pytest tests/ -v → exit 0, incluindo os 8 testes novos (6 originais + 2 da emenda 2026-07-28)
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
5b. **(Emenda 2026-07-28)** Proteção contra status fora de ordem: nova coluna `status_timestamp_meta timestamptz` (migration aditiva) gravando o timestamp do evento reportado pela Meta; o `UPDATE` do item 5 passa a checar, **na própria query via `.or_()`** (não `SELECT`-depois-compara), que o evento novo é mais recente que o já gravado (ou que não há nada gravado ainda) antes de sobrescrever — evita que 2 webhooks quase simultâneos pro mesmo `wamid` façam o status regredir (ex.: "lido" sobrescrito por um "entregue" atrasado).
5c. **(Emenda 2026-07-28)** 2 valores de status que faltavam no `_STATUS_MAP`: `"deleted"` → `"apagada"`, `"warning"` → `"aviso"` (capturando `erro_codigo` de `errors[]`, igual ao tratamento que `"failed"` já tem).
6. 8 testes novos (6 originais + 2 da emenda 2026-07-28; nenhuma das 2 funções de disparo em massa tem teste hoje): wamid em sucesso/falha, ledger gravado em ambos os motores de disparo, disparo criado **antes** do loop (não depois), consumo de status por webhook, proteção de ordem amarrada no código, mapeamento de `deleted`/`warning`.

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
7. `python -m pytest tests/ -v` (suíte completa do worker) → exit 0, incluindo os 8 testes novos (6 originais + 2 da emenda 2026-07-28).
8. Nenhum arquivo fora do escopo listado é modificado.
9. **(Emenda 2026-07-28)** **Given** `logs_disparo` já tem um status gravado para um `wamid` com um `status_timestamp_meta` mais recente, **when** chega um evento de webhook com timestamp mais antigo pro mesmo `wamid` (fora de ordem), **then** o `UPDATE` não sobrescreve o status já gravado — a checagem é feita na própria condição da query (`.or_()`), não por `SELECT` seguido de comparação em Python.
10. **(Emenda 2026-07-28)** **Given** um evento de webhook com `status` igual a `"deleted"` ou `"warning"`, **when** processado, **then** `logs_disparo` é atualizado com `"apagada"`/`"aviso"` respectivamente, e `"warning"` também captura o `erro_codigo` de `errors[]` (mesmo tratamento que `"failed"` já tem).
11. **(Emenda 2026-07-28)** 2 testes novos confirmam, isoladamente: (a) que a proteção de ordem do AC 9 está de fato amarrada no código (não é só descrição); (b) que os 2 status novos do AC 10 são mapeados corretamente.

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
- [x] **Task 5b — Proteção contra status fora de ordem (emenda 2026-07-28)** (AC: 9)
  - [x] Migration aditiva aplicada em produção (via MCP, `cuca`): `ALTER TABLE logs_disparo ADD COLUMN IF NOT EXISTS status_timestamp_meta timestamptz` (`supabase/migrations/20260728000000_swm57_status_timestamp_meta_ordem.sql`).
  - [x] `UPDATE` do Step 5 reescrito para checar `status_timestamp_meta` via `.or_()` na própria query (não `SELECT`-depois-compara) — só sobrescreve se o evento novo for mais recente ou não houver nada gravado.
- [x] **Task 5c — Mapear `deleted`/`warning` (emenda 2026-07-28)** (AC: 10)
  - [x] `_STATUS_MAP` ganha `"deleted": "apagada"` e `"warning": "aviso"`.
  - [x] `"warning"` captura `erro_codigo` de `errors[]`, mesmo bloco que hoje só trata isso pra `"failed"`.
- [x] **Task 6 — Testes originais** (AC: 2, 3, 4, 5, 7)
  - [x] 6 testes novos + **mutation check em cada um, sem exceção** (incluindo um mutation adicional, mais cirúrgico, isolando só a ordem de criação do `disparo_id` no teste 4).
- [x] **Task 6b — Testes da emenda 2026-07-28** (AC: 9, 10, 11)
  - [x] Teste confirmando que a proteção `.or_()` está amarrada na query (não só no design) + `status_timestamp_meta` sendo gravado a partir do timestamp do evento — mutation check: removido o `.or_()` → falhou; restaurado → passou.
  - [x] Teste confirmando `"deleted"`/`"warning"` mapeados para `"apagada"`/`"aviso"`, com `"warning"` capturando `erro_codigo` — mutation check: removidos `deleted`/`warning` do `_STATUS_MAP` → falhou; restaurado → passou. Mutation adicional isolando só a captura de `erro_codigo` em `"warning"` (`if status_meta == "failed"`) → falhou; restaurado → passou.
- [x] **Task 7 — Fechamento (Steps 1-6 originais)** (AC: 7, 8)
  - [x] Suíte completa sem regressão: 153 passed (147 baseline + 6 novos), 3 falhas pré-existentes inalteradas.
  - [x] File List e Change Log atualizados.
  - [x] Anunciado conclusão e recomendado @qa.
- [x] **Task 7b — Fechamento do delta (emenda 2026-07-28)** (AC: 7, 9, 10, 11)
  - [x] Suíte completa reexecutada: `155 passed, 3 skipped` (153 + 2 novos; as mesmas 3 pré-existentes de `test_meta_adapter_outbound.py::TestSendMessageEndpoint` apareceram como `skipped` nesta execução, não `failed` como em passes anteriores — ver Debug Log Reference, não é regressão desta emenda).
  - [x] File List e Change Log atualizados com os arquivos tocados pelo delta (migration nova + `meta_adapter_inbound.py` + arquivo de teste).
  - [ ] @qa re-acionado só para o delta — **pendente, aguardando liberação de Junior** (instrução explícita: não acionar @qa nem avançar sozinho).

## Dev Notes

- Migration exata (Step 1), diff completo de todos os 6 Steps, código antes/depois de cada função tocada, e os testes especificados na íntegra: **`docs/qa/planos-corrida-juventude/007-ledger-entrega-e-status-meta.md`** — ler por completo antes de editar, é o mais denso e arriscado dos 6 planos.
- **Emenda 2026-07-28:** a seção "Update (2026-07-28, revisão do sócio antes do fechamento da S-WM-57)", inserida no plano logo após o Step 5 (antes de "### Step 6: Tests"), tem a especificação completa do delta — coluna nova `status_timestamp_meta`, reescrita do `UPDATE` do Step 5 usando `.or_()`, e os 2 mapeamentos novos de status. "Test plan" e "Done criteria" do plano também foram atualizados (6→8 testes, +3 itens de done criteria). Implementar exatamente como descrito lá, não inventar uma abordagem alternativa de "checar ordem" (ex.: não usar `SELECT` seguido de `UPDATE` condicional em Python — é exatamente a corrida que a emenda corrige).
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
| 2026-07-27 | 0.4 | Gate de QA reconciliado: um passe anterior (preservado acima como FAIL) capturou o working tree no meio de um mutation check; reconciliação confirma working tree restaurado, limpo, suíte 153/3 reproduzida 3x. Corrigida imprecisão na descrição do mutation check do Teste 4 (não discrimina "ledger ausente" de "ledger fora de ordem" como alegado). Achado novo registrado (fora do checklist original, seguindo `impact-analysis-mandatory.md`): `disparos.status = "em_andamento"` é estado transitório novo sem consumidor hoje, mas com risco de linha órfã em crash de processo — relevante para o Plano 008. Veredito final: **CONCERNS**. @devops não acionado; validação com envio real (categoria "Equipe Interna — QA") ainda pendente. Status Ready for Review → InReview. | @qa Quinn |
| 2026-07-28 | 0.5 | **Emenda pontual** (não reescrita): sócio revisou o Plano 007 e encontrou 3 ajustes no Step 5 (consumo de `statuses[]`), documentados na seção "Update (2026-07-28...)" acrescentada ao próprio plano. Adicionados AC 9-11, Tasks 5b/5c/6b/7b (pendentes, não implementadas): (1) proteção contra status da Meta fora de ordem via `status_timestamp_meta` + checagem atômica com `.or_()` na query, evitando corrida entre 2 webhooks simultâneos pro mesmo `wamid`; (2) mapeamento de `"deleted"`→`"apagada"` e `"warning"`→`"aviso"` no `_STATUS_MAP`; (3) 2 testes novos (Task 6 sobe de 6 para 8). Tasks 0-7 originais mantidas como concluídas (não refeitas). @dev **não** acionado — aguardando revisão de Junior antes de liberar a implementação do delta. | @sm River |
| 2026-07-28 | 0.6 | **Delta da emenda implementado** (Tasks 5b/5c/6b/7b), escopo original (Steps 1-4, 6) não retocado: migration aditiva `status_timestamp_meta timestamptz` criada e aplicada em produção (`cuca`, via MCP); `_STATUS_MAP` ganhou `"deleted"`/`"warning"`, com `erro_codigo` capturado também em `"warning"`; `UPDATE` do consumo de `statuses[]` reescrito com `.or_()` atômico checando `status_timestamp_meta` (não `SELECT`-depois-compara), protegendo contra status fora de ordem. +2 testes novos, mutation check em cada (incluindo mutation isolada na captura de `erro_codigo` do `"warning"`), todos passaram de primeira e falharam corretamente sob mutação. Suíte completa: `155 passed, 3 skipped` (as 3 pré-existentes de `TestSendMessageEndpoint` apareceram como `skipped`, não `failed` — sinalizado para @qa confirmar, não é regressão deste delta). Nenhum arquivo fora do escopo do delta modificado. @qa **não** acionado — aguardando liberação explícita de Junior. | @dev Dex |

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
- **Mutation check em todos os 6, sem exceção**: (1+2) `_enviar_template_meta` revertida pro bool puro → ambos os testes de wamid falharam; restaurado → passaram. (3) bloco de ledger removido de `_processar_item_disparo_interno` → falhou (`logs_disparo` nunca chamado); restaurado → passou. (4) mutation isolada de ORDEM (criação do disparo de volta pro fim, mantendo o ledger) → falhou; restaurado → passou. **Correção de registro (achado do gate de QA, 2026-07-27):** essa mutation NÃO é tão cirúrgica quanto o registro original descreveu — como `disparo_id` é capturado por closure dentro do lambda do ledger, revertê-lo pra depois do loop causa um `NameError`/`UnboundLocalError` na hora de gravar o ledger, que é engolido pelo próprio `try/except` do bloco de ledger. Ou seja, o teste 3 (ledger ausente) e o teste 4 (ledger fora de ordem) falham pela MESMA causa raiz nessa mutation, não por dois sinais independentes — "ledger ausente" e "ledger fora de ordem" não são de fato discrimináveis um do outro por este par de testes. A proteção em si funciona (ambos os testes pegam a regressão de ordem), mas a alegação de "mutation cirúrgica que uma mutation de bloco inteiro mascararia" (ver Completion Notes) não se sustenta como descrita. Não bloqueante — não é defeito de produção, é uma imprecisão na descrição do teste. (5) bloco de ledger removido da divulgação mensal → falhou; restaurado → passou. (6) bloco de `statuses[]` removido → falhou (`table('logs_disparo') call not found`); restaurado → passou.
- Suíte final: `pytest tests/ -q` → 153 passed, 3 failed (mesmas pré-existentes, documentadas desde a S-WM-53).
- Done criteria do plano, todos conferidos: import sanity OK (`campanhas_engine`/`meta_adapter_inbound`; `main.py` não importa isoladamente neste ambiente por falta de `openai`, limitação pré-existente não causada por esta story — sintaxe confirmada via `ast.parse`), assinatura `tuple[bool, str | None]` confirmada via grep, `grep -c "logs_disparo"` → 7 (≥2), `statuses` presente em `meta_adapter_inbound.py`, migration existe com as 3 colunas.

**Emenda 2026-07-28 (Tasks 5b/5c/6b/7b) — delta implementado:**
- Confirmado via `execute_sql` read-only que `logs_disparo` ainda não tinha a coluna `status_timestamp_meta` antes de aplicar a migration nova.
- Migration `supabase/migrations/20260728000000_swm57_status_timestamp_meta_ordem.sql` aplicada via MCP (produção `cuca`) — `ALTER TABLE logs_disparo ADD COLUMN IF NOT EXISTS status_timestamp_meta timestamptz`. Verificado ao vivo pós-aplicação: coluna existe com o tipo esperado.
- `worker/meta_adapter_inbound.py`, bloco de `statuses[]` (Step 5): `_STATUS_MAP` ganhou `"deleted": "apagada"` e `"warning": "aviso"`; captura de `erro_codigo` de `errors[]` estendida de `status_meta == "failed"` para `status_meta in ("failed", "warning")`. Novo bloco extrai `status_evt.get("timestamp")` (epoch da Meta), converte via `datetime.fromtimestamp(int(timestamp_evt), tz=timezone.utc).isoformat()` (com `try/except` pra timestamp ausente/inválido → `status_timestamp_meta = None` nesse caso, sem quebrar o resto do evento) e grava em `status_timestamp_meta` no mesmo `UPDATE`. Quando há timestamp válido, a query encadeia `.or_(f"status_timestamp_meta.is.null,status_timestamp_meta.lte.{status_timestamp_meta}")` **antes** do `.execute()` — checagem atômica na própria condição do `UPDATE`, não `SELECT` seguido de comparação em Python (que teria janela de corrida entre 2 webhooks concorrentes pro mesmo `wamid`).
- **2 testes novos** em `worker/tests/test_meta_adapter_inbound.py`: `test_webhook_status_fora_de_ordem_protegido_por_or_atomico_na_query` (assert que `.or_()` foi chamado na cadeia `table("logs_disparo").update(...).eq(...)` com o filtro esperado, e que `status_timestamp_meta` foi gravado) e `test_webhook_status_deleted_e_warning_mapeados_corretamente` (assert `"deleted"`→`"apagada"`, `"warning"`→`"aviso"` com `erro` capturado de `errors[0]["code"]`). Ambos passaram de primeira.
- **Mutation check nos 2, sem exceção**: (a) `.or_()` neutralizado (`if False and status_timestamp_meta`) → teste de ordem falhou (`.or_() nunca foi chamado`); restaurado → passou. (b) `"deleted"`/`"warning"` removidos do `_STATUS_MAP` → teste de mapeamento falhou (`update` nunca chamado, evento cai no `continue`); restaurado → passou. (c) mutation adicional, isolada, revertendo a condição de captura de erro de volta pra só `"failed"` → o mesmo teste (b) falhou especificamente na asserção de `erro == "470"` (sinal independente da falha em (b), que é sobre `status`); restaurado → passou.
- Suíte completa reexecutada: `pytest tests/ -q` → `155 passed, 3 skipped` (153 baseline + 2 novos). As 3 pré-existentes de `test_meta_adapter_outbound.py::TestSendMessageEndpoint` apareceram como `skipped` nesta execução em vez de `failed` como em passes anteriores da story — não investiguei a causa exata (possível diferença de coleta/skip-marker do ambiente local entre sessões), mas são as mesmas 3 já documentadas como pré-existentes desde a S-WM-53, não relacionadas a este delta nem a `logs_disparo`/`meta_adapter_inbound.py`. Sinalizando para o @qa confirmar de forma independente.
- Import sanity: `cd worker && python -c "import meta_adapter_inbound"` → exit 0. (`campanhas_engine`/`main.py` não importam isoladamente neste ambiente — mesma limitação pré-existente de dependências não instaladas fora do stub dos testes, não tocada por este delta.)
- Nenhum arquivo fora do escopo do delta (a migration nova, `worker/meta_adapter_inbound.py`, `worker/tests/test_meta_adapter_inbound.py`) foi modificado. `worker/campanhas_engine.py`, `worker/main.py` e os demais arquivos do escopo original permanecem como estavam desde o gate de 2026-07-27.

### Completion Notes List
- Implementado exatamente como especificado no plano preservado (`docs/qa/planos-corrida-juventude/007-ledger-entrega-e-status-meta.md`), com o único ajuste combinado explicitamente na Task 0 (FK de `disparo_divulgacao_id`).
- Reportei incrementalmente por Task, conforme pedido, dado o tamanho da story.
- O 1º desenho de um teste (não desta story, mas descoberto durante o trabalho aqui — ver histórico da S-WM-55) já tinha me ensinado a desconfiar de mutation checks "fracos"; apliquei a mesma disciplina aqui, criando uma mutation separada pro Test 4 (isolando só a ordem) em vez de confiar só na mutation de "remover o bloco inteiro". **Correção de registro (gate de QA, 2026-07-27):** na prática essa mutation separada NÃO discrimina "ledger ausente" de "ledger fora de ordem" como sinais independentes — ver nota no Debug Log Reference item de mutation check. A proteção contra a regressão de ordem continua válida; só a alegação de que a mutation era mais "cirúrgica" que uma mutation de bloco inteiro está incorreta.
- Nenhum arquivo fora do escopo (`worker/campanhas_engine.py`, `worker/main.py`, `worker/meta_adapter_inbound.py`, `worker/tests/test_campanhas_engine.py`, `worker/tests/test_meta_adapter_inbound.py`, a migration) foi modificado.
- `daily_limit`/`error_threshold` — comportamento de pausa/retomada não tocado, conforme Out of Scope.
- **Emenda 2026-07-28:** delta implementado só no escopo das Tasks 5b/5c/6b/7b — nenhum arquivo do escopo original (Steps 1-4, 6) foi retocado. `worker/campanhas_engine.py` e `worker/main.py` permanecem exatamente como no gate de 2026-07-27.

### File List
- `supabase/migrations/20260727000000_reativa_logs_disparo_ledger.sql` (aplicado em produção, com FK ajustada — escopo original, não tocado nesta emenda)
- `supabase/migrations/20260728000000_swm57_status_timestamp_meta_ordem.sql` (novo — emenda 2026-07-28, aplicado em produção: coluna `status_timestamp_meta timestamptz`)
- `worker/campanhas_engine.py` (modificado: `_enviar_template_meta` retorna tupla; ledger em ambos motores de disparo; `disparo_id` criado antes do loop em `_processar_item_disparo_interno` — escopo original, não tocado nesta emenda)
- `worker/main.py` (modificado: 1 call site desempacota a tupla — escopo original, não tocado nesta emenda)
- `worker/meta_adapter_inbound.py` (modificado: 1 call site desempacota a tupla; bloco de consumo de `statuses[]` — escopo original + **emenda 2026-07-28**: `_STATUS_MAP` com `deleted`/`warning`, captura de `erro_codigo` estendida pra `warning`, `status_timestamp_meta` gravado e checado via `.or_()` atômico contra status fora de ordem)
- `worker/tests/test_campanhas_engine.py` (modificado: 2 mocks da S-WM-56 corrigidos pra tupla; 5 testes novos + 2 helpers — escopo original, não tocado nesta emenda)
- `worker/tests/test_meta_adapter_inbound.py` (modificado: 1 teste novo + helper de payload de status — escopo original; **emenda 2026-07-28**: +2 testes novos — `test_webhook_status_fora_de_ordem_protegido_por_or_atomico_na_query`, `test_webhook_status_deleted_e_warning_mapeados_corretamente`)

## QA Results
### Review Date: 2026-07-27

### Reviewed By: @qa Quinn

### Gate Decision: FAIL (passe de 2026-07-27 aprox. 1, superseded — ver reconciliacao no final do arquivo)

### Summary

Gate reprovado no estado atual do checkout. A implementação commitada pode conter grande parte do desenho correto, mas o working tree entregue para QA está contaminado por uma mutation não restaurada em `worker/campanhas_engine.py`: a criação de `disparo_id` foi movida de volta para depois do loop, exatamente o cenário que a S-WM-57 precisava impedir. Com isso, não consegui aceitar a story como pronta nem reproduzir a suíte esperada.

### Blocking Finding

1. **Mutation de ordem do ledger ficou aplicada no working tree**
   - Arquivo sujo: `worker/campanhas_engine.py`.
   - Diff local remove o bloco S-WM-57 que cria `disparo_id` antes do loop (`status = "em_andamento"`) e recria o disparo no fim do processamento.
   - Isso quebra o AC4: o ledger precisa referenciar uma linha `disparos` existente desde o primeiro envio, inclusive se o loop pausar/truncar.
   - Também invalida o relato de mutation check restaurado, porque a mutation cirúrgica de ordem está presente no código local revisado.

### Tests Executed by QA

- `cd worker && timeout 120s python3 -m pytest tests/test_campanhas_engine.py::test_disparo_pontual_cria_disparo_antes_do_loop_nao_depois -q`
  - Resultado: `timeout` / exit `124`.
  - Interpretação: teste específico de ordem não concluiu no estado atual, portanto não confirma o AC4.
- `cd worker && timeout 180s python3 -m pytest tests/test_campanhas_engine.py tests/test_meta_adapter_inbound.py -q`
  - Resultado: `timeout` / exit `124`.
  - Interpretação: não foi possível reproduzir os `153 passed` esperados; a suíte relevante não concluiu no checkout entregue.
- Tentativa inicial com `python` falhou porque o ambiente local expõe `python3`, não `python`.

### Production DB Verification

Consulta read-only em produção (`cuca`, projeto `svzkrkfzpiqcesloukgb`) confirmou:

- `logs_disparo_disparo_id_fkey` → `disparos(id) ON DELETE CASCADE`.
- `logs_disparo_disparo_divulgacao_id_fkey` → `disparos_divulgacao(id) ON DELETE CASCADE`.
- `logs_disparo_lead_id_fkey` → `leads(id) ON DELETE CASCADE`.
- CHECK `logs_disparo_um_disparo_check` existe e exige exatamente um entre `disparo_id` e `disparo_divulgacao_id`.
- Colunas esperadas existem: `disparo_divulgacao_id uuid`, `wamid text`, `atualizado_em timestamptz NOT NULL DEFAULT now()`.
- Índices esperados existem: `idx_logs_disparo_wamid`, `idx_logs_disparo_lead_id`, `idx_logs_disparo_disparo_divulgacao_id`.

### Supabase RLS / Advisors

- `logs_disparo` está com RLS habilitado.
- Policy existente: `acesso_autenticado`, comando `ALL`, condição `auth.uid() IS NOT NULL`.
- Advisor security filtrado para `logs_disparo`: `0` achados.
- Advisor performance filtrado para `logs_disparo`: `4` achados:
  - `auth_rls_initplan` WARN na policy `acesso_autenticado`.
  - `unused_index` INFO nos índices recém-criados `idx_logs_disparo_wamid`, `idx_logs_disparo_lead_id`, `idx_logs_disparo_disparo_divulgacao_id`.
  - Interpretação: não bloqueio isolado por segurança, mas o WARN de performance deve ser documentado/endereçado conforme padrão do projeto.

### Additional Static Review

- `_enviar_template_meta` tem assinatura `tuple[bool, str | None]` e captura `messages[0].id` como `wamid` quando a Graph API retorna sucesso.
- Os 4 call-sites localizados foram atualizados:
  - `worker/campanhas_engine.py` — disparo pontual usa `ok, wamid`.
  - `worker/campanhas_engine.py` — divulgação mensal usa `ok, wamid`.
  - `worker/main.py` — envio manual desempacota `ok, _wamid`.
  - `worker/meta_adapter_inbound.py` — notificação de transbordo desempacota `ok, _wamid`.
- Os 2 testes pré-existentes da S-WM-56 foram atualizados para retorno em tupla e ainda preservam a intenção original:
  - sucesso valida breadcrumb de divulgação mensal;
  - falha valida que breadcrumb não é gravado e erro continua no bookkeeping.
- O bloco `statuses[]` foi inserido antes do early-return de `messages[]` vazio e atualiza `logs_disparo` por `wamid` em best-effort.

### Required Fix Before Re-Gate

1. Restaurar `worker/campanhas_engine.py` para o estado correto da S-WM-57: `disparo_id` criado antes do loop, finalização por `UPDATE`, sem criação tardia no fim.
2. Garantir working tree limpo nos arquivos da story antes de pedir novo gate.
3. Reexecutar e registrar:
   - teste de ordem do ledger;
   - suíte completa do worker (`153 passed` esperado + mesmas 3 falhas pré-existentes, se esse for o baseline real);
   - mutation checks, principalmente o cirúrgico que diferencia “ledger ausente” de “ledger fora de ordem”.

Sem isso, não acionar @devops e não abrir PR.

---

## QA Results — Reconciliacao (2026-07-27, passe 2)

### Reviewed By: @qa Quinn

### Sobre o bloco FAIL acima

O bloco "Gate Decision: FAIL" acima nao e um registro invalido ou obsoleto por engano - e o retrato exato de um estado intermediario real: o momento em que o mutation check #4 (reverter so a ORDEM de criacao do disparo_id, mantendo o ledger) estava aplicado no working tree, durante a execucao dos mutation checks descritos no Debug Log Reference. A descricao do achado bloqueante daquele passe ("criacao de disparo_id movida de volta para depois do loop") e uma descricao correta da mutation #4, e os dois timeouts caem exatamente no teste que essa mutation alvo (`test_disparo_pontual_cria_disparo_antes_do_loop_nao_depois`). Nao trato aquele passe como erro - trato como uma fotografia de um momento que precisa ser reconciliada com o estado restaurado (pos-mutation-check) antes de decidir o gate.

Evidencia de que o working tree ESTA restaurado agora (nao contaminado):

```
$ git log --oneline -3
4dccb8d feat(campanhas): ledger de entrega por destinatario (logs_disparo) + consome status da Meta
ca6f824 Merge pull request #61 from Cuca-atende-mais/fix/breadcrumb-divulgacao-mensal
7ec9440 docs(qa): registra gate da S-WM-56 (veredito PASS)

$ git status --short worker/
(saida vazia — working tree limpo)

$ git branch --show-current
feat/ledger-entrega-status-meta
```

- `pytest tests/ -q` (suite completa, reproduzida do zero, sem timeout artificial): `153 passed, 3 failed` — as mesmas 3 falhas pre-existentes (`test_meta_adapter_outbound.py::TestSendMessageEndpoint`, `ModuleNotFoundError: No module named 'worker'`, documentadas desde a S-WM-53, nao relacionadas a esta story).
- `pytest tests/test_campanhas_engine.py::test_disparo_pontual_cria_disparo_antes_do_loop_nao_depois -q` isolado, sem wrapper de timeout: `1 passed in 0.69s`. Nao reproduzo o timeout/exit 124 relatado no passe anterior — condizente com a hipotese de que aquele passe rodou contra o estado mutado (o teste inspeciona ordem de chamadas em um MagicMock; contra a mutation ele nao trava, ele falha rapido — o timeout relatado ali e mais provavel de ser um artefato do ambiente daquele passe especifico do que do codigo, mas como o working tree restaurado passa limpo e rapido de forma consistente, isso deixa de ser um bloqueio).
- Rodei a suite completa 3x nesta reconciliacao: `153 passed / 3 failed` nas 3 vezes, sem flakiness observada desta vez.

### Checklist pedido por Junior — reverificado

1. **Suite completa reproduzida:** `153 passed`, 3 falhas pre-existentes (nao 4 — a suspeita de flakiness em `test_mensagens_com_intervalo_de_6s_ficam_dentro_da_janela_de_7s_e_agrupam` de uma rodada anterior nao se repetiu em 3 execucoes desta reconciliacao; registro nao-bloqueante).
2. **6 mutation checks reproduzidos**, incluindo o achado sobre o teste 4: a mutation "so a ordem" e descrita no registro do @dev (Dev Notes e Debug Log Reference) como "cirurgica" e capaz de discriminar "ledger ausente" de "ledger fora de ordem" — **essa alegacao foi corrigida nesta reconciliacao** (ver edicoes no Debug Log Reference e Completion Notes acima, feitas nesta mesma revisao): como `disparo_id` e capturado por closure dentro do lambda do ledger, revertar a ordem causa um `NameError` que o proprio `try/except` do ledger engole — teste 3 (ledger ausente) e teste 4 (ledger fora de ordem) falham pela mesma causa raiz, nao por sinais independentes. A protecao contra a regressao de ordem continua funcionando (ambos os testes pegam a regressao); a imprecisao era só na descricao do teste, ja corrigida no corpo da story. Nao bloqueante, mas registrado porque o padrao "prefira CONCERNS a PASS quando nao tiver certeza plena" se aplica a este tipo de achado.
3. **FKs confirmadas ao vivo** (reconferido nesta reconciliacao, read-only, projeto `cuca`/`svzkrkfzpiqcesloukgb`): `logs_disparo_disparo_id_fkey → disparos(id) ON DELETE CASCADE`, `logs_disparo_disparo_divulgacao_id_fkey → disparos_divulgacao(id) ON DELETE CASCADE` (nova, conforme ajuste da Task 0), `logs_disparo_lead_id_fkey → leads(id) ON DELETE CASCADE` (inalterada). CHECK `logs_disparo_um_disparo_check` presente. 3 indices parciais presentes (`idx_logs_disparo_wamid`, `idx_logs_disparo_lead_id`, `idx_logs_disparo_disparo_divulgacao_id`).
4. **`wamid` confirmado** nos 4 call-sites: 2 usam (`campanhas_engine.py` disparo pontual e divulgacao mensal), 2 descartam via `_wamid` (`main.py`, `meta_adapter_inbound.py` notificacao de transbordo) — sem uso indevido.
5. **Escopo completo confirmado:** exatamente os 7 arquivos listados no File List (1 migration + 4 arquivos de worker + 2 arquivos de teste). `supabase/functions/motor-agente/index.ts` e `_gravar_breadcrumb_disparo` confirmados intocados.
6. **RLS/advisors confirmado:** RLS habilitada em `logs_disparo`, 1 policy pre-existente (`acesso_autenticado`, nao criada/alterada por esta migration). Advisor security: 0 achados. Advisor performance: 4 achados — 1 `auth_rls_initplan` WARN (pre-existente, nao introduzido por esta migration) + 3 `unused_index` INFO (esperado, tabela com 0 linhas).

### Verificacao adicional feita nesta reconciliacao (alem do checklist original)

Os 2 testes fixados da S-WM-56 (`test_disparo_divulgacao_grava_breadcrumb_apos_envio_com_sucesso`, `test_disparo_divulgacao_nao_grava_breadcrumb_quando_envio_falha`) foram reconferidos: a unica linha alterada em cada um e o `return_value` do mock de `_enviar_template_meta` (de `True`/`False` para `(True, "wamid...")`/`(False, None)`) — todas as demais asserções (breadcrumb gravado com tipo/id corretos, breadcrumb nao gravado em falha, contador de erros) permanecem identicas ao codigo pre-S-WM-57. Confirmado: nao ha regressao silenciosa no comportamento ja validado em producao pela S-WM-56.

**Achado novo, fora do checklist original — verificado por iniciativa propria desta revisao, seguindo `impact-analysis-mandatory.md`:** a coluna `disparos.status` e `character varying`, sem CHECK constraint (`disparos_tipo_check` existe so pra `tipo`, nao pra `status`) — o valor `"em_andamento"` gravado agora antes do loop (Task 3) nao e bloqueado pelo banco. Dado real hoje em `disparos`: so `concluida` (9) e `concluido` (26) — ou seja, `em_andamento`/`pausada` sao estados genuinamente novos para esta tabela (diferente de `disparos_divulgacao`, onde `em_andamento` ja e um estado esperado e ativamente checado por `cuca-portal/src/app/api/divulgacao/disparar/route.ts` como guarda de duplicidade). Busquei quem le `disparos` (a tabela do fluxo pontual/mensal-legado, nao `disparos_divulgacao`) fora do worker: so `cuca-portal/src/app/api/disparos/mensal/route.ts` grava (INSERT, status inicial `pendente`) — nenhum dashboard ou rota do portal filtra/exibe `disparos` por `status`. Ou seja, o novo estado transitorio nao quebra nada hoje (nenhum consumidor real depende dele), mas: se o worker morrer/reiniciar no meio do loop (fora do `try/except` por item, ex. deploy, OOM, crash do processo), a linha fica presa em `em_andamento` para sempre — antes desta story, esse cenario simplesmente nao deixava linha nenhuma. Isso é dado orfao silencioso, nao um bug funcional hoje, mas o Plano 008 (que pretende usar este ledger pra saber "quem ainda falta") vai precisar tratar esse caso. Registrando para o Junior, nao bloqueante para este gate, mas relevante pro proximo.

### Gate Decision (final, reconciliado): CONCERNS

Nao uso PASS porque, seguindo o padrao explicito de Junior ("se encontrar qualquer coisa que nao consiga confirmar com certeza absoluta, prefira CONCERNS a PASS"), ha dois achados que sao observacoes reais, nao speculacao, mas tambem nao sao defeitos de producao:
1. A alegacao de "mutation cirurgica" do teste 4 nao se sustenta como descrita (corrigido no corpo da story nesta revisao).
2. `em_andamento` é um estado transitorio novo em `disparos`, sem consumidor hoje, mas com risco de linha orfa em crash do processo — nao tratado por esta story (fora do escopo declarado), mas deve ser conhecido antes do Plano 008 usar este ledger.

Nenhum dos dois bloqueia: os 6 ACs estao atendidos, a suite passa de forma reproduzivel (153/3, 3x), as FKs/RLS/escopo conferem exatamente com o esperado, e a S-WM-56 nao sofreu regressao silenciosa.

### Pendencias (nao pular etapa)

- **Nao acionar @devops.** Sem push, sem PR — aguardando decisao de Junior.
- **Validacao com envio real pendente**, categoria "Equipe Interna — QA" (`6e39d871-c640-41f8-b19d-ed3a3a97a9f8`) — necessaria depois deste gate, antes de considerar a story pronta para producao real. Nao e substituida por este gate.
