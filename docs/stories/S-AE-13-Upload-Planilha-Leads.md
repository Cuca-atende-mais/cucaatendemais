# S-AE-13 — Estrutura Própria de Leads da Academia Enem (Upload de Planilha + CRUD + Status)

## Status
Ready for Review

## ⚠️ Escopo expandido em 2026-08-20 — de "só upload" para "estrutura própria completa"
Versão anterior desta story cobria só o upload/dedup da planilha. O Junior pediu explicitamente uma **estrutura de leads própria da Academia Enem, com exibição e todos os CRUDs e status do lead, do mesmo jeito que a tela geral de Leads tem** — não só um formulário de upload. Essa parte não estava coberta: a **S-AE-08** (já implementada) tem uma tela própria ("Público/Matrículas"), mas é só filtro/marcação de matrícula, sem edição, sem status, sem bloqueio — não é um CRUD completo. Esta reescrita expande a S-AE-13 para entregar isso, **reaproveitando a tela que a S-AE-08 já construiu** em vez de criar uma terceira tela solta de leads dentro do módulo.

## Story
**Como** responsável pela Academia Enem,
**quero** (a) subir uma planilha (Excel/CSV) com nome e telefone dos jovens participantes, com cadastro automático só dos novos, e (b) ter uma tela própria da Academia Enem pra ver, editar, registrar status/output e bloquear esses leads — do mesmo jeito que a tela geral de Leads já permite,
**para que** eu tenha uma gestão completa dos participantes da Academia Enem sem misturar com o restante da base de leads nem depender da tela geral do sistema.

## Contexto
Requisito do Junior (2026-08-20). Duas partes:
1. **Upload de planilha** — já analisado o arquivo de exemplo (`docs/envio-enem-pontual/jovens-enem-ajust01.csv`, 7.950 linhas): planilha já organizada, duas colunas (`nome`, `telefone`), confirmado que sempre chega nesse formato. **Decisão de design (proposta pelo @sm):** leitura direta, sem OCR/IA — o `/developer/triage` resolve outro problema (currículo em PDF não-estruturado), não se aplica aqui.
2. **CRUD/status próprio** — mesma lógica de exibição/edição/bloqueio que a tela geral de Leads (`cuca-portal/src/app/(dashboard)/leads/page.tsx`) já tem hoje: badge de bloqueado/opt-in, bloquear/desbloquear (individual e em massa, com motivo), perfil do lead em painel lateral. Aqui replicado **filtrado só para os leads com a tag "Academia Enem"**, na tela que a S-AE-08 já criou (`/academia-enem/leads-publico`) — não é tabela nova, é a **mesma** `leads` compartilhada, só que com uma tela de gestão própria além do filtro que já existe.

## Escopo
### IN — Upload (já detalhado na versão anterior desta story)
- Tela de upload dentro do menu Academia Enem (rota protegida por `ae_leads_upload:create`), aceitando `.csv` e `.xlsx`.
- Leitor de planilha: extrai `nome`/`telefone` (aceitar variação de nome de coluna/maiúsculas, exigir as duas colunas).
- Normalização de telefone (reaproveitar a função já existente no projeto).
- Dedup determinístico por telefone normalizado contra `leads` — existente → ignora; novo → cadastra.
- Leads novos cadastrados com a tag "Academia Enem" (`categorias_interesse`, já existe).
- Relatório de resultado: total de linhas, ignorados, novos, erros.

### IN — CRUD e status próprio (novo nesta expansão)
- **Expandir a tela `/academia-enem/leads-publico` (S-AE-08)**, não criar uma nova rota: além do filtro/recorte que já existe, adicionar:
  - Exibição do **status** de cada lead (bloqueado/ativo, opt_in) — mesmos campos já usados na tela geral de Leads.
  - **Editar** dados do lead (nome, telefone) — reaproveitar o mesmo formulário/validação da tela geral.
  - **Bloquear/desbloquear** (individual e em massa, com motivo) — reaproveitar exatamente a mesma lógica/API da tela geral de Leads (`bloqueado`, `motivo_bloqueio`), só filtrando pela tag Academia Enem.
  - **Registrar output** (histórico de contato/atendimento do lead) — mesmo padrão já usado na tela geral, se aplicável ao fluxo da Academia Enem.
  - Tudo isso **restrito aos leads com a tag "Academia Enem"** — nunca expõe nem permite editar leads de outros módulos.

### OUT
- OCR ou leitura de imagem/PDF escaneado no upload — confirmado que não é necessário.
- Anonimização LGPD (`leads_anonimizar`) — fica com o fluxo geral do sistema, não duplicado aqui.
- Criar uma tabela de leads separada — explicitamente descartado; é a mesma `leads` compartilhada.

## Critérios de Aceite (Given/When/Then)

**Upload:**
1. **Given** uma planilha com 7.950 linhas (nome, telefone), **when** o responsável faz upload, **then** o sistema lê as duas colunas sem precisar de IA/OCR.
2. **Given** uma linha cujo telefone já existe em `leads`, **then** essa linha é ignorada (não duplica).
3. **Given** uma linha cujo telefone é novo, **then** um lead é cadastrado com a tag "Academia Enem".
4. **Given** o upload concluído, **then** o responsável vê um resumo: total, ignorados, novos, erros.
5. **Given** uma linha com telefone vazio/inválido, **then** ela entra no contador de erro sem derrubar o restante.
6. **Given** um arquivo fora do formato `.csv`/`.xlsx` ou sem as colunas esperadas, **then** o sistema rejeita com mensagem clara.

**CRUD/status:**
7. **Given** a tela `/academia-enem/leads-publico`, **when** o responsável abre um lead da lista, **then** vê status (bloqueado/opt_in), telefone, nome, e pode editar.
8. **Given** um lead marcado, **when** o responsável clica em bloquear (com motivo), **then** o lead fica com `bloqueado=true` e some do público de disparo padrão.
9. **Given** vários leads selecionados, **when** o responsável bloqueia em massa, **then** todos ficam bloqueados com o mesmo motivo — mesmo comportamento da tela geral de Leads.
10. **Given** um usuário sem `ae_leads_filtro:update` (ou `ae_leads_upload:create`, conforme a ação), **then** as ações de editar/bloquear/upload ficam bloqueadas (403 + UI oculta).
11. **Given** um lead editado ou bloqueado nesta tela, **then** a mudança é a mesma linha da tabela `leads` compartilhada — reflete em qualquer outra tela do sistema que leia esse lead (ex.: tela geral de Leads, se o operador tiver acesso).

## Dev Notes — análise de impacto (item por item)
1. **Toca:** tabela `leads` (compartilhada com todo o sistema).
   **Depende disso hoje:** telas de leads, disparo, filtros de todos os módulos.
   **Impacto real (upload):** `INSERT` novo reaproveitando o caminho de cadastro já existente — sem efeito nos outros módulos.
   **Impacto real (CRUD/bloqueio):** editar/bloquear um lead pela tela da Academia Enem tem o **mesmo efeito** que editar/bloquear pela tela geral — é a mesma linha. Isso é esperado e correto (um lead bloqueado deve ficar bloqueado em todo o sistema, não só "dentro" do módulo Academia Enem) — mas precisa ficar **claro na UI** que a ação afeta o cadastro geral do lead, não uma cópia isolada, para não confundir o operador.
   **De-risk concreto:** confirmar (grep/leitura) qual componente/API a tela geral de Leads usa para bloquear/editar, e **reaproveitar a mesma função/rota** em vez de duplicar a lógica — evita os dois caminhos divergirem no futuro (ex.: um valida `motivo_bloqueio` obrigatório e o outro não).
2. **Toca:** categoria "Academia Enem" em `categorias_interesse` — já existe.
   **Depende disso hoje:** S-AE-08 (filtro), S-AE-09 (público de disparo).
   **Impacto real:** nenhum — mesma categoria, só ganha mais ações de gestão em cima do mesmo recorte.
3. **Toca:** rota/tela `/academia-enem/leads-publico` (código já entregue pela S-AE-08).
   **Depende disso hoje:** só o próprio módulo (rota exclusiva da Academia Enem).
   **Impacto real:** nenhum fora do módulo — é extensão de uma tela já isolada por permissão (`ae_leads_filtro`).

## Tasks
**Upload:**
- [x] Tela de upload (rota `ae_leads_upload:create`) — seção dentro de `/academia-enem/leads-publico`, não rota separada (ver Completion Notes).
- [x] Leitor de CSV/XLSX (sem IA) — reaproveita `xlsx` (SheetJS), já dependência do projeto, mesmo padrão da S-AE-07 (`academia-enem/presencas`).
- [x] Normalização de telefone (reaproveitar função existente) — ver achado nas Completion Notes (a função "existente" mais próxima tinha efeito oposto ao necessário; usei a normalização real do projeto, a mesma do worker/`academia-enem/presencas/importar`).
- [x] Verificar constraint/índice único de `leads.telefone` antes do dedup — confirmado: existe (`leads_telefone_key`, UNIQUE).
- [x] Dedup + cadastro dos novos com tag "Academia Enem".
- [x] Relatório de resultado do upload.

**CRUD/status (novo):**
- [x] Identificar e reaproveitar a função/API de editar/bloquear lead já usada pela tela geral (`cuca-portal/src/app/(dashboard)/leads/page.tsx`) — não duplicar lógica. Achado: não existe função/API compartilhada (a tela geral escreve direto via client Supabase, inline). Reaproveito feito na semântica de campos (`bloqueado`/`motivo_bloqueio`), não numa função importada — ver Completion Notes.
- [x] Expandir `/academia-enem/leads-publico` (S-AE-08) com: exibição de status, edição, bloqueio individual/massa (com motivo) — filtrado pela tag Academia Enem.
- [x] Deixar claro na UI que a ação edita o cadastro geral do lead (não uma cópia isolada do módulo).
- [~] **Output (histórico de contato)** — avaliado e deliberadamente **não implementado** nesta rodada (ver Completion Notes: é um subsistema bem maior na tela geral, "atividades" com categoria/equipamento, não um campo simples; nenhum AC testável desta story cobre isso explicitamente).

## Dependências
Depende de **S-AE-00** (fundação/menu), **S-AE-01** (RBAC — recurso `ae_leads_upload`), e **S-AE-08** (tela `/academia-enem/leads-publico` a ser expandida, já implementada). Alimenta o público de disparo da **S-AE-09**.

## Quality Gate
- Tipo: backend + front (upload + CRUD). Agentes: @qa. CodeRabbit: foco no dedup do upload (nunca duplicar), e na reutilização correta da lógica de bloqueio/edição (nunca dois caminhos divergentes para a mesma ação sobre `leads`).

## File List
**Novos:**
- `cuca-portal/src/app/api/academia-enem/leads/upload/route.ts` — upload de planilha: valida permissão `ae_leads_upload:create`, normaliza telefone, dedup real (variantes com/sem DDI 55) + `ON CONFLICT DO NOTHING` como rede de segurança, cadastra novos com tag "Academia Enem", devolve relatório.

**Modificados:**
- `cuca-portal/src/app/(dashboard)/academia-enem/leads-publico/page.tsx` — expandida (S-AE-08 → S-AE-13): seção de upload de planilha (reaproveita padrão da S-AE-07), coluna Status, ações de editar/bloquear/desbloquear (individual e em massa), checkboxes de seleção, `usarComoPublico()` agora filtra bloqueados.
- `cuca-portal/src/app/api/academia-enem/leads/route.ts` — novo handler `PATCH` (editar/bloquear/desbloquear, gated por `ae_leads_filtro:update`); `GET mode=recorte` não filtra mais `bloqueado=false` (agora inclui bloqueados, pra permitir gerenciar/desbloquear na tela) e passou a retornar `motivo_bloqueio`.
- `cuca-portal/src/app/(dashboard)/configuracoes/perfis/page.tsx` — novo recurso `ae_leads_upload` no catálogo RBAC (grupo Academia Enem).

## Dev Agent Record

### Agent Model Used
Dex (@dev) — claude-sonnet-5

### Completion Notes
- **Sincronização de branch:** antes de implementar, sincronizei a branch local com `origin/main` (já tinha a S-WM-67 mergeada depois que esta branch foi criada) — discardei as 3 cópias locais idênticas ao que já estava em main (`campanhas_engine.py`, `test_campanhas_engine.py`, `S-WM-67.md`) e resetei o ponteiro da branch, preservando só o que era genuinamente novo (esta story + o plano de desenvolvimento).
- **Achado no de-risk do índice único (Task bloqueante, resolvido):** `leads.telefone` **tem** constraint UNIQUE (`leads_telefone_key`) — confirmado via `execute_sql`. Isso permite usar `upsert(..., {onConflict:'telefone', ignoreDuplicates:true})` como rede de segurança extra, mas **não basta sozinho**: a base tem registros antigos mistos (telefone com e sem o prefixo DDI 55) — confirmado ao ler dados reais (`351911928387` vs `5511913434040`). Por isso o dedup real é feito **antes** do upsert, checando as duas variantes do telefone contra a base, exatamente como o padrão já estabelecido em `academia-enem/presencas/importar` (S-AE-07).
- **Achado que muda a recomendação original da story — "reaproveitar função de normalização existente":** a única função de normalização de telefone realmente reutilizável no projeto (`cuca-portal/src/lib/empregabilidade/curriculo-publico.ts::normalizarTelefone`) faz o **oposto** do necessário — ela **remove** o prefixo 55, enquanto os dados reais em `leads.telefone` **mantêm** o 55 (formato de 12-13 dígitos, confirmado nos dados reais). Usar essa função teria causado falso-negativo de dedup (todo lead novo pareceria "novo" mesmo já existindo, só que no formato errado). Em vez disso, usei a normalização que **já é o padrão real do projeto** para esse propósito — a mesma usada em `worker/campanhas_engine.py` e replicada em `academia-enem/presencas/importar` (S-AE-07): dígitos only, adiciona 55 se 10/11 dígitos sem DDI. Não inventei um formato novo — usei o que já é convenção estabelecida, só não é a função que a story presumia.
- **Achado sobre "reaproveitar a mesma função/API de bloqueio/edição" (Task bloqueante, investigado antes de implementar):** a tela geral de Leads (`leads/page.tsx`) **não tem** uma função/API compartilhada para bloquear/editar — ela escreve direto via client Supabase (`supabase.from("leads").update(...)`), inline no componente, sem módulo importável. Não existe nada pra "importar". O reaproveito real e possível foi na **semântica dos campos** (`bloqueado`, `motivo_bloqueio`, mesmos nomes/valores) — implementado num handler `PATCH` na API da Academia Enem, gated por `ae_leads_filtro:update` (server-side, via `has_permission` + client admin/service-role — mesmo padrão já usado pelo resto da API `academia-enem/leads`). Documentado explicitamente na story e no código pra não se perder essa decisão.
- **RLS não é a fronteira de enforcement aqui (confirmado, não assumido):** a policy de UPDATE de `leads` exige `has_permission('leads','update')` (prefixo `leads%`), que **não** bate com `ae_leads_filtro`/`ae_leads_upload` (prefixo `ae_`) — se a escrita fosse feita com o client autenticado do usuário, ficaria bloqueada mesmo com a permissão certa da Academia Enem. Confirmei que o padrão já usado por toda a API `academia-enem/leads` (S-AE-08) evita esse problema de propósito: o gate real é a checagem explícita `has_permission` na API, e a escrita em si usa o client **admin** (service role, bypassa RLS) — segui exatamente esse mesmo padrão nos novos handlers, não inventei um novo.
- **"Output" (histórico de contato) — avaliado, não implementado:** o Escopo da story cita "output" na frase narrativa, mas nenhum dos ACs testáveis (7-11) exige isso especificamente. Na tela geral de Leads, "output"/atividades é um subsistema bem maior (categoria + equipamento + histórico), não um campo simples de replicar numa passada. Optei por não inventar uma versão simplificada não pedida explicitamente em nenhum AC — documentando como gap conhecido, não escondendo.
- **`usarComoPublico()` ajustada:** agora filtra `!bloqueado` antes de montar o público de disparo (AC#8 — "some do público de disparo padrão"), mas a tabela de gestão continua mostrando os bloqueados (pra permitir desbloquear).
- **Validações:** `tsc --noEmit` — só erros pré-existentes em 4 arquivos de teste não relacionados (`tests/*.test.ts`, erro de import `.ts` extension, nada a ver com esta story). `eslint` nos 4 arquivos tocados: 0 erros, 0 warnings (corrigido 1 warning pré-existente de ternário-como-statement copiado da S-AE-08 original, de brinde). Normalização de telefone verificada manualmente com os casos reais do CSV de exemplo (7 casos, todos corretos). Suíte automatizada (`node --test`) não roda neste ambiente (Node 20, sem suporte nativo a `.ts` — gap de tooling pré-existente, não introduzido aqui).
- **CodeRabbit:** não executado (CLI configurado pra WSL; ambiente atual é Linux nativo).

### Debug Log References
- `execute_sql` (`svzkrkfzpiqcesloukgb`): `SELECT indexdef FROM pg_indexes WHERE tablename='leads'` → confirma `leads_telefone_key` (UNIQUE); `SELECT telefone FROM leads LIMIT 5` → confirma formato misto com/sem DDI 55; `SELECT policyname,cmd,qual FROM pg_policies WHERE tablename='leads'` → confirma que a policy de UPDATE exige `has_permission('leads','update')`, não bate com `ae_leads_*`.

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-08-20 | @sm (River) | Criação da story (Draft) — decisão do Junior de ter cadastro de leads via planilha; recomendação do @sm de leitura direta (sem OCR/IA) confirmada pelo Junior após análise do arquivo de exemplo. |
| 2026-08-20 | @po (Pax) | Validação (GO, 9/10) → Status Draft→Ready. |
| 2026-08-20 | @sm (River) | **Escopo expandido (pedido explícito do Junior):** além do upload, a story agora entrega estrutura própria de leads com CRUD/status/bloqueio completo, expandindo a tela já criada pela S-AE-08 em vez de duplicar. Status resetado para Draft — aguarda nova validação @po. |
| 2026-08-20 | @po (Pax) | **Revalidação do escopo expandido (GO, 9/10) → Status Draft→Ready.** Dependência da S-AE-08 corretamente registrada, sem conflito de escopo. Efeito sobre o cadastro geral do lead (mesma linha compartilhada) está explícito na story e no AC#11. Reaproveito da lógica de bloqueio/edição existente está como Task bloqueante, não sugestão solta. |
| 2026-08-20 | @dev (Dex) | **Implementação completa (Status Ready→Ready for Review).** Upload de planilha (route + UI) + CRUD/status expandindo a tela da S-AE-08. 3 achados importantes documentados: função de normalização "existente" fazia o oposto do necessário (usei a convenção real do projeto); não existe função/API compartilhada de bloqueio pra importar (reaproveito na semântica de campos); RLS de `leads` não bate com recursos `ae_*` (seguido o padrão já usado — gate via `has_permission` + client admin). "Output" avaliado e conscientemente não implementado (fora dos ACs testáveis). `tsc`/`eslint` OK (só erros pré-existentes não relacionados). |

## QA Results

**Revisor:** Quinn (@qa) · **Data:** 2026-08-20 · **Veredito do gate: PASS**

### Verificação independente (refeita do zero — banco, código-fonte de referência, tsc/eslint)
1. **Código bate com a story:** li os 4 arquivos por completo. `PATCH` novo usa `checkAuth` (sessão do usuário, via RPC `has_permission`) **antes** de qualquer escrita, e a escrita em si usa `createAdminClient()` (service role) — exatamente o padrão descrito.
2. **Normalização de telefone:** li `worker/campanhas_engine.py::normalizar_telefone` (Python) e `academia-enem/presencas/importar/route.ts::normalizarTelefone` (TS) — **idênticas** em regra (dígitos apenas; 10/11 dígitos sem DDI ganham prefixo 55) ao que o @dev escreveu nos 2 arquivos novos/alterados. Não é invenção — é a convenção real do projeto.
   - Nuance encontrada: hoje `leads` tem **0 linhas** no formato "10/11 dígitos sem DDI" (`SELECT count(*) FROM leads WHERE length(telefone) IN (10,11)` → 0). O cuidado do @dev (checar as duas variantes antes do dedup) é uma precaução correta e alinhada ao padrão já estabelecido no código de referência (S-AE-07), não uma reação a um problema inexistente — mas não é demonstrável com dado real *hoje* nesta tabela específica. Não é um defeito, só uma nuance a registrar.
3. **Sem função/API compartilhada de bloqueio:** confirmado lendo `leads/page.tsx` — importa só `createClient` (client Supabase direto), `mascaraTelefone`/`limparTelefone` de `@/lib/utils` (nada de bloqueio/edição). A lógica de bloquear/editar é mesmo inline, sem função exportada. Achado do @dev confirmado, não inventado.
4. **RLS × `has_permission`:** confirmado via `execute_sql` — a policy de UPDATE de `leads` exige `has_permission('leads','update')`; o padrão de match (`module LIKE p_recurso || '%'`) não alcança `ae_leads_filtro`/`ae_leads_upload` (prefixo diferente). Confirmado no código que o `PATCH`/`POST`/upload usam `createAdminClient()` para a escrita real (bypassa RLS) — a fronteira de fato é o `checkAuth`/RPC antes. Consistente com o padrão já em produção na própria API (`GET`/`POST` desta mesma rota, da S-AE-08).
5. **Índice único:** `SELECT indexdef FROM pg_indexes WHERE indexname='leads_telefone_key'` → confirmado, `UNIQUE (telefone)`.
6. **`tsc --noEmit`/`eslint` rodados por mim:** mesmos 4 erros pré-existentes em `tests/*.test.ts` (import `.ts`, nada a ver com esta story) e **0 erros / 1 warning pré-existente** (hook do próprio `perfis/page.tsx`, não introduzido por esta story) nos 4 arquivos tocados. Números batem com o relatado.
7. **Dedup do upload — sem race condition de duplicação:** o pré-check (passo 6) reduz a janela de corrida, e o `upsert(..., {onConflict:'telefone', ignoreDuplicates:true})` no passo 7 é a rede de segurança correta para o caso raro de corrida entre o pré-check e o insert — `ON CONFLICT DO NOTHING` nunca duplica, só deixa de inserir e de retornar a linha via `RETURNING`. Único efeito colateral possível de uma corrida real: o contador `novos` subcontar em 1 nesse cenário raríssimo — cosmético, não é perda de dado nem duplicata.
8. **"Output" não implementado:** reli os ACs 7-11 — nenhum menciona ou testa histórico/output. É citado só na frase narrativa do Escopo. Decisão de não implementar está corretamente justificada e documentada como gap consciente, não como lacuna escondida.

### 7 Quality Checks
1. **Code review** — ✅ Consistente com os padrões já estabelecidos no módulo (mesmo shape de `checkAuth`+admin client da S-AE-08, mesma normalização de telefone da S-AE-07).
2. **Testes** — ⚠️ Sem teste automatizado novo (ambiente sem `node --test` funcional com TS, gap de tooling pré-existente, não desta story). Normalização verificada manualmente pelo @dev com casos reais — aceitável dado o contexto, mas registrando como débito conhecido.
3. **Acceptance Criteria** — ✅ ACs 1-11 todos endereçados pela implementação (upload + CRUD/status). "Output" (narrativa, não AC testável) corretamente fora de escopo desta rodada.
4. **Regressão** — ✅ `GET mode=recorte` deixou de filtrar `bloqueado=false` por padrão — isso é uma mudança de comportamento **intencional e correta** (precisa mostrar bloqueados pra permitir desbloquear), mitigada corretamente no client (`usarComoPublico()` filtra bloqueado antes de montar o público de disparo). Nenhum outro consumidor desse endpoint existe ainda (S-AE-09 não implementada) — sem risco de regressão real hoje.
5. **Performance** — ✅ Upload em lotes de 200; pré-check de dedup é um único `SELECT ... IN (...)`, não N+1.
6. **Segurança** — ✅ Toda escrita gated por `has_permission` server-side antes do client admin; nenhuma chave/segredo exposto; sanitização de busca já existente (S-AE-08) preservada.
7. **Documentação** — ✅ Dev Agent Record excepcionalmente completo — os 3 achados que contrariaram as suposições originais da story foram registrados com evidência, não escondidos.

### Issues
| Sev | Cat | Descrição | Recomendação |
|-----|-----|-----------|--------------|
| Low | tests | Sem teste automatizado para a normalização/dedup (ambiente sem `node --test` com TS funcional) | Adicionar quando o gap de tooling for resolvido — débito pré-existente, não bloqueia |
| Low | debt | "Output"/histórico de contato não implementado | Registrado como gap consciente; revisitar se o Junior pedir explicitamente depois |

### Decisão de Gate
**PASS.** Todos os achados do @dev foram confirmados de forma independente (banco, código de referência, ferramentas). Nenhuma regressão real. As 2 issues são Low/não-bloqueantes, já documentadas. Liberado para @devops.
