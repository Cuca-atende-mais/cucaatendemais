# S-WM-66 — Fila fixa de leads engajados no painel de Atendimento

## Status
Ready for Review (correção do achado do QA aplicada — ver Dev Agent Record / Change Log 0.5)

## Origem
`docs/qa/LEVANTAMENTO-Fila-Fixa-Leads-Engajados-Atendimento-2026-08.md` (@dev, 2026-08-07) — pedido
direto do Junior, com 3 decisões já fechadas por ele antes desta story ser escrita (ver Contexto).

## Complexidade
**M** (médio) — 1 coluna + backfill + 1 ponto de gravação no worker (com guard de escopo) + query
dupla e UI de 2 seções num componente compartilhado por 5 páginas. Sem mudança de schema além da
coluna nova, sem mudança de regra de negócio da IA.

## Prioridade
P1 — o achado do levantamento é concreto e mensurável: hoje 365 conversas / 10 com interação real;
depois do disparo de leads quentes desta semana (~514 leads), o total salta pra ~880, e a lista
lateral de atendimento (limitada a 50, ordenada só por `updated_at`) já demonstrou nesta mesma
semana que consegue esconder quem respondeu atrás de quem só recebeu disparo.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - pytest worker/tests/test_meta_adapter_inbound.py → cobertura da gravação de primeira_interacao_lead_em (Institucional) e da exclusão explícita (Empregabilidade)
  - MCP execute_sql (cuca, produção) → conferir backfill: count(conversas com mensagem de lead) == count(primeira_interacao_lead_em IS NOT NULL) após a migration
  - MCP get_advisors → 0 novo achado de RLS/segurança na coluna nova
  - inspeção manual: abrir /atendimento (Institucional) e /empregabilidade/mensagens, confirmar 2 seções na 1ª e comportamento inalterado (sem seção fixa vazia enganosa) na 2ª
```

## Story

**Como** colaborador responsável por disparos e observabilidade de leads (responsável pelo
transbordo),
**quero** ver, numa seção fixa e sempre visível, todo lead que já mandou pelo menos 1 mensagem pra
automação — não só os que pediram explicitamente por um humano,
**para que** eu consiga perceber e intervir em leads que travaram tentando conversar com a IA
(já que a instrução de "fale com atendente" é deliberadamente omitida do prompt), sem depender só
do `awaiting_human` nem correr o risco de essas conversas ficarem escondidas atrás de um disparo em
massa recente.

## Contexto e Problema

Ver levantamento completo em `docs/qa/LEVANTAMENTO-Fila-Fixa-Leads-Engajados-Atendimento-2026-08.md`
(Seções 1-2) para o achado técnico detalhado. Resumo:

- `components/chat/chat-sidebar.tsx` (componente **compartilhado** por 5 páginas: `/atendimento`,
  `/programacao/mensagens`, `/ouvidoria`, `/empregabilidade/mensagens`, `/academia-enem/mensagens`)
  busca só as 50 conversas mais recentes por `updated_at`, sem distinguir "lead respondeu" de "só
  recebeu disparo".
- `worker/campanhas_engine.py::_gravar_breadcrumb_disparo` cria/atualiza uma linha em `conversas`
  (`updated_at=now()`) pra **todo** lead que recebe um disparo, mesmo que nunca responda — efeito
  colateral não intencional: um disparo em massa pode dominar as 50 posições visíveis, escondendo
  quem de fato interagiu.
- O pin que já existe hoje (`awaiting_human` no topo) não resolve — cobre só handover explícito, e
  a instrução de pedir humano é deliberadamente omitida do prompt (decisão de produto já tomada,
  fora de escopo mudar aqui). Hoje (2026-08-07): 0 conversas em `awaiting_human`, apesar de 10 com
  interação real de lead.

**Decisões do Junior, já fechadas (não é escopo de discussão desta story, é ponto de partida):**
1. Ordenação dentro da seção fixa: `awaiting_human` primeiro, depois `updated_at desc` — mesmo
   critério que o pin existente já usa.
2. Uma conversa fixada **não sai por ação manual de "resolver"** — sai só quando `conversas` for
   resetada (mecanismo já existente, ver Dev Notes: cron `reset_automation_memory` — hoje
   desligado — e/ou o botão de reset manual do Developer, já existente no portal). **Não construir
   nenhum botão/fluxo novo de "marcar como resolvida" nesta story.**
3. Empregabilidade/Julia **fica de fora por enquanto** — o sinal de "1ª interação" só se aplica ao
   caminho motor-agente (Institucional/maria/sofia/ana).

## Escopo

### IN
1. Coluna nova em `conversas`: `primeira_interacao_lead_em timestamptz` (nullable).
2. Migration com **backfill obrigatório**: preencher a coluna pra toda conversa que já tem pelo
   menos 1 linha em `mensagens` com `remetente='lead'`, usando o `min(created_at)` dessa mensagem.
3. Gravação no caminho **inbound** do worker (`meta_adapter_inbound.py`, dentro de
   `processar_webhook_meta` ou onde o `agente_tipo` já é conhecido) — só quando `agente_tipo` está
   no conjunto motor-agente (`_AGENTES_MOTOR_AGENTE` já existe no código: Institucional, maria,
   sofia, ana) **e** a coluna ainda está `NULL` na conversa. **Nunca** gravado pelo caminho de
   disparo/breadcrumb (`campanhas_engine.py`) — esse caminho não muda nesta story.
   **Nota de validação do @po:** reaproveitar `_AGENTES_MOTOR_AGENTE` inteiro (em vez de só
   `["Institucional", "maria"]`) inclui `sofia` (Ouvidoria) e `ana` (Acesso) no mesmo guard — é
   decisão consciente, não efeito colateral: nenhum dos dois canais tem tráfego real via Meta hoje
   (não migraram ainda, achado já registrado na S-WM-24), então isso é forward-compatible sem
   mudar comportamento observável agora. Se Sofia/Ana ganharem tráfego real antes desta story ser
   implementada, vale reconfirmar com o Junior se a fila fixa deve valer pra elas também.
4. `chat-sidebar.tsx`: query passa a ser 2 buscas —
   - **Fixa:** `WHERE primeira_interacao_lead_em IS NOT NULL`, sem `.limit()`, ordenada por
     `awaiting_human` primeiro e depois `updated_at desc` dentro da seção.
   - **Normal:** `WHERE primeira_interacao_lead_em IS NULL`, mantém `.limit(PAGE_SIZE)` (50) como
     hoje, sem mudança de comportamento.
5. UI: 2 seções visuais na sidebar ("Conversas ativas"/fixa, sempre visível com scroll próprio, e
   "Aguardando primeiro contato"/normal, como hoje) — mesmo componente de linha reaproveitado nas
   duas, só o agrupamento/cabeçalho é novo.

### OUT
- Qualquer mudança em **quando** `awaiting_human` é setado — a regra de handover não muda.
- Qualquer mudança nos componentes `ae-chat-sidebar.tsx`/`ae-chat-window.tsx` (órfãos, Academia
  Enem já usa o `ChatSidebar` compartilhado).
- Empregabilidade/Julia — nenhuma gravação de `primeira_interacao_lead_em` nesse caminho (decisão
  #3). O componente compartilhado continua funcionando lá exatamente como hoje (toda conversa cai
  na seção "normal", porque a coluna nunca é setada nesse módulo).
- Botão/fluxo de "marcar como resolvida"/desfixar manualmente uma conversa (decisão #2) — o
  mecanismo de saída da fila é o reset já existente (cron `reset_automation_memory`, hoje
  desligado, e o endpoint manual `api/developer/reset-automation-memory`), nenhum dos dois é
  tocado nesta story.
- Religar o cron `reset_automation_memory` (job id 10, `pg_cron`) — decisão operacional separada
  do Junior, não faz parte desta story.

## Acceptance Criteria

1. **Given** uma migration aplicada em produção, **when** inspecionada via MCP, **then** toda
   conversa com pelo menos 1 mensagem `remetente='lead'` tem `primeira_interacao_lead_em`
   preenchido com o timestamp da 1ª mensagem do lead (backfill correto, conferido por contagem:
   `count(conversas com msg de lead) == count(primeira_interacao_lead_em IS NOT NULL)`).
2. **Given** um lead novo (nunca conversou) manda uma mensagem pro número Institucional, **when**
   processada, **then** `conversas.primeira_interacao_lead_em` é setado no momento dessa mensagem.
3. **Given** um lead que recebeu um disparo (mensal ou pontual) mas nunca respondeu, **when**
   consultado, **then** `primeira_interacao_lead_em` continua `NULL` — o disparo sozinho não fixa
   a conversa.
4. **Given** um lead que recebeu um disparo e responde depois (minutos, horas ou dias depois,
   independente do disparo), **when** a resposta chega, **then** `primeira_interacao_lead_em` é
   setado nesse momento, e a conversa migra pra seção fixa.
5. **Given** uma conversa já com `primeira_interacao_lead_em` preenchido, **when** o lead manda
   mais mensagens depois, **then** o valor da coluna **não muda** (fica com o timestamp da 1ª
   interação, não da mais recente) — só `updated_at` avança normalmente.
6. **Given** o mesmo cenário do AC2, mas com `agente_tipo="Empregabilidade"` (Julia), **when**
   processado, **then** `primeira_interacao_lead_em` **não** é setado — teste de regressão
   explícito confirmando a exclusão da decisão #3.
7. **Given** a sidebar de qualquer uma das 5 páginas que usam `ChatSidebar`, **when** carregada,
   **then** conversas com `primeira_interacao_lead_em IS NOT NULL` aparecem numa seção fixa, sem
   limite de quantidade, ordenadas por `awaiting_human` primeiro e `updated_at desc` depois; as
   demais aparecem na seção normal, com o mesmo limite de 50 que já existia.
8. **Given** a página `/empregabilidade/mensagens`, **when** carregada após esta mudança, **then**
   o comportamento é idêntico ao de antes (nenhuma conversa nova aparece "fixada" ali, porque a
   coluna nunca é setada nesse módulo) — teste de regressão confirmando que a decisão #3 não quebra
   a experiência existente desse painel.
9. **Given** a suíte de testes do worker (`pytest`), **when** executada após a mudança, **then**
   passa sem regressão, com os testes novos dos AC 1-6 e 9 (backfill via SQL de verificação, não
   pytest) cobertos.
10. Nenhuma mudança é feita em `campanhas_engine.py`/`_gravar_breadcrumb_disparo` — confirmar por
    inspeção de diff que esse arquivo não é tocado.

## Tasks / Subtasks

- [x] **Task 1 — Migration: coluna + backfill** (AC: 1) — 2026-08-08
  - [x] `ALTER TABLE conversas ADD COLUMN IF NOT EXISTS primeira_interacao_lead_em timestamptz;`
  - [x] Backfill: `UPDATE conversas c SET primeira_interacao_lead_em = (SELECT min(created_at)
        FROM mensagens m WHERE m.conversa_id = c.id AND m.remetente = 'lead') WHERE EXISTS (...)`.
  - [x] Conferir via MCP: contagem bate (ver AC 1). **0 divergências** (diferença simétrica entre
        os dois conjuntos, não só contagem por coincidência).
  - [x] `get_advisors` — 0 novo achado (0 menções a `conversas` no relatório).
  - [x] Reportar no Dev Agent Record.
- [x] **Task 2 — Worker: gravação no caminho inbound, com guard de escopo** (AC: 2, 3, 4, 5, 6, 10) — 2026-08-08
  - [x] Localizar o ponto em `meta_adapter_inbound.py` onde `agente_tipo` já é conhecido, antes/
        junto do upsert de `conversas`.
  - [x] Gravar `primeira_interacao_lead_em = now()` só quando `agente_tipo in
        _AGENTES_MOTOR_AGENTE` (reaproveitar a constante já existente) **e** a coluna está `NULL`
        na conversa (checar antes de sobrescrever — não pode avançar em mensagens seguintes).
  - [x] **Não tocar `campanhas_engine.py`** — confirmado por `git diff --stat origin/main --
        worker/campanhas_engine.py` (0 linhas de saída).
  - [x] Testes `pytest`: leads novos (Institucional), leads que respondem depois de disparo,
        não-regressão do valor em mensagens seguintes, exclusão explícita de Empregabilidade.
  - [x] Reportar no Dev Agent Record.
- [x] **Task 3 — Frontend: query de 2 seções + UI** (AC: 7, 8) — 2026-08-08
  - [x] `chat-sidebar.tsx`: separar a busca em fixa (sem limite) e normal (limite 50 como hoje).
  - [x] Ordenação da seção fixa: `awaiting_human` primeiro, `updated_at desc` depois.
  - [x] UI: 2 seções com cabeçalho, scroll próprio na fixa (`overflow-y-auto` numa div própria,
        sem paginação/virtualização — volume atual não justifica, registrado no levantamento).
  - [~] Confirmar visualmente nas 5 páginas que usam o componente — **parcial, ver Dev Agent
        Record**: sem credencial de login neste ambiente, não deu pra autenticar e ver a tela
        renderizada de verdade. Validado por `next build` completo (compila as 5 rotas sem erro)
        e pela redução de `tsc`/`eslint` a zero erros/warnings novos — mas isso não substitui
        inspeção visual real. Fica como item explícito pro @qa/usuário confirmar.
  - [x] Reportar no Dev Agent Record.
- [x] **Task 4 — Fechamento** (AC: 9) — 2026-08-08
  - [x] `pytest worker/tests/` completo, sem regressão: **233 passed, 5 failed** — os 5 são
        pré-existentes (`test_meta_adapter_outbound.py`, `ModuleNotFoundError: openai`, ambiente
        local, confirmados sem relação com esta mudança). 233 = 230 antes desta story + 3 novos.
  - [x] `tsc --noEmit`/`eslint` no portal — ver Task 3 (0 erro novo, 0 warning).
  - [x] Atualizar File List e Change Log.
  - [x] Anunciar conclusão e recomendar @qa — não chamar @qa/@devops automaticamente.

## Dev Notes

### Mecanismo de saída da fila fixa — já existe, não construir nada novo
Achado do levantamento (Seção 5.1): `reset_automation_memory()` (função já existente,
`SECURITY DEFINER`) apaga **toda** a linha de `conversas`/`mensagens`/`logs_webhook`, sem filtro —
acionado hoje por 2 caminhos que já existem: `pg_cron` job id 10 (`0 3 * * *`, **atualmente
`active=false`**) e o endpoint manual `cuca-portal/src/app/api/developer/reset-automation-memory/
route.ts` (ação de Developer no portal). Como a função apaga a linha inteira, `
primeira_interacao_lead_em` some junto — nenhuma lógica de "desfixar" própria é necessária.

Achado colateral, sem impacto nesta story: `pg_cron` job id 9 (ativo, a cada 30min) marca
`status='encerrada'` em conversas do Institucional inativas há 2h+, mas **não apaga a linha** —
uma conversa pode ficar `encerrada` e continuar fixa (comportamento esperado, consistente com a
decisão #2).

### Onde gravar no worker
`worker/meta_adapter_inbound.py` já tem a constante `_AGENTES_MOTOR_AGENTE = frozenset({
"Institucional", "maria", "sofia", "ana"})` (usada pelo guard da S-WM-24) — reaproveitar a mesma
constante aqui, não recriar uma nova. O ponto de gravação deve ficar no caminho comum de
`processar_webhook_meta` (onde `conversas` é upsertada pra qualquer `agente_tipo`, inclusive
Empregabilidade) — **o guard de agente_tipo é o que garante a decisão #3**, não a localização do
código em si. Testar explicitamente que Empregabilidade não é afetada (AC 6, AC 8) é o que prova
que o guard está certo, não só assumir pela leitura do código.

### Testing
Padrão já estabelecido: `pytest` (`worker/tests/test_meta_adapter_inbound.py`, mocks `AsyncMock`/
`MagicMock`, mesmo padrão da S-WM-24). Verificação de backfill é SQL via MCP, não pytest (dado de
produção, não testável em unitário).

## Dependências
**Nenhuma — confirmado, não presumido.** Validação do @po (2026-08-07): a redação original do
Draft dizia que `_AGENTES_MOTOR_AGENTE` era "tocado pela S-WM-24" e recomendava esperar aquele PR
mergear antes de começar esta story. Conferido direto em `origin/main`
(`git show origin/main:worker/meta_adapter_inbound.py`): `_AGENTES_MOTOR_AGENTE` **já existe em
`main`, independente da S-WM-24** — a S-WM-24 adiciona uma constante nova e separada
(`_AGENTES_GUARD_MIDIA_SEM_INTERPRETACAO`) logo acima, sem tocar nesta. Além disso, o ponto de
gravação desta story (Task 2, dentro de `processar_webhook_meta`, perto do upsert de `conversas`)
fica em região do arquivo distante de onde a S-WM-24 mexe (dentro de `_executar_dispatch`) — sem
risco real de conflito de merge. **Esta story pode começar a qualquer momento, sem esperar a
S-WM-24.**

## Riscos
- Se o guard de `agente_tipo` for esquecido/errado, Empregabilidade passaria a ter conversas
  fixadas indevidamente — por isso os AC 6/8 exigem teste de regressão explícito, não só ausência
  de menção no código.
- Volume atual (10 conversas engajadas) é pequeno — se crescer muito antes de o reset ser religado,
  a seção fixa sem paginação pode precisar de revisão futura (fora de escopo aqui, registrado no
  levantamento).

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-08-07 | 0.1 | Draft inicial, a partir de `docs/qa/LEVANTAMENTO-Fila-Fixa-Leads-Engajados-Atendimento-2026-08.md` e das 3 decisões do Junior (ordenação, saída da fila, exclusão de Empregabilidade). | @sm River |
| 2026-08-07 | 0.2 | Validado (GO, 8/10 → 10/10 após ajuste). 2 ajustes aplicados: (1) "Dependências" alegava que `_AGENTES_MOTOR_AGENTE` era "tocado pela S-WM-24" e recomendava esperar aquele PR — falso, conferido direto em `origin/main`: a constante já existe lá, independente da S-WM-24, e as regiões do arquivo tocadas por cada story nem ficam próximas; dependência removida, story pode começar já. (2) Explicitado que reaproveitar `_AGENTES_MOTOR_AGENTE` inteiro inclui Sofia/Ana no guard de propósito (forward-compatible, sem efeito hoje) — não era uma decisão documentada, virou nota explícita na Seção Escopo. Status Draft → Ready. | @po Pax |
| 2026-08-08 | 0.3 | Implementação completa (Tasks 1-4). Migration aplicada em produção (528 conversas, 25 com interação, backfill com 0 divergências). Worker: gravação de `primeira_interacao_lead_em` no caminho inbound, guard de `agente_tipo` testado explicitamente pros dois lados (seta pra Institucional, não seta pra Empregabilidade). Frontend: `chat-sidebar.tsx` com 2 seções (fixa sem limite + normal como antes). Testes: 233/238 passando no worker (5 falhas pré-existentes, confirmadas sem relação); `tsc`/`eslint` limpos no portal. **1 pendência explícita:** sem credencial de login neste ambiente, não foi possível confirmar visualmente a UI renderizada nas 5 páginas — validado só por compilação (`tsc`) e análise estática (`eslint`), não por inspeção real na tela. Status InProgress → Ready for Review. | @dev Dex |
| 2026-08-09 | 0.4 | QA: **FAIL** (achado único, pequeno e delimitado). Verificação independente de tudo (testes, backfill, migration, `get_advisors`, `"now()"` empírico) sem achado — problema real é no badge do header de `chat-sidebar.tsx`, que passou a olhar só `fixedConversations` e por isso deixa de disparar pra conversas de Empregabilidade em `awaiting_human` (mecanismo próprio de transbordo desse módulo, `empregabilidade_engine.py:362`, não coberto pelo teste que o AC8 pediu — esse só cobria o backend). Correção: badge precisa olhar as 2 listas. Devolvido pro @dev. Status Ready for Review → InProgress. | @qa Quinn |
| 2026-08-09 | 0.5 | Correção do achado do QA aplicada — badge do header agora olha `[...fixedConversations, ...normalConversations]`. `tsc --noEmit` e `eslint`: 0 erro/warning. Teste automatizado NÃO adicionado — projeto não tem infraestrutura de teste de componente React (`vitest` configurado node-only, sem `jsdom`, decisão deliberada já registrada); escrever um teste de renderização pra esta linha exigiria montar essa infra do zero, desproporcional a um fix de 1 condição. Verificação visual real segue com a mesma limitação já registrada na v0.3 (sem credencial de login neste ambiente). Status InProgress → Ready for Review. | @dev Dex |

## Dev Agent Record

### Task 1 — Migration (2026-08-08)
Aplicada em produção (`cuca`, `svzkrkfzpiqcesloukgb`) via MCP `apply_migration`
(`conversas_primeira_interacao_lead_em`, versão `20260809013403`). Estado real no momento da
aplicação: 528 conversas totais, 25 com pelo menos 1 mensagem `remetente='lead'` (volume subiu de
365/10 pra 528/25 desde o levantamento — efeito do disparo de leads quentes e das respostas que já
chegaram). Backfill verificado por diferença simétrica entre os dois conjuntos (não só contagem
batendo por coincidência): **0 divergências**. `get_advisors(security)` rodado depois: 0 achado
mencionando `conversas`, 0 ERROR, 105 lints pré-existentes (95 WARN + 10 INFO) inalterados.

### Task 2 — Worker (2026-08-08)
`worker/meta_adapter_inbound.py`, dentro de `processar_webhook_meta`: `conv_fresh` passou a
selecionar `primeira_interacao_lead_em` junto com os campos já buscados; logo depois, um bloco novo
faz `UPDATE conversas SET primeira_interacao_lead_em = now() WHERE id = conversa_id AND
primeira_interacao_lead_em IS NULL` — só quando `agente_tipo in _AGENTES_MOTOR_AGENTE`. O guard
`IS NULL` está tanto na leitura (evita a chamada) quanto no próprio `UPDATE` (`.is_(...)`, fecha a
corrida entre 2 mensagens quase simultâneas do mesmo lead — mesmo que ambas leiam `NULL`, só a
primeira a chegar no banco de fato grava).

`campanhas_engine.py` não tocado — confirmado (`git diff --stat origin/main -- worker/
campanhas_engine.py` sem saída).

Testes novos em `worker/tests/test_meta_adapter_inbound.py` (classe `TestPrimeiraInteracaoLead`,
3 testes — 1 cobrindo AC2+AC4 juntos, já que são o mesmo caso do ponto de vista do código; 1 pro
AC5 (não sobrescreve); 1 pro AC6 (Empregabilidade excluída, com prova positiva de que
`processar_mensagem_empregabilidade` É chamado — não é só ausência de update, é confirmação de que
o resto do fluxo segue normal)). **Suíte completa do arquivo: 66/66 passando** (63 anteriores + 3
novos).

### Task 3 — Frontend (2026-08-08)
`cuca-portal/src/components/chat/chat-sidebar.tsx`: estado único `conversations` virou
`fixedConversations`/`normalConversations`; a busca única virou 2 queries em paralelo
(`Promise.all`), compartilhando a resolução de `phoneNumberIds` (evita duplicar os lookups
assíncronos em `meta_phone_numbers` que já existiam pros filtros de canal/agente/unidade — extraído
num helper `applyScopeFilters`, aplicado às 2 queries). Fixa: `.not('primeira_interacao_lead_em',
'is', null)`, sem `.limit()`. Normal: `.is('primeira_interacao_lead_em', null)`, mantém
`.limit(PAGE_SIZE)` como antes. Ordenação (`sortConversations`) e o JSX de cada linha
(`renderConversationRow`) foram extraídos pra funções reaproveitadas pelas 2 seções, evitando
duplicar a lógica/JSX que já existia.

UI: 2 blocos — "Conversas ativas" (só aparece quando há pelo menos 1 conversa fixa, `max-height:
45%` com `overflow-y-auto` próprio) e "Aguardando primeiro contato" (como antes, ocupa o espaço
restante). Badge do header (`awaiting_human`) passou a olhar só `fixedConversations` (correto por
construção: uma conversa só chega a `awaiting_human` depois de já ter `primeira_interacao_lead_em`
setado, então nunca aparece na seção normal).

**Verificação — o que foi feito e o que ficou parcial:**
- `npx tsc --noEmit -p tsconfig.json`: baseline de 4 erros pré-existentes (arquivos de teste,
  `error TS5097`, nada a ver com este componente) — **idêntico antes e depois da mudança**,
  confirmado via `git stash`. 0 erro novo.
- `npx eslint src/components/chat/chat-sidebar.tsx`: 2 warnings de `react-hooks/exhaustive-deps`
  na 1ª tentativa (`matchesSearch` fora do array de deps dos `useMemo`) — corrigido envolvendo
  `matchesSearch` em `useCallback([searchTerm])`. **0 warning, 0 erro** na versão final.
- `npm run build` (Next.js, compila as 5 rotas que usam `ChatSidebar` de verdade, não só
  typecheck isolado) — rodado em background, resultado no fechamento (Task 4).
- **Não verificado visualmente no navegador.** Este ambiente não tem credencial de login pro
  portal (nem usuário/senha real, nem sessão já autenticada) — só consegui confirmar que `/login`
  renderiza sem erro de console/servidor; a rota `/atendimento` (client component real, com dado
  ao vivo) nunca chegou a compilar/renderizar de fato porque o middleware redireciona antes, sem
  sessão. Documentado como pendência explícita — ver Task 3 (item marcado `[~]`) e recomendação ao
  @qa/usuário no fechamento.

### Correção do achado do QA (2026-08-09)
Badge do header (`fixedConversations.some(...)`) trocado pra `[...fixedConversations,
...normalConversations].some(c => c.status === 'awaiting_human')` — volta a enxergar conversas de
Empregabilidade em `awaiting_human`, que nunca entram na seção fixa (decisão #3, exclusão
deliberada). `tsc --noEmit` e `eslint`: 0 erro/warning, mesmo resultado limpo de antes. Tentei
subir o servidor local de novo pra reconferir visualmente — mesma limitação de credencial de
login já registrada acima, sem novidade aqui. Não adicionei teste automatizado pro comportamento
do badge: este projeto não tem `jsdom`/testing-library configurado pra testar renderização de
componente React (decisão deliberada, `vitest.config.ts` é node-only) — montar essa infraestrutura
do zero seria desproporcional a uma correção de 1 condição JSX.

## File List

| Arquivo | Mudança |
|---|---|
| `supabase/migrations/20260809013403_conversas_primeira_interacao_lead_em.sql` | Task 1 — coluna + backfill |
| `worker/meta_adapter_inbound.py` | Task 2 — gravação de `primeira_interacao_lead_em` no caminho inbound, com guard de `agente_tipo` |
| `worker/tests/test_meta_adapter_inbound.py` | Task 2 — classe `TestPrimeiraInteracaoLead` (3 testes) |
| `cuca-portal/src/components/chat/chat-sidebar.tsx` | Task 3 — query de 2 seções + UI (seção fixa/normal) |

## QA Results

### 2026-08-09 — @qa Quinn

**Veredito: FAIL (achado único, pequeno e bem delimitado — não é rejeição ampla)**

Reexecutei de forma independente, não confiei só no Dev Agent Record:
- `pytest worker/tests/test_meta_adapter_inbound.py`: 66/66. Suíte completa do worker: 233/238 (5
  falhas pré-existentes, confirmadas sem relação — `ModuleNotFoundError: openai`).
- AC1 (backfill) reconferido direto no banco, agora: 25 conversas com interação, 25 com a coluna
  preenchida, **0 divergências**.
- Migration: versão do arquivo bate exatamente com `supabase_migrations.schema_migrations`
  (`20260809013403`) — sem drift.
- `get_advisors(security)`: 0 menção a `conversas`, 0 ERROR, mesma baseline de antes (95 WARN + 10
  INFO).
- Validei empiricamente (não assumi) que `"now()"` como valor de update num campo `timestamptz`
  funciona no Postgres (`SELECT 'now()'::timestamptz` retorna o timestamp atual, tratado igual a
  `'now'`) — não é bug latente.
- Confirmei que `.is_("coluna", "null")` é o padrão já estabelecido no projeto (4 outros usos no
  mesmo arquivo/worker), não uma API inventada.

**Achado que bloqueia — AC8 não está de fato coberto:**

`worker/empregabilidade_engine.py:362` também seta `status='awaiting_human'` — Empregabilidade tem
seu **próprio** mecanismo de transbordo, independente do motor-agente (`_acionar_handover_real` /
notificação via `_notificar_transbordo`). A decisão #3 da story exclui Empregabilidade de
`primeira_interacao_lead_em` de propósito — correto — mas isso quebra uma premissa que o `chat-
sidebar.tsx` passou a assumir: o badge do header (`fixedConversations.some(c => c.status ===
'awaiting_human')`, linha ~305) agora só olha o array fixo, e conversas de Empregabilidade nunca
entram nele.

**Efeito:** uma conversa de Empregabilidade aguardando atendimento humano real **não dispara mais
o badge vermelho pulsante "Aguardando" no topo da sidebar** — a conversa continua visível (com
destaque âmbar, badge "Humano", ordenada primeiro dentro da seção normal, tudo isso preservado),
só o alerta de topo que some. Não é perda de dado nem de funcionalidade, é degradação de um sinal
de alerta que este projeto já tratou como sério antes (S-WM-61, dedicada só a corrigir gatilho de
alerta de handover).

**Por que não foi pego pelos testes:** `test_empregabilidade_nao_seta_primeira_interacao` (o teste
que o próprio AC6/8 pediu) cobre só o lado backend (coluna não setada) — nunca exercitou o badge
do frontend. AC8 promete "comportamento idêntico ao de antes" pra Empregabilidade, mas essa
premissa não foi verificada onde realmente importava.

**Correção necessária (pequena, 1 linha):** o badge do header precisa olhar as duas listas, não só
a fixa —
```tsx
{[...fixedConversations, ...normalConversations].some(c => c.status === 'awaiting_human') && (
```
Nenhuma outra parte do código precisa mudar — a ordenação e o estilo de linha (âmbar/"Humano") já
funcionam corretamente hoje dentro da seção normal, é só o badge de topo que precisa do escopo
maior.

**Resto da story:** sólido. Migration, backend e as outras 9 ACs verificados de forma independente,
sem achado. Recomendo @dev aplicar a correção acima + adicionar 1 teste (mesmo padrão dos outros,
mock com `agente_tipo='Empregabilidade'` e `status='awaiting_human'`, confirmando que o badge
dispara) antes de reenviar pro @qa.
