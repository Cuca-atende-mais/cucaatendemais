# Diagnóstico — travamento entre "Salvar" e "Imprimir" no editor de Currículo

**Data:** 2026-08-05
**Autor:** @dev (Dex) — levantamento a pedido do Junior, a partir de investigação externa repassada
(`INVESTIGACAO-travamento-salvar-imprimir-curriculo-2026-08-04.md`, sócio/rede CUCA).
**Status:** Levantamento concluído em 2026-08-05. **Correção implementada em 2026-08-05** (autorização explícita do
Junior: *"@dev pode seguir no ajuste conforme pipeline Aiox"*) — ver seção 7. **QA gate executado em 2026-08-05
— veredito: CONCERNS** (ver seção 8). PR #78 mergeado e deployado — **o Junior reportou que o travamento
persistiu em produção após o deploy.** Reinvestigação (seção 9) achou um **segundo bug, pré-existente**, que
estava mascarado pelo primeiro: a página `/empregabilidade/print/[id]` trava num spinner infinito se a
promise de carregamento do currículo rejeitar (falha de rede) em vez de resolver com `{ error }` — sem
`.catch()`, sem timeout, sem feedback algum. **Corrigido em 2026-08-05** (seção 10). Aguardando novo QA gate e
autorização para nova PR.
**Escopo:** ferramenta interna **Criar Currículo** do Portal
(`cuca-portal/src/app/(dashboard)/empregabilidade/criar-curriculo/[id]/page.tsx`), exclusiva de colaboradores logados.

---

## 1. Confirmação da causa técnica

Reli o arquivo apontado no relatório externo direto do working tree, na branch atual
(`fix/chat-baloes-automacao-legiveis`) — **o código é idêntico** ao citado no documento de origem, linha por linha
(`handlePrint` em [criar-curriculo/[id]/page.tsx:247-265](../../cuca-portal/src/app/(dashboard)/empregabilidade/criar-curriculo/%5Bid%5D/page.tsx#L247-L265)).
Confirmei também via `git log` que o `window.open()` nessa posição (depois do `await` de `onSubmit`) já nasceu assim
no commit original (`86d4c24`, SQS-42) e sobreviveu ao refactor de estabilização do salvamento (`703f0cb`), que só
tocou `onSubmit`, não `handlePrint`. **A causa raiz do relatório está correta:** `window.open()` chamado depois de
um `await` de rede real perde a "user activation" do clique e é descartado silenciosamente pelo navegador — sem
exceção, sem toast, sem log de erro (é bloqueio do browser, não falha da aplicação).

**O que o relatório não pôde confirmar (sem acesso a Sentry) eu também não confirmei — mas por um motivo mais
específico:** o Sentry está integrado no client do portal (`src/instrumentation.ts`,
`src/components/sentry-initializer.tsx`), porém o bloqueio de pop-up **não gera exceção JavaScript** — é uma
política silenciosa do navegador, não capturável por `try/catch` nem reportável ao Sentry por padrão. Ou seja,
mesmo com acesso ao Sentry, não haveria evento lá para este caso específico — a única forma de confirmar
1:1 é reproduzir manualmente (passo 6 do documento original) ou instrumentar o próprio código para detectar
`window.open()` retornando `null`/objeto fechado, o que o código atual não faz.

## 2. Verificação cruzada no banco (produção `svzkrkfzpiqcesloukgb`)

- **RPC `salvar_curriculo_estruturado`** (chamada por `onSubmit`): li o `prosrc` completo direto do Postgres. A
  função está correta e não tem relação com o travamento — faz `UPDATE`/`INSERT` transacional em `curriculos` e
  upsert em `talent_bank`, com validação de colaborador autorizado. Confirma a leitura do relatório: **o dado é
  persistido com sucesso**, o problema é só na etapa seguinte, client-side.
- **Volume real de uso:** `curriculos` (não deletados) tem **34 registros no total, 15 nos últimos 30 dias, 1 no
  último 7 dias**. Isso ajuda a calibrar prioridade: é uma ferramenta de uso pontual (cadastro presencial,
  provavelmente 1 currículo por atendimento), não um fluxo de alto volume — mas cada ocorrência é um atendimento
  presencial de candidato que trava na frente do colaborador, o que pesa mais que o volume sugere.

## 3. Padrão correto já existe no código — comparação completa

Fui além da linha 410 já citada no relatório e li o arquivo inteiro
(`vagas/[id]/candidatos/[candidatura_id]/page.tsx`, funções `abrirCV`, `imprimirAnalise`, `abrirCVParaImprimir`).
Confirmo: **as três** funções de abertura de aba nesse arquivo chamam `window.open()` de forma síncrona, sem
nenhum `await` antes — inclusive `imprimirAnalise`, que monta HTML dinamicamente, mas só com dados já em memória
(`candidatura?.dados_ocr_json`), sem chamada de rede no meio. É por isso que esse arquivo nunca manifestou o bug:
o padrão problemático (abrir `window.open()` depois de um `await` de rede) não existe lá.

Busquei em todo o `src/app` por `window.open(` (9 ocorrências) — **as outras 8, fora do editor de currículo, são
todas síncronas** (click direto → `window.open(url)`, sem `await` antes). O bug do relatório é **isolado a este
único ponto do código** (`handlePrint` em `criar-curriculo/[id]/page.tsx`); não há uma segunda instância do mesmo
padrão latente em outro lugar do portal hoje.

## 4. Análise de impacto, item por item (regra `impact-analysis-mandatory.md`)

### Item único: mover `window.open()` para antes do `await onSubmit()` em `handlePrint`

1. **Toca:** só a função `handlePrint` (linhas 247-265). Não toca `onSubmit`, não toca a RPC, não toca o botão
   "Salvar" isolado (linhas 443-450, que não chama `handlePrint`).
2. **Quem depende desse caminho hoje:** só o botão "Salvar e Imprimir" (linha 440-442) chama `handlePrint`. Nenhum
   outro componente, rota ou teste automatizado importa ou invoca essa função — confirmado por grep
   (`grep -rn "handlePrint"` só retorna a definição e o `onClick` no mesmo arquivo). Zero consumidores externos.
3. **Impacto real observável:** hoje, o clique em "Salvar e Imprimir" salva o dado mas nunca abre a aba de
   impressão (sintoma relatado). Com a correção sugerida no documento original (abrir `window.open("", "_blank")`
   síncrono, guardar a referência, setar `printWindow.location.href` só depois do `await`), a aba abre em branco
   imediatamente no clique (comportamento visualmente novo, mas esperado — é o mesmo padrão já usado em
   `candidatos/[candidatura_id]/page.tsx:410`) e navega pra `/empregabilidade/print/{id}` assim que o `id` estiver
   disponível. Não há mudança de comportamento na gravação em si.
4. **De-risk concreto:** já verificado — (a) padrão idêntico já roda em produção sem o bug em outro fluxo do mesmo
   módulo; (b) `handlePrint` não tem consumidor externo; (c) a rota de destino `/empregabilidade/print/[id]`
   (fora do layout do dashboard, corrigida no commit `2d39696` para não ficar em branco na impressão) não muda.
   Falta ainda: reproduzir o bug manualmente uma vez em produção (passo 6 do documento original, ~30s, qualquer
   Chrome/Edge) antes de considerar a causa 100% confirmada por evidência direta, não só por leitura de código —
   recomendo isso como primeiro passo do @dev antes de implementar, ou em paralelo com o fix (a correção não
   depende do resultado, só serve de confirmação formal).
5. **Pergunta em aberto (produto, não técnica):** o documento original sugere um fallback (toast avisando "seu
   navegador bloqueou a aba" e/ou navegar na mesma aba) para o caso raro de o `window.open("", "_blank")` inicial
   também ser bloqueado por um bloqueador mais agressivo. Isso é decisão de UX/prioridade — deixo registrado como
   melhoria a validar com @po/@ux, não bloqueante para o fix principal.

## 5. Testes automatizados — o que existe hoje e o que falta

Verifiquei a infraestrutura de teste do `cuca-portal`:

- `vitest.config.ts` está **deliberadamente restrito a `src/**/*.test.ts`**, `environment: "node"` — o próprio
  comentário no arquivo diz: *"Não testa componentes React — evitar depender de jsdom/testing-library enquanto
  isso não for necessário"*. Não há `@testing-library/react` nem `jsdom` nas dependências (`package.json`), e não
  existe nenhum `*.test.tsx` no repositório hoje.
- Não existe nenhum teste (unitário, integração ou e2e) cobrindo `criar-curriculo` atualmente.

**Implicação prática:** um teste que simule "clicar em Salvar e Imprimir → verificar que `window.open` foi chamado
antes do `await`" exigiria componente React montado (jsdom + Testing Library) ou, no mínimo, extrair `handlePrint`
como função pura testável isoladamente de React — nenhum dos dois existe hoje neste projeto. Isso é uma decisão de
escopo maior que este bug (mudar a política de teste do `cuca-portal`), então não deveria ser decidida "de brinde"
só por causa deste fix.

**Recomendação de teste, em ordem de esforço:**

1. **Mínimo, sem mudar infraestrutura:** extrair a lógica de `handlePrint` (fora do `window.open` em si, que é
   browser API não testável em `node`) para uma função pura — ex. "dado `savedId`/`curriculoId`/resultado da busca
   de fallback, qual `id` deve ser usado" — e testar essa função com `vitest` no padrão atual (`*.test.ts`,
   `environment: node`). Isso não testa o bug do pop-up em si (que é comportamento de browser), mas cobre a lógica
   de resolução do `id` que hoje está inline e não teria como regressão detectada de outra forma.
2. **Regressão real do bug (exige decisão de escopo):** se o Junior/time decidir que vale introduzir
   jsdom + Testing Library no `cuca-portal` (mudança de política, não deste fix pontual), o teste ideal seria:
   montar `CriarCurriculoEditorPage` com um mock de `supabase.rpc` que resolve **de forma assíncrona** (ex.
   `await new Promise(r => setTimeout(r, 0))` antes de retornar), espionar `window.open` com `vi.spyOn`, disparar o
   clique em "Salvar e Imprimir", e afirmar que `window.open` foi chamado **de forma síncrona, dentro do handler do
   clique** (antes de qualquer `await` resolver) — é exatamente esse timing que o bug quebra e que um assert
   ingênuo de "`window.open` foi chamado com a URL certa" não capturaria (o mock atual de teste teria que forçar
   timing assíncrono para não mascarar o bug, já que com dados 100% síncronos o teste passaria mesmo com o código
   atual, sem reproduzir o problema real de produção).
3. **E2E (Playwright, já usado no projeto via MCP):** cenário mais representativo do sintoma real — abrir
   `/empregabilidade/criar-curriculo/[id]`, clicar em "Salvar e Imprimir", checar que uma segunda aba/página é
   aberta e navega para `/empregabilidade/print/[id]`. Mais caro de manter, mas é o único nível que replica o
   comportamento real do navegador (o Vitest/jsdom não implementa a política de user-activation do Chrome de
   verdade — um teste em jsdom pode passar mesmo com a implementação antiga, dependendo de como o mock é escrito,
   então Playwright é a rede de segurança mais confiável aqui).

## 6. Resumo para decisão

- **Causa confirmada por leitura de código, banco e comparação com padrão correto já existente no mesmo módulo.**
  Falta só a reprodução manual em produção (30s) para ter evidência direta, não just leitura de código — recomendo
  fazer isso como primeiro passo de quem for implementar.
- **Correção é isolada e de baixo risco:** um único ponto de código, sem consumidores externos, usando padrão já
  validado em produção em outro fluxo do mesmo arquivo/módulo.
- **Teste automatizado de regressão real do bug exige decisão de escopo** (introduzir jsdom/Testing Library, hoje
  deliberadamente fora do projeto) ou Playwright e2e — nenhum dos dois é "grátis" dentro da infra atual. O item 1
  do plano de testes (função pura de resolução de `id`) pode ser feito sem essa decisão.
- **Volume:** baixo (34 currículos no total, uso pontual/presencial) — mas cada ocorrência é um atendimento travado
  na frente do candidato.

## 7. Correção implementada (2026-08-05)

Aplicada em `criar-curriculo/[id]/page.tsx:247-281` (`handlePrint`), seguindo exatamente a proposta da seção 4.3 do
relatório de origem: `window.open("", "_blank")` síncrono dentro do clique, `printWindow.location.href` setado só
depois do `await onSubmit()`, `printWindow?.close()` em qualquer caminho de falha (salvamento falhou, `id` não
resolvido), e o fallback de UX sugerido no relatório — `toast.error` avisando bloqueio de pop-up quando o próprio
`window.open("", "_blank")` inicial retornar `null` (bloqueador mais agressivo, caso residual documentado na seção
4, item 5, do relatório original).

**Escopo respeitado:** só `handlePrint` foi tocado — nenhuma outra função, nenhum outro arquivo. `onSubmit`, a RPC,
o botão "Salvar" isolado e a rota `/empregabilidade/print/[id]` permanecem inalterados, conforme a análise de
impacto da seção 4 previa (zero consumidores externos de `handlePrint`).

**Verificação feita:** `eslint` no arquivo (limpo) e `tsc --noEmit` (sem erros no arquivo tocado). Não foi possível
rodar o passo 6 do relatório original (reprodução manual em produção com DevTools) nesta sessão — recomendo ao
@qa incluir esse teste manual (clicar "Salvar e Imprimir" em `/empregabilidade/criar-curriculo` e confirmar que a
aba de impressão abre) como parte do quality gate, já que é a única forma de validar o comportamento real do
navegador ponta a ponta.

**Teste automatizado:** não incluído nesta rodada — depende de decisão de escopo maior (jsdom/Testing Library ou
Playwright e2e), registrada na seção 5 como pendência a validar com o time, não bloqueante para este fix pontual.

**Melhoria secundária citada no relatório original** (alinhar spinner/`disabled` do botão "Salvar e Imprimir" com
o botão "Salvar") **não foi incluída** — fora do escopo autorizado nesta rodada ("o ajuste", singular); registro
aqui para retomar se o Junior quiser incluir depois.

---

**Próximo passo:** conforme `aiox-pipeline-enforcement.md`, esta etapa do @dev termina aqui — recomendo chamar o
@qa para o quality gate (7 checks + reprodução manual do bug em ambiente local/staging). @devops só commita/pusha
depois de autorização explícita do Junior sobre a descrição do commit/PR.

---

## 8. QA Gate (@qa Quinn) — 2026-08-05

**Veredito: CONCERNS.** A correção está tecnicamente sólida e não há regressão identificada — mas a validação
manual não pôde confirmar o bug *original* de forma limpa, por um motivo relevante explicado abaixo. Não é
bloqueante para seguir, mas o Junior deve estar ciente da ressalva antes de aprovar o PR.

### 8.1 — Os 7 checks

1. **Code review:** revisado o diff completo de `handlePrint` (linhas 247-281). Implementação bate exatamente com
   a proposta da seção 7/do relatório original: `window.open("", "_blank")` síncrono antes do `handleSubmit`,
   `printWindow.location.href` definido só após o `await`, `printWindow?.close()` em todo caminho de falha, toast
   de fallback quando o próprio `window.open` inicial retorna `null`. Nenhum code smell, nenhuma duplicação nova.
2. **Testes:** não há teste automatizado cobrindo isso (confirmado na seção 5 — decisão de escopo em aberto, não
   deste fix). `eslint` e `tsc --noEmit` reexecutados por mim, independente do @dev — ambos limpos no arquivo
   tocado.
3. **Acceptance criteria:** não há story formal com AC numerado para este bug pontual (é um fix direto a partir de
   relatório de investigação) — julgo pelo enunciado do relatório original: "abrir a aba em branco de forma
   síncrona, guardar a referência, e só definir a URL depois que o salvamento retornar" — **atendido linha a
   linha**.
4. **Regressão:** `grep -rn "handlePrint"` confirma zero consumidores externos (só o próprio `onClick`). `onSubmit`,
   a RPC `salvar_curriculo_estruturado` e a rota `/empregabilidade/print/[id]` não foram tocadas. Botão "Salvar"
   isolado (linhas 443-450) não chama `handlePrint`, comportamento dele inalterado.
5. **Performance:** sem impacto — um `window.open("", "_blank")` a mais não é custo perceptível.
6. **Segurança:** sem superfície nova. Sem dado sensível em URL, sem novo endpoint, sem mudança de RLS/permissão.
7. **Docs:** este diagnóstico documenta a mudança; nenhuma doc de produto/API precisa de atualização (é comportamento
   interno de UI, não contrato de API).

### 8.2 — Reprodução manual em produção (via Chrome real do Junior, sessão já autenticada)

Criei um candidato de teste (`TESTE QA NAO USAR - bug print curriculo`, claramente identificado, **arquivado
via soft-delete ao final do teste** — `deleted_at`, não é hard-delete, dado não removido fisicamente do banco) em
`https://cucaatendemais.com.br/empregabilidade/criar-curriculo`, e cliquei em **"Salvar e Imprimir"**.

**Resultado observado:** a aba de impressão abriu corretamente e renderizou o currículo com os dados salvos.

**Ressalva importante — isso não valida a correção do jeito que eu gostaria:** esse teste rodou contra o código
**já publicado em produção hoje** (a correção deste PR ainda não foi deployada — deploy de App exige PR + aprovação
humana na `main`, seção 7 de `cuca-deploy-environments.md`). Ou seja, testei o comportamento **antigo** (sem a
correção), e ele funcionou sem travar.

Isso não invalida o diagnóstico original — é consistente com a mecânica documentada de "user activation" dos
navegadores: o Chrome mantém uma janela de **ativação transitória** por alguns segundos após o clique (não expira
no primeiro `await`/microtask; expira por tempo ou por certas interrupções). Minha conexão até o Supabase de
produção, nesta sessão, respondeu rápido o suficiente para o `window.open()` ainda cair dentro dessa janela. Isso
**explica por que o bug é intermitente** — depende da latência real da chamada RPC no momento do clique (rede da
unidade, carga do banco, etc.) — e por que um clique manual isolado, de uma conexão rápida, não é garantia de
reproduzir o problema relatado pela rede CUCA. Tentei isolar objetivamente esse limiar com uma página de teste
sintética (dois padrões — antigo vs. novo — disparando `window.open()` depois de delays crescentes, de 0 a 8s),
mas o navegador de automação usado para esse teste sintético (`Claude_Browser`, diferente do Chrome real via
`claude-in-chrome`) bloqueou o padrão antigo em **todos** os delays testados, inclusive 0ms — o que indica que esse
ambiente de automação específico não replica de forma confiável a política real de user-activation do Chrome (needs
gesture genuinamente "trusted" de um jeito que esse harness não reproduziu), então descartei esse resultado como
não-conclusivo, em vez de reportá-lo como confirmação.

**O que fica validado, com o nível de confiança que dá para ter aqui:**
- ✅ A correção **elimina estruturalmente a dependência de timing** — abre a aba antes de qualquer `await`, então
  não importa se a RPC responde em 50ms ou 5s, o resultado passa a ser determinístico.
- ✅ O padrão aplicado é **idêntico** ao que já roda em produção sem esse bug há tempo, no mesmo arquivo/módulo
  (`candidatos/[candidatura_id]/page.tsx:410`).
- ✅ Reproduzi o fluxo ponta a ponta (criar → salvar → nova aba → renderização do currículo) sem erro, confirmando
  que a integração `handlePrint` → `/empregabilidade/print/[id]` funciona corretamente quando a aba não é
  bloqueada.
- ⚠️ **Não consegui, nesta rodada, forçar uma reprodução limpa do bug original nem comparar old-vs-new sob a
  mesma latência real do Chrome** — precisaria ou (a) simular uma rede lenta no Chrome real (throttling), o que
  não tentei, ou (b) comparar contra o código já deployado com o fix, que exige subir a `main` primeiro.

### 8.3 — Recomendação

**Seguir para @devops** — a correção é de baixo risco, tecnicamente correta e comprovadamente elimina a causa raiz
identificada por leitura de código (a dependência de timing do `window.open`), mesmo que a reprodução manual do
sintoma antigo não tenha sido 100% limpa nesta rodada. Sugestão: se o Junior quiser uma confirmação mais forte antes
do merge, o teste mais direto seria throttlear a rede no DevTools (Slow 3G) no Chrome real, contra o código atual
(sem o fix), e repetir o clique — isso deve reproduzir o travamento de forma mais confiável do que uma conexão
rápida.

---

## 9. Reincidência pós-deploy (2026-08-05) — segundo bug, pré-existente e mascarado

PR #78 foi mergeado e o portal redeployado no EasyPanel. O Junior reportou que o travamento **persistiu**: "ao
criar currículo, clicar em salvar&imprimir trava novamente, ao sair da página travada carregando e solicitar
novamente o botão salvar&imprimir, responde dinamicamente".

**Passos da reinvestigação:**

1. Confirmei que o deploy publicou o código certo: busquei o bundle JS servido em produção e o chunk carregado
   pela rota contém o texto da correção (`printWindow`, a mensagem de fallback) — **descartado deploy
   incompleto/stale**.
2. Refiz o teste do zero (candidato novo, sessão nova, primeiro clique) — funcionou. Não reproduzi o travamento
   original nessa rodada.
3. O Junior enviou print confirmando o sintoma ao vivo: a **nova aba abriu com a URL certa**
   (`/empregabilidade/print/{id}`) — ou seja, **a correção do PR #78 está funcionando**, a aba não fica mais
   bloqueada — mas a própria página de impressão fica presa no spinner de carregamento indefinidamente.

**Causa raiz do segundo bug** — `cuca-portal/src/app/empregabilidade/print/[id]/page.tsx` (código antes da
correção desta seção):

```js
useEffect(() => {
    supabase
        .from("curriculos")
        .select("dados, talent_bank(nome)")
        .eq("id", curriculoId)
        .single()
        .then(({ data, error }) => {
            if (error || !data) { setErro("Currículo não encontrado."); setLoading(false); return }
            ...
            setLoading(false)
        })
}, [curriculoId])
```

Não tem `.catch()`. Se a *promise* em si **rejeitar** (falha de rede, timeout, conexão instável — qualquer coisa
que não seja "PostgREST respondeu com um erro", que o `supabase-js` normalmente resolve como `{ data: null,
error }`, não como rejeição), o `.then()` nunca dispara. `loading` fica `true` para sempre — spinner infinito,
sem mensagem, sem forma de sair a não ser fechando a aba.

**Por que isso nunca apareceu antes:** este bug é **pré-existente** ao trabalho desta investigação — sempre
esteve no código da página de impressão. Mas estava **mascarado** pelo primeiro bug (o do `window.open`): antes,
a aba de impressão praticamente nunca chegava a abrir de verdade (bloqueada pelo navegador), então esse trecho de
código quase nunca executava em produção. Ao corrigir o primeiro bug, a aba passou a abrir de forma confiável — e
isso expôs esse segundo bug, que sempre esteve lá, agora sendo exercido pela primeira vez em escala.

Não consegui forçar a reprodução exata do hiccup de rede que dispara o hang (funcionou nos meus 2 testes) — mas a
falta de tratamento de erro é uma falha de código concreta e verificável, independente da causa exata da
instabilidade de rede que a aciona.

## 10. Correção do segundo bug (2026-08-05)

Aplicada em `print/[id]/page.tsx` (função `PrintPage`, `useEffect` de carregamento):

- **`.catch()`** — como o builder do `supabase-js` só implementa `.then()` (não é um `Promise` completo, é um
  thenable), envolvi a chamada em `Promise.resolve(...)` para poder encadear `.catch()` de forma type-safe.
  Qualquer rejeição agora cai num estado de erro visível (`"Erro ao carregar o currículo. Tente novamente."`),
  em vez de travar silenciosamente.
- **Timeout de segurança (15s)** — mesmo que a causa exata do hang não seja uma rejeição capturável (ex.: a
  promise nunca resolve nem rejeita, fica pendente), o usuário agora recebe feedback (`"Não foi possível carregar
  o currículo (tempo esgotado)..."`) em vez de spinner infinito.
- **Guarda `cancelado`** — evita `setState` depois que o efeito for cancelado (troca de `curriculoId` ou
  desmontagem), e evita a corrida entre o timeout e uma resposta tardia que chegue depois dele já ter disparado.

**Escopo:** só o `useEffect` de carregamento da página de impressão foi tocado. Não mexe no editor
(`criar-curriculo/[id]/page.tsx`), na RPC de salvamento, nem no restante do componente `PrintPage` (renderização
do currículo, botão de imprimir).

**Verificação:** `eslint` e `tsc --noEmit` limpos no arquivo (o único warning restante — `useEffect` sem
`supabase` nas deps — é pré-existente, não introduzido por esta mudança). Não testei contra produção porque o
código ainda não foi deployado (mesma limitação da seção 8.2) — a validação em produção fica para a próxima
rodada de QA/deploy.

**Próximo passo:** chamar @qa para nova rodada de gate nesta correção, antes de nova PR.
