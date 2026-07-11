# S-WM-22 — TOM-03b: respostas longas em múltiplas mensagens WhatsApp

## Status
Ready for Review (validação manual em staging pendente — ver Dev Agent Record)

## Complexidade
**L** (grande) — atravessa 2 sistemas (Deno `motor-agente` + worker Python), muda o contrato entre eles, tem um requisito de integridade não-óbvio (1 linha em `mensagens` por parte efetivamente enviada) e precisa de decisão explícita de comportamento em falha parcial. Maior risco/esforço dos itens desta leva, confirmado pelo Junior e pela investigação de código.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - deno test --no-check --allow-env --allow-read --allow-net . (dentro de supabase/functions/motor-agente/) → contrato novo testado (deno)
  - pytest worker/tests/ → dispatch de múltiplas mensagens testado (pytest), sem regressão no baseline vigente
  - deno check supabase/functions/motor-agente/index.ts → sem erros de tipo
  - inspeção manual: para uma resposta longa/listável real (ex.: 5+ cursos com dia/horário), confirmar em cuca-dev/staging que chegam 2-3 mensagens separadas no WhatsApp, na ordem certa, e que `mensagens` tem 1 linha por parte enviada (não 1 linha só com o texto concatenado)
  - grep -n "_meta_enviar" worker/meta_adapter_inbound.py worker/meta_adapter_outbound.py → confirmar que o novo caminho de múltiplas mensagens não duplica nem perde envio em caso de falha parcial
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** que respostas longas/listáveis (ex.: lista de 5+ cursos com dia/horário) cheguem ao lead em 2-3 mensagens WhatsApp separadas — mensagem de abertura + lista — em vez de um único bloco de texto corrido,
**para que** a leitura no WhatsApp fique mais natural e parecida com como uma pessoa de verdade responderia, em vez de um parágrafo único difícil de ler no celular.

## Contexto e Problema

Item 2 do levantamento de pendências consolidado por Junior em 11/07/2026 (testado/confirmado ao vivo em produção), conhecido no histórico deste projeto como **TOM-03b**. Já tinha sido identificado antes: a auditoria de tom de 08/07/2026 (referenciada em `docs/stories/MAPA-Auditoria-Motor-Agente-Institucional.md`, story S-WM-28) chamou isso de "mudança maior" e recomendou tratar como story separada — recomendação que esta story agora executa, por decisão explícita do Junior de incluir o item nesta rodada.

**Por que é o item de maior risco/esforço dos 5 desta leva** (o Junior já sinalizou isso, e a investigação de código confirma): diferente dos itens da [[S-WM-21]], que são só ajuste de lógica de decisão dentro de `motor-agente/index.ts`, este item muda **como a função monta E despacha** a resposta — atravessa 2 sistemas:

1. **`supabase/functions/motor-agente/index.ts`** (Deno, este repo) — hoje retorna sempre um único campo `resposta: string` (linha 924) e grava uma única linha em `mensagens` via `salvarMensagemAgente` (linha 920, chamada única em toda a function).
2. **`worker/meta_adapter_inbound.py`** (Python, dispatch real) — `_chamar_motor_agente` (linhas 262-354) lê só `data.get("resposta")` (linha 354, um único texto) e `_dispatch_motor_agente_ou_empregabilidade` (linhas ~711-745) chama `_meta_enviar` (de `meta_adapter_outbound.py`) **uma única vez** com esse texto inteiro.

Ou seja: hoje o "envio" real ao WhatsApp é uma chamada só, de ponta a ponta. Fatiar a resposta em 2-3 mensagens exige decidir e implementar um contrato novo entre os dois lados — não é só inserir `\n\n` no meio do texto.

**Restrição de integridade que a investigação encontrou (não pode ser ignorada):** o motor-agente reconstrói o histórico da conversa lendo a tabela `mensagens` (Passo 4, linha 645, usado em toda decisão de contexto/RAG dos próximos turnos). Se 2-3 mensagens forem enviadas ao lead mas só 1 linha for gravada em `mensagens` (com o texto todo concatenado), o histórico do próximo turno fica errado — o GPT vai "ver" um texto que nunca foi exatamente o que o lead recebeu, turno por turno.

## Escopo

### IN
1. Definir um critério concreto e testável para "resposta longa/listável" (não uma decisão vaga) — ex.: baseado em tamanho de texto e/ou presença de múltiplos itens de lista no formato já usado pelo guardrail de listagem (`INSTRUCAO_SEGURANCA`, regra 6, linhas 259-265) — decisão e justificativa registradas na story/PR.
2. Definir o contrato entre `motor-agente` (Deno) e o worker (Python) para transportar múltiplas partes de mensagem — decisão de formato (ex.: `resposta` continua string única e o split acontece no worker; ou `motor-agente` passa a retornar `mensagens: string[]` e o worker despacha cada uma) é do @dev/@architect, mas precisa estar documentada e coerente com o restante do contrato JSON já existente (`success`, `agente_usado`, `handover`, `encerrado`).
3. Persistência: cada parte efetivamente despachada ao lead vira **sua própria linha** em `mensagens` (`remetente="agente"`), preservando a ordem — nunca uma linha única com o texto concatenado quando o envio real foi fatiado.
4. Dispatch: `worker/meta_adapter_inbound.py`/`meta_adapter_outbound.py` enviam cada parte como uma mensagem WhatsApp separada, na ordem correta.
5. O split (quando ocorrer) acontece **depois** do processamento de tags (`[[HANDOVER]]`, `[[ENCERRAR]]`, `[[ENCAMINHAR:canal]]` — linhas 883-917 de `index.ts`) — nunca fatia uma tag crua nem interfere na substituição determinística do texto de encaminhamento (`montarMensagemEncaminhamento`).
6. Comportamento de falha parcial definido e testado: se o envio de uma das partes falhar no meio (ex.: 2ª de 3 mensagens falha na API do WhatsApp), documentar o comportamento esperado (retry só da parte que falhou? aborta o resto? loga e segue?) — não pode duplicar nem silenciosamente perder partes.
7. Testes automatizados dos dois lados: `deno test` (contrato/formatação em `index.ts`) e `pytest` (dispatch sequencial + persistência em `worker/tests/`).

### OUT
- [[S-WM-21]] (itens 1, 3, 4, 5) — story separada, sem dependência técnica entre as duas.
- Mudança de modelo/prompt do GPT para gerar respostas já pré-divididas em blocos — o split é uma decisão de código sobre o texto já gerado, não uma mudança de como o GPT escreve (fica em aberto para o @dev decidir se cabe algum ajuste leve de prompt, mas não é o foco).
- Outros agentes (Sofia, Ouvidoria, Empregabilidade/Julia, Ana) — só o caminho Institucional/maria (`_AGENTES_MOTOR_AGENTE` em `meta_adapter_inbound.py`) está em escopo, salvo se o split for implementado de forma genérica o suficiente para não exigir esforço extra nos outros — não expandir escopo pra isso.
- Deploy — nenhum deploy automático. Próximo passo manual sugerido ao final: `supabase functions deploy motor-agente` + redeploy do worker (não executar).
- Otimização de custo/latência de enviar múltiplas mensagens (rate limit da API oficial da Meta por número, etc.) além de documentar o impacto — se relevante, registrar como risco, não bloquear a story.

## Acceptance Criteria

1. **Given** a resposta final do motor-agente (já depois de handover/encerrar/encaminhamento processados) é longa/listável pelo critério definido nesta story, **when** despachada, **then** é dividida em 2-3 partes lógicas (ex.: mensagem de abertura + lista separada) em vez de um único bloco.
2. **Given** a resposta é dividida em múltiplas partes, **when** persistida, **then** cada parte é gravada como sua própria linha em `mensagens` (`remetente="agente"`) — não uma única linha com o texto concatenado. O histórico lido no próximo turno (linha 645 de `index.ts`) reflete exatamente o que foi enviado, turno por turno.
3. **Given** a resposta é dividida, **when** despachada pelo worker, **then** cada parte é enviada como mensagem WhatsApp separada, na ordem correta, sem duplicar nem perder nenhuma parte mesmo em caso de falha parcial no meio do envio (comportamento de falha definido no Escopo IN item 6, testado).
4. **Given** uma resposta curta/normal (não longa/listável pelo critério definido), **when** despachada, **then** continua sendo enviada como uma única mensagem — comportamento atual preservado, sem fatiar toda resposta por padrão.
5. **Given** a resposta contém `[[HANDOVER]]`, `[[ENCERRAR]]` ou `[[ENCAMINHAR:canal]]`, **when** processada, **then** o split (se aplicável) só acontece depois dessas transformações — nunca fatia uma tag crua nem quebra a substituição determinística do texto de encaminhamento.
6. **Given** o contrato entre `motor-agente` e o worker, **when** inspecionado, **then** o formato de transporte de múltiplas partes está documentado nesta story (seção Dev Notes, atualizada pelo @dev) e coberto por teste `deno test` (lado motor-agente) e `pytest` (lado worker) — não só um dos dois lados.
7. **Given** a suíte `deno test` do motor-agente e a suíte `pytest` do worker, **when** executadas após a implementação, **then** ambas passam sem regressão do baseline vigente.
8. Nenhum deploy é executado por esta story — próximos passos (`supabase functions deploy motor-agente`, redeploy do worker) são só sugeridos, nunca executados pelo agente.
9. **Given** cada Task de Tasks/Subtasks é concluída, **when** o @dev fecha a Task, **then** roda o subconjunto de testes relevante àquela Task (`deno test` para Tasks no lado Deno, `pytest` para Tasks no lado worker) e registra o resultado (`N passed / N failed`, com o nome dos testes novos) no Dev Agent Record **antes de seguir para a próxima Task** — acompanhamento incremental, não só um resultado agregado no fechamento da story (pedido explícito de Junior no gate de validação desta story).

## 🤖 CodeRabbit Integration

> **CodeRabbit Integration**: Disabled
>
> `coderabbit_integration` não está configurado em `.aiox-core/core-config.yaml` (chave ausente). Validação de qualidade segue só pelo processo manual (@dev pre-commit + @qa gate).

## Tasks / Subtasks

- [x] **Task 1 — Definir critério de "longa/listável" e formato do contrato** (AC: 1, 4, 6)
  - [x] Critério registrado (3+ linhas formato "Nome - Dias" da regra 6) e contrato registrado (`mensagens: string[]` novo, `resposta` mantido como `join`) — ver Dev Notes "Formato do contrato" acima.
  - [x] Confirmado: campo novo é aditivo (`mensagens` a mais, `resposta`/`success`/`agente_usado`/`handover`/`encerrado` inalterados) — nenhum consumidor existente quebra.
- [x] **Task 2 — `motor-agente/index.ts`: montar a resposta dividida** (AC: 1, 4, 5, 7)
  - [x] Implementado o split **depois** do bloco de tags.
  - [x] Persistida cada parte em `mensagens` (loop de `salvarMensagemAgente`).
  - [x] Testes `deno test`: resposta longa gera N partes + N linhas em `mensagens`; resposta curta não é fatiada; split respeita a ordem pós-tags.
  - [x] **Reportado no Dev Agent Record** (AC9) — ver acima.
- [x] **Task 3 — Worker: dispatch sequencial** (AC: 2, 3, 7)
  - [x] Ajustado `_chamar_motor_agente` pra ler `mensagens` (novo), fallback `[resposta]`.
  - [x] Ajustado o ponto de dispatch pra chamar `_meta_enviar` uma vez por parte, na ordem, abortando sem retry na 1ª falha.
  - [x] Testes `pytest`: múltiplas partes despachadas na ordem certa; falha na parte N não duplica nem perde as demais. 3 testes existentes corrigidos (contrato mudou de string pra lista).
  - [x] **Reportado no Dev Agent Record** (AC9) — ver acima.
- [x] **Task 4 — Fechamento** (AC: 8)
  - [x] `deno test` (89 passed/0 failed/2 ignored) + `pytest worker/tests/` (123 passed/3 skipped) completos, sem regressão.
  - [x] `deno check`: 67 erros, idêntico ao fim da S-WM-21 — zero erros novos desta story.
  - [ ] **Validação manual em cuca-dev/staging — NÃO executada** (sem acesso a WhatsApp/staging nesta sessão). Pendência explícita, não escondida — ver Dev Agent Record.
  - [x] File List e Change Log atualizados.
  - [x] Conclusão anunciada, recomendando @qa — @qa e @devops **não** foram chamados.

## Dev Notes

### Touch points confirmados nesta investigação
- `supabase/functions/motor-agente/index.ts`:
  - Montagem final de `resposta` e tratamento de tags — linhas 883-917.
  - Retorno do contrato JSON — linha 924 (`resposta: string`, hoje único campo de texto).
  - Persistência — `salvarMensagemAgente`, linha 533, chamada única hoje (linha 920).
  - Guardrail de formato de listagem (regra 6) — `INSTRUCAO_SEGURANCA`, linhas 259-265 — pode servir de base pro critério de "listável" (o próprio guardrail já pede formato compacto por item, dias da semana etc.).
  - Histórico lido do próximo turno — linha 645 (`mensagens` como fonte de verdade do que já foi trocado).
- `worker/meta_adapter_inbound.py`:
  - `_chamar_motor_agente` — linhas 262-354, hoje só lê `data.get("resposta")` (linha 354).
  - Ponto de dispatch real — linhas ~711-745 (`_dispatch_motor_agente_ou_empregabilidade`), chama `_meta_enviar` uma única vez (linha 721).
- `worker/meta_adapter_outbound.py`: `_meta_enviar` — função de envio real à API oficial da Meta, ponto que precisa ser chamado N vezes em sequência em vez de 1.

### Formato do contrato — **decisão registrada pelo @dev antes de codar (Task 1)**

**Escolhida a opção (a):** `motor-agente` ganha um campo novo `mensagens: string[]` na resposta final (Passo 12, depois de handover/encerrar/encaminhamento processados). `resposta: string` é **mantido**, sempre igual a `mensagens.join("\n\n")` — nenhum consumidor existente que só lê `resposta` quebra. `mensagens` tem sempre **1 ou mais** elementos (resposta curta = array de 1 elemento, igual a `[resposta]`).

**Por quê não a opção (b) (separador em string única):** um marcador textual é frágil (risco de colisão com conteúdo real gerado pelo GPT, precisa de escaping) e não é testável sem parsear string em ambos os lados. Array explícito é o contrato mais direto: cada lado só itera, sem parsing.

**Escopo do campo novo:** só a resposta final do Passo 12 (fluxo principal, gerada pelo GPT) ganha `mensagens`. Os early-returns de `handler` que já existem (MENU_UNIDADES, "não consegui identificar a unidade", pergunta de ambiguidade do Item 4/S-WM-21, `menu_boas_vindas` da Sofia) **continuam só com `resposta: string`**, sem `mensagens` — são todos textos curtos/determinísticos que nunca batem no critério de "listável" (não têm o formato "Nome - Dias" da regra 6), então dividi-los não faz sentido e tocar em cada um deles infla o diff sem necessidade. O lado worker trata `mensagens` ausente como equivalente a `[resposta]` (fallback), then cobrindo os dois casos com o mesmo código de dispatch, sem branch especial.

**Critério de "longa/listável" (concreto, testável):** reaproveita o formato que `INSTRUCAO_SEGURANCA` regra 6 já exige do GPT pra listar modalidades — `"Nome - Dias"` (ex.: `"Natacao - Ter/Qui/Sex"`). Uma linha "conta" como item de lista se, depois de `trim()`: não é vazia, não termina em `?`, contém a substring `" - "`, e tem até 80 caracteres. **3 ou mais** dessas linhas na resposta → "listável". Não uso um limiar de tamanho separado (chars) — 3+ linhas nesse formato compacto já implica um texto longo o bastante pra justificar dividir; um limiar de tamanho separado só adicionaria uma segunda variável pra calibrar sem necessidade.

**Como divide:** localiza o bloco contíguo de linhas-item (da 1ª à última linha que bate no critério). Texto ANTES do bloco = "abertura" (se não vazio, vira a 1ª parte). O bloco em si = a lista (sempre vira uma parte, sozinha). Texto DEPOIS do bloco = "fechamento" (se não vazio, ex. a pergunta final que a regra 6 já pede — "Quer saber horários e detalhes de alguma modalidade específica?" — vira a última parte). Resultado: 2 partes (sem abertura ou sem fechamento) ou 3 partes (com os dois), nunca mais que 3. Se por algum motivo o resultado tivesse só 1 parte não-vazia (ex.: resposta é 100% lista, sem abertura nem fechamento), retorna só essa parte — não força split artificial.

**Falha parcial no dispatch (worker, Escopo IN item 6):** decisão = **abortar as partes restantes no 1º erro, sem retry automático, log claro de quantas partes foram enviadas com sucesso antes de parar.** Não retry: `_meta_enviar` não tem idempotência garantida do lado da API da Meta — reenviar sem saber se o request anterior só falhou na RESPOSTA (mas foi entregue) arriscaria duplicar a mensagem pro lead, isso é pior do que a conversa ficar incompleta. Não continuar as partes seguintes depois de uma falha: enviar só a "abertura" e pular a "lista" (ou só a "lista" sem o "fechamento") deixa uma resposta sem sentido — mais confuso pro lead do que parar.

**Limitação documentada, não escondida (ver Riscos):** `mensagens` é persistido em `mensagens` (tabela) no momento em que o `motor-agente` GERA a resposta (Deno, síncrono, antes de qualquer tentativa de envio real). O envio real acontece DEPOIS, numa chamada HTTP separada do worker (Python). Se o worker falhar ao enviar a 2ª ou 3ª parte, as linhas já foram gravadas em `mensagens` mesmo assim — **isso já era verdade hoje pra mensagem única** (nunca houve garantia de que "gravado em `mensagens`" == "chegou no WhatsApp"), então esta story não piora essa característica, só a preserva pro caso de N partes em vez de 1.

### Testing

- Lado Deno: seguir o padrão de `index.audit.test.ts` (mock de fetch/Supabase, `handler` completo via `supabaseOverride`) — testar que N partes viram N linhas em `mensagens` via o mock de `criarSupabaseMock`.
- Lado Python: seguir o padrão de `worker/tests/test_meta_adapter_inbound.py` (mock de `_meta_enviar`) — testar que `_meta_enviar` é chamado N vezes, na ordem certa, com o conteúdo certo de cada parte; testar o cenário de falha parcial explicitamente (mock levantando exceção na 2ª chamada).
- `deno check supabase/functions/motor-agente/index.ts` obrigatório antes de marcar a story como pronta.
- Validação funcional final (não substitui os testes automatizados, mas é exigida pelo AC de fechamento): 1 teste manual em cuca-dev/staging com uma resposta real longa, confirmando 2-3 mensagens separadas chegando na ordem certa.

## Dependências
- Nenhuma dependência técnica com [[S-WM-21]] (arquivos/times diferentes o suficiente para rodar em paralelo, mas recomendo terminar S-WM-21 primeiro por ser risco menor e já ter parte do trabalho feito).
- Depende do estado atual de `index.ts` (v18) e `worker/meta_adapter_inbound.py`/`meta_adapter_outbound.py`, confirmado nesta investigação.

## Riscos
- **Maior risco/esforço dos 5 itens desta leva** (sinalizado pelo próprio Junior e confirmado pela investigação — muda contrato entre 2 sistemas, não só lógica interna).
- Falha parcial no envio de múltiplas mensagens pode deixar o lead com uma conversa incompleta (ex.: recebeu a abertura, não recebeu a lista) — o comportamento de falha precisa ser decidido conscientemente, não como efeito colateral não testado.
- Critério de "longa/listável" mal calibrado pode fatiar respostas curtas desnecessariamente ou deixar respostas longas inteiras sem dividir — cobrir com teste de regressão explícito (AC4) para não regredir o caso comum (resposta curta).
- Mudança de contrato JSON entre `motor-agente` e o worker é uma superfície compartilhada — se outro consumidor além do worker Meta ler esse contrato (confirmar antes de mudar o formato), pode quebrar sem estar no radar desta story.

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-11 | 0.1 | Draft inicial a partir do levantamento de pendências de Junior (item 2 / TOM-03b, separado da S-WM-21 por risco/esforço) | @sm River |
| 2026-07-11 | 0.2 | Validado (GO). Status Draft → Ready. Adicionado campo Complexidade, AC9 e checklist por Task exigindo relato incremental (não só agregado no fechamento) do resultado de `deno test`/`pytest` no Dev Agent Record, a pedido explícito de Junior | @po Pax |
| 2026-07-11 | 0.3 | Implementados os 4 Tasks: critério+contrato registrados (Task 1), split+persistência em `index.ts` (Task 2), dispatch sequencial+falha parcial no worker (Task 3), fechamento (Task 4). `deno test`: 89 passed/0 failed/2 ignored. `pytest`: 123 passed/3 skipped (baseline 120, +3 novos). `deno check`: 67 erros, idêntico ao fim da S-WM-21 (zero erros novos). Validação manual em staging NÃO executada (sem acesso nesta sessão) — pendência explícita. Status Ready → InProgress → Ready for Review | @dev Dex |

## Dev Agent Record

### Task 1 — Critério + contrato (concluída)
Sem código nesta Task (decisão de design, registrada em Dev Notes). Decisões: critério de "listável" = 3+ linhas no formato "Nome - Dias" (regra 6 do guardrail, reaproveitado, não inventado); contrato = campo aditivo `mensagens: string[]`, `resposta` mantido como `join("\n\n")`; falha parcial no worker = abortar sem retry, log de progresso. Detalhes completos na seção "Formato do contrato" acima.

### Task 2 — `motor-agente/index.ts`: split + persistência (concluída)

Implementado `dividirRespostaEmPartes` (função pura, exportada) + `ehLinhaDeItemLista` (helper interno) logo antes de `salvarMensagemAgente`. Aplicado no handler no Passo 12, **depois** de todo o processamento de tags (handover/encerrar/encaminhar) — `resposta` (string) passa a ser `mensagens.join("\n\n")`; `mensagens` (array, novo campo no JSON) é o que efetivamente é persistido, 1 `salvarMensagemAgente` por parte, num loop.

`deno test --no-check --allow-env --allow-read --allow-net .`: **89 passed | 0 failed | 2 ignored** (10 testes novos, zero regressão nos 79 anteriores).

Testes novos:
- 7 testes puros de `dividirRespostaEmPartes` (AC1, AC4, casos sem abertura/sem fechamento/100% lista, e o caso de borda "pergunta com hífen que termina em '?' não é item de lista").
- `Item 2 / AC1-AC2` (handler completo): resposta longa vira 3 partes no JSON **e** 3 linhas em `mensagens`, com o conteúdo exato de cada parte conferido.
- `Item 2 / AC4` (handler completo): resposta curta continua 1 parte/1 linha — regressão explícita.
- `Item 2 / AC5` (handler completo): resposta com `[[HANDOVER]]` + lista — confirma que a tag é removida ANTES do split (não sobra em nenhuma parte) e que `handover=true` continua funcionando.

### Task 3 — worker: dispatch sequencial + falha parcial (concluída)

`_chamar_motor_agente` (`meta_adapter_inbound.py`) muda de `str | None` pra `list[str] | None`: lê `data.get("mensagens")` primeiro (campo novo), cai pra `[data.get("resposta")]` quando ausente/inválido (cobre todos os early-returns do motor-agente que ainda só devolvem `resposta`, sem precisar tocar neles). O ponto de dispatch (`_executar_dispatch`) itera as partes em sequência, chamando `_meta_enviar` uma vez por parte — na 1ª falha, **aborta as partes restantes, sem retry, com log de quantas foram enviadas antes** (decisão registrada na Task 1: `_meta_enviar` não tem garantia de idempotência do lado da Meta, retry arriscaria duplicar).

**Contrato quebrado nos mocks existentes, corrigido:** 3 testes já existentes mockavam `_chamar_motor_agente` com `return_value="string"` (não lista) — com a mudança de contrato, o novo código de dispatch (`for parte in partes:`) iteraria essas strings CARACTERE POR CARACTERE se eu não corrigisse os mocks. Corrigidos os 3 (`test_processar_webhook_agentes_motor_agente`, o teste de handover, e o de debounce) pra `return_value=["string"]`. 2 testes que chamam a função REAL (não mockada) e comparam o retorno diretamente (`test_chamar_motor_agente_retorna_resposta`, o de handover) também precisaram do ajuste (`== ["texto"]` em vez de `== "texto"`) — consequência direta e esperada da mudança de contrato, não uma correção de bug.

`pytest tests/` (suíte completa do worker): baseline pré-Task-3 = **120 passed, 3 skipped**; pós-Task-3 = **123 passed, 3 skipped, 0 failed** — confirmado via `git stash`/re-run isolado, exatamente +3 (os testes novos), zero regressão.

Testes novos:
- `test_chamar_motor_agente_le_campo_mensagens_multiplas_partes` — confirma que `mensagens` (lista) tem prioridade sobre `resposta` (string) quando ambos presentes.
- `test_dispatch_multiplas_partes_envia_todas_na_ordem` (AC3): 3 partes → `_meta_enviar` chamado 3x, com o texto de cada parte, na ordem certa.
- `test_dispatch_falha_na_parte_do_meio_aborta_sem_duplicar_nem_pular` (AC3, falha parcial): `_meta_enviar` com `side_effect=[True, False, True]` — confirma que só as 2 primeiras partes são tentadas (a 2ª falha) e a 3ª nunca é enviada, sem retry da que falhou.

### Task 4 — Fechamento (concluída)

**`deno test --no-check --allow-env --allow-read --allow-net .` (final):** `ok | 89 passed | 0 failed | 2 ignored`.

**`deno check index.ts` (final):** 67 erros — **idêntico** ao número no fim da S-WM-21 (mesma baseline de 61 + 6 pré-existentes, herdada; esta story não adicionou nenhum erro de tipo novo — `dividirRespostaEmPartes`/`ehLinhaDeItemLista` são funções puras bem tipadas, sem tocar em `conversa`/`lead`).

**`pytest tests/` (worker, final):** `123 passed, 3 skipped` — mesmo resultado já reportado na Task 3 (nenhuma mudança adicional no fechamento).

**Validação manual em cuca-dev/staging — NÃO EXECUTADA por mim.** Não tenho acesso a WhatsApp real nem ao ambiente de staging nesta sessão — só testes automatizados (`deno test`/`pytest`) foram rodados. Isso é uma limitação real, não uma formalidade: os testes automatizados provam a LÓGICA (critério de split, contrato, persistência, dispatch sequencial, falha parcial) com mocks, mas não provam que uma resposta real do GPT (temperatura=0.7, sem garantia de seguir a regra 6 à risca) realmente aciona o critério do jeito esperado, nem que a Graph API da Meta se comporta como o mock assume. **Este é o próximo passo manual obrigatório antes de considerar a story pronta de verdade** (AC do Escopo/Testing já previa isso): pedir a programação completa de uma unidade com 5+ cursos em cuca-dev/staging e confirmar 2-3 mensagens separadas chegando na ordem certa.

**File List:**
- `supabase/functions/motor-agente/index.ts` — `dividirRespostaEmPartes`/`ehLinhaDeItemLista` (novas), Passo 12 ajustado (split + loop de persistência + campo `mensagens` no JSON).
- `supabase/functions/motor-agente/index.test.ts` — 7 testes novos de `dividirRespostaEmPartes`.
- `supabase/functions/motor-agente/index.audit.test.ts` — 3 testes novos de handler completo (AC1/AC2, AC4, AC5).
- `worker/meta_adapter_inbound.py` — `_chamar_motor_agente` (contrato `list[str] | None`), dispatch sequencial com abort-on-failure.
- `worker/tests/test_meta_adapter_inbound.py` — 2 testes existentes corrigidos (assert de valor), 3 mocks existentes corrigidos (contrato mudou pra lista), 3 testes novos (leitura de `mensagens`, dispatch múltiplo, falha parcial).

**Próximo passo sugerido (manual, não executado):** validação real em cuca-dev/staging (ver acima) → depois `supabase functions deploy motor-agente` + redeploy do worker, só depois de aprovado.

**Recomendação:** chamar @qa Quinn pra o gate desta story. @qa e @devops não foram acionados por mim.

## QA Results
_A ser preenchido pelo @qa após a implementação._
