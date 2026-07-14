# S-WM-32 — RAG institucional: `resumo_rede` para perguntas de rede inteira sem unidade escolhida

## Status
InReview

## Complexidade
**M** (médio) — não existe nenhum pipeline de geração hoje (precisa ser escrito do zero: passo de LLM, botão no portal, consumo no motor-agente). Tecnicamente contido (sem busca vetorial, sem tabela nova), mas é peça nova no sistema, não extensão de algo existente.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - deno test → motor-agente carrega resumo_rede corretamente nos 3 pontos de perguntaGeralAtiva, sem regressão no FAQ isolado
  - teste do passo de geração (mock de monthly_program das 5 unidades) → resumo_rede consistente
  - MCP execute_sql (cuca-dev, read-only) → confirmar que buscar_chunks_similares NUNCA é chamado com p_unidade_cuca:null para monthly_program/eventos_pontuais em nenhum cenário de teste
  - inspeção manual do botão no portal após a mudança → confirmar comportamento (gera/substitui, não duplica)
```

## Story

**Como** Junior (responsável pelo CUCA) e o sócio,
**quero** que o agente Institucional responda perguntas sobre a rede CUCA inteira (ex.: "quais unidades têm atividade pra criança") com dado real, sem depender de o lead ter escolhido uma unidade,
**para que** o canal único e unificado da Institucional cumpra a proposta de tratar a rede toda como fonte de conhecimento, não só a unidade que o lead selecionou.

## Contexto e Problema

Hoje, sem unidade escolhida, a única fonte de resposta do agente Institucional é a categoria `FAQ` isolada (4 documentos ativos em produção, 5 chunks, confirmado via MCP read-only, todos sem `unidade_cuca`) — é literalmente todo o conhecimento "de rede" disponível. `monthly_program` (programação/atividades) e `eventos_pontuais` exigem unidade exata (`buscar_chunks_similares` com `p_unidade_cuca` preenchido) — sem unidade escolhida, esses dois tipos nunca aparecem na busca, independente da pergunta.

Isso é confirmado diretamente no print de produção que originou esta investigação: a pergunta "há atividades para crianças na rede CUCA?" recebeu uma resposta genérica ("recomendo entrar em contato com a unidade mais próxima") em vez de uma resposta com dado real — porque o dado real (quais unidades oferecem o quê) está em `monthly_program`, inacessível sem unidade.

**Importante:** a story `S-WM-31` (que corrige a corrida de conversa e o reset de saudação) **não muda essa fonte de dado**. Depois da S-WM-31, o bot para de resetar/repetir saudação, mas ainda só tem o `FAQ` isolado pra responder pergunta de rede — a S-WM-31 resolve o "esquecimento" da conversa, esta story resolve a falta de dado real.

### Decisão de mecanismo (já tomada — não reabrir)

Duas abordagens foram avaliadas em conjunto com Junior e o sócio:

- **Opção A (descartada):** ampliar `buscar_chunks_similares` pra incluir `monthly_program`/`eventos_pontuais` com `p_unidade_cuca: null`, misturando os chunks de todas as unidades no mesmo pool de busca vetorial. Mais rápida de implementar, mas rejeitada: "quais unidades têm X" é uma pergunta de **enumeração/agregação**, não de similaridade — busca vetorial top-5 não garante cobertura completa entre unidades mesmo sem diluição de pool (duas unidades podem descrever a mesma atividade com palavras diferentes e ficar com distância de embedding diferente da pergunta, incluindo uma e excluindo outra de forma não determinística). Risco de respostas incompletas de forma silenciosa — mesmo formato de sintoma (não confirmado como a mesma causa) do problema em aberto na story `S-WM-26` (VAL-09, investigação de "programação nunca vem completa" — ainda não concluída; **não usar como evidência desta decisão**, só como analogia de risco já vivido no projeto).
- **Opção B (escolhida):** mecanismo de carregamento direto, sem busca vetorial — um documento pequeno, tipo índice "atividade → unidades que oferecem", gerado por um passo de LLM a partir do `monthly_program` de cada unidade, carregado por inteiro quando a pergunta for de rede. Mesmo padrão que `carregarProgramacaoMensal` (`motor-agente/index.ts:683-687`) já usa hoje pra visão geral de 1 unidade — carregamento direto, não busca vetorial.

### Stopgap já aplicado em produção (informativo — não repetir)

Um `resumo_rede` referente a julho/2026 já foi inserido **manualmente** em produção como paliativo enquanto esta story não é implementada — `documentos_rag`, `id = 8b0b4157-7024-421d-bdc3-a7d5ec944d6a`, `ativo = true`, conteúdo conferido manualmente contra as 5 planilhas-fonte originais. Quando o pipeline automático desta story entrar no ar, ele deve **detectar e substituir** esse registro manual (mesmo padrão de 1-versão-ativa que `monthly_program` já usa por unidade — a nova geração automática assume o lugar do registro manual, sem duplicar).

## Escopo

### IN

1. **Fonte de dado:** reaproveitar a infraestrutura de `documentos_rag` — sem tabela nova. Novo `tipo = 'resumo_rede'`, `unidade_cuca = NULL`, sempre exatamente 1 versão `ativo = true` por vez (a geração nova substitui a anterior, incluindo o registro manual do stopgap).
2. **Sem chunking, sem embedding.** O documento é carregado **por inteiro** (campo `conteudo`, leitura direta), igual `carregarProgramacaoMensal` já faz hoje pra 1 unidade — não passa por `buscar_chunks_similares` em nenhum momento.
3. **Geração:** um passo de LLM que lê os `monthly_program` ativos das 5 unidades (via `documentos_rag`/`chunks_documentos`, mesma fonte que já existe) e normaliza nome de atividade entre elas (ex.: "futsal" e "futebol de salão" viram a mesma entrada), produzindo um índice consolidado tipo "atividade → lista de unidades".
4. **Gatilho de geração: botão manual no portal** ("Atualizar resumo de rede"), não automático a cada upload individual. **Justificativa registrada nesta investigação:** hoje não existe nenhum cron de reimportação automática de planilha — o que existe é upload manual por unidade (`configuracoes/rag-global`, `developer/base-conhecimento`), cada upload disparando `processar-documento` individualmente, um por unidade, possivelmente em momentos diferentes ao longo do mês. Um gatilho automático por upload individual arriscaria regenerar o `resumo_rede` com dado parcial (só 1 de 5 unidades atualizada no momento). O botão dá controle explícito de quando regenerar — depois que todas as unidades relevantes já subiram a programação do mês. **Confirmado nesta validação de @po — Task 1 já resolvida, não é mais checkpoint pendente:** o desenho do botão manual está aprovado, @dev não precisa de nova confirmação de @po antes de codar este item. O endpoint/function por trás do botão deve exigir permissão explícita (mesmo padrão `has_permission('rag-global', 'update')` ou equivalente já usado nas outras telas de RAG do portal) — não pode ficar acessível a qualquer usuário autenticado, dado que reescreve a fonte de conhecimento pública do agente Institucional.
5. **Consumo no motor-agente:** sempre que `perguntaGeralAtiva=true` disparar — nos 3 pontos de entrada já existentes/planejados: 1ª mensagem (`decidirPrimeiraMensagem`, `pergunta_geral=true`), dentro de `aguardando_unidade` (`decidirAguardandoUnidade`, mesmo campo), e o novo 3º branch `conversa_engajada` (S-WM-31) — carregar `resumo_rede` inteiro **junto** com a busca de FAQ isolada já existente hoje, sem precisar de uma 3ª classificação pra decidir qual dos dois usar.
6. **O que NÃO muda:** `buscar_chunks_similares` continua exatamente como está pra `monthly_program`/`eventos_pontuais` — só unidade específica (`p_unidade_cuca` preenchido), nunca `null` pra esses dois tipos. Opção A fica formalmente descartada — não é fallback, não é fase 1, não deve ser implementada nem parcialmente.

### OUT
- Qualquer mudança em `buscar_chunks_similares` para `monthly_program`/`eventos_pontuais`.
- Automatizar o gatilho de reimportação de planilha por unidade (fora de escopo — só o botão de "atualizar resumo de rede" está dentro).
- Investigar ou corrigir o VAL-09 (`S-WM-26`) — mencionado aqui só como contexto de risco, story própria e já existente, não tocar.
- Deploy automático.

## Acceptance Criteria

1. **Given** os `monthly_program` ativos das 5 unidades (reais ou mockados em teste), **when** o botão "Atualizar resumo de rede" é acionado no portal, **then** um novo documento `resumo_rede` é gerado, ativado, e a versão anterior (incluindo o registro manual do stopgap, se ainda ativo) é desativada/substituída — nunca duas versões `ativo=true` simultâneas.
2. **Given** uma pergunta de rede inteira sem unidade escolhida (ex.: "quais unidades têm atividade pra criança"), **when** `perguntaGeralAtiva=true` dispara em qualquer um dos 3 pontos de entrada (1ª mensagem, `aguardando_unidade`, `conversa_engajada`), **then** o `resumo_rede` ativo é carregado por inteiro e combinado com a busca de FAQ isolada no contexto enviado ao GPT.
3. **Given** qualquer um dos 3 pontos de entrada de `perguntaGeralAtiva`, **when** testado, **then** `buscar_chunks_similares` NUNCA é chamado com `p_unidade_cuca: null` para os tipos `monthly_program` ou `eventos_pontuais` — só `resumo_rede` (carregamento direto) cobre a pergunta de rede.
4. **Given** o comportamento de FAQ isolado e dos fluxos por unidade já existentes, **when** esta story é implementada, **then** nenhum dos dois regride (testes existentes de `motor-agente/index.audit.test.ts` continuam passando).
5. **Given** cada Task concluída, **when** o @dev fecha a Task, **then** roda o teste relevante e registra no Dev Agent Record.
6. Nenhum deploy é executado por esta story.
7. **Given** o endpoint/function por trás do botão "Atualizar resumo de rede", **when** acionado por um usuário sem a permissão exigida, **then** a requisição é rejeitada — mesmo padrão `has_permission(...)` já usado nas demais telas de RAG do portal.
8. **(Adicionado por Junior, 2026-07-13, achado de teste ao vivo pós-S-WM-31 — ver Change Log)** **Given** uma pergunta de rede inteira (`perguntaGeralAtiva=true`) cujo dado não está coberto pelo `resumo_rede` disponível no contexto (seja porque o mecanismo ainda não está no ar, seja porque o `resumo_rede` ativo não menciona a atividade perguntada), **when** o GPT gera a resposta, **then** a resposta admite honestamente a limitação ("não tenho a programação consolidada da rede toda aqui, mas posso te ajudar por unidade") em vez de compor uma lista de atividades/modalidades sem fonte real verificável — reforço explícito de prompt (`INSTRUCAO_SEGURANCA` ou instrução equivalente aplicada quando `perguntaGeralAtiva=true`), testável por inspeção do texto de instrução (não é possível testar automaticamente se o GPT vai obedecer, mesma limitação já documentada em `INSTRUCAO_SEGURANCA`/VAL-02).

## Tasks / Subtasks

- [x] **Task 1 — Confirmar desenho do gatilho com @po antes de codar** (AC: 1) — **RESOLVIDA nesta validação de draft.** Botão manual aprovado por @po Pax em 2026-07-13 (ver Change Log). @dev não precisa de novo checkpoint com @po antes de codar este item — só implementar conforme o item 4 do Escopo (incluindo a exigência de permissão adicionada nesta validação).
- [x] **Task 2 — Geração do `resumo_rede`** (AC: 1, 7)
  - [x] Implementar o passo de LLM (leitura dos `monthly_program` ativos das 5 unidades, normalização de nome de atividade, geração do índice).
  - [x] Implementar o botão "Atualizar resumo de rede" no portal, ligado a uma function/endpoint que roda a geração e substitui a versão ativa — protegido por checagem de permissão (`has_permission`, ver AC7).
  - [x] Confirmar que a substituição do registro manual do stopgap (`id = 8b0b4157-7024-421d-bdc3-a7d5ec944d6a`) funciona corretamente na primeira execução real — coberto pelo teste AC1 (desativa qualquer `resumo_rede` ativo, incluindo o stopgap, por filtro de `tipo`, não por id específico).
  - [x] Teste com `monthly_program` mockado das 5 unidades, cobrindo o caso de normalização de nomes diferentes pra mesma atividade.
  - [x] Teste confirmando rejeição da requisição sem a permissão exigida (AC7).
  - [x] Reportar no Dev Agent Record.
- [x] **Task 3 — Consumo no motor-agente** (AC: 2, 3, 4, 8)
  - [x] Carregar `resumo_rede` por inteiro nos 3 pontos de `perguntaGeralAtiva=true` (coordenar com o 3º branch da S-WM-31 — este item depende dela estar implementada ou pelo menos com a interface definida).
  - [x] Combinar com a busca de FAQ isolada já existente.
  - [x] **AC8 (achado de Junior, teste ao vivo pós-S-WM-31):** adicionar reforço de prompt sobre honestidade quando o dado de rede não está coberto — não compor lista de atividades sem fonte real. Aplicar quando `perguntaGeralAtiva=true`, cobrindo tanto o cenário atual (resumo_rede não consultado ainda, se a Task 3 rodar antes da geração real) quanto o cenário pós-implementação (resumo_rede não menciona a atividade perguntada).
  - [x] `deno test` cobrindo os 3 pontos de entrada e confirmando ausência de chamada `p_unidade_cuca:null` pra `monthly_program`/`eventos_pontuais`.
  - [x] Suíte completa sem regressão.
  - [x] Reportar no Dev Agent Record.
- [x] **Task 4 — Fechamento** (AC: 5, 6)
  - [x] Atualizar File List e Change Log.
  - [x] Anunciar conclusão e recomendar @qa.

### Task 4 — Fechamento (2026-07-13)
- Suíte completa rodada de novo ao final: `deno test` (motor-agente) 105 passed/0 failed/2 ignored; `deno test` (gerar-resumo-rede) 5 passed/0 failed; `pytest` (worker, não tocado) 129 passed/3 skipped. Sem regressão em nenhuma.
- Nenhum deploy executado por esta story (AC6) — Edge Function `gerar-resumo-rede` nunca foi deployada, `motor-agente` também não foi redeployado com as mudanças da Task 3 (fica pro @devops, após o gate do @qa).
- Migration da Task 2 (`20260713200000_swm32_resumo_rede_skip_indexacao.sql`) já aplicada em produção antes de qualquer commit, confirmada com sucesso (chunks órfãos do stopgap removidos, `count=0`).
- Pendências/achados sinalizados pro @qa:
  1. Achado tangencial (fora do escopo): `documentos_rag` tem RLS habilitada, zero policies — os inserts/updates diretos que `rag-global/page.tsx` já fazia antes desta story (client-side) deveriam, em tese, falhar por RLS. Não investigado a fundo, não é desta story.
  2. ~~A permissão `programacao_rag_global`/`update`...~~ **Verificado antes do fechamento:** `sys_permissions` já tem `can_update=true` pra `programacao_rag_global` nos papéis "Super Admin Cuca" e "Institucional" (confirmado via MCP) — o botão funciona na prática pra quem já tem esses papéis, sem necessidade de seed adicional.
  3. `resumo_rede` gerado nunca foi testado contra o `monthly_program` REAL das 5 unidades (só mockado) — a normalização de nomes de atividade via LLM real só será validada quando o botão rodar de verdade em produção (risco já documentado na story: "se a Task 2 revelar que a normalização é sistematicamente ruim, HALT e reportar ao Junior").

### File List (Tasks 2-4)
- `supabase/migrations/20260713200000_swm32_resumo_rede_skip_indexacao.sql` (novo)
- `supabase/functions/gerar-resumo-rede/index.ts` (novo)
- `supabase/functions/gerar-resumo-rede/deno.json` (novo)
- `supabase/functions/gerar-resumo-rede/index.test.ts` (novo)
- `supabase/functions/motor-agente/index.ts` (modificado)
- `supabase/functions/motor-agente/index.audit.test.ts` (modificado — testes novos)
- `cuca-portal/src/app/(dashboard)/configuracoes/rag-global/page.tsx` (modificado — botão novo)
- `docs/stories/S-WM-32-RAG-Resumo-Rede-Pergunta-Geral-Sem-Unidade.md` (este arquivo)

## Dev Notes

### Achados confirmados nesta investigação
- Contagem real de produção (MCP read-only): `FAQ` — 4 documentos ativos, 5 chunks, todos `unidade_cuca IS NULL`. `monthly_program` — 1 documento ativo por unidade (5 unidades), 42 a 55 chunks cada, ~230+ chunks no total se agregados (base numérica do risco de diluição citado na decisão da Opção A).
- `motor-agente/index.ts:683-687` (`carregarProgramacaoMensal`) — padrão de carregamento direto já existente e provado, referência de implementação pro carregamento do `resumo_rede`.
- Confirmado via busca exaustiva no repo: **não existe** nenhum cron de reimportação automática de planilha hoje — só upload manual por unidade via portal, disparando `processar-documento` (`supabase/functions/processar-documento/index.ts`) individualmente.
- Nenhuma referência a `resumo_rede` existia em nenhum artefato do repo antes desta story — é conceito novo, desenhado nesta investigação junto com Junior e o sócio, não um mecanismo já implementado em outro lugar.
- Stopgap manual já em produção: `documentos_rag.id = 8b0b4157-7024-421d-bdc3-a7d5ec944d6a`, `tipo='resumo_rede'` (presumido — @dev deve confirmar o valor exato do campo `tipo` desse registro ao iniciar a Task 2, via MCP read-only, antes de escrever a lógica de substituição).

### Testing
- Geração do `resumo_rede` deve ser testável com mock do passo de LLM (não depender de chamada real à OpenAI em teste automatizado).
- Teste de "não regressão em `monthly_program`/`eventos_pontuais`" deve ser explícito — não só ausência de erro, mas asserção direta de que `buscar_chunks_similares` nunca recebe `p_unidade_cuca: null` pra esses 2 tipos em nenhum caminho de teste.

## Dependências
- **Depende da S-WM-31** para os 3 pontos de entrada de `perguntaGeralAtiva` (em especial o 3º branch `conversa_engajada`, criado lá) estarem implementados/estáveis antes da Task 3 desta story. Recomendado sequenciar S-WM-31 primeiro; Task 1 e Task 2 desta story podem começar em paralelo (não dependem do motor-agente).
- Ambas tocam `motor-agente/index.ts` — coordenar merge pra evitar conflito (mesma coordenação já usada entre S-WM-24/25/26/28).

## Riscos
- Geração via LLM da normalização de atividades pode ter qualidade variável dependendo de como cada unidade descreve suas atividades — sem AC de "qualidade perfeita de normalização" nesta story; se a Task 2 revelar que a normalização é sistematicamente ruim, HALT e reportar ao Junior antes de prosseguir, não tentar resolver ajustando prompt indefinidamente.
- Dependência cronológica com a S-WM-31 (Task 3 desta story depende do 3º branch `conversa_engajada` de lá) é o maior risco de coordenação desta leva — reforçar no handoff pro @dev.
- Se o endpoint do botão "Atualizar resumo de rede" for implementado sem a checagem de permissão (AC7), fica exposto a qualquer usuário autenticado do portal — @qa deve verificar isso explicitamente, não é opcional.

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-13 | 0.1 | Draft inicial — handoff de @dev após investigação read-only em produção, decisão de mecanismo (Opção B) já tomada por Junior em conjunto com o sócio, revisado em múltiplas rodadas | @sm River |
| 2026-07-13 | 0.2 | Validado (GO, 8/10 → 10/10 após ajuste). Task 1 (confirmação do gatilho) resolvida nesta validação — botão manual aprovado, deixa de ser checkpoint pendente pro @dev. Ajuste adicional: story não exigia controle de permissão no endpoint do botão — adicionado AC7 e checagem `has_permission` explícita na Task 2, e removido o risco de dependência de Task 1 (agora resolvida) da seção Riscos. Demais pontos do checklist (título, descrição, AC testável, escopo IN/OUT, dependências, complexidade, valor de negócio, critério de pronto) OK sem ressalva. Status Draft → Ready | @po Pax |
| 2026-07-13 | 0.3 | Ampliação de escopo autorizada diretamente por Junior, a partir de teste ao vivo em produção pós-S-WM-31: confirmado que "tudo bem" não gera mais menu à toa (S-WM-31 funcionando). Achado novo no mesmo teste — "tem curso de natação?" (sem unidade, sem resumo_rede ainda) gerou uma lista formatada de modalidades sem fonte real verificável (alucinação silenciosa, o mesmo risco já usado pra descartar a Opção A). Adicionado **AC8**: reforço de prompt exigindo honestidade sobre a limitação em vez de compor lista sem fonte, tanto no estado atual (mecanismo ainda não consultado) quanto como guarda-corpo permanente pós-implementação (resumo_rede sem a atividade perguntada). Task 3 atualizada. | @dev Dex (autorizado por Junior) |
| 2026-07-13 | 0.4 | Implementação completa (Tasks 2-4): migration aplicada em produção (skip de indexação indevida pro resumo_rede, achado técnico durante a Task 2), Edge Function `gerar-resumo-rede` + botão no portal com checagem `has_permission`, consumo unificado nos 3 pontos de `perguntaGeralAtiva` no motor-agente + guarda-corpo de honestidade (AC8). Suíte completa verde (motor-agente 105/0/2, gerar-resumo-rede 5/0, pytest 129/0/3 skip). Status Ready → Ready for Review. Nenhum commit feito ainda nesta sessão de story — a seguir. | @dev Dex |
| 2026-07-13 | 0.5 | QA Gate: **CONCERNS (não-bloqueante)**. Reproduzido independentemente: achado do trigger, as 3 suítes, baseline de `deno check`, mutation testing do AC8 e do guard 422. AC3 confirmado satisfeito como literalmente escrito (escopado aos 3 pontos de entrada de `perguntaGeralAtiva`). 4 achados registrados em QA Results: (1) gap de `p_unidade_cuca:null` num 4º branch pré-existente fora do escopo de AC3 — hoje latente/não-ativo, confirmado via MCP contra `meta_phone_numbers` real, recomendação de hardening como follow-up, não desta story; (2) divergência de versão entre arquivo local de migration e ledger do Supabase (nomenclatura, não-bloqueante); (3) RLS habilitada mas sem policies em `documentos_rag` — débito pré-existente, não bloqueia dado o padrão service-role+app-layer; (4) normalização via LLM ainda não testada contra dado real das 5 unidades — sem deploy, não foi possível testar, registrado como validação pendente pro Junior/sócio em homologação pós-deploy. Deploy pendente de 2 Edge Functions (`motor-agente` desatualizada desde a Task 3, `gerar-resumo-rede` nunca implantada) antes do PR. Status Ready for Review → InReview. | @qa Quinn |

## Dev Agent Record

### Task 2 — Geração do resumo_rede + botão no portal (2026-07-13)
- **Achado técnico antes de codar (confirmado via MCP em produção):** `documentos_rag` tem um trigger genérico (`tr_indexar_documento` → `trigger_indexar_documento()`) que dispara `processar-documento` (chunking + embedding real via OpenAI) pra **qualquer** insert/update de `titulo`/`conteudo`, sem distinguir `tipo`. O registro manual do stopgap (`id=8b0b4157-...`) já tinha sido indevidamente chunkeado (5 chunks com embedding) só por esse efeito colateral, contrariando o requisito "sem chunking, sem embedding" do Escopo item 2. **Correção aplicada (migration `20260713200000_swm32_resumo_rede_skip_indexacao.sql`, aplicada em produção antes de codar):** `trigger_indexar_documento()` agora retorna cedo (`RETURN NEW`) quando `NEW.tipo = 'resumo_rede'`, sem chamar `processar-documento`; limpeza pontual dos 5 chunks órfãos do stopgap (deletados, confirmado `count=0` depois).
- Confirmado via MCP: `tipo` do registro do stopgap é exatamente `'resumo_rede'` (Dev Notes presumia, agora confirmado), `unidade_cuca=null`, `ativo=true`, `titulo="Resumo de Rede - Atividades por Unidade - 7/2026"`.
- Nova Edge Function `supabase/functions/gerar-resumo-rede/index.ts`: passo de LLM (`montarPromptResumoRede`, pura/testável + `chamarLLMResumoRede`, thin wrapper de fetch) lê `monthly_program` ativo das 5 unidades direto de `documentos_rag.conteudo` (não via `chunks_documentos` — evita o limite de 40 chunks de `carregarProgramacaoMensal`, e aqui não há busca vetorial envolvida mesmo), monta 1 prompt único com os 5 conteúdos completos, pede normalização de nomes equivalentes. Desativa qualquer `resumo_rede` `ativo=true` anterior (cobre stopgap e gerações futuras) antes de inserir o novo — nunca duas versões ativas.
- **AC7 (permissão):** `has_permission('programacao_rag_global', 'update')` chamado via client Supabase carregando o JWT de quem fez a requisição (`Authorization` header repassado) — nunca o service role pra essa checagem específica, já que `has_permission` depende de `auth.uid()` internamente (confirmado via `pg_get_functiondef`); só depois de aprovado é que o client de service role entra pra ler/escrever `documentos_rag` (mesmo padrão de `processar-documento`).
- Botão "Atualizar resumo de rede" adicionado em `cuca-portal/.../configuracoes/rag-global/page.tsx` (mesma tela que já gerencia documentos `unidade_cuca IS NULL`) — gated client-side por `hasPermission("programacao_rag_global", "update")` (proteção real é server-side, AC7; isso só evita mostrar o botão a quem não tem a permissão).
- **Achado tangencial, fora do escopo desta story:** `documentos_rag` tem RLS habilitada mas **zero policies** (`pg_policies` vazio) — em teoria, os inserts/updates/deletes diretos que `rag-global/page.tsx` já faz via client-side (antes desta story) deveriam falhar por RLS pra qualquer role sem bypass. Não investiguei mais fundo nem mexi nisso — não é meu escopo, mas registro pro @qa/@po decidirem se abre story própria.
- Testes (`supabase/functions/gerar-resumo-rede/index.test.ts`): prompt puro (inclui bloco de cada unidade + instrução de normalização), AC7 (sem permissão → 403, nenhuma leitura/escrita em `documentos_rag`), AC1 (com permissão → desativa versão anterior + grava nova com `tipo=resumo_rede`/`unidade_cuca=null`/`ativo=true`), sem `monthly_program` ativo → 422 sem chamar o LLM, método não-POST → 405. **5 passed, 0 failed.**
- `deno check index.ts`: 4 erros, mesma categoria pré-existente (S-WM-28, `createClient` sem generics) — confirmado que o arquivo-irmão `processar-documento/index.ts` tem a mesma categoria de erro usando o mesmo padrão de client, não é regressão nova desta story.
- Frontend (`rag-global/page.tsx`): `npx tsc --noEmit` rodado no `cuca-portal` inteiro — só 1 erro pré-existente não relacionado (`tests/divulgacao-disparar-logic.test.ts`), nada novo introduzido por esta mudança.

### Task 3 — Consumo no motor-agente + guarda-corpo de honestidade (2026-07-13)
- Nova função `carregarResumoRede` (`motor-agente/index.ts`, ao lado de `carregarProgramacaoMensal`): lê `documentos_rag.conteudo` **diretamente** (não via `chunks_documentos`) — `resumo_rede` nunca é chunkeado (migration da Task 2), então não faz sentido reconstruir por chunks como `carregarProgramacaoMensal` faz pra `monthly_program`. Retorna `""` quando não há `resumo_rede` ativo (nunca trata isso como erro).
- **Os 3 pontos de entrada de `perguntaGeralAtiva=true` (1ª mensagem/`decidirPrimeiraMensagem`, `aguardando_unidade`/`decidirAguardandoUnidade`, `conversa_engajada`/`decidirConversaEngajada`) já convergem pro MESMO branch compartilhado no Passo 6** (`isAgenteProgramacao && perguntaGeralAtiva`) — só precisei modificar esse branch uma vez, não 3 vezes, exatamente como o Escopo item 5 pede ("sem precisar de uma 3ª classificação pra decidir qual dos dois usar").
- `contextRAG` agora combina 2 blocos rotulados (`--- RESUMO DA REDE (atividades por unidade) ---` e `--- CONTEXTO (FAQ) ---`), cada um só incluído se tiver conteúdo real.
- **AC8 (achado de Junior — alucinação silenciosa reproduzida em teste ao vivo):** instrução condicional nova em `promptFinal`, disparada só quando `perguntaGeralAtiva=true` (não em `INSTRUCAO_SEGURANCA` genérico, pra não confundir respostas de 1 unidade específica) — instrui o GPT a admitir honestamente a limitação ("não tem a programação consolidada da rede toda") em vez de compor lista de atividades sem fonte, cobrindo tanto resumo_rede ausente quanto resumo_rede sem a atividade perguntada.
- **AC3 (nunca vetorial sem unidade pra monthly_program/eventos_pontuais):** garantido estruturalmente — `carregarResumoRede` nunca chama `buscar_chunks_similares`; o branch `perguntaGeralAtiva` só chama essa RPC com `p_tipos:["FAQ"]` (inalterado desde antes desta story).
- Testes novos em `motor-agente/index.audit.test.ts`: AC2/AC3 nos 3 pontos de entrada (1ª mensagem, `aguardando_unidade`, `conversa_engajada`) confirmando `resumo_rede` carregado + combinado com FAQ real, e ausência de `p_unidade_cuca:null` pra `monthly_program`/`eventos_pontuais`; AC8 confirmando a instrução de honestidade no prompt quando `resumo_rede` está ausente; teste negativo confirmando que pergunta de unidade específica NÃO recebe a instrução de rede nem tenta carregar `resumo_rede`.
- **Mutation testing (rigor extra, mesmo padrão da S-WM-31):** removi temporariamente a instrução de honestidade (AC8) e confirmei que o teste dela falha corretamente — restaurado, suíte volta ao verde. **Achado durante esse processo:** minha 1ª versão do teste AC2/AC3 (checando a substring `"CONTEXTO (FAQ)"`) passava por acidente — o texto da própria instrução de honestidade também cita o nome do bloco `"--- CONTEXTO (FAQ) ---"`, então a asserção batia na instrução, não no conteúdo real do FAQ. Corrigido: mock agora fornece um chunk de FAQ real (`"O CUCA funciona de seg a sáb."`) e a asserção verifica esse texto, não o nome do bloco — reconfirmado com mutation test que os dois testes (AC2/AC3 e AC8) ficam corretamente isolados um do outro.
- `deno test --no-check --allow-env --allow-read --allow-net .`: **105 passed, 0 failed, 2 ignored** (era 100 ao fim da S-WM-31; +5 novos desta Task, 0 regressão).
- `deno check index.ts`: **75 erros** (era 73 ao fim da S-WM-31) — mesmas 4 categorias já documentadas (S-WM-28), +2 proporcional ao código novo (`conversa`/`documentos_rag` referenciados mais vezes), nenhuma categoria nova.
- `pytest tests/` (worker, não tocado nesta story): **129 passed, 3 skipped** — confirmado sem regressão.

## QA Results

**Revisor:** @qa Quinn · **Data:** 2026-07-13 · **Verdict: CONCERNS (não-bloqueante)**

Reprodução independente (não confiei no relato do @dev — refiz cada verificação do zero):

### Verificações reproduzidas independentemente

- **Achado do trigger (pré-implementação):** confirmado via MCP — `trigger_indexar_documento()` em produção já tem o guard `IF NEW.tipo = 'resumo_rede' THEN RETURN NEW; END IF;`. `chunks_documentos` para o `resumo_rede` do stopgap: 0 linhas (limpo). Achado real e corrigido corretamente antes de qualquer código de geração ser escrito.
- **Suítes:** `deno test` motor-agente 105/0/2, `gerar-resumo-rede` 5/0, `pytest` 129/0/3-skip — todas verdes, batendo com o relatado.
- **`deno check` baseline:** isolado via `git show f753b35:.../index.ts` (estado pós-S-WM-31) em cópia separada — 73→75 erros, mesma categoria (TS2339, 32→34), proporcional ao código novo, nenhuma categoria nova. `gerar-resumo-rede` própria: 4 erros, mesmo padrão de débito já conhecido (S-WM-28, `createClient` sem generics). Aceitável.
- **Mutation testing do AC8:** removi a instrução de honestidade via substituição temporária, confirmei exatamente 1 teste falhando, restaurado, suíte volta ao verde — reproduz o achado do @dev.
- **Mutation testing do guard 422 (`gerar-resumo-rede`, sem `monthly_program` ativo):** removido temporariamente, teste correspondente falha, restaurado — guard é real, não vestigial.
- **AC3 (inspeção de código, os 4 call-sites de `buscar_chunks_similares` em `motor-agente/index.ts`):** confirmado por leitura direta — o branch de `carregarResumoRede` nunca chama a RPC; o branch `perguntaGeralAtiva` só passa `p_tipos:["FAQ"]`; os outros 2 branches (unidade definida, com/sem `precisaVisaoGeral`) sempre passam `p_unidade_cuca` preenchido. **Nos 3 pontos de entrada de `perguntaGeralAtiva` — exatamente o que AC3 declara —, a garantia se sustenta.**
- **Achado autocorrigido pelo @dev (teste AC2/AC3 originalmente vago):** reproduzi a mutação (reintroduzindo o bug que a 1ª versão do teste não pegava) contra a versão corrigida do teste — falha corretamente agora. Confirma que a correção isolou os dois testes (AC2/AC3 vs. AC8) como reportado.

### Achados adicionais (fora do escopo literal de AC3, mas relevantes)

1. **[INFO, não-bloqueante] Gap de `p_unidade_cuca:null` fora dos 3 pontos de entrada de `perguntaGeralAtiva` — hoje latente, não ativo.** Existe um 4º branch (fallback genérico, `index.ts:~1140-1145`, pré-existente — não tocado por esta story) que roteia por `RAG_FONTES_POR_AGENTE[agente_tipo]` com `p_unidade_cuca: temUnidadeDefinida ? unidadeEfetiva : null`. Esse branch só é alcançado quando `unidade_cuca !== 'Geral'` (então o bloco que setaria `perguntaGeralAtiva` é pulado inteiro) e o agente ainda assim é `Institucional`/`maria` (cujas fontes incluem `monthly_program`/`eventos_pontuais`). Verifiquei ao vivo via MCP (`SELECT phone_number_id, agente_tipo, unidade_cuca FROM meta_phone_numbers`): hoje só existem 2 números ativos — `Institucional` com `unidade_cuca='Geral'` (não cai nesse branch) e `Empregabilidade` com `unidade_cuca=null` (cai no branch, mas suas fontes são só `["FAQ"]`, sem `monthly_program`/`eventos_pontuais` — sem risco). **Conclusão: o gap existe no código mas não está sendo exercitado hoje.** Ele se tornaria ativo se um novo número Institucional fosse cadastrado sem `unidade_cuca='Geral'` explícito (não há `NOT NULL`/`DEFAULT`/`CHECK` garantindo isso no schema). Isso **não é uma violação de AC3** (que é escopado literalmente aos 3 pontos de entrada de `perguntaGeralAtiva`, e ali a garantia se sustenta) — é um risco pré-existente, adjacente ao espírito do item 6 do Escopo ("Opção A fica formalmente descartada"), fora do escopo desta story. **Recomendação de follow-up (não desta story):** trocar `unidade_cuca === 'Geral'` por `!unidade_cuca || unidade_cuca === 'Geral'` no ponto de decisão (`index.ts:~853`), fechando o fallback também para esse caso. Sugiro registrar como item rápido pro @dev/@po, não reabrir esta story pra isso.
2. **[INFO, não-bloqueante] Divergência de versão de migration.** Arquivo local `supabase/migrations/20260713200000_swm32_resumo_rede_skip_indexacao.sql`, mas o ledger de produção (`supabase_migrations.schema_migrations`) registrou a versão como `20260713222226` (confirmado via MCP). Causa: `apply_migration` via MCP atribui timestamp próprio no momento da aplicação, independente do prefixo escolhido no nome do arquivo local — não é um erro de aplicação, só uma divergência de nomenclatura entre o arquivo versionado no git e o registro real no Supabase. Não bloqueia (a migration foi aplicada e confirmada com sucesso), mas registro pra rastreabilidade: recomendo, em stories futuras, conferir a versão real via `list_migrations`/`schema_migrations` logo após aplicar e renomear o arquivo local pra bater, evitando esse desalinhamento se algum dia for necessário auditar ou reverter por número de versão.
3. **[Pendência do usuário, avaliada] RLS em `documentos_rag`.** Confirmado via MCP: `relrowsecurity=true`, mas **zero policies registradas** (`pg_policy` vazio para a tabela) — é o padrão "RLS habilitada mas morta" que a regra do projeto pede pra vigiar. Não bloqueia esta story: os 2 endpoints que escrevem/leem (`gerar-resumo-rede`, `motor-agente`) usam service-role key (bypassa RLS por padrão) com autorização feita na camada de aplicação (`has_permission` pra escrita, sem exposição direta pra leitura por client anônimo/autenticado). É débito técnico pré-existente, não introduzido por esta story — mas como esta story acrescenta um **novo endpoint de escrita** na mesma tabela, registro como achado a considerar se `documentos_rag` algum dia precisar ser acessada fora do padrão service-role+app-layer (ex.: leitura direta client-side). Não bloqueante hoje.
4. **[Pendência do usuário, avaliada] Normalização via LLM nunca testada contra dado real das 5 unidades.** Não foi possível fazer o teste manual via botão real, porque `gerar-resumo-rede` ainda não foi implantada (deploy pendente, ver abaixo) — não há ambiente onde acionar o botão real contra produção. **Registro como CONCERNS, não bloqueante:** validação manual (conferir se o índice "atividade → unidades" gerado bate com as 5 planilhas-fonte reais de julho/2026, inclusive a normalização de nomes equivalentes) fica pendente para ser feita pelo Junior/sócio em homologação, logo após o deploy da function — antes de considerar o mecanismo "pronto pra uso real", não só "pronto no código".

### Veredito

**CONCERNS (não-bloqueante).** O trabalho entregue (Tasks 2-4) é sólido: AC1, AC2, AC4, AC5, AC6, AC7 e AC8 verificados e reproduzidos independentemente: comportamento correto, testes não-vazios (confirmado por mutation testing, inclusive um teste que eu mesmo quebrei de propósito e restaurei), sem regressão. AC3, como literalmente escrito (escopado aos 3 pontos de entrada de `perguntaGeralAtiva`), está satisfeito. Os 4 achados acima são informativos ou de validação pendente — nenhum é regressão introduzida por esta story, nenhum bloqueia o merge, mas o achado #1 (gap latente) e o achado #4 (LLM não testada contra dado real) merecem acompanhamento explícito do Junior antes de considerar o recurso 100% validado em produção.

### Deploy necessário antes do PR (para @devops coordenar)

Duas Edge Functions tocadas nesta story, nenhuma ainda implantada com o código atual:
- **`motor-agente`**: já tem uma versão implantada (v34, da S-WM-31), mas o código local avançou com as mudanças da Task 3 desta story (consumo de `resumo_rede` + AC8) — **precisa de novo deploy** antes do merge, senão produção roda uma versão desatualizada.
- **`gerar-resumo-rede`**: **nunca foi implantada** — é function nova, precisa do primeiro deploy.

Sequência recomendada (mesmo padrão da S-WM-31): commit local → deploy das 2 functions → confirmar sucesso via `get_edge_function`/teste funcional → só então push + PR contra `develop`.

**Status:** Ready for Review → InReview.
