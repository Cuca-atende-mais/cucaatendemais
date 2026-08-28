# SQS-64 — Aba "Currículos Enviados" na vaga + ação de envio individual para a empresa

## Status

InReview

**Prioridade:** Alta (pedido direto do Junior, 2026-08-27)
**Esforço:** P/M — reaproveita rota de envio (`enviar-cv`) e colunas já existentes
(`email_enviado_em`/`email_enviado_para`); trabalho concentrado em UI (nova divisão de visão +
botão), sem schema novo e sem integração externa nova
**Tipo:** Nova Funcionalidade
**Módulo:** Empregabilidade
**Épico:** EPIC-EMP-VOL — Empregabilidade em Alto Volume

## Story

**Como** colaborador CUCA responsável por uma vaga,
**quero** ver separado, dentro da própria vaga, quais currículos já foram enviados para a empresa
e quais ainda não — e poder enviar os pendentes, um a um, sem sair da tela —
**para que**, ao assumir o trabalho (no dia seguinte ou no decorrer do dia), eu saiba exatamente o
que falta encaminhar: candidatos que chegaram durante minha ausência, ou que eu puxei do Banco de
Talentos e esqueci de enviar.

> **Decisão do Junior (2026-08-27): não haverá envio em lote.** O plano original desta story
> reaproveitava a rota `enviar-cv-lote` (já existente, órfã de UI) para selecionar vários candidatos
> e enviar de uma vez. Confirmado que **não é isso que vai ser construído** — cada currículo é
> enviado individualmente, um por um. Ver "Task explícita" abaixo.

## Contexto — o que já existe hoje

A investigação encontrou que **a infraestrutura de envio já existe e já está em produção**, só não
está com uma tela dedicada:

- `candidaturas.email_enviado_em` / `email_enviado_para` (colunas já existentes) marcam quando um
  currículo foi enviado por e-mail para a empresa da vaga.
- `POST /api/empregabilidade/enviar-cv` — já em produção, botão "Enviar Currículo" na tela de
  detalhe do candidato (`vagas/[id]/candidatos/[candidatura_id]`). Envia 1 currículo por vez.
- `POST /api/empregabilidade/enviar-cv-lote` — já implementado e em produção, mas sem nenhum botão
  na interface que o chame (confirmado por busca no código — zero referências em `.tsx`).
  **Decisão do Junior: esta story não vai ligá-lo.** Fica como está hoje — órfão, sem consumidor —
  não é tocado nem removido do backend (fora de escopo remover código de rota que não faz parte
  desta story).
- Consulta na produção confirma o dado: de 285 candidaturas hoje, **177 já têm
  `email_enviado_em` preenchido** — o "banco já tem esses dados" citado no pedido é real e a aba
  não nasce vazia.

Ou seja: este trabalho é principalmente **UI** — expor o que já existe (aba/filtro) e reaproveitar
a rota de envio individual (`enviar-cv`) que já está em produção, sem criar mecanismo de envio novo.

## Task explícita — sem envio em lote

- **Não criar** botão, checkbox de seleção múltipla, ou qualquer caminho de UI que chame
  `enviar-cv-lote`.
- Se, durante a implementação, o @dev encontrar algum rascunho/protótipo de botão "Enviar em Lote"
  de currículo (não confundir com o botão já existente "Convocar em Lote", que é de convocação para
  entrevista — ação diferente, não é tocada por esta story), **excluir**.
- Cada card na visão "A Enviar" tem só o botão de envio individual (replicando a ação que já existe
  na tela de detalhe do candidato).

## Objetivo / Acceptance Criteria

1. Na tela de detalhe da vaga (`vagas/[id]`), a seção de candidatos passa a ter duas visões
   (aba ou toggle, a definir no design final): **"A Enviar"** (candidatos inscritos, não
   rejeitados, com `email_enviado_em IS NULL`) e **"Currículos Enviados"** (candidatos com
   `email_enviado_em IS NOT NULL`).
2. A visão "A Enviar" é a que abre por padrão — é a fila de trabalho do colaborador.
3. Na visão "A Enviar", cada card tem um botão "Enviar" individual (já existe na tela de detalhe do
   candidato — replicar aqui evita esse clique a mais), chamando `POST /api/empregabilidade/
   enviar-cv`. **Sem seleção múltipla, sem envio em lote** (decisão explícita do Junior — ver
   "Task explícita" acima).
4. Ao enviar com sucesso, o card desaparece da visão "A Enviar" e passa a aparecer em "Currículos
   Enviados" — sem precisar recarregar a página manualmente.
5. A visão "Currículos Enviados" mostra, por card, quando foi enviado (`email_enviado_em`) e para
   qual e-mail (`email_enviado_para`), e tem uma ação de **reenvio** (reaproveita a mesma rota de
   envio individual) — cobre o caso "empresa disse que não chegou" / "currículo foi atualizado
   depois do primeiro envio".
6. Candidatos de seleções com `coleta_curriculo = false` **não** aparecem em nenhuma das duas visões
   com botão de envio ativo — a rota já bloqueia o envio no servidor para esse caso (AC15 da
   SQS-56), a UI deve refletir isso (ação desabilitada, não só erro ao clicar).
7. O modo Kanban (por status de entrevista) continua mostrando todos os candidatos (enviado ou não)
   — "enviado à empresa" e "status da entrevista" são eixos independentes; a aba não se aplica ao
   Kanban nesta primeira versão (ver "Fora de escopo").

## ⚠️ Análise de impacto — por item

### Item 1 — Nova divisão "A Enviar" / "Currículos Enviados" na tela de detalhe da vaga

- **Toca:** `cuca-portal/src/app/(dashboard)/empregabilidade/vagas/[id]/page.tsx` — a seção
  "Candidatos Inscritos" (grid), que hoje mostra `candidatos.filter(c => c.status !== "rejeitado")`
  sem considerar `email_enviado_em`.
- **Consome hoje:** nenhum consumidor externo lê essa filtragem — é local ao componente.
- **Impacto observável:** candidatos já enviados somem da visão padrão da vaga (comportamento
  pedido, mas é uma mudança visível — quem está acostumado a ver todo mundo junto vai notar).
- **De-risk:** já confirmado via `execute_sql` que o campo está populado (177/285) — a aba não
  aparece vazia nem "quebra" a visão de vagas antigas que já tiveram envios.

### Item 2 — Sem envio em lote (decisão do Junior)

- **Toca:** nada de novo — a rota `enviar-cv-lote` permanece órfã, sem consumidor de UI, como já
  estava antes desta story. Nenhum botão de seleção múltipla é criado.
- **Impacto observável:** cada card na fila "A Enviar" só tem o botão individual — envio continua
  um a um, do jeito que já funciona hoje na tela de detalhe do candidato, só que agora também
  disponível direto na listagem da vaga.
- **De-risk:** nenhum — é ausência de mudança na rota em lote, não uma integração nova.

### Item 3 — `enviar-cv` (individual) pode marcar `email_enviado_em` mesmo sem anexo ter ido

- **Achado da investigação (não pedido original, mas risco direto ao propósito da aba):** a rota
  `enviar-cv` marca `email_enviado_em` mesmo quando o download do PDF falha — o código só loga um
  aviso (`console.warn`) e segue o envio sem interromper. O e-mail chega pra empresa sem anexo, mas
  a candidatura sai da fila "A Enviar" como se tivesse ido completa.
- **Impacto observável:** a aba que existe justamente para evitar "currículo esquecido" pode
  esconder um currículo que tecnicamente "foi enviado" mas sem o PDF anexado.
- **Pergunta em aberto para o Junior:** aceitável deixar assim por agora (a aba resolve o problema
  principal — currículo nunca processado — e esse caso de borda de falha de download fica para uma
  iteração futura), ou precisa ser tratado nesta story? Recomendo tratar como fora de escopo — é um
  bug pré-existente na rota `enviar-cv`, independente da aba — mas registrando para não virar
  surpresa depois.

### Item 4 — Banco de Talentos não integra com a aba

- **Toca:** nada nesta story — é uma fronteira, não uma mudança.
- **Impacto observável:** a triagem do Banco de Talentos vive em `localStorage`
  (`talent_triagem_${id}`), não no banco. A aba "A Enviar" só cobre quem já virou **candidatura**
  (registro em `candidaturas`) — um candidato consultado no Banco de Talentos e nunca inscrito na
  vaga não aparece em lugar nenhum como pendência. Isso é esperado (fora do escopo do pedido:
  "puxou do banco de talentos e esqueceu de enviar" pressupõe que a inscrição já foi criada), mas
  vale deixar explícito para não gerar expectativa errada.

## Escopo

**In:** nova divisão "A Enviar" / "Currículos Enviados" na tela de detalhe da vaga; botão de envio
individual replicado na listagem (chama a rota `enviar-cv` já existente); ação de reenvio na aba
"Currículos Enviados"; bloqueio de envio para seleções `coleta_curriculo = false`.
**Out:** ver tabela "Fora de escopo" abaixo — em especial, **sem envio em lote**.

## Fora de escopo (explícito)

| Item | Motivo |
|---|---|
| Envio em lote (seleção múltipla + `enviar-cv-lote`) | **Decisão explícita do Junior (2026-08-27): não vai existir.** Cada currículo é enviado individualmente |
| Aplicar a divisão "A Enviar"/"Enviados" também ao modo Kanban | Não pedido; Kanban já tem seu próprio eixo (status de entrevista) — juntar os dois eixos é decisão de design que merece story própria se o Junior quiser depois |
| Corrigir o bug do Item 3 (envio sem anexo ainda marca como enviado) | Levantado como achado, não como pedido original — decisão do Junior sobre tratar aqui ou depois |
| Visão agregada de "Currículos Enviados" cruzando todas as vagas | Pedido fala em abrir "as vagas" (plural, uma de cada vez) e trabalhar dentro de cada uma — não uma tela nova de listagem global. Se for isso que o Junior quer, é um pedido diferente (perguntar antes de implementar) |

## Test plan

- Vaga com candidatos não enviados e já enviados → cada um aparece na aba correta.
- Envio individual (a partir do card na listagem da vaga) → card muda de aba sem reload manual.
- Confirmar que não existe nenhum caminho de UI (botão, checkbox) que chame `enviar-cv-lote`.
- Vaga com `coleta_curriculo = false` → botão de envio desabilitado, não só erro no clique.
- Reenvio de um já enviado → `email_enviado_em`/`email_enviado_para` atualizados.

## File List

- `cuca-portal/src/app/(dashboard)/empregabilidade/vagas/[id]/page.tsx` (modificado — aba
  "A Enviar"/"Currículos Enviados", botão de envio/reenvio individual, sem rota nova)

## Change Log

- v0.1 (2026-08-27): Story criada por @sm a partir de pedido direto do Junior. Investigação de
  código + `execute_sql` (produção) confirmaram que a infraestrutura de envio (rota individual, rota
  em lote, colunas de rastreamento) já existe — o trabalho real é UI. Achado de risco (Item 3)
  levantado como pergunta aberta, não resolvido nesta versão.
- v0.2 (2026-08-27): Junior confirmou — **sem envio em lote**, envio permanece individual. Story
  ajustada: removida a integração com `enviar-cv-lote` do escopo, AC3/AC4 reescritos, Item 2 da
  análise de impacto reescrito, item novo na tabela "Fora de escopo", test plan ajustado.
- v0.3 (2026-08-27): @po validou — **GO (10/10 após ajuste)**. 9 dos 10 pontos já vinham completos
  (título, descrição, AC testáveis, dependências mapeadas, valor de negócio, riscos documentados,
  test plan como definição de pronto, alinhamento com o épico); faltava estimativa de esforço —
  adicionada no cabeçalho — e uma seção "Escopo" explícita — adicionada, consolidando o que já
  estava implícito em AC + tabela "Fora de escopo". A pergunta em aberto do Item 3 (envio sem anexo
  ainda marca `email_enviado_em`) **não bloqueia o GO**: é um bug pré-existente na rota `enviar-cv`,
  já documentado como fora de escopo desta story por recomendação do @sm — não muda o que o @dev
  constrói aqui, só fica registrado para decisão futura do Junior. Status Draft → Ready.
- v0.4 (2026-08-27): @dev implementou. Divisão "A Enviar"/"Currículos Enviados" adicionada como par
  de abas acima dos filtros de status, visível só no modo grid (AC7 — Kanban continua mostrando
  todos). Botão de envio individual replicado no card (reaproveita `POST /api/empregabilidade/
  enviar-cv`, mesma rota da tela de detalhe do candidato — nenhuma rota nova criada). Ao enviar com
  sucesso, o estado local é atualizado e o card migra de aba automaticamente, sem reload (AC4).
  Botão vira "Reenviar" nos já enviados (AC5), mostrando data/hora do envio no card. Botão fica
  desabilitado (não escondido) quando `vaga.coleta_curriculo === false` (AC6) — a rota já bloqueia
  no servidor (AC15 da SQS-56), aqui só evita o clique. **Nenhum caminho de UI chama
  `enviar-cv-lote`** — confirmado por revisão do diff, nenhuma seleção múltipla foi criada (Task
  explícita cumprida). `eslint`/`tsc` rodados no arquivo tocado: zero erros/avisos novos — os únicos
  problemas reportados (30 erros `no-explicit-any`, pré-existentes no arquivo) já estavam lá antes
  desta mudança, confirmado por diff linha a linha. Sem migration — reaproveita colunas já
  existentes (`email_enviado_em`/`email_enviado_para`). **Não testado em navegador/localhost** —
  regra do projeto exige autorização explícita do Junior antes de subir dev server ou navegar
  (`.claude/rules/qa-testes-sem-navegador-ao-vivo.md`); verificação foi só estática (leitura de
  código + lint/typecheck). Status Ready → InReview.
- v0.5 (2026-08-27): @qa revisou — **FAIL**. 1 achado HIGH (regressão em feature existente),
  1 achado MEDIUM (gap de AC). Devolvida ao @dev. Status InReview → InProgress. Ver "QA Results"
  abaixo.
- v0.6 (2026-08-27): @dev corrigiu os 2 achados do gate.
  - **HIGH (item 4):** criado `aprovadosOuSelecionadosTotal`, calculado sobre `candidatos`
    completo (vaga inteira, sem escopo de aba) — substituído nos 4 pontos que alimentavam o botão/
    label "Convocar em Lote" (antes lendo `contadores.aprovado_empresa + contadores.selecionado`,
    que ficou escopado à aba ativa). `contadores` (escopado por aba) continua intocado e serve só
    aos chips de status, como pretendido originalmente. Contagem exibida agora sempre bate com quem
    `handleSummon` de fato convoca, e o botão não some mais por causa da aba selecionada.
  - **MEDIUM (AC5):** card em "Currículos Enviados" agora mostra também `email_enviado_para`
    ("Enviado à empresa em DD/MM/AA HH:mm — para X@Y"), não só a data.
  - `eslint`/`tsc` re-rodados no arquivo: mesma contagem de antes (30 erros `no-explicit-any`
    pré-existentes, 6 warnings pré-existentes) — nenhum problema novo introduzido pelo fix.
  - Não testado em navegador (mesma regra do projeto já registrada na v0.4). Status InProgress →
    InReview — pronta para novo gate do @qa.

## QA Results

### Review em 2026-08-27 — @qa Quinn

**Gate: FAIL** (1 achado HIGH bloqueia; 1 achado MEDIUM deve ser corrigido junto)

**7 checks:**

1. **Code review** — padrão consistente com o resto do arquivo (mesmo formato de `fetch` +
   `toast` já usado em `enviarCVporEmail` na tela de detalhe do candidato). Comentários
   explicam as decisões (SQS-64, "sem lote"). OK, sem objeção de estilo.
2. **Testes** — nenhum teste automatizado adicionado; mesmo padrão já aceito no projeto para
   esta área (sem suíte pra `vagas/[id]/page.tsx` antes desta story também). Não-bloqueante.
3. **Acceptance Criteria** — AC1 a AC4, AC6 e AC7 verificados por leitura de código, atendidos.
   **AC5 parcialmente atendido:** pede que o card em "Currículos Enviados" mostre "quando foi
   enviado (`email_enviado_em`) **e para qual e-mail** (`email_enviado_para`)". A implementação
   só renderiza a data — o e-mail de destino nunca aparece no card. Sem isso, a aba não responde
   a uma pergunta razoável do colaborador ("pra que e-mail isso foi mesmo?"). Fácil de corrigir
   (só falta uma linha), mas é um AC explícito não cumprido — não é nitpick de estilo.
4. **Regressão — achado HIGH:** ao escopar `contadores` para `candidatosPorAba` (linha ~625 do
   diff), o botão **"Convocar em Lote"** (já existente, não faz parte desta story) foi quebrado
   de 2 formas, confirmadas por leitura de código (não só suposição):
   - A visibilidade do botão (`(contadores.aprovado_empresa + contadores.selecionado) > 0`) e o
     `handleSummon` continuam operando sobre `candidatos` completo (todos os candidatos aprovados/
     selecionados da vaga), mas a *contagem exibida* no botão agora reflete só quem está na aba
     ativa. Resultado: se todos os candidatos aprovados/selecionados já tiverem currículo enviado
     (ex.: fluxo normal — manda o CV, empresa aprova, aí convoca), o botão **some** quando o
     colaborador está na aba "A Enviar" — mesmo havendo candidatos prontos pra convocar na aba
     "Currículos Enviados". Não é um cenário raro, é o caminho mais comum (envia → aprova →
     convoca), então é bem provável de acontecer em uso real.
   - Onde o botão continua visível, o **número mostrado não bate com quem de fato recebe o
     convite**: `handleSummon` (linha 356-361) usa `candidatos.filter(...)` sem escopo de aba,
     então clicar em "Convocar em Lote (2)" pode na prática convocar mais gente do que os 2
     anunciados — o colaborador não teria como prever quantos convites realmente saem.
   - "Convocar em Lote" também é visível no modo **Kanban** (não está dentro do `viewMode ===
     "grid"` que protege a aba nova) — nesse modo a aba fica "presa" no último valor selecionado
     no grid, então o bug de contagem também aparece ali, mesmo essa tela nem mostrando a aba
     "A Enviar"/"Enviados" pro usuário perceber por quê o número está errado.
   - **Causa raiz:** `contadores` era, antes desta story, um objeto vaga-wide (todos os
     candidatos). Esta story reescreveu sua fonte para `candidatosPorAba` pra alimentar os chips
     de status (uso correto, pretendido) — mas 3 outros pontos do arquivo (linhas 669, 676, 1155,
     1159), que não têm nada a ver com a aba nova, também leem `contadores.aprovado_empresa`/
     `contadores.selecionado` e ficaram afetados como efeito colateral.
   - **Correção recomendada:** manter um `contadores` vaga-wide separado (ex.: `contadoresGlobais`,
     calculado sobre `candidatos` sem filtro de aba) só pra alimentar o botão/label de "Convocar em
     Lote" nas 4 linhas citadas; os chips de status da aba nova continuam usando o `contadores`
     escopado por aba, sem mudança aí.
5. **Performance** — sem impacto perceptível (filtragem em memória sobre listas já carregadas).
6. **Segurança** — nenhuma superfície nova; mesma rota (`enviar-cv`) já em produção, mesmo
   payload, sem novo dado sensível exposto no client.
7. **Documentação** — story com File List e Change Log atualizados. OK.

**Resumo para o @dev:** 2 correções antes de reenviar para gate — (a) separar a contagem do
"Convocar em Lote" da contagem por aba (achado HIGH, item 4), (b) mostrar `email_enviado_para`
no card da aba "Currículos Enviados" (achado MEDIUM, AC5). Nenhum dos dois exige revisar o
resto da implementação — os ACs 1-4, 6, 7 estão corretos.
