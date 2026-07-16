# S-WM-35 — VAL-24 (guardrail geográfico) + auditoria de campos trocados (VAL-09, família "programação incompleta")

## Status
InProgress — Frente A concluída, tarefa "remover .limit(40)" concluída, Frente B1 (auditoria) concluída, Frente B2 (parser barulhento) concluída. B3/C aguardando checkpoint do usuário.

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

## Change Log

| Data | Mudança |
|---|---|
| 2026-07-16 | Frente A implementada e commitada (`93e8377`). Frente B1 (auditoria) concluída — 5 achados documentados, 3 deles mudam o escopo original de B3/C. Tarefa `.limit(40)` implementada e commitada (`34d4089`). Frente B2 (parser barulhento) implementada — Vitest introduzido, módulo puro `planilha-parser.ts` extraído, 3 pontos frágeis (categoria, ESPORTES, CURSOS/DIA-A-DIA) cobertos com detecção por nome + abort ruidoso. |

## Dev Agent Record

### Agent Model Used
Claude Sonnet 5 (Claude Code)

### Debug Log References
Queries de auditoria (B1) rodadas direto contra produção (`cuca`, `svzkrkfzpiqcesloukgb`) via MCP Supabase, todas read-only. Investigação do `.limit(40)` também via `execute_sql` read-only + medição direta de `INSTRUCAO_SEGURANCA.length` via `deno eval`. B2: `npx vitest run`, `npx tsc --noEmit`, `npx eslint` — todos rodados localmente no `cuca-portal`, sem tocar produção.

### Completion Notes List
- Frente A: guardrail geográfico implementado, testado, commitado isoladamente. Suíte 128/0/2, zero regressão.
- Frente B1: auditoria completa das 5 unidades feita por classificação de padrão (sem acesso às planilhas originais). 2 padrões de rotação distintos (José Walter recuperável; as outras 4 não). 2 achados extras: Jangurussu/ESPORTE corrompido; pipeline de trigger de 3 estágios ligando `atividades_mensais` → `documentos_rag` → `chunks_documentos`.
- Tarefa `.limit(40)`: removido sem substituir por número fixo, com `console.warn` acima de 100 chunks como rede de segurança visível. 131/0/2.
- Frente B2: Vitest introduzido (autorizado), lógica de detecção extraída pra módulo puro, 3 pontos frágeis cobertos (categoria/ESPORTES/CURSOS/DIA-A-DIA), abort ruidoso em vez de fallback silencioso. 22 testes novos (Vitest), zero regressão no `motor-agente` (Deno) nem no typecheck/lint do portal.
- B3/C: aguardando decisão do usuário sobre o escopo revisado antes de prosseguir.

### File List
- `supabase/functions/motor-agente/index.ts` (Frente A; tarefa `.limit(40)`)
- `supabase/functions/motor-agente/index.audit.test.ts` (Frente A; tarefa `.limit(40)`)
- `docs/stories/S-WM-35-VAL-24-VAL-09-Guardrail-Geo-Auditoria-Metadata.md` (este arquivo)
- `cuca-portal/package.json` (script `test`, devDependency `vitest`) — Frente B2
- `cuca-portal/vitest.config.ts` (novo) — Frente B2
- `cuca-portal/src/lib/programacao/planilha-parser.ts` (novo) — Frente B2
- `cuca-portal/src/lib/programacao/planilha-parser.test.ts` (novo) — Frente B2
- `cuca-portal/src/components/programacao/import-planilha-modal.tsx` — Frente B2
