# S-WM-34 — VAL-09 + VAL-23: dado resolvido certo, resposta final suprime ele

## Status
Ready for Review

## Complexidade
**M** (médio) — 2 fixes localizados na mesma região de `motor-agente/index.ts` (seção 5b + Passo 6), causa raiz de ambos já confirmada com evidência (query direta em produção pra VAL-09, leitura de código linha a linha cruzada com teste ao vivo pra VAL-23). Não é investigação — é implementação de fix com abordagem já definida, exceto 1 decisão de design em aberto (ver Dev Notes, VAL-23 branch `detectarTrocaUnidade`).

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - MCP execute_sql (prod, cuca) → reconfirmar chunks de monthly_program por unidade antes/depois do fix, se a busca determinística realmente recupera as menções que a busca vetorial perdia
  - MCP get_edge_function (prod) → confirmar que o motor-agente deployado após o fix bate com o código revisado (mesma prática já usada na investigação desta dupla de bugs)
  - deno test → cobertura determinística das funções puras novas/alteradas (extração de atividade, decisão de suprimir "resumo geral")
  - Teste ao vivo (ou reprodução controlada) dos 2 cenários que motivaram a story: "só essas turmas de natação?" (Jangurussu) e "e no Mondubim, tem natação de noite?" (troca embutida em pergunta específica)
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** que a Maria (agente Institucional) use o dado que ela mesma já busca/carrega corretamente, em vez de uma instrução de prompt genérica demais apagar esse dado da resposta final,
**para que** perguntas específicas sobre programação (por atividade, ou embutidas numa troca de unidade) recebam resposta completa e direta, não um resumo genérico que ignora o que foi perguntado.

## Contexto e Problema

Dois achados de validação em produção (`RELATORIO-6-validacao-producao-institucional-2026-07-14.md` e teste ao vivo adicional, VAL-23) compartilham a mesma causa-raiz de família: **o motor-agente busca ou carrega o dado certo, mas uma instrução de prompt/lógica de formatação genérica demais impede a resposta final de usar esse dado especificamente** — o sistema não distingue "pedido específico" de "pedido genérico" no momento de decidir como formatar a resposta. Os dois casos tocam a mesma região do handler (`index.ts`, seção 5b "Seleção/troca de unidade" e Passo 6 "Contexto RAG"), por isso viram uma story única — evita 2 PRs mexendo no mesmo trecho em paralelo.

### VAL-09 — lista de atividade incompleta (ex.: natação em Jangurussu)

**Sintoma:** "que horários da natação no jangurussu" → "só essas turmas de natação?" — Maria mostra 10 de 19 turmas reais, mesmo perguntando 2x "só essas?".

**Causa raiz confirmada** (query direta em `chunks_documentos`/`documentos_rag`, banco de produção `cuca`, `svzkrkfzpiqcesloukgb`, 2026-07-14):
- O branch de "pergunta de acompanhamento" (unidade já definida, sem troca de unidade nem seleção de menu neste turno) usa busca vetorial (`buscar_chunks_similares`, `index.ts:1096-1100`, `p_limite: 5`) sobre o `monthly_program` da unidade.
- Natação no Jangurussu (doc ativo `23158006-fa66-4945-8bab-cdb90407c481`, 47 chunks) aparece em **14 chunks não-contíguos** (índices 27–31, 35, 36, 38, 40–42, 44–46), intercalados com Judô, Jiu Jitsu, Futsal, Muay Thai etc. — a seção `== ESPORTES ==` do documento é indexada **por horário do dia**, não por modalidade. 5 chunks de busca vetorial nunca têm chance real de trazer as 14 menções de uma vez.
- **Descartado, não reabrir:** estender `avaliarSelecaoUnidade` (`index.ts:365`) com um campo `atividade_mencionada` — essa função só roda dentro da seção 5b (`index.ts:867-1023`, quando ainda não há unidade resolvida neste turno). No cenário relatado a unidade já está definida — a seção 5b inteira é pulada, `avaliarSelecaoUnidade` nunca roda. Implementar como descrito teria efeito zero no bug.
- **Descartado, não reabrir:** rechunkar respeitando fronteira de modalidade — inviável como estava sendo cogitado. Não existe bloco contíguo de modalidade no texto indexado pra preservar (confirmado nos chunks reais); exigiria reestruturar toda a extração/indexação, não só o corte de chunk.

**Depende de [[S-WM-26]]** (investigação-only do VAL-09, status Ready) — as ACs daquela story já estão cobertas pelo diagnóstico desta seção; o fix estava explicitamente fora do escopo dela.

### VAL-23 — troca de unidade embutida numa pergunta específica vira resposta genérica

**Sintoma:** com Jangurussu já selecionado de um turno anterior, "e no Mondubim, tem natação de noite?" recebe uma resposta genérica (resumo/visão geral do Mondubim), não uma resposta direta sobre natação à noite. Perguntando a mesma coisa já com Mondubim selecionado de ANTES (sem troca no mesmo turno), a resposta vem certa.

**Nota de evidência:** diagnóstico 100% por leitura de código (sem log bruto de produção capturado pra este teste específico), mas a execução completa foi rastreada linha a linha e o código local (`develop`) foi confirmado byte-a-byte equivalente ao deployado em produção (`get_edge_function`, motor-agente v35) durante a investigação do VAL-09/VAL-21 nesta mesma leva.

**Causa raiz confirmada em código:**
1. Pro canal Institucional/Maria (rede inteira, 1 número), `unidade_cuca` do payload é sempre `'Geral'` (fixo por instância — `meta_phone_numbers.unidade_cuca`, confirmado em `worker/meta_adapter_inbound.py`). Por isso a seção 5b (`index.ts:867`) roda em **todo turno**, não só no primeiro — inclusive quando uma unidade já foi selecionada em turno anterior.
2. Branch `unidadeSalva` (`index.ts:871-878`): chama `detectarTrocaUnidade(texto, unidadeAtual)` (`index.ts:252-270`) — match de **palavra inteira** contra nomes de unidade, **zero avaliação do resto da frase**. "Mondubim" citado dentro de uma pergunta específica já basta pra retornar a nova unidade. `avaliarSelecaoUnidade` **não** é chamada neste caminho (só roda no `else if` quando o match direto falha, via `pareceIntencaoTrocaUnidade`).
3. `novaUnidade` truthy → `trocouUnidade = true` (`index.ts:876-877`) → `calcularPrecisaVisaoGeral` (`index.ts:512-514`) retorna `true` só por causa do `trocouUnidade`, independente do conteúdo da pergunta.
4. Branch de visão geral (`index.ts:1064+`) carrega `carregarProgramacaoMensal` inteiro da nova unidade — **dado certo, confirmado no contexto** — mas seta `instrucaoArea = "...Apresente um resumo geral..."` (`index.ts:1069`) e o prompt final reforça "...apresente um resumo geral da programacao..." (`index.ts:1180`), ambos condicionados só a `trocouUnidade`.
5. REGRA 6 do guardrail (`INSTRUCAO_SEGURANCA`, `index.ts:306-312`, sempre presente no prompt) reforça formato compacto sem horário quando é "visão geral" — combinado com as instruções acima, o GPT tende a suprimir o dado específico pedido mesmo ele estando correto no contexto.

**Confirmado que funciona certo** quando a unidade já estava selecionada sem troca no mesmo turno — cai no branch de acompanhamento (`index.ts:1092`, sem as instruções de "resumo geral"). **Isso é tratado como coincidência de dados, não como prova de que esse branch está livre de um problema equivalente** — não expandir esse ponto nesta story, só registrar a ressalva.

## Escopo

### IN
1. **VAL-09:** busca determinística por texto no branch de acompanhamento (`index.ts:1092-1109`, quando a unidade já está definida) — extrair nomes de modalidade já presentes no `monthly_program` ativo daquela unidade (padrão `Modalidade: X - Turma` já presente no texto indexado, confirmado via query), comparar contra a mensagem do lead normalizando acento/caixa em TypeScript (Postgres não tem `unaccent` instalado; `ilike` não trata acento — confirmado via `execute_sql`). Fallback pro `buscar_chunks_similares` atual se não achar match. Zero custo de LLM extra.
2. **VAL-23:** só disparar a instrução de "resumo geral" (`instrucaoArea` + trecho condicional do `promptFinal`) quando a mensagem que causou a troca de unidade **não** tinha um pedido específico junto:
   - Quando a resolução vem de `avaliarSelecaoUnidade` (3 dos 4 pontos de entrada da seção 5b: `aguardando_unidade`, `conversa_engajada`, 1ª mensagem) — reaproveitar o campo `pedido_depende_unidade` que a função já calcula (`AvaliacaoSelecaoUnidade.pedido_depende_unidade`, `index.ts:322-327`). Se `true`, pular a instrução de resumo geral. Reuso direto, zero dado novo.
   - Quando a resolução vem de `detectarTrocaUnidade` (branch `unidadeSalva`, `index.ts:871-878` — o caminho reproduzido no teste ao vivo) — esse caminho é **deliberadamente** sem chamada de LLM (evitar custo em toda mensagem comum de acompanhamento, mesmo espírito de `pareceIntencaoTrocaUnidade`). Precisa de um sinal equivalente antes de decidir se dispara o resumo geral. **Decisão de implementação em aberto** (ver Dev Notes) — @dev decide entre heurística determinística barata ou chamada semântica extra escopada a esse caminho, documentando o critério escolhido na própria story (Dev Notes/Completion Notes).
3. Testes automatizados (`deno test`) cobrindo as funções puras novas/alteradas de ambos os fixes.

### OUT
- VAL-21 (duplicidade de disparo por gunicorn multi-processo) — tratado à parte, fora desta story (não é a mesma família de bug: não é "dado certo, resposta erra", é coordenação entre processos).
- Qualquer mudança em `worker/` (Python) — esta story é só `motor-agente/index.ts` (Deno/Supabase Edge Function).
- Rechunking ou reindexação do `monthly_program` — descartado como abordagem, ver Contexto.
- Extensão de `avaliarSelecaoUnidade` com `atividade_mencionada` — descartado como abordagem, ver Contexto.
- Investigar se o branch de acompanhamento tem um problema equivalente ao VAL-23 quando NÃO há troca de unidade — fora de escopo, mencionado só como ressalva.

## Acceptance Criteria

1. **Given** uma unidade com atividade dispersa em mais de 5 chunks no `monthly_program` ativo (ex.: natação no Jangurussu, 14 chunks), **when** o lead pergunta especificamente sobre essa atividade num turno de acompanhamento (unidade já definida, sem troca/seleção de menu), **then** a resposta reflete TODAS as menções reais dessa atividade no documento (validado via `execute_sql` comparando contagem real vs. o que chegou no contexto do prompt), não só as 5 mais similares por embedding.
2. **Given** a busca determinística não encontra nenhum nome de modalidade correspondente na mensagem do lead, **when** a busca roda, **then** o fallback pro `buscar_chunks_similares` atual acontece sem erro — comportamento hoje existente preservado.
3. **Given** uma conversa com unidade A já selecionada em turno anterior, **when** o lead manda uma mensagem que cita o nome da unidade B **junto com um pedido específico** (ex.: "e no Mondubim, tem natação de noite?"), **then** a resposta usa o dado específico carregado (não dispara a instrução de "resumo geral") e responde diretamente ao pedido.
4. **Given** o mesmo cenário do AC3, mas a mensagem que causa a troca **não** tem pedido específico (ex.: só "Mondubim" ou "quero saber do Mondubim agora"), **then** o comportamento atual de "resumo geral ao trocar de unidade" é preservado — este AC existe pra garantir que o fix de VAL-23 não regride o caso são.
5. **Given** as 3 rotas de resolução de unidade que já chamam `avaliarSelecaoUnidade` (aguardando_unidade, conversa_engajada, 1ª mensagem), **when** `pedido_depende_unidade=true`, **then** a instrução de resumo geral não dispara nessas rotas também (não só na rota `detectarTrocaUnidade` testada ao vivo).
6. **Given** o fix aplicado, **when** @dev reporta a conclusão, **then** a decisão de design tomada para o sinal de "pedido específico" no caminho `detectarTrocaUnidade` (heurística vs. chamada semântica) está documentada no Dev Agent Record, com o porquê.
7. Testes automatizados (`deno test`) cobrem: extração/match de atividade por texto (incluindo caso com acento/typo), decisão de suprimir "resumo geral" nos 4 pontos de entrada (3 via `avaliarSelecaoUnidade` + 1 via `detectarTrocaUnidade`), e o fallback do AC2.
8. `get_edge_function` (prod) após deploy confirma que o código deployado bate com o revisado — mesma prática já usada na investigação que originou esta story.

## Tasks / Subtasks

- [x] **Task 1 — VAL-09: busca determinística por atividade** (AC: 1, 2, 7)
  - [x] Implementar extração dos nomes de modalidade do `monthly_program` ativo da unidade (padrão `Modalidade: X - Turma`).
  - [x] Implementar normalização de acento/caixa em TS e comparação contra a mensagem do lead.
  - [x] Integrar no branch de acompanhamento (`index.ts:1092-1109`), com fallback pro `buscar_chunks_similares` atual.
  - [x] `deno test` cobrindo extração/match (com acento, sem match → fallback).
  - [ ] Validar com `execute_sql` (prod) que a lista de natação em Jangurussu agora vem completa. (adiado pra Task 4, junto da validação final — evita 2 rodadas de MCP prod)
  - [x] Reportar no Dev Agent Record.
- [x] **Task 2 — VAL-23: suprimir "resumo geral" quando há pedido específico (rotas via `avaliarSelecaoUnidade`)** (AC: 5, 7)
  - [x] Propagar `pedido_depende_unidade` até a decisão de setar `instrucaoArea`/instrução do `promptFinal` nas 3 rotas (`aguardando_unidade`, `conversa_engajada`, 1ª mensagem).
  - [x] `deno test` cobrindo os 3 pontos de entrada.
  - [x] Reportar no Dev Agent Record.
- [x] **Task 3 — VAL-23: sinal equivalente no caminho `detectarTrocaUnidade`** (AC: 3, 6, 7)
  - [x] Decidir e documentar a abordagem (heurística determinística vs. chamada semântica escopada) — registrar o porquê no Dev Agent Record.
  - [x] Implementar o sinal escolhido e a supressão condicional de `instrucaoArea`/instrução do `promptFinal` no branch `unidadeSalva` (`index.ts:871-878`).
  - [x] `deno test` cobrindo o caso reproduzido ao vivo (troca embutida em pedido específico) e o caso são (troca sem pedido específico, AC4).
  - [x] Reportar no Dev Agent Record.
- [x] **Task 4 — Fechamento** (AC: 8)
  - [x] Rodar suíte completa (`deno test`), lint/typecheck.
  - [x] Validar com `execute_sql` (prod) que a lista de natação em Jangurussu vem completa (adiado da Task 1) — 13 chunks confirmados, muito acima do `p_limite: 5` anterior.
  - [ ] Deploy da edge function e confirmação via `get_edge_function` (prod) — **NÃO executado**: instrução explícita do usuário foi "nenhum push/PR/deploy, só commit local". Pendente de autorização/execução futura (por @devops ou instrução direta).
  - [x] Atualizar File List e Change Log.
  - [x] Anunciar conclusão e recomendar @qa.

## Dev Notes

### Referências de código (confirmadas nesta investigação, válidas para `develop` == deployado em prod no momento da análise)
- `avaliarSelecaoUnidade`: `index.ts:365` (só roda dentro da seção 5b — `index.ts:867-1023`).
- `AvaliacaoSelecaoUnidade.pedido_depende_unidade`: `index.ts:322-327` (já existe, campo opcional).
- `detectarTrocaUnidade`: `index.ts:252-270` (match de palavra inteira, sem avaliação semântica).
- `pareceIntencaoTrocaUnidade`: `index.ts:246-249` (pré-filtro barato existente, mesmo espírito a considerar pro sinal da Task 3).
- `calcularPrecisaVisaoGeral`: `index.ts:512-514`.
- `instrucaoArea` (visão geral): `index.ts:1068-1069`.
- Instrução equivalente no `promptFinal`: `index.ts:1180`.
- `INSTRUCAO_SEGURANCA` / REGRA 6: `index.ts:282-313` (sempre presente no prompt, não é condicional).
- Branch de acompanhamento (VAL-09): `index.ts:1092-1109`.
- `carregarProgramacaoMensal`: `index.ts:723-730`.
- `buscar_chunks_similares`: RPC Postgres, chamado com `p_limite: 5` no branch de acompanhamento.

### Decisão em aberto (Task 3) — não travar nesta story, documentar na implementação
Duas opções pro sinal de "pedido específico" no caminho `detectarTrocaUnidade` (sem chamada de LLM hoje):
- **(a) Heurística determinística barata**, no espírito de `pareceIntencaoTrocaUnidade`: considerar "pedido específico" quando sobra conteúdo relevante além do nome da unidade (ex.: presença de `?`, tamanho da mensagem além do nome, palavra-chave de atividade/horário). Zero custo de LLM, mas heurística pode ter falso positivo/negativo.
- **(b) Chamada semântica extra**, escopada só a quando `detectarTrocaUnidade` encontra match (mais raro que "toda mensagem" — só dispara quando um nome de unidade aparece no texto, não em todo turno de acompanhamento). Mais robusto, custo real porém limitado à frequência desse evento.
Registrar a escolha e o porquê no Dev Agent Record ao concluir a Task 3.

### Não instrumentar de novo o que já existe
Reaproveitar os logs de VAL-04 (S-WM-25) já presentes no Passo 6, mesmo princípio já seguido em [[S-WM-26]] — não duplicar instrumentação equivalente.

### Testing
- `deno test` é o padrão do projeto para as funções puras deste arquivo (ver `index.test.ts`, `index.audit.test.ts` já existentes) — funções novas devem ser exportadas e testadas isoladamente, sem mock de rede quando possível (mesmo padrão de `avaliarSelecaoUnidade`/`validarAvaliacaoSelecaoUnidade`).
- Validação em produção (read-only, `execute_sql`/`get_edge_function`) é complementar aos testes automatizados, não substituto — mesmo padrão usado na investigação que originou esta story.

## Dependências
- **Depende de [[S-WM-26]]** (VAL-09, investigação-only, status Ready) — diagnóstico já coberto por esta análise; ao concluir esta story, considerar fechar formalmente o Dev Agent Record de S-WM-26 referenciando esta story como o fix.
- Nenhuma dependência técnica com VAL-21 (story separada, worker Python) — podem ser trabalhadas em paralelo sem conflito de arquivo.

## Riscos
- Risco de escopo: os dois fixes tocam a mesma região do handler (seção 5b + Passo 6) — implementar em sequência (Task 1 antes de Task 2/3, ou vice-versa) e rodar a suíte completa entre elas, não só os testes novos, pra pegar interação entre os dois fixes cedo.
- A decisão em aberto da Task 3 (heurística vs. semântica) não deve virar bloqueio — se não houver critério claro depois de avaliar as duas opções, HALT e perguntar ao Junior antes de implementar às cegas, mesmo risco de escopo já registrado em [[S-WM-26]].
- REGRA 6 (formato compacto) é sempre presente no prompt — mesmo com os 2 fixes aplicados, o comportamento final do GPT não é 100% garantido por instrução (mesma ressalva já registrada em VAL-02/VAL-09/VAL-23 anteriores). Os fixes resolvem a causa determinística (dado ausente / instrução contraditória); a obediência do modelo à instrução continua não sendo testável de forma determinística.

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-14 | 0.1 | Draft inicial — fusão de VAL-09 (RELATORIO-6) e VAL-23 (achado ao vivo adicional), diagnóstico de causa raiz de ambos já confirmado (query direta em produção + leitura de código cruzada com teste ao vivo, ver conversa com @dev Dex) antes da criação desta story | @sm River |
| 2026-07-14 | 0.2 | Validado (GO, 9/10 → 10/10 após ajuste). Ajuste aplicado: Task 2 referenciava AC4 por engano (AC4 é o caso são do branch `detectarTrocaUnidade`, escopo da Task 3 — a própria Task 3 já tem subtask dedicada a esse teste; Task 2 cobre só AC5/AC7) — corrigido pra evitar ambiguidade sobre onde mora o teste de regressão do AC4. Confirmado: diferença de nível de evidência entre VAL-09 (query direta em prod) e VAL-23 (rastreio de código + teste ao vivo, sem log bruto) está clara e não é conflada em nenhuma seção. Confirmado: AC4 é testável de forma independente (Task 3 já isola o teste do caso são do teste do caso reproduzido, AC3). Status Draft → Ready | @po Pax |
| 2026-07-14 | 0.3 | Implementação completa (Tasks 1-4). Suíte local 125 passed/0 failed/2 ignored (baseline 105); `deno check` mantido em 75 erros (baseline, débito pré-existente da S-WM-28, sem regressão). Validado contra produção via `execute_sql` (read-only). Deploy da edge function **NÃO executado nesta sessão** — instrução explícita do usuário foi "nenhum push/PR/deploy, só commit local". Status Ready → Ready for Review | @dev Dex |

## Dev Agent Record

### Agent Model Used
Claude Sonnet 5 (claude-sonnet-5), via Claude Code — persona @dev (Dex).

### Debug Log References
- `deno check supabase/functions/motor-agente/index.ts` — baseline (branch `develop`, antes desta story): **75 erros** (débito pré-existente, rastreado em [[S-WM-28]] — todos da mesma causa raiz: `createClient(...)` sem generics de `Database`, inferindo `never` em várias colunas). Confirmado via `git stash`/`git stash pop` que a baseline é exatamente 75, não inflada por esta story.
- `deno check` após Task 1 (VAL-09): 76 erros (+1) — `buscarAtividadeEspecifica` introduziu um `.single()` a mais, mesma classe de erro (`never`) da linha adjacente de `carregarProgramacaoMensal`. Corrigido com um type cast local (`data as { id: string } | null`) — não expande escopo pra dentro de S-WM-28 (não usa generics globais), só resolve o ponto novo. Voltou a 75 após o cast.
- `deno test --no-check --allow-env --allow-read --allow-net .` — baseline (antes desta story): **105 passed / 0 failed / 2 ignored** (confirmado via `git stash`). Final (após Tasks 1-4): **125 passed / 0 failed / 2 ignored** — 20 testes novos (13 unitários de funções puras + 5 unitários de `pedidoEspecifico` nas 3 rotas + 2 de integração via `handler` mock para AC3/AC4), 0 regressão.
- 4 testes de guarda pré-existentes (`AUD-04`, `VAL-07`, `VAL-08`, `Item 3/AC5` em `index.audit.test.ts`) quebraram durante a Task 1: usavam `chamadas.some(c => c.tabela === "documentos_rag")` como proxy pra "carregou a visão geral completa (~40 chunks)" — proxy ficou obsoleto porque `buscarAtividadeEspecifica` (Task 1) também toca `documentos_rag`/`chunks_documentos`, só que pra um propósito diferente (busca escopada por atividade, não os ~40 chunks completos). Corrigido trocando o proxy por uma fingerprint precisa: `chunks_documentos` com `.limit(40)` — exclusiva de `carregarProgramacaoMensal`, nunca usada por `buscarAtividadeEspecifica` (que não usa `.limit()` nessa tabela). Os 4 testes voltaram a passar sem enfraquecer a asserção original.
- Autocrítica durante a escrita de testes da Task 3: a 1ª versão de `mensagemTemPedidoEspecifico` usava um limiar de tamanho de texto (`>= 8 caracteres restantes após remover o nome da unidade`) — ao escrever o teste do AC4 ("quero saber do Mondubim agora"), a asserção esperada (`false`) não batia com o resultado real (`true`): a heurística por tamanho classificava incorretamente uma frase vaga e longa como pedido específico. Descartada antes de qualquer commit — trocada pela versão final, só `?`, deliberadamente mais conservadora (ver docblock da função no código).

### Completion Notes List

**Task 1 (VAL-09):** Implementadas 4 funções puras novas (`normalizarTexto`, `extrairModalidades`, `detectarAtividadeMencionada`) + 1 função com I/O (`buscarAtividadeEspecifica`), integradas no branch de acompanhamento (`index.ts`, antigo `buscar_chunks_similares` direto, agora com a busca determinística primeiro e fallback pro vetorial). Validado contra produção: o `monthly_program` ativo do Jangurussu (doc `23158006-...`, 47 chunks) tem **13 chunks** com `Modalidade: Natação` (`execute_sql`, `ilike '%Modalidade: Nata%'`) — muito acima do `p_limite: 5` da busca vetorial antiga, confirmando que o fix resolve o caso relatado. Lógica de extração/match validada em Python contra amostras reais do texto indexado (mesmo padrão `Modalidade: X - Turma`) antes de finalizar a implementação em TS.

**Achado adjacente, fora de escopo (não corrigido nesta story):** `carregarProgramacaoMensal` (branch de "visão geral") usa `.limit(40)` nos chunks — o Jangurussu já tem 47 chunks reais, ou seja, esse branch (diferente do de acompanhamento, que esta story corrigiu) também pode estar truncando a visão geral completa. Isso é exatamente a hipótese 1 da investigação [[S-WM-26]] (nunca confirmada até agora) — agora há evidência direta de que ela se aplica pelo menos ao Jangurussu. Registrado aqui como achado, não corrigido (fora do escopo desta story, que é só o branch de acompanhamento) — recomendo abrir item de backlog separado.

**Task 2 (VAL-23, rotas via `avaliarSelecaoUnidade`):** `pedidoEspecifico` adicionado a `DecisaoAguardandoUnidade`/`DecisaoConversaEngajada`/`DecisaoPrimeiraMensagem` (campo opcional, não quebra os ~10 call-sites de teste pré-existentes que não o exercitam). As 3 funções passaram a aceitar um 3º parâmetro opcional (`textoOriginal = ""`) — necessário porque, nos 3 pontos de entrada, quando a unidade resolve por **match direto** (nome/dígito, sem chamar `avaliarSelecaoUnidade`), `pedido_depende_unidade` nunca foi calculado de verdade; nesse sub-caso a função usa a mesma heurística da Task 3 (`mensagemTemPedidoEspecifico`) em vez do campo semântico.

**Achado adjacente, corrigido (dentro do espírito da story, mesma família de bug):** identificado um **4º ponto de entrada** que também dispara `trocouUnidade=true` via `avaliarSelecaoUnidade` — o branch `unidadeSalva` + `pareceIntencaoTrocaUnidade` (`index.ts`, variável `avaliacaoTroca`), não listado explicitamente no Escopo da story (que citava só "3 dos 4 pontos de entrada da seção 5b" + o caminho `detectarTrocaUnidade`). Esse caminho já chama `avaliarSelecaoUnidade` e tinha `pedido_depende_unidade` disponível sem custo adicional — mesma correção aplicada (reuso direto do campo), documentado aqui por transparência já que não estava no texto original da story.

**Task 3 (VAL-23, caminho `detectarTrocaUnidade`):** Decisão de design: **heurística determinística, não chamada semântica** — `mensagemTemPedidoEspecifico(texto)` retorna `true` só quando a mensagem contém `"?"`. Motivo registrado no docblock da função: uma 1ª versão com limiar de tamanho de texto (sobra após remover o nome da unidade) classificava incorretamente frases vagas e longas ("quero saber do Mondubim agora") como pedido específico — falso positivo que suprimiria o resumo geral sem ter um pedido real pra responder, o pior tipo de erro possível aqui (troca o comportamento são por um pior). `"?"` sozinho cobre o cenário reproduzido ao vivo sem esse risco. Limitação conhecida e documentada (não é bug): pedido específico real sem `"?"` (ex.: "manda os horarios de natacao no Mondubim") continua recebendo o resumo geral atual — sem regressão em relação a hoje, só ainda sem a melhoria; registrado como possível item de backlog futuro caso apareça evidência de que isso é comum.

**Task 4:** Suíte completa + `deno check` confirmados (ver Debug Log References). Validação em produção via `execute_sql` feita (ver Task 1). **Deploy da edge function e confirmação via `get_edge_function` NÃO executados nesta sessão** — instrução explícita do usuário no início da implementação foi "nenhum push/PR/deploy, só commit local, aguardando @qa". AC8 fica pendente até o deploy ser autorizado e executado (por @devops ou por instrução explícita futura) — o código está pronto e testado, só não foi promovido a produção.

### File List
- `supabase/functions/motor-agente/index.ts` — modificado (VAL-09: `normalizarTexto`, `extrairModalidades`, `detectarAtividadeMencionada`, `buscarAtividadeEspecifica`, integração no branch de acompanhamento; VAL-23: `mensagemTemPedidoEspecifico`, `pedidoEspecifico` em 3 tipos/funções de decisão, `trocaComPedidoEspecifico` no handler, condicional em `instrucaoArea` e no `promptFinal`)
- `supabase/functions/motor-agente/index.test.ts` — modificado (13 testes novos: `normalizarTexto`, `extrairModalidades`, `detectarAtividadeMencionada`, `mensagemTemPedidoEspecifico`)
- `supabase/functions/motor-agente/index.audit.test.ts` — modificado (4 testes de guarda pré-existentes corrigidos com fingerprint precisa; 7 testes novos: 2 de integração via `handler` para AC3/AC4, 5 unitários para `pedidoEspecifico` nas 3 rotas de decisão)

## QA Results
_A ser preenchido pelo @qa após a implementação._
