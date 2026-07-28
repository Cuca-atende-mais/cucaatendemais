# S-WM-58 — Painel de Acompanhamento de Envios: Visão de Entrega (leitura)

## Status
InReview — QA Gate: **CONCERNS** (2 achados relevantes: enforcement de permissão não confirmado com HTTP autenticado real de ponta a ponta; join por FK reversa omite 4 de 9 disparos pontuais reais do painel — ver QA Results). @devops não acionado, aguardando decisão de Junior.

## Origem
Pedido direto do Junior/sócio: um painel de acompanhamento de envios no portal, cobrindo os 4 motores de disparo (pontual, mensal/divulgação, ouvidoria, Academia Enem). Formalizado por @sm em 2026-07-28, após investigação de 2 pontos sinalizados como bloqueantes/relevantes antes de desenhar o escopo (ver "Achados de Investigação" abaixo). O pedido original foi dividido em **2 stories** por uma fronteira de dependência real encontrada na investigação — ver "Por que 2 stories" abaixo. Esta é a metade **não bloqueada**. A outra metade (controle: pausa/reenvio/limite) é a **S-WM-59**, bloqueada pelo Plano 008 (ainda não formalizado).

## Por que 2 stories, não 1

O pedido original tem 5 requisitos funcionais (ver Requisitos no pedido do Junior). Investigando a dependência real de cada um contra o que já existe em produção (S-WM-57, já `Done`) vs. o que só existiria depois do Plano 008 (ainda nem é story), a linha de corte não é "backend vs. frontend" — é **dado que já existe hoje vs. dado que só existirá depois do Plano 008**:

| Requisito | Depende de | Status hoje |
|---|---|---|
| Nova seção no menu + RBAC | Mecanismo de RBAC já existente (`has_permission`, `sys_permissions`, menu) | **Pronto pra usar hoje** |
| Painel por disparo (elegíveis/enviados/entregues/falhou) | `logs_disparo` (S-WM-57) | **Já em produção, populado** |
| Indicador de pausa + "quantos faltam" | Correção do Plano 008 (hoje um disparo pausado por `daily_limit` é marcado incorretamente como `"concluído"` — achado C do diagnóstico original da leva "Corrida da Juventude") | **Não existe** — mostrar isso hoje seria exibir dado errado |
| Botão "Reenviar pendentes" | Endpoint `/retomar-disparo/{origem}/{item_id}` do Plano 008 | **Não existe** |
| Seletor de limite diário por camada Meta | `meta_phone_numbers.messaging_limit_tier` populado (Plano 008) — hoje a coluna existe (`text`, `schema_producao.sql:1399`) mas nunca é escrita por nenhum código do repo | **Coluna existe, sempre `NULL`** |

Ou seja: **os 2 primeiros requisitos podem ser entregues e ter valor real para o sócio HOJE**, sem esperar o Plano 008 — o dado (`logs_disparo`) já existe e está correto para esse recorte (contagem de enviado/entregue/lido/falhou por disparo). Os 3 últimos requisitos **dependem literalmente de dado que não existe ainda** (não é só "código a escrever", é resultado de um outro trabalho — o Plano 008 — que precisa rodar em produção primeiro). Forçar tudo em 1 story só criaria uma story inteira bloqueada quando 40% dela não precisa estar. Splitar por essa fronteira real deixa o sócio ver progresso (visão de entrega) enquanto o Plano 008 é discutido/formalizado/implementado em paralelo, sem inventar uma divisão artificial de camada (que RBAC/UI/Ouvidoria já mostram que costumam ser entregues juntas neste projeto, não separadas por "backend"/"frontend").

## Complexidade
**M** — nova tela + rotas de API de leitura agregada + registro RBAC completo (recurso novo, checklist mecânico mas em vários arquivos). Sem mudança de schema (só leitura do que já existe).

## Prioridade
A definir pelo sócio/Junior — não é change de infraestrutura crítica, é visibilidade operacional.

## Story

**Como** Junior/sócio (responsável pelo CUCA),
**quero** ver, por disparo, quantos leads eram elegíveis, quantos foram enviados, quantos entregues e quantos falharam — nos motores pontual, ouvidoria e divulgação mensal,
**para que** eu tenha visibilidade real de entrega (não só "o HTTP teve sucesso") sem precisar pedir consulta SQL toda vez.

## Contexto e Problema

A S-WM-57 (em produção) criou o ledger `logs_disparo`, que grava por destinatário: `status` (`enviado`/`entregue`/`lido`/`falhou`/`apagada`/`aviso`), `wamid`, `erro`. Antes dela, não havia como saber se uma mensagem foi de fato entregue — só se o POST à Meta teve sucesso HTTP. Esse dado agora existe, mas só é acessível via consulta SQL direta (como as feitas durante a validação com envio real da S-WM-57). Não há nenhuma tela no portal que exponha isso.

## Achados de Investigação (relevantes para esta story e a S-WM-59)

### Achado 1 — Academia Enem: mecanismo separado, sem ledger, sem disparo em massa implementado (BLOQUEANTE — decisão do sócio necessária, não resolvido aqui)

Investigação confirmou: o Academia Enem **não compartilha nada** com os 3 motores cobertos por esta story.

- Provider diferente: AuctaFlux (API REST própria) em vez da Graph API da Meta direta via `worker/campanhas_engine.py`. Engine próprio: `worker/academia_enem_engine.py`, explicitamente isolado do `campanhas_engine.py` por decisão arquitetural documentada ("blindagem total do uazapi", `docs/stories/EPIC-Academia-Enem.md`).
- Tabelas próprias (`ae_instancias`, `ae_conversas`, `ae_mensagens`), não `logs_disparo`/`disparos`/`disparos_divulgacao`.
- **Não existe hoje nenhum ledger equivalente a `logs_disparo` para o Academia Enem.** `ae_mensagens` é log por mensagem individual, sem `disparo_id`/`disparo_divulgacao_id` (nenhuma chave de agrupamento por campanha), sem coluna `erro`, sem timestamp de status separado.
- **Mais importante: não existe disparo em massa implementado para o Academia Enem hoje.** O que existe e funciona é só envio conversacional 1:1 (saudação automática, atendimento manual). A função `enviarTemplate` (equivalente a `_enviar_template_meta`) existe no cliente AuctaFlux mas **não tem nenhum caller em todo o `cuca-portal/src/`** — está morta. As stories que cobririam isso (S-AE-09 — Disparo + Validador de Template, S-AE-10 — Classificador Disparo-vs-RAG) estão em `Draft`, nunca implementadas. O que existe na UI hoje são só 2 placeholders (`sessionStorage["ae_disparo_publico"]`, em `academia-enem/kpis/page.tsx` e `academia-enem/leads-publico/page.tsx`) preparando uma lista de contatos para um disparo que ainda não tem destino de código nenhum.

**Conclusão prática:** "cobrir Academia Enem" no painel de acompanhamento de envios não é uma tarefa de UI/leitura — é depender de duas stories inteiras (S-AE-09/S-AE-10) que nem começaram, mais um ledger que precisaria ser desenhado do zero (não dá pra reaproveitar `logs_disparo`, que está fisicamente amarrado a `disparo_id`/`disparo_divulgacao_id` do universo uazapi/Meta-via-campanhas_engine).

**Decisão confirmada por Junior (2026-07-28):** Academia Enem fica **fora de escopo** desta story e da S-WM-59, definitivamente nesta rodada — não abrir uma 3ª story agora. Registrado como **item futuro separado**, sem story própria enquanto o Academia Enem não tiver disparo em massa implementado (S-AE-09/S-AE-10, hoje `Draft`) e um ledger próprio desenhado — quando isso mudar, será uma iniciativa de desenho novo, não uma extensão mecânica desta story, já que o dado subjacente (`ae_mensagens`, sem chave de agrupamento por campanha) é estruturalmente diferente de `logs_disparo`.

### Achado 2 — RBAC existente: reaproveitável, com 2 alertas antes de implementar

O portal já tem um sistema de RBAC funcional e é exatamente isso que deve ser reaproveitado (não inventar mecanismo novo):

- Função canônica `has_permission(recurso, acao)` (`schema_producao.sql:514`), usada em RLS reais. Faz bypass total se `is_developer()` retornar true.
- Frontend: hook `useUser()` (`cuca-portal/src/lib/auth/user-provider.tsx`) expõe `hasPermission`/`isDeveloper`. Sidebar (`app-sidebar.tsx` + `constants.ts`) usa isso pra mostrar/esconder itens de menu.
- **Não existe uma tabela catálogo de "recursos/módulos"** — é tudo convenção manual em 2 arquivos: `cuca-portal/src/lib/constants.ts` (`menuItems`, o que aparece no menu) e `cuca-portal/src/app/(dashboard)/configuracoes/perfis/page.tsx` (`MODULE_GROUPS`, o que aparece na matriz de permissões pra admin conceder/revogar por perfil). Registrar um recurso novo = editar os 2 + RLS + (opcional) seed de `sys_permissions`.
- Precedente direto a seguir: módulo **Ouvidoria** (`ouvidoria_painel`, `ouvidoria_eventos`) — mesmo padrão de tamanho/formato que este painel.
- **Alerta 1 — RESOLVIDO (confirmado por Junior, 2026-07-28):** o bypass developer (`is_developer()` no banco + `DEVELOPER_EMAILS` no frontend, duplicado em ~16 arquivos) usa `valmir@cucateste.com` e **`dev.cucaatendemais@gmail.com`** (com **ponto**) — confirmado como correto, o underscore citado no pedido original era erro de digitação do Junior ao passar o e-mail, não um e-mail real divergente. **Sem nenhum ajuste de código necessário** — os 2 e-mails já estão exatamente na whitelist existente.
- **Alerta 2 (não bloqueante, registrado):** o `has_permission()` do backend casa `recurso` por **prefixo** (`LIKE p_recurso || '%'`), mas o `hasPermission()` do frontend casa por **igualdade exata**. Ao escolher o nome do novo `recurso` (ex.: `config_acompanhamento_envios`), evitar que ele seja prefixo de outro recurso existente ou vice-versa — checar contra a lista atual de `recurso`s em `constants.ts`/`MODULE_GROUPS` antes de nomear.
- Dado que o padrão developer (`valmir@cucateste.com` + `dev.cucaatendemais@gmail.com`, assumindo confirmação do e-mail) **já é o par default/histórico** que tem bypass total em `is_developer()` e em `DEVELOPER_EMAILS`, o requisito "esses 2 sempre têm acesso, sem precisar conceder manualmente" **já é satisfeito automaticamente, de graça**, sem nenhum código novo — não é uma feature a construir, é o comportamento que já existe pra esse par de e-mails em qualquer seção nova do sistema.

## Escopo

### IN
1. Novo recurso RBAC `config_acompanhamento_envios` (nome sujeito a checagem de colisão de prefixo, ver Achado 2): entrada em `menuItems` (`constants.ts`) sob "Configurações", entrada em `MODULE_GROUPS` (`perfis/page.tsx`), RLS de leitura na(s) view(s)/rota(s) usando `has_permission('config_acompanhamento_envios', 'read')`, seed de `sys_permissions` para os perfis que já devem ter acesso de saída (ex.: Super Admin Cuca), a decidir com Junior/@po quais perfis além do developer.
2. Nova tela `/configuracoes/acompanhamento-envios` (nome de rota a confirmar) listando disparos recentes dos 3 motores (`eventos_pontuais`/`ouvidoria_eventos` via tabela `disparos`; divulgação mensal via `disparos_divulgacao`), com, por disparo: total de destinatários elegíveis, total enviado, total entregue, total lido, total falhou/apagada — agregando `logs_disparo` por `disparo_id`/`disparo_divulgacao_id`, formato visual tipo "Meta Insights" (cards/barra de funil: elegíveis → enviados → entregues → falhou).
3. Filtro/seleção por motor (pontual/ouvidoria/divulgação) e por período.
4. Rota(s) de API no portal (Next.js, `cuca-portal/src/app/api/...`) fazendo a agregação — via RPC Postgres (seguindo o padrão já usado em `buscar_leads_por_categoria`, agregação no banco, não no client) ou via `.select()` com `count`/`group by` conforme couber melhor ao schema real; decisão de implementação fica com @architect/@dev na fase de design técnico.

### OUT
- Indicador de pausa por `daily_limit` + "quantos faltam" — S-WM-59 (bloqueada pelo Plano 008).
- Botão "Reenviar pendentes" — S-WM-59.
- Seletor de limite diário por camada Meta — S-WM-59.
- Academia Enem — fora de ambas as stories, decisão de escopo pendente do sócio (Achado 1).
- Qualquer mudança em `worker/` — esta story é só portal (leitura do que `logs_disparo` já grava).
- Popular `messaging_limit_tier`/`quality_rating` — Plano 008.

## Acceptance Criteria

1. **Given** um usuário com `has_permission('config_acompanhamento_envios', 'read') = true`, **when** acessa o menu Configurações, **then** vê a opção "Acompanhamento de Envios"; **given** um usuário sem essa permissão, **when** acessa o menu, **then** não vê a opção (nem a rota é acessível diretamente, RLS bloqueia).
2. **Given** os 2 e-mails developer confirmados (`valmir@cucateste.com` + e-mail exato da 2ª pessoa, a confirmar — ver Achado 2), **when** acessam a tela, **then** têm acesso total, sem necessidade de concessão manual de permissão — via `is_developer()`/`DEVELOPER_EMAILS` já existentes, não uma feature nova.
3. **Given** um disparo pontual/ouvidoria/divulgação mensal já concluído (com linhas em `logs_disparo`), **when** exibido no painel, **then** os números de elegíveis/enviados/entregues/falhou batem exatamente com uma contagem direta em `logs_disparo` para aquele `disparo_id`/`disparo_divulgacao_id` (validação cruzada via SQL na fase de QA).
4. **Given** a tela carregada, **when** inspecionada, **then** não exibe nenhum dado do Academia Enem (fora de escopo) nem nenhum controle de pausa/reenvio/limite (fora de escopo, é a S-WM-59).
5. Nenhuma tabela/coluna nova é criada — a story é só leitura agregada de `logs_disparo`/`disparos`/`disparos_divulgacao`, todas já existentes.

## Tasks / Subtasks

- [x] **Task 0a — E-mail do bypass developer confirmado** (AC: 2)
  - [x] Confirmado por Junior (2026-07-28): `dev.cucaatendemais@gmail.com` (com ponto) está correto — sem ajuste de código necessário.
- [x] **Task 0b — Confirmações pré-requisito** (AC: 2)
  - [x] Nome do recurso RBAC confirmado sem colisão de prefixo: `config_acompanhamento_envios` (checado contra todos os `module` distintos em `sys_permissions` antes de nomear).
  - [x] Acesso de saída: só `Super Admin Cuca` recebeu seed (mesmo padrão da migration `20260621000000_seed_sys_roles_super_admin.sql`) — demais perfis concedidos manualmente depois via `/configuracoes/perfis`, mesmo fluxo real do módulo Ouvidoria (não há seed automático pra outros perfis nesse projeto).
- [x] **Task 1 — Registro RBAC** (AC: 1, 2)
  - [x] `constants.ts`: item "Acompanhamento de Envios" adicionado ao array `items` de "Configurações".
  - [x] `perfis/page.tsx`: `config_acompanhamento_envios` adicionado a `MODULE_GROUPS`, categoria "Administração & Sistema" (mesma categoria dos demais `config_*`).
  - [x] Migration `20260728120000_swm58_acompanhamento_envios_rpc_rbac.sql` — seed de `sys_permissions` para `Super Admin Cuca`, aplicada em produção via MCP.
- [x] **Task 2 — Rota(s) de API de agregação** (AC: 3)
  - [x] RPC `listar_disparos_acompanhamento` (mesma migration acima) — agrega `logs_disparo` por `disparo_id`/`disparo_divulgacao_id`.
  - [x] `cuca-portal/src/app/api/configuracoes/acompanhamento-envios/route.ts` + `logic.ts` — GET, seguindo exatamente o padrão de `api/divulgacao/disparar` (checagem RBAC em TS antes do client admin, sem depender de RLS nas tabelas subjacentes).
- [x] **Task 3 — Tela do painel** (AC: 1, 3, 4)
  - [x] `cuca-portal/src/app/(dashboard)/configuracoes/acompanhamento-envios/page.tsx` — filtro por motor, funil elegíveis→enviados→entregues→falhou por disparo, shadcn `Card`/`Select`/`Badge`.
- [x] **Task 4 — Testes** (AC: 3, 5)
  - [x] `cuca-portal/tests/acompanhamento-envios-logic.test.ts` — 9 testes (`avaliarAcesso` + `validarFiltros`), mutation check em ambas as funções, sem exceção.
  - [x] RPC validada ao vivo em produção (read-only) contra dados reais antes de integrar na rota.
- [x] **Task 5 — Fechamento**
  - [x] `npm test` (vitest) e `node --test tests/*.test.ts` verdes; `tsc --noEmit` e `eslint` sem erro novo.
  - [x] File List e Change Log atualizados.
  - [x] Anunciado conclusão e recomendado @qa.

## Dev Notes

- Base de dados: `logs_disparo` (S-WM-57, em produção via PR#62 já mergeado), `disparos` (ledger de disparo pontual/ouvidoria), `disparos_divulgacao` (ledger de divulgação mensal).
- Precedente de RBAC seguido: módulo Ouvidoria para registro de menu/matriz de perfis (`constants.ts`/`perfis/page.tsx`) — mas **não** para RLS. Achado durante a implementação: `ouvidoria_eventos`/`ouvidoria_registros` têm RLS **permissiva pra qualquer autenticado** (`USING (true)`/`auth.uid() IS NOT NULL`), não `has_permission()` — o controle real de acesso do Ouvidoria é só o menu escondido no client. O mesmo já vale hoje pras 5 tabelas que este painel lê (`disparos`, `disparos_divulgacao`, `logs_disparo`, `eventos_pontuais`, `ouvidoria_eventos`) — confirmado ao vivo via `pg_policies`. Como adicionar uma policy `has_permission()` a essas tabelas **não restringiria nada** (Postgres faz `OR` entre policies permissivas do mesmo tipo de comando — a policy já existente continuaria liberando geral), o enforcement real do AC1 foi implementado seguindo o padrão de `api/divulgacao/disparar` em vez disso: checagem de `sys_permissions` em TypeScript (`logic.ts::avaliarAcesso`) antes da rota usar o client admin (que já contorna RLS). Isso é mais forte que o padrão do Ouvidoria, não mais fraco — sinalizando pro @qa não procurar uma policy `has_permission('config_acompanhamento_envios', 'read')` nas 5 tabelas, ela não existe nem faria sentido existir dado o estado atual da RLS ali.
- Agregação movida pro Postgres via RPC (`listar_disparos_acompanhamento`), conforme instruído — evita agregação client-side pesada.
- **Achado de schema durante a implementação:** `disparos.tipo` não distingue `eventos_pontuais` de `ouvidoria_eventos` de forma confiável (`worker/campanhas_engine.py:396` grava `tipo='mensal'` pra qualquer origem que não seja `eventos_pontuais`, incluindo ouvidoria) — o RPC usa a FK reversa (`eventos_pontuais.disparo_id`/`ouvidoria_eventos.disparo_id` apontando pra `disparos.id`) pra distinguir o motor corretamente, não a coluna `tipo`.
- **Achado de schema, tratado sem alterar dado real:** `ouvidoria_eventos.disparo_id` é `text`, enquanto `eventos_pontuais.disparo_id` é `uuid` — inconsistência pré-existente, não corrigida aqui (fora de escopo). O RPC faz cast explícito (`d.id::text`) só na comparação do `JOIN`.
- **Decisão de classificação de status** (documentada no comentário SQL da migration, revisar com @qa se faz sentido): `total_enviados` = `logs_disparo` com `status <> 'falhou'` (aceito com sucesso pela Meta, incluindo os já confirmados entregues/lidos); `total_entregues` = `status IN ('entregue','lido','apagada')` (`apagada` conta como entregue porque a mensagem chegou antes de ser apagada pelo destinatário); `total_falhou` = `status IN ('falhou','aviso')` (`aviso`/`warning` da Meta carrega código de erro, tratado como sinal de problema, não como entrega neutra).
- Nenhuma tabela/coluna nova criada (AC5) — só a função RPC (`listar_disparos_acompanhamento`) e o seed de `sys_permissions`, nenhum dos dois é tabela/coluna.
- Confirmado ao vivo (produção): 0 disparos de `ouvidoria_eventos` existem hoje (os 3 motores compartilham o único número `Institucional` ativo) — o painel funciona corretamente com esse filtro vazio, não é um bug.

### Testing
`node --experimental-strip-types --test tests/*.test.ts` (o diretório `tests/` não é coberto por `npm test`/vitest, que só inclui `src/**/*.test.ts` por config — mesma limitação pré-existente do arquivo `divulgacao-disparar-logic.test.ts`, não introduzida por esta story). 9 testes novos (`avaliarAcesso` + `validarFiltros`), mutation check em ambas as funções. Validação cruzada da RPC feita ao vivo (read-only) contra produção antes de integrar na rota — números batem com contagem direta em `logs_disparo`.

## Dependências
**Nenhuma dependência bloqueante.** Desenvolvida independente da S-WM-59/Plano 008 — nenhum arquivo de `worker/` tocado.

## Git workflow
Branch: `feat/painel-acompanhamento-envios`, a partir de `main` (já com PR#62/S-WM-57 mergeado). Commit local feito, sem push/PR — aguardando autorização (push/PR é exclusivo do @devops).

## File List
- `supabase/migrations/20260728120000_swm58_acompanhamento_envios_rpc_rbac.sql` (novo — aplicado em produção: RPC `listar_disparos_acompanhamento` + seed `sys_permissions` pra `Super Admin Cuca`)
- `cuca-portal/src/lib/constants.ts` (modificado: item "Acompanhamento de Envios" em `menuItems` → "Configurações")
- `cuca-portal/src/app/(dashboard)/configuracoes/perfis/page.tsx` (modificado: `config_acompanhamento_envios` em `MODULE_GROUPS`)
- `cuca-portal/src/app/api/configuracoes/acompanhamento-envios/logic.ts` (novo — `avaliarAcesso`, `validarFiltros`)
- `cuca-portal/src/app/api/configuracoes/acompanhamento-envios/route.ts` (novo — GET)
- `cuca-portal/src/app/(dashboard)/configuracoes/acompanhamento-envios/page.tsx` (novo — tela do painel)
- `cuca-portal/tests/acompanhamento-envios-logic.test.ts` (novo — 9 testes + mutation check)

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-28 | 0.1 | Story criada a partir de pedido do Junior/sócio (painel de acompanhamento de envios). Escopo dividido em 2 stories (esta + S-WM-59) pela fronteira real de dependência do Plano 008, encontrada durante investigação. 2 achados de investigação registrados (Academia Enem — bloqueante, decisão do sócio pendente; RBAC — reaproveitável, 2 alertas). @dev não acionado — aguardando validação do sócio. | @sm River |
| 2026-07-28 | 0.2 | 2 decisões de Junior incorporadas: (1) Academia Enem confirmado fora de escopo desta rodada, registrado como item futuro separado (sem story própria por ora); (2) e-mail do bypass developer confirmado como `dev.cucaatendemais@gmail.com` (o underscore do pedido original era erro de digitação) — Task 0 do e-mail marcada concluída, sem ajuste de código necessário. | @sm River |
| 2026-07-28 | 0.3 | Implementação completa em branch isolada `feat/painel-acompanhamento-envios` (a partir de `main`, já com PR#62/S-WM-57 mergeado). RPC `listar_disparos_acompanhamento` + seed RBAC aplicados em produção; registro RBAC no menu e na matriz de perfis; rota + página seguindo o padrão real de `api/divulgacao/disparar` (não o padrão RLS-`has_permission()` do Academia Enem, que não se aplica às tabelas subjacentes já permissivas). Achados de schema registrados nas Dev Notes (`disparos.tipo` não distingue motor, `ouvidoria_eventos.disparo_id` é `text` vs `uuid` em `eventos_pontuais`). 9 testes novos + mutation check em ambas as funções puras, sem exceção. `npm test`/`tsc --noEmit`/`eslint` sem erro novo. Status Draft → Ready for Review. | @dev Dex |
| 2026-07-28 | 0.4 | Gate de QA: **CONCERNS**. Enforcement de permissão confirmado extensivamente (dados reais, testes com mutation, estrutura de FK, HTTP real pro caso não-autenticado) mas **não** com uma chamada HTTP autenticada real de ponta a ponta (sem senha de usuário de teste disponível) — não atinge o padrão de certeza absoluta pedido para PASS neste ponto. Achado novo e mais concreto: o JOIN por FK reversa (`eventos_pontuais.disparo_id`/`ouvidoria_eventos.disparo_id`) **omite silenciosamente 4 de 9 disparos pontuais reais** do painel — achado não reportado pelo @dev. Advisor de segurança: 1 WARN (`function_search_path_mutable`), mas confirmado que é padrão pré-existente do projeto (`has_permission`/`is_developer`/`buscar_leads_por_categoria` têm o mesmo gap), não regressão desta story. Escopo confirmado limpo (8 arquivos). Status InReview. @devops não acionado. | @qa Quinn |

## QA Results

### Review Date: 2026-07-28

### Reviewed By: @qa Quinn

### Escopo deste gate

S-WM-58 completa (commit `0804893`, branch `feat/painel-acompanhamento-envios`). Não confiei em nenhum relato do @dev sem verificação própria — todos os pontos abaixo foram checados de forma independente (dados reais em produção, HTTP real quando possível, mutation checks reproduzidos do zero).

### 1. Enforcement de permissão — ponto mais sensível, verificado em profundidade, não 100% de ponta a ponta

**(a) Padrão real do Ouvidoria — CONFIRMADO independentemente (não por relato):**
```sql
-- ouvidoria_eventos / ouvidoria_registros, ao vivo em produção:
"Acesso total a eventos para autenticados" ON ouvidoria_eventos FOR ALL TO authenticated USING (true)
"Acesso total a registros para autenticados" ON ouvidoria_registros FOR ALL TO authenticated USING (true)
"Ouvidoria: Leitura restrita por unidade ou developer" ... USING (is_developer() OR unidade_cuca IS NULL OR unidade_cuca = get_my_unit() OR get_my_unit() IS NULL)
```
Confirmado: **é de fato o padrão real hoje**, não uma exceção nova — RLS permissiva pra qualquer autenticado, enforcement real só no menu/client. Também reconferi as 4 tabelas que este painel lê (`disparos`, `disparos_divulgacao`, `logs_disparo`, `eventos_pontuais`): todas têm policy permissiva equivalente (`auth.uid() IS NOT NULL` ou `true` para `authenticated`). Isso confirma que adicionar uma policy `has_permission()` a essas tabelas **não teria efeito nenhum** (Postgres faz `OR` entre policies permissivas do mesmo comando) — a decisão do @dev de não mexer em RLS e enforçar via TypeScript na rota está correta e é consistente com o único precedente real do projeto pra este tipo de dado (`api/divulgacao/disparar`).

**Achado colateral, não bloqueante mas relevante para o registro:** como essas 4 tabelas já são legíveis por qualquer usuário autenticado via RLS, um colaborador **sem** `config_acompanhamento_envios` pode, hoje, ler os mesmos dados diretamente via `supabase.from('logs_disparo').select('*')` no client, contornando a rota nova inteiramente. Isso **não é uma falha introduzida por esta story** — é uma característica pré-existente da RLS dessas tabelas, e corrigi-la exigiria uma iniciativa de hardening de RLS bem maior, fora de escopo aqui. Mas significa que o AC1 ("nem a rota é acessível diretamente, RLS bloqueia") só é literalmente verdadeiro pra visão **agregada** da rota nova — não pro dado bruto subjacente, que já não era protegido antes desta story. Registrando pra consciência de Junior, não como bloqueio.

**(b) Teste real, não só leitura de código:**
- Subi o servidor Next.js real (`npm run dev`) com URL/anon key reais de produção (obtidos via `get_project_url`/`get_publishable_keys`, sem tocar em `SUPABASE_SERVICE_ROLE_KEY`) e chamei `GET /api/configuracoes/acompanhamento-envios` sem nenhum cookie de sessão: **confirmei via HTTP real** — `307` redirecionando pra `/login`. Achado extra (não mencionado pelo @dev): isso acontece no **middleware da aplicação** (`src/middleware.ts`, matcher cobre `/api/*`), uma camada adicional de proteção **antes** até da própria checagem de `avaliarAcesso` da rota — o `401` que a rota devolveria sozinha é código correto, mas na prática inalcançável via browser normal porque o middleware já barra antes. Isso é comportamento consistente em todo o app (não introduzido por esta story), só não estava documentado nas Dev Notes.
- Consultei ao vivo em produção os dados reais que alimentam a checagem: um colaborador real com role `Gerente` (`pattyejunior2007@gmail.com`) **não tem** nenhuma linha em `sys_permissions` para `config_acompanhamento_envios` — receberia 403. Um colaborador real com role `Super Admin Cuca` (`valmirmoreirajunior@gmail.com`) **tem** `can_read = true` — receberia acesso. Também confirmei que as 2 relações de FK que o `select` aninhado do Supabase-js depende (`colaboradores.role_id → sys_roles`, `sys_permissions.role_id → sys_roles`) existem de fato — sem elas, o embedding do PostgREST simplesmente não funcionaria.
- **O que NÃO consegui confirmar**: uma chamada HTTP autenticada de verdade (login real de um usuário sem a permissão, batendo na rota, recebendo 403 via rede) — não tinha senha de nenhum usuário de teste disponível, e não fui atrás do `SUPABASE_SERVICE_ROLE_KEY` pra forjar uma sessão (ação maior do que o escopo deste gate justifica). Isso é uma lacuna real na verificação de ponta a ponta, não um achado de defeito — mas, seguindo a instrução explícita de Junior ("se não conseguir confirmar com certeza... não dê PASS"), não posso tratar isso como 100% confirmado.

**(c) Bypass dos 2 e-mails developer:** confirmado no código (`DEVELOPER_EMAILS` em `route.ts` inclui `valmir@cucateste.com` e `dev.cucaatendemais@gmail.com`, idêntico ao array já usado em produção por `api/divulgacao/disparar/route.ts`) — mesmo mecanismo, não uma cópia com erro de digitação. Não testado via login real pelo mesmo motivo do item (b).

### 2. Schema — achados do @dev confirmados, mais 1 achado novo

- **Confirmado**: `disparos.tipo` não distingue motor de forma confiável — dado real em produção mostra só os valores `pontual`/`mensal`, nenhuma distinção "ouvidoria". A FK reversa (`eventos_pontuais.disparo_id`/`ouvidoria_eventos.disparo_id`) é de fato a única forma correta de distinguir.
- **Confirmado**: `ouvidoria_eventos.disparo_id` é `text`, `eventos_pontuais.disparo_id` é `uuid` — o cast (`d.id::text`) na migration está correto e a função foi aplicada sem erro.
- **ACHADO NOVO, não reportado pelo @dev**: o `LEFT JOIN` por FK reversa **omite silenciosamente disparos reais** que não têm essa FK preenchida. Contagem direta em produção: `disparos` tem **10** linhas `tipo='pontual'`, mas só **5** têm alguma linha em `eventos_pontuais`/`ouvidoria_eventos` apontando de volta pra elas via `disparo_id` — **5 ficam de fora da RPC inteiramente** (1 delas é um disparo sintético de validação da própria S-WM-57, esperado ficar de fora; as outras **4 são disparos reais de produção** com `total_destinatarios` entre 2 e 4, perfeitamente elegíveis pra aparecer no painel). Investigando a causa raiz de 1 dos 4 (`evento_id = 3cb1226e-...`): a linha em `eventos_pontuais` existe, mas seu `disparo_id` aponta pra **outro** disparo (o de "Corrida da Juventude") — ou seja, `eventos_pontuais.disparo_id` guarda só o **último** disparo daquele evento, não um histórico; se o mesmo evento gerar mais de um `disparos` ao longo do tempo, todos exceto o mais recente ficam órfãos da FK reversa pra sempre. Não existe FK/constraint entre `disparos.evento_id` e `eventos_pontuais.id` (confirmado via `pg_constraint`), então a integridade referencial nem é garantida nos dois sentidos. **Efeito prático**: o painel "Visão de Entrega" — cujo propósito inteiro é visibilidade completa — está hoje omitindo ~44% dos disparos pontuais reais já existentes, sem nenhum sinal de que isso está acontecendo (não aparece como "motor desconhecido", simplesmente não aparece). Isso não é um problema de segurança nem quebra os números dos disparos que **são** exibidos (AC3 continua correto pra esses), mas é uma lacuna de completude real, reproduzida com dado real, que a story deveria tratar — ao menos com um fallback pra `disparos.tipo` + título genérico quando a FK reversa não encontrar nada, em vez de excluir a linha do `UNION ALL`.

### 3. Reprodução da suíte — independente

- `npm test` (vitest): `24 passed` (inclui os pré-existentes de `planilha-parser`, este painel não adiciona nada ali — confirma que `tests/acompanhamento-envios-logic.test.ts` **não é coberto por `npm test`**, é rodado só via `node --test`, mesma limitação pré-existente já documentada pelo @dev).
- `node --experimental-strip-types --test tests/*.test.ts`: **15 passed, 0 failed** (9 novos + 6 pré-existentes de `divulgacao-disparar-logic`).
- **Mutation checks reproduzidos de forma independente** (script próprio, não reaproveitei o do @dev): neutralizei a checagem de módulo em `avaliarAcesso` → 2 testes falharam corretamente; restaurado → suíte voltou a verde. Neutralizei a validação de motor em `validarFiltros` → 1 teste falhou corretamente; restaurado → suíte voltou a verde. Working tree confirmado limpo (`git status`) após cada restauração.
- `tsc --noEmit`: só os 2 erros já conhecidos/simétricos (`TS5097`, import com extensão `.ts` literal — mesmo em `divulgacao-disparar-logic.test.ts`, pré-existente, não introduzido aqui). `eslint`: 0 erros, 1 warning pré-existente em `perfis/page.tsx` não relacionado à linha editada.

### 4. Migration e agregação — confirmado ao vivo

- `list_migrations` confirma `20260728162027_swm58_acompanhamento_envios_rpc_rbac` como a mais recente.
- `listar_disparos_acompanhamento()` chamada ao vivo: `28 divulgacao + 5 pontual`, `0 ouvidoria` — bate exatamente com o relatado pelo @dev. Cross-check contra contagem direta nas tabelas base (não confiando só na RPC) confirma os mesmos números — **ver achado do item 2 acima sobre os 5 disparos pontuais fora do total de 10**.

### 5. Escopo — confirmado limpo

`git diff main..HEAD --stat`: exatamente os 8 arquivos esperados. Nenhum botão de reenvio, seletor de limite, referência a Academia Enem, ou arquivo de `worker/` tocado.

### 6. RLS / Advisors

- Security: **1 WARN** — `function_search_path_mutable` em `listar_disparos_acompanhamento`. Verificado que **não é regressão**: `has_permission`, `is_developer` e `buscar_leads_por_categoria` (funções canônicas do projeto) têm exatamente o mesmo `proconfig NULL` — padrão pré-existente em todo o projeto, não introduzido por esta story. Não bloqueante, mas seria bom endereçar num lote futuro (afeta várias funções, não só esta).
- Performance: 0 achados novos relacionados a `config_acompanhamento_envios` ou `listar_disparos_acompanhamento`.

### Limpeza

Removido `cuca-portal/.env.local` (criado só pra este teste de HTTP real, com URL/anon key públicos de produção — nunca continha a service role key). Confirmado gitignored e sem rastro no `git status`. Servidor `next dev` de teste finalizado.

### Gate Decision: CONCERNS

Não uso PASS pelos 2 motivos abaixo (nenhum dos dois bloqueia, mas nenhum permite certeza absoluta):

1. **Enforcement de permissão** — confirmado com dado real, testes com mutation, estrutura de FK e HTTP real pro caso não-autenticado, mas **não** com uma chamada HTTP autenticada de ponta a ponta (sem senha de usuário de teste disponível, não fui atrás da service role key pra contornar isso). Seguindo a instrução explícita de Junior, isso impede PASS neste ponto especificamente, mesmo com toda a evidência indireta apontando pra funcionamento correto.
2. **Achado novo de completude** — o JOIN por FK reversa omite 4 de 9 disparos pontuais reais do painel, silenciosamente. Não é falha de segurança nem dado errado nos disparos que aparecem, mas é uma lacuna real de completude num painel cujo propósito é exatamente visibilidade total.

Nenhum dos dois é "a feature não funciona" — os 3 motores aparecem, os números batem pros disparos exibidos, RBAC segue o único padrão real do projeto pra este tipo de dado. Mas não atingem o padrão de certeza pedido pra PASS.

### Pendências (não pular etapa)

- **Não acionar @devops.** Sem push, sem PR — aguardando decisão de Junior.
- Recomendação não bloqueante: adicionar fallback no `UNION ALL` da RPC pra disparos `tipo='pontual'`/`'mensal'` sem match de FK reversa (usar `d.tipo` + título genérico "(evento removido ou desvinculado)"), pra não perder histórico real silenciosamente.
- Recomendação não bloqueante: `SET search_path = public` na função nova (e, num lote futuro, nas demais que já têm o mesmo gap).
- Se Junior quiser confirmação end-to-end completa do item 1(b), precisa de uma senha de usuário de teste real (ex.: um dos e-mails de `sys_roles = 'Gerente'`/`'Institucional'`) ou autorização explícita pra usar a service role key e forjar uma sessão — nenhuma das duas foi feita neste gate.
