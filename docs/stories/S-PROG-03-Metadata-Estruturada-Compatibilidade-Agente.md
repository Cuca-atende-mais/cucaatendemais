# S-PROG-03 — Metadata estruturada, compatibilidade do agente e vagas fora do RAG

**Status:** InProgress — **item 2 concluído (Ready for Review)**, item 1 não iniciado
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

### Pendências para @devops (não executar sem autorização)

A Edge Function `motor-agente` **precisa ser deployada no Supabase antes do push/PR**
(`devops-deploy-antes-de-push-edge-function.md`). Merge no GitHub não coloca a function no ar.
O portal precisa de redeploy do serviço `portal` no EasyPanel após o merge.

## File List

| Arquivo | Mudança |
|---|---|
| `supabase/functions/motor-agente/index.ts` | `AVISO_VAGAS`, `removerVagasDoTexto()`, `formatarChunks`, `carregarProgramacaoMensal`, `formatarLinhaAtividadeDeterministica`, regra 8 |
| `supabase/functions/motor-agente/index.test.ts` | 3 asserções atualizadas + 6 testes novos |
| `cuca-portal/src/lib/programacao/rag.ts` | **novo** — `AVISO_VAGAS` do lado do portal |
| `cuca-portal/src/components/programacao/import-planilha-modal.tsx` | `descricao` de Cursos e Esportes sem vagas |
| `cuca-portal/src/components/programacao/criar-programacao-modal.tsx` | `descricao` de Cursos e Esportes sem vagas |

## Change Log

| Data | Autor | Mudança |
|---|---|---|
| 2026-09-08 | @sm (River) | Story criada |
| 2026-09-08 | @po (Pax) | Validação: item 2 reescrito com os 3 caminhos, P0 e recorte próprio; achado dos 168/222 chunks incorporado |
| 2026-09-08 | @dev (Dex) | Item 2 implementado e testado; item 1 aguarda S-PROG-01 |
| 2026-09-08 | @qa (Quinn) | CONCERNS — buscarAtividadeEspecifica (S-WM-34) não sanitizado, vazava vagas no fallback |
| 2026-09-08 | @dev (Dex) | Corrigido; testes reconfirmados verdes |
