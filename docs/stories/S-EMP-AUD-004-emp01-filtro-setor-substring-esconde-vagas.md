# S-EMP-AUD-004 — Filtro de setor por substring esconde vagas já na 1ª mensagem (EMP-01)

**Status:** Draft
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/004-emp01-filtro-setor-substring-esconde-vagas.md`
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 004" — confirmado em `worker/empregabilidade_engine.py:2508`
**Prioridade:** P1 | **Esforço:** S | **Risco:** BAIXO
**Ordem de execução proposta:** Bloco 2 (junto com 005, 006, 007) — independentes entre si e dos blocos 1/3/4

## Contexto

`worker/intencao_detector.py:extrair_setor_da_mensagem` casa setor por substring solta (`setor_canonical.lower() in (s or "").lower()`, usado em `empregabilidade_engine.py:2508`) — "entregar" (verbo comum em "quero entregar meu currículo") contém "entrega" e é lido como menção ao setor Logística, escondendo vagas de outras áreas.

## Dependência real

**Bloqueada pelo Passo 0 (commit dos testes locais) — já resolvido em 2026-07-29** (commit `3ab3b96`, `worker/tests/`). Teste vermelho já existe e está commitado: `test_entregar_curriculo_nao_deveria_disparar_filtro_de_logistica` em `worker/tests/test_intencao_detector.py`.

## Acceptance Criteria

- [ ] `test_entregar_curriculo_nao_deveria_disparar_filtro_de_logistica` (`worker/tests/test_intencao_detector.py`) passa
- [ ] Suíte completa passando, sem regressão nas outras checagens de setor

## Escopo

Ver "Scope" do plano — correção pontual em `extrair_setor_da_mensagem`/ponto de uso em `:2508`.

## Test plan

Teste já escrito e commitado — só rodar `cd worker && python -m pytest tests/test_intencao_detector.py -v` e confirmar verde após o fix.

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 004. Passo 0 (commit do teste) já resolvido nesta mesma rodada.
