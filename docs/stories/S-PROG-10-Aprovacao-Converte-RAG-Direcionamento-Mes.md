# S-PROG-10 — Aprovar converte para o RAG, e o LLM sabe de que mês é a programação

**Status:** Ready
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

## Change Log

| Data | Autor | Mudança |
|---|---|---|
| 2026-09-10 | @dev (Dex) | Story rascunhada após percorrer a esteira planilha→RAG inteira (rota, trigger, `processar-documento`, motor-agente) e confirmar que a conversão já funciona; o recorte real é o direcionamento de mês |
| 2026-09-10 | @po (Pax) | Validado GO (9/10). AC3 reescrito para ser verificável sem depender de resposta do LLM. Status Draft → Ready |
