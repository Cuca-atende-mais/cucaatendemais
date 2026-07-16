# S-WM-35 — VAL-24 (guardrail geográfico) + auditoria de campos trocados (VAL-09, família "programação incompleta")

## Status
Em andamento — Frente A concluída, Frente B1 (auditoria) concluída, B2/B3/C aguardando checkpoint do usuário (achado de escopo em B1 muda o plano original).

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

## Change Log

| Data | Mudança |
|---|---|
| 2026-07-16 | Frente A implementada e commitada (`93e8377`). Frente B1 (auditoria) concluída — 5 achados documentados, 3 deles mudam o escopo original de B3/C. |

## Dev Agent Record

### Agent Model Used
Claude Sonnet 5 (Claude Code)

### Debug Log References
Queries de auditoria rodadas direto contra produção (`cuca`, `svzkrkfzpiqcesloukgb`) via MCP Supabase, todas read-only (`execute_sql`, `information_schema`, `pg_proc`, `storage.objects`, `storage.buckets`) — nenhuma escrita realizada nesta frente além do commit de código da Frente A.

### Completion Notes List
- Frente A: guardrail geográfico implementado, testado, commitado isoladamente. Suíte 128/0/2, zero regressão (confirmado erros de type-check/lint são pré-existentes via `git stash`).
- Frente B1: auditoria completa das 5 unidades feita por classificação de padrão (sem acesso às planilhas originais — não existem no sistema, achado próprio). 2 padrões de rotação distintos encontrados (não 5 diferentes como se temia): José Walter (recuperável) vs. as outras 4 (não recuperável, só `faixa_etaria`). Mais 2 achados críticos fora do pedido original: Jangurussu tem 66 linhas corrompidas por typo de categoria (`ESPORTE` sem S), e existe um pipeline de trigger de 3 estágios ligando `atividades_mensais` → `documentos_rag` → `chunks_documentos` que muda o que "corrigir o metadata" precisa significar na prática.
- B2/B3/C: aguardando decisão do usuário sobre o escopo revisado antes de prosseguir.

### File List
- `supabase/functions/motor-agente/index.ts` (Frente A)
- `supabase/functions/motor-agente/index.audit.test.ts` (Frente A)
- `docs/stories/S-WM-35-VAL-24-VAL-09-Guardrail-Geo-Auditoria-Metadata.md` (este arquivo, novo)
