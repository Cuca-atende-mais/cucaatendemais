# S-PROG-10 — Aprovar converte para o RAG, e o LLM sabe de que mês é a programação

**Status:** InReview
**Epic:** Reestruturação da criação de programação
**Origem:** Instrução do Junior (2026-09-10): *"A partir da criação de cada mês a frente, no comando
de direcionamento do RAG, precisa indicar para o LLM interpretar qual RAG seguir. Analise a
estrutura que existe hoje de normalização e transformação feita com os dados do método de subir a
planilha em RAG e estruture isso para, ao aprovar a programação da nova forma de inserir os dados,
assumir e converter no RAG."*
**Prioridade:** P0 | **Esforço:** M | **Risco:** **ALTO** — muda o que o agente responde ao cidadão.
**Absorve:** S-PROG-03 item 1 (chaves antigas de `metadata`), já implementado em
`lib/programacao/payload.ts` na branch `feat/s-prog-03-item1-chaves-antigas`.

---

## Parte 1 — O que a investigação mostrou (e que NÃO precisa ser refeito)

A esteira que leva da planilha ao RAG foi percorrida inteira, do arquivo ao chunk:

```
grade nova  ─┐
             ├─> POST /api/programacao/importar ─> atividades_mensais (descricao + metadata jsonb)
planilha    ─┘                                              │
                                                            │ status = 'aprovado'
                                    tr_campanha_mensal_index ▼
                          trigger_indexar_campanha_mensal ─> monta v_conteudo
                                                            ▼
                                       documentos_rag (tipo='monthly_program')
                                                            │
                                        tr_indexar_documento ▼
                        net.http_post ─> Edge Function processar-documento
                                                            ▼
                                    chunks_documentos + embeddings
```

**Descoberta importante: a grade nova já usa a mesma esteira da planilha, e produz o mesmo texto.**

O campo que alimenta todo o RAG é `atividades_mensais.descricao`. Comparando linha a linha:

| Categoria | Planilha (`import-planilha-modal.tsx`) | Grade (`montarAtividadePayload`) |
|---|---|---|
| CURSOS | `Curso: … Educador: … Carga Horária: …h. Período: … Horário: … Requisitos: … Ementa: … {AVISO_VAGAS}` | **idêntico** |
| ESPORTES | `Esporte Modalidade: … - Turma … Professor: … Público: … (Idade: …). Dias: … Horário: … {AVISO_VAGAS}` | **idêntico** |
| DIA A DIA / ESPECIAIS | `Programa (…): … Atividade: … Data: … (…). Horário: … Local: … Informações: … Sessão: …` | **idêntico** |

Os dois caminhos passam pelo mesmo `POST /api/programacao/importar`, gravam na mesma tabela e
disparam o mesmo trigger. **Não há uma "conversão para RAG" a construir — ela já acontece.**
O que existia de risco real era o segundo consumidor, e ele já tem correção escrita:

> `formatarLinhaAtividadeDeterministica` (`motor-agente/index.ts:443`) lê `metadata.turma`,
> `metadata.professor`, `metadata.sexo`, `metadata.dias_semana`, `metadata.horario` e
> `metadata.faixa_etaria` **direto do jsonb**, sem passar por `descricao`. A grade nova guarda os
> campos separados (`faixa_de`/`faixa_ate`, `hora_inicio`/`hora_fim`, `dias_raw`). Sem recompor as
> chaves antigas na gravação, o agente responderia "nao informado" para toda atividade criada pela
> grade. Isso é o que `lib/programacao/payload.ts` faz, com 15 testes. **Entra nesta story como
> está — não reescrever.**

**Conclusão da Parte 1:** aprovar uma programação criada pela grade já vai ao ar exatamente como
uma criada pela planilha. O item que falta não é a conversão — é o direcionamento de mês.

---

## Parte 2 — O que realmente falta: o LLM não sabe de que mês é o que ele está lendo

### O problema, verificado no código

1. O prompt **recebe a data de hoje**: `DATA_ATUAL` é montado em `motor-agente/index.ts:1783` com
   dia, mês, ano e hora em `America/Fortaleza`, e entra no `promptFinal` (linha 1796).
2. O conteúdo do RAG **carrega o mês no texto**: `v_conteudo` começa com
   `PROGRAMAÇÃO MENSAL (8/2026) - Cuca Mondubim`.
3. **Não existe nenhuma instrução ligando os dois.** Nenhuma regra manda o modelo comparar a data de
   hoje com o mês da programação carregada, nem dizer o que fazer quando eles não batem.
4. `documentos_rag.metadados` guarda **apenas** `{"campanha_id": "..."}` — não tem `mes` nem `ano`.
   Então nem o código consegue fazer essa comparação no momento da resposta; a informação só existe
   embutida em texto livre.

### O cenário que isso produz

O trigger mantém **um único** `monthly_program` ativo por unidade (desativa os outros meses da mesma
unidade ao aprovar um novo). Então, enquanto outubro não for aprovado, **setembro continua sendo a
única coisa que o agente conhece** — inclusive no dia 15 de outubro.

O modelo lê "PROGRAMAÇÃO MENSAL (9/2026)", lê que hoje é outubro, e não tem instrução nenhuma sobre
o descompasso. O resultado provável é responder o horário de setembro como se fosse o vigente. O
cidadão se desloca até a unidade para uma turma que acabou.

Não é hipótese sobre o futuro: é a janela que se abre **toda virada de mês**, entre o dia 1º e o
momento em que a coordenação aprova o mês novo.

## O que precisa ser implementado

### 1. Metadados estruturados no documento de RAG

`trigger_indexar_campanha_mensal` passa a gravar mês, ano e unidade em `documentos_rag.metadados`,
além do `campanha_id` que já existe:

```
jsonb_build_object('campanha_id', NEW.id, 'mes', NEW.mes, 'ano', NEW.ano, 'unidade_cuca', NEW.unidade_cuca)
```

Migration idempotente e retrocompatível: só **acrescenta** chaves. `campanha_id` continua no mesmo
lugar, com o mesmo nome — `buscarAtividadeDeterministica` e `formatarChunks` não mudam.

### 2. Cabeçalho explícito de vigência no conteúdo indexado

A primeira linha de `v_conteudo` passa a nomear o mês por extenso e declarar a vigência, em vez de
`(8/2026)`:

```
PROGRAMAÇÃO MENSAL DE AGOSTO DE 2026 — Cuca Mondubim
Esta programação vale para o mês de agosto de 2026.
```

Mês por extenso porque `(8/2026)` é ambíguo para o modelo em texto corrido e some no meio do chunk.

### 3. Direcionamento calculado no momento da resposta

O motor-agente compara `metadados.mes`/`metadados.ano` do documento carregado com a data de hoje
(que ele já tem) e injeta no prompt uma diretiva explícita — **calculada em código, não deduzida
pelo modelo**:

| Situação | Diretiva injetada |
|---|---|
| Programação é do mês corrente | "A programação carregada é a de {mês}, o mês corrente. Responda normalmente." |
| Programação é de mês anterior | "ATENÇÃO: a programação carregada é de {mês}, que já passou. A programação de {mês corrente} ainda não foi publicada. NÃO apresente estes horários como vigentes." + o encaminhamento definido na S-PROG-07 |

Isso resolve a virada de mês sem depender de o modelo inferir nada. Onde exatamente o
encaminhamento cai (encerrar, sugerir a unidade, ou `[[HANDOVER]]`) é o objeto da **S-PROG-07**, que
já está escrita — esta story entrega o **sinal**; a S-PROG-07 decide o **comportamento**.

### 4. Meses já existentes continuam funcionando

As programações já gravadas (5 unidades, agosto/setembro) não têm `mes`/`ano` em `metadados`. O
código de resposta precisa tratar a ausência como "não sei o mês" e cair no comportamento atual —
nunca quebrar. Os metadados se preenchem sozinhos na próxima aprovação de cada unidade.

Um backfill opcional pode ser rodado por `execute_sql` a partir de `campanhas_mensais`, sem
reprocessar embedding (só `metadados` muda, o texto não).

## Acceptance Criteria

1. Aprovar uma programação criada pela grade gera `documentos_rag` com `mes`, `ano`, `unidade_cuca` e
   `campanha_id` em `metadados`.
2. O conteúdo indexado começa com o mês por extenso e a frase de vigência.
3. Com a programação do mês corrente carregada, o prompt final enviado ao GPT é byte-a-byte
   igual ao de antes desta story (achado @po: "a resposta não muda" não é verificável sem
   rodar o LLM; o prompt montado é — comparar antes/depois é suficiente e determinístico).
4. Com programação de mês anterior carregada, o prompt recebe a diretiva de não apresentar os
   horários como vigentes.
5. Documento sem `mes`/`ano` em `metadados` (dado antigo) não quebra nada — cai no comportamento atual.
6. `buscarAtividadeDeterministica` continua resolvendo pelo `campanha_id`, sem alteração.
7. Uma atividade de ESPORTES criada pela grade responde com professor, turma, sexo, dias, horário e
   faixa etária — nunca "nao informado" (regressão da S-PROG-03 item 1).

## Análise de impacto

| Item | Toca | Quem consome hoje | Impacto observável | De-risk |
|---|---|---|---|---|
| `metadados` do documento | `trigger_indexar_campanha_mensal` | `buscarAtividadeDeterministica` (lê `campanha_id`), `formatarChunks` | Só acrescenta chaves; nenhum leitor atual quebra | Conferir com `execute_sql` que `campanha_id` continua no mesmo caminho após a migration |
| Cabeçalho de `v_conteudo` | mesma função | chunks + embeddings | **Muda o texto indexado** → a próxima aprovação regenera os chunks daquela unidade. Vale só para quem for aprovado depois; meses já no ar mantêm o texto antigo até a próxima aprovação | Aprovar uma unidade e conferir os chunks gerados antes de aplicar às demais |
| Diretiva de mês no prompt | `motor-agente/index.ts` (Edge Function) | **Todas as 4 personas** que carregam `monthly_program` (maria, Institucional) | Function compartilhada — erro aqui afeta atendimento real, em produção, imediatamente | Deploy da Edge Function **antes** do push/PR (regra NON-NEGOTIABLE); conferir versão das demais functions inalterada |
| Programações já existentes | `documentos_rag` gravados | Agente, hoje | Se o código exigir `mes`/`ano`, as 5 unidades no ar param de responder | AC5 é bloqueante: ausência tem que ser tratada como desconhecido, não como erro |

## Fora de escopo

O comportamento de encaminhamento quando o mês é anterior (S-PROG-07). Reprocessamento de embedding
dos meses já indexados. Suporte a duas programações ativas simultâneas para a mesma unidade.

## File List

| Arquivo | Mudança |
|---|---|
| `supabase/migrations/20260911120000_s_prog_10_metadados_estruturados_rag.sql` | **novo** — `trigger_indexar_campanha_mensal` grava `mes`/`ano`/`unidade_cuca` em `metadados`, nos caminhos INSERT e UPDATE; aplicada em produção |
| `supabase/migrations/20260911130000_s_prog_10_cabecalho_vigencia_rag.sql` | **novo** — cabeçalho de `v_conteudo` com mês por extenso e frase de vigência; aplicada em produção |
| `supabase/functions/motor-agente/index.ts` | `montarDiretivaVigenciaMes` (pura) + `calcularDiretivaVigenciaMes` (I/O) + integração no fluxo de contexto RAG — ainda não deployada (pendente @devops, antes do push) |
| `supabase/functions/motor-agente/index.test.ts` | 11 testes novos para `montarDiretivaVigenciaMes` |

## Dev Agent Record

### Item 1 — Metadados estruturados no documento de RAG (2026-09-11, @dev/Dex) — **concluído**

Autorizado pelo Junior ("siga para a próxima story"). Implementado só o item 1. Itens 2 (cabeçalho
de vigência no `v_conteudo`), 3 (direcionamento no motor-agente) e 4 (retrocompatibilidade —
parcialmente já coberto, ver abaixo) **não foram feitos** — aguardando autorização pra continuar,
mesmo padrão de item por item das stories anteriores.

**Achado de impacto, feito antes de codar (não estava no trecho de código que a story mostrava):**
`trigger_indexar_campanha_mensal` tem dois caminhos — INSERT (documento novo) e UPDATE (documento
já existe, reaprovação após reabrir, fluxo normal da S-PROG-04). **O caminho UPDATE não tocava em
`metadados` de jeito nenhum.** Se eu tivesse só acrescentado a chave no INSERT (como o trecho da
story mostrava), reaprovar um mês já indexado — que é o caso mais comum no dia a dia, não o
primeiro approve — deixaria `metadados` congelado no formato antigo pra sempre, falhando o AC1 em
silêncio. Corrigi os dois caminhos.

**O que foi implementado:**
- `supabase/migrations/20260911120000_s_prog_10_metadados_estruturados_rag.sql` —
  `CREATE OR REPLACE FUNCTION trigger_indexar_campanha_mensal()`: nova variável `v_metadados`
  computada uma vez (`jsonb_build_object('campanha_id', NEW.id, 'mes', NEW.mes, 'ano', NEW.ano,
  'unidade_cuca', NEW.unidade_cuca)`), usada nos dois caminhos (`INSERT`/`UPDATE`). `v_conteudo`
  (texto indexado) **não foi tocado** — isso é item 2, migration separada. Resto da função
  idêntico ao original, byte a byte, fora dessas duas mudanças.

**Verificação executada, direto em produção (`svzkrkfzpiqcesloukgb`):**
- Conferido por código (não assumido) que `motor-agente` só lê `metadados["campanha_id"]` via
  acesso de chave — nunca itera nem compara o objeto inteiro — confirmando que acrescentar chaves
  não quebra nada (AC6).
- Testado com campanha descartável (criada e apagada depois): aprovar pela primeira vez (caminho
  INSERT) grava `{campanha_id, mes, ano, unidade_cuca}` — confirmado. Reabrir e reaprovar (caminho
  UPDATE, o que o trecho da story não cobria) **também** grava os 4 campos corretamente — esse é
  exatamente o caminho que estava quebrado antes da correção.
- Conferidos os 4 documentos `monthly_program` reais e ativos em produção (Barra, Jangurussu, José
  Walter, Pici): nenhum tem `mes`/`ano` ainda (só `campanha_id`/`indexado_em`/`source_type`/
  `total_chunks`) — confirma que a mudança é aditiva e não afetou nada até a próxima aprovação de
  cada unidade, exatamente o cenário do AC5 (que o item 3/4 ainda vai tratar no código de leitura).

**Não verificado:** o restante da esteira (item 2, cabeçalho de vigência; item 3, diretiva no
motor-agente) — ainda não implementado.

### Item 2 — Cabeçalho explícito de vigência no conteúdo indexado (2026-09-11, @dev/Dex) — **concluído**

Autorizado pelo Junior ("@dev segui para o item 2"). Implementado só o item 2. Itens 3 e 4 **não
foram feitos** — aguardando autorização.

**Bug que eu mesmo introduzi e corrigi durante a própria verificação, antes de reportar como
pronto:** array PL/pgSQL construído com `ARRAY[...]` é indexado a partir de **1** por padrão, não
de 0. A primeira versão do código tinha uma string vazia no índice 1 "pra imitar índice 0" (hábito
de linguagem 0-indexada) — isso empurrava todo o mapeamento um mês pra trás: mês 8 (agosto)
virava "JULHO" no texto indexado. Só descobri porque testei com uma campanha de agosto e o
resultado não bateu — não assumi que a lógica estava certa só porque compilou. Corrigido antes de
aplicar de vez (removida a string vazia; `v_nomes_mes[1]` = 'janeiro' direto).

**O que foi implementado:**
- `supabase/migrations/20260911130000_s_prog_10_cabecalho_vigencia_rag.sql` —
  `CREATE OR REPLACE FUNCTION trigger_indexar_campanha_mensal()`: as duas primeiras linhas de
  `v_conteudo` passam a ser `"PROGRAMAÇÃO MENSAL DE {MÊS} DE {ANO} — {unidade}"` e
  `"Esta programação vale para o mês de {mês} de {ano}."`, em vez de `"(8/2026)"`. A string de
  comparação que detecta campanha sem atividade (pra cair no fallback "Consulte a programação no
  Portal da Juventude") foi atualizada pro novo formato — mesma lógica, texto novo. `metadados`
  (item 1) e todo o resto da função ficaram idênticos.

**Verificação executada, direto em produção:**
- Testados os 12 meses (campanha descartável por mês, 1 a 12, apagada logo depois): todos os 12
  nomes por extenso conferidos um a um contra o mês numérico real — sem esse teste completo eu não
  teria pego o bug do índice (testar só "agosto" isolado, por exemplo, não teria pego porque
  qualquer erro sistemático de offset ainda parece "plausível" olhando um mês só).
- Confirmado que o fallback (campanha sem atividade) usa a string de comparação nova corretamente
  — "Detalhes: Consulte a programação no Portal da Juventude." aparece como esperado.
- Nenhum dado de teste ficou no banco.

**Não verificado:** itens 3 (diretiva no motor-agente) e 4 — ainda não implementados. O impacto em
chunks/embeddings de unidades já no ar (mencionado na análise de impacto da story) só se
materializa na próxima aprovação real de cada unidade — nada muda pro que já está indexado até lá.

### Item 3 — Direcionamento calculado no momento da resposta (2026-09-11, @dev/Dex) — **concluído**

Autorizado pelo Junior ("@dev segui para o item 3"). Item 4 (retrocompatibilidade explícita) já
está coberto pela própria implementação deste item — ver checklist no final. Este é o item que
toca a Edge Function compartilhada pelas 4 personas — o mais arriscado da story.

**O que foi implementado (`supabase/functions/motor-agente/index.ts`):**
- `montarDiretivaVigenciaMes(mes, ano, mesAtual, anoAtual)` — **função pura**, sem I/O. Devolve
  `""` (nenhuma mudança no prompt) quando `mes`/`ano` estão ausentes ou com tipo errado (AC5:
  documento gravado antes desta story), quando `mes` está fora de 1-12, ou quando batem com o mês
  corrente (AC3). Só devolve a diretiva de alerta quando o mês carregado é estritamente anterior
  ao atual (AC4) — mês "futuro" também devolve `""`, por segurança, nunca inventa uma diretiva pra
  uma situação fora do que a story especifica.
- `calcularDiretivaVigenciaMes(supabase, unidade)` — wrapper de I/O: busca `metadados` do
  `monthly_program` ativo da unidade (mesma consulta base já usada em `carregarProgramacaoMensal`/
  `buscarAtividadeDeterministica`, só pedindo `metadados` em vez de `id`), calcula "hoje" via
  `Intl.DateTimeFormat` em `America/Fortaleza` (mesmo fuso do `DATA_ATUAL` já existente), delega a
  decisão pra função pura.
- Integração: chamada **uma única vez**, fora da cadeia de `if/else` que decide qual branch de RAG
  carrega o `monthly_program` (visão geral vs. acompanhamento) — a diretiva se aplica
  independente de qual delas disparou, porque a pergunta pode vir em qualquer uma. Quando vazia
  (a esmagadora maioria dos casos agora, já que nenhum documento real ainda tem `mes`/`ano`),
  **nada é acrescentado a `contextRAG`** — meio prático de cumprir o AC3 sem precisar comparar
  strings manualmente a cada verificação.

**Bug que eu mesmo cometi e peguei nos meus próprios testes, antes de reportar como pronto:**
nenhum desta vez — usei array JS/TS (indexado a partir de 0, ao contrário do PL/pgSQL do item 2),
e escrevi teste cobrindo os 12 meses um a um logo de cara, exatamente pra não repetir o erro de
índice do item 2. Não achei nada errado, mas o teste que teria pego ficou registrado mesmo assim.

**Verificação executada:**
- `deno test index.test.ts` (função pura): **11 testes novos**, todos passando — mes/ano
  ausentes, tipo errado, fora de 1-12, igual ao atual, mês anterior (mesmo ano), os dois extremos
  do array (janeiro e dezembro), virada de ano, mês "futuro", ano futuro, e uma verificação
  direta dos 12 meses um a um contra o nome esperado.
- `deno test index.test.ts --no-check`: **81/81** (70 já existentes + 11 novos).
- `deno test index.audit.test.ts --no-check`: **138/138** — suíte de integração com handler
  mockado, cobre o fluxo completo de requisição; continua passando sem alteração, confirma que a
  nova chamada não quebra nenhum cenário coberto ali.
- `deno check index.ts`: 46 erros — **confirmado pré-existente**, idêntico em contagem e natureza
  ao arquivo original (comparado com `git stash` isolando minha mudança e rodando o check no
  arquivo sem ela) — nenhum erro novo introduzido.
- `deno lint index.ts`: 5 avisos — todos pré-existentes (imports `jsr:`/`npm:` sem versão, 2
  variáveis não usadas numa desestruturação distante, linha 1319) — nada relacionado ao código
  novo.

**Não verificado:** deploy real da Edge Function — não é escopo do @dev; a regra NON-NEGOTIABLE
do projeto reserva deploy de Edge Function pro @devops, na etapa de push/PR, sempre ANTES do
push (não depois do merge). Teste end-to-end via WhatsApp/navegador também não — regra do projeto
proíbe sem autorização explícita.

### Correção do achado crítico do @qa — arquivo-base desatualizado (2026-09-11, @dev/Dex)

O @qa achou que o `motor-agente/index.ts` local estava desatualizado em relação à `main` — faltava
a feature S-WM-70 (encerramento de conversa por despedida), já em produção, sem relação nenhuma
com esta story. Confirmado: o arquivo de onde parti pra codar os itens 3/4 não tinha o commit
`1ca4de1` (S-WM-70), mergeado bem antes desta sessão.

**Correção:** reconstruí `index.ts` a partir de `origin/main` real (`git show origin/main:...`) e
reapliquei só as duas adições da S-PROG-10 (as funções `montarDiretivaVigenciaMes`/
`calcularDiretivaVigenciaMes` + a chamada de integração) sobre essa base — nada da lógica da
S-PROG-10 mudou, só a base por baixo dela. `index.audit.test.ts` (onde os 102 linhas da S-WM-70
tinham sumido) foi restaurado pra cópia exata de `origin/main` — eu nunca tinha editado esse
arquivo, então não havia nada meu pra reaplicar ali. `index.test.ts` já estava limpo (só a minha
adição, confirmado pelo @qa) — não precisou de correção.

**Verificação executada, depois da correção:**
- Confirmado por `git diff origin/main --stat`: o diff de `index.ts` agora é **100% aditivo**
  (78 inserções, a única "remoção" no diff é o cabeçalho do próprio diff, não conteúdo real);
  `index.audit.test.ts` não aparece mais no diff (idêntico a `origin/main`).
- `deno test index.test.ts --no-check`: 81/81 (inalterado).
- `deno test index.audit.test.ts --no-check`: **143/143** (138 de antes + 5 testes da S-WM-70,
  que voltaram com o arquivo restaurado) — incluindo o teste que marca `status='encerrada'` e
  devolve `encerrado:true`.
- `deno check index.ts`: 47 erros — copiei `origin/main` puro pra dentro da pasta (só assim o
  `deno check` resolve os imports relativos) e confirmei que são os mesmos 47, byte a byte, sem
  nenhum novo introduzido pela S-PROG-10.
- `deno lint index.ts`: 5 avisos, mesmos de antes.

Pronto para nova revisão do @qa.

### Item 4 — Meses já existentes continuam funcionando

Coberto pela própria implementação do item 3: `montarDiretivaVigenciaMes` trata `mes`/`ano`
ausentes como "não sei o mês" (devolve `""`, cai no comportamento atual) — não há necessidade de
um passo separado. Backfill dos 4 documentos reais hoje é opcional (mencionado na story) e não foi
feito — os metadados se preenchem sozinhos na próxima aprovação de cada unidade, como a story já
previa.

## Change Log

| Data | Autor | Mudança |
|---|---|---|
| 2026-09-10 | @dev (Dex) | Story rascunhada após percorrer a esteira planilha→RAG inteira (rota, trigger, `processar-documento`, motor-agente) e confirmar que a conversão já funciona; o recorte real é o direcionamento de mês |
| 2026-09-10 | @po (Pax) | Validado GO (9/10). AC3 reescrito para ser verificável sem depender de resposta do LLM. Status Draft → Ready |
| 2026-09-11 | @dev (Dex) | Item 1 (metadados estruturados) implementado, aplicado e testado direto em produção — incluindo correção de um caminho (UPDATE/reaprovação) que a story não cobria. Status Ready → InProgress. Itens 2-4 pendentes, aguardando autorização |
| 2026-09-11 | @dev (Dex) | Item 2 (cabeçalho de vigência) implementado. Achei e corrigi um bug meu próprio antes de reportar pronto (índice de array PL/pgSQL 1-based, não 0-based — mês errado no texto). Testados os 12 meses um a um em produção, todos corretos. Itens 3-4 pendentes |
| 2026-09-11 | @dev (Dex) | Itens 3 e 4 implementados — diretiva de vigência no motor-agente (função pura + 11 testes novos, 81/81 e 138/138 nas duas suítes, 46 erros de `deno check` confirmados pré-existentes). Edge Function ainda não deployada — pendente @devops antes do push (regra NON-NEGOTIABLE). Todos os 4 itens da story concluídos |
| 2026-09-11 | @qa (Quinn) | Revisão completa (`*review`). Veredito **FAIL** — arquivo-base local de `motor-agente/index.ts` estava desatualizado em relação à `main` (faltava a feature S-WM-70, já em produção), então o diff desta story inclui a remoção acidental de uma feature ativa e sem relação com a S-PROG-10 (ver QA Results). Status permanece InProgress |
| 2026-09-11 | @dev (Dex) | Achado crítico corrigido: `index.ts` reconstruído a partir de `origin/main` real, mudanças da S-PROG-10 reaplicadas por cima. `index.audit.test.ts` restaurado (S-WM-70 de volta, 143/143). `deno check`: 47 erros, confirmados idênticos ao `origin/main` puro. Pronto para nova revisão |
| 2026-09-11 | @qa (Quinn) | Nova revisão (`*review`). Achado crítico **CONFIRMADO CORRIGIDO** — reproduzi de forma independente: diff de `index.ts` 100% aditivo (0 remoções), `index.audit.test.ts` idêntico a `origin/main`, S-WM-70 presente, 81/81 e 143/143 rodados por mim, `deno check` 47/47 idêntico ao `origin/main` puro. Veredito **PASS**. Status InProgress → InReview |

## QA Results (rodada 2)

Achado crítico da Rodada 1 (arquivo-base desatualizado, removia a S-WM-70) **confirmado
corrigido**, de forma independente — não me limitei a rodar o que o @dev relatou:

- `git diff origin/main --numstat` para `index.ts`: **78 inserções, 0 remoções** — antes eram 79
  inserções e 31 remoções (a S-WM-70 sumindo). Agora é puramente aditivo.
- `index.audit.test.ts`: comparei byte a byte contra `origin/main` — idêntico.
- `deno test index.test.ts --no-check`: 81/81, rodado por mim.
- `deno test index.audit.test.ts --no-check`: 143/143, rodado por mim — incluindo os 5 testes da
  S-WM-70 que tinham sumido na Rodada 1, conferidos individualmente (inclusive o que marca
  `status='encerrada'` e devolve `encerrado:true`).
- `deno check`: copiei `origin/main` puro pra dentro da pasta e comparei — **47 erros nos dois**,
  idêntico. Confirmei que o arquivo local (com a S-PROG-10) foi restaurado corretamente depois
  dessa comparação (S-WM-70 e `montarDiretivaVigenciaMes` ambos presentes).

**Decisão:** com a base corrigida, os 4 itens da S-PROG-10 revalidados nesta rodada:
- **Item 1** (metadados estruturados): já verificado de forma independente na Rodada 1 (12 meses,
  unidade diferente da do @dev, caminhos INSERT/UPDATE) — sem mudança desde então, segue válido.
- **Item 2** (cabeçalho de vigência): idem, já verificado de forma independente na Rodada 1.
- **Item 3/4** (diretiva no motor-agente): lógica já revisada linha a linha na Rodada 1 (correta);
  o único bloqueio era a base do arquivo, resolvido agora.

Story pronta pra seguir ao @devops quando o Junior autorizar — **mas o deploy da Edge Function é
obrigatório antes do push** (regra NON-NEGOTIABLE já sinalizada na análise de impacto da própria
story: function compartilhada pelas 4 personas, erro aqui afeta atendimento real em produção
imediatamente).

## QA Results

**Revisor:** @qa (Quinn) · **Data:** 2026-09-11 · **Veredito: FAIL** (bloqueante — não seguir para @devops)

### Achado crítico — arquivo-base desatualizado remove a feature S-WM-70 (produção)

**O quê:** comparei `supabase/functions/motor-agente/index.ts` (versão local, com as mudanças da
S-PROG-10) contra `origin/main` e o diff mostra, além das adições da S-PROG-10, a **remoção** de:
- o campo `encerrar?: boolean` em `DecisaoConversaEngajada`;
- o branch inteiro que lê `avaliacaoSemantica.quer_sair` dentro de `decidirConversaEngajada` e
  devolve a despedida (`"Que bom poder ajudar!..."`);
- o tratamento no `handler` que, ao ver `decisaoEngajada.encerrar`, marca `conversas.status =
  'encerrada'` e devolve `encerrado: true` na resposta HTTP — campo consumido pelo worker Python
  em `meta_adapter_inbound.py:666`.

Esse código é a feature **S-WM-70** ("fix(institucional): encerra conversa quando lead se despede"),
mergeada em `main` antes até da S-PROG-03 (commit `1ca4de1`, bem anterior a esta sessão). Não é
código que a S-PROG-10 deveria tocar — nem o Dev Agent Record menciona ter mexido nisso. O que
aconteceu: o arquivo local de onde o @dev partiu pra codar os itens 3/4 estava desatualizado (não
tinha a S-WM-70 aplicada) — o mesmo tipo de problema já visto nesta sessão com `cuca-portal`
(branch local desatualizada), mas desta vez no `motor-agente`, sem ninguém ter comparado contra
`origin/main` antes de codar em cima.

**Consequência se isso fosse deployado como está:** qualquer lead que se despedisse ("Obrigada!",
"já pode encerrar", etc.) pararia de ter a conversa marcada como encerrada — voltaria a cair no
canned genérico "Em que mais posso te ajudar? 😊" que a S-WM-70 existiu pra corrigir (achado real
de produção, 2026-09-05, conversa `e09247c6-18ad-4a0e-bcdc-9a9ef3cfd26b`, documentado no próprio
teste que seria apagado). Regressão silenciosa de uma feature ativa, sem relação nenhuma com o
que esta story deveria mudar.

**Confirmado também em `index.audit.test.ts`:** 102 linhas removidas no diff contra `origin/main`
— são os testes de integração da S-WM-70 (frases reais de despedida coletadas em produção,
verificação de ordem de branches), que desapareceriam junto.

**Por que é bloqueante:** a lógica da S-PROG-10 em si (`montarDiretivaVigenciaMes` e a integração)
está correta e bem testada — não é o achado. O problema é que o arquivo inteiro, se pusheado como
está, regride uma feature de produção sem que isso apareça em nenhum lugar da story ou do Dev
Agent Record. `deno test` local não pegou porque os testes da S-WM-70 também estavam ausentes do
arquivo local — a suíte "passou" porque não tinha o que checar.

**Correção necessária:** @dev precisa atualizar o arquivo local de `motor-agente/index.ts` (e
`index.test.ts`/`index.audit.test.ts`) pra a versão real de `origin/main` **antes** de reaplicar
as mudanças da S-PROG-10 (itens 3/4) em cima da base correta — não reverter o que já foi feito,
só trocar a base. Recomendo o mesmo padrão de worktree limpo a partir de `origin/main` já usado
pelo @devops nas S-PROG-08/09, desta vez também para o `motor-agente`.

### Demais checks (o que passou, independente do achado acima)

1. **Item 1 (metadados) e item 2 (cabeçalho de vigência)** — migrations SQL, sem relação com o
   arquivo do motor-agente. Reproduzi de forma independente em produção: 12 meses testados um a
   um (unidade diferente da que o @dev usou), `metadados` corretos nos caminhos INSERT e UPDATE,
   fallback de campanha sem atividade funcionando. Sem achados.
2. **Lógica de `montarDiretivaVigenciaMes`/`calcularDiretivaVigenciaMes`** — código correto:
   trata `mes`/`ano` ausentes, tipo errado, fora de 1-12, mês corrente e mês "futuro" todos como
   `""` (AC3/AC5); só injeta diretiva pra mês estritamente anterior (AC4); ponto de integração
   (`contextRAG += `) é literalmente um no-op quando vazio, cumprindo AC3 por construção, não por
   coincidência.
3. **Achado não-bloqueante (performance):** a nova chamada roda sequencial, fora do `Promise.all`
   já usado no branch de visão geral pra outras 2 consultas paralelas — mais um round-trip de
   rede por mensagem, não paralelizado, num arquivo com histórico de otimização cuidadosa desse
   tipo de coisa (S-WM-43). Não é erro, é oportunidade de melhoria — poderia reaproveitar
   `metadados` que `buscarAtividadeDeterministica` já busca no branch de acompanhamento, ou
   paralelizar com o `Promise.all` existente no branch de visão geral.
4. **AC6** — `buscarAtividadeDeterministica` não foi tocada por nenhuma das mudanças desta story
   (confirmado por leitura, nenhuma das duas migrations nem o diff do motor-agente encostam nela).
5. **AC7** — não regredido: nenhuma mudança desta story toca `payload.ts` nem as chaves que
   `formatarLinhaAtividadeDeterministica` lê.
