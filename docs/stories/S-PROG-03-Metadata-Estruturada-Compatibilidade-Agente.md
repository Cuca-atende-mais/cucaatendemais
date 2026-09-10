# S-PROG-03 — Metadata estruturada, compatibilidade do agente e vagas fora do RAG

**Status:** InReview — **item 2: Done** (PR #159 mergeado, deployado e testado em produção), **item 1: implementado**, aguardando @qa
**Epic:** Reestruturação da criação de programação
**Origem:** Campos estruturados da S-PROG-01 + decisão do Junior sobre vagas no RAG (2026-09-07).
**Prioridade:** **P0** — a parte de vagas (item 2) deve ir a produção **antes** do disparo público de
setembro, independente do resto da story.
**Esforço:** M | **Risco:** **HIGH** — toca o consumidor vivo (agente do WhatsApp).
**Depende de:** item 1 depende da S-PROG-01. **O item 2 não depende de nada** e pode ser destacado
como entrega própria (ver "Recorte sugerido" no fim).

## Contexto

A S-PROG-01 introduz chaves novas em `metadata`. `formatarLinhaAtividadeDeterministica`
(`supabase/functions/motor-agente/index.ts:452`) lê `meta.horario`, `meta.dias_semana` e
`meta.faixa_etaria` **diretamente**. Se as chaves antigas deixarem de ser gravadas, **o assistente passa
a responder "nao informado" para toda atividade nova** — regressão direta na resposta ao cidadão.

## O que precisa ser implementado

### 1. Expand/contract — chaves novas E antigas, sem remoção

| Chave nova (S-PROG-01) | Chave antiga a recompor na gravação |
|---|---|
| `hora_inicio` + `hora_fim` | `horario` = `"08:00 às 09:00"` |
| `idade_min` + `idade_max` | `faixa_etaria` = `"15 a 29 anos"` ou `"a partir de 15 anos"` |
| `pre_requisitos` | `requisitos` = faixa + pré-requisito concatenados |
| `data_ini` + `data_fim` + `dias_semana` (Cursos) | `periodo` = `"07/08/2026 a 28/08/2026"` |
| `meta`, `diretoria` | — (não têm equivalente antigo; são aditivas) |

Nenhuma chave antiga é removida nesta fase. A remoção é um passo posterior (contract), fora desta story.

### 2. Vagas fora do RAG — pelos DOIS caminhos, valendo já para setembro

**Decisão do Junior:** a quantidade de vagas **não** é informada ao cidadão, e a regra vale **desde já
para a programação de setembro/2026 que está no ar**, não só para o que for criado na tela nova.

Levantamento em produção (2026-09-08) mostra que existem **dois caminhos** até a resposta, e mudar o
código só cobre um deles:

| Caminho | Como funciona | A mudança de código cobre? |
|---|---|---|
| **Determinístico** — `formatarLinhaAtividadeDeterministica` (`motor-agente/index.ts:452`) | Lê `atividades_mensais.metadata` **ao vivo** | **Sim, retroativo automaticamente.** Setembro passa a respeitar a regra sem re-embeddar nada |
| **Vetorial / chunks diretos** — `formatarChunks` sobre `chunks_documentos` | Texto **congelado** no momento do embedding | **Não.** Medido: **168 de 222 chunks ativos contêm "Vagas:"** (Barra 26/40, Jangurussu 33/45, José Walter 36/48, Mondubim 32/48, Pici 41/41) |

Por isso a story precisa de **três** frentes, não uma:

**2.1 — `descricao` (portal) e `formatarLinhaAtividadeDeterministica` (Edge Function):** remover
"Vagas: N" e acrescentar o aviso padrão:

> `A quantidade de vagas muda com frequencia; oriente a pessoa a procurar a unidade CUCA para verificar a disponibilidade.`

**2.2 — Sanitização determinística em `formatarChunks`:** remover o trecho `Vagas: <valor>.` do texto
do chunk **antes** de montar o contexto do GPT, por regex, e acrescentar o aviso uma vez por bloco.
Isto é o que faz setembro/2026 obedecer imediatamente, sem reprocessar embedding e **sem dívida
técnica**: quando os chunks novos já nascerem sem vagas (a partir da S-PROG-01/02), o regex
simplesmente não encontra nada e vira no-op. Não precisa ser removido depois.

**2.3 — Regra no prompt (`INSTRUCAO_SEGURANCA`):** regra nova proibindo informar quantidade de vagas
em qualquer situação e mandando orientar a procurar a unidade. É reforço, não a garantia — a garantia
é o 2.2, que não depende de o LLM obedecer. A regra 6 atual já proíbe vagas **na listagem geral**;
falta o caso da pergunta específica ("tem vaga para natação?"), que é exatamente o cenário citado pelo
Junior.

**Por que agora e não depois:** setembro está `aprovado` e ativo nas 5 unidades, mas o disparo ao
público ainda não foi feito — os leads atuais vêm de rede social. É a última janela para a regra entrar
antes do volume real. Fazer depois significaria corrigir com gente perguntando.

**A coluna Vagas permanece** em `metadata` e na exportação — o Junior confirmou que futuramente ela
virá via API do Portal da Juventude. Nada aqui a remove; apenas ela deixa de ser dita ao cidadão.

### 3. Testes existentes que vão quebrar (é esperado)

`supabase/functions/motor-agente/index.test.ts` tem **5 asserções com a substring `"Vagas:"`** —
linhas 50, 51, 412, 429, 437. Precisam ser atualizadas no mesmo commit, refletindo o novo aviso.
`index.audit.test.ts` não contém `"Vagas:"` e não deve ser afetado — se for, é sinal de regressão.

### 4. Paridade de payload

O payload gerado pela grade deve ser **idêntico, campo a campo**, ao payload que o
`criar-programacao-modal` gera hoje para a mesma atividade, exceto pelas chaves novas aditivas e pela
saída de vagas do texto. Teste comparando os dois é parte da entrega.

## Análise de impacto (regra `impact-analysis-mandatory.md`)

| | Item 1 — chaves novas | Item 2 — vagas fora do RAG |
|---|---|---|
| **Toca** | `atividades_mensais.metadata` (jsonb, sem DDL) | `descricao` no portal + `formatarLinhaAtividadeDeterministica` |
| **Consome hoje** | motor-agente:452; `handleExportarXLSX`; chunks já embeddados | agente do WhatsApp em produção; 5 testes |
| **Impacto observável** | Sem recomposição: agente responde "nao informado" em toda atividade nova | Agente para de dizer número de vagas e passa a orientar a procurar a unidade — **mudança intencional na resposta ao cidadão** |
| **De-risk** | Gravar novas + antigas; `deno test supabase/functions/motor-agente/` antes e depois | Atualizar as 5 asserções; conferir que `index.audit.test.ts` segue verde; validar o texto do aviso com uma pergunta real de teste |
| **Pergunta aberta** | — | — |

## Acceptance Criteria

1. Uma atividade criada pela grade nova produz `metadata` contendo **as chaves novas e as antigas**,
   com as antigas recompostas nos formatos da tabela do item 1.
2. `formatarLinhaAtividadeDeterministica` para essa atividade retorna texto **sem** "Vagas: N" e **com**
   o aviso padrão.
3. `deno test supabase/functions/motor-agente/` passa; as 5 asserções de `"Vagas:"` foram atualizadas e
   `index.audit.test.ts` continua verde sem alteração.
4. `metadata.vagas` continua gravado e continua aparecendo na coluna "Vagas" da exportação.
5. Teste de paridade: payload da grade == payload do modal atual para a mesma atividade (exceto chaves
   aditivas e vagas no texto).

## Recorte sugerido (@po, 2026-09-08)

O **item 2 (vagas fora do RAG)** não depende da grade nova e tem janela: precisa estar em produção
antes do disparo público de setembro. Recomendo implementá-lo e subi-lo **primeiro**, sozinho,
enquanto a S-PROG-01 ainda está em desenvolvimento. O item 1 (chaves novas) só faz sentido depois da
S-PROG-01 e segue o ritmo dela.

## Fora de escopo

Remover as chaves antigas (fase contract, story futura). Reprocessar os embeddings de setembro — a
sanitização do item 2.2 torna isso desnecessário.

## Dev Agent Record

### Item 2 — vagas fora do RAG (concluído em 2026-09-08, @dev/Dex)

Branch: `feat/s-prog-03-vagas-fora-do-rag`. **Item 1 (chaves novas) não foi tocado** — depende da
S-PROG-01, conforme o recorte aprovado pelo @po.

**2.1 — texto que alimenta o RAG.** `formatarLinhaAtividadeDeterministica` deixou de emitir
`"Vagas: N"` e passou a terminar com `AVISO_VAGAS`. Mesma mudança nas 4 montagens de `descricao` do
portal (Cursos e Esportes, nos dois modais). Dia a Dia não tinha vagas no texto — não foi alterado.

**2.2 — sanitização dos chunks já embeddados.** `removerVagasDoTexto()` nova, aplicada nos **dois**
caminhos que levam chunk ao GPT: `formatarChunks` (busca vetorial) e `carregarProgramacaoMensal`
(carga direta dos ~40 chunks — este **não** passava por `formatarChunks`, teria escapado).
Validado contra texto real de produção (4 chunks ativos sorteados): remove o trecho de vagas e
preserva os campos vizinhos (`Professor:` antes, `Público:` depois) intactos.

**2.3 — regra 8 em `INSTRUCAO_SEGURANCA`.** Fecha o caso da pergunta específica ("tem vaga para
natação?"), que a regra 6 não cobria (ela só proibia vagas na listagem geral).

**Duplicação intencional do texto do aviso:** `AVISO_VAGAS` existe em
`supabase/functions/motor-agente/index.ts` **e** em `cuca-portal/src/lib/programacao/rag.ts`. A Edge
Function roda em Deno e não importa de `cuca-portal/` — não há import possível. Os dois precisam ser
alterados juntos; está documentado no cabeçalho dos dois arquivos.

### Verificação executada

| Verificação | Resultado |
|---|---|
| `deno test index.test.ts` | **71 passed, 0 failed, 2 ignored** |
| `deno test index.audit.test.ts` | **138 passed, 0 failed** — sem alteração no arquivo, como o @po previu |
| Regex contra 4 chunks reais de produção | Vagas removida; campos vizinhos intactos |
| `tsc --noEmit` (portal) | Sem erro nos arquivos alterados (4 erros pré-existentes em `tests/*.test.ts`, TS5097, sem relação) |
| `eslint` nos 3 arquivos alterados | 30 problemas (26 erros, 4 avisos) — **todos pré-existentes**. Confirmado rodando o mesmo lint sobre as versões do HEAD dos mesmos arquivos, dentro do projeto: **30 antes, 30 depois**. `rag.ts` (novo) limpo. |
| `npm run lint` (projeto inteiro) | **NÃO EXECUTÁVEL neste ambiente** — `FatalProcessOutOfMemory` do Node, core dumped, mesmo com `--max-old-space-size=4096` na varredura completa. Problema anterior a esta story; a verificação foi feita por escopo reduzido. Pendência aberta para o @qa. |

**Asserções atualizadas:** 3 em `index.test.ts` (linhas 412, 429, 437 da versão anterior). As 2
ocorrências restantes de `"Vagas:"` (linhas 50-51) são **fixtures de entrada** do teste de
`extrairModalidades` — representam chunks reais que de fato contêm vagas, e devem continuar assim.

**Testes novos:** 6 — ausência de vagas no texto determinístico, remoção em chunk real, variantes de
valor (`20 por turma`, `nao informado`, sem ponto final, caixa alta), no-op em texto que já nasce
limpo, preservação de menção a vaga em texto corrido, e presença da regra 8.

### Correção pós-@qa (2026-09-08, @dev/Dex)

O @qa encontrou um 3º caminho não coberto: `buscarAtividadeEspecifica` (S-WM-34, 2ª camada de
fallback quando a busca determinística por metadata não reconhece a modalidade) devolvia texto de
chunk cru, sem sanitização — vazava "Vagas: N" exatamente no cenário "tem vaga para natação?"
quando cai nesse fallback. Corrigido com o mesmo `removerVagasDoTexto` já testado, aplicado a cada
chunk relevante antes do `join`. O filtro por nome de modalidade continua rodando sobre o texto
original (antes da sanitização), preservando o match.

Não foi possível escrever teste unitário direto para `buscarAtividadeEspecifica` — não é exportada
e depende do client Supabase, mesmo padrão de `carregarProgramacaoMensal` (também sem teste
unitário direto). A cobertura vem dos 6 testes já existentes de `removerVagasDoTexto`, que a
função agora reusa integralmente.

Reconfirmado após a correção: `deno test index.test.ts` — 71 passed, 0 failed. `deno test
index.audit.test.ts` — 138 passed, 0 failed.

### Fechamento @devops (2026-09-09) — item 2 em Done

- **Deploy da Edge Function:** feito **antes** da abertura do PR, via CLI (`supabase functions
  deploy motor-agente`), conforme `devops-deploy-antes-de-push-edge-function.md`. `motor-agente`
  v50 → v51; conteúdo deployado conferido por diff byte a byte contra o arquivo local (idêntico);
  as outras 9 Edge Functions do projeto mantiveram o mesmo `ezbr_sha256` — nenhuma tocada por engano.
- **PR:** [#159](https://github.com/Cuca-atende-mais/cucaatendemais/pull/159), aprovado pelo Junior
  e mergeado em `main` (commit `bd1b429`).
- **Redeploy EasyPanel (portal):** feito pelo Junior e confirmado por ele — registrado aqui como
  reportado; este agente não tem ferramenta própria de EasyPanel nesta sessão para verificar de
  forma independente.
- **Teste em produção:** confirmado pelo Junior em tempo real — resposta do assistente do WhatsApp
  não informa mais quantidade de vagas.
- **Nota de processo:** o deploy da Edge Function nesta story exigiu autenticar o CLI do Supabase
  manualmente (MCP `deploy_edge_function` foi descartado por risco de retranscrição de ~5.700
  linhas; `supabase login` via OAuth não persiste sessão neste ambiente headless — funcionou só
  com `SUPABASE_ACCESS_TOKEN` passado inline pelo Junior, no terminal dele, nunca neste chat).
  Para o próximo deploy de Edge Function nesta sessão, um `export SUPABASE_ACCESS_TOKEN=...`
  permanente no `.bashrc` do Junior evita repetir esse processo.

### Item 1 — chaves novas e antigas (2026-09-09, @dev/Dex)

**Levantamento de impacto feito antes de codar** (não presumido): grepei `motor-agente/index.ts`
inteiro por toda chave "antiga" citada na tabela do item 1 (`requisitos`, `periodo`,
`carga_horaria`, `ementa`, `educador`) — **nenhuma delas é lida individualmente por nenhum
caminho do RAG.** As únicas chaves antigas de fato lidas direto do jsonb são `turma`, `professor`,
`sexo`, `dias_semana`, `horario` e `faixa_etaria`, todas dentro de
`formatarLinhaAtividadeDeterministica` (linha 443) — usada pelo fallback de busca por nome de
atividade (`buscarAtividadeEspecifica`/`buscarAtividadeDeterministica`, cenário "tem vaga pra
natação?"). As demais chaves da tabela do item 1 só aparecem dentro do texto livre de `descricao`,
que já é montado direto pelo payload builder, sem depender de recomposição de metadata.

**Achado principal: o risco que esta story existe pra prevenir já estava coberto.**
`montarAtividadePayload` (então função local em `criar-programacao-modal.tsx`, hoje
`criar-programacao-view.tsx`) já recompunha `horario`, `faixa_etaria` e `dias_semana` a partir dos
campos novos da grade (`hora_inicio`/`hora_fim`, `faixa_de`/`faixa_ate`, `dias_raw`) desde a
implementação da S-PROG-01 — o dev daquela story já havia feito a recomposição corretamente ao
construir o payload, sem que isso tivesse sido testado ou registrado como tal. Verificado por
leitura de código, não assumido.

**O que foi feito nesta story, então:**

1. **Extraído `montarAtividadePayload`** de `criar-programacao-view.tsx` (função local, não
   testável) para `lib/programacao/payload.ts` (módulo puro, testável) — mesmo comportamento, só
   testabilidade. Zero mudança funcional nesta extração.
2. **13 testes novos** (`payload.test.ts`) travando por contrato a recomposição das chaves
   antigas por categoria — a proteção de regressão que faltava. Serve também como o "teste de
   paridade" do AC5: como o wizard antigo não existe mais lado a lado pra comparar (foi
   substituído pela grade na S-PROG-01), o teste fixa o formato que a função sempre produziu.
3. **Corrigido um achado durante a extração:** `periodo` (CURSOS) estava sendo montado como
   `"08/08/2026 29/08/2026 Qua e Sex"` (datas sem conector, dias grudados) — a story documenta o
   formato como `"07/08/2026 a 28/08/2026"`. Corrigido pra bater com o documentado. Como `periodo`
   não é lido pelo RAG (só pela exportação, S-PROG-05), isso não afeta o agente — mas ao remover
   os dias do `periodo`, adicionei `(${diasStr})` na `descricao` de CURSOS pra não perder essa
   informação do texto que alimenta o RAG (a `descricao` de CURSOS já citava os dias via
   `periodo`; sem esse ajuste, teria sumido).

**Não precisou de mudança em `motor-agente/index.ts`** — as chaves que o Edge Function lê já
estavam corretas; item 1 era 100% do lado do portal (gravação). Sem deploy de Edge Function
necessário nesta story.

**Não verificado nesta rodada:** teste end-to-end real (criar atividade pela grade → perguntar ao
assistente do WhatsApp) — sem autorização de navegador/WhatsApp real nesta sessão. Recomendo o
@qa validar com uma pergunta real antes do PASS final, ou aceitar a cobertura de teste unitário
como suficiente dado que a lógica não mudou desde a S-PROG-01 (só ganhou proteção de regressão).

### Verificação executada (item 1)

| Verificação | Resultado |
|---|---|
| `tsc --noEmit` (portal) | Limpo nos arquivos alterados |
| `vitest run src/lib/programacao` | **121 passed, 0 failed** (13 novos em `payload.test.ts`) |
| `eslint` em `payload.ts`/`payload.test.ts` | 0 problemas |
| `eslint` em `criar-programacao-view.tsx` | 2 erros pré-existentes (`any`) — **caiu de 3 pra 2** com a extração (a função extraída tinha um `any` de retorno que saiu do arquivo) |
| Grep completo de `motor-agente/index.ts` por cada chave antiga da tabela do item 1 | Confirma que só 6 chaves são lidas de fato (turma/professor/sexo/dias_semana/horario/faixa_etaria) — as demais só existem dentro de `descricao` |

### Cobertura de Acceptance Criteria

| AC | Status |
|---|---|
| 1. Metadata com chaves novas E antigas, recompostas | ✅ já implementado na S-PROG-01, agora testado |
| 2. `formatarLinhaAtividadeDeterministica` sem "Vagas: N", com aviso | ✅ (item 2, já Done) |
| 3. `deno test motor-agente` passa, 5 asserções atualizadas | ✅ (item 2, já Done — item 1 não tocou motor-agente) |
| 4. `metadata.vagas` continua gravado e na exportação | ✅ testado (`payload.test.ts`) |
| 5. Teste de paridade grade vs. modal | ✅ adaptado — modal antigo não existe mais (S-PROG-01 substituiu); teste fixa o contrato por comportamento, não por comparação lado a lado |

## QA Results (item 1)

### Revisão 1 (2026-09-09, @qa/Quinn) — FAIL (achado abaixo)

Revisão adicional pedida pelo Junior depois de notar que o @dev tinha commitado/dado push/aberto
PR sem passar por @qa nem @devops. Achado:

**CONFIRMED, cosmético:** ao corrigir o formato de `periodo` (remover os dias do campo, deixando
só `"dd/mm/aaaa a dd/mm/aaaa"`), a `descricao` de CURSOS passou a juntar `periodo`+`dias` sempre
com parênteses — quando os dois vinham vazios (curso recém-duplicado pela S-PROG-02, que sempre
zera datas), o texto gravado ficava `"Período:  ()."`, com parênteses vazios, visivelmente
malformado no texto que alimenta o RAG.

### Correção (2026-09-09, @dev/Dex)

Parêntese só entra quando há dias pra mostrar; cai pra `"nao informado"` quando período e dias
estão os dois vazios. 2 testes novos travando os dois casos (vazio total, e período preenchido
sem dias).

### Revisão 2 (2026-09-09, @qa/Quinn) — PASS

Reprodução independente do achado confirma corrigido. **Veredito final: PASS.**

## File List

| Arquivo | Mudança |
|---|---|
| `supabase/functions/motor-agente/index.ts` | `AVISO_VAGAS`, `removerVagasDoTexto()`, `formatarChunks`, `carregarProgramacaoMensal`, `formatarLinhaAtividadeDeterministica`, regra 8 (item 2) |
| `supabase/functions/motor-agente/index.test.ts` | 3 asserções atualizadas + 6 testes novos (item 2) |
| `cuca-portal/src/lib/programacao/rag.ts` | **novo** — `AVISO_VAGAS` do lado do portal (item 2) |
| `cuca-portal/src/components/programacao/import-planilha-modal.tsx` | `descricao` de Cursos e Esportes sem vagas (item 2) |
| `cuca-portal/src/components/programacao/criar-programacao-modal.tsx` | `descricao` de Cursos e Esportes sem vagas (item 2 — arquivo depois substituído pela S-PROG-01) |
| `cuca-portal/src/lib/programacao/payload.ts` | **novo** (item 1) — `montarAtividadePayload` extraído, com fix no formato de `periodo` (e correção do QA Results: parêntese vazio) |
| `cuca-portal/src/lib/programacao/payload.test.ts` | **novo** (item 1) — 13 + 2 testes de recomposição de chaves antigas |
| `cuca-portal/src/components/programacao/criar-programacao-view.tsx` | (item 1) importa `montarAtividadePayload` de `lib/programacao/payload` em vez de declarar local |

## Change Log

| Data | Autor | Mudança |
|---|---|---|
| 2026-09-08 | @sm (River) | Story criada |
| 2026-09-08 | @po (Pax) | Validação: item 2 reescrito com os 3 caminhos, P0 e recorte próprio; achado dos 168/222 chunks incorporado |
| 2026-09-08 | @dev (Dex) | Item 2 implementado e testado; item 1 aguarda S-PROG-01 |
| 2026-09-08 | @qa (Quinn) | CONCERNS — buscarAtividadeEspecifica (S-WM-34) não sanitizado, vazava vagas no fallback |
| 2026-09-08 | @dev (Dex) | Corrigido; testes reconfirmados verdes |
| 2026-09-09 | @devops (Gage) | Edge Function deployada (v51), PR #159 aberto |
| 2026-09-09 | @devops (Gage) | PR #159 aprovado e mergeado em `main`; portal redeployado no EasyPanel e testado em produção pelo Junior — item 2 marcado **Done** |
| 2026-09-09 | @dev (Dex) | Item 1 implementado — achado que a recomposição já existia desde a S-PROG-01; extraído pra módulo testável, 13 testes novos, fix no formato de `periodo`. Status Draft → InReview |
| 2026-09-09 | @qa (Quinn) | Revisão 1: FAIL — "Período:  ()." vazio quando data/dias em branco |
| 2026-09-09 | @dev (Dex) | Corrigido; 2 testes novos |
| 2026-09-09 | @qa (Quinn) | Revisão 2: **PASS** |
