# S-PROG-06 — Tour guiado de primeira vez (condicional)

**Status:** Draft — **em espera, não iniciar**
**Epic:** Reestruturação da criação de programação
**Origem:** Análise de usabilidade do @sm (`PLANEJAMENTO-SM-programacao-manual-2026-09-08.md` §4).
**Prioridade:** P3 | **Esforço:** M | **Risco:** LOW técnico, MED de desperdício.
**Depende de:** S-PROG-01 a S-PROG-04 **em produção, com pelo menos um mês de uso real**.

## Contexto

As S-PROG-01 a 05 já entregam três camadas de ajuda sem dependência nova: tooltip/popover nos campos
não óbvios, ajuda sempre visível (placeholder, contador, estado vazio) e o painel de revisão em
linguagem comum. Um tour guiado é a camada seguinte — e a única que custa dependência.

`package.json` do `cuca-portal` **não tem** `driver.js`, `shepherd.js` nem `react-joyride` hoje.
Adicionar qualquer um é decisão de infraestrutura, e guardar "esta pessoa já viu o tour" exige coluna
ou tabela nova.

## Gatilho para tirar da espera

Esta story só deve ser iniciada se, após um ciclo mensal completo de uso real pela junta técnica,
houver evidência de que as camadas existentes não bastaram — por exemplo: pedidos recorrentes de
suporte sobre o mesmo passo, ou programações enviadas com o mesmo tipo de erro repetido.

**Sem essa evidência, a story permanece em espera.** Construir um tour "por precaução" é trabalho que
compete com o backlog real e adiciona dependência sem retorno comprovado.

## Escopo, se ativada

1. Tour de 5-7 passos na primeira abertura do editor: abas por categoria, edição em célula, ficha da
   atividade, preencher abaixo, painel de revisão, enviar para aprovação.
2. Persistência de "já viu" por usuário.
3. Link "ver o tour de novo" acessível a qualquer momento — quem esqueceu não pode ficar sem.

## Dev Agent Record

_(não iniciar sem decisão do Junior)_

## Change Log

| Data | Autor | Mudança |
|---|---|---|
| 2026-09-08 | @sm (River) | Story criada em espera |
