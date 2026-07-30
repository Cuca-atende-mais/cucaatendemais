# S-EMP-AUD-009 — ~49 chamadas Supabase síncronas travam o event loop (BUG-02/PERF-01)

**Status:** Ready
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/009-bug02-perf01-chamadas-sincronas-no-event-loop.md`
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 009" — contagem recontada e confirmada ao vivo: `asyncio.to_thread` aparece 1x, `supabase.table(` aparece 49x em `empregabilidade_engine.py`
**Prioridade:** P1 | **Esforço:** L | **Risco:** ALTO (maior e mais arriscado dos 19 — ~49 pontos espalhados)
**Ordem de execução proposta:** Bloco 4 — só depois do Bloco 3 (Plano 008) fechado. Fazer em incrementos pequenos (ver detalhamento no próprio plano).

## Contexto

Praticamente todas as chamadas `supabase.table(...)` em `empregabilidade_engine.py` (49 pontos) são síncronas, chamadas dentro de handlers `async def` — cada uma bloqueia o event loop inteiro do worker, afetando todos os outros módulos (Institucional, Academia Enem) que rodam no mesmo processo.

## Dependência real

**Depende do Plano 008 (hard, dependência dura confirmada nos dois planos)** — não começar sem a cobertura de teste do 008 fechada, dado o tamanho e risco desta mudança.

**Nota para quem for implementar o Plano 011 depois (asyncio.Lock por conversa_id):** se este plano (009) rodar antes do 011, a integração entre o `asyncio.Lock` do 011 e o `asyncio.to_thread` deste plano precisa ser desenhada explicitamente — ver risco de compatibilidade documentado na story 011.

## Acceptance Criteria

- [ ] As ~49 chamadas Supabase síncronas envolvidas em `asyncio.to_thread` (ou abordagem equivalente definida no plano), em incrementos pequenos e testados
- [ ] Nenhuma regressão nos 3 fluxos críticos cobertos pelo Plano 008
- [ ] Suíte completa passando a cada incremento

## Escopo

Ver "Scope" do plano — escopo grande, dividido em incrementos (o próprio plano detalha a ordem sugerida).

## Test plan

Ver "Test plan" do plano — depende da cobertura estabelecida no Plano 008.

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 009, com nota de risco de compatibilidade com o Plano 011 registrada.
- v0.2 (2026-07-29): @po validou — GO (8/10). Status Draft → Ready. Ponto forte: risco (ALTO) justificado com números reais (49 pontos), dependência dura com 008 e risco de compatibilidade com 011 bem mapeados. Não bloqueante: "Valor de negócio" não está em seção própria (implícito — desbloqueio do event loop afeta todos os módulos no mesmo processo, não só Empregabilidade).
