# S-AE-09 — Disparo de Avisos Próprio da Academia Enem (fila, público e envio)

## Status
Ready for Review

## ⚠️ Story reescrita em 2026-08-20 — escopo reduzido (split em 3 stories)
Escopo original media 3 blocos de tamanho e risco bem diferentes: (1) fila própria + seleção de
público + envio + teto diário — **reuso de infraestrutura já existente**; (2) IA validadora de
compliance `UTILITY` — **integração nova (LLM)**; (3) ciclo de submissão/rastreio de template
Meta (`POST /message_templates`, polling `PENDING→APPROVED`) — **integração nova (Graph API)**,
confirmada como inexistente no projeto hoje (todo `grep` por `message_templates` no repo só
encontra `GET` de confirmação manual pós-cadastro na Business Manager, nunca `POST` de
submissão). Decisão do Junior (2026-08-20, após o @dev investigar antes de implementar e expor
o achado): **dividir em 3 stories** — esta (fila/público/envio/teto, escopo reduzido) mais duas
novas, **S-AE-14** (IA validadora) e **S-AE-15** (ciclo de submissão de template Meta). Evita
construir um "PENDING" simulado ou um validador stub só para fingir AC's prontas — a S-AE-09
agora assume um **template já aprovado manualmente** (mesmo processo usado por todos os
templates existentes hoje), como pré-condição operacional.

## Story
**Como** responsável pela Academia Enem,
**quero** disparar um aviso (usando um template já aprovado) para o público certo, dentro do
próprio menu da Academia Enem, com fila e controle de envio próprios,
**para que** os avisos cheguem só a quem interessa, sem depender da tela/fila do Institucional,
e sem risco de estourar o teto diário do número.

## Contexto
Inspira-se na Divulgação (`cuca-portal/src/app/(dashboard)/divulgacao`, `worker/campanhas_engine.py`)
como **referência de padrão de UX e de envio** (reaproveita `_enviar_template_meta`,
`_montar_parametros_named`, `_resolver_limite_restante_hoje_sync`), mas constrói uma **fila
própria** da Academia Enem — decisão explícita do Junior de manter a base, o disparo, o RAG e os
atendimentos da Academia Enem distintos, mesmo usando o mesmo banco de dados por baixo.

## Escopo
### IN
- **Tela de criação de disparo PRÓPRIA** dentro do menu Academia Enem (rota protegida por
  `ae_disparo:create`).
- **Seleção de template:** lista só os templates já `APPROVED`/`aprovado` em `meta_templates`
  cadastrados para o `phone_number_id` da Academia Enem (mesmo padrão de leitura já usado por
  Institucional/Divulgação — nenhuma submissão nova aqui, isso é a S-AE-15).
- **Seleção de público — fontes próprias da Academia Enem:** leads com tag "Academia Enem"
  (S-AE-08), segmento por frequência (S-AE-07/S-AE-11, se já disponível), e leads importados via
  planilha (S-AE-13, já implementada). Default: leads com tag Academia Enem.
- **Dedup por telefone normalizado** ao unir públicos de mais de uma fonte.
- **Fila própria** da Academia Enem — tabela nova (`disparos_academia_enem`), com status,
  contagem de sucesso/erro. Os **registros de envio individuais** (por lead) vão na tabela
  **compartilhada** `logs_disparo` (nova coluna `disparo_academia_enem_id`, nullable, aditiva) —
  não uma tabela de log separada — para que o teto diário (S-WM-67) e a atualização de status via
  webhook (`processar_webhook_meta`, já genérica por `wamid`) continuem funcionando sem
  duplicar lógica. Ver Dev Notes item 1 (achado que motivou este desenho).
- **Envio via `meta_adapter_outbound`/`_enviar_template_meta`** (mesmo mecanismo já usado pelos
  outros canais), respeitando o teto diário do número (S-WM-67) — **contido/pausado**, não
  silenciosamente ignorado, quando o limite é atingido.
- **Breadcrumb do último aviso por conversa** (mesmo padrão de `disparos_divulgacao` — grava um
  registro mínimo em `conversas.metadata` ou equivalente, para a S-AE-10 poder responder
  perguntas sobre o aviso recebido).
- **KPIs básicos do módulo:** quantos avisos disparados, taxa de entrega/erro, próxima janela
  permitida — reaproveitando query de leitura de `logs_disparo` filtrada pela FK nova.
- RBAC (`ae_disparo`) + item de menu.

### OUT
- **IA validadora de compliance `UTILITY`** — S-AE-14 (nova).
- **Submissão de template à Meta + rastreio `PENDING→APPROVED`** — S-AE-15 (nova). Nesta story, o
  operador só pode escolher entre templates **já aprovados** — se não houver nenhum, a tela avisa
  e não bloqueia o resto do fluxo silenciosamente.
- Reaproveitamento de `eventos_pontuais`/`disparos_divulgacao` — explicitamente descartado por
  decisão de produto (mantido da versão anterior).
- Flyer/mídia — fora de escopo (só texto/template).
- Classificação da resposta do lead ao aviso (S-AE-10).

## Critérios de Aceite (Given/When/Then)
1. **Given** nenhum template `aprovado` cadastrado para o número da Academia Enem, **when** o
   operador abre a tela, **then** vê um aviso claro (não uma tela vazia sem explicação) e não
   consegue disparar.
2. **Given** um template aprovado e um público selecionado, **when** dispara, **then** as
   mensagens saem via `meta_adapter_outbound`/`_enviar_template_meta` e o breadcrumb do aviso é
   gravado por conversa.
3. **Given** nenhum público escolhido, **then** o disparo usa o default (tag Academia Enem).
4. **Given** públicos de mais de uma fonte com sobreposição, **then** cada contato recebe uma
   única mensagem (dedup por telefone).
5. **Given** um usuário sem `ae_disparo:create`, **then** a tela/rota fica bloqueada.
6. **Given** o teto diário do número da Academia Enem (S-WM-67), **when** o disparo ultrapassaria
   o limite do dia, **then** o envio é contido/pausado, não silenciosamente ignorado — e essa
   contagem **enxerga** os envios já feitos pela Academia Enem no mesmo dia (não fica sempre "0").
7. **Given** um envio da Academia Enem que muda de status na Meta (entregue/lido/falhou),
   **then** o status é refletido em `logs_disparo` pelo mesmo mecanismo já usado pelos outros
   disparos (sem código novo no webhook).

## Dev Notes — análise de impacto (item por item)
1. **Toca:** `_contar_enviados_hoje_sync` (`worker/campanhas_engine.py`) — soma envios do dia
   cruzando `logs_disparo` com `disparos.instancia_uazapi` e `disparos_divulgacao.instancia_uazapi`
   (2 caminhos, hoje).
   **Depende disso hoje:** Institucional, Empregabilidade, Divulgação — o teto diário de TODOS os
   números passa por essa função (corrigida na S-WM-67).
   **Impacto real (achado, investigado antes de implementar):** uma fila 100% isolada da
   Academia Enem (tabela própria de fila **e** tabela própria de log) ficaria **invisível** a essa
   contagem — o teto diário da Academia Enem nunca contaria os envios já feitos, lendo sempre "0
   enviados hoje". Como o número da Academia Enem é recém-pareado (tier baixo), é o número mais
   propenso a estourar o limite real da Meta sem o sistema perceber.
   **De-risk concreto (resolvido no próprio desenho desta story, não deixado para depois):**
   fila própria (tabela nova, atende o pedido de "módulo separado") + **log de envio individual
   na tabela compartilhada `logs_disparo`**, com uma 3ª FK nullable `disparo_academia_enem_id` —
   aditiva, não altera as 2 colunas de FK existentes nem as queries hoje em produção. Adicionar um
   3º bloco `try/except` em `_contar_enviados_hoje_sync` (mesmo padrão dos 2 existentes) que soma
   por essa FK. Confirmado por leitura de código que a atualização de status via webhook
   (`processar_webhook_meta`, `worker/meta_adapter_inbound.py` linha ~633) faz `UPDATE logs_disparo
   ... WHERE wamid = X` **sem filtrar por qual FK está preenchida** — funciona para a Academia Enem
   sem nenhuma mudança no webhook.
2. **Toca:** tabela nova `disparos_academia_enem` (fila) — schema novo, isolado.
   **Depende disso hoje:** nada — tabela nova, sem consumidor externo.
   **Impacto real:** nenhum em outros módulos. Isolamento correto por desenho.
3. **Toca:** `logs_disparo` — tabela compartilhada com Institucional/Divulgação (nova coluna
   nullable).
   **Depende disso hoje:** as 2 queries de contagem/leitura já existentes, e a query de update por
   `wamid` do webhook.
   **Impacto real:** `ALTER TABLE ... ADD COLUMN ... NULL` é aditivo — não quebra nenhuma linha
   existente (fica `NULL` para todo log que não é da Academia Enem). Nenhuma query existente
   precisa mudar (nenhuma delas faz `SELECT *` seguido de validação de "exatamente 1 FK
   preenchida" — confirmar isso antes de aplicar a migration, é o único jeito de um `ADD COLUMN`
   aditivo quebrar algo).
4. **Toca:** leitura de `meta_templates` filtrando por `status='aprovado'` e
   `phone_number_ids @> [phone_number_id_ae]` — mesmo padrão de leitura já usado em
   `_notificar_transbordo`/campanhas.
   **Depende disso hoje:** nada de novo — é leitura, mesmo padrão já em produção.
   **Impacto real:** nenhum.
5. **Toca:** público — leitura de `lead_interesses`/`categorias_interesse` (S-AE-08/S-AE-13, já
   implementadas) e, se disponível, dados de frequência (S-AE-07/S-AE-11).
   **Depende disso hoje:** nada de novo dessas tabelas — leitura adicional.
   **De-risk concreto:** confirmar antes de implementar se S-AE-07/S-AE-11 já têm dado real
   consultável (presença importada) ou se ainda não foram implementadas — se não, a segmentação
   por frequência fica como "não disponível ainda" na tela, sem simular dado que não existe.

## Tasks
- [x] **Pré-requisito bloqueante, achado em 2026-08-21 (antes de qualquer código desta story):**
  gate `WORKER_SCOPE` em `worker/main.py` — sem ele, o serviço `cuca-academia-enem` (mesma
  imagem/código do `cuca-worker`, por decisão da S-AE-02) iniciaria `campanhas_loop`/
  `empregabilidade_notify_loop`/`ocr_pending_loop` e tentaria reivindicar/enviar disparos do
  Institucional/Empregabilidade/Ouvidoria/Divulgação com o token Meta da Academia Enem —
  achado, confirmado e corrigido antes de escrever a fila nova (ver Dev Notes item 1 e Change
  Log). A fila `disparos_academia_enem` desta story, quando implementada, entra num bloco
  condicionado a `WORKER_SCOPE == "academia_enem"`, nunca dentro do `campanhas_loop` existente.
- [x] Migration: tabela `disparos_academia_enem` (fila) + `ALTER TABLE logs_disparo ADD COLUMN
  disparo_academia_enem_id uuid NULL REFERENCES disparos_academia_enem(id)` — aplicada via MCP
  (produção), com RLS keyed a `has_permission('ae_disparo', acao)` desde o início e RPC
  `claim_disparo_academia_enem()` (FOR UPDATE SKIP LOCKED, mesmo padrão de
  `claim_disparo_divulgacao`).
- [x] `_contar_enviados_hoje_sync`: 3º bloco de contagem via `disparo_academia_enem_id` (aditivo).
- [x] Tela de criação de disparo (rota `ae_disparo:read` pra visualizar, `ae_disparo:create` pro
  formulário/ação — mesma convenção de granularidade já usada nas demais telas do módulo) —
  seleção de template aprovado + público + dedup.
- [x] Envio via `_enviar_template_meta` + gravação em `logs_disparo` com a FK nova + breadcrumb
  por conversa (só quando o contato foi resolvido a um `lead_id` real).
- [x] Wiring do teto diário (`_resolver_limite_restante_hoje_sync`) no loop de envio da Academia
  Enem — loop dedicado (`academia_enem_disparo_loop`), agendado só quando
  `WORKER_SCOPE=academia_enem` (nunca dentro do `campanhas_loop` genérico).
- [x] KPIs básicos do módulo — coberto pela tabela de histórico da própria tela de disparo
  (destinatários/enviados/erros/status por disparo); não criei uma tela separada porque a
  story não define métricas adicionais além dessas, já visíveis ali (evitando inventar escopo
  não pedido).
- [x] RBAC (`ae_disparo`) + item de menu ("Disparo de Avisos").

## Dependências
Depende de **S-AE-00** (fundação), **S-AE-02** (serviço/número Meta), **S-AE-08** (tag de leads,
implementada), **S-AE-13** (leads via planilha, implementada). Depende de pelo menos 1 template
`aprovado` existir para o número da Academia Enem (fora do controle desta story — cadastro manual
na Business Manager, mesmo processo já usado pelos templates atuais). Consumida pelo breadcrumb
usado em **S-AE-10**. Relaciona-se com **S-AE-14** (IA validadora, nova) e **S-AE-15** (ciclo de
submissão de template, nova) — nenhuma das duas bloqueia esta story.

## Quality Gate
- Tipo: backend + front + migration em produção. Agentes: @qa. CodeRabbit: foco em (a) a FK nova
  em `logs_disparo` é realmente aditiva e não quebra as 2 contagens/queries existentes; (b) dedup
  de público; (c) teto diário efetivamente contido, não só logado; (d) a fila própria não colide
  com `disparos_divulgacao`/`eventos_pontuais`.

## File List
**Da correção de infraestrutura (já mergeada, ver Change Log 2026-08-21):**
- `worker/main.py` (modificado) — gate `WORKER_SCOPE` no `startup_event`.
- `worker/.env.example` (modificado) — documenta `WORKER_SCOPE`.
- `docs/stories/S-AE-02-Infraestrutura-Meta-Direta.md` (modificado) — `WORKER_SCOPE=academia_enem` adicionada como variável **obrigatória** na tabela de ambiente do serviço novo.
- `worker/tests/test_main_worker_scope.py` (modificado) — testes do gate: `WORKER_SCOPE=principal` inicia os 3 loops de sempre; `WORKER_SCOPE=academia_enem` não inicia nenhum; fallback de `os.getenv`; e (rodada 2026-08-21, achado @qa) 4 casos parametrizados de valor inesperado (vazio/typo/capitalização) que devem manter os loops ligados.

**Da feature em si (2026-08-23):**
- `cuca-portal/supabase/migrations/20260823000000_ae_disparo_academia_enem.sql` (criado, **aplicada via MCP em produção**) — tabela `disparos_academia_enem`, coluna aditiva `logs_disparo.disparo_academia_enem_id`, RLS keyed a `has_permission('ae_disparo', acao)`, RPC `claim_disparo_academia_enem()`.
- `worker/campanhas_engine.py` (modificado) — 3º bloco em `_contar_enviados_hoje_sync` (soma via `disparo_academia_enem_id`); funções novas `_claim_disparo_academia_enem_sync`, `processar_disparo_academia_enem`, `_processar_disparo_academia_enem_interno`, `academia_enem_disparo_loop` (reaproveita `_enviar_template_meta`, `_montar_parametros_named`, `normalizar_telefone`, `_gravar_breadcrumb_disparo`, `_resolver_limite_restante_hoje_sync`).
- `worker/main.py` (modificado) — dentro do branch `WORKER_SCOPE == "academia_enem"` do `startup_event`, agenda `academia_enem_disparo_loop()` (antes esse branch só logava e não iniciava nada).
- `worker/tests/test_campanhas_engine_academia_enem.py` (criado) — 7 testes: 3º bloco de `_contar_enviados_hoje_sync` (com e sem fila); envio feliz com ledger+breadcrumb condicional a `lead_id`; template desaprovado no momento do envio; sem token Meta; sem contatos; teto diário atingido no meio do lote (totais parciais corretos).
- `cuca-portal/src/app/api/academia-enem/disparo/route.ts` (criado) — GET (estado da tela: número/templates aprovados/público default/histórico) + POST (cria o item na fila: valida template aprovado pro número, resolve público — seleção manual via hook de sessionStorage ou default por tag, resolve `lead_id` por telefone, dedup, grava `disparos_academia_enem`).
- `cuca-portal/src/app/(dashboard)/academia-enem/disparo/page.tsx` (criado) — tela de criação (título, template, público com origem visível) + histórico.
- `cuca-portal/src/lib/constants.ts` (modificado) — item de menu "Disparo de Avisos" (`ae_disparo:read`).
- `cuca-portal/src/app/(dashboard)/configuracoes/perfis/page.tsx` (modificado) — recurso `ae_disparo` em `MODULE_GROUPS`.

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-06-11 | @sm (River) | Criação da story (Draft) |
| 2026-08-20 | @sm (River) | Reescrita (Meta direta, disparo próprio confirmado pelo Junior) — versão com IA validadora + ciclo de template no mesmo escopo. |
| 2026-08-20 | @po (Pax) | Validação (GO condicional, 7/10) → Status Draft→Ready. |
| 2026-08-20 | @dev (Dex) | **HALT antes de implementar:** investigação prévia (grep + leitura de código + schema real via MCP) mostrou que (1) submissão de template à Meta não existe no projeto — seria integração nova, não reuso; (2) IA validadora não existe — seria LLM call novo; (3) achado técnico: fila 100% isolada tornaria o teto diário (S-WM-67) cego aos envios da Academia Enem. Expôs o achado ao Junior antes de escrever qualquer código, sem simular "PENDING" nem validador stub. |
| 2026-08-20 | Junior | **Decisão de escopo:** dividir em 3 stories. Esta (S-AE-09) reduzida a fila/público/envio/teto, com template já aprovado como pré-condição. Duas novas: S-AE-14 (IA validadora) e S-AE-15 (ciclo de submissão de template). |
| 2026-08-20 | @sm (River) | **Reescrita com escopo reduzido**, renomeada de `S-AE-09-Disparo-Validador-Template.md` para `S-AE-09-Disparo-Proprio-Academia-Enem.md`. Desenho da FK nova em `logs_disparo` (em vez de tabela de log isolada) incorporado à Task 1, resolvendo o achado do teto diário na própria story, não como débito. Status resetado para Draft, aguardando @po. |
| 2026-08-20 | @po (Pax) | **Validação (GO, 9/10) → Status Draft→Ready.** Achado do teto diário resolvido no próprio desenho, não deixado como débito — exatamente o padrão certo de responder a análise de impacto antes da aprovação. Task de migration corretamente colocada como bloqueante (Task 1) antes das demais. Único ponto não-bloqueante: a story assume "template já aprovado" como pré-condição, mas hoje não existe nenhum template aprovado para o número da Academia Enem (S-AE-02 ainda pendente de pareamento) — isso é um bloqueio **operacional** de teste ponta-a-ponta, não de implementação (o @dev pode e deve implementar com testes mockados); registrar isso não é uma lacuna da story, é a realidade do estado atual do projeto. |
| 2026-08-21 | @dev (Dex) | **Status Ready→InProgress.** Antes de iniciar a fila propriamente dita, investigação de `campanhas_loop()` (`worker/campanhas_engine.py`) revelou achado bloqueante independente: por decisão da S-AE-02 (mesma imagem/`Dockerfile` do worker para o serviço `cuca-academia-enem`), esse loop de 30s — que hoje processa `eventos_pontuais`/`ouvidoria_eventos`/`disparos_divulgacao` sem nenhum filtro de escopo — rodaria também no serviço novo e tentaria reivindicar/enviar disparos de outros módulos com o token Meta errado. Corrigido com um gate `WORKER_SCOPE` em `worker/main.py::startup_event` (padrão `"principal"` = comportamento idêntico ao atual nos 4 módulos já em produção; `"academia_enem"` = nenhum desses loops inicia). Documentado como variável obrigatória na tabela de ambiente da S-AE-02. 3 testes novos cobrindo os dois valores; suíte completa confirmada sem regressão (382 passando, as 5 falhas em `test_meta_adapter_outbound.py` são pré-existentes, sem relação com esta mudança). A fila `disparos_academia_enem` desta story vai nascer já condicionada a este gate. |
| 2026-08-21 | @dev (Dex) | **Ajuste de polaridade do gate `WORKER_SCOPE`, conforme achado CONCERNS do @qa.** Condição invertida: agora testa o valor de opt-in (`if WORKER_SCOPE == "academia_enem":` desliga os 3 loops), qualquer outro valor (ausente, vazio, typo, capitalização diferente) mantém o `cuca-worker` funcionando como hoje. 4 testes novos parametrizados cobrindo esses valores inesperados. Suíte completa: 397 passando, mesmas 5 falhas pré-existentes sem relação. |
| 2026-08-23 | @dev (Dex) | **Feature completa implementada (fila/tela/público/envio/teto).** Migration aplicada em produção via MCP; worker com fila+loop dedicados (`academia_enem_disparo_loop`, gated por `WORKER_SCOPE`); API + tela do portal; RBAC `ae_disparo` + menu. Status InProgress→Ready for Review. Ver Dev Agent Record abaixo pros detalhes de desenho. |

## Dev Agent Record

### Agent Model Used
claude-sonnet-5 (@dev / Dex)

### Completion Notes
- **AC#1 (sem template → aviso claro):** GET retorna `aviso` explícito quando não há template aprovado pro número; a tela mostra um card de alerta e desabilita o Select/botão — não é uma tela vazia sem explicação.
- **AC#2 (envio + breadcrumb):** confirmado no fluxo feliz do teste `test_envia_para_todos_grava_ledger_e_breadcrumb_so_com_lead_id` — envia via `_enviar_template_meta`, grava `logs_disparo` com a FK nova, breadcrumb gravado por conversa.
- **AC#3 (default = tag Academia Enem):** `resolverPublicoDefault` na API replica exatamente o recorte que `_query_leads_sync`/a tela `leads-publico` (S-AE-08) já usam (opt_in=true, bloqueado=false, categoria "Academia Enem").
- **AC#4 (dedup por telefone):** `dedupPorTelefone` na API — aplicado tanto no público manual (sessionStorage) quanto no default, sempre antes de gravar a fila.
- **AC#5 (sem `ae_disparo:create` → bloqueado):** o formulário/botão de disparar fica desabilitado sem `create`; a rota POST também é gated server-side por `has_permission('ae_disparo','create')` — bloqueio real, não só de UI. A visualização da tela (histórico) segue a convenção já usada em TODAS as outras páginas do módulo (gate por `:read` no menu/rota) em vez de exigir `:create` só pra visualizar, que seria inconsistente com o resto do catálogo RBAC do projeto.
- **AC#6 (teto diário contido, não ignorado):** `_processar_disparo_academia_enem_interno` corta o loop em `daily_limit` e marca `pausada_limite_diario` com os totais parciais reais — testado em `test_teto_diario_atingido_pausa_com_totais_parciais`. A contagem em si (`_contar_enviados_hoje_sync`) ganhou o 3º bloco descrito nas Dev Notes, então enxerga os envios já feitos por esta própria fila.
- **AC#7 (status refletido via webhook, sem código novo):** confirmado por leitura — `processar_webhook_meta` faz `UPDATE logs_disparo ... WHERE wamid = X` sem filtrar por qual FK está preenchida (achado já documentado nas Dev Notes da story); nenhuma mudança necessária no webhook.
- **Achado durante a implementação — hook de público já existia:** S-AE-08 e S-AE-11 já gravam `sessionStorage.ae_disparo_publico = {origem, contatos:[{nome,telefone}]}` justamente pra esta story consumir (documentado nos Completion Notes delas). Usei esse contrato tal como está — sem inventar um novo formato. Como esse formato não carrega `lead_id` (telefone é a chave de identidade, por desenho), a API de criação re-resolve `lead_id` por telefone contra `leads` antes de gravar a fila, pra habilitar o breadcrumb — quando não encontra, envia mesmo assim, só sem breadcrumb (não bloqueante).
- **KPIs básicos:** entreguei como a tabela de histórico já embutida na própria tela de disparo (destinatários/enviados/erros/status por item), não uma tela separada — a story não define nenhuma métrica adicional além dessas, e criar uma tela nova pra exibir os mesmos números seria escopo inventado, não pedido em nenhum AC.
- **Revalidação de template no momento do envio:** além da checagem na criação da fila (API), o worker revalida `status='aprovado' AND ativo=true` de novo antes de enviar — o template pode ter sido desativado/reprovado no intervalo entre a criação e o processamento (fila pode ficar pendente por minutos se houver outros itens na frente).
- **Validações:** `tsc --noEmit` (portal) — 0 erros nos arquivos novos/tocados (só os 4 erros pré-existentes de `.ts` em arquivos de teste, sem relação). `eslint` nos 4 arquivos tocados — 0 erros (1 warning pré-existente em `perfis/page.tsx`, não introduzido por esta mudança). `py_compile` em `campanhas_engine.py`/`main.py` — OK. Suíte Python completa: **362 passando** (355 pré-existentes + 7 novos desta story), mesmas falhas pré-existentes de ambiente (`openai`/`supabase` não instalados neste ambiente de teste — 2 arquivos de teste que importam `main.py` inteiro, sem relação com esta mudança) continuam isoladas, não regredidas.
- **CodeRabbit:** não executado (persona configura WSL; ambiente é Linux nativo) — gate efetivo = typecheck + lint + suíte de testes, todos limpos.
- **Migration aplicada diretamente em produção via MCP** (`cuca`, `svzkrkfzpiqcesloukgb`), conforme a exceção vigente de ambiente (banco único, sem cuca-dev) — arquivo `.sql` também versionado em `cuca-portal/supabase/migrations/` pro histórico.

## QA Results

**Revisor:** Quinn (@qa) · **Data:** 2026-08-21 · **Escopo:** só a correção `WORKER_SCOPE` (commit `49a9092`), não o restante da S-AE-09 (ainda não implementado).

### Verificação independente
- Confirmei por leitura direta do diff (`git show HEAD -- worker/main.py`) que o gate bate com o relatado: `WORKER_SCOPE` novo, default `"principal"`, só os 3 loops (`campanhas_loop`, `empregabilidade_notify_loop`, `ocr_pending_loop`) ficam condicionados.
- `grep` confirmou que `WORKER_SCOPE` não colide com nenhuma variável já usada no projeto (código, Dockerfile, `.env.example`), e que `campanhas_loop`/`empregabilidade_notify_loop`/`ocr_pending_loop` só são chamadas a partir de `startup_event` — sem endpoint HTTP nem script paralelo que os dispare por fora do gate.
- Confirmei no `Dockerfile` que o serviço roda com `gunicorn -w 1` (um único worker), então `startup_event` executa exatamente uma vez por processo — sem risco de condição de corrida entre workers do próprio Gunicorn.
- Rodei a suíte completa de novo, de forma independente (env com credenciais dummy, já que o `.env` local não tem chave real): **393 passaram**, as mesmas 5 falhas em `test_meta_adapter_outbound.py` (erro `ModuleNotFoundError: No module named 'worker'`, dentro do próprio arquivo de teste, nada a ver com `main.py`/`campanhas_engine.py`) — confirmado pré-existente, não é regressão desta mudança.
- Os 3 testes novos (`test_main_worker_scope.py`) testam o comportamento real via `asyncio.create_task` interceptado, não só "foi chamado" — cobrem os dois valores de `WORKER_SCOPE` (`principal` inicia os 3 loops, `academia_enem` não inicia nenhum).

### Achado (CONCERNS, não bloqueante para esta correção pontual, mas recomendo resolver antes do deploy da S-AE-02)
**Polaridade do gate é frágil para o `cuca-worker` (produção já rodando):** a condição é `if WORKER_SCOPE == "principal":` — ou seja, qualquer valor que NÃO seja exatamente a string `"principal"` desliga os 3 loops. Se, por engano no cadastro de variáveis do EasyPanel (o `cuca-worker` já em produção), a variável `WORKER_SCOPE` for setada com um valor vazio, com um typo, ou com capitalização diferente (`"Principal"`, `" principal"`, etc.) — cenário plausível, é entrada humana — os disparos do Institucional/Empregabilidade/Ouvidoria/Divulgação parariam de sair silenciosamente em produção (só um log INFO, nada que dispare alerta).

**Recomendação:** inverter a polaridade — testar pelo valor de opt-in (`if WORKER_SCOPE == "academia_enem":` desliga os loops, qualquer outra coisa, incluindo ausência/typo/vazio, mantém o comportamento atual ligado). Isso faz qualquer erro de configuração falhar a favor do comportamento já validado em produção, não contra ele — e o `cuca-worker`, que nem precisa dessa variável nova, fica protegido mesmo sem alguém lembrar de setá-la corretamente.

### Decisão de Gate
**CONCERNS.** A correção resolve exatamente o achado que motivou (comportamento por trás dos testes está certo, sem regressão), mas a direção do `if` cria um novo ponto único de falha silenciosa para os 4 módulos que já funcionam em produção. Não bloqueia esta correção pontual de ser válida, mas não deve seguir para o `@devops` sem esse ajuste de polaridade — é uma troca de uma linha (`==` invertido), risco de reintroduzir regressão é baixo, e o custo de não corrigir é alto (produção).

### Reverificação — 2026-08-21 (rodada 2)
Confirmei o ajuste de forma independente (`git show HEAD -- worker/main.py`, commit `00e7ce6`): o gate agora testa o valor de opt-in (`if WORKER_SCOPE == "academia_enem":` desliga; qualquer outro valor, incluindo ausente/vazio/typo/capitalização diferente, cai no `else` e mantém os 3 loops do `cuca-worker` ligados) — exatamente a inversão recomendada. Rodei a suíte de novo, do zero: `test_main_worker_scope.py` com 7 testes (os 3 originais + 4 novos parametrizados cobrindo `""`, `"Academia_Enem"`, `" academia_enem"`, `"typo-qualquer"`) — todos passando. Suíte completa: 397 passando, mesmas 5 falhas pré-existentes em `test_meta_adapter_outbound.py`, sem relação.

**Veredito atualizado: PASS.** Achado resolvido, sem regressão. Liberado para `@devops`.
