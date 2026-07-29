# S-WM-60 — Corrigir truncamento por limite diário + retomada manual + limite diário e camada de mensageria por número

## Status
Ready for Review — implementação completa em branch isolada `feat/retomada-manual-limite-diario` (a partir de `main`, já com PR#63/S-WM-58 mergeado). Bloqueio do PR#62 confirmado resolvido pelo Junior antes do início (worker já redeployado com o código do PR#62 em 2026-07-28). Migration do Step 6 **criada mas não aplicada** — instrução explícita: aplicar em produção via @devops só depois do gate do QA. Recomendado @qa.

## Origem
Formaliza o `docs/qa/planos-corrida-juventude/008-corrigir-truncamento-limite-diario.md` — plano técnico completo, com o diff exato de cada Step, os testes especificados e as decisões de produto já tomadas. Usar esse documento como referência técnica primária, não este resumo. O plano técnico já existia (achado durante esta formalização — ver Change Log) com boa parte do desenho pronto e concreto, incluindo dado real confirmado por print do Business Manager da Meta (camada de mensageria do número Institucional: `250 → 2000 (atual) → 10000 → 100000 → Ilimitado`). Esta story incorpora a mudança arquitetural confirmada por Junior em 2026-07-28, durante a formalização da `S-WM-59-Painel-Acompanhamento-Envios-Controle-Pausa-Limite.md`: `daily_limit` deixa de ser 1 valor global em `configuracoes` e passa a ser por `phone_number_id`, em `meta_phone_numbers`, junto com `messaging_limit_tier` e `quality_rating`. Isso está no plano técnico como **Step 6 reescrito**.

**Esta story é pré-requisito direto da `S-WM-59-Painel-Acompanhamento-Envios-Controle-Pausa-Limite.md`** — o seletor de limite e o indicador de camada dessa story leem exatamente as colunas que este plano cria (`daily_limit`, `messaging_limit_tier`, `quality_rating` em `meta_phone_numbers`) e chamam o endpoint de retomada que este plano implementa (`/retomar-disparo/{origem}/{item_id}`). **Não bloqueia** a `S-WM-58-Painel-Acompanhamento-Envios-Visao-Entrega.md`, que não depende de nada disto — não precisa ser reaberta.

## Complexidade
**L** — toca o loop principal de disparo (`campanhas_loop`), refatora uma função de envio já em produção pra reuso entre caminho fresco e retomada (ponto de maior risco, sinalizado no próprio plano), introduz um endpoint novo, e (Step 6) muda onde/quando `daily_limit` é resolvido em toda a cadeia de chamadas.

## Prioridade
P2 (herdado do plano técnico) — corrige um dado incorreto já em produção (`"concluída"` falso), mas não é um incidente ativo hoje (a base de divulgação mensal, 735 leads, ainda está abaixo do limite atual de 1000).

## Story

**Como** Junior (responsável pelo CUCA),
**quero** que um disparo que trunca por limite diário seja marcado como pausado (não "concluído"), possa ser retomado manualmente sem duplicar quem já recebeu, e que o limite diário e a camada de mensageria da Meta sejam configuráveis por número — não mais um valor único do sistema inteiro,
**para que** eu tenha um estado confiável pra construir o painel de controle (S-WM-59) em cima, e não perca destinatários silenciosamente quando a base crescer.

## Contexto e Problema

Ver `docs/qa/planos-corrida-juventude/008-corrigir-truncamento-limite-diario.md`, seção "Why this matters", para o relato completo. Resumo: hoje, quando `daily_limit` é atingido no meio de um disparo (pontual/ouvidoria: `break` no laço; divulgação mensal: `total = min(len(leads), daily_limit)` calculado antes do laço), o disparo termina marcado `"concluida"`/`"concluido"` de qualquer forma — indistinguível de um disparo que realmente atendeu todo mundo. A base de divulgação mensal (735 leads) já está perto do limite atual (1000); quando passar, os mesmos leads (sem `ORDER BY`/rotação) vão receber a programação mensal todo mês, e o resto nunca vai receber, sem nenhum sinal disso.

Adicionalmente (requisito novo incorporado ao Step 6 do plano): `daily_limit` hoje é lido 1 vez por tick do loop principal (`campanhas_engine.py:543`), **antes** de qualquer `phone_number_id` ser conhecido — estruturalmente impossível ter limites distintos por número enquanto isso não mudar.

## Escopo

### IN
Ver `docs/qa/planos-corrida-juventude/008-corrigir-truncamento-limite-diario.md`, Steps 1-6, e sua seção "Scope" (in-scope), que é a referência técnica primária. Resumo:
1. Corrigir os 2 pontos de "concluída"/"concluido" falso, introduzindo `"pausada_limite_diario"`/`"pausado_limite_diario"` (Steps 1-2).
2. Funções de retomada manual, reaproveitando o ledger (`logs_disparo`) para enviar só a quem falta — nunca reenvia quem já tem linha de ledger (Step 3).
3. Endpoint `/retomar-disparo/{origem}/{item_id}`, autenticado por token, sempre acionado manualmente (Step 4).
4. Log crítico (visibilidade, sem ação automática) para disparos travados em `"em_andamento"` por tempo demais (Step 5).
5. **Step 6 reescrito**: migration única criando `daily_limit`, `messaging_limit_tier` e `quality_rating` em `meta_phone_numbers`, com seed do número Institucional (`daily_limit=2000`, `messaging_limit_tier=2000`) e refactor movendo a leitura de `daily_limit` de `campanhas_loop()` para dentro de cada função de disparo/retomada, resolvida por `phone_number_id`.

### OUT
- A tela do painel em si (cards, botão, seletor) — isso é a `S-WM-59`, que consome o que este plano expõe.
- Sincronização automática com a API da Meta para popular `messaging_limit_tier`/`quality_rating` — só o caminho manual de registro (UI da S-WM-59).
- Retry de destinatários que já foram tentados e falharam (`logs_disparo.status = 'falhou'`) — retomada aqui só cobre quem nunca foi tentado.
- Retomada automática (loop tentando sozinho) — produto já decidiu que é sempre manual; não implementar nem deixar brecha pra isso (ver STOP conditions do plano).
- Academia Enem — fora de escopo (mesma decisão registrada em S-WM-58/59).

## Acceptance Criteria

1. **Given** um disparo pontual/ouvidoria que atinge `daily_limit` no meio do envio, **when** o laço para, **then** o item e a linha `disparos` ficam com `status = "pausada_limite_diario"` (não `"concluida"`), com `total_enviados` refletindo só o que foi realmente enviado.
2. **Given** um disparo de divulgação mensal com mais leads elegíveis que `daily_limit`, **when** processado, **then** a linha `disparos_divulgacao` fica com `status = "pausado_limite_diario"` (não `"concluido"`).
3. **Given** o endpoint `/retomar-disparo/{origem}/{item_id}` chamado para um item pausado, **when** processado, **then** envia só para leads sem nenhuma linha em `logs_disparo` para aquele `disparo_id`/`disparo_divulgacao_id` — nunca duplica quem já recebeu.
4. **Given** o endpoint chamado sem o token correto, **when** processado, **then** retorna 403, sem side-effect algum.
5. **Given** uma linha `disparos` presa em `"em_andamento"` por mais de 2h, **when** o loop principal roda, **then** um log `CRITICAL` é emitido (visibilidade) — sem nenhuma ação automática sobre a linha.
6. **Given** a migration do Step 6 aplicada, **when** inspecionada, **then** `meta_phone_numbers` tem as colunas `daily_limit`, `messaging_limit_tier`, `messaging_limit_tier_confirmado_em`, `quality_rating` — `daily_limit`, `messaging_limit_tier` e `quality_rating` não existiam antes desta story (confirmar ao vivo antes de aplicar, não presumir).
7. **Given** 2 `phone_number_id` distintos com `daily_limit` configurados diferentes (cenário mockado em teste — produção só tem 1 número real em uso pelos 3 motores hoje), **when** cada um dispara, **then** cada um respeita o próprio limite — `daily_limit` não é mais um valor único resolvido em `campanhas_loop()`.
8. Nenhum mecanismo de retomada automática é introduzido — a única forma de retomar um disparo pausado é o clique explícito que chama o endpoint.
9. `python -m pytest tests/ -v` (suíte completa do worker) → exit 0, incluindo todos os testes novos do plano (Steps 1-6).

## Tasks / Subtasks

Ver `docs/qa/planos-corrida-juventude/008-corrigir-truncamento-limite-diario.md` para o detalhamento Step a Step — não duplicado aqui para evitar 2 fontes de verdade divergindo. Alto nível:

- [x] **Task 0 — Confirmar pré-requisitos, bloqueante**
  - [x] PR#62 (S-WM-57) confirmado mergeado em `main` (commit `69128aa`, 2026-07-28 09:51) via `git log`. `cuca-worker` redeployado confirmado diretamente pelo Junior (2026-07-29) — evento distinto do redeploy do portal (S-WM-58).
  - [x] Confirmado ao vivo (`information_schema.columns`): `daily_limit`/`messaging_limit_tier`/`messaging_limit_tier_confirmado_em`/`quality_rating` não existem em `meta_phone_numbers` — nenhuma STOP condition disparada. Também confirmado o estado real citado no plano: só 2 linhas ativas (`Empregabilidade`, `Institucional`).
  - [x] Decisão de Junior obtida (2026-07-29): fallback de `daily_limit` não configurado = **opção 1, valor conservador fixo (500)** — não bloqueia o disparo.
  - [x] Drift check (`git diff --stat 05c79d3..HEAD -- worker/campanhas_engine.py worker/main.py worker/tests/test_campanhas_engine.py`): **limpo, 0 diferença** — plano bate exatamente com o código real nesses 3 arquivos.
- [x] **Task 1 — Steps 1-2 do plano** (correção do status falso)
- [x] **Task 2 — Step 3 do plano** (funções de retomada + extração cuidadosa de `_enviar_para_leads_pendentes`)
  - [x] Extração equivalente feita também do lado de divulgação (`_enviar_divulgacao_para_leads_pendentes`) — não pedida explicitamente pelo Step 3 (que só detalha o lado pontual), mas necessária pelo mesmo motivo: não duplicar envio/breadcrumb/ledger entre caminho fresco e retomada.
  - [x] **Desvio deliberado da query literal do plano** (contagem cumulativa da retomada): o plano especifica `count(*) WHERE status = 'enviado'`, mas isso subconta — o webhook da Meta (S-WM-57) avança o status pra `entregue`/`lido`/`apagada` assim que a confirmação chega. Confirmado com dado real (disparo `91ed62f2`, S-WM-58): `total_enviados` real = 4, `count(status='enviado')` = 3. Usada a convenção já validada na RPC `listar_disparos_acompanhamento` (S-WM-58): `status <> 'falhou'`.
  - [x] 27/27 testes pré-existentes de `test_campanhas_engine.py` continuam passando sem modificação após a extração (incluindo o teste mais sensível, `test_disparo_pontual_cria_disparo_antes_do_loop_nao_depois`, que trava `total_enviados == 1` no caminho fresco).
- [x] **Task 3 — Step 4 do plano** (endpoint de retomada)
  - [x] **Desvio do snippet do plano, não do código real**: o snippet do Step 4 (`Header(None)` + `HTTPException` + 403) não bate com o padrão real de `/academia-enem/process` em produção (`Request` + `request.headers.get` + `Response` + **401**, não 403) — confirmado lendo o arquivo real, drift do próprio documento do plano, não do código. Seguido o padrão real (`Request`/`Response`) mas mantido **403** (não 401) por ser requisito explícito do AC4 desta story.
  - [x] Endpoint despacha via `BackgroundTasks` (fire-and-forget), não aguarda inline — uma retomada pode levar minutos (delay anti-ban × N leads); aguardar arriscaria timeout de gateway. Mesmo padrão já usado por `/academia-enem/process`.
- [x] **Task 4 — Step 5 do plano** (log de disparo travado)
- [x] **Task 5 — Step 6 do plano** (migration das 3 colunas em `meta_phone_numbers` + refactor de leitura por número)
  - [x] Migration criada em `supabase/migrations/20260729120000_meta_phone_numbers_limits_tier_quality.sql` — **NÃO aplicada** (instrução explícita: só via @devops, depois do gate do QA).
  - [x] Corrigido sinal do timestamp de `messaging_limit_tier_confirmado_em` no rascunho do plano (`-01:00` → `+01:00`, consistente com o texto "GMT+1" do próprio plano) — campo de observabilidade, não afeta `daily_limit`/`messaging_limit_tier`.
  - [x] `campanhas_loop()` não lê mais `daily_limit` de `configuracoes` (nem de nenhum valor único por tick) — passa `None`, resolvido por `phone_number_id` em cada função de disparo/retomada.
- [x] **Task 6 — Testes** (todos os listados no "Test plan" do plano técnico)
  - [x] Todos os testes do Test plan + os 3 adicionais do Step 6 implementados. Mutation check feito ao vivo nos 2 branches de status (Step 1 e Step 2): revertido pro comportamento antigo → teste correspondente falhou; restaurado → voltou a passar.
- [x] **Task 7 — Fechamento**
  - [x] `cd worker && python -c "import campanhas_engine; import main"` exit 0.
  - [x] `python -m pytest tests/ -v`: **144 passed** (suíte inteira, incluindo os novos desta story), rodado com `--ignore=tests/test_meta_adapter_outbound.py` — ver nota abaixo sobre 3 falhas pré-existentes não relacionadas.
  - [x] `git status`: só os arquivos esperados tocados (ver File List) — nenhum arquivo fora do escopo do plano.
  - [x] `plans/README.md` (citado no Done criteria do plano) **não existe neste projeto** — path stale, provavelmente pré-datava a consolidação em `docs/qa/planos-corrida-juventude/`. Não fabricado, sinalizado aqui em vez de ignorado silenciosamente.

## Dev Notes

- Plano técnico completo, com diff exato de cada Step, current state grounded em linhas reais do código, e os testes especificados na íntegra: **`docs/qa/planos-corrida-juventude/008-corrigir-truncamento-limite-diario.md`** — ler por completo antes de editar.
- **Decisões de produto já tomadas, não re-litigar**: retomada é sempre manual, nunca automática (instrução explícita, ver o próprio cabeçalho do plano técnico); resume só cobre quem nunca foi tentado, não quem falhou.
- **Decisão de produto ainda em aberto** (Step 6): fallback de `daily_limit` quando um número não tiver valor configurado — perguntar a Junior antes de implementar esse Step especificamente, não presumir um valor.
- **Ponto de maior risco**: a extração de `_enviar_para_leads_pendentes` (Step 3) — refatorar uma função já em produção sem mudar seu comportamento no caminho comum (disparo fresco, sem truncamento). Rodar a suíte completa antes e depois da extração isoladamente.
- **Estado real hoje, pra calibrar expectativa do Step 6** (não é motivo para não fazer): só existe 1 número ativo (`Institucional`) compartilhado pelos 3 motores — não há ganho prático imediato de limites distintos entre pontual/ouvidoria/divulgação até Ouvidoria (ou outro) ganhar um `phone_number_id` próprio.

### Testing
`cd worker && python -c "import campanhas_engine; import main"` (sanity) e depois `python -m pytest tests/ -v` (suíte completa) — ver "Test plan" do plano técnico para a lista completa de testes novos.

**Resultado real**: sanity OK. `python -m pytest tests/ --ignore=tests/test_meta_adapter_outbound.py`: **144 passed**. Com `test_meta_adapter_outbound.py` incluído: 169 passed + **3 falhas pré-existentes, não relacionadas** (`TestSendMessageEndpoint::*`, endpoint `/send-message/{token}` — arquivo nunca tocado por esta story). Causa confirmada: essas 3 fazem `import worker.main`, que só resolve quando pytest roda a partir da raiz do repo, não de dentro de `worker/` (como o próprio plano instrui `cd worker && pytest`); reproduzido o mesmo erro revertendo temporariamente os arquivos desta story (`git stash`) — falha idêntica, confirmando que não é regressão. Rodando a partir da raiz do repo, 2 das 3 passam; a 3ª (`test_envia_via_meta_com_contrato_novo`) falha por uma chamada HTTP real à Graph API retornando 401 (token inválido no ambiente de teste) — também nada a ver com esta story.

## Dependências
~~BLOQUEADA pelo PR#62~~ — **resolvido**: PR#62 mergeado em `main` (commit `69128aa`) e `cuca-worker` redeployado, confirmado pelo Junior em 2026-07-29. É pré-requisito direto da `S-WM-59`, que segue bloqueada até esta story fechar `Done`.

## Git workflow
Branch: `feat/retomada-manual-limite-diario` (já definida no plano técnico), criada a partir de `main` (com PR#63/S-WM-58 já mergeado). Commits por Step, conventional-commits style. Não dar push/PR sem autorização explícita.

## File List
- `worker/campanhas_engine.py` (modificado — Steps 1,2,3,5,6: `_MESES` içado a nível de módulo; `_get_daily_limit_by_phone_sync`/`_warn_if_daily_limit_above_tier_sync` novos; `_query_leads_pendentes_sync`/`_query_leads_divulgacao_pendentes_sync` novos; `_enviar_para_leads_pendentes`/`_enviar_divulgacao_para_leads_pendentes` novos, extraídos de `_processar_item_disparo_interno`/`_processar_disparo_divulgacao_interno`; `retomar_disparo_pausado`/`retomar_disparo_divulgacao_pausado` novos; log `DISPARO-TRAVADO` em `campanhas_loop`)
- `worker/main.py` (modificado — Step 4: endpoint `/retomar-disparo/{origem}/{item_id}`)
- `worker/tests/test_campanhas_engine.py` (modificado — 12 testes novos + mutation check nos Steps 1/2)
- `worker/tests/test_main_retomar_disparo.py` (novo — 4 testes do endpoint, cobrindo AC4)
- `supabase/migrations/20260729120000_meta_phone_numbers_limits_tier_quality.sql` (novo — **não aplicado**, aguardando gate do QA)

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-28 | 0.1 | Story formalizada a partir do Plano 008. Achado durante a formalização: o plano técnico já existia (fora do diretório padrão, nunca commitado) — consolidado em `docs/qa/planos-corrida-juventude/008-*.md`. O **Step 6 foi reescrito** com a decisão de produto confirmada por Junior em 2026-07-28: `daily_limit` deixa de ser global, passa a ser por `phone_number_id`, junto com `messaging_limit_tier`/`quality_rating` — 3 colunas em `meta_phone_numbers` (corrigindo a suposição herdada da S-WM-57 Dev Notes, que citava `quality_rating`/`messaging_limit_tier` como já existentes). @dev não acionado — aguardando validação. | @sm River |
| 2026-07-29 | 0.2 | Implementação completa em branch isolada `feat/retomada-manual-limite-diario`. Task 0 desbloqueada: worker redeployado (confirmado por Junior) e fallback do Step 6 decidido (opção 1, 500 fixo). Steps 1-6 implementados: status falso corrigido (`pausada_limite_diario`/`pausado_limite_diario`); loop de envio extraído e compartilhado entre caminho fresco e retomada manual (pontual e divulgação); endpoint `/retomar-disparo/{origem}/{item_id}` autenticado, fire-and-forget via `BackgroundTasks`; log `DISPARO-TRAVADO` para `em_andamento` preso há +2h; `daily_limit` migrado de `configuracoes` (global) para `meta_phone_numbers` (por número), migration criada mas **não aplicada** (só via @devops, pós-gate QA). 3 desvios deliberados do plano, documentados nas Tasks acima com evidência: (1) contagem cumulativa da retomada usa `status <> 'falhou'`, não a query literal `status = 'enviado'` do plano (que subconta pós-webhook); (2) endpoint segue o padrão real de `/academia-enem/process` (`Request`/`Response`), não o snippet do plano (`Header`/`HTTPException`), que diverge do código real — mas mantido 403 (não 401) por ser requisito do AC4; (3) sinal do timestamp de `messaging_limit_tier_confirmado_em` corrigido na migration (`+01:00`, consistente com "GMT+1" do texto do plano). 12 testes novos + 4 no novo `test_main_retomar_disparo.py`, mutation check nos Steps 1 e 2. Suíte completa: 144 passed (144/144, excluindo 3 falhas pré-existentes não relacionadas em `test_meta_adapter_outbound.py`, confirmadas via reprodução com `git stash`). Status Draft → Ready for Review. Recomendado @qa. | @dev Dex |
