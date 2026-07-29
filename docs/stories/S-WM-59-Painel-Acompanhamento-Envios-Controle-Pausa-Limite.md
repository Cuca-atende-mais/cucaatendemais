# S-WM-59 — Painel de Acompanhamento de Envios: Controle de Pausa e Limite

## Status
Draft — **BLOQUEADA pela `S-WM-60-Corrigir-Truncamento-Limite-Diario-Por-Numero.md`** (formaliza o Plano 008 — já existe agora, como plano técnico e como story). Não iniciar nenhum desenvolvimento desta story antes da S-WM-60 estar `Done` (implementada e em produção). Esta story em si também aguarda validação do sócio antes de qualquer desenvolvimento, como a S-WM-58.

## Origem
Metade "de controle" do pedido do Junior/sócio por um painel de acompanhamento de envios — ver `S-WM-58-Painel-Acompanhamento-Envios-Visao-Entrega.md` para a origem completa, os 2 achados de investigação (Academia Enem, RBAC) e a justificativa da divisão em 2 stories. Esta story cobre os 3 requisitos do pedido original que dependem de dado/funcionalidade que **não existe hoje** e só existiria depois do Plano 008.

**Atualização (2026-07-28):** o Plano 008 foi encontrado e formalizado como story — `S-WM-60-Corrigir-Truncamento-Limite-Diario-Por-Numero.md`, referenciando `docs/qa/planos-corrida-juventude/008-corrigir-truncamento-limite-diario.md`. A recomendação de sequenciamento abaixo (escrita quando o Plano 008 ainda não existia em lugar nenhum) foi **cumprida** — mantida como registro histórico, não mais uma recomendação em aberto.

## Recomendação sobre sequenciamento do Plano 008 (histórico — já cumprida, ver Atualização acima)

Esta story não pôde ser detalhada em profundidade (Tasks, queries exatas, contrato de API) sem inventar o desenho do Plano 008, que na época não existia nem como plano técnico nem como story. Por Article IV da Constitution (No Invention), não especulei a forma exata do endpoint `/retomar-disparo/{origem}/{item_id}` nem da lógica de correção do falso "concluído" além do que já tinha sido dito nas conversas anteriores.

**Recomendação (já cumprida):** formalizar o Plano 008 (plano técnico + story) **antes ou em paralelo** ao desenvolvimento da S-WM-58 (que não depende dele) — mas **antes** desta S-WM-59 poder sair de `Draft` com Tasks reais.
1. S-WM-58 (não bloqueada) pode ir para desenvolvimento assim que validada.
2. ~~Plano 008 formalizado (technical plan + story) em paralelo~~ — **feito**: `S-WM-60` + `plans/008-corrigir-truncamento-limite-diario.md` (o plano já existia, escrito anteriormente com dado real do Business Manager, e foi consolidado + estendido nesta rodada com o requisito de `daily_limit` por número).
3. Só depois a S-WM-60 implementada e em produção, esta S-WM-59 sai de `Draft` com Tasks detalhadas.

## O que já se sabe do Plano 008 — agora com referência concreta (`S-WM-60` / `plans/008-*.md`)

- Pausa por limite diário deixa de marcar o disparo como `"concluído"` (falso positivo, achado C do diagnóstico "Corrida da Juventude" original) — passa a refletir corretamente que ainda faltam destinatários (`"pausada_limite_diario"`/`"pausado_limite_diario"`, Steps 1-2 do plano técnico).
- Endpoint manual de retomada: `/retomar-disparo/{origem}/{item_id}` — usa o ledger (`logs_disparo`) para saber quem ainda falta, sem reenviar para quem já recebeu (Steps 3-4). **Decisão já resolvida no plano técnico**: retomada cobre só quem nunca foi tentado — retry de quem falhou (`logs_disparo.status='falhou'`) é fora de escopo, item separado.
- Registro da camada real de mensageria da Meta — **já confirmada com dado real** (print do Business Manager, 2026-07-28): a escada deste número é `250 → 2000 (atual) → 10000 → 100000 → Ilimitado`, diferente da escada genérica documentada pela skill `whatsapp-cloud-api`. Coluna `messaging_limit_tier` (Step 6 do plano) — confirmada ao vivo que **não existia** em `meta_phone_numbers` (correção de premissa herdada da S-WM-57 Dev Notes, que citava a coluna como já existente).
- **Decisão de produto — RESOLVIDA, não mais em aberto**: retomada é **exclusivamente manual**, nunca automática — decidida com o usuário antes do plano técnico ser escrito, reforçada no cabeçalho do documento ("não re-litigar"). O botão "Reenviar pendentes" desta story é o único caminho de retomada, não um atalho entre outros.

## Requisito novo confirmado por Junior (2026-07-28): `daily_limit` deixa de ser global, passa a ser por `phone_number_id`

**Decisão de produto confirmada:** `configuracoes.anti_ban_daily_limit` (hoje 1 valor único, compartilhado por todos os motores) deixa de ser global — passa a ser configurável **por número** (`phone_number_id`), porque cada número Meta tem sua própria camada de mensageria/limite de envio, e o plano é ter múltiplos números distintos operando (Institucional hoje, Ouvidoria e Academia Enem no horizonte). O seletor de limite desta story (AC 3) e a camada de mensageria registrada já faziam sentido "por número" — a peça que faltava era o próprio `daily_limit` também virar por número, não mais 1 valor do sistema inteiro.

### Investigação do schema atual (pedida por Junior) — 2 achados que corrigem premissas

**Achado A — não existe hoje nenhuma tabela/coluna que associe configuração a `phone_number_id`.** Investigado ao vivo em produção:
- `configuracoes` (`chave varchar, valor jsonb, descricao, updated_by, created_at, updated_at`) é um key-value **puramente global** — sem coluna `phone_number_id`, sem FK para `meta_phone_numbers`. O valor atual de `anti_ban_daily_limit` é `1000`.
- Busquei toda coluna `phone_number_id`/`phone_number_ids` no schema (`information_schema.columns`): só existe em 3 lugares — `meta_phone_numbers.phone_number_id` (PK), `ae_instancias.phone_number_id` (ilha própria do Academia Enem), e `meta_templates.phone_number_ids` (array, associação de template↔número, não de limite/config).
- **Conclusão:** o único lugar que faz sentido pra guardar um `daily_limit` por número é a própria `meta_phone_numbers` (nova coluna, ex. `daily_limit integer`) — não existe hoje nenhuma estrutura intermediária a reaproveitar. O Plano 008 vai precisar de uma migration criando essa coluna (e a de `messaging_limit_tier`/`quality_rating`, ver Achado B), não só "usar o que já tem".

**Achado B — correção da premissa "já existem hoje 2 números reais distintos (Institucional e Ouvidoria)".** Não confere com o banco/código ao vivo:
- `SELECT phone_number_id, canal_tipo, ativo FROM meta_phone_numbers` em produção retorna hoje só **2 linhas ativas**: `canal_tipo='Empregabilidade'` (número do módulo de Empregabilidade, fora do escopo desta story) e `canal_tipo='Institucional'` (o número compartilhado pelos 3 motores desta story).
- **Não existe nenhuma linha com `canal_tipo` relacionado a "Ouvidoria"** — confirmado com busca `ILIKE '%ouvidoria%'`, zero resultados.
- Confirmado também no código (`worker/campanhas_engine.py:317,320,323`): as 3 origens (`eventos_pontuais`, `ouvidoria_eventos`, e o `else` de divulgação/campanhas mensais) **todas** resolvem `canal_tipo = "Institucional"` — ou seja, hoje pontual + ouvidoria + divulgação mensal **compartilham o mesmo e único número** (`1233832826470497`). Não há hoje uma distinção real de número entre eles.
- **Isso não invalida a decisão de produto** (por número é a arquitetura certa, olhando pra frente — Ouvidoria ganhar número próprio e Academia Enem entrar como 3º são exatamente os motivos citados por Junior) — só corrige o estado atual: migrar `daily_limit` pra por-número **não vai criar limites distintos entre pontual/ouvidoria/divulgação hoje**, porque os 3 apontam pro mesmo número. O ganho prático imediato só aparece quando Ouvidoria (ou outro) ganhar um `phone_number_id` próprio. Registrando isso pra Junior ter clareza da diferença entre "arquitetura correta agora" e "efeito prático imediato" — não é um motivo para não fazer, só uma expectativa a calibrar.
- **Nota à parte, sem ação necessária:** o Academia Enem (`ae_instancias`) já tem hoje as colunas `quality_rating`/`messaging_limit_tier` — mas nunca populadas, e numa tabela totalmente isolada de `meta_phone_numbers` (mundo AuctaFlux, não Meta-oficial-via-campanhas_engine). Isso não dá nenhum atalho pra este plano — são ilhas de dados diferentes, sem unificação hoje (unificar seria trabalho à parte, fora de escopo aqui).

### O que isso muda no desenho do Plano 008 (resposta direta à pergunta de Junior)

Sim, muda de forma relevante — 2 pontos:
1. **A migration do Plano 008 precisa criar 3 colunas novas em `meta_phone_numbers`** (não 1): `daily_limit` (novo, requisito desta decisão), e `messaging_limit_tier`/`quality_rating` (que a S-WM-57 presumia existirem e não existem — correção necessária independente do requisito novo). Sem essas 3, nem o "Step 6" original (registro de camada) nem o requisito novo (limite por número) têm onde ser gravados.
2. **O worker precisa parar de ler `daily_limit` de `configuracoes.anti_ban_daily_limit`** (`worker/campanhas_engine.py:543`, `get_config("anti_ban_daily_limit", 500)`) **e passar a ler de `meta_phone_numbers.daily_limit`**, por `phone_number_id` — isso toca o loop principal (`worker/campanhas_engine.py` em torno da linha 543) e qualquer lugar que hoje trata `daily_limit` como parâmetro único compartilhado entre os 3 motores. É uma mudança de assinatura/fluxo real no worker, não só de schema — precisa entrar no desenho do Plano 008 como um passo próprio (com plano de migração de dado: o valor global atual, `1000`, vira o default/seed inicial por número ao criar a coluna).

**Atualização (2026-07-28):** o Plano 008 foi localizado (existia fora do diretório padrão, nunca commitado) e consolidado em `docs/qa/planos-corrida-juventude/008-corrigir-truncamento-limite-diario.md`, com este requisito incorporado ao **Step 6 reescrito** — exatamente na linha do que esta seção antecipava (mover a leitura de `daily_limit` para dentro de cada função de disparo, resolvida por `phone_number_id`). Formalizado como story: `S-WM-60-Corrigir-Truncamento-Limite-Diario-Por-Numero.md`.

## Escopo (alto nível — detalhamento pendente do Plano 008)

### IN (alto nível, sujeito a detalhamento posterior)
1. Na mesma tela da S-WM-58, indicador visual de "pausado por limite diário" por disparo, com contagem de quantos destinatários ainda faltam — dado só correto depois da correção do Plano 008.
2. Botão "Reenviar pendentes" — aciona o endpoint de retomada manual do Plano 008. **Nunca automático** (conforme instruído explicitamente pelo Junior) — mesmo que o Plano 008 venha a suportar retomada automática como opção de sistema, este botão é sempre uma ação manual explícita do usuário.
3. Seletor de limite diário na tela, **por número** (`meta_phone_numbers.daily_limit`, coluna a ser criada pelo Plano 008), respeitando `meta_phone_numbers.messaging_limit_tier` (idem, a ser criada) — nunca permite configurar valor acima da camada confirmada pela Meta para aquele número.

### OUT
- Tudo que já está em `S-WM-58` (visão de entrega — não bloqueada, desenvolvida separadamente).
- Academia Enem — confirmado por Junior (2026-07-28) como **fora de escopo definitivo desta rodada**, registrado como item futuro separado (mesmo motivo da S-WM-58: sem ledger, sem disparo em massa implementado). Não abrir story pra isso agora.
- Implementar o Plano 008 em si (pause-fix, endpoint de retomada, criação/população de `daily_limit`/`messaging_limit_tier`/`quality_rating` por número em `meta_phone_numbers`, mudança do worker para ler `daily_limit` por número) — é pré-requisito externo, não parte desta story. Esta story é só a **interface** para esses pontos.

## Acceptance Criteria (alto nível — a refinar quando o Plano 008 estiver formalizado)

1. **Given** um disparo pausado por `daily_limit` (estado corrigido pelo Plano 008), **when** exibido no painel, **then** aparece um alerta visual de pausa com a contagem exata de destinatários ainda não atendidos.
2. **Given** o botão "Reenviar pendentes" clicado, **when** acionado, **then** chama o endpoint de retomada do Plano 008 — nunca dispara reenvio automático sem esse clique explícito.
3. **Given** o seletor de limite diário, **when** o usuário tenta configurar um valor **para um número específico**, **then** o valor máximo selecionável nunca excede `meta_phone_numbers.messaging_limit_tier` daquele número — a UI impede, não só avisa; **e** o valor gravado é específico daquele `phone_number_id`, nunca um valor único do sistema inteiro.
4. Nenhum destinatário que já recebeu (linha `enviado`/`entregue`/`lido`/`falhou` em `logs_disparo`) é reenviado pelo botão "Reenviar pendentes" — só quem ainda não tem linha de ledger para aquele disparo.

## Tasks / Subtasks
Não detalhadas — aguardando Plano 008 ser formalizado (ver Recomendação acima). Escrever Tasks reais antes disso seria inventar o contrato do Plano 008 sem base.

## Dev Notes
- Esta story **depende** da S-WM-58 já estar em produção (mesma tela, esta story adiciona controles a ela) — dependência de sequenciamento, não só de dado.
- `daily_limit` por número **já é decisão de produto confirmada** (não mais uma sugestão a avaliar) — ver seção "Requisito novo confirmado por Junior" acima, com os 2 achados de investigação (nenhuma tabela associa config a `phone_number_id` hoje; premissa de "2 números distintos" não confere — só 1 número real serve os 3 motores hoje) e o que isso muda no desenho do Plano 008 (3 colunas novas em `meta_phone_numbers`, não 1; mudança real no worker em `campanhas_engine.py:543`).
- Quando o Plano 008 for escrito, ele deve citar esta seção como referência de premissas corrigidas — não repetir a assunção antiga (S-WM-57 Dev Notes) de que `messaging_limit_tier`/`quality_rating` já existem em `meta_phone_numbers`.

## Dependências
**BLOQUEADA pelo Plano 008** (ainda não formalizado como story nem como plano técnico) e pela **S-WM-58** já estar em produção (mesma tela).

## Git workflow
A definir — não antes do Plano 008 e da S-WM-58 estarem resolvidos.

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-28 | 0.1 | Story criada como a metade "de controle" do pedido do painel de acompanhamento de envios, separada da S-WM-58 pela fronteira real de dependência do Plano 008. Mantida em alto nível deliberadamente (Article IV — No Invention) até o Plano 008 ser formalizado. @dev não acionado. | @sm River |
| 2026-07-28 | 0.2 | 3 decisões/achados incorporados: (1) Academia Enem confirmado fora de escopo definitivo, item futuro separado; (2) **requisito novo confirmado**: `daily_limit` deixa de ser global, passa a ser por `phone_number_id` — investigação do schema mostrou que nenhuma tabela associa config a número hoje (só `meta_phone_numbers` serve) e que a premissa de "2 números distintos" (Institucional + Ouvidoria) não confere — hoje só 1 número real serve os 3 motores; (3) **correção de premissa herdada da S-WM-57**: `messaging_limit_tier`/`quality_rating` NÃO existem em `meta_phone_numbers` hoje (confirmado ao vivo) — precisam ser criadas pelo Plano 008, não só populadas. Escopo/AC/Dev Notes atualizados de acordo. @dev não acionado. | @sm River |
| 2026-07-29 | 0.3 | Implementação dos 3 itens (alerta de pausa+pendentes, botão "Reenviar pendentes", seletor de limite diário por número) feita diretamente pelo @dev, já com a S-WM-60 mergeada em `main` — Tasks formais nunca chegaram a ser escritas nesta story (Plano 008 virou a S-WM-60 e foi implementado num ciclo separado), mas o código, testes e migration da RPC (`item_id`/`total_pendentes`) estão completos e aplicados em produção. Durante a retomada, o @dev encontrou e corrigiu um bug crítico pós-merge da S-WM-60 (status de pausa quebrando em produção) — ver Change Log da S-WM-60 v0.5. Gate do @qa registrado abaixo: **PASS**. Status/Tasks formais desta story não foram atualizados por @po/@sm nesta rodada — sinalizado como pendência de housekeeping, não bloqueia o gate. | @dev Dex / @qa Quinn |

## QA Results

**Veredito: PASS** (com 1 CONCERN de baixa prioridade, não bloqueante, e 1 correção ao relato do @dev sobre o item "a" abaixo).

Verificação independente dos 6 pontos pedidos (não aceitei nenhum por relato — reproduzi tudo de novo com IDs/queries próprios):

**a) Violação de 19:42:01 nos logs — CORRIGINDO O RELATO DO @DEV: não é um disparo real.** Cruzei os logs do Postgres com os logs de API (`get_logs service=api`) na janela de 19:41–19:43. O loop real do worker (`campanhas_loop`) roda a cada ~30s e é bem visível nos logs de API (3 RPCs de claim + GETs, o dia todo) — mas **nenhuma chamada de API corresponde ao erro de 19:42:01**, nem a qualquer PATCH/UPDATE em `disparos`/`disparos_divulgacao` nessa janela. Além disso, `SELECT ... WHERE created_at::date = CURRENT_DATE` em `disparos` e `disparos_divulgacao` retornou **0 linhas** — nenhum disparo real foi criado hoje. Conclusão: aquela violação veio de uma verificação manual via SQL direto (mesmo padrão da minha própria verificação), não do worker processando um disparo real. **Não há disparo travado para resolver** — o @dev reportou isso como "indício de violação real, não gerada por ele", o que está certo quanto à autoria, mas errado quanto à origem (não foi produção real).

**b) Hotfix nos 3 motores — CONFIRMADO, reproduzido do zero.** Testei com IDs próprios (`11111111-...`, não reaproveitando o script do @dev), cobrindo as 4 tabelas de escrita que os 3 motores usam (`eventos_pontuais` e `disparos` no caminho pontual, `ouvidoria_eventos` no caminho ouvidoria, `disparos_divulgacao` no caminho divulgação): todas aceitam `pausada_limite_diario`/`pausado_limite_diario` após o hotfix (transação com ROLLBACK, nada persistido).

**c) Botão "Reenviar pendentes" / endpoint dividido — CONFIRMADO.** Li `worker/main.py:455-511` e `campanhas_engine.py:772-822,1195-1221` diretamente: o endpoint `POST /retomar-disparo/{origem}/{item_id}` aguarda `reivindicar_retomada_{pontual,divulgacao}` de forma síncrona e responde 404 (não encontrado) / 409 (não pausado ou corrida perdida) / 500 (inconsistente) **antes** de agendar `background_tasks.add_task`. A rota do portal (`reenviar/route.ts`) propaga `resp.status` e o texto de erro reais quando `!resp.ok` — não há "sucesso" genérico escondendo falha. Rodei os 8 testes de `test_main_retomar_disparo.py` isoladamente: 8 passed.

**d) Validação server-side do limite — CONFIRMADO.** `limite-diario/route.ts` (PATCH) busca `messaging_limit_tier` direto do banco (`admin.from("meta_phone_numbers").select(...)`, linha 79-83) **antes** de validar o novo valor — o corpo da requisição do cliente só contém `phone_number_id`/`daily_limit`, nunca o tier, então não há como o cliente forjar um tier maior para burlar o limite. Backend nunca confia no que o frontend já validou.

**e) RBAC — CONFIRMADO.** `avaliarAcesso` (logic.ts): 401 sem usuário, bypass dos 3 e-mails developer, depois checa `permissao[acao]` (`can_read`/`can_update`) especificamente para o módulo `config_acompanhamento_envios`. Cada rota chama com a ação certa: GET → `can_read`; PATCH do limite e POST do reenvio → `can_update` (nunca atrás só de leitura, já que ambas disparam ação real).

**f) Suítes + advisors — CONFIRMADO, sem regressão.** Worker: **178 passed, 3 failed** (as mesmas 3 pré-existentes de `test_meta_adapter_outbound.py::TestSendMessageEndpoint`, já documentadas em rodadas anteriores). Portal: **39 passed** via `node --experimental-strip-types --test tests/*.test.ts` (mesma limitação pré-existente e documentada de `tests/` não ser coberto por `npm test`/vitest). `tsc --noEmit`/`eslint` limpos nos arquivos tocados. `get_advisors(security)`: **nenhum achado CRITICAL/ERROR** (só INFO/WARN, 107 WARNs no total, praticamente todos pré-existentes no projeto). 1 **CONCERN de baixa prioridade, não bloqueante**: `listar_disparos_acompanhamento` (recriada via DROP+CREATE nesta rodada) tem `search_path` mutável (`function_search_path_mutable`, nível WARN) — mesmo padrão de dezenas de outras funções do projeto (ex. `merge_conversa_metadata`), não introduzido por esta mudança; a migration apenas recriou a função sem aproveitar para adicionar `SET search_path = public`. Não bloqueia este gate, mas vale um item de débito técnico futuro (aplicável a várias funções do projeto, não só esta).

### Decisão
**PASS.** Hotfix crítico validado nos 3 motores, endpoint de retomada e validação de limite confirmados corretos, RBAC correto, suítes sem regressão. Não há disparo real travado (correção ao item "a" do relato do @dev). @devops **não acionado** — aguardando decisão do Junior. | @qa Quinn
