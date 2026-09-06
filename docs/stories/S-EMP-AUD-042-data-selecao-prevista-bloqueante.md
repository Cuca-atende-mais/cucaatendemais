# S-EMP-AUD-042 — Data prevista da seleção como campo bloqueante na criação de vaga

**Status:** Done
**Epic:** Auditoria Empregabilidade
**Origem:** Demanda direta do Junior 2026-09-05 —
`docs/2026-09-05/PLANO-3-melhorias-empregabilidade-2026-09-05.md`, item 3.
**Prioridade:** P1 | **Esforço:** M | **Risco:** LOW/MED — migration aditiva e nullable (LOW), mas
mexe em dois formulários e numa rota **pública**, e o caminho de edição de vagas antigas pode
travar a equipe se a regra for aplicada sem cuidado (MED).
**Depende de:** nada tecnicamente. Ordem definida pelo Junior: última da leva de 4 — é a única que
não toca `worker/empregabilidade_engine.py`, então pode inclusive andar em paralelo às outras se
o Junior quiser.
**Deploy:** migration aplicada pelo @dev via MCP durante o desenvolvimento (regra
`aiox-pipeline-enforcement.md`) + redeploy do serviço **`portal`** no EasyPanel após o merge.

## Contexto

Empresas cadastram vagas sem informar quando a seleção vai acontecer, e a equipe fica sem
previsão para se organizar.

### Metade já existe — levantamento do @dev

- **`/empregabilidade/selecao/nova`** (formulário de "marcar seleção") **JÁ bloqueia**:
  `page.tsx:93` — *"Informe ao menos uma data de seleção."* — e a API
  `api/empregabilidade/selecao/route.ts:59` **também valida no servidor**. ✅ Nada a fazer.
- **`/empregabilidade/vagas/nova`** (formulário de vaga, preenchido pela empresa via link assinado
  enviado pelo worker) **não tem nenhum campo de data** — nem no cliente nem na API
  (`api/empregabilidade/vagas/route.ts` valida `empresa_id`, `titulo`, `descricao`,
  `tipo_contrato`, `unidade_destino` e `setor`, e nada mais). ⛔ É o buraco.
- **`vaga-modal.tsx`** (cadastro interno da equipe pelo portal) também não tem data. ⛔ Confirmado
  pelo Junior (05/09): **a regra vale igual aqui** — sem isso, a equipe seguiria criando vaga sem
  data e a regra ficaria furada.

### Coluna nova, não reaproveitamento

`vagas` já tem `datas_selecao` (jsonb), mas ela **não** deve ser reusada para vaga normal. O @dev
rastreou os consumidores:
- `worker/empregabilidade_engine.py:1396` monta o texto de **convocação** a partir de
  `datas_selecao[0]` quando `coleta_curriculo = false` — para **qualquer** vaga, não só seleção;
- `api/empregabilidade/notificar-selecionado/route.ts:42` lê `tipo` + `datas_selecao` para montar
  a mensagem enviada ao candidato.

Preenchê-la numa vaga normal **mudaria mensagem que já vai para o lead hoje**. Coluna nova = zero
efeito colateral. (A listagem de seleções filtra por `tipo === 'selecao_evento'`, então o reuso não
"vazaria" na tela — mas o risco está nas duas mensagens acima, não na listagem.)

## O que precisa ser implementado

### Item A — Migration

`ALTER TABLE vagas ADD COLUMN IF NOT EXISTS data_selecao_prevista date` — nullable, idempotente,
retrocompatível (expand/contract). Vagas existentes ficam `NULL`.

### Item B — Formulário público da empresa + API

`cuca-portal/src/app/empregabilidade/vagas/nova/page.tsx` e
`cuca-portal/src/app/api/empregabilidade/vagas/route.ts`:

- campo de data obrigatório, com a validação **também no servidor** — `required` de HTML é
  contornável e a rota é **pública** (protegida por link assinado, mas o corpo do POST é livre);
- **duas mensagens de erro distintas**, não uma genérica:
  - vazio → algo como *"Para prosseguir, informe uma data prevista para a seleção."* (redação do
    Junior: avisar que **precisa informar qualquer data prevista** para avançar);
  - data no passado → mensagem própria, deixando claro que é a data que está inválida, não ausente.
- **Rejeitar data anterior a hoje** (decisão explícita do Junior, 05/09) — erro de digitação de
  ano é comum.

### Item C — Modal interno da equipe

`cuca-portal/src/components/empregabilidade/vaga-modal.tsx` — **mesma regra na criação**.

⚠️ **Na edição, cuidado:** vagas criadas antes da coluna existir têm `data_selecao_prevista = NULL`.
A exigência vale **ao salvar**, nunca ao abrir o registro — senão a equipe trava numa edição não
relacionada (ex.: corrigir um título) por causa de um campo que não existia quando a vaga nasceu.

## Acceptance Criteria

1. Formulário público de vaga: submeter **sem** data prevista é bloqueado, com mensagem explicando
   que é preciso informar uma data prevista para prosseguir.
2. A API `POST /api/empregabilidade/vagas` rejeita a requisição sem `data_selecao_prevista` com
   **400** e mensagem clara — mesmo que o cliente seja contornado.
3. Data **anterior a hoje** é rejeitada, no cliente **e** no servidor, com mensagem própria,
   distinta da de campo vazio.
4. Data válida é persistida em `vagas.data_selecao_prevista` e o restante do cadastro segue
   funcionando igual (número sequencial, `status='pre_cadastro'`, notificação do worker).
5. Modal interno: **criação** de vaga exige a data, com o mesmo critério e as mesmas duas mensagens.
6. Modal interno: **edição** de vaga antiga (`data_selecao_prevista = NULL`) abre normalmente; a
   exigência aparece só ao salvar.
7. **Não regride:** o formulário e a API de **seleção** (`/empregabilidade/selecao/nova`) seguem
   exatamente como estão — esta story não os toca.
8. **Não regride:** `datas_selecao` não é alimentada por este fluxo — a convocação
   (`empregabilidade_engine.py:1396`) e a notificação de selecionado
   (`notificar-selecionado/route.ts`) continuam com o comportamento atual.
9. A migration é idempotente e vagas existentes continuam válidas com `NULL`.
10. Nenhuma mudança vale em tempo real: a coluna nova é **inerte** até o portal redeployado passar
    a exigi-la.

## Escopo

**In:** os 10 ACs acima — migration, formulário público, rota da API e modal interno.
**Out:**
- alterar o formulário/rota de **seleção** (já resolvido);
- exibir a data nova nas telas de listagem/detalhe de vaga, no card da vaga do WhatsApp
  (S-EMP-CARD-01) ou em qualquer mensagem ao candidato — **decisão consciente**: esta story só
  captura o dado. Exibir é incremento posterior, se o Junior quiser;
- backfill de `data_selecao_prevista` nas vagas antigas;
- tornar a coluna `NOT NULL` no banco — a validação é de aplicação; `NOT NULL` quebraria as vagas
  já existentes e qualquer inserção legada.

## ⚠️ Análise de impacto — por item

### Item A — Migration `ADD COLUMN data_selecao_prevista date`

- **Toca:** tabela `vagas` no banco `cuca` (produção).
- **Consome hoje:** ninguém — coluna nova, nullable.
- **Impacto observável:** nenhum. Aditiva e retrocompatível.
- **De-risk concreto:** `IF NOT EXISTS`; `execute_sql` read-only depois, confirmando o tipo (`date`)
  e `is_nullable = YES`.

### Item B — Validação no formulário público e na API

- **Toca:** `cuca-portal/src/app/empregabilidade/vagas/nova/page.tsx` e
  `cuca-portal/src/app/api/empregabilidade/vagas/route.ts`.
- **Consome hoje:** a empresa que recebe o link assinado gerado pelo worker (`_assinar_link_portal`,
  etapa `escolhendo_tipo_vaga`, `empregabilidade_engine.py:~2690`). É **rota pública** — validar só
  no cliente não é validar.
- **Impacto observável:** empresa não consegue mais cadastrar vaga sem data prevista. Efeito
  colateral desejado: a equipe passa a ter previsão para se organizar.
- **Risco:** uma empresa **no meio do preenchimento** durante o redeploy pode ter o POST rejeitado
  por um campo que não estava no formulário que ela abriu. Janela curta e o worker reenvia o link
  (etapa `aguardando_retorno_vaga` já trata "formulário ainda não preenchido"), mas o @dev deve
  garantir que a mensagem de erro 400 seja legível e não um erro cru.
- **De-risk concreto:** `npm run build` e `npx tsc --noEmit` no portal; POST sem o campo → 400 com
  mensagem correta; POST com data no passado → 400 com a **outra** mensagem.

### Item C — Modal interno (criação e edição)

- **Toca:** `cuca-portal/src/components/empregabilidade/vaga-modal.tsx`.
- **Consome hoje:** a equipe CUCA criando **e editando** vagas pelo portal.
- **Impacto observável:** criação passa a exigir a data (paridade com a empresa, como o Junior
  pediu). **Risco principal:** aplicar a regra sem distinguir criação de edição travaria a equipe
  em qualquer alteração de vaga antiga — o oposto do objetivo.
- **De-risk concreto:** AC6 é teste obrigatório, não observação: abrir uma vaga real com
  `data_selecao_prevista = NULL`, confirmar que abre, e que a exigência só aparece ao salvar.

### Item D — Não contaminar `datas_selecao`

- **Toca:** nada — é uma restrição, não uma mudança.
- **Consome hoje:** `empregabilidade_engine.py:1396` (texto de convocação) e
  `notificar-selecionado/route.ts:42` (mensagem ao candidato selecionado) — **mensagens que já vão
  para o lead hoje**.
- **Impacto observável:** nenhum, se a restrição for respeitada. Se o @dev decidir "aproveitar" a
  jsonb existente, o texto de convocação de vagas normais muda sem ninguém pedir.
- **De-risk concreto:** AC8 verifica explicitamente que `datas_selecao` segue vazia neste fluxo.

## Test plan

- Migration: aplicar via MCP e conferir a coluna com `execute_sql` (AC9).
- API: POST sem o campo → 400 (AC2); POST com data passada → 400 com mensagem distinta (AC3);
  POST válido → 201/200 e valor persistido (AC4).
- Formulário público: submit vazio bloqueado com a mensagem certa (AC1).
- Modal interno: criação exige (AC5); edição de vaga com `NULL` abre e só exige ao salvar (AC6).
- Regressão: fluxo de **seleção** intacto (AC7); `datas_selecao` não preenchida (AC8).
- `npm run build`, `npx tsc --noEmit`, `npm run lint` no `cuca-portal`.
- ⚠️ **Sem navegador, sem localhost** (`qa-testes-sem-navegador-ao-vivo.md`) — validação por build,
  typecheck, teste de rota e leitura de código. Se o Junior quiser conferência visual do
  formulário, ele autoriza explicitamente no momento.

## File List

- `supabase/migrations/20260906140000_s_emp_aud_042_data_selecao_prevista.sql` — Item A,
  `ALTER TABLE vagas ADD COLUMN IF NOT EXISTS data_selecao_prevista date` (aditiva, nullable,
  idempotente). Aplicada via MCP e conferida em produção.
- `cuca-portal/src/lib/empregabilidade/data-selecao-prevista.ts` (novo) — módulo compartilhado
  de validação: `hojeBrasilISO()` (via `Intl.DateTimeFormat`, timeZone `America/Fortaleza`, sem
  matemática de offset manual) e `validarDataSelecaoPrevista()`, usado nos três pontos (cliente
  público, cliente do modal interno, servidor) pra garantir que as duas mensagens de erro e o
  critério de "hoje" nunca divirjam entre front e back.
- `cuca-portal/src/lib/empregabilidade/data-selecao-prevista.test.ts` (novo) — 11 testes:
  ausência (undefined/vazio/espaços/tipo errado), formato inválido, data no passado, data de
  hoje (limite exato), data futura válida, trim.
- `cuca-portal/src/lib/types/database.ts`: campo `data_selecao_prevista: string | null`
  adicionado ao tipo `Vaga`.
- `cuca-portal/src/app/api/empregabilidade/vagas/route.ts` — Item B: valida
  `data_selecao_prevista` no servidor (AC2/AC3) antes do insert; persiste o valor validado.
- `cuca-portal/src/app/empregabilidade/vagas/nova/page.tsx` — Item B: campo de data no
  formulário público (`min` = hoje), validação no cliente antes do POST (AC1), valor enviado no
  body.
- `cuca-portal/src/components/empregabilidade/vaga-modal.tsx` — Item C: campo de data na seção
  de criação (`handleSave`, `!vaga`) — obrigatório, mesma validação (AC5). Campo também
  carregado e exibido (somente leitura) na edição de vaga existente, mas `handleSaveStatus`
  (o caminho real de edição, ver Dev Agent Record) nunca o valida nem persiste — AC6.

## Dev Agent Record

- **`handleSave` vs. `handleSaveStatus` — só um dos dois é o caminho de edição real:**
  antes de mexer, rastreei os dois botões de salvar do modal. O botão chama
  `camposEmpresaReadOnly ? handleSaveStatus : handleSave` — e `camposEmpresaReadOnly = !!vaga`.
  Ou seja: **editar uma vaga existente (`vaga` truthy) sempre vai por `handleSaveStatus`**, nunca
  por `handleSave` — mesmo que `handleSave` tecnicamente tenha um branch `if (vaga) { update }
  else { insert }`, esse branch de update é inalcançável pela UI. Isso definiu a implementação
  do AC6: a exigência da data entra só em `handleSave` (criação de verdade); `handleSaveStatus`
  não foi tocado — nunca vai exigir nem gravar `data_selecao_prevista`, então uma vaga antiga
  com `NULL` abre e salva normalmente, sem qualquer bloqueio novo. Isso é estrutural, não uma
  checagem condicional que poderia ser esquecida num caminho e lembrada no outro.
- **Campo também exibido (somente leitura) na edição, por consistência com o padrão já
  existente no arquivo:** os outros campos preenchidos pela empresa (`local`, `salário`, etc.)
  já são carregados e mostrados com `readOnly` quando `camposEmpresaReadOnly`, em vez de
  ocultados — segui o mesmo padrão para `data_selecao_prevista`, em vez de escondê-lo. Isso é
  puramente de exibição (via `carregarDadosPreAbertura`) e não interfere no comportamento do
  AC6, já que `handleSaveStatus` nunca lê esse state.
- **`Intl.DateTimeFormat` em vez de matemática de offset manual, decisão deliberada de
  timezone-safety:** dado o contexto recente da leva (S-EMP-AUD-040 já tratou fuso explicitamente
  no worker; S-EMP-AUD-044, ainda não implementada, é justamente uma varredura de datas naive) e
  a preocupação já expressa pelo Junior sobre corrupção de dado por timezone, usei
  `Intl.DateTimeFormat("en-CA", { timeZone: "America/Fortaleza" })` pra obter "hoje" — funciona
  igual no navegador do usuário e no runtime do servidor (que roda em UTC no container),
  sem depender do relógio/fuso local de nenhum dos dois. Comparação é puramente lexicográfica de
  strings `YYYY-MM-DD` (nunca `new Date(...) < new Date()`, que compararia instantes, não datas
  de calendário — um bug clássico que rejeitaria "hoje" como passado dependendo da hora do dia).
- **Módulo de validação único, compartilhado entre os 3 pontos** (cliente público, cliente do
  modal, servidor) — decisão consciente pra evitar que a mensagem de erro ou o critério de "data
  no passado" divirjam entre front e back com o tempo (ex.: alguém ajustar só um lado depois).
- **Build de verificação exigiu ambiente próprio no worktree:** `git worktree` não compartilha
  `node_modules` nem `.env.local` (gitignored) com o diretório principal. O Turbopack falhou com
  symlink de `node_modules` apontando "fora do filesystem root" — troquei por `npm install` real
  no worktree; e o build de produção falhou primeiro por falta de `.env.local` (erro do Supabase
  SSR numa página não relacionada, `academia-enem/base-conhecimento`) — confirmei que esse erro
  já existia no ambiente sem `.env.local` independente da minha mudança, copiei o `.env.local`
  real do diretório principal, e o build passou limpo (`exited with code 0`), incluindo
  `/empregabilidade/vagas/nova` prerenderizada como estática.
- **`npx tsc --noEmit`:** 4 erros pré-existentes em `tests/*.test.ts` (import com extensão `.ts`,
  `TS5097`) — confirmei que já existem idênticos no `main` sem minha mudança (não são
  regressão). Nenhum erro novo introduzido pelos arquivos desta story.
- **De-risk do Item A (AC9) rodado de fato:** `execute_sql` antes (coluna não existia) e depois
  (`data_selecao_prevista`, tipo `date`, `is_nullable = YES`) da migration — e
  `count(*) / count(data_selecao_prevista)` nas 31 vagas existentes confirmou 31 vs. 0: todas
  seguem válidas, todas `NULL`.
- **AC7/AC8 confirmados por diff vazio, não por leitura:** `git diff` contra os arquivos de
  `/empregabilidade/selecao/*` e `/api/empregabilidade/selecao/*` não mostra nenhuma mudança;
  `grep datas_selecao` nos 3 arquivos tocados não encontra nenhuma ocorrência — a jsonb legada
  não é lida nem escrita por este fluxo.
- **Testes:** `npx vitest run` — 48 passed (37 pré-existentes + 11 novos), 0 falhas.
- **Worktree:** implementado em `/home/valmir/Documentos/cucaatendemais-s-emp-aud-042` (`git
  worktree`), branch `fix/s-emp-aud-042-data-selecao-prevista-bloqueante`, a partir de
  `origin/main` já com S-EMP-AUD-040 e S-EMP-AUD-041 mergeadas.
- **Sem navegador/localhost usado** (`qa-testes-sem-navegador-ao-vivo.md`) — validação só por
  testes, build e typecheck, conforme o test plan da própria story já previa.

## QA Results

### Review em 2026-09-06 — @qa Quinn

**Gate: PASS**

**7 checks:**

1. **Code review** — PASS. Li o diff completo, não só a descrição do @dev. Confirmei
   pessoalmente, lendo `handleSaveStatus` linha a linha, que ele **não referencia**
   `data_selecao_prevista` em nenhum ponto — nem no payload do `update`, nem em nenhuma
   validação. A afirmação do @dev de que a edição de vaga existente é estruturalmente imune à
   nova exigência (não é uma checagem condicional que poderia ser esquecida) é fato confirmado,
   não aceito de bandeja. `route.ts` e `page.tsx` seguem o mesmo padrão defensivo do
   `montarMensagemEncaminhamento`/`buscarNumeroCanal` já visto na S-EMP-AUD-041 (validação
   sempre no servidor, nunca só no cliente, para rota pública).
2. **Testes** — PASS. Rodei a suíte de forma independente: **48/48**. Escrevi 4 casos próprios
   (não reaproveitando os do @dev) num arquivo temporário, incluindo um teste específico pra
   provar que a comparação de data é lexicográfica (string `YYYY-MM-DD`) e não por instante —
   removi o arquivo depois, não fica na story.
3. **Acceptance Criteria** — PASS, 10/10 verificados por mim:
   - AC1/AC2 ✅ `validarDataSelecaoPrevista("")` → rejeitado, mesma mensagem no cliente
     (`page.tsx`) e no servidor (`route.ts`) — módulo compartilhado, não duas implementações que
     poderiam divergir.
   - AC3 ✅ reproduzi com data de ontem (calculada dinamicamente, não hardcoded) → rejeitada; data
     de amanhã → aceita; data de hoje (limite exato) → aceita, não é "passado". Mensagem distinta
     da de campo vazio, confirmado nas constantes exportadas.
   - AC4 ✅ conferido no diff de `route.ts`: `numero_vaga`, `status: "pre_cadastro"` e o bloco de
     notificação do worker (linhas seguintes ao insert) **não foram tocados** — só a validação e
     o campo novo no payload foram adicionados.
   - AC5 ✅ `handleSave` (criação) valida e persiste; botão "Salvar Vaga" fica desabilitado sem a
     data (`disabled` atualizado corretamente, só no branch de criação).
   - AC6 ✅ **o achado mais importante desta revisão**, verificado por mim de forma independente:
     `camposEmpresaReadOnly = !!vaga` e o botão chama `handleSaveStatus` quando `vaga` existe —
     confirmei isso lendo o JSX do botão, não só a alegação do Dev Agent Record. Uma vaga antiga
     com `data_selecao_prevista = NULL` carrega `""` no state (sem crash) e o caminho de salvar
     dela nunca valida nem grava o campo.
   - AC7 ✅ `git show HEAD --name-only` não lista nenhum arquivo de `/empregabilidade/selecao/*`
     nem `/api/empregabilidade/selecao/*` — zero mudança, confirmado pela ausência total, não por
     leitura de um diff vazio de um arquivo específico.
   - AC8 ✅ `datas_selecao` (jsonb) não aparece em nenhum código do diff — só na mensagem do
     commit, explicando a decisão de não reutilizá-la.
   - AC9 ✅ `execute_sql` (read-only) independente: `data_selecao_prevista`, tipo `date`,
     `is_nullable = YES`, `column_default = null`.
   - AC10 ✅ a coluna só passa a ser exigida pelo código que só existe a partir deste PR — inerte
     até o redeploy do `portal`.
4. **Sem regressões** — PASS. `npx tsc --noEmit` rodado por mim de forma independente: os mesmos
   4 erros pré-existentes (`TS5097`, arquivos de teste com import `.ts`) — confirmei que já
   existem idênticos no `main` sem a mudança desta story.
5. **Performance** — PASS. Validação é regex + comparação de string, sem I/O extra; `Intl.
   DateTimeFormat` é nativo, sem overhead relevante.
6. **Segurança** — PASS. A rota pública (`route.ts`) valida no servidor, não confia no `required`
   do HTML — é o ponto certo, já que o link assinado só protege `empresa_id`, não o corpo do POST.
7. **Documentação** — PASS. File List e Dev Agent Record batem com o diff real, item por item; a
   observação sobre `handleSave` vs. `handleSaveStatus` é precisa e foi o que guiou minha
   verificação do AC6.

**Achado próprio, não bloqueante:** o campo "Data prevista da seleção" aparece também na visão
somente-leitura de edição de uma vaga (dentro do bloco `opacity-70 pointer-events-none`), por
consistência com os demais campos preenchidos pela empresa já tratados assim no arquivo. Isso é
só exibição — `handleSaveStatus` nunca lê esse state — mas registro que não estava
explicitamente pedido pela story (que fala só em migration + formulário público + criação no
modal). Não é um problema, é uma escolha de consistência de UI razoável; sinalizo para
consciência, não para correção.

**Nenhum item bloqueia o avanço.** Recomendo seguir para @devops.

## Change Log

- v0.5 (2026-09-06): @devops confirma — PR #155 **mergeado** e `portal` **redeployado** no
  EasyPanel (confirmado pelo Junior). Nenhuma pendência restante — última story da leva de 4.
  Status: Ready for Review → **Done**.
- v0.4 (2026-09-06): @qa revisa — **PASS**, 7/7 checks, 10/10 ACs confirmados por verificação
  independente (suíte rodada de novo pelo @qa: 48/48; AC6 verificado lendo o código-fonte de
  `handleSaveStatus` linha a linha, não aceito da alegação do Dev Agent Record; AC7/AC8
  confirmados pela ausência total de arquivos/referências no diff, não por leitura pontual; AC9
  conferido com `execute_sql` read-only independente). 1 achado próprio, não bloqueante: campo
  também exibido (somente leitura) na visão de edição, por consistência de UI — não pedido
  explicitamente pela story, mas inofensivo. Status: InReview → **Ready for Review** (aguardando
  @devops).
- v0.3 (2026-09-06): @dev implementa. Migration aplicada e conferida em produção (AC9); campo
  bloqueante adicionado no formulário público (Item B) e no modal interno — só na criação, não
  na edição (Item C/AC6), com rastreamento explícito de qual função (`handleSave` vs.
  `handleSaveStatus`) é o caminho real de cada caso. Validação centralizada num módulo
  compartilhado entre cliente e servidor, com comparação de data timezone-safe
  (`Intl.DateTimeFormat`, fuso `America/Fortaleza`) em vez de `new Date()` ingênuo. Build de
  produção completo e `vitest` (48/48) verdes. Status: Ready → **InReview** (aguardando @qa).
- v0.2 (2026-09-05): @po valida — **GO** (10/10). A story de melhor recorte da leva: escopo
  reduzido por levantamento real (o formulário de seleção já bloqueava e ficou de fora), a escolha
  de coluna nova está justificada com os dois consumidores rastreados, e o caminho de edição de
  vaga antiga — o mais provável de travar a equipe — virou AC próprio em vez de observação. Nenhuma
  correção necessária. Status: Draft → **Ready**.
- v0.1 (2026-09-05): @sm cria a story a partir do item 3 do planejamento do @dev, com o escopo já
  corrigido pelo levantamento: o formulário de **seleção** já bloqueia (cliente e servidor) e fica
  fora — o buraco é o formulário de **vaga**. Decisões do Junior (05/09) travadas: vale **também**
  para o cadastro interno da equipe, e **data no passado é rejeitada**. Coluna nova em vez de
  reaproveitar `datas_selecao`, porque a jsonb existente alimenta duas mensagens que já vão para o
  lead. O cuidado com a edição de vagas antigas virou AC próprio (AC6) por ser o caminho mais
  provável de travar a equipe. Status: Draft — aguardando validação do @po.
