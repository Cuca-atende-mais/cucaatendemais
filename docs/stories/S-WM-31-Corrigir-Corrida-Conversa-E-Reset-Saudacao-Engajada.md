# S-WM-31 — Corrigir corrida de duplicação de conversa e reset determinístico de saudação em conversa já engajada

## Status
InReview

## Complexidade
**M** (médio) — 6 itens de escopo tocando 2 sistemas (worker Python + edge function motor-agente), incluindo 1 migration, 1 mudança de padrão de persistência (select-então-insert → upsert) e 1 mecanismo novo de estado de conversa (`conversa_engajada`, 3º branch de roteamento). Nenhum item exige decisão de produto — é correção de bug, mas o item 6 tem desenho técnico não-trivial que precisa ser seguido à risca (ver Dev Notes).

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - deno test → funções puras alteradas/novas (decidirAguardandoUnidade, decidirPrimeiraMensagem, novo roteamento conversa_engajada) sem regressão
  - pytest (worker) → upsert de conversas, payload com conversa_id
  - MCP execute_sql (cuca-dev, read-only) → confirmar constraint UNIQUE aplicada e sem violação em dado existente antes de subir pra produção
  - Teste de concorrência determinístico (2 inserções quase simultâneas mockadas) → confirmar 1 única linha de conversa
```

## Story

**Como** Junior (responsável pelo CUCA) e o sócio, que reportaram o problema ao vivo com print de conversa real,
**quero** que o motor-agente Institucional pare de duplicar conversas e de resetar para a saudação de abertura no meio de uma conversa já em andamento,
**para que** o atendimento via WhatsApp oficial (canal único, unificado pra toda a Rede CUCA) se comporte de forma coerente e confiável pro público.

## Contexto e Problema

Origem: 3 sintomas relatados pelo sócio via print de teste em produção real (13/07/2026, 12:29–12:32) e logs de produção do `motor-agente` (execution_ids reais, mesmo dia). Investigação foi feita **somente leitura** (MCP Supabase produção read-only + leitura de código no worker e na edge function) — nenhuma alteração foi aplicada antes desta story.

**Sintomas do print:**
1. Lead manda 2 mensagens em sequência rápida ("Oláa" / "Tudo bem?") — bot responde com 2 saudações de abertura **diferentes**, uma pra cada mensagem, em vez de uma resposta só.
2. Pergunta que depende de unidade ("quais cucas têm atividade pra criança") faz o bot voltar a mandar saudação de abertura + menu de unidade, como se fosse a 1ª mensagem da conversa.
3. Depois de uma resposta válida (RAG geral respondeu sobre a rede), um follow-up do lead ("você consegue averiguar pra mim?") faz o bot resetar pra saudação de abertura de novo, do zero.

O cron `reset_automation_memory_daily` (que apaga `conversas`/`mensagens`/`logs_webhook` todo dia às 03:00 UTC, achado real e separado desta investigação, story própria a ser aberta depois) foi **descartado como causa destes 3 sintomas**: o print inteiro acontece entre 12:29 e 12:32, muito fora do horário do cron.

Duas causas raiz reais, confirmadas em código e banco, cobrem os 3 sintomas:

### Causa raiz A — corrida de concorrência na criação de `conversas`

`worker/meta_adapter_inbound.py:626-648` faz um `select` seguido de `insert` condicional, sem transação nem trava:

```python
conv_result = supabase.table("conversas").select("id, status").match(
    {"lead_id": lead_id, "origem_id": phone_number_id}
).execute()

if conv_result.data:
    conversa_id = conv_result.data[0]["id"]
else:
    new_conv = supabase.table("conversas").insert({...}).execute()
    conversa_id = new_conv.data[0]["id"]
```

`motor-agente/index.ts:750-753` faz o **mesmo tipo de resolução independente** (por `telefone`+`canal_origem`), redundante com a do worker.

A tabela `conversas` **não tem nenhuma constraint única** em `(lead_id, origem_id)` — só PK em `id` (confirmado via MCP: `list_tables` verbose, `foreign_key_constraints` sem nenhuma unique constraint além da PK). Se dois webhooks quase simultâneos do mesmo lead chegam, ambos podem ver "não existe conversa ainda" e ambos inserirem — gerando 2+ linhas `conversas` pro mesmo `(lead_id, origem_id)`, cada uma com seu próprio `metadata`/histórico fragmentado.

O worker já tem um mecanismo de debounce (`_agendar_dispatch_debounced`, `worker/meta_adapter_inbound.py:468-528`, referenciado no código como VAL-05) que deveria unir mensagens rápidas do mesmo lead num dispatch só — mas ele é chaveado por `conversa_id` (linha 505). Se a corrida acima já gerou 2 `conversa_id` diferentes pras 2 mensagens quase simultâneas, o debounce não tem como saber que são a mesma conversa — cada uma dispara seu próprio dispatch independente. Confirmado que o worker roda com processo único (`worker/Dockerfile:18`: `CMD ["gunicorn", "-w", "1", ...]`), então a limitação de múltiplas réplicas que o próprio código já documenta como "conhecida e aceita" **não é o caso aqui** — o problema é anterior a isso, na criação da conversa.

Isso explica o sintoma 1 (saudação duplicada).

### Causa raiz B — reset determinístico de saudação em conversa já engajada (achado adicional desta investigação, SEM relação com a corrida)

O roteamento de unidade em `motor-agente/index.ts:807-881` (dentro do bloco `if (unidade_cuca === 'Geral')`) decide qual dos 3 branches usar olhando só duas flags em `conversa.metadata`: `unidade_selecionada` e `aguardando_unidade`.

`decidirPrimeiraMensagem` (`motor-agente/index.ts:523-551`) tem 3 saídas possíveis:
- Unidade detectada diretamente → resolve, segue fluxo normal.
- `pedido_depende_unidade=true` sem unidade → `aguardandoUnidade: true`, mostra menu (comportamento correto, esperado).
- **Cortesia pura** (linha 536-545) OU **`pergunta_geral=true`** (linha 530-533) → as duas devolvem `unidadeSelecionada: null` **e** `aguardandoUnidade: false`.

Esses dois últimos casos são gravados em `metadata` exatamente como vieram (linhas 900/906-907 do handler) — ou seja, depois de uma resposta de cortesia ou de uma pergunta geral respondida, o `metadata` da conversa fica **idêntico** ao de uma conversa que nunca trocou nenhuma mensagem (`unidade_selecionada` ausente, `aguardando_unidade` falsy). Na mensagem seguinte, `unidadeSalva` é falsy e `aguardando` é falsy → o roteamento cai de novo no branch `else` de 1ª mensagem (linha 881), roda `decidirPrimeiraMensagem` do zero, sorteia uma saudação nova de `SAUDACOES_ABERTURA` (linha 503-510) — sem depender de nenhuma corrida, 100% determinístico. Confirmado por rastreamento direto do código e batendo com logs reais de produção em 2 dias diferentes (12/07 e 13/07), sem nenhuma mensagem simultânea envolvida no momento do reset.

Isso explica os sintomas 2 e 3 (menu voltando à toa / reset de saudação no meio da conversa).

**Importante:** esta causa raiz B é independente da causa raiz A. Corrigir só a corrida (itens 1-5 do escopo) não resolve o sintoma de reset — por isso o item 6 é parte obrigatória desta story, não um extra opcional.

## Escopo

### IN

1. **Migration (idempotente):** `UNIQUE (lead_id, origem_id)` em `conversas`. Confirmar antes de aplicar (via MCP read-only em cuca-dev) que não há duplicatas existentes que quebrariam a constraint; se houver, story inclui um passo de dedup antes da constraint — **política de dedup (definida nesta validação):** manter a linha mais antiga (`MIN(created_at)`) como canônica por `(lead_id, origem_id)`, migrar `mensagens.conversa_id` das linhas duplicadas mais recentes para a canônica antes de apagá-las (nunca apagar `mensagens` associadas), e registrar quantas linhas foram merged no Dev Agent Record.
2. **Worker (`meta_adapter_inbound.py:626-648`):** trocar o select-então-insert por `upsert(on_conflict="lead_id,origem_id")` — mesmo padrão já usado pra `leads` (`meta_adapter_inbound.py:611-614`). Cuidado: o payload do upsert não deve incluir colunas que só fazem sentido na criação (ex.: `status: "ativa"`) de forma que sobrescreva o status de uma conversa já em andamento — só as colunas que realmente precisam de update devem ir no upsert.
3. **Worker:** incluir `conversa_id` no payload enviado ao motor-agente (`meta_adapter_inbound.py:323-331`, hoje só manda `mensagem`, `midia_url`, `midia_tipo`, `telefone`, `canal_origem`, `agente_tipo`, `unidade_cuca`).
4. **motor-agente:** aceitar `conversa_id` no body do request — **opcional**, com fallback pro método atual de resolução por `telefone`+`canal_origem` se ausente (robustez pra qualquer caller futuro que não mande). Quando presente, buscar a conversa por PK (`id`) em vez de re-derivar por `lead_id`+`origem_id`. Confirmado nesta investigação: hoje existe **só 1 caller** do motor-agente no repo inteiro (`worker/meta_adapter_inbound.py:336`) — risco de quebrar outro caller é baixo, mas o fallback deve ser mantido por segurança.
5. **motor-agente:** `decidirAguardandoUnidade` (linha 430-467) passa a usar `pedido_depende_unidade` (campo já classificado pelo GPT, prompt em `motor-agente/index.ts:389`, já usado por `decidirPrimeiraMensagem` linha 536) como critério central — hoje as duas funções decidem de forma inconsistente quando pedir a unidade.
6. **motor-agente — mecanismo novo (`conversa_engajada`):**
   - Novo campo booleano em `conversa.metadata`: `conversa_engajada`.
   - Os 2 caminhos de `decidirPrimeiraMensagem` que hoje deixam tudo "vazio" (cortesia pura, `pergunta_geral=true`) passam a **também** gravar `conversa_engajada: true` no `metadata`, junto do que já gravam hoje.
   - **Ampliação de escopo (autorizada por Junior em 2026-07-13, achado durante a Task 3 — ver Dev Agent Record):** os caminhos de `decidirAguardandoUnidade` que resolvem SEM aguardar unidade (unidade encontrada, `pergunta_geral=true`, ou cortesia pura via `pedido_depende_unidade=false`, este último já superando VAL-13 na Task 3) **também** devem gravar `conversa_engajada: true` no `metadata` quando resolvem. Sem isso, a mensagem seguinte a uma cortesia resolvida dentro do fluxo `aguardando_unidade` cairia no branch `else` de 1ª mensagem e sortearia uma saudação nova — Causa raiz B reaparecendo especificamente nesse caminho.
   - Novo 3º branch de roteamento em `motor-agente/index.ts:807-881`, posicionado **depois** do branch `unidadeSalva` e do branch `aguardando`, **antes** do branch `else` de 1ª mensagem: se `conversa_engajada === true` (e nem `unidadeSalva` nem `aguardando` bateram), reavaliar a mensagem usando a MESMA detecção de unidade direta / `pedido_depende_unidade` já usada nos outros branches — **sem** repetir a saudação de `SAUDACOES_ABERTURA`:
     - Unidade detectada (direta ou semântica) → segue fluxo normal, mesmo tratamento de troca/seleção de unidade já existente.
     - `pedido_depende_unidade=true` sem unidade identificada → pede a unidade, mas com tom de **continuação** de conversa (não a abertura/menu de 1ª mensagem) — texto novo, não reaproveitar `SAUDACOES_ABERTURA` nem o texto de boas-vindas do menu inicial.
     - Nenhum dos dois → `perguntaGeralAtiva=true`, segue pro Passo 6 (RAG geral), mesmo comportamento que `pergunta_geral=true` já dispara hoje.
   - O branch `else` de 1ª mensagem (linha 881, que chama `decidirPrimeiraMensagem`) só deve rodar quando **nenhuma** das 3 flags (`unidade_selecionada`, `aguardando_unidade`, `conversa_engajada`) estiver presente em `metadata` — ou seja, só na 1ª mensagem de verdade de uma conversa nova (ou reaberta, ver AC de regressão abaixo).
   - **Este mecanismo não existe em nenhum artefato do repo hoje** (nem código, nem story, nem doc) — é desenho novo desta investigação, deve ser implementado exatamente como descrito acima, não "adaptado" de algo que já existe.

### OUT
- Corrigir o cron `reset_automation_memory_daily` rodando em produção — achado real, mas causa raiz separada, sem relação com os 3 sintomas desta story. Story própria a ser aberta depois.
- Qualquer mudança na fonte de dados/RAG pra pergunta de rede inteira (`resumo_rede`) — isso é a **S-WM-32**, story separada, que **depende** desta (consome o 3º branch criado no item 6).
- Deploy automático.

## Acceptance Criteria

1. **Given** duas requisições quase simultâneas de webhook pro mesmo lead (mesmo `telefone`, mesmo `phone_number_id`), **when** ambas chegam ao worker antes de qualquer uma terminar de resolver a conversa, **then** existe exatamente 1 linha em `conversas` pra esse `(lead_id, origem_id)` — testado com cenário de concorrência determinístico (mock), não dependente de timing real.
2. **Given** a constraint `UNIQUE (lead_id, origem_id)` aplicada, **when** uma conversa encerrada é reaberta (fluxo AUD-15/VAL-07, `motor-agente/index.ts:754-765`), **then** a reabertura reusa a mesma linha existente — sem violação de constraint, sem criar linha nova.
3. **Given** uma mensagem que a IA classifica como cortesia pura ou `pergunta_geral=true`, **when** a mensagem seguinte do mesmo lead chega (não sendo claramente dependente de unidade), **then** o bot NÃO repete a saudação de `SAUDACOES_ABERTURA` nem o menu de unidade — responde via o novo 3º branch (`conversa_engajada`).
4. **Given** uma sequência de 3+ mensagens de cortesia/pergunta geral na mesma conversa, **when** nenhuma delas escolhe uma unidade, **then** nenhuma repete a abertura — `conversa_engajada` permanece `true` e o roteamento usa sempre o 3º branch, nunca volta pro `else` de 1ª mensagem.
5. **Given** `decidirAguardandoUnidade` e `decidirPrimeiraMensagem`, **when** testadas com o mesmo conjunto de casos de `pedido_depende_unidade`, **then** as duas produzem decisão consistente (pedir unidade só quando `pedido_depende_unidade=true`).
6. **Given** o `conversa_id` incluído no payload do worker pro motor-agente, **when** presente, **then** motor-agente resolve a conversa por PK; **when** ausente (caller hipotético futuro sem essa info), **then** cai no fallback de resolução por `telefone`+`canal_origem`, sem quebrar.
7. **Given** cada Task é concluída, **when** o @dev fecha a Task, **then** roda o teste relevante (`deno test` e/ou `pytest`) e registra o resultado no Dev Agent Record antes de seguir pra próxima Task.
8. Nenhum deploy é executado por esta story.

## Tasks / Subtasks

- [x] **Task 1 — Migration: constraint única em `conversas`** (AC: 1, 2)
  - [x] `[db-read]` Verificar via MCP se há duplicatas de `(lead_id, origem_id)` hoje que impediriam a constraint.
  - [x] Criar migration idempotente (`IF NOT EXISTS`) com `UNIQUE (lead_id, origem_id)`.
  - [x] Aplicar via MCP `apply_migration` — **aplicada diretamente em produção** (`svzkrkfzpiqcesloukgb`), não em cuca-dev como o texto original desta task previa. Sessão MCP estava reconectada em `.mcp.prod.json`; Junior autorizou explicitamente a aplicação direta em produção nesta sessão (gate humano, confirmado via pergunta direta antes da execução). cuca-dev ainda não tem esta migration aplicada — pendência de paridade a resolver antes de @qa validar via cuca-dev conforme `quality_gate_tools` desta story.
  - [x] Reportar no Dev Agent Record.
- [x] **Task 2 — Worker: upsert de conversa + payload com `conversa_id`** (AC: 1, 6)
  - [x] Trocar select-então-insert (`meta_adapter_inbound.py:626-648`) por `upsert(on_conflict="lead_id,origem_id")`.
  - [x] Incluir `conversa_id` no payload pro motor-agente (`meta_adapter_inbound.py:323-331`).
  - [x] Teste de concorrência (mock de 2 chamadas quase simultâneas) confirmando 1 única linha.
  - [x] `pytest` completo do worker sem regressão.
  - [x] Reportar no Dev Agent Record.
- [x] **Task 3 — motor-agente: aceitar `conversa_id`, alinhar `pedido_depende_unidade`** (AC: 5, 6)
  - [x] motor-agente aceita `conversa_id` opcional no body, resolve por PK quando presente, fallback quando ausente.
  - [x] `decidirAguardandoUnidade` passa a usar `pedido_depende_unidade`.
  - [x] `deno test` cobrindo os casos novos e os existentes (sem regressão nos testes já registrados em `motor-agente/index.audit.test.ts`).
  - [x] Reportar no Dev Agent Record.
- [x] **Task 4 — motor-agente: `conversa_engajada` e 3º branch de roteamento** (AC: 3, 4)
  - [x] Implementar o campo `conversa_engajada` conforme desenhado nesta story (item 6 do Escopo, incluindo a ampliação de escopo registrada acima — cobrir também os caminhos de resolução de `decidirAguardandoUnidade`).
  - [x] Implementar o 3º branch de roteamento.
  - [x] `deno test` cobrindo: sequência de mensagens de cortesia/pergunta geral sem reset; transição pro branch de unidade quando detectada; transição pro `aguardando_unidade` de continuação quando `pedido_depende_unidade=true`; cortesia resolvida dentro de `aguardando_unidade` também marca `conversa_engajada=true` e não reseta na mensagem seguinte.
  - [x] Reportar no Dev Agent Record.
- [x] **Task 5 — Fechamento** (AC: 7, 8)
  - [x] Suíte completa (`deno test` + `pytest`) sem regressão.
  - [x] Atualizar File List e Change Log.
  - [x] Anunciar conclusão e recomendar @qa.

## Dev Notes

### Achados confirmados nesta investigação (fonte de verdade — não reinvestigar do zero)
- `worker/meta_adapter_inbound.py:626-648` — corrida de concorrência confirmada por leitura direta do código.
- `worker/meta_adapter_inbound.py:468-528` — debounce existente (VAL-05), funciona corretamente com processo único; `worker/Dockerfile:18` confirma `gunicorn -w 1`.
- `worker/meta_adapter_inbound.py:611-614` — padrão de upsert já usado pra `leads`, reaproveitar o mesmo padrão pra `conversas`.
- `worker/meta_adapter_inbound.py:336` — único caller do motor-agente confirmado no repo (busca exaustiva por `functions/v1/motor-agente`).
- `motor-agente/index.ts:430-467` (`decidirAguardandoUnidade`) e `motor-agente/index.ts:523-551` (`decidirPrimeiraMensagem`) — funções puras já extraídas e testáveis, ver `motor-agente/index.audit.test.ts` pros testes existentes que não podem regredir.
- `motor-agente/index.ts:807-881` — bloco de roteamento onde o novo 3º branch deve entrar.
- `motor-agente/index.ts:750-765` — resolução de conversa + fluxo de reabertura (AUD-15/VAL-07) que a Task 1/2 não pode quebrar.
- Constraint única confirmada como inexistente via MCP `list_tables` (verbose) em produção, `public.conversas`: só `primary_keys: ["id"]`, sem unique constraints adicionais.
- `pg_stat_user_tables` em produção mostrou `conversas`/`mensagens` com contagem de deletes maior que inserts historicamente, e 0 linhas vivas no momento da investigação — efeito do cron `reset_automation_memory_daily` (`jobid 10`, `pg_cron`, `0 3 * * *`, ativo), **não relacionado a esta story**, mas registrado aqui pra contexto de quem for verificar o banco durante o desenvolvimento (não estranhar tabela vazia).

### Testing
- `deno test` é o mecanismo primário pras funções puras do motor-agente — este projeto já tem o padrão de extrair lógica de decisão em funções testáveis sem mock de rede (ver `motor-agente/index.audit.test.ts`).
- `pytest` pro lado do worker (upsert, payload).
- Teste de concorrência deve ser determinístico (não depender de timing real de rede) — usar mock/stub que força as duas chamadas a executarem o `select` antes de qualquer `insert` resolver.

## Dependências
- **S-WM-32 depende desta story** (consome o 3º branch `conversa_engajada` criado no item 6) — esta deve ser implementada primeiro. Podem começar em paralelo já que S-WM-32 não tem grooming bloqueante, mas ambas tocam `motor-agente/index.ts` — coordenar merge pra evitar conflito (mesma coordenação já usada entre S-WM-24/25/26/28).
- Nenhuma outra dependência técnica com as demais stories da fila atual.

## Riscos
- Migration da constraint única pode falhar se houver duplicatas não previstas em produção no momento da aplicação — Task 1 inclui verificação prévia via MCP read-only antes de aplicar.
- O upsert no worker precisa ser cuidadoso pra não sobrescrever `status`/`agente_tipo` de uma conversa já em andamento com os valores de criação — revisar o payload do upsert com atenção antes de considerar a Task 2 concluída.
- O item 6 (`conversa_engajada`) é desenho novo, sem precedente no repo — risco de implementação divergente do desenhado; @qa deve validar contra a descrição exata desta story, não contra uma interpretação livre.

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-13 | 0.1 | Draft inicial — handoff de @dev após investigação read-only em produção (print + logs do sócio), 2 causas raiz confirmadas em código, revisado em múltiplas rodadas com Junior e o sócio | @sm River |
| 2026-07-13 | 0.2 | Validado (GO, 9/10 → 10/10 após ajuste). Ajuste aplicado: Task 1 não definia critério de qual linha manter em caso de duplicata encontrada antes da constraint — adicionada política de dedup explícita (manter mais antiga, migrar mensagens associadas, nunca apagar mensagens). Demais 9 pontos do checklist (título, descrição, AC testável, escopo IN/OUT, dependências, complexidade, valor de negócio, riscos, critério de pronto) OK sem ressalva. Status Draft → Ready | @po Pax |
| 2026-07-13 | 0.3 | Ampliação de escopo autorizada diretamente por Junior (achado do @dev durante a Task 3, não do @po): item 6 do Escopo (`conversa_engajada`) passa a cobrir também os caminhos de resolução de `decidirAguardandoUnidade` (unidade encontrada / `pergunta_geral` / cortesia pura), não só os de `decidirPrimeiraMensagem` — sem isso, Causa raiz B podia reaparecer no caminho `aguardando_unidade → cortesia resolvida → próxima mensagem`. Task 4 atualizada. | @dev Dex (autorizado por Junior) |
| 2026-07-13 | 0.4 | Implementação completa (Tasks 1-5): migration aplicada em produção (autorizado por Junior), worker com upsert atômico, motor-agente com `conversa_id`/`decidirAguardandoUnidade` alinhado/`conversa_engajada`+3º branch. Suíte completa verde (deno 100/0/2, pytest 129/0/3 skip). Status InProgress → Ready for Review. Nenhum commit/push feito (aguardando autorização explícita, regra `aiox-pipeline-enforcement`). | @dev Dex |
| 2026-07-13 | 0.5 | QA Gate: **CONCERNS** (não-bloqueante). Reproduzido independentemente com mutation testing (Tasks 2 e 4) — testes confirmados não-vacuous. Achado maior: constraint `UNIQUE(lead_id, origem_id)` já existia em produção desde ~06/07 (uma semana antes do incidente), tornando a narrativa de Causa Raiz A desta story factualmente imprecisa (mecanismo de corrida já era impossível) — Causa Raiz B sozinha explica o sintoma 1, confirmada e corrigida com rigor nas Tasks 3/4. Achados adicionais: índice duplicado em `conversas` (cleanup), Edge Function/worker ainda não deployados. Status Ready for Review → InReview. Liberado pro @devops (push + PR), com follow-ups documentados. | @qa Quinn |

## Dev Agent Record

### Task 1 — Migration: constraint única em `conversas` (2026-07-13)
- Verificação de duplicatas (`(lead_id, origem_id)` com `count(*) > 1`, `lead_id IS NOT NULL`): **0 grupos encontrados** — tabela `conversas` sem duplicatas no momento da aplicação (consistente com o achado já registrado em Dev Notes: efeito do cron `reset_automation_memory_daily`). O bloco `DO $$` de dedup permanece na migration por defensividade, mas não teve trabalho a fazer nesta execução.
- Migration `swm31_unique_conversas_lead_origem` aplicada com sucesso via `mcp__supabase__apply_migration`, versão `20260713195400`, confirmada em `list_migrations`.
- Índice único `conversas_lead_id_origem_id_unique` confirmado ativo em `public.conversas (lead_id, origem_id)` via `pg_indexes`.
- **Nota de ambiente:** aplicada em **produção** (`svzkrkfzpiqcesloukgb`), não em cuca-dev, porque a sessão MCP estava reconectada em `.mcp.prod.json` no momento da execução. Junior autorizou explicitamente essa aplicação direta em produção (gate humano). cuca-dev segue sem esta migration — precisa ser aplicada lá também antes de @qa rodar a verificação prevista em `quality_gate_tools` (`MCP execute_sql (cuca-dev, read-only)`).

### Task 2 — Worker: upsert de conversa + payload com `conversa_id` (2026-07-13)
- `worker/meta_adapter_inbound.py:626-648`: select-então-insert substituído por `upsert(on_conflict="lead_id,origem_id")` seguido de leitura de confirmação (`select("id, status").match(...)`). `status` foi deliberadamente **excluído** do payload do upsert — tem default `'ativa'` no banco (confirmado via `information_schema.columns`, usado só na criação) e é gerenciado depois pelo motor-agente (`encerrada`/`awaiting_human`/reabertura); incluí-lo no upsert sobrescreveria esse estado a cada mensagem nova, exatamente o risco apontado no Escopo item 2. `agente_tipo` e `canal_ativo` seguem no payload (NOT NULL, sem risco de estado divergente para este adapter — `canal_ativo="meta"` é sempre correto vindo do inbound Meta).
- `worker/meta_adapter_inbound.py:323-331` (`_chamar_motor_agente`, body do POST): adicionado `"conversa_id": conversa_id` ao payload.
- Teste novo `test_concorrencia_duas_chamadas_simultaneas_resolvem_mesma_conversa` (`worker/tests/test_meta_adapter_inbound.py`, classe `TestDispatchMotorAgente`): duas chamadas a `processar_webhook_meta` disparadas via `asyncio.gather` (concorrentes, não sequenciais) para o mesmo lead/telefone/phone_number_id; `_agendar_dispatch_debounced` substituído por stub pra isolar do mecanismo de debounce/cancelamento (VAL-05, já coberto em `TestDebounceDispatch`) e capturar o `conversa_id` resolvido por chamada. Confirma que as duas convergem pro mesmo `conversa_id` e que o upsert é chamado com `on_conflict="lead_id,origem_id"` nas duas — a atomicidade real (1 única linha de fato) vem da constraint `UNIQUE(lead_id, origem_id)` aplicada na Task 1, não é algo que um mock puro consiga provar sozinho.
- Ajuste de regressão necessário: `worker/tests/test_meta_adapter_outbound.py::test_upsert_lead_e_cria_conversa` mockava o branch antigo de insert (`conv_data.data = []` + mock de `.insert()`); atualizado para refletir que não há mais branch de insert separado — a leitura pós-upsert (`select().match().execute()`) já retorna a linha, nova ou existente.
- `pytest tests/` completo do worker: **129 passed, 3 skipped** (0 falhas, os 3 skips já existiam antes desta mudança).

### Task 3 — motor-agente: aceitar `conversa_id`, alinhar `pedido_depende_unidade` (2026-07-13)
- `motor-agente/index.ts:718` (handler): body passa a desestruturar `conversa_id` opcional. Resolução da conversa (linha ~750): quando `conversa_id` presente, resolve por PK (`eq("id", conversa_id)`); ausente, fallback pro método antigo (`eq("lead_id", ...).eq("origem_id", ...)`) — hoje só há 1 caller real (worker), fallback é defensivo.
- `decidirAguardandoUnidade` (linha 430-467) reescrita: critério de "reapresentar o menu" unificado com `decidirPrimeiraMensagem` — passa a usar `pedido_depende_unidade` como central, no lugar de `mudou_de_assunto`. Isso **supera VAL-13** (que mantinha `aguardandoUnidade=true` pra cortesia pura) — mudança intencional pedida pela story (AC5), não um efeito colateral: as duas funções decidiam de forma inconsistente quando pedir a unidade. Cortesia pura/pedido vago agora responde com tom de continuação ("Em que mais posso te ajudar? 😊", NUNCA `SAUDACOES_ABERTURA`, por especificação do item 6 do Escopo) em vez de reforçar o menu.
- **Ponto em aberto pra próxima Task (flag pro @po/@dev da Task 4):** depois que `decidirAguardandoUnidade` resolve cortesia pura com `aguardandoUnidade=false`, a mensagem seguinte cai no branch `else` de 1ª mensagem (`decidirPrimeiraMensagem`), que sorteia uma NOVA saudação — ou seja, Causa raiz B (reset de saudação) pode reaparecer especificamente no caminho `aguardando_unidade → cortesia resolvida → próxima mensagem`, já que o item 6 (`conversa_engajada`) só grava a flag nos 2 caminhos de `decidirPrimeiraMensagem`, não nos de `decidirAguardandoUnidade`. Precisa decisão explícita na Task 4: `conversa_engajada` também deveria ser setado quando `decidirAguardandoUnidade` resolve (unidade encontrada, pergunta_geral, ou cortesia)?
- Testes novos em `motor-agente/index.audit.test.ts`: 2 para AC5 (substituindo o teste VAL-13, que descrevia o comportamento agora superado) e 2 para AC6 (`conversa_id` presente → resolve por PK; ausente → fallback por `lead_id`/`origem_id`). Mock `criarSupabaseMock` ganhou captura de `args` em `select/eq/order/limit/single` (aditivo, mesmo padrão já usado para `payload` em `insert/update`) — necessário pra inspecionar QUAL coluna o `.eq()` usou.
- `deno test --no-check --allow-env --allow-read --allow-net .`: **92 passed, 0 failed, 2 ignored** (baseline pré-Task-3 era 89 passed; +1 líquido da troca VAL-13→AC5, +2 dos testes AC6 novos).
- `deno check index.ts`: **67 erros** — idêntico à baseline pré-existente (débito conhecido, causa raiz documentada na S-WM-28: `createClient` sem generics de tipo; nenhum erro novo introduzido por esta Task).

### Task 4 — motor-agente: `conversa_engajada` e 3º branch de roteamento (2026-07-13)
- Nova função pura `decidirConversaEngajada` (`motor-agente/index.ts`, logo após `decidirAguardandoUnidade`): mesma detecção (unidade direta/semântica, `pedido_depende_unidade`) dos outros 2 branches, mas **desenho novo** (não adaptado) — quando "nenhum dos dois" bate, sinaliza `perguntaGeralAtiva` em vez de devolver uma resposta canned (diferente de `decidirAguardandoUnidade`), deixando o Passo 6 (RAG) responder de verdade, exatamente como o item 6 do Escopo pede.
- Novo 3º branch de roteamento (`unidade_cuca === 'Geral'`), inserido via `else if (metadataAtual.conversa_engajada === true)` entre o branch `aguardando` e o branch `else` de 1ª mensagem — a exclusividade do if/else-if já garante que o `else` de 1ª mensagem só roda quando nenhuma das 3 flags bate, sem precisar de condição extra.
- `conversa_engajada: true` passa a ser gravado em **3 pontos**: (1) `decidirPrimeiraMensagem` → cortesia pura (não quando `pedido_depende_unidade=true`, já protegido por `aguardando_unidade=true`); (2) `decidirPrimeiraMensagem` → `pergunta_geral=true`; (3) ampliação de escopo (Task 3/4, autorizada por Junior): `decidirAguardandoUnidade` → cortesia pura E `pergunta_geral=true` (mesma lógica, mesmo motivo — fecha o gap identificado na Task 3).
- Textos novos de tom de continuação (nunca `SAUDACOES_ABERTURA` nem o texto de boas-vindas do menu inicial): `decidirConversaEngajada` usa "Pra te ajudar certinho com isso, me diz qual unidade CUCA:\n\n" + `MENU_UNIDADES`.
- Testes novos em `motor-agente/index.audit.test.ts`: 3 unitários pra `decidirConversaEngajada` (unidade detectada / `pedido_depende_unidade=true` / nenhum dos dois) + 5 de wiring no handler (AC3: cortesia com `conversa_engajada=true` não reseta, vai pro RAG; unidade detectada dentro do 3º branch carrega visão geral; `pedido_depende_unidade=true` dentro do 3º branch pede unidade com tom de continuação; cortesia na 1ª mensagem grava `conversa_engajada=true`; cortesia resolvida dentro de `aguardando_unidade` também grava `conversa_engajada=true`, provando a ampliação).
- `deno test --no-check --allow-env --allow-read --allow-net .`: **100 passed, 0 failed, 2 ignored** (era 92 ao fim da Task 3; +8 testes novos desta Task, 0 regressão).
- `deno check index.ts`: **73 erros** (era 67 na baseline pré-existente e ao fim da Task 3). Aumento de +6 é proporcional às novas linhas que referenciam `conversa.id`/`conversa?.metadata`/`.update({metadata:...})` (mesma causa raiz documentada na S-WM-28 — `createClient` sem generics de tipo, sem exceção nova de bug real). Nenhuma categoria de erro nova apareceu (mesmas 4 categorias TS2339/TS2345/TS2353/TS18047 já existentes).

### Task 5 — Fechamento (2026-07-13)
- Suíte completa rodada de novo, ao final de todas as 4 Tasks de implementação:
  - `deno test --no-check --allow-env --allow-read --allow-net .` (motor-agente): **100 passed, 0 failed, 2 ignored**.
  - `pytest tests/` (worker): **129 passed, 3 skipped, 0 failed**.
  - Nenhuma regressão em nenhuma das duas suítes.
- Pendências conhecidas, não bloqueantes desta story, sinalizadas pro @qa/@po decidirem:
  1. Migration da Task 1 aplicada em **produção**, não em cuca-dev (sessão MCP estava em `.mcp.prod.json`, autorizado por Junior) — cuca-dev ainda não tem o índice único; o `quality_gate_tools` desta story previa verificação via MCP em cuca-dev.
  2. `deno check index.ts`: 73 erros (baseline pré-existente 67, causa raiz documentada na S-WM-28, nenhuma categoria nova).
  3. Escopo do item 6 foi ampliado durante a Task 3 (autorizado por Junior, registrado no Change Log v0.3) — @po pode querer revisar/formalizar a ampliação depois.
- Nenhum deploy foi executado por esta story (AC8).

### File List (Task 1 + 2 + 3 + 4)
- `supabase/migrations/20260713000000_swm31_unique_conversas_lead_origem.sql` (novo)
- `worker/meta_adapter_inbound.py` (modificado)
- `worker/tests/test_meta_adapter_inbound.py` (modificado — teste novo)
- `worker/tests/test_meta_adapter_outbound.py` (modificado — ajuste de regressão)
- `supabase/functions/motor-agente/index.ts` (modificado)
- `supabase/functions/motor-agente/index.audit.test.ts` (modificado — testes novos AC5/AC6/Task 4)

## QA Results

**Executor:** @qa Quinn · **Data:** 2026-07-13 · **Verdict: CONCERNS** (não-bloqueante — pode seguir pro @devops; itens abaixo são follow-up)

### Metodologia
Não validei em cima do relato do @dev — reproduzi de forma independente: (1) rodei as duas suítes eu mesma; (2) fiz **mutation testing** nos dois mecanismos centrais (Task 2 e Task 4): reintroduzi deliberadamente o código antigo/quebrado e confirmei que os testes novos FALHAM (prova de que não são vacuous); (3) isolei a baseline do `deno check` a partir do `git show HEAD` (commit anterior à story), não a partir do número reportado; (4) verifiquei o estado real do banco de produção (autorizado nesta sessão — ver nota de ambiente abaixo) via catálogo do Postgres, não só `list_migrations`.

### 7 Quality Checks

1. **Code review** — OK. Lógica dos 3 branches (unidadeSalva/aguardando/conversa_engajada/1ª-mensagem) é mutuamente exclusiva por construção (if/else-if), sem overlap. Upsert do worker corretamente omite `status` do payload (evita sobrescrever `encerrada`/`awaiting_human`). `decidirConversaEngajada` é desenho novo genuíno, não copiado — a divergência proposital de `decidirAguardandoUnidade` (perguntaGeralAtiva em vez de resposta canned) está documentada e é a decisão certa pro contexto de conversa já engajada.
2. **Unit tests** — OK, com prova de eficácia real (não só existência):
   - **Mutation test Task 2:** reverti `meta_adapter_inbound.py` pro select-então-insert antigo → `test_concorrencia_duas_chamadas_simultaneas_resolvem_mesma_conversa` **FALHOU** corretamente (`assert 0 == 2`, upsert nunca chamado). Restaurado, suíte volta a 129 passed.
   - **Mutation test Task 4 (3º branch):** desliguei a condição `metadataAtual.conversa_engajada === true` → 2 dos 3 testes handler-level do 3º branch **FALHARAM** corretamente. Restaurado, suíte volta a 100 passed.
   - **Mutation test Task 4 (ampliação Task 3):** removi só o `conversa_engajada: true` do branch `aguardando` → o teste específico da ampliação **FALHOU** corretamente (`Values are not equal: - false / + true`). Restaurado, suíte volta a 100 passed.
   - Confirmado independentemente: `pytest tests/` → **129 passed, 3 skipped, 0 failed**. `deno test --no-check` → **100 passed, 0 failed, 2 ignored**.
3. **Acceptance criteria** — AC1 (concorrência): coberto por teste + reforçado por constraint real no banco (ver Achado 2 abaixo — a proteção real vem de uma constraint que **já existia**, não da nova). AC2 (reabertura): não alterado por esta story, sem regressão nos testes existentes. AC3/AC4 (sem reset de saudação): mutation-testados, ver acima. AC5 (pedido_depende_unidade unificado): testado e mutation-consistente com `decidirPrimeiraMensagem`. AC6 (conversa_id): testado (presente → PK; ausente → fallback). AC7 (registro por Task): Dev Agent Record completo e granular por Task. AC8 (nenhum deploy): confirmado — nem worker nem motor-agente foram deployados nesta story (ver Achado 3).
4. **Regressão** — Nenhuma. Suítes completas rodadas antes/depois de cada mutation test, sempre voltando ao verde total.
5. **Performance** — Achado (ver #1 abaixo): índice duplicado em `conversas`.
6. **Segurança** — `get_advisors(security)` sem achados novos referenciando `conversas`. RLS confirmada intacta (`relrowsecurity=true`) — não alterada por esta migration, como esperado (só adiciona índice).
7. **Documentação** — Story bem documentada, Dev Agent Record rastreável por Task, ampliação de escopo registrada no Change Log.

### Achados (ranked)

**1. [MÉDIO] Índice duplicado em `conversas` — cleanup necessário.**
`get_advisors(performance)` acusa `duplicate_index` em `public.conversas`: a nova `conversas_lead_id_origem_id_unique` (desta story) é **idêntica** a uma constraint já existente, `conversas_lead_id_origem_id_key` (`UNIQUE (lead_id, origem_id)`, `contype='u'`, `convalidated=true` — constraint real, não só índice solto). Confirmado via `pg_constraint` e `pg_indexes`. Isso NÃO quebra o `upsert(on_conflict="lead_id,origem_id")` do worker — pela documentação do Postgres, o `ON CONFLICT` por lista de colunas infere **todos** os índices únicos que casam exatamente com essas colunas como "arbiter indexes"; ter mais de um é permitido, o conflito dispara o `DO UPDATE` normalmente por qualquer um deles. É só overhead (mais um índice pra manter em todo INSERT/UPDATE), não risco de correção. **Recomendação:** @dev decide qual manter — (a) manter a nova (rastreada em `supabase/migrations/`) e derrubar a antiga `_key` (que é órfã, ver achado 2), ou (b) o inverso. Follow-up, não bloqueia este gate.

**2. [MÉDIO] Causa Raiz A desta story é uma correção de diagnóstico — a constraint que ela "não encontrou" já existia há 1 semana.**
A constraint `conversas_lead_id_origem_id_key` não corresponde a nenhuma migration rastreada no repo nem no ledger do Supabase (`supabase_migrations.schema_migrations` — nenhuma entrada com `origem_id`+`unique` além da própria migration desta story) — ela existe só no banco vivo, sem arquivo fonte. Comparando os dumps binários em `backups/` (arquivo não versionado, mas presente no working dir): `cuca-PRODUCAO-backup-20260705-201702.dump` (05/07) ainda tem o nome antigo `conversas_lead_instancia_unique` (era `UNIQUE(lead_id, instancia_uazapi)`, do UAZAPI); `cuca-PRODUCAO-backup-20260706-120018.dump` (06/07) já tem `conversas_lead_id_origem_id_key`. Ou seja: **a constraint composta em `(lead_id, origem_id)` existe desde ~06/07/2026 — uma semana antes do incidente de 13/07 que motivou esta story.** Isso significa que o mecanismo descrito pela Causa Raiz A ("dois webhooks quase simultâneos... ambos inserem, gerando 2+ linhas") já era **impossível** no momento do incidente: a 2ª inserção concorrente já teria disparado erro de constraint (capturado pelo `except`, mensagem descartada), nunca criado uma linha duplicada. Também expliquei por que a investigação original não achou isso: `list_tables(verbose=true)` (a mesma tool usada na investigação) só expõe `primary_keys` e `foreign_key_constraints` — confirmei rodando a tool agora: nem `lead_id` nem `origem_id` aparecem com a tag `"unique"` nas `options` da coluna, porque essa tag só cobre unicidade de **coluna única**, não constraints compostas. Isso não é falha do investigador, é um ponto cego real da tool. **Conclusão prática:** a Causa Raiz B (reset de metadata em `decidirPrimeiraMensagem`/`decidirAguardandoUnidade`), essa sim confirmada por rastreamento direto de código e corrigida com rigor nas Tasks 3/4 (mutation-testado), já explica sozinha o sintoma 1 (saudações diferentes) sem precisar de nenhuma corrida de banco — 2 mensagens de cortesia em sequência, cada uma reavaliada do zero por `decidirPrimeiraMensagem`, já produz saudações diferentes. As Tasks 1/2 continuam sendo um endurecimento defensivo válido (upsert atômico é boa prática independente do motivo original), só a **narrativa** de causa raiz que precisa de correção — recomendo ajustar o texto de Causa Raiz A na story ou em doc de auditoria, pra não ficar registrado como fato o que na verdade não explicava o incidente.

**3. [BAIXO/INFO] `motor-agente` (Edge Function) e worker ainda não foram deployados com o código desta story.**
`list_edge_functions` mostra `motor-agente` na versão 33, `updated_at` = 2026-07-11T17:46:53Z — **2 dias antes** desta implementação. As mudanças de Task 3/4 em `index.ts` existem só no working tree local (não commitado, não pushado, não deployado). Idem pro worker (Task 2) — sem forma de verificar a versão rodando no EasyPanel por aqui, mas como nada foi commitado/pushado ainda, presumo que também está na versão antiga. **Isso não representa risco de janela intermediária**: como a constraint de unicidade já existia antes desta story (achado 2), a migration da Task 1 não mudou nenhum comportamento do código antigo em produção — ele já convivia com uma constraint idêntica. @devops precisa confirmar, no momento do PR/push: (a) redeploy do worker (`cuca-worker`, EasyPanel) e (b) `deploy_edge_function` do `motor-agente` — sem isso, o código desta story simplesmente não entra em produção mesmo após o merge.

**4. [INFO] Migration aplicada em produção, não em cuca-dev — dentro da política vigente.**
Confirmado: cuca-dev foi descontinuado como alvo de mudanças de banco (decisão do Junior, registrada em `.claude/rules/cuca-deploy-environments.md` nesta mesma sessão). Validei diretamente contra produção, read-only, conforme a regra atualizada. `list_migrations` confirma `swm31_unique_conversas_lead_origem` (versão `20260713195400`) aplicada; RLS de `conversas` intacta; 0 linhas afetadas negativamente (tabela tinha 4 conversas no momento da checagem, todas com `lead_id`/`origem_id` distintos).

**5. [INFO] `deno check`: 73 vs baseline 67 — confirmado independentemente, mesma causa raiz (S-WM-28).**
Isolei a baseline via `git show HEAD:.../index.ts` (commit imediatamente anterior a esta story) rodado num diretório separado: **67 erros**, idênticos em categoria (`TS18047`×17, `TS2339`×31, `TS2345`×16, `TS2353`×3). Versão atual: **73 erros**, mesmas 4 categorias, só mais instâncias (`TS18047`×20, `TS2339`×32, `TS2345`×18, `TS2353`×3 — sem mudança). `diff` das mensagens únicas confirma: as únicas 3 mensagens que mudam de contagem são as mesmas 3 já existentes (`'conversa' is possibly 'null'`, `Property 'id' does not exist on type 'never'`, `Argument of type '{ metadata: ... }' is not assignable to parameter of type 'never'`) — proporcional ao código novo que referencia `conversa`/`conversa.metadata`, mesma causa raiz não corrigida da S-WM-28 (`createClient` sem generics). Nenhuma categoria nova, nenhum erro de lógica.

### Por que CONCERNS e não PASS
Nada aqui bloqueia o merge — a implementação é correta, testada com rigor (inclusive mutation testing) e os mecanismos centrais (upsert atômico, unificação de `pedido_depende_unidade`, `conversa_engajada`) funcionam exatamente como desenhado. CONCERNS porque: (a) sobra um índice duplicado pra limpar, (b) a narrativa de causa raiz da story tem uma imprecisão factual que vale registrar/corrigir pra não virar "fato" mal-documentado no histórico do projeto, e (c) o deploy real (Edge Function + worker) ainda não aconteceu — @devops precisa fechar esse laço no push/PR.

### Recomendação de próximo passo
Pode seguir pro @devops (push em `feat/*`/`develop` conforme o fluxo normal, PR pra `main` com aprovação do Junior). @devops: confirmar redeploy do worker e `deploy_edge_function` do `motor-agente` como parte do fechamento — sem isso o código não entra em produção mesmo após o merge. Achados 1 e 2 ficam como follow-up (decisão do @dev/@po sobre qual índice manter e se vale ajustar o texto de causa raiz).
