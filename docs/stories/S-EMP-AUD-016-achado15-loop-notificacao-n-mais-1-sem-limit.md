# S-EMP-AUD-016 — Loop de notificação: N+1 de lead + query externa sem `.limit()` (achado #15)

**Status:** Ready
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/016-achado15-loop-notificacao-n-mais-1-sem-limit.md`
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 016" — confirmado em `worker/empregabilidade_engine.py:2606-2608`; volume real hoje é 0 (nota: reflete a limitação de retenção da tabela `conversas`, não confirma ausência histórica de volume — ver seção de abertura do documento de proposta)
**Prioridade:** P3 | **Esforço:** S/M | **Risco:** BAIXO
**Ordem de execução proposta:** Bloco 6 — qualquer ordem, sem dependência com os demais

## Contexto

`empregabilidade_notify_loop` consulta `conversas` sem `.limit()` e faz N+1 de `leads` por conversa — sem paginação, pode crescer sem controle.

## Valor de negócio

Evita que o loop de notificação (roda a cada 20s, em background, todo o tempo em que o worker está de pé) fique mais lento e mais caro conforme o volume de conversas ativas crescer — preventivo, não corrige um problema com usuário afetado hoje.

## Dependência real

Nenhuma.

## Acceptance Criteria

- [ ] Query de `conversas` em `:2606-2608` ganha `.limit()` (valor a definir conforme volume esperado — plano não prescreve número fixo)
- [ ] N+1 de `leads` por conversa vira 1 query batelada (`.in_("id", [lead_ids])`), não mais 1 por conversa
- [ ] Suíte completa passando, sem mudança de comportamento visível pro usuário

## Escopo

**In:** a query de `conversas` e o N+1 de `leads` dentro de `empregabilidade_notify_loop` (`:2606-2608` e a leitura de `leads` logo abaixo).
**Out:** a lógica de notificação em si (o que é enviado e quando).

## Test plan

Ver "Test plan" do plano.

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 016.
- v0.2 (2026-07-29): @po validou — NO-GO (5/10) por Escopo/Valor de negócio ausentes e AC genérico.
- v0.3 (2026-07-29): @po corrigiu as 3 pendências — GO. Status Draft → Ready.
