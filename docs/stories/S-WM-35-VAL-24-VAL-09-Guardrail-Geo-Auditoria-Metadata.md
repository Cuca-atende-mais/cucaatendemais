# S-WM-35 — VAL-24 (guardrail geográfico) + auditoria de campos trocados (VAL-09, família "programação incompleta")

## Status
Ready for Review — Frente A concluída, tarefa "remover .limit(40)" concluída, Frente B1 (auditoria) concluída, Frente B2 (parser barulhento) concluída, Frente B3 (José Walter) concluída e aplicada em produção. Investigação pendente (tela de criação manual "Criar Programação Mensal") concluída. Frente C (consulta determinística em `atividades_mensais.metadata`) implementada e follow-up pós-validação do sócio aplicado: recuperação de atividade pelo histórico, cobertura dos 4 caminhos de unidade, busca em todas as categorias e prompt de enumeração completa. Deploy/push/PR pendentes de @devops.

## Origem
`docs/migracao-meta/PENDENCIAS-institucional-2026-07-15(2).md` (reteste pós-S-WM-34) + investigação de diagnóstico desta sessão (turno anterior a esta story) + instrução direta do usuário pra implementar em 3 frentes (A, B, C), com B dividida em B1 (auditoria) → B2 (parser) → B3 (correção do dado já importado).

## Escopo desta story
- **Frente A** — reforço textual do `INSTRUCAO_SEGURANCA` contra alucinar proximidade geográfica (VAL-24).
- **Frente B1** — auditoria completa, unidade por unidade, do padrão de campos trocados em `atividades_mensais.metadata`, documentada aqui ANTES de qualquer fix (exigência explícita do usuário).
- B2 (parser barulhento), B3 (correção do dado) e C (consulta determinística) ficam para commits/sessões separados, um checkpoint por frente.

---

## Frente A — Guardrail geográfico (CONCLUÍDA, commit `93e8377`)

**Fix:** nova Regra 7 em `INSTRUCAO_SEGURANCA` (`supabase/functions/motor-agente/index.ts:350-388`) proibindo inventar proximidade geográfica/distância/bairro sem dado real no contexto.

**Teste:** `Deno.test("VAL-24 (geo): guardrail (regra 7) proibe explicitamente inventar proximidade geografica...")` em `index.audit.test.ts`, seguindo o mesmo padrão do teste VAL-02 já existente (prova que o texto existe; eficácia real depende de reteste manual, não é testável de forma determinística com temperatura 0.7).

**Suíte:** `deno test --allow-env --allow-net --no-check` → **128 passed / 0 failed / 2 ignored** (127 anteriores + 1 novo). Os 76 erros de type-check (`deno test` sem `--no-check`) e os 6 warnings de lint são pré-existentes — confirmado via `git stash` rodando a mesma suíte antes do diff, mesma contagem.

**Fora de escopo (conforme pedido):** não conectei `unidades_cuca` nem implementei cálculo de proximidade.

---

## Frente B1 — Auditoria completa de `atividades_mensais.metadata` (CONCLUÍDA)

### Método
Sem acesso às planilhas `.xlsx` originais (ver achado crítico #3 abaixo — elas não existem em nenhum storage do sistema), a auditoria foi feita por **classificação de padrão de conteúdo**: para cada campo do `metadata` (`sexo`, `vagas`, `dias_semana`, `horario`, `faixa_etaria`), comparei o VALOR real contra o formato esperado pelo RÓTULO (dia da semana, número, horário, faixa etária, enum de sexo) via regex agregada em toda a tabela `atividades_mensais` (categoria `ESPORTES`), não só amostras. Isso é uma inferência forçada por semântica de valor (um número só pode ser vagas; um dia da semana só pode ser dias_semana; um horário só pode ser horário; "MISTO" só pode ser sexo) — não uma suposição.

### Achado 1 — Cuca José Walter: rotação completa dos 5 campos, 100% das linhas (214/214)

Query de classificação agregada confirmou, sem exceção, em todas as 214 linhas `categoria='ESPORTES'`:

| Rótulo no metadata | Conteúdo REAL encontrado | Campo verdadeiro |
|---|---|---|
| `sexo` | número puro (ex.: "25") | **vagas** |
| `vagas` | dia da semana (ex.: "TER/QUI") | **dias_semana** |
| `dias_semana` | horário (ex.: "18h ás 19h") | **horario** |
| `horario` | faixa etária (ex.: "15 á 29+ anos") | **faixa_etaria** |
| `faixa_etaria` | enum de sexo (ex.: "MISTO") — confirmado 214/214 bate `^(misto|masculino|feminino)$` | **sexo** |

`professor` e `turma` não são afetados (batem com o esperado). Rotação cíclica de 5 posições, consistente com o parser caindo no fallback fixo `row[fb]` porque `find(/faixa|idade/|sexo|naipe/|vagas/|dias/|hor[aá]rio/)` não bateu em nenhum header da planilha de José Walter (ou o header row real não está na posição `data[1]` assumida pelo parser), combinado com uma ordem de colunas real deslocada em 1 posição em relação à ordem fixa assumida pelo fallback (`titulo=1, professor=2, turma=3, faixaEtaria=4, sexo=5, vagas=6, dias=7, horario=8`).

**Recuperável via remap SQL** — o dado real de todos os 5 campos está presente, só sob o rótulo errado.

### Achado 2 — Cuca Barra, Jangurussu, Mondubim, Pici: só `faixa_etaria` errado, 100% uniforme (558 linhas no total — 116+62+198+182)

Nas 4 unidades restantes, `professor`, `turma`, `sexo`, `vagas`, `dias_semana` e `horario` batem corretamente com o formato esperado (~95-100% — ver ressalva abaixo). O único campo sistematicamente errado é `faixa_etaria`, que é sempre **idêntico ao `titulo`** (nome da modalidade), nunca uma faixa etária real:

```json
{"sexo":"Misto","turma":"Turma 11","vagas":"25","horario":"07:00 ás 08:00","professor":"CIRILLO","dias_semana":"Qua e Sex","faixa_etaria":"NATAÇÃO"}
```

Confirmado 100% (116/116 Barra, 62/62 Jangurussu, 198/198 Mondubim, 182/182 Pici) via `count(*) filter (where metadata->>'faixa_etaria' = titulo)`.

**Ressalva de precisão (não superestimar a limpeza dos outros campos):** ~6 linhas em Barra, Mondubim e Pici têm valores fora do padrão esperado nos campos "corretos" — mas são variações de conteúdo da própria planilha de origem, não o bug de rotação: `sexo: "INFANTIL"` (Barra, provavelmente confusão de quem preencheu a planilha), `vagas: "20 por turma"` (Mondubim, texto em vez de número puro), `professor: "Nome Sobrenome"` + `horario: "00h00 às 00h00"` (Mondubim, parece linha de template/exemplo não preenchida na planilha original), `sexo: "MISTO "` com espaço à direita (Pici, só formatação). Nenhuma dessas ~6 linhas muda o diagnóstico da rotação — são ruído de qualidade de dado da fonte, não do parser.

**NÃO recuperável via remap SQL** — diferente de José Walter, aqui o dado real de faixa etária nunca foi capturado em nenhum campo (não está "trocado de posição" com outro campo, simplesmente não está em lugar nenhum). Corrigir isso exigiria reprocessar a planilha original com um parser corrigido — e a planilha original não está disponível no sistema (ver achado 3).

### Achado 3 (crítico, não estava no escopo original do pedido, mas bloqueia B3 como formulado) — as planilhas `.xlsx` originais não existem em nenhum storage

O parser roda 100% client-side (`import-planilha-modal.tsx`, biblioteca `xlsx`, lê o `File` do input direto no browser) e nunca envia o arquivo original para o Supabase Storage — só o resultado já parseado (JSON) via `/api/programacao/importar`. Conferido: os 3 buckets do Storage (`programacao`, `curriculos`, `rag-documentos`) não têm nenhum `.xlsx` — só imagens de flyer. **Não há como reprocessar a planilha original pra recuperar o `faixa_etaria` perdido nas 4 unidades, nem os dados de Jangurussu/ESPORTE (achado 4) — isso exigiria pedir os arquivos de volta pra quem os tem.**

### Achado 4 (crítico, terceiro padrão de erro, distinto dos dois acima) — Cuca Jangurussu tem 66 linhas totalmente corrompidas sob `categoria='ESPORTE'` (sem S)

Comentário do backlog herdado ("Planilha ESPORTE - JUNHO com o mesmo erro de digitação, provavelmente ainda não reimportada") **confirmado e é pior do que uma pendência de reimport** — já está no banco, ativo, hoje:

```sql
select unidade_cuca, categoria, count(*) from atividades_mensais where categoria in ('ESPORTE','ESPORTES') group by 1,2;
-- Cuca Jangurussu | ESPORTE  | 66   ← typo, sem o S
-- Cuca Jangurussu | ESPORTES | 62   ← correto
```

O parser (`import-planilha-modal.tsx:280`) só entra no branch `esportesIdx` quando `categoriaVal === "ESPORTES"` (comparação estrita). A aba com o nome digitado errado ("ESPORTE") cai no branch genérico de fallback total (`titulo = row[2] || row[1] || row[4]`), que para essas 66 linhas capturou **nomes de professor como título** (`"Daniel Reis"` 19x, `"Carlos Frota"` 8x, etc. — nunca um nome de modalidade) e `metadata = { info_bruta: "25" }` (provavelmente o número de vagas, sem mais nenhum campo estruturado). Essas 66 linhas são hoje **inutilizáveis** para busca por modalidade — nem `extrairModalidades`/`detectarAtividadeMencionada` (S-WM-34) nem nenhuma consulta futura em `atividades_mensais.metadata` (Frente C) encontraria essas turmas, porque não há nome de modalidade nenhum gravado. Mesma causa raiz do achado 3: sem a planilha original, não recuperável por SQL.

### Achado 5 (crítico, muda o entendimento de toda a Frente C) — `atividades_mensais` e a RAG do bot NÃO são independentes: existe um pipeline de 3 estágios já conectado por trigger

Investigação de schema (antes eu supunha que `atividades_mensais` e `documentos_rag`/`chunks_documentos` fossem dados paralelos sem ligação — **estava errado**, encontrei a ligação real):

```
atividades_mensais.descricao (string já achatada, com o mesmo bug de rotação)
        │
        │  campanhas_mensais.status → 'aprovado'  dispara
        ▼
trigger_indexar_campanha_mensal()  [AFTER INSERT/UPDATE em campanhas_mensais]
  → lê atividades_mensais.descricao (NÃO o metadata jsonb) de todas as linhas da campanha
  → monta documentos_rag.conteudo (o texto "PROGRAMAÇÃO MENSAL... == ESPORTES == • NATAÇÃO...")
        │
        ▼
trigger_indexar_documento()  [AFTER INSERT/UPDATE em documentos_rag, exceto tipo='resumo_rede']
  → net.http_post (pg_net, assíncrono) pra Edge Function `processar-documento`
  → gera embeddings + grava chunks_documentos
```

**Implicação crítica pra B3 e C:**
1. **O bot lê `chunks_documentos`, que vem de `descricao`, não de `metadata`.** Corrigir só o `metadata` jsonb (como a B3 original pedia) **não teria efeito nenhum** no que o bot vê — precisa reconstruir também o `descricao` (usando o mesmo template de `import-planilha-modal.tsx:298`: `"Esporte Modalidade: ${titulo} - Turma ${meta.turma}. Professor: ${meta.professor}. Vagas: ${meta.vagas}. Público: ${meta.sexo} (Idade: ${meta.faixa_etaria}). Dias: ${meta.dias_semana}. Horário: ${meta.horario}."`) a partir dos valores já desembaralhados.
2. **Depois de corrigir `descricao`, é preciso reacionar o trigger** (ex.: um `UPDATE campanhas_mensais` na campanha ativa de José Walter) pra regenerar `documentos_rag.conteudo` e, em cascata, re-chunkar/re-embedar via `processar-documento` — isso é uma ação real com custo de API (chamada à OpenAI pra gerar embeddings), não um toque passivo. Precisa confirmar sucesso (contagem/conteúdo dos chunks) antes de considerar concluído, e é o tipo de mutação em produção que pede checkpoint humano antes de disparar.
3. **A premissa da Frente C fica em aberto, não é mais certeza.** O plano original (do documento do sócio) assumia que a rotação de campos era a causa do corte "16 chunks → 2 turmas corretas". Com o pipeline mapeado, uma vez que B3 limpar o `descricao` e reindexar, o caminho ATUAL (`buscarAtividadeEspecifica`, busca por substring em `chunks_documentos`) já passa a rodar sobre dado limpo. Recomendo: aplicar B3, **reconferir ao vivo o cenário do José Walter** (mesma pergunta de natação noturna), e só then decidir se a Frente C (consulta determinística em `atividades_mensais.metadata`) ainda é necessária — pode ser que o problema real fosse só o dado sujo, não a geração do GPT.

---

## Decisões que precisam do usuário antes de continuar (não resolvidas nesta auditoria)

1. **Escopo de B3 mudou:** "corrigir o metadata" (como formulado) não é suficiente — precisa também reconstruir `descricao` e reacionar o pipeline de reindexação (custo real de API, ação em produção). Confirmar se seguimos.
2. **Recuperação de dado não é possível via SQL pra 2 dos 3 problemas encontrados:** `faixa_etaria` das 4 unidades (Barra/Jangurussu/Mondubim/Pici) e as 66 linhas de Jangurussu/ESPORTE exigem as planilhas originais, que não existem no sistema. Só José Walter (rotação completa) é 100% recuperável via SQL. Precisa decidir: pedir as planilhas de volta ao sócio, ou aceitar a lacuna por ora (ela não bloqueia o caso do VAL-09 relatado, que é sobre José Walter/horário noturno).
3. **Frente C pode não ser mais necessária** (ou pelo menos não com a urgência assumida) — depende do reteste pós-B3.

---

## Tarefa extra — remover `.limit(40)` de `carregarProgramacaoMensal` (CONCLUÍDA)

Achado adjacente da S-WM-34 (branch de "visão geral completa" truncava em 40 chunks), confirmado urgente por dado real: as 5 unidades já ultrapassam o teto hoje (José Walter/Pici: 55 chunks / 146-124 atividades; Jangurussu/Mondubim: 47; Barra: 42).

**Investigação (reportada antes de implementar, aprovada):** `gpt-4o` (`GPT_MODEL`) tem janela de 128k tokens. Pior caso real medido (~64k caracteres somando `prompt_sistema` + `INSTRUCAO_SEGURANCA` + `prompt_contexto` + monthly_program + histórico) fica em ~16k tokens — folga de >100k tokens. Removido sem substituir por outro número fixo (nenhuma constante prevê o crescimento real, que variou 89-146 atividades nos últimos 3 meses).

**Fix:** `.limit(40)` removido de `carregarProgramacaoMensal` (`index.ts`). Adicionado, a pedido do usuário (Junior — "log é fraco como rede de segurança, sem monitoração ativa no projeto"), um `console.warn` acima de 100 chunks (~3x o maior volume já visto) — não trunca nada, só torna visível um caso anormal (import duplicado/corrompido).

**Testes:** 4 testes de guarda pré-existentes (`AUD-04`, `VAL-07`, `VAL-08`, `Item3/AC5`) usavam `.limit(40)` como fingerprint — atualizados pra fingerprint via log (`"Chunks diretos monthly_program:"`), já que a chamada `.limit()` deixou de existir. 3 testes novos: carrega os 55 chunks inteiros sem truncar; não alerta com 90 chunks; alerta com 150. Suíte: **131 passed / 0 failed / 2 ignored**.

**Commit:** `34d4089`.

---

## Frente B2 — Parser barulhento (CONCLUÍDA)

**Escopo confirmado pelo usuário (expandido a partir do pedido original):** cobrir os 3 pontos frágeis — detecção de categoria da aba (split do nome da planilha), colunas de ESPORTES (já parcialmente por nome, mas com fallback silencioso por posição), e colunas de CURSOS/DIA A DIA/ESPECIAIS (0% de detecção por nome antes desta tarefa, 100% posicional).

### Resposta às 4 perguntas do Junior (antes de codar, ver turno anterior)

1. **Nome, não posição** — confirmado por evidência de código: ESPORTES já usava `find()` por regex contra o header real, mas caía num fallback fixo por posição quando o `find()` falhava (a causa da rotação de José Walter). CURSOS e DIA A DIA/ESPECIAIS não tinham NENHUMA tentativa de detecção por nome (100% índice fixo desde sempre). Fix: os 3 agora usam detecção por nome via `detectarColunas` (novo módulo puro).
2. **Abortar, não adivinhar** — confirmado: quando `detectarCategoria` retorna `null` (nome de aba não bate com nenhuma categoria válida) OU `detectarColunas` não encontra alguma coluna esperada, a importação INTEIRA é abortada (`throw`, propaga pro try/catch externo, nunca chega a chamar `/api/programacao/importar`) — nenhuma linha é gravada, mesmo que outras abas do arquivo estivessem OK. Distinção preservada: aba genuinamente vazia (nenhuma célula preenchida em nenhuma linha) continua só um aviso, não aborta — a diferença que importa é "nada pra ler" vs. "algo pra ler que não dá pra confiar".
3. **Testes contra formatos reais** — **não foi possível**, confirmado na auditoria B1: as planilhas `.xlsx` originais não existem em nenhum storage do sistema (import é 100% client-side). Cobri com fixtures SINTÉTICAS (coluna reordenada, header com nome parecido mas reconhecível, coluna ausente, coluna extra) nas 3 categorias — documentado como limitação, não apresentado como equivalente a testar contra arquivo real.
4. **Teste automatizado provando falha visível** — `cuca-portal` não tinha nenhuma infraestrutura de teste (confirmado: sem script `test`, sem Jest/Vitest, zero arquivos `.test.`/`.spec.` em todo o `src/`). Autorizado pelo usuário: introduzido **Vitest** (`vitest.config.ts`, script `test` no `package.json`) e extraída a lógica de detecção pra um módulo puro exportado (`src/lib/programacao/planilha-parser.ts`), testável sem renderizar o componente React.

### Implementação

- **Novo módulo puro:** `src/lib/programacao/planilha-parser.ts` — `detectarCategoria` (nome da aba → categoria válida ou `null`), `detectarColunas` (header → índices ou lista de chaves faltando + header real encontrado, pra mensagem de erro útil), `lerColuna` (nunca cai em índice fixo), e as 3 listas de colunas esperadas (`COLUNAS_ESPORTES`, `COLUNAS_CURSOS`, `COLUNAS_DIA_A_DIA`).
- **Limitação documentada no próprio código:** os regexes de CURSOS e DIA A DIA/ESPECIAIS são um *best-effort* — sem as planilhas reais, foram escolhidos a partir dos nomes de campo que o código já usava (`ementa`, `requisitos`, `carga_horaria`, `educador` etc.). Se um regex errar contra uma planilha futura, o resultado esperado é um ABORT visível (com o header real na mensagem de erro, pra ajustar o regex) — nunca dado embaralhado silencioso. Essa garantia é o que importa, não a precisão do palpite.
- **Achado durante a extração:** no branch DIA A DIA, `titulo` (nome do Programa, ex. "Calendário de Matrículas") e `meta.atividade` (a tarefa específica, ex. "Marcação dos testes de Natação") são campos DISTINTOS no código original (confirmado no texto já gravado em `atividades_mensais.descricao` de produção) — um rascunho inicial desta tarefa os conflacionou por engano; corrigido antes de aplicar no componente.
- **`import-planilha-modal.tsx`:** `categoriaVal` e `esportesIdx` (fallback silencioso) removidos, substituídos pelas funções puras. Checagem de "aba vazia" (não abortante) roda ANTES da checagem de categoria/colunas (não abortante), preservando o aviso gracioso pra abas realmente em branco.

### Testes

`src/lib/programacao/planilha-parser.test.ts` (Vitest, 22 testes): categoria válida nas 4 formas, achado Jangurussu (`ESPORTE` sem S → `null`, não "Diversos"), aba sem hífen, categoria desconhecida, tolerância a espaço/caixa; `detectarColunas` pras 3 categorias com fixtures de coluna reordenada, header variante, coluna ausente (identifica a chave certa) e coluna extra; distinção `titulo`/`atividade` em DIA A DIA. **22 passed, 0 failed.**

**Regressão:** `deno test` do `motor-agente` inalterado (131/0/2, não tocado nesta frente). `tsc --noEmit` no `cuca-portal`: 0 erros novos (1 erro pré-existente não relacionado, confirmado via `git stash`). `eslint` no `import-planilha-modal.tsx`: mesma contagem de 17 problemas pré-existentes (14 erros, 3 warnings — todos `no-explicit-any`/`prefer-const`/`no-unescaped-entities` já presentes antes desta mudança, confirmado via `git stash`), zero novos.

## Correção 1 do usuário (pós-B1) — reavaliação da recuperabilidade das 4 unidades

O Junior informou que nenhuma planilha `.xlsx` vai ser buscada de volta com o sócio (as 5 já estão no banco e aprovadas). Isso exigiu reavaliar minha conclusão anterior ("só José Walter é recuperável, as outras 4 precisam do arquivo original"):

- **Reconfirmado com evidência, não só repetido:** contei `faixa_etaria ≠ titulo` em TODO o histórico (não só a campanha ativa) das 4 unidades — **0 em 558 linhas**, atravessando múltiplos meses/campanhas já importados. Não há nenhum outro campo da linha (`local`, `hora_inicio`, `hora_fim`, `descricao`) guardando esse dado por acidente.
- **Achado mais preciso que a resposta anterior:** dado que o padrão se repete de forma 100% idêntica em todo mês já importado (não só uma vez), a explicação mais provável não é "o parser perdeu o dado" (caso José Walter, onde os valores reais existem sob rótulo errado) — é que **a planilha de origem provavelmente nunca teve uma coluna de Faixa Etária genuinamente distinta pra essas 4 unidades** (célula mesclada repetindo o nome da modalidade, ou coluna inexistente no template). Ou seja: mesmo que o `.xlsx` estivesse disponível, é bem provável que ele não teria essa informação — o buraco pode estar na planilha de origem, não seguro que seja (só) recuperável reimportando.
- **Conclusão prática:** esse gap passa de "pendente, aguardando arquivo" pra **gap aceito permanentemente por ora** — não bloqueia o VAL-09 relatado.
- **Achado bônus sobre Jangurussu:** as 66 linhas corrompidas (`categoria='ESPORTE'`, sem S) são **dado duplicado, não perda única** — os mesmos nomes de professor aparecem com contagens quase idênticas na aba correta (`ESPORTES`, 62 linhas: Daniel Reis 19/19, Bruno Santos 7/7, Carlos Frota 8/6). O dado real de Jangurussu já está intacto. Limpeza (desativar as 66 linhas) fica pendente de autorização separada — **não fazer ainda**, conforme instrução do usuário.

## Frente B3 — Correção de José Walter (CONCLUÍDA, aplicada em produção)

**Escopo confirmado:** só José Walter (rotação completa, 100% recuperável via SQL). As 4 unidades sem faixa etária e as 66 linhas de Jangurussu ficam como estão.

**Migration:** `supabase/migrations/20260716000000_swm35_corrige_rotacao_metadata_jose_walter.sql` — remapeia os 5 campos rotacionados (`sexo`↔`vagas`↔`dias_semana`↔`horario`↔`faixa_etaria`, cíclico) e reconstrói `descricao` com o mesmo template de `import-planilha-modal.tsx`. Idempotente por construção: guard `metadata->>'sexo' ~ '^[0-9]+$'` (a assinatura do estado quebrado) — confirmado empiricamente rodando a mesma UPDATE duas vezes: 214 linhas afetadas na 1ª, **0 linhas na 2ª**.

**Verificação antes de aplicar:** simulei a transformação com um SELECT read-only nas 5 turmas noturnas do caso original (09, 10, 19, 20, 23) e conferi visualmente que os valores batiam antes de qualquer escrita.

**Aplicado via `apply_migration`.** Resultado: 214/214 linhas corrigidas, 0 ainda quebradas.

**Pipeline reacionado e confirmado ponta a ponta** (não só a tabela-fonte): `UPDATE campanhas_mensais SET updated_at = NOW()` na campanha ativa de José Walter (`6502b8c5-...`) re-disparou `trigger_indexar_campanha_mensal` (confirmado: `documentos_rag.updated_at` mudou), que em cascata disparou `trigger_indexar_documento` (assíncrono via `pg_net`) → `processar-documento` re-chunkou e re-embedou (confirmado: `chunks_documentos` com `created_at` novo, 38 chunks — contagem diferente de 55 porque o `processar-documento` atual usa um tamanho de chunk diferente do que gerou o índice original em 2026-07-06, mesmo conteúdo, ~43,8K caracteres antes e depois). **Conferido no `chunks_documentos` real, não só no banco de origem:** as 5 turmas noturnas agora aparecem com rótulos batendo os valores (ex.: "NATAÇÃO - Turma 09... Vagas: 25. Público: MISTO (Idade: 15 á 29+ anos). Dias: TER/QUI. Horário: 18h ás 19h.").

**Nota:** `hora_inicio`/`hora_fim` (colunas `time` estruturadas) permanecem `NULL` — já eram nulas antes desta migration (não regressão), não são lidas pelo motor-agente hoje (só `chunks_documentos.conteudo`), e parsear os formatos de horário livre direto em SQL seria mais arriscado que a lógica já testada em TypeScript. Registrado como gap conhecido, fora do escopo desta frente.

**Reteste ao vivo pendente** (mesma pergunta de natação noturna do José Walter) fica pra depois da Frente C, conforme já planejado — mas o dado que o bot lê já está corrigido agora.

## Correção 2 do usuário — investigação da tela de criação manual "Criar Programação Mensal"

**Achado crítico: minha investigação anterior (Correção 2, turno passado) estava incompleta.** Eu tinha concluído "só 3 arquivos tocam `atividades_mensais`, nenhuma criação manual" — buscando literalmente a string `"atividades_mensais"` no código. Isso não encontrou `criar-programacao-modal.tsx` porque esse componente **nunca menciona o nome da tabela** — ele só faz `POST` pra `/api/programacao/importar` (a MESMA rota de API que `import-planilha-modal.tsx` usa), que é quem de fato grava na tabela. Um grep por nome de tabela não pega quem escreve só via uma rota de API compartilhada — exatamente o que o usuário avisou que poderia ter acontecido.

**Localização:** `cuca-portal/src/components/programacao/criar-programacao-modal.tsx` (story `SQS-44`, comentário no topo do arquivo: "Modal de criação interna guiada da Programação Mensal — Coexiste com o upload de planilha, não substitui"). UI wizard de 3 passos (Cabeçalho → Atividades → Revisão), com sub-formulários por categoria (`FormCursos`, `FormEsportes`, `FormDiaDia`), abas CURSOS/ESPORTES/DIA A DIA/ESPECIAIS.

**1. Mesmos campos estruturados?** Sim, exatamente os mesmos — confirmado campo a campo:
- ESPORTES: `professor`, `turma`, `faixa_etaria` (montado como `` `${faixa_de} a ${faixa_ate} anos` ``), `sexo`, `vagas`, `dias_semana`, `horario` — as mesmas 7 chaves do import de planilha.
- CURSOS: `ementa`, `educador`, `vagas`, `carga_horaria`, `requisitos`, `periodo`, `horario`, `dias_semana` — idem.
- O `descricao` é montado com o **mesmo template literal**, comentário no próprio código confirma a intenção: *"Descricao no mesmo formato que o trigger usa para montar o RAG"*.

**2. Mesmo risco de rótulo trocado (B2)?** **Não.** É formulário estruturado 1:1 — cada campo tem seu próprio estado (`set(key, val)`/`setRoot(key, val)`), sem nenhum parsing de texto livre, sem `find()`/regex de header, sem índice de coluna. "Faixa Etária De/Até" são 2 inputs numéricos separados combinados por template literal — determinístico. "Sexo" é um `<Select>` com opções fixas (Misto/Masculino/Feminino) — não dá pra digitar errado. "Dias da Semana" são botões de toggle, não texto. **A classe de bug da B2 (header não reconhecido → fallback silencioso por posição) não tem onde acontecer aqui** — não existe etapa de parsing pra dar errado. Mesma conclusão de `eventos_pontuais` (turno anterior), mas desta vez confirmada para um caminho que REALMENTE grava em `atividades_mensais`.

**3. Frente C precisa cobrir os dois caminhos?** Sim, mas **não precisa de nenhum ajuste extra** — porque os dois caminhos (planilha via B2, formulário manual) escrevem exatamente as mesmas chaves de `metadata` na mesma tabela, através da mesma rota de API. A consulta determinística da Frente C lê `atividades_mensais.metadata` por nome de chave, sem saber (nem precisar saber) qual UI criou a linha. Como o caminho manual é estruturalmente seguro (sem risco de rótulo trocado), o dado que ele produz já chega correto — a Frente C não precisa de lógica condicional por origem.

**Observação menor, não bloqueante:** o formulário salva a campanha com `status: "rascunho"` (não `"aprovado"` direto) — precisa da aprovação manual de sempre (`/programacao/mensal/[id]`) antes de entrar no RAG, mesmo fluxo de qualquer campanha. Sem impacto na conclusão acima.

## Frente C — Consulta determinística em `atividades_mensais.metadata` (CONCLUÍDA)

**Contexto:** o Achado 5 (Frente B1) tinha deixado em aberto se a Frente C ainda seria necessária depois da B3 corrigir o `descricao`/pipeline de reindexação de José Walter — a hipótese era que o problema real pudesse ser só dado sujo, não uma limitação da busca por texto. Retestado ao vivo (checkpoint do usuário) e confirmado: a busca ainda tem valor mesmo com o dado limpo, porque `buscarAtividadeEspecifica` (S-WM-34) depende do texto já chunkeado/embeddado — a Frente C lê direto da tabela-fonte estruturada, mais confiável e imune a qualquer variação futura de chunking.

### Desenho confirmado pelo usuário antes da implementação
1. **Escopo:** só categoria ESPORTES (mesmo escopo que `buscarAtividadeEspecifica` já tinha) — CURSOS/DIA A DIA ficam de fora desta frente.
2. **Correlação unidade → campanha:** `atividades_mensais.campanha_id` filtrado pelo `campanha_id` extraído de `documentos_rag.metadados->>'campanha_id'` do documento `monthly_program` ativo mais recente da unidade — mesmo campo que `trigger_indexar_campanha_mensal` grava (confirmado via `execute_sql` contra `pg_proc` em produção, read-only, nesta sessão). Como o trigger desativa o `monthly_program` de campanhas antigas da mesma unidade ao aprovar uma nova, "documento ativo" já garante "campanha aprovada mais recente", sem filtro de status adicional.
3. **Comparação de modalidade:** `normalizarTexto()` dos dois lados (nunca `===` sobre string crua) — protege contra variação de caixa/acento entre linhas da MESMA modalidade (planilhas de origem não são 100% consistentes, confirmado na auditoria B1).
4. **Reconhecimento de modalidade:** reusa `detectarAtividadeMencionada` (S-WM-34) contra os `titulo`s distintos da própria tabela — já validado nesta sessão contra erro de digitação real (`"randebol"` → `null`, cai no fallback com segurança) e contra os pares de nomes parecidos que existem de fato no banco (Cuca Pici: "FUTSAL ( INTEGRAÇÃO )"/"FUTSAL (SESC)"; Cuca José Walter: "JIU JITSU "/"JIU JITSU INFANTIL") — nenhum cenário real encontrado onde a busca devolve a modalidade ERRADA; o pior caso observado é `null` (cai pro fallback), nunca uma resposta confiantemente errada.
5. **Guarda do gap conhecido (Achado 2, Frente B1):** `faixa_etaria === titulo` (comparado via `normalizarTexto`) vira `"nao informado"` em vez de repetir o dado corrompido — José Walter (corrigido na B3) nunca bate nessa condição. Qualquer outro campo ausente/vazio também vira `"nao informado"`, nunca quebra nem inventa.
6. **Integração — 2 branches:**
   - Branch de acompanhamento: `buscarAtividadeDeterministica` primeiro → se `null`, `buscarAtividadeEspecifica` (S-WM-34) → se `null`, busca vetorial original. 3 camadas, cascata automática via `??`, sem condição extra.
   - Branch de visão geral: só ativa quando `trocaComPedidoEspecifico=true` (S-WM-34/VAL-23); quando encontra dado, SOMA um bloco `--- ATIVIDADE ESPECIFICA (dado exato) ---` ao `conteudoPrograma` — não substitui o resumo geral.
7. **Mutuamente exclusivo com `resumo_rede`:** garantido por estrutura de controle de fluxo (cadeia `if`/`else if`/`else if` do Passo 6, `index.ts`) — a Frente C só roda dentro dos 2 primeiros branches (ambos exigem `temUnidadeDefinida`); o branch de `perguntaGeralAtiva` só é alcançável quando os 2 primeiros são falsos. Não depende de coincidência de dado, verificado lendo o código, não retestado em runtime (não é necessário — é garantia estrutural).

### Implementação
- `formatarLinhaAtividadeDeterministica(titulo, metadata)` — função pura, formata uma linha no mesmo template usado em `import-planilha-modal.tsx`/`criar-programacao-modal.tsx` ("Esporte Modalidade: X - Turma Y. Professor: ..."), com a guarda do gap conhecido e o fallback `"nao informado"` por campo.
- `buscarAtividadeDeterministica(supabase, unidade, mensagem)` — função assíncrona: doc ativo → `campanha_id` → linhas ESPORTES da campanha → detecção de modalidade pelos títulos reais da tabela → filtro por igualdade normalizada → formata todas as linhas relevantes (todas as turmas da modalidade, não só a 1ª).
- Integrada nos 2 branches conforme desenho acima (`index.ts`).

### Testes
10 testes novos, 0 regressão:
- **4 testes puros** (`index.test.ts`, `formatarLinhaAtividadeDeterministica`): campos completos (dado correto pós-B3), gap conhecido → `"nao informado"`, campos ausentes/vazios → `"nao informado"`, `metadata` nulo não quebra.
- **6 testes de integração via `handler`** (`index.audit.test.ts`, mesmo padrão dos testes S-WM-34 AC1-AC4): dado correto pós-B3 (recupera todas as turmas, não cai em nenhum fallback), gap conhecido (idade não repete o título corrompido), modalidade não reconhecida (cai pro fallback S-WM-34 de texto, que por sua vez resolve), visão geral COM `trocaComPedidoEspecifico` (soma o bloco, não substitui), visão geral SEM `trocaComPedidoEspecifico` (não soma, nem consulta `atividades_mensais` à toa), `documentos_rag` sem doc ativo (degrada com segurança até o fallback vetorial, sem quebrar).

**Suíte:** `deno test --no-check --allow-env --allow-read --allow-net .` → **141 passed / 0 failed / 2 ignored** (131 anteriores + 10 novos). `deno check index.ts` → **75 erros** (baseline pré-existente, confirmado idêntico via `git stash`/`git stash pop` rodando a mesma checagem antes do diff). `deno lint` → **7 problemas** (idêntico antes/depois, confirmado via `git stash`).

**Deploy:** NÃO executado nesta sessão — instrução explícita do usuário foi "nenhum push/PR/deploy — commit local, aguardando @qa". Pendente de autorização futura (por @devops ou instrução direta), mesmo padrão já usado nas frentes anteriores desta story e na S-WM-34.

### Follow-up pós-validação do sócio — histórico + enumeração completa (CONCLUÍDO)

**Achados validados:** a correção de dados/truncamento estava OK, mas ainda havia 2 lacunas: (1) perguntas elípticas de troca/resolução de unidade não recuperavam a atividade citada no histórico; (2) o prompt não obrigava o GPT a listar todas as turmas/linhas quando o bloco exato já estava presente. Durante o plano, também foi confirmado que o filtro hardcoded `.eq("categoria", "ESPORTES")` impediria casos de alto volume fora de Esportes, como `Direitos Humanos` em `DIA A DIA`.

**Implementação:** adicionada resolução conservadora de atividade por histórico (`resolverAtividadeMencionadaComHistorico`): mensagem atual vence; histórico recente consulta apenas mensagens do lead; janela atravessa mensagens intermediárias do agente/menu; se houver mais de uma atividade distinta no histórico, não chuta e cai no comportamento seguro atual (visão geral/fallback, não pergunta de volta). `decidirPrimeiraMensagem` agora também aceita `avaliacaoSemantica.unidade`, fechando o 4º caminho de resolução por classificador. `buscarAtividadeDeterministica` passou a consultar todas as categorias da campanha em `atividades_mensais`, não só `ESPORTES`, e o prompt final ganhou instrução crítica para listar todas as turmas/linhas do bloco exato sem resumir/omitir.

**Fallback de ambiguidade:** explícito por decisão de segurança: não pergunta ao lead nesta story; retorna `null` e preserva o dump/fluxo genérico atual.

**Testes adicionados:** 4 testes puros para prioridade mensagem atual/histórico/ambiguidade/pedido amplo; 6 testes de integração cobrindo unidade salva (`detectarTrocaUnidade`), `decidirAguardandoUnidade`, `decidirConversaEngajada`, `decidirPrimeiraMensagem`, negativo anti-stale e `DIA A DIA / Direitos Humanos` com 9 linhas.

**Suíte:** `deno test --no-check --allow-env --allow-read --allow-net .` em `supabase/functions/motor-agente` → **151 passed / 0 failed / 2 ignored**.

### Follow-up PR #47 — falso positivo em pergunta de localização (CONCLUÍDO)

**Achado do sócio:** `mensagemPareceContinuacaoDeAtividade` tratava qualquer menção direta a unidade como continuação de atividade. Caso confirmado: histórico com "tem natação na Barra?" e mensagem atual "ah entendi, e o Pici, fica longe daqui?" retornava `{ atividade: "Natação", origem: "historico" }`, injetando bloco `ATIVIDADE ESPECIFICA` e instrução para listar turmas numa pergunta de localização.

**Correção:** a herança por histórico agora exige mensagem curta/elíptica. Removida a regra ampla baseada apenas em `detectarUnidadeDireta(texto)`. Mensagens com termos de localização/distância (`longe`, `perto`, `distância`, `bairro`, `endereço`, `chegar`, `fica` etc.) retornam `false` e preservam o fallback seguro.

**Testes:** adicionado teste puro reproduzindo exatamente "ah entendi, e o Pici, fica longe daqui?" e teste de integração garantindo que esse turno não injeta `ATIVIDADE ESPECIFICA` nem a instrução "liste TODAS as turmas". Ajustado o teste positivo de `conversa_engajada` para uma elipse curta válida.

**Suíte:** `deno test --no-check --allow-env --allow-read --allow-net .` em `supabase/functions/motor-agente` → **153 passed / 0 failed / 2 ignored**.

## Change Log

| Data | Mudança |
|---|---|
| 2026-07-16 | Frente A implementada e commitada (`93e8377`). Frente B1 (auditoria) concluída — 5 achados documentados, 3 deles mudam o escopo original de B3/C. Tarefa `.limit(40)` implementada e commitada (`34d4089`). Frente B2 (parser barulhento) implementada — Vitest introduzido, módulo puro `planilha-parser.ts` extraído, 3 pontos frágeis (categoria, ESPORTES, CURSOS/DIA-A-DIA) cobertos com detecção por nome + abort ruidoso. Correção 1 do usuário reavaliada (gap das 4 unidades e Jangurussu são permanentes, não "aguardando arquivo"). Frente B3 (José Walter) aplicada em produção via migration idempotente, confirmada ponta a ponta em `chunks_documentos`. Correção 2 do usuário investigada — achado que minha varredura anterior tinha perdido `criar-programacao-modal.tsx` (escreve via API compartilhada, mesmo risco zero de rótulo trocado). |
| 2026-07-17 | Frente C implementada: `buscarAtividadeDeterministica` (consulta em `atividades_mensais.metadata`, categoria ESPORTES, correlacionada via `campanha_id` do `documentos_rag` ativo) + `formatarLinhaAtividadeDeterministica` (com guarda do gap conhecido `faixa_etaria === titulo` → "nao informado"), integrados nos 2 branches (acompanhamento: 3ª camada antes de S-WM-34/vetorial; visão geral: soma bloco quando `trocaComPedidoEspecifico`). 10 testes novos (4 puros + 6 de integração via `handler`), suíte 141/0/2, `deno check`/`deno lint` sem regressão (75 erros / 7 problemas, baseline). Commit local, sem push/deploy. Status Draft/InProgress → Ready for Review. |
| 2026-07-17 | Remediação pós-validação da PR #42: `detectarColunas` agora aborta também quando duas chaves esperadas resolvem para o mesmo índice de header (`colisoes`), `hora_inicio` em DIA A DIA/ESPECIAIS deixou de aceitar `horário` genérico para não capturar "Horário Fim", e o modal de importação mostra erro distinto para colunas ausentes versus ambíguas. Adicionados testes para "Horário Fim" antes de "Horário Início" e para colisão genérica de header. |
| 2026-07-18 | Follow-up pós-validação do sócio: recuperação de atividade citada no histórico em perguntas elípticas de unidade, cobertura dos 4 caminhos de resolução de unidade, `decidirPrimeiraMensagem` passa a usar unidade semântica, busca determinística remove o filtro hardcoded de `ESPORTES` e passa a cobrir todas as categorias, incluindo teste `DIA A DIA / Direitos Humanos` com 9 linhas. Prompt reforçado para listar todas as turmas/linhas do bloco exato. Suíte Deno da Edge Function: 151/0/2. |
| 2026-07-18 | Remediação do achado novo na PR #47: `mensagemPareceContinuacaoDeAtividade` deixou de tratar qualquer menção a unidade como continuação; agora exige elipse curta e bloqueia perguntas de localização/distância. Adicionados testes puro + integração para "ah entendi, e o Pici, fica longe daqui?". Suíte Deno da Edge Function: 153/0/2. |

## Dev Agent Record

### Agent Model Used
Claude Sonnet 5 (Claude Code)

### Debug Log References
Queries de auditoria (B1) rodadas direto contra produção (`cuca`, `svzkrkfzpiqcesloukgb`) via MCP Supabase, todas read-only. Investigação do `.limit(40)` também via `execute_sql` read-only + medição direta de `INSTRUCAO_SEGURANCA.length` via `deno eval`. B2: `npx vitest run`, `npx tsc --noEmit`, `npx eslint` — todos rodados localmente no `cuca-portal`, sem tocar produção. B3: simulação via SELECT read-only antes de aplicar, migration aplicada via `apply_migration`, verificação pós-aplicação via `execute_sql` (idempotência, contagens, conteúdo real de `chunks_documentos`).
Frente C: `execute_sql` (read-only) contra `information_schema.columns` (confirmar colunas reais de `atividades_mensais`/`campanhas_mensais`/`documentos_rag`) e contra `pg_proc` (ler o corpo de `trigger_indexar_campanha_mensal` e confirmar que `documentos_rag.metadados->>'campanha_id'` é de fato o campo de correlação, antes de escrever qualquer código). `deno eval` contra `detectarAtividadeMencionada` pra confirmar o comportamento com erro de digitação real ("randebol") e com os pares de nomes parecidos existentes no banco (Cuca Pici, Cuca José Walter), antes de decidir reusar a função sem alteração. `deno test`/`deno check`/`deno lint` locais, com baseline reconfirmada via `git stash`/`git stash pop` antes de comparar.
Remediação PR #42: `npm test -- src/lib/programacao/planilha-parser.test.ts` e `npm test` no `cuca-portal` passaram (24/0). `deno test --no-check --allow-env --allow-read --allow-net .` em `supabase/functions/motor-agente` passou (141/0/2). `npx tsc --noEmit` no `cuca-portal` falhou em baseline fora do patch (`tests/divulgacao-disparar-logic.test.ts`: import com extensão `.ts` sem `allowImportingTsExtensions`); `npx tsc --noEmit --allowImportingTsExtensions` passou, confirmando que o patch não introduziu erro de tipo. `npx eslint` focado nos arquivos alterados mostrou somente os 17 problemas já conhecidos de `import-planilha-modal.tsx` (14 erros/3 warnings: `any`, `prefer-const`, unused, unescaped entities), sem erro novo nos arquivos do parser/teste. `npm run lint` global e `npm run build` ficaram silenciosos por mais de 2-3 minutos e foram interrompidos para não deixar processo pendurado; precisam ser rerodados pelo gate de release após saneamento/ambiente.
Follow-up 2026-07-18: `deno test --no-check --allow-env --allow-read --allow-net .` em `supabase/functions/motor-agente` passou (151/0/2). `deno lint` falhou com 7 problemas baseline já conhecidos (imports remotos/JSR inline e 2 `ban-unused-ignore` antigos em `index.audit.test.ts`). `deno check index.ts` falhou com 75 erros baseline de tipagem Supabase sem generic `Database`, mesma causa raiz já registrada na auditoria de 2026-07-16; não é regressão deste patch.
Remediação PR #47: `deno test --no-check --allow-env --allow-read --allow-net .` em `supabase/functions/motor-agente` passou (153/0/2).

### Completion Notes List
- Frente A: guardrail geográfico implementado, testado, commitado isoladamente. Suíte 128/0/2, zero regressão.
- Frente B1: auditoria completa das 5 unidades feita por classificação de padrão (sem acesso às planilhas originais). 2 padrões de rotação distintos (José Walter recuperável; as outras 4 não). 2 achados extras: Jangurussu/ESPORTE corrompido; pipeline de trigger de 3 estágios ligando `atividades_mensais` → `documentos_rag` → `chunks_documentos`.
- Tarefa `.limit(40)`: removido sem substituir por número fixo, com `console.warn` acima de 100 chunks como rede de segurança visível. 131/0/2.
- Frente B2: Vitest introduzido (autorizado), lógica de detecção extraída pra módulo puro, 3 pontos frágeis cobertos (categoria/ESPORTES/CURSOS/DIA-A-DIA), abort ruidoso em vez de fallback silencioso. 22 testes novos (Vitest), zero regressão no `motor-agente` (Deno) nem no typecheck/lint do portal.
- Correção 1: reavaliação com evidência (558 linhas, 0 exceções) mudou o entendimento de "aguardando arquivo" pra "gap permanente, provavelmente nunca existiu na fonte". Jangurussu confirmado como duplicata, não perda.
- Frente B3: José Walter corrigido (metadata + descricao), migration idempotente aplicada e confirmada, pipeline completo reacionado e verificado ponta a ponta em `chunks_documentos`.
- Correção 2: achado que minha varredura de "3 arquivos tocam atividades_mensais" (turno anterior) estava incompleta — `criar-programacao-modal.tsx` escreve via `/api/programacao/importar` (rota compartilhada), sem menção literal ao nome da tabela, por isso passou despercebido no grep anterior. Confirmado que usa os mesmos campos de metadata e é estruturalmente seguro (sem parsing de texto livre).
- Frente C: implementada — `buscarAtividadeDeterministica` (consulta estruturada em `atividades_mensais.metadata`, categoria ESPORTES) + `formatarLinhaAtividadeDeterministica` (formatação com guarda do gap conhecido), integradas como 3ª camada no branch de acompanhamento e como bloco somado (condicional a `trocaComPedidoEspecifico`) no branch de visão geral. Desenho confirmado explicitamente pelo usuário (7 pontos, ver seção Frente C) antes da implementação — reconhecimento de modalidade e correlação campanha/unidade validados contra dado real de produção (read-only) antes de codar. 10 testes novos, zero regressão (141/0/2). Deploy pendente de autorização, mesmo padrão das frentes anteriores.
- Remediação PR #42: corrigida a lacuna defensiva do parser que permitia duas chaves apontarem para a mesma coluna detectada. Importações ambíguas agora abortam ruidosamente com detalhes da colisão; casos válidos com "Horário Fim" antes de "Horário Início" continuam aceitos e mapeiam índices distintos.
- Follow-up pós-validação do sócio: perguntas elípticas de unidade agora recuperam a atividade pelo histórico recente do lead quando seguro; ambiguidade cai no fallback genérico atual; janela atravessa menu/mensagens do agente; os 4 caminhos de resolução de unidade estão cobertos por teste; busca determinística deixou de ser limitada a ESPORTES e cobre também DIA A DIA; prompt exige listar todas as turmas/linhas do bloco exato.
- Remediação PR #47: falso positivo de localização corrigido — unidade citada em pergunta não relacionada ("Pici fica longe?") não herda atividade antiga nem injeta bloco exato.

### File List
- `supabase/functions/motor-agente/index.ts` (Frente A; tarefa `.limit(40)`; Frente C + follow-up: `formatarLinhaAtividadeDeterministica`, `buscarAtividadeDeterministica`, recuperação de atividade por histórico, uso de unidade semântica em `decidirPrimeiraMensagem`, prompt de enumeração completa)
- `supabase/functions/motor-agente/index.test.ts` (Frente C: 4 testes puros de `formatarLinhaAtividadeDeterministica`; follow-up: 5 testes puros de resolução de atividade por histórico)
- `supabase/functions/motor-agente/index.audit.test.ts` (Frente A; tarefa `.limit(40)`; Frente C: 6 testes de integração via `handler`; follow-up: 7 testes de integração dos 4 caminhos de unidade + anti-stale + localização + DIA A DIA)
- `docs/stories/S-WM-35-VAL-24-VAL-09-Guardrail-Geo-Auditoria-Metadata.md` (este arquivo)
- `cuca-portal/package.json` (script `test`, devDependency `vitest`) — Frente B2
- `cuca-portal/vitest.config.ts` (novo) — Frente B2
- `cuca-portal/src/lib/programacao/planilha-parser.ts` (novo) — Frente B2
- `cuca-portal/src/lib/programacao/planilha-parser.test.ts` (novo) — Frente B2
- `cuca-portal/src/components/programacao/import-planilha-modal.tsx` — Frente B2
- `supabase/migrations/20260716000000_swm35_corrige_rotacao_metadata_jose_walter.sql` (novo) — Frente B3, aplicado em produção
