# S-EMP-AUD-006 — Negação ignorada em `pos_candidatura` reabre busca de vagas (EMP-03)

**Status:** Draft
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/006-emp03-negacao-ignorada-pos-candidatura.md`
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 006" — confirmado em torno de `worker/empregabilidade_engine.py:1583-1619`
**Prioridade:** P1 | **Esforço:** S | **Risco:** BAIXO
**Ordem de execução proposta:** Bloco 2 (junto com 004, 005, 007) — independentes entre si e dos blocos 1/3/4

## Contexto

Na etapa `pos_candidatura`, "quero" como substring marca `quer_mais_vagas=True` sem checar negação — "não quero mais vagas, obrigado" contém "quero" e é lido como pedido de mais vagas. A etapa seguinte (`oferta_banco_talentos`) já tem a proteção de negação pra esse padrão; só não foi aplicada de volta aqui.

## Dependência real

**Bloqueada pelo Passo 0 (commit dos testes locais) — já resolvido em 2026-07-29** (commit `3ab3b96`). Teste vermelho commitado: `TestPosCandidaturaNegacaoIgnorada` em `worker/tests/test_empregabilidade_engine.py`.

## Acceptance Criteria

- [ ] `test_nao_quero_mais_vagas_nao_deveria_reabrir_busca_de_vagas` passa
- [ ] Suíte completa passando

## Escopo

Ver "Scope" do plano — replicar a proteção de negação já existente em `oferta_banco_talentos` para `pos_candidatura`.

## Test plan

Teste já escrito e commitado.

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 006. Passo 0 já resolvido.
