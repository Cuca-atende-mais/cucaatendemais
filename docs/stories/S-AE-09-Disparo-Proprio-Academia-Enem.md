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

**Correção dos achados de QA — Rodada 2 (2026-08-23):**
- `worker/campanhas_engine.py` (modificado) — A-1: `_gravar_breadcrumb_disparo` ganha parâmetro `agente_tipo` (default `"Institucional"`, preserva os 3 chamadores antigos), caller da Academia Enem passa `"academia_enem"`. A-3: novo `_fetch_all_telefones_tentados_academia_enem_sync`, `_fechar_disparo_academia_enem_cumulativo`, `reivindicar_retomada_academia_enem`, `continuar_retomada_academia_enem` — retomada manual de disparo pausado, mesmo padrão de `reivindicar_retomada_pontual`/`continuar_retomada_pontual`. A-4: guard explícito em `_processar_disparo_academia_enem_interno` — pausa (sem tentar nenhum envio) se o template aprovado exigir mais de 1 variável. `_processar_disparo_academia_enem_interno` ganha `contatos_override`/`usar_contagem_cumulativa` (reaproveitados pela retomada).
- `worker/main.py` (modificado) — novo endpoint `POST /academia-enem/disparo/{disparo_id}/retomar` (auth M2M via `WEBHOOK_INTERNAL_TOKEN`, claim síncrono + continuação em background — mesmo padrão de `/retomar-disparo/{origem}/{item_id}`).
- `worker/tests/test_campanhas_engine_academia_enem.py` (modificado) — +7 testes: guard de múltiplas variáveis (bloqueia e libera), `reivindicar_retomada_academia_enem` (404/409×2/sucesso), `continuar_retomada_academia_enem` (envia só pendentes por telefone, fecha com contagem cumulativa). Total do arquivo: 14 testes.
- `cuca-portal/src/app/api/academia-enem/disparo/route.ts` (modificado) — **A-2 (CRÍTICO, corrigido):** `resolverPublicoDefault` trocou `.in("id", ids)` pela RPC `buscar_leads_por_categoria` (mesma correção já validada em `_query_leads_sync`/2026-07-24); `resolverLeadIds` paginado em lotes de 200. **Bug adicional, achado durante a correção, autoinduzido nesta mesma story:** `CANAL_TIPO` estava `"AcademiaEnem"` (PascalCase) — mismatch real contra o valor canônico `"academia_enem"` (minúsculo/snake_case) usado em todo o resto do projeto (`developer/meta-numeros`, `meta_adapter_inbound.py`, `chat-sidebar.tsx`). Corrigido a constante **e** a linha já cadastrada em `meta_phone_numbers` (UPDATE direto via MCP, produção) — sem essa correção, o inbound real nunca rotearia pro engine certo (`agente_tipo` não batia com `"academia_enem"` no dispatch) e o painel de Atendimento (S-AE-03) nunca mostraria nada (`canal_tipo` não batia no filtro do `chat-sidebar.tsx`). A-4: validação simétrica na criação (rejeita com erro claro se o template tiver mais de 1 variável) + GET agora anota cada template com `suportado` (≤1 variável).
- `cuca-portal/src/app/api/academia-enem/disparo/[id]/retomar/route.ts` (criado) — proxy pro endpoint do worker, sempre via `WORKER_URL_ACADEMIA_ENEM` (nunca `WORKER_URL`), gated por `ae_disparo:update`.
- `cuca-portal/src/app/(dashboard)/academia-enem/disparo/page.tsx` (modificado) — templates não suportados (>1 variável) aparecem desabilitados no Select; botão "Reenviar pendentes" na tabela de histórico pra disparos `pausada`/`pausada_limite_diario` (gated por `ae_disparo:update`).

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
| 2026-08-23 | @qa (Quinn) | **QA Rodada 2 (feature completa) → CONCERNS.** 7 ACs verificados com evidência; 4 achados (A-1 a A-4, ver QA Results). Recomendado corrigir A-2 (paginação — mesma classe de bug já documentada em `_query_leads_sync`) antes do @devops. Status Ready for Review→InReview. |
| 2026-08-23 | @dev (Dex) | **Correção de todos os achados (A-1 a A-4), a pedido do Junior — sem ambiente de testes disponível, decisão de corrigir tudo agora e validar quando o disparo valendo acontecer.** A-1: `agente_tipo` parametrizado em `_gravar_breadcrumb_disparo`. A-2: `resolverPublicoDefault` migrado pra RPC `buscar_leads_por_categoria`; `resolverLeadIds` paginado (lotes de 200). A-3: retomada manual completa (worker + endpoint + rota do portal + botão). A-4: guard simétrico (rejeita/pausa template com >1 variável, não inventa suporte a múltiplas variáveis). **Achado adicional, fora dos 4 reportados:** `meta_phone_numbers.agente_tipo`/`canal_tipo` da Academia Enem estavam cadastrados como `"AcademiaEnem"` (PascalCase, autoinduzido nesta mesma sessão) — mismatch real contra o valor canônico `"academia_enem"` usado em todo o resto do projeto; sem essa correção o bot nunca responderia a mensagem real nem apareceria no painel de Atendimento. Corrigido via `UPDATE` direto em produção (MCP) + a constante equivalente na rota. **Investigação de observabilidade** (pedido do Junior, não construído): confirmado que o painel dedicado "Acompanhamento de Envios" (S-WM-58/S-WM-59) não cobre a Academia Enem hoje — a RPC `listar_disparos_acompanhamento` só tem 2 CTEs (`disparos`/`disparos_divulgacao`); adicionar a Academia Enem é uma 3ª CTE, viável porque a fila desta story já reaproveita `logs_disparo` (ao contrário do que a investigação original da S-WM-58 previu). Registrado como story futura, não construído agora. Suíte: 369 passando (+14 na Academia Enem). Status InReview→Ready for Review. |
| 2026-08-23 | @qa (Quinn) | **QA Rodada 3 (verificação da correção) → CONCERNS.** A-1 a A-4 e o bug de `canal_tipo` confirmados corrigidos (inclusive verificado ao vivo no banco). 1 achado novo (B-1, MEDIUM, reproduzido empiricamente): retomada que pausa de novo grava totais locais em vez de cumulativos — sem risco de duplicidade, só de exibição errada. Não bloqueante. Status Ready for Review→InReview. |
| 2026-08-23 | @dev (Dex) | **Correção do B-1, a pedido do Junior.** Extraído `_contar_totais_academia_enem_cumulativo` + novo `_resolver_totais_para_gravar`, aplicado nos 2 pontos de pausa (teto diário, taxa de erro) — agora leem o total real de `logs_disparo` quando a chamada vem de uma retomada, em vez do contador local. Teste novo reproduz o cenário exato do achado (100 já enviados, retomada pausa de novo, grava 100 e não 0). Suíte: 370 passando. |
| 2026-08-23 | @qa (Quinn) | **QA Rodada 4 (verificação do B-1) → PASS.** Correção verificada de forma independente: sem custo extra no caminho fresco, sem corrida entre os `inserts` do ledger e a recontagem, teste de regressão real (não tautológico). Ciclo completo de QA desta story (Rodadas 1-4) encerrado sem achados pendentes. **Liberado para `@devops`.** |

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

---

## QA Results — Rodada 2 (feature completa)

**Revisor:** Quinn (@qa) · **Data:** 2026-08-23 · **Escopo:** implementação completa da fila/tela/público/envio (commit `a241092`) — a correção `WORKER_SCOPE` já revisada na Rodada 1 não foi reexaminada aqui.

### Verificação independente
- Li o diff completo (`git show a241092`), não só o resumo do @dev.
- Rodei a suíte Python de novo, do zero: **362 passando** (355 pré-existentes + 7 novos), mesmas 3 falhas de ambiente pré-existentes (`openai`/módulos ausentes neste ambiente de teste, isoladas em `test_main_retomar_disparo.py`/`test_main_worker_scope.py`, sem relação com esta mudança).
- `tsc --noEmit`/`eslint` independentes nos arquivos novos do portal: 0 erros.
- Migration: confirmei o schema real de `disparos_academia_enem` e as 4 policies de `disparos_academia_enem` **diretamente no banco de produção** (`execute_sql`/`pg_policies`) — batem exatamente com o `.sql` do commit, RLS keyed a `has_permission('ae_disparo', ...)` em vez de role-name (evita repetir o achado C-1 da S-AE-07). `get_advisors(security)`: nenhum novo alerta pra esta tabela.
- Segui o dado até o consumidor real, não só o arquivo alterado (regra de análise de impacto): rastreei `agente_tipo`/`origem_id` através de `chat-sidebar.tsx` e `meta_adapter_inbound.py` pra confirmar o achado A-1 abaixo, e contei o volume real de leads tagueados "Academia Enem" em produção pra confirmar o achado A-2 (0 hoje — dormant, não visível nos testes/demo atual).

### Rastreabilidade dos ACs
| AC | Resultado | Evidência |
|----|-----------|-----------|
| 1 — sem template aprovado → aviso claro, não disparo | ✅ PASS | GET retorna `aviso`; tela mostra card de alerta e desabilita o formulário |
| 2 — envia + breadcrumb por conversa | ✅ PASS | `test_envia_para_todos_grava_ledger_e_breadcrumb_so_com_lead_id`; leitura do código confirma `_enviar_template_meta`/`logs_disparo`/`_gravar_breadcrumb_disparo` |
| 3 — sem público → default tag Academia Enem | ⚠️ **PASS só na escala atual (0 leads tagueados) — ver A-2** | Mecanismo correto, mas quebra na escala real que a própria S-AE-13 existe para alimentar |
| 4 — dedup por telefone entre fontes | ✅ PASS | `dedupPorTelefone` aplicado sempre antes de gravar a fila |
| 5 — sem `ae_disparo:create` → bloqueado | ✅ PASS | Gate server-side real na API (`checkAuth`), não só UI |
| 6 — teto diário contido, não ignorado | ✅ PASS (envio) / ⚠️ **ver A-3 (retomada)** | `test_teto_diario_atingido_pausa_com_totais_parciais`; contagem enxerga a própria fila (3º bloco) |
| 7 — status refletido via webhook sem código novo | ✅ PASS | Confirmado por leitura: `processar_webhook_meta` faz `UPDATE logs_disparo ... WHERE wamid=X` sem filtrar por FK |

### Achados

**A-1 (LOW, não bloqueante, pré-existente — não introduzido por esta story):** `_gravar_breadcrumb_disparo` (compartilhada, não tocada neste diff) hardcoda `"agente_tipo": "Institucional"` ao criar uma `conversa` nova. Pros 3 chamadores já existentes (eventos_pontuais/ouvidoria/divulgação) isso é inofensivo por coincidência — o número deles É o Institucional. Pra Academia Enem (número próprio), um lead que nunca teve conversa e nunca responde ao aviso fica com `agente_tipo="Institucional"` numa conversa cujo `origem_id` é o número da Academia Enem. **Rastreei o consumidor real antes de reportar:** os painéis (Institucional e Academia Enem) filtram por `origem_id`/`canal_tipo` via `chat-sidebar.tsx`, não por `agente_tipo` — então isso **não** aparece no painel errado. E assim que o lead responde de verdade, `meta_adapter_inbound.py` sobrescreve `agente_tipo` com o valor correto vindo de `meta_phone_numbers`. Impacto real: só inconsistência de dado num registro dormente, sem efeito funcional observado. Registro como débito de limpeza (corrigir a função compartilhada pra aceitar `agente_tipo` como parâmetro), não bloqueante.

**A-2 (MEDIUM-HIGH, achado real com precedente confirmado no próprio projeto):** `resolverPublicoDefault()` (GET e POST) faz `admin.from("leads").select(...).in("id", ids)` com **todos** os ids de `lead_interesses` da categoria "Academia Enem", sem paginação nem RPC. Esse é exatamente o mesmo padrão de falha que o próprio `worker/campanhas_engine.py::_query_leads_sync` documenta ter corrigido em 2026-07-24 (URL do GET do PostgREST estoura o limite do gateway com centenas de ids, resposta vem corpo vazio/inválido, quebra o parse JSON no cliente) — ali a correção foi trocar por uma RPC (`buscar_leads_por_categoria`) que só manda os poucos UUIDs de categoria, nunca a lista de leads. Aqui o padrão antigo (pré-correção) foi reintroduzido copiando o mesmo formato já usado em `academia-enem/leads/route.ts` (S-AE-08, também com esse mesmo problema, já mergeada). **Por que importa pra ESTA story especificamente:** o AC#3 (default = tag Academia Enem) é exatamente o caminho que dispara essa query — e o volume real que o módulo existe para atender é o CSV de 7.950 linhas (`docs/envio-enem-pontual/jovens-enem-ajust01.csv`, referenciado na própria S-AE-13). Confirmei ao vivo no banco de produção: **0 leads tagueados hoje** — por isso os testes e a demo atual não revelam o problema; ele fica dormente até o primeiro upload real da planilha via S-AE-13, quando quebra a tela inteira (GET falha ao carregar `publico_default_count`, POST falha ao montar o público default).
**Recomendação:** aplicar a mesma correção já validada no projeto — paginar em lotes (~200, como já faz `academia-enem/leads/upload/route.ts`) ou criar uma RPC equivalente a `buscar_leads_por_categoria` pro contexto do portal. Não bloqueia a demo atual (0 leads), mas bloqueia o uso real do módulo — a S-AE-13 (import da planilha) e a S-AE-09 (disparo) juntas são precisamente o cenário que reproduz a falha já documentada no próprio código.

**A-3 (MEDIUM, gap de escopo não coberto por nenhum AC, mas real):** quando o teto diário pausa um disparo (`pausada_limite_diario`), não existe nenhum mecanismo de retomada — nem reclaim automático (a RPC `claim_disparo_academia_enem` só pega `status='pendente'`), nem endpoint/botão manual (diferente de `retomar_disparo_pausado`/`reivindicar_retomada_pontual`, que os fluxos de eventos_pontuais/divulgação já têm). Os destinatários que não foram tentados ficam presos indefinidamente até alguém resetar o status manualmente no banco. Criar um disparo novo pro mesmo público não é seguro como contorno: o dedup desta story é só dentro da criação de UM disparo, não entre disparos diferentes — reenviar pra quem já recebeu no disparo pausado é um risco real de duplicidade. Nenhum AC pede retomada explicitamente, então não trato como FAIL — mas como a story cita `disparos_divulgacao`/S-WM-60 como referência de padrão de envio, vale registrar que esse pedaço do padrão não foi replicado.

**A-4 (LOW-MEDIUM, risco a confirmar amanhã):** o envio só preenche uma variável (`nome`) no template — `_montar_parametros_named(variaveis_item, [nome_contato])`. Se o template que for aprovado amanhã tiver mais de 1 variável (outros templates do projeto têm até 6), o envio vai falhar silenciosamente pra 100% do público (HTTP 400 da Meta, contabilizado como erro, sem crash) porque as posições além da 1ª não recebem valor. Não é um bug em si — a story não define quantas variáveis o template tem — mas é uma dependência direta da call de amanhã que vale confirmar antes de usar em produção.

### Decisão de Gate
**CONCERNS.** Nenhum AC falha na escala e no cenário de teste/demo atual — a suíte automatizada e a verificação manual confirmam os 7 ACs. Mas A-2 é um achado real, não hipotético (mesma classe de bug já documentada e corrigida uma vez neste projeto, confirmada contra o volume de dado real que a própria S-AE-13 existe para importar) que vai quebrar a funcionalidade central desta story assim que o módulo for usado de verdade — não é um "nice to have", é o caminho default do AC#3. Recomendo **corrigir A-2 antes do @devops** (troca pequena e localizada — mesma solução já pronta em `buscar_leads_por_categoria` a reaproveitar/adaptar). A-1, A-3 e A-4 ficam documentados como débito/risco conhecido, não bloqueantes — A-4 vale confirmar na call de amanhã antes de considerar o módulo pronto pra uso real.

---

## Correção dos achados — 2026-08-23 (@dev, a pedido do Junior)

Junior pediu correção de **todos** os achados agora (sem ambiente de testes disponível pra validar ponta-a-ponta com tráfego real — decisão explícita de já deixar tudo pronto/documentado pra quando o disparo valendo acontecer), mais uma investigação de paridade de controle/observabilidade com a Divulgação.

### A-1 — corrigido
`_gravar_breadcrumb_disparo` ganhou o parâmetro `agente_tipo` (default preserva os 3 chamadores antigos). O caller da Academia Enem passa `"academia_enem"` explicitamente.

### A-2 — corrigido
`resolverPublicoDefault` passou a usar a RPC `buscar_leads_por_categoria` (mesma correção já validada em `_query_leads_sync`, 2026-07-24) em vez de `.in("id", ids)`. `resolverLeadIds` (público manual) paginado em lotes de 200.

### A-3 — corrigido
Retomada manual completa: `reivindicar_retomada_academia_enem`/`continuar_retomada_academia_enem` no worker (mesmo padrão de `reivindicar_retomada_pontual`), endpoint `POST /academia-enem/disparo/{id}/retomar`, rota proxy no portal (`ae_disparo:update`, via `WORKER_URL_ACADEMIA_ENEM`), botão "Reenviar pendentes" na tela. Pendentes calculados por **telefone** (não lead_id — corrige um caso que o próprio lead_id nulo deixaria passar batido).

### A-4 — corrigido (mitigado, não "resolvido" no sentido de suportar múltiplas variáveis)
Guard simétrico (API de criação + worker no momento do envio): template com mais de 1 variável é **rejeitado com erro claro**, não falha silenciosamente. GET anota cada template com `suportado` — o Select da tela desabilita os não suportados. **Isso não implementa preenchimento de múltiplas variáveis** (não inventei isso, não foi pedido) — só transforma uma falha silenciosa em um bloqueio explícito e diagnosticável. Se o template de amanhã tiver mais de 1 variável, vai ser necessário desenvolvimento adicional (capturar os dados das variáveis extras por contato — hoje só `nome` existe) antes de disparar de verdade.

### Achado adicional, fora dos 4 reportados — bug crítico autoinduzido, corrigido
Durante a correção do A-2, ao conferir o valor canônico de `canal_tipo`/`agente_tipo` da Academia Enem contra o resto do projeto, achei que `meta_phone_numbers.agente_tipo`/`canal_tipo` (cadastrados por mim nesta mesma sessão, antes da S-AE-09 começar) estavam como `"AcademiaEnem"` (PascalCase) — **errado**. O valor canônico usado em todo o resto do código (`developer/meta-numeros/page.tsx`, `worker/meta_adapter_inbound.py` linha 942, `academia-enem/mensagens/page.tsx`) é `"academia_enem"` (minúsculo/snake_case). Com o valor errado: (a) o dispatch real de mensagem recebida nunca bateria o `elif agente_tipo == "academia_enem":` — o bot nunca responderia a nenhuma mensagem real; (b) o painel de Atendimento (S-AE-03) nunca mostraria nenhuma conversa (filtro por `canal_tipo` no `chat-sidebar.tsx` não bateria). **Corrigido com um `UPDATE` direto em produção** (via MCP) na linha já cadastrada, e a constante equivalente em `academia-enem/disparo/route.ts` (que copiava o mesmo valor errado) também corrigida. Sem esta correção, o webhook que você acabou de configurar receberia mensagens mas o bot nunca responderia — acharia que "não funcionou" sem saber por quê.

### Controle e observabilidade — investigação (não construído, conforme pedido)
Existe hoje um painel dedicado — **"Acompanhamento de Envios"** (`/configuracoes/acompanhamento-envios`, S-WM-58/S-WM-59) — com visão por disparo (elegíveis/enviados/entregues/falhou) e botão "Reenviar pendentes", já usado por Institucional/Ouvidoria/Divulgação. Ele lê da RPC `listar_disparos_acompanhamento`, que **hoje só cobre 2 fontes** (`disparos` e `disparos_divulgacao`) — **não inclui `disparos_academia_enem`**.
Quando esse painel foi desenhado (2026-07-28), a Academia Enem foi **explicitamente excluída** porque não existia disparo em massa implementado nem um ledger equivalente pra ela (ver `docs/stories/S-WM-58-...md`, "Achado 1"). **Isso mudou**: a S-AE-09 desenhou a fila nova reaproveitando `logs_disparo` (a mesma tabela que o painel já lê), com a FK `disparo_academia_enem_id` — ou seja, adicionar a Academia Enem a esse painel hoje é uma 3ª CTE na RPC (mesmo formato das outras 2), não mais um redesenho do zero.
**Não construí isso agora** — o pedido foi só avisar. Recomendo abrir uma story pequena (`listar_disparos_acompanhamento` +1 CTE, mais liberar a Academia Enem no filtro `motor` do front) quando quiserem essa visão unificada; até lá, o histórico embutido na própria tela de disparo (`/academia-enem/disparo`) cobre o mínimo (destinatários/enviados/erros/status + retomada).

### Validação
Suíte Python: **369 passando** (355 base + 14 da Academia Enem, incluindo os 7 novos de retomada/guard). `tsc --noEmit`/`eslint` limpos em todos os arquivos tocados/criados nesta correção. Migration não mudou (nenhuma alteração de schema nesta rodada — só código + 1 correção de dado via UPDATE).

---

## QA Results — Rodada 3 (verificação da correção)

**Revisor:** Quinn (@qa) · **Data:** 2026-08-23 · **Escopo:** commit `786f16e` (correção de A-1 a A-4 + fix do `canal_tipo`/`agente_tipo`) — não reexaminei os 7 ACs originais (já cobertos na Rodada 2), só a correção em si.

### Verificação independente
- Reli o diff completo (`git show 786f16e`), não só o changelog do @dev.
- Rodei a suíte de novo, do zero: **369 passando**, 0 regressão.
- `tsc --noEmit`/`eslint` independentes nos 7 arquivos tocados: limpos.
- **Conferi o `UPDATE` em produção diretamente** (`execute_sql`): `meta_phone_numbers.agente_tipo`/`canal_tipo` = `academia_enem` (minúsculo), confirmado — o achado crítico foi de fato corrigido, não só relatado.
- Segui o dado até o consumidor real pra validar cada achado (não só reli o código alterado):

| Achado | Correção | Verificação |
|---|---|---|
| A-1 | `agente_tipo` parametrizado, default preserva os 3 chamadores antigos | ✅ Confirmado no diff + teste (`agente_tipo="academia_enem"` explícito no caller novo) |
| A-2 | RPC `buscar_leads_por_categoria` + paginação em lotes de 200 | ✅ Mesma RPC já validada no projeto; sem `.in()` sem paginação em nenhum dos 2 pontos |
| A-3 | Retomada manual completa (worker + endpoint + rota + botão) | ✅ Presente e funcional nos testes — **mas ver achado B-1 abaixo** |
| A-4 | Guard simétrico (API + worker), rejeita template com >1 variável | ✅ Confirmado — não inventou suporte a múltiplas variáveis, só parou a falha silenciosa |
| Extra (`canal_tipo`) | UPDATE em produção + constante corrigida | ✅ Confirmado ao vivo no banco |

### Achado novo (B-1, MEDIUM — não bloqueante, mas real)

**Reproduzi empiricamente** (script isolado, fora da suíte, chamando `_processar_disparo_academia_enem_interno` diretamente): quando uma **retomada** (`usar_contagem_cumulativa=True`) é pausada de novo — por teto diário ou por taxa de erro — **antes** de esgotar os pendentes, os 2 pontos de pausa (`pausada_limite_diario` e `pausada` por erro) gravam `total_enviados`/`total_erros` usando só os contadores **locais desta chamada**, não a contagem cumulativa real. Só o caminho de sucesso total (`concluida`) e o caminho "sem contatos pendentes" usam `_fechar_disparo_academia_enem_cumulativo`.

**Efeito concreto:** disparo original envia 100, pausa por teto diário (`total_enviados=100`, correto — é a 1ª execução). No dia seguinte, retomada envia mais 50 e pausa de novo por teto diário → grava `total_enviados=50` (sobrescrevendo os 100 anteriores), quando o real é 150. **Não é um risco de duplicidade** — o dedup da retomada (`_fetch_all_telefones_tentados_academia_enem_sync`) lê direto de `logs_disparo`, não da coluna `total_enviados`, então ninguém recebe 2x. É um problema de **exibição/observabilidade**: o número que aparece na tela fica errado exatamente no cenário mais provável de acontecer de verdade (número recém-pareado, tier baixo, teto batendo em dias seguidos) — e é justamente a métrica que você pediu pra garantir que existisse.

**Por que não veio coberto pelos testes:** os 7 testes novos de retomada cobrem o caminho feliz (retomada conclui) e os 4 casos de `reivindicar_retomada` (404/409×2/sucesso) — nenhum cobre "retomada que pausa de novo".

**Recomendação:** os 2 branches de pausa (`pausada_limite_diario`, `pausada` por erro) devem checar `usar_contagem_cumulativa` e, se `True`, ler os totais reais de `logs_disparo` antes de gravar — mesmo princípio já usado no caminho de sucesso, só falta aplicar aos 2 caminhos de pausa. É uma mudança pequena e localizada (mesmo padrão, 2 lugares a mais).

### Decisão de Gate
**CONCERNS.** Os 4 achados originais (A-1 a A-4) e o bug crítico de `canal_tipo` estão genuinamente corrigidos e verificados — inclusive o mais grave (sem ele, o módulo simplesmente não funcionaria). B-1 é uma correção pequena, isolada, sem risco de segurança/duplicidade — só afeta a precisão do número exibido num cenário específico (retomada que pausa de novo). Dado que vocês vão validar isso na prática só quando o disparo valendo acontecer (sem ambiente de teste agora), não bloqueia — mas registro pra não ser esquecido antes desse momento.

---

## Correção do B-1 — 2026-08-23 (@dev, a pedido do Junior)

Extraído `_contar_totais_academia_enem_cumulativo` (helper único, reaproveitado por `_fechar_disparo_academia_enem_cumulativo` e pelo novo `_resolver_totais_para_gravar`). Os 2 pontos de pausa (`pausada_limite_diario`, `pausada` por taxa de erro) agora chamam `_resolver_totais_para_gravar(disparo_id, sucessos, erros, usar_contagem_cumulativa)` — quando vem de uma retomada, relê o total real de `logs_disparo` antes de gravar, em vez do contador local desta chamada. Caminho fresco (não-retomada) continua idêntico (usa o contador local, sem round-trip extra ao banco).

**Teste novo que reproduz o cenário exato do B-1** (`test_retomada_que_pausa_de_novo_grava_totais_cumulativos_nao_locais`): disparo com 100 já enviados no histórico, retomada pausa de novo imediatamente (teto zerado) — antes da correção gravaria `total_enviados=0`; depois, grava `100` (o real). Suíte: **370 passando** (369 + 1 novo). `py_compile` OK.

Status: mantido `InReview` — aguardando @qa reverificar esta correção específica antes de liberar pro @devops.

---

## QA Results — Rodada 4 (verificação do B-1)

**Revisor:** Quinn (@qa) · **Data:** 2026-08-23 · **Escopo:** commit `8da3c23` (correção do B-1) — os demais achados já foram verificados nas Rodadas 2/3.

### Verificação independente
- Reli o diff completo (`git show 8da3c23`), não só o resumo do @dev.
- Rastreei a chamada nos 2 pontos de pausa (teto diário e taxa de erro): ambos agora passam por `_resolver_totais_para_gravar`, que só faz o round-trip extra a `logs_disparo` quando `usar_contagem_cumulativa=True` (ou seja, só numa retomada) — confirmei que o caminho fresco (disparo novo, não-retomada) continua idêntico a antes, sem custo extra.
- Confirmei que a ordem de execução é segura: o guard de pausa (`i >= daily_limit`) roda **antes** de processar o item `i`, e a checagem de taxa de erro roda **depois** do `insert` em `logs_disparo` do item corrente — em ambos os casos, todos os `inserts` referentes aos itens já processados nesta chamada já foram concluídos (`await`) antes da recontagem, então o valor lido de `logs_disparo` no momento da pausa reflete a realidade, sem corrida.
- Rodei a suíte de novo, do zero: **370 passando**, 0 regressão. O teste novo (`test_retomada_que_pausa_de_novo_grava_totais_cumulativos_nao_locais`) reproduz o cenário exato do achado (histórico real de 100, retomada pausa de novo, grava 100 — não 0) e é uma regressão real, não tautológica (o mock distingue claramente valor local de valor cumulativo).
- `py_compile` OK.

### Decisão de Gate
**PASS.** B-1 corrigido corretamente, sem efeitos colaterais no caminho não-retomada, com teste de regressão real cobrindo o cenário exato. Não há achados pendentes desta rodada.

### Resumo do ciclo completo (Rodadas 1-4)
Todos os achados levantados nas 4 rodadas de QA desta story estão corrigidos e verificados de forma independente: gate `WORKER_SCOPE` (Rodada 1), A-1 a A-4 + bug crítico de `canal_tipo`/`agente_tipo` (Rodadas 2-3), e B-1 (Rodada 4). **Liberado para `@devops`.**
