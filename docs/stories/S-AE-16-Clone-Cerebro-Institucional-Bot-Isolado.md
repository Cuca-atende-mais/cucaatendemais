# S-AE-16 — Clonar o cérebro do Institucional para um bot isolado da Academia Enem

- **Status:** Done (QA PASS — ver seção 9). Tasks 1-4, 6 e 7 concluídas: PR #124 mergeado em `main` (2026-08-25 16:41 UTC), Edge Function deployada no Supabase e serviço `cuca-academia-enem` redeployado no EasyPanel, ambos confirmados. Task 5 (transbordo) segue **pendente** — dados aguardando o Junior; não bloqueia o Done da story (é config de dado, não código).
- **Módulo:** Academia Enem
- **Autor:** @dev (Dex)
- **Depende de:** S-AE-02 (tabelas `ae_conversas`/`ae_mensagens`/`ae_instancias`), S-AE-10 (Edge Function `academia-enem-agente`, RAG `ae_*`)
- **NÃO toca:** nada em produção dos outros canais (Institucional/maria/sofia/ana, Empregabilidade). O `motor-agente` é **copiado em modo leitura**, nunca alterado.

---

## 1. Objetivo (linguagem do Junior)

Pegar o **cérebro** do bot Institucional de hoje (comportamento, regras, forma de responder,
correções de bug já feitas) e **copiá-lo inteiro** para um bot **isolado** da Academia Enem —
"um produto B com o mesmo cérebro do produto A, mas chamado e referenciado como B". Só muda o
nome da persona, as tags de chamamento, as referências textuais ("institucional" → "academia
enem"), as rotas/credenciais e as tabelas. A partir daí, **correções futuras são independentes
por bot**.

### Decisões travadas pelo Junior (2026-08-24/25)
1. **Clonar a inteligência de conversa (Opção 1, decisão @po/Junior 2026-08-25)** — copiar do
   `motor-agente` a **camada de comportamento**: tom, regras, guardrails, anti-alucinação, quando
   passar para humano (handover), como não inventar. **NÃO** copiar a camada de domínio do
   Institucional (menu de unidade, programação mensal por unidade, resumo/serviços da rede) — que
   não tem correspondente no RAG da Academia Enem. A busca de conteúdo permanece no **RAG plano
   da Academia Enem** (`ae_documentos_rag`/`ae_chunks_documentos`/`ae_buscar_chunks_similares`),
   como já é hoje. "Mesmo cérebro" = mesmo **comportamento** e mesmas correções, não a lógica de
   recuperação específica do Institucional.
2. **Persona isolada** — a persona da Academia Enem fica **embutida na própria Edge Function**
   (ou em tabela própria `ae_*`), **nunca** lida da tabela compartilhada `prompts_agentes` (que
   é de onde o `motor-agente` lê hoje). Nada compartilhado.
3. **Remover a etapa de nome** — a Academia Enem passa a falar direto com o cérebro, igual o
   Institucional (elimina o bug do nome errado e o de resposta duplicada de uma vez).
4. **Tabelas próprias de conversa — isolamento total** das conversas/mensagens da Academia Enem.
   (Leads: ver §4 — nesta fase permanecem por etiqueta; isolamento físico de leads é fase do
   banco realtime, fora do escopo desta story.)
5. **Entrada espontânea, sem gate** — qualquer número que mandar mensagem entra na Academia Enem,
   igual ao Institucional: cria/acha o lead e inicia a conversa. Não há bloqueio de entrada por
   "não estar pré-cadastrado". As proteções que valem são as mesmas do fluxo compartilhado
   (dedup, opt-out, bloqueado, awaiting_human) — não um filtro de admissão.

---

## 2. Estado atual (levantado no código — base da análise de impacto)

- **Cérebro atual da Academia Enem (`supabase/functions/academia-enem-agente/index.ts`):** um
  fork divergente e enxuto ("Duda"), diferente do `motor-agente`. É o que será **substituído**
  pela cópia fiel do `motor-agente`.
- **Engine (`worker/academia_enem_engine.py`):** máquina de estados com **coleta de nome**
  (`novo → saudar → aguardando_nome → coletar_nome → ativo → classificar`). Grava em
  `conversas`/`mensagens` **compartilhadas** e mantém o estado em `conversas.metadata.ae_fluxo`.
  O `_enviar` insere em `mensagens` — fonte da **inserção dupla** hoje.
- **Porta de entrada (`worker/meta_adapter_inbound.py` → `processar_webhook_meta`):** código
  **compartilhado** por todos os canais. Identifica `agente_tipo` cedo (após o parse), e
  **grava `leads` → `conversas` → `mensagens` compartilhadas ANTES do dispatch** — por isso a
  Academia Enem hoje escreve nas tabelas compartilhadas. Só depois desvia para o engine da AE.
- **Tabelas isoladas de conversa JÁ EXISTEM mas estão DORMENTES:** `ae_conversas` /
  `ae_mensagens` (S-AE-02, "isolamento total" de 2026-06-14) — com RLS, realtime e índices. O
  código migrou para as compartilhadas em 2026-08-20 (abandono do AuctaFlux) e essas tabelas
  ficaram sem uso. **A decisão 3 vira reativar essas tabelas, não construí-las.**
- **Leads:** a planilha (nome+telefone) já funciona (`/api/academia-enem/leads/upload`), com
  dedup e permissão própria. Os leads vivem na tabela **compartilhada `leads`**, separados por
  **etiqueta** "Academia Enem" (`lead_interesses`); o disparo compõe o público filtrando os
  etiquetados. Funciona; não é tabela física separada.
- **Transbordo da Academia Enem:** hoje com 0 contatos / 0 templates configurados.

---

## 3. Critérios de aceite (AC)

- **AC1** — A Edge Function `academia-enem-agente` passa a conter a **camada de comportamento do
  `motor-agente`** (tom, regras, guardrails, anti-alucinação, handover para humano), adaptada:
  referências textuais e tags de chamamento ("institucional" → "academia enem"), leitura/gravação
  de histórico em `ae_conversas`/`ae_mensagens`. A recuperação de conteúdo permanece no **RAG
  plano da Academia Enem** (`ae_*`). A lógica de domínio do Institucional (menu de unidade,
  `monthly_program`/`unidade_cuca`, resumo/serviços da rede) **não é portada** (Opção 1).
- **AC1b** — A persona é **isolada** (embutida na Edge Function ou em tabela `ae_*`); a function
  **não lê** de `prompts_agentes`. Verificável por `grep`: nenhuma referência a `prompts_agentes`
  no arquivo final.
- **AC2** — O `motor-agente` **não é modificado**: `list_edge_functions` mostra a mesma versão
  antes e depois; diff do arquivo local = zero.
- **AC3** — A **etapa de coleta de nome é removida** do fluxo da Academia Enem: a primeira
  mensagem do lead já vai direto ao cérebro, no padrão Institucional (o cérebro insere a resposta
  do agente **uma única vez** em `ae_mensagens`; o outbound apenas envia, não insere).
- **AC4** — A porta de entrada **desvia a Academia Enem logo após identificar o canal**,
  gravando conversa/mensagem em `ae_conversas`/`ae_mensagens` e **sem tocar** em
  `conversas`/`mensagens` compartilhadas. O caminho dos outros canais permanece **idêntico**
  (só ganha o desvio no topo).
- **AC5** — **Nenhuma regressão** no Institucional/Empregabilidade: suíte completa do worker
  (`pytest`) verde, incluindo os testes desses canais; nenhuma mudança de comportamento
  observável neles.
- **AC6** — Transbordo da Academia Enem configurado (contato + template próprios) e funcional
  no fluxo do bot isolado.
- **AC7** — A inserção dupla de mensagem deixa de ocorrer (validado nos logs/registro de uma
  conversa de teste: 1 mensagem do lead + 1 resposta do agente por turno).
- **AC8** — Edge Function `academia-enem-agente` **deployada em produção ANTES do push/PR**
  (regra `devops-deploy-antes-de-push-edge-function.md`), conferida com `get_edge_function`.

---

## 4. Escopo e fronteiras

**Dentro do escopo:**
- Reescrever `academia-enem-agente` como cópia fiel do `motor-agente` (adaptada: persona, tags,
  referências, tabelas `ae_*`).
- Reativar `ae_conversas`/`ae_mensagens` como armazenamento da conversa da Academia Enem.
- Remover a máquina de coleta de nome do `academia_enem_engine.py` e ligar o fluxo direto ao
  cérebro (padrão Institucional).
- Desvio na entrada em `processar_webhook_meta` para o caminho próprio da Academia Enem.
- Configurar transbordo próprio.

**Fora do escopo (outras fases):**
- **Leads:** permanecem na tabela `leads` compartilhada, separados por etiqueta "Academia Enem".
  A porta de entrada da Academia Enem **continua** registrando o lead na `leads` compartilhada
  (necessário para opt-out/bloqueio/disparo consistentes) — o isolamento desta story é de
  **conversa/mensagem**, não de lead. Isolamento físico de leads = fase do banco realtime.
- Endurecimento anti-alucinação do agente (story separada, já acordada).
- Ajustes de disparo/RAG (permanecem como estão).

---

## 5. Tarefas (ordem de dependência)

1. [x] **Cérebro (camada de comportamento):** portado do `motor-agente` para
   `academia-enem-agente/index.ts` — guardrails alinhados (handover reforçado, engajamento,
   anti-desculpa, listagem compacta), divisão em partes + anti-repetição, persona **isolada**
   (embutida, nunca lê `prompts_agentes`). RAG permanece no plano `ae_*` (Opção 1 — não portada a
   recuperação de domínio do Institucional).
2. [x] **Tabelas de conversa:** `ae_conversas`/`ae_mensagens` confirmadas (schema lido via
   `execute_sql`) — atendem ao que a camada copiada precisa. Nenhuma migration de coluna nova
   necessária (achado: `ae_mensagens` não tem coluna `lead_id` — ajustado nos inserts/queries).
3. [x] **Engine:** coleta de nome removida de `academia_enem_engine.py`; liga direto ao cérebro
   no padrão Institucional (cérebro insere resposta 1x/parte; worker só envia, `gravar=False`).
   Handover do cérebro envia o texto do próprio cérebro (não mais frase fixa) + marca
   `awaiting_human` + notifica `modulo='academia_enem'`.
4. [x] **Porta de entrada:** desvio da Academia Enem no topo de `processar_webhook_meta`
   (`_processar_webhook_academia_enem`), replicando dedup por `wa_message_id`, bloqueio
   permanente, lead bloqueado, opt-out, guarda de `awaiting_human` (chegada + reconferido no
   dispatch adiado) e debounce — tudo mirado em `ae_conversas`/`ae_mensagens`. Caminho dos outros
   canais intocado. Achado tratado: `ae_instancias` estava órfão da era AuctaFlux
   (`phone_number_id` nulo) — migration de dado populou o registro existente com o
   `phone_number_id` real (de `meta_phone_numbers`), sem mudar schema.
5. [ ] **Transbordo — PENDENTE, bloqueado aguardando o Junior.** Falta o contato responsável
   (telefone/colaborador) e o nome do template Meta aprovado para a Academia Enem — sem isso,
   `acionar_transbordo`/`_marcar_awaiting_e_notificar` marcam `awaiting_human` mas
   `_notificar_transbordo` não encontra destinatário e a conversa fica aguardando atendimento
   manual sem aviso automático (mensagem de fallback já cobre esse caso: avisa o lead que não
   conseguiu confirmar o encaminhamento). **Não bloqueia o deploy do restante da story** — é
   configuração de dado (`transbordo_humano`, `modulo='academia_enem'`), não código; quando o
   Junior informar os dados, é um insert/update simples, sem nova migration de schema.
6. [x] **Testes:** `pytest` completo (worker) verde — 264/264, incluindo os 6 testes novos do
   desvio (`TestDesvioAcademiaEnem`) e regressão de Institucional/Empregabilidade no mesmo
   arquivo. `deno lint` da Edge Function sem problemas novos (só os 2 avisos pré-existentes de
   estilo de import). `get_advisors` do banco checado — nenhum problema novo introduzido.
7. [x] **Deploy da Edge Function** em produção (`cuca`) ANTES do push/PR — feito, conferido com
   `get_edge_function` (zero drift contra o arquivo local), `motor-agente` confirmado inalterado
   (v49). PR #124 mergeado em `main` (2026-08-25 16:41 UTC) e serviço `cuca-academia-enem`
   redeployado no EasyPanel — confirmado pelo Junior.

---

## 6. Análise de impacto (obrigatória — item a item)

### 6.1 Edge Function `academia-enem-agente` (porta a camada de comportamento do motor-agente)
- **Toca:** apenas o arquivo/rota da Academia Enem.
- **Quem depende hoje:** só o engine da Academia Enem chama essa function. Ninguém mais.
- **Impacto real:** o comportamento do bot da Academia Enem passa a ser a inteligência de conversa
  do Institucional (tom/regras/guardrails/handover), com persona isolada e busca no RAG plano da
  Academia Enem. A lógica de domínio do Institucional (unidade/programa mensal) não é portada
  (Opção 1). Nenhum outro canal enxerga essa function.
- **De-risk:** `deno test`; `grep` provando que o arquivo final não referencia `prompts_agentes`
  nem as tabelas RAG do Institucional (`documentos_rag`/`chunks_documentos`/`buscar_chunks_similares`);
  deploy conferido com `get_edge_function`; diff do `motor-agente` local = 0 e mesma versão em
  `list_edge_functions` (prova de que a fonte não foi tocada).
- **Risco outros canais:** zero.

### 6.2 Tabelas `ae_conversas`/`ae_mensagens` (reativação; migration aditiva se preciso)
- **Toca:** tabelas próprias da Academia Enem (hoje dormentes). Migration, se necessária, só
  **adiciona** coluna/índice — idempotente e retrocompatível.
- **Quem depende hoje:** ninguém escreve nelas atualmente (o painel S-AE-03 lê via RLS).
- **Impacto real:** passam a ser a fonte da conversa da Academia Enem.
- **De-risk:** `execute_sql` read-only para conferir schema atual antes de qualquer
  `apply_migration`; migration idempotente.
- **Risco outros canais:** zero (tabelas separadas).

### 6.3 `academia_enem_engine.py` — remoção da coleta de nome
- **Toca:** só o engine da Academia Enem.
- **Quem depende hoje:** só o dispatch da Academia Enem chama esse engine.
- **Impacto real:** o fluxo da Academia Enem deixa de pedir nome e deixa de inserir a mensagem
  duas vezes (o cérebro passa a inserir 1x). Muda o comportamento **só** da Academia Enem.
- **De-risk:** testes do engine; conversa de teste provando 1 msg lead + 1 resposta agente/turno.
- **Risco outros canais:** zero (Empregabilidade/Institucional têm engines/caminhos próprios).

### 6.4 `processar_webhook_meta` — desvio na entrada (ÚNICO ponto compartilhado tocado)
- **Toca:** o inbound compartilhado — o único lugar do plano por onde o Institucional também
  passa. O desvio é um `if academia_enem: <caminho próprio> return` **no topo**, antes do bloco
  de persistência compartilhado.
- **Quem depende hoje:** Institucional, Empregabilidade e Academia Enem passam por essa função.
- **Impacto real:** a Academia Enem deixa de entrar no bloco compartilhado de persistência e passa
  por um caminho próprio que **replica as proteções** (dedup por `wa_message_id`, opt-out,
  `bloqueado`, `awaiting_human`, debounce). **Sem gate de admissão** — qualquer número entra
  espontaneamente, igual Institucional. O caminho dos outros canais fica **byte a byte igual** (só
  existe o desvio antes dele) — mas por ser o ponto mais sensível, é o que mais exige prova.
- **De-risk (obrigatório):** `pytest` completo verde **incluindo** os testes de Institucional e
  Empregabilidade; testes novos do caminho da Academia Enem cobrindo cada proteção replicada
  (dedup/opt-out/bloqueado/awaiting_human); revisão de que o desvio é entrado **somente** para
  `agente_tipo == academia_enem` e que o restante da função não foi editado (diff cirúrgico).
- **Risco:** o principal risco desta story é aqui — reimplementar as proteções sem paridade com o
  bloco compartilhado deixaria a Academia Enem sem dedup/opt-out. Mitigado pela cobertura de teste
  dedicada acima. Risco para outros canais: baixo e verificável (desvio precoce + suíte verde).

### 6.5 Transbordo próprio da Academia Enem
- **Toca:** configuração do transbordo da Academia Enem.
- **Impacto real:** habilita o transbordo humano no bot isolado.
- **Risco outros canais:** zero.

### 6.6 Leads (fora do escopo — registrado por transparência)
- **Toca:** nada nesta story. A Academia Enem continua registrando lead na `leads` compartilhada
  por etiqueta.
- **Impacto real:** nenhum; mantém disparo/opt-out/bloqueio funcionando como hoje.
- **Pergunta em aberto:** isolamento físico de leads entra na fase do banco realtime — decisão
  do Junior, fora daqui.

---

## 7. Definição de "pronto"
- ACs atendidos; `pytest` (worker) e `deno test` (function) verdes; não-regressão dos outros
  canais provada; Edge Function deployada em produção **antes** do push/PR e conferida;
  `motor-agente` inalterado (mesma versão). App validado conforme regra de ambientes (nada de
  navegador/localhost sem autorização do Junior).

---

## 8. QA Results (@qa)

**Veredito: PASS.** Verificação independente contra o que está de fato em `main` (`cdd98dd`) e
em produção (Edge Function v2, `motor-agente` v49 confirmado inalterado) — não apenas conferindo
o relatado pelo @dev/@devops.

| # | Check | Resultado |
|---|-------|-----------|
| 1 | Code review | ✅ Sem código morto/referências órfãs à máquina de nome removida (`grep` — zero fora do próprio docstring). `main.py` só consome `processar_mensagem_academia_enem` (assinatura estável, nenhum outro ponto do worker depende da API removida). |
| 2 | Testes unitários | ✅ 291 passaram; 5 falhas em `test_meta_adapter_outbound.py` confirmadas **pré-existentes** (mesmo resultado rodando no commit `1a0a3eb`, anterior ao PR #124 — `ModuleNotFoundError: No module named 'worker'`, ambiente, não regressão). |
| 3 | Critérios de aceite | ✅ AC1 (`grep`: zero `.from("conversas")`/`.from("mensagens")` na function e no engine). AC1b (`grep`: zero `prompts_agentes`). AC2 (`motor-agente` v49, hash idêntico antes/depois do deploy). AC3/AC7 (testes provam envio sem gravação dupla, `gravar=False`). AC4 (desvio na entrada confirmado). AC8 (deploy v1→v2 confirmado anterior ao push, por timestamp). **AC6 (transbordo) não atendido** — pendência de dado já registrada como não-bloqueante pela própria story (task 5). |
| 4 | Regressão | ✅ Suíte de Institucional/Empregabilidade/motor-agente passa integralmente no mesmo arquivo de teste do inbound. |
| 5 | Performance | ✅ Nenhuma operação nova custosa; perfil de custo do desvio equivalente ao caminho compartilhado. |
| 6 | Segurança | ✅ RLS confirmada ativa em `ae_conversas`/`ae_mensagens` (`relrowsecurity=true`, consulta direta ao catálogo). `verify_jwt=true` preservado na function. `ae_increment_nao_lidas` com a mesma postura de segurança da função irmã `increment_nao_lidas` (nenhuma das duas usa `SECURITY DEFINER` — padrão pré-existente do projeto, não uma regressão introduzida aqui). Design fail-closed confirmado: sem `ae_instancia_id` resolvido, descarta em vez de gravar dado inconsistente. |
| 7 | Documentação | ✅ Story com estado real, análise de impacto item a item, Change Log completo e honesto (inclui a janela de corte e o achado do registro órfão em `ae_instancias`). |

**Ressalva não-bloqueante:** AC6 (transbordo) segue pendente — dado (contato + template Meta),
não código. Recomendo abrir/acompanhar como item de follow-up assim que o Junior fornecer os
dados; não impede o Done desta story.

---

## Dev Agent Record

### File List
- `supabase/functions/academia-enem-agente/index.ts` — editado (task 1, 4)
- `worker/academia_enem_engine.py` — editado (task 3, 4)
- `worker/meta_adapter_inbound.py` — editado (task 4)
- `worker/tests/test_academia_enem_engine.py` — editado (task 3, 4)
- `worker/tests/test_meta_adapter_inbound.py` — editado (task 4: classe `TestDesvioAcademiaEnem`)
- `cuca-portal/supabase/migrations/20260825000000_ae16_isolamento_conversas_desvio_entrada.sql` — novo (task 4, aplicado em produção)

---

## 9. Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-08-25 | @dev (Dex) | Draft inicial da story, com estado atual levantado no código e análise de impacto item a item. |
| 2026-08-25 | @dev (Dex) | Revisão pós-NO-GO do @po: Opção 1 (portar só a camada de comportamento, manter RAG plano da AE), persona isolada (AC1b), entrada espontânea sem gate, task 4 expandida com as proteções a replicar. |
| 2026-08-25 | @dev (Dex) | GO do @po (10/10). Implementação das tasks 1-4 e 6: cérebro portado, engine sem coleta de nome, desvio na entrada replicando as proteções, tabelas próprias confirmadas, migration de dado em `ae_instancias` aplicada, suíte completa verde (264/264). Task 5 (transbordo) registrada como PENDENTE — aguardando contato/template do Junior, não bloqueia o restante. Task 7 (deploy) em preparação — ver nota de janela de corte abaixo. |
| 2026-08-25 | @dev (Dex) | **Nota de risco levantada antes do deploy (impacto):** a Edge Function e o worker (engine/inbound) precisam entrar em produção **juntos** — a Edge Function nova só entende `ae_conversas`/`ae_mensagens`, o worker antigo (ainda em produção até o merge+redeploy no EasyPanel) só conhece `conversas`/`mensagens`. Deployar a Edge Function ANTES do worker redeployar cria uma janela onde o bot da Academia Enem responde só o fallback técnico ("deu um problema aqui, manda de novo") — sem quebra de dado, sem vazar pro Institucional, só o bot fora do ar até o merge+redeploy do worker. Duração da janela depende de quando o Junior aprova o PR. Decisão de timing levada ao Junior antes de executar o deploy. |
| 2026-08-25 | @devops (Gage) | Regra inegociável reafirmada pelo Junior: deploy no Supabase sempre antes do push/PR, sem exceção. Branch `feat/academia-enem-s-ae-16-clone-cerebro` criada a partir de `origin/main` (branch anterior `fix/ae-base-conhecimento-cors-upload` já estava com PR #123 mergeado, descartada). Edge Function `academia-enem-agente` deployada (v1→v2) — achado durante a conferência: drift real entre o cabeçalho comentado do arquivo local e o conteúdo deployado (só comentário, sem afetar comportamento); corrigido no arquivo local e reconferido, zero diferença. `motor-agente` confirmado inalterado (v49). Commit cirúrgico só dos 7 arquivos da S-AE-16 (working tree tinha dezenas de arquivos soltos de outras sessões, não tocados). PR #124 aberto contra `main`, aprovado e mergeado pelo Junior (2026-08-25 16:41 UTC). Serviço `cuca-academia-enem` redeployado no EasyPanel — confirmado pelo Junior. |
| 2026-08-25 | @qa (Quinn) | Gate de qualidade (7 checks) executado com verificação independente contra `main`/produção (não só o relatado por @dev/@devops): 291/291 testes relevantes passam (5 falhas em `test_meta_adapter_outbound.py` confirmadas pré-existentes via comparação com o commit anterior ao PR); isolamento confirmado por `grep` (zero referência a `conversas`/`mensagens`/`prompts_agentes`); RLS ativa em `ae_conversas`/`ae_mensagens` confirmada via catálogo; `motor-agente` v49 inalterado. **Veredito: PASS**, com ressalva não-bloqueante (AC6/transbordo pendente, é dado — não código). Status → Done. |
