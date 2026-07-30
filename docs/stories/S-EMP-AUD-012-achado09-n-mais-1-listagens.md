# S-EMP-AUD-012 — N+1 em 2 telas de listagem (achado #9)

**Status:** Ready
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/012-achado09-n-mais-1-listagens.md`
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 012" — confirmado em `worker/empregabilidade_engine.py:1219` e `:1349`
**Prioridade:** P3 | **Esforço:** S | **Risco:** BAIXO
**Ordem de execução proposta:** Bloco 6 — qualquer ordem, sem dependência com os demais. Sugestão de sequência (não bloqueante): depois do Plano 007, que toca código próximo (`_listar_vagas_para_acao`), pra evitar conflito de merge.

## Contexto

2 pontos fazem consulta dentro de loop (N+1), sem batching: `:1219-1237` (listagem de vagas da empresa — pra cada vaga, até 10, 1 query separada em `candidaturas` só pra contar candidatos) e `:1349-1352` (busca de candidatura por nome — pra cada candidatura encontrada, até 5, 1 query separada em `vagas` só pra pegar o título).

## Valor de negócio

Reduz latência e carga no banco nas 2 telas de listagem mais usadas pela empresa (consultar vagas cadastradas, buscar candidatura) — hoje cada listagem gera até 10 queries extras.

## Dependência real

Nenhuma dependência real. Sugestão de sequência com o Plano 007 é só cortesia de merge, não bloqueante.

## Acceptance Criteria

- [ ] `:1219-1237` — contagem de candidatos por vaga vira 1 query batelada (ex.: `.in_("vaga_id", [ids])` + agrupamento em Python), não mais 1 por vaga
- [ ] `:1349-1352` — título de vaga por candidatura vira 1 query batelada, não mais 1 por candidatura
- [ ] Suíte completa passando, sem regressão de comportamento visível (mesmos dados exibidos, só menos queries)

## Escopo

**In:** os 2 pontos citados (`:1219-1237`, `:1349-1352`).
**Out:** qualquer outra tela de listagem fora dessas 2; mudança de layout/dado exibido.

## Test plan

Ver "Test plan" do plano.

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 012.
- v0.2 (2026-07-29): @po validou — NO-GO (5/10) por Escopo/Valor de negócio ausentes e AC genérico.
- v0.3 (2026-07-29): @po corrigiu as 3 pendências (os 2 pontos detalhados, Valor de negócio adicionado, AC específico) — GO. Status Draft → Ready.
