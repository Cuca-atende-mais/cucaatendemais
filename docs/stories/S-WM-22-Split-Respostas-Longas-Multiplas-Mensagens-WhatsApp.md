# S-WM-22 — TOM-03b: respostas longas em múltiplas mensagens WhatsApp

## Status
Ready

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

- [ ] **Task 1 — Definir critério de "longa/listável" e formato do contrato** (AC: 1, 4, 6)
  - [ ] Registrar o critério concreto escolhido (tamanho + heurística de lista) e o formato de transporte (array de partes vs. delimitador vs. outro) nesta story antes de codar — decisão visível, não escondida no diff.
  - [ ] Confirmar que o formato escolhido não quebra o contrato JSON existente (`success`, `agente_usado`, `handover`, `encerrado`) para os consumidores atuais.
- [ ] **Task 2 — `motor-agente/index.ts`: montar a resposta dividida** (AC: 1, 4, 5, 7)
  - [ ] Implementar o split **depois** do bloco de tags (linhas 883-917).
  - [ ] Persistir cada parte em `mensagens` (adaptar/estender `salvarMensagemAgente`, linha 533).
  - [ ] Testes `deno test`: resposta longa gera N partes + N linhas em `mensagens`; resposta curta não é fatiada; split respeita a ordem pós-tags.
  - [ ] **Reportar no Dev Agent Record** o resultado do `deno test` desta Task antes de seguir para a Task 3 (AC9).
- [ ] **Task 3 — Worker: dispatch sequencial** (AC: 2, 3, 7)
  - [ ] Ajustar `_chamar_motor_agente` (linhas 262-354) para ler o novo formato.
  - [ ] Ajustar o ponto de dispatch (linhas ~711-745 de `meta_adapter_inbound.py`) para chamar `_meta_enviar` uma vez por parte, na ordem, com o comportamento de falha parcial definido na Task 1.
  - [ ] Testes `pytest`: múltiplas partes despachadas na ordem certa; falha na parte N não duplica nem perde as demais (cenário definido explicitamente).
  - [ ] **Reportar no Dev Agent Record** o resultado do `pytest` desta Task antes de seguir para a Task 4 (AC9).
- [ ] **Task 4 — Fechamento** (AC: 8)
  - [ ] `deno test` + `pytest worker/tests/` completos, sem regressão.
  - [ ] `deno check` sem erros.
  - [ ] Validação manual em cuca-dev/staging com uma resposta real longa (ex.: pedir a programação completa de uma unidade com 5+ cursos).
  - [ ] Atualizar File List e Change Log da story.
  - [ ] Anunciar conclusão e recomendar chamar @qa — **não** chamar @qa nem @devops automaticamente.

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

### Formato do contrato — **decisão do @dev, registrar aqui antes de codar**
Duas opções levantadas nesta investigação (não excludentes de uma terceira que o @dev encontre):
- (a) `motor-agente` retorna `resposta: string[]` (ou campo novo `mensagens: string[]`, mantendo `resposta` como concatenação para não quebrar consumidores que não tratam array) — o worker despacha cada item.
- (b) `motor-agente` continua retornando `resposta: string` com um separador determinístico entre partes (ex.: um marcador que não apareça em texto normal) — o worker faz o split.
Tendência: (a) é mais explícito e testável dos dois lados sem depender de um separador frágil, mas cabe ao @dev avaliar overhead de mudança de contrato vs. simplicidade do separador. Preencher a decisão final aqui.

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

## Dev Agent Record
_A ser preenchido pelo @dev durante a implementação — **inclui o resultado de `deno test`/`pytest` reportado ao final de cada Task de código (AC9), não só um resumo agregado no fechamento.**_

## QA Results
_A ser preenchido pelo @qa após a implementação._
