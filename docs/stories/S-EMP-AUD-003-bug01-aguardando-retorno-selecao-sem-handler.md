# S-EMP-AUD-003 — `aguardando_retorno_selecao` ganha handler síncrono (BUG-01)

**Status:** Draft
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/003-bug01-aguardando-retorno-selecao-sem-handler.md`
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 003" — confirmamos ao vivo que o lado assíncrono (`empregabilidade_notify_loop`, `:2678-2709`) já lê/escreve `vaga_criada_id`/`vaga_numero` corretamente para o fluxo de seleção (o portal grava esses campos em `selecao/route.ts:84-101`, mesmo padrão de `vagas/route.ts`) — não é código morto, só falta o lado síncrono.
**Prioridade:** P1 | **Esforço:** S | **Risco:** BAIXO-MED
**Ordem de execução proposta:** Bloco 1 (junto com 001, 002) — independente das demais

## Contexto

Falta um handler síncrono para a etapa `aguardando_retorno_selecao` — se o usuário manda mensagem manualmente antes do loop assíncrono (`empregabilidade_notify_loop`, roda a cada 20s) notificar, a mensagem cai em algum handler genérico/errado em vez de ser tratada corretamente.

## Dependência real

Nenhuma. Pode ser implementada isoladamente.

## Acceptance Criteria

- [ ] Handler síncrono adicionado para `aguardando_retorno_selecao`, espelhando o tratamento já existente pra `aguardando_retorno_vaga`
- [ ] Confirmado que não há regressão no lado assíncrono já funcional
- [ ] Testes cobrindo o novo handler

## Escopo

Ver "Scope" do plano — escopo restrito ao handler síncrono da etapa citada.

## Test plan

Ver "Test plan" do plano.

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 003.
