# S-PROG-04 — CRUD e fluxo de aprovação da programação

**Status:** InReview
**Epic:** Reestruturação da criação de programação
**Origem:** Pedido do Junior (2026-09-08) — "precisa ter CRUD para poder editar depois" e "o processo
de aprovação depois de publicado".
**Prioridade:** P1 | **Esforço:** M | **Risco:** MED — mexe em quando os embeddings do RAG são gerados.
**Depende de:** S-PROG-01.

## Contexto

Os status já existem em `campanhas_mensais` e já são usados em
`cuca-portal/src/app/(dashboard)/programacao/mensal/[id]/page.tsx`: `rascunho` → `pendente` →
`aprovado`, com "Finalizar Programação", "Reabrir para Edição" e "Aprovar Programação". **Esta story
reusa esse ciclo, não cria outro** — o que falta é a lista em cards, a devolução com motivo e o
comportamento do RAG em cada transição.

## O que precisa ser implementado

### 1. Lista em cards

Tela inicial da programação como cards: mês, unidade, badge de status, contagem por categoria e as ações
disponíveis conforme o status. Substitui/complementa a listagem atual.

| Status | Ações no card |
|---|---|
| `rascunho` | Continuar edição · Ver · Excluir |
| `pendente` | Analisar · Ver · Excluir |
| `aprovado` | Reabrir para editar · Ver · Excluir |

### 2. Transições

| De | Para | Quem | Efeito |
|---|---|---|---|
| `rascunho` | `pendente` | Junta técnica ("Enviar para aprovação") | Bloqueada se o painel de revisão da S-PROG-01 acusar qualquer ponto |
| `pendente` | `aprovado` | Coordenação ("Aprovar") | **Vai ao ar e gera os embeddings do RAG** |
| `pendente` | `rascunho` | Coordenação ("Devolver para ajuste") | Exige **motivo obrigatório**, registrado no histórico |
| `aprovado` | `rascunho` | Junta técnica ("Reabrir") | Exige confirmação; **sai do ar** até nova aprovação |

### 3. Histórico visível

Linha do tempo na tela de aprovação: cada transição com o que aconteceu, quando e por quem. Inclui o
motivo da devolução quando houver.

### 4. Embeddings atrelados à aprovação, não à gravação

Hoje a importação grava e o trigger gera embedding. Com o fluxo novo, rascunho e pendente **não podem**
alimentar o RAG — só `aprovado`. Reabrir uma aprovada tira do ar. Isso precisa ser explícito no código,
não implícito no trigger.

### 5. Exclusão

Excluir programação exige confirmação nominal (mês + unidade no texto do diálogo). Excluir linha dentro
do editor não precisa de confirmação (é reversível enquanto rascunho).

### 6. Ajuda (camada 1)

Tooltip/popover no badge de status explicando o que cada um significa e quem pode mudar; e no botão
"Reabrir para editar": "A programação sai do ar enquanto estiver sendo editada e volta quando for
aprovada de novo."

## Acceptance Criteria

1. A lista mostra cards com status correto e só as ações válidas para cada status.
2. "Enviar para aprovação" é bloqueado enquanto houver ponto no painel de revisão, com a lista visível.
3. Devolver exige motivo; o motivo aparece no histórico e a programação volta para `rascunho`.
4. Aprovar coloca no ar e dispara a geração de embeddings; rascunho e pendente **não** aparecem no RAG.
5. Reabrir uma aprovada exige confirmação e a retira do RAG até nova aprovação.
6. Permissões existentes (`programacao_mensal:manage` / `has_permission`) continuam valendo — nenhuma
   ação nova escapa do controle de acesso atual.

## Fora de escopo

Notificação por e-mail/WhatsApp de aprovação pendente (não pedida).

## Dev Agent Record

### Implementação (2026-09-09, @dev/Dex)

**Levantamento de impacto feito antes de codar:**
- Lido `trigger_indexar_campanha_mensal` (schema_producao.sql) — já é condicional a
  `status = 'aprovado'` pra gerar/ativar embedding, e desativa em qualquer outro status. Item 4 da
  story ("embeddings atrelados à aprovação, não à gravação") já era garantido pelo trigger — não
  precisou mudança de banco pra isso, só garantir que a transição `aprovado → rascunho` (que não
  existia no código antes) de fato atualiza `campanhas_mensais.status`, disparando o trigger.
- Achado: `handleAprovarProgramacao` (pendente → aprovado) fazia **update direto no cliente**,
  bypassando totalmente `/api/programacao/status` — nenhuma checagem de motivo, nenhum histórico,
  e inconsistente com as outras 3 transições. Consolidado: as 4 transições agora passam pela mesma
  rota, mesma checagem de permissão, mesmo histórico.
- Achado: `handleReabrirEdicao` (pendente → rascunho, rótulo "Reabrir para Edição") não pedia
  motivo nenhum — só um `confirm()` genérico. Renomeado pro rótulo da story ("Devolver para
  ajuste") e motivo virou obrigatório (bloqueado no servidor, não só no cliente).
- Verificado RLS de `campanhas_mensais`: `has_permission('programacao', 'update')` — resource
  `'programacao'`, não `'programacao_mensal'` como a rota antiga checava. Investiguei se isso era
  um bug (duas nomenclaturas diferentes) — não é: `has_permission` tem um segundo caminho (sistema
  novo, `sys_permissions`) que faz `module LIKE p_recurso || '%'`, e `sys_permissions` tem módulo
  `programacao_mensal` de verdade. As duas nomenclaturas coexistem de propósito (RLS usa o guarda-
  chuva `'programacao'`, a rota antiga usava o módulo específico) — mantive `'programacao'` na
  rota nova, mesmo padrão da RLS, sem regressão de permissão (AC6).

**Decisões de escopo tomadas durante a implementação:**

1. **Nova tabela `campanha_historico`** (migration aplicada em produção via MCP,
   `20260909230000_s_prog_04_campanha_historico.sql`) — não existia estrutura pra guardar
   de/para/motivo/quem/quando. Aditiva, RLS habilitada, `usuario_id` referencia `colaboradores`
   (mesmo padrão de `campanhas_mensais.created_by`, não `auth.users` direto).
2. **Bloqueio de "Enviar para aprovação" (item 2) usa `linhaTemProblema` (S-PROG-02), não
   `calcularProblemas` (S-PROG-01) literalmente.** `calcularProblemas` opera sobre `AtividadeForm`
   (formato de edição da grade); o que está gravado no banco pode vir de outro caminho (import de
   planilha antigo) com formato de `metadata` diferente (ver S-PROG-02, Dev Agent Record) — rodar
   o checador da grade contra dado que nunca passou pela grade não seria confiável. `linhaTemProblema`
   já opera direto na linha gravada e cobre os sinais que a story pede (texto de exemplo, título
   vazio, faixa etária sem dígito para ESPORTES).
3. **Exclusão nominal (item 5) só na programação MENSAL**, não em evento pontual — a story é
   sobre `campanhas_mensais`; evento pontual segue com o `confirm()` genérico que já tinha, fora
   de escopo.
4. **Distinção "Coordenação" vs "Junta técnica" (quem faz cada transição, tabela do item 2) não
   virou controle de acesso novo** — não existe hoje uma permissão granular por papel pra isso, só
   `has_permission('programacao', 'update')` genérico (AC6: permissões existentes continuam
   valendo, não pede criar novas). Registrado aqui como possível trabalho futuro se o Junior quiser
   separar por papel.
5. **Item 1 (contagem por categoria no card):** implementado com uma query leve adicional
   (`atividades_mensais.select("campanha_id, categoria")`, sem metadata) agregada no cliente — não
   uma RPC de agregação no banco, por simplicidade; volume por campanha (~100-150 linhas) não
   justifica o RPC nesta escala.

**Não verificado nesta rodada:** renderização real no navegador (sem autorização de
navegador/localhost nesta sessão) — fluxo completo (finalizar → aprovar → devolver com motivo →
reabrir aprovada → excluir com nome) recomendado para o @qa testar visualmente antes do PASS.

### Verificação executada

| Verificação | Resultado |
|---|---|
| `tsc --noEmit` | Limpo nos arquivos da story |
| `vitest run src/lib/programacao` | 108 passed, 0 failed (nenhum teste novo — story é UI/rota, sem lib pura nova) |
| `eslint` nos 3 arquivos alterados | Só os 8 erros pré-existentes (`any`), 0 novos |
| Migration aplicada + verificada via MCP (read-only) | `campanha_historico` criada, RLS habilitada, 2 policies ativas, 2 FKs corretas |

### Cobertura de Acceptance Criteria

| AC | Status |
|---|---|
| 1. Lista em cards com status correto e ações válidas por status | ✅ implementado |
| 2. "Enviar para aprovação" bloqueado com pontos visíveis | ✅ implementado (bloqueio no servidor, mensagem com contagem) |
| 3. Devolver exige motivo, aparece no histórico, volta pra rascunho | ✅ implementado |
| 4. Aprovar dispara embeddings; rascunho/pendente não aparecem no RAG | ✅ já garantido pelo trigger existente (confirmado por leitura) |
| 5. Reabrir aprovada exige confirmação e retira do RAG | ✅ implementado (mesmo trigger cobre a retirada) |
| 6. Permissões existentes continuam valendo | ✅ mesma checagem `has_permission('programacao','update')` em todas as 4 transições |

## File List

| Arquivo | Mudança |
|---|---|
| `supabase/migrations/20260909230000_s_prog_04_campanha_historico.sql` | **novo** — tabela de histórico de transições, RLS |
| `cuca-portal/src/app/api/programacao/status/route.ts` | Reescrito — centraliza as 4 transições, motivo obrigatório, bloqueio de revisão, grava histórico |
| `cuca-portal/src/app/(dashboard)/programacao/mensal/[id]/page.tsx` | Botões "Devolver para ajuste"/"Reabrir" com `AlertDialog`, linha do tempo de histórico, tooltips de ajuda (item 6), "Aprovar" migrado pra rota centralizada |
| `cuca-portal/src/app/(dashboard)/programacao/page.tsx` | Tabela → cards na aba Mensal, contagem por categoria, exclusão nominal (item 5) |

## Change Log

| Data | Autor | Mudança |
|---|---|---|
| 2026-09-08 | @sm (River) | Story criada |
| 2026-09-09 | @po (Pax) | Validado GO (documento `VALIDACAO-PO-stories-programacao-2026-09-08.md`) — status não havia sido atualizado no arquivo da story até agora |
| 2026-09-09 | @dev (Dex) | Status Draft → Ready → InProgress → InReview; implementação completa; migration aplicada em produção; 0 lint/tsc novos |
