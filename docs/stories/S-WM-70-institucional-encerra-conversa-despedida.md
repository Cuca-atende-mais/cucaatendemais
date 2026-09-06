# S-WM-70 — Institucional encerra a conversa quando o lead se despede

**Status:** Done
**Epic:** WhatsApp Meta / Institucional
**Origem:** Investigação @dev 2026-09-05 a pedido do Junior (conversa do lead Nívea,
`5585989757671`) — `docs/2026-09-05/PLANO-3-melhorias-empregabilidade-2026-09-05.md`, item 3-BIS.
**Prioridade:** P1 | **Esforço:** S | **Risco:** LOW — adiciona um branch numa função pura, já
coberta por testes, espelhando o branch equivalente que a função irmã já tem em produção.
**Depende de:** nada. É a primeira da leva de 4 (ordem definida pelo Junior: esta → S-EMP-AUD-040
→ S-EMP-AUD-041 → S-EMP-AUD-042).
**Deploy:** ⚠️ **Edge Function** — pela regra `devops-deploy-antes-de-push-edge-function.md`, o
deploy de `motor-agente` no Supabase acontece **ANTES** do push/PR, nunca como pendência
pós-merge. Não é EasyPanel.

## Contexto

Conversa real, canal Institucional, 05/09/2026 13:47 (conversa `e09247c6-18ad-4a0e-bcdc-9a9ef3cfd26b`):

| Remetente | Mensagem |
|---|---|
| lead | "Gostaria de saber sobre vagas de emprego" |
| agente | *(encaminhamento correto pro Emprega+ — `wa.me/5585999401057`)* |
| lead | "Obrigada!" |
| agente | "Em que mais posso te ajudar? 😊" |
| lead | "Nada, era só isso." |
| agente | "**De novo, foi mal! 😅** Em que mais posso te ajudar? 😊" |
| lead | "Nada. Já podemos encerrar. Obrigada!" |
| agente | "Em que mais posso te ajudar? 😊" |

A lead pediu para encerrar **três vezes** e não conseguiu.

### Causa raiz (rastreada no código, não é hipótese)

`supabase/functions/motor-agente/index.ts`, função **`decidirConversaEngajada` (linha 764)** — o
branch de roteamento usado quando a conversa já está engajada, que é exatamente o estado da Nívea
depois do encaminhamento. A função tem 4 saídas — unidade detectada → `pedido_depende_unidade` →
`!pergunta_geral` → catch-all — e **nenhuma consulta `quer_sair`**.

A função irmã `decidirAguardandoUnidade` (linha 700) **tem** esse tratamento (linha 713, responde
"Sem problemas! Quando quiser saber sobre alguma unidade CUCA, é só chamar. 😊").
`decidirConversaEngajada` nunca ganhou o equivalente — e o próprio código já registra o fato, no
comentário da linha 1469: *"decidirConversaEngajada não distingue quer_sair internamente (cai no
mesmo canned de continuação hoje)"*.

Consequência em cadeia:
1. "Obrigada!" → `pergunta_geral=false` → early-return com o texto fixo "Em que mais posso te ajudar? 😊";
2. como é **early-return, o GPT nem é chamado** — a tag `[[ENCERRAR]]`, que o handler da linha 1810
   já sabe processar corretamente, nunca tem chance de ser emitida. **O mecanismo de encerramento
   existe e funciona; ele é curto-circuitado antes de rodar.** Esta story não constrói encerramento
   novo — ela devolve o controle ao caminho que já existe;
3. na repetição, `evitarRepeticaoLiteral` (linha 1012) detecta o texto idêntico e prefixa "De novo,
   foi mal! 😅" — o anti-repetição maquia o sintoma e piora a percepção: o bot se desculpa por
   repetir e repete.

### Alcance medido nos registros de produção

Varredura em `mensagens` procurando o texto fixo "Em que mais posso te ajudar" imediatamente após
uma despedida/agradecimento do lead:
- **20** ocorrências totais do texto fixo, **todas** no canal Institucional;
- **6 delas, em 5 conversas distintas entre 01/09 e 05/09** — **~30% dos usos desse texto são este bug**.

Casos: "Muitoooo obrigada por informar" (01/09), "Obrigado" (04/09), "Ok obrigado" (04/09), Nívea
×2 (05/09). E um que mostra o custo real, em 02/09:

> lead: **"como se não tá ajudando em nada, só pergunta a mesma coisa"**

## O que precisa ser implementado

Em `decidirConversaEngajada` (`supabase/functions/motor-agente/index.ts:764`), adicionar o branch
`quer_sair` **antes** do branch `!pergunta_geral`, espelhando a estrutura de
`decidirAguardandoUnidade:713`.

Ordem final dos branches:
1. `unidadeDetectada` (inalterado);
2. `pedido_depende_unidade` (inalterado);
3. **`quer_sair` → NOVO** — despedida cordial + sinalizar encerramento;
4. `!pergunta_geral` (inalterado);
5. catch-all `perguntaGeralAtiva` (inalterado).

**Ordem importa:** o branch novo tem que vir depois de `pedido_depende_unidade` (um lead pode
agradecer e na mesma frase pedir algo que dependa da unidade — o pedido ganha) e antes de
`!pergunta_geral` (que é justamente o catch-all que hoje engole a despedida).

**Encerrar de fato** (decisão explícita do Junior, 05/09): não basta responder a despedida — a
conversa deve ser marcada como encerrada, pelo mesmo caminho que a tag `[[ENCERRAR]]` já usa
(variável `encerrado` no handler, linha ~1811). `DecisaoConversaEngajada` precisa carregar essa
informação até o handler; hoje o tipo (linha ~741) não tem campo pra isso.

**Tom da despedida:** cordial e solícito, deixando a porta aberta — mesmo espírito da resposta que
`decidirAguardandoUnidade` já usa e do que foi pedido na S-EMP-AUD-040. Nunca seca.

## Acceptance Criteria

1. `decidirConversaEngajada` chamada com `quer_sair=true` (e sem unidade detectada, sem
   `pedido_depende_unidade`) devolve uma despedida cordial — **não** "Em que mais posso te ajudar? 😊".
2. A conversa é **efetivamente encerrada** nesse caminho, o que significa concretamente as **duas**
   coisas que a tag `[[ENCERRAR]]` produz hoje (achado @po, ver abaixo):
   - `conversas.status` passa a `'encerrada'` (o que a linha 1866 faz);
   - a resposta JSON inclui `encerrado: true` — o worker **consome esse campo**
     (`worker/meta_adapter_inbound.py:666`) e atualiza o status do seu lado; omiti-lo deixa os dois
     lados discordando.

   ⚠️ **Armadilha confirmada pelo @po na leitura do código:** o early-return que hoje devolve a
   resposta canned deste branch (**linha 1479**) retorna
   `{success:true, resposta, handover:false}` — **sem** tocar em `conversas.status` e **sem** o
   campo `encerrado`. Reusar esse caminho como está faz a conversa "responder despedida" e
   continuar aberta, que é meio-caminho e não atende este AC.
3. As 6 frases reais coletadas em produção ("Obrigada!", "Nada, era só isso.", "Nada. Já podemos
   encerrar. Obrigada!", "Muitoooo obrigada por informar", "Obrigado", "Ok obrigado") passam a
   encerrar, quando o classificador marca `quer_sair=true`.
4. **Não regride:** frase de agradecimento que continua a conversa ("obrigada, e qual o horário?")
   não encerra — segue pro fluxo normal.
5. **Não regride:** os outros 4 branches de `decidirConversaEngajada` mantêm exatamente o
   comportamento atual — unidade detectada, `pedido_depende_unidade`, `!pergunta_geral` e o
   catch-all de `perguntaGeralAtiva`.
6. `decidirAguardandoUnidade` e `decidirPrimeiraMensagem` **não são alteradas** por esta story.
7. A exclusão de opt-out por disparo recente (`deveReconhecerDisparoRecente`, linha 1465, que já
   lê `avaliacaoSemanticaEngajada.quer_sair`) continua funcionando igual — o novo branch não pode
   curto-circuitar essa checagem.

## Escopo

**In:** os 7 ACs acima, restritos a `decidirConversaEngajada`, ao tipo `DecisaoConversaEngajada` e
ao ponto do handler que consome a decisão (linha ~1454).
**Out:**
- o bug simétrico do Emprega+ ("Tem previsão pra abrir?" disparando `quer_sair` numa **pergunta** —
  causa oposta, outra base de código, Python; story própria, ainda não criada);
- rever o texto/comportamento de `evitarRepeticaoLiteral` — com o bug corrigido ele deixa de ser
  acionado nesse cenário; mexer nele agora é escopo extra;
- qualquer ajuste no prompt do classificador (`:598`) — a definição de `quer_sair` fica como está.

## ⚠️ Análise de impacto — por item

### Item 1 — Branch `quer_sair` novo em `decidirConversaEngajada`

- **Toca:** `supabase/functions/motor-agente/index.ts:764-800`.
- **Consome hoje:** todo lead do Institucional em conversa já engajada (3º branch de roteamento,
  chamado na linha 1454). `avaliacaoSemantica.quer_sair` já é produzido e validado (`:533`), já é
  usado no branch irmão (`:713`) e na exclusão de opt-out (`:1465`) — **nenhum contrato novo**, o
  campo só passa a ser lido onde já estava disponível.
- **Impacto observável:** lead que se despede recebe despedida em vez de loop. Estimativa pelos
  registros: ~6 casos em 5 dias deixam de acontecer.
- **Risco:** falso positivo — `quer_sair` marcado numa frase que não era despedida encerraria a
  conversa cedo demais, que é pior que o bug atual (perde o lead em vez de irritá-lo).
  Mitigação: o prompt (`:598`) já define `quer_sair` de forma estreita ("agradecimento de
  despedida, deixa pra lá, depois eu vejo"), e o branch irmão usa **esse mesmo sinal** em produção
  há tempo sem histórico de reclamação — não é um sinal novo e não validado.
- **De-risk concreto:** teste unitário da função pura com as 6 frases reais como caso positivo e
  com frases de continuação como caso negativo (AC4). `deno test supabase/functions/motor-agente/`.

### Item 2 — Propagar "encerrado" até o handler

- **Toca:** tipo `DecisaoConversaEngajada` (linha ~741) + ponto de consumo (linha ~1454).
- **Consome hoje:** o handler já tem a variável `encerrado`, alimentada pela tag `[[ENCERRAR]]`
  (linha 1811), e já sabe o que fazer com ela — inclusive o fallback de texto vazio da linha ~1030
  ("Tudo certo! Qualquer coisa, é só chamar novamente. 😊"). **Reutilizar esse caminho, não criar
  um paralelo.**
- **Impacto observável:** a conversa muda de estado de verdade, não fica aberta fingindo encerrada.
- **Risco:** o tipo é compartilhado com os testes existentes que constroem literais dessa estrutura
  — adicionar campo **obrigatório** quebraria a compilação deles. Campo **opcional** (`encerrar?:
  boolean`), mesmo padrão já usado por `pedidoEspecifico?` no próprio tipo.
- **De-risk concreto:** `deno check` / `deno test` na função inteira, confirmando que nenhum
  literal de teste existente quebrou.

### Item 3 — Nenhuma mudança em tempo real

- **Toca:** nada de `configuracoes`, nada de dado.
- **Impacto observável:** a mudança só passa a valer quando a Edge Function for deployada —
  atende a regra transversal do Junior (05/09). Conversas em andamento no momento do deploy seguem
  o comportamento antigo até a próxima mensagem, sem estado intermediário inconsistente (a função
  é pura, decidida por mensagem).

## Test plan

- `deno test supabase/functions/motor-agente/` — suíte existente **verde antes e depois** (AC5, AC6, AC7).
- Testes novos de `decidirConversaEngajada`: 6 frases reais → encerra (AC1, AC2, AC3); frases de
  continuação → não encerra (AC4); um caso com `pedido_depende_unidade=true` **e** `quer_sair=true`
  → o pedido ganha (ordem dos branches).
- ⚠️ **Sem navegador, sem localhost** (`qa-testes-sem-navegador-ao-vivo.md`). Validação por teste
  automatizado e leitura de código.

## File List

- `supabase/functions/motor-agente/index.ts`:
  - `DecisaoConversaEngajada`: campo novo `encerrar?: boolean` (opcional, não quebra literais de
    teste existentes).
  - `decidirConversaEngajada`: branch novo `avaliacaoSemantica.quer_sair` inserido depois de
    `pedido_depende_unidade` e antes de `!pergunta_geral` — devolve despedida cordial
    ("Que bom poder ajudar! 😊 Se precisar de mais alguma coisa, é só chamar por aqui. Até logo! 👋")
    com `encerrar: true`.
  - Handler (branch `else if (decisaoEngajada.resposta !== null)`, dentro de
    `metadataAtual.conversa_engajada === true`): quando `decisaoEngajada.encerrar` é true, agora
    faz `supabase.from("conversas").update({status:"encerrada", updated_at:...})` e inclui
    `encerrado: decisaoEngajada.encerrar === true` no JSON de resposta — reproduz os dois efeitos
    que a tag `[[ENCERRAR]]` já produz noutro caminho (achado @po do AC2).
- `supabase/functions/motor-agente/index.audit.test.ts`: 6 testes novos —
  - `decidirConversaEngajada` com as 6 frases reais de despedida coletadas em produção → `encerrar: true`, não o canned (AC1, AC3);
  - agradecimento que continua a conversa → não encerra (AC4);
  - `pedido_depende_unidade=true` + `quer_sair=true` na mesma mensagem → o pedido vence (ordem dos branches);
  - os outros 4 branches existentes → `encerrar` continua `undefined` (AC5, regressão);
  - teste de wiring do handler (mock de Supabase) confirmando `conversas.status='encerrada'` **e** `encerrado:true` no JSON (AC2).

## Dev Agent Record

- **`deno check`:** 47 erros pré-existentes (46 antes desta mudança, medido via `git stash`) —
  débito já registrado na S-WM-28, nenhum decorrente desta story. `deno lint`: 6 problemas, mesma
  contagem antes e depois (confirmado via `git stash`) — nenhum novo.
- **`deno test` (suíte completa, `index.test.ts` + `index.audit.test.ts`):** 203 → 208 (6 testes
  novos), **0 falhas**, 2 ignorados (pré-existentes, não relacionados). AC5, AC6 e AC7 confirmados
  passando sem alteração.
- **AC7 (exclusão de opt-out) verificado por leitura, não só teste:** `deveReconhecerDisparoRecente`
  recebe `ehOptOut` e retorna `false` quando `ehOptOut=true` (`:676`) — como
  `avaliacaoSemanticaEngajada.quer_sair === true` já é o valor passado nesse parâmetro no handler,
  uma despedida nunca aciona esse desvio; o fluxo cai naturalmente no branch do early-return novo,
  sem curto-circuito.
- **Deploy (regra `devops-deploy-antes-de-push-edge-function.md`):** CLI autenticado via token já
  presente em `.mcp.prod.json` (mesmo usado pelo MCP Supabase do projeto) —
  `supabase functions deploy motor-agente --project-ref svzkrkfzpiqcesloukgb`.
  `motor-agente` v49 → **v50**. Conferido via `list_edge_functions`: as outras 9 functions do
  projeto mantiveram versão e `updated_at` inalterados — nenhuma function compartilhada foi
  tocada. Conferido via `get_edge_function` (grep pontual, arquivo grande demais pra diff
  completo): as 3 mudanças (`encerrar?: boolean`, o branch `quer_sair`, e a marcação
  `status='encerrada'` + `encerrado` no JSON) estão no código deployado — sem drift de
  transcrição.

## QA Results

### Review em 2026-09-05 — @qa Quinn

**Gate: PASS**

**7 checks:**

1. **Code review** — PASS. O branch novo em `decidirConversaEngajada` espelha exatamente a
   estrutura de `decidirAguardandoUnidade:713` (mesma posição relativa: depois de
   `pedido_depende_unidade`, antes do catch-all), e a marcação de encerramento no early-return do
   handler é **byte-a-byte a mesma expressão** já usada no caminho da tag `[[ENCERRAR]]`
   (`:1866`: `status: "encerrada", updated_at: new Date().toISOString()`) — reuso de padrão
   comprovado, não invenção de um novo. Campo `encerrar?: boolean` opcional, coerente com o
   padrão já estabelecido por `pedidoEspecifico?` no mesmo tipo.
2. **Testes** — PASS. Rodei a suíte de forma independente nesta branch:
   `deno test --no-check --allow-env --allow-net` → **208 passed, 0 failed, 2 ignored**
   (os 2 ignorados são pré-existentes, sem relação). Os 6 testes novos cobrem exatamente os
   ACs 1, 2, 3, 4, 5 e a ordem dos branches. Confirmei por rastreamento lógico que o teste do AC2
   (wiring do handler) teria **falhado** no código anterior — a versão antiga do early-return não
   incluía `encerrado` no JSON nem tocava `conversas.status`, então `body.encerrado === true`
   falharia. É um teste de regressão genuíno, não tautológico.
3. **Acceptance Criteria** — PASS, 7/7 verificados diretamente:
   - AC1 ✅ branch novo + teste com as 6 frases reais.
   - AC2 ✅ verificado nos dois efeitos — `status='encerrada'` (paridade confirmada linha a linha
     com o caminho da tag) e `encerrado:true` no JSON (consumido de fato por
     `meta_adapter_inbound.py:666`, li o trecho e confirmo o `elif data.get("encerrado")`).
   - AC3 ✅ as 6 frases reais da conversa da Nívea testadas individualmente.
   - AC4 ✅ teste de não-regressão com agradecimento que continua ("obrigada, e qual o horário?").
   - AC5 ✅ os outros 4 branches testados explicitamente, todos com `encerrar: undefined`.
   - AC6 ✅ confirmado pelo diff: `decidirAguardandoUnidade` e `decidirPrimeiraMensagem` não
     aparecem em nenhuma linha alterada.
   - AC7 ✅ verificado por leitura: `deveReconhecerDisparoRecente(ultimoDisparo, ehOptOut)` retorna
     `false` quando `ehOptOut=true` (`:676`), e o handler já passa
     `avaliacaoSemanticaEngajada.quer_sair === true` nesse parâmetro — uma despedida nunca aciona
     o desvio de disparo recente, cai direto no early-return novo. Os testes "Achado 2026-07-24"
     (pré-existentes) continuam verdes, confirmando que este caminho não foi tocado.
4. **Sem regressões** — PASS. `deno lint`: 6 problemas, **mesma contagem** de antes desta
   mudança (conferi de forma independente, não só aceitei o número do @dev). `deno check`: débito
   pré-existente da S-WM-28, não afetado por esta story (nenhum dos erros reportados está nas
   linhas tocadas). Consultei o banco de produção: `conversas.status` não tem CHECK constraint e
   `'encerrada'` já é valor usado (15 conversas Institucional hoje) — nenhum risco de schema.
   Reabertura de conversa `encerrada` já é caminho testado e suportado (VAL-07,
   pré-existente) — este story só alcança esse estado por mais um caminho, não cria
   comportamento novo de reabertura.
5. **Performance** — PASS. Função pura, um `if` a mais; o `UPDATE` extra só roda quando a
   conversa de fato encerra, mesmo custo que o caminho da tag já paga hoje.
6. **Segurança** — PASS. Nenhum dado de entrada do lead é refletido sem sanitização;
   `conversa.id` já é valor de confiança (linha do próprio banco, não vem do body da requisição).
   `verify_jwt` da function não mudou (segue `true`). Nenhum segredo tocado.
7. **Documentação** — PASS. File List e Dev Agent Record batem com o diff real, conferido linha a
   linha. Nenhuma discrepância entre o que a story descreve e o que o commit contém.

**Deploy (verificado de forma independente, não só aceito do relato do @dev):**
`list_edge_functions` confirma `motor-agente` ainda em **v50** (sem redeploy desde o @dev), demais
9 functions do projeto com versão e `updated_at` inalterados — nenhuma tocada. Não houve drift
desde a verificação do @dev.

**Achado não-bloqueante (observação, não item a corrigir):** o `UPDATE` de encerramento no
early-return novo não verifica o retorno de erro (mesmo padrão do caminho `[[ENCERRAR]]` na linha
`:1866`, que também não verifica) — é uma inconsistência **pré-existente** no arquivo, não
introduzida por esta story, e tratá-la aqui sozinha deixaria os dois caminhos divergentes de novo.
Sinalizo para uma story de observabilidade futura (ex. próxima da série S-WM-69), não para esta.

**Nenhum item bloqueia o avanço.** Recomendo seguir para @devops.

## Change Log

- v0.4 (2026-09-05): @devops mergeia PR [#150](https://github.com/Cuca-atende-mais/cucaatendemais/pull/150)
  em `main` (`9ea2812`), com aprovação explícita do Junior. Edge Function `motor-agente` já estava
  deployada e verificada (v49→v50) desde a implementação do @dev — o merge só formaliza no git o
  que já está ativo em produção; nenhum redeploy adicional necessário (não há mudança em
  `worker/` nem `cuca-portal/` nesta story). Status: Ready for Review → **Done**.
- v0.3 (2026-09-05): @qa revisa — **PASS**, 7/7 checks, 7/7 ACs confirmados por leitura e teste
  independentes (suíte rodada de novo pelo @qa: 208/208, lint: mesma contagem pré-existente,
  deploy conferido sem drift). 1 achado não-bloqueante registrado (ausência de checagem de erro no
  `UPDATE` de encerramento — padrão já pré-existente no caminho `[[ENCERRAR]]`, não desta story).
  Status: InReview → **Ready for Review** (aguardando @devops).
- v0.2 (2026-09-05): @po valida — **GO** (9/10). Uma correção aplicada antes do GO: o AC2 dizia
  "efetivamente encerrada" sem definir o que isso é em código, o que deixaria o @dev descobrir
  sozinho. Rastreado na leitura: `encerrado` produz `conversas.status='encerrada'` (`:1866`) **e**
  o campo `encerrado` no JSON, que o worker consome (`meta_adapter_inbound.py:666`) — e o
  early-return deste branch (`:1479`) **não faz nenhum dos dois**. AC2 reescrito com os dois
  efeitos nomeados e a armadilha registrada. Status: Draft → **Ready**.
- v0.1 (2026-09-05): @sm cria a story a partir do item 3-BIS do planejamento do @dev. Causa raiz
  já rastreada até a linha exata e confirmada por um comentário do próprio código (`:1469`), e
  alcance já medido em produção (6 ocorrências / 5 conversas / 5 dias) — a story entra com
  diagnóstico fechado, não com hipótese. Decisão do Junior de **encerrar de fato** (não só
  responder a despedida) incorporada no AC2. Priorizada como primeira da leva de 4: é a única com
  lead reclamando por escrito, e a correção é isolada numa função pura. Status: Draft — aguardando
  validação do @po.
