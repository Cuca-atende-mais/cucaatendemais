# S-PROG-07 — Transbordo humano quando o lead pergunta sobre programação de meses anteriores

**Status:** Draft
**Epic:** Reestruturação da criação de programação
**Origem:** Regra levantada pelo Junior em 2026-09-08 — "caso um lead queira saber sobre programações
de meses anteriores, a automação deve chamar o transbordo e o humano investigar o interesse".
**Prioridade:** P2 | **Esforço:** S-M | **Risco:** MED — mexe em prompt e em regra de handover, que
tem interação conhecida com a regra 5 (ver abaixo).
**Depende de:** nada.

## Contexto — a regra NÃO está implementada hoje

Verificação em produção e no código (2026-09-08):

1. O agente só enxerga o `monthly_program` com `ativo = true` — um por unidade
   (`motor-agente/index.ts:1051, 1078, 1122`, todos com `.eq("ativo", true)`). Hoje as 5 unidades têm
   **setembro/2026** ativo. Campanhas de meses anteriores são desativadas pelo trigger.
2. Logo, **programação de mês anterior é literalmente inalcançável** para o agente — não existe risco
   de ele responder com dado velho. Esse lado está correto.
3. **Mas o comportamento pedido não acontece.** A regra 2 de `INSTRUCAO_SEGURANCA` manda, quando a
   informação não está no contexto, "dizer que não encontrou na programação atual e sugerir falar com a
   unidade" — uma resposta de encerramento, **não** um `[[HANDOVER]]`. O lead que perguntou sobre agosto
   recebe "não encontrei" e a conversa morre ali, sem ninguém investigar o interesse.
4. Agrava: a **regra 5** proíbe explicitamente `[[HANDOVER]]` sempre que o usuário menciona o nome de
   uma unidade CUCA ("isso é sempre uma consulta de programação, nunca um pedido de atendimento
   humano"). "Tinha natação no Mondubim em agosto?" cai exatamente nessa proibição.

**Conclusão:** a regra que o Junior descreveu como "deve estar assim, e se não estiver está errado"
**não está assim**. É um gap real, não uma confirmação.

## O que precisa ser implementado

### 1. Detectar referência a mês anterior

Detecção **determinística**, não delegada ao LLM: procurar na mensagem nome de mês (ou "mês passado",
"mês retrasado", "no mês de X") e comparar com o mês da campanha ativa. Só dispara quando o mês citado
é **anterior** ao ativo — perguntar sobre o mês corrente ou sobre "o próximo mês" não é este caso.

### 2. Acionar transbordo com contexto

Quando detectado: marcar a conversa como `awaiting_human` pelo mesmo caminho já existente
(`conversas.status = "awaiting_human"`, `index.ts:1296` / `1862`) e responder algo como *"Essa
programação já encerrou. Vou te passar para alguém da equipe entender o que você procura."* — a
resposta precisa dizer **por que** está transferindo, senão o lead acha que travou.

O atendente humano precisa receber o contexto: qual mês foi perguntado e qual atividade, para
"investigar o interesse" como o Junior descreveu.

### 3. Conciliar com a regra 5

A regra 5 existe para impedir que citar "Mondubim" vire handover. Esta story cria uma exceção
**estreita**: mês anterior explícito. A regra 5 precisa ser reescrita para dizer isso, e o caso novo
precisa de teste — senão a próxima pessoa que ler a regra 5 desfaz esta story sem perceber.

## Análise de impacto (`impact-analysis-mandatory.md`)

- **Toca:** `INSTRUCAO_SEGURANCA` (regras 2 e 5) e a lógica de handover do `motor-agente`.
- **Consome hoje:** todo lead que fala com o agente institucional; a fila de atendimento humano.
- **Impacto observável — positivo:** interesse por atividade encerrada vira conversa com uma pessoa,
  em vez de "não encontrei".
- **Impacto observável — negativo:** **aumenta o volume de transbordo.** Se a detecção for larga demais
  (ex.: pegar qualquer nome de mês, inclusive "começa em setembro?"), a fila humana enche de conversa
  que a automação resolveria. Por isso a detecção é determinística e restrita a mês **anterior**.
- **De-risk:** testes em `index.test.ts` cobrindo (a) mês anterior → handover, (b) mês corrente → sem
  handover, (c) nome de unidade sem mês → sem handover (regra 5 preservada). Rodar
  `deno test supabase/functions/motor-agente/` antes e depois.
- **Pergunta em aberto:** o transbordo deve valer no horário em que não há atendente? Hoje o lead ficaria
  em `awaiting_human` sem resposta. Ver se o comportamento atual de fila já cobre isso.

## Acceptance Criteria

1. "Tinha natação no Mondubim em agosto?" com setembro ativo → conversa vai para `awaiting_human` com
   resposta explicando o motivo.
2. "Tem natação no Mondubim?" (sem mês) → **não** dispara handover; segue o fluxo de programação atual.
3. "A programação de setembro tem natação?" com setembro ativo → **não** dispara handover.
4. O atendente humano recebe qual mês e qual atividade foram perguntados.
5. `deno test supabase/functions/motor-agente/` verde, com os 3 casos acima cobertos.

## Dev Agent Record

_(preencher durante a implementação)_

## Change Log

| Data | Autor | Mudança |
|---|---|---|
| 2026-09-08 | @po (Pax) | Story criada a partir da verificação do gap |
