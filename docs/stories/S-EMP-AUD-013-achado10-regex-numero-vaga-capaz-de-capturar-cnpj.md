# S-EMP-AUD-013 — Regex de número de vaga pode capturar dígito de CNPJ (achado #10)

**Status:** Draft
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/013-achado10-regex-numero-vaga-capaz-de-capturar-cnpj.md`
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 013" — confirmado em `worker/empregabilidade_engine.py:487, 570, 1192` (`re.search(r"\b(\d{1,4})\b", texto)`)
**Prioridade:** P3 | **Esforço:** S | **Risco:** BAIXO
**Ordem de execução proposta:** Bloco 6 — qualquer ordem, sem dependência com os demais

## Contexto

`\b(\d{1,4})\b` captura sequências de 1-4 dígitos cercadas por fronteira de palavra — pontuação conta como fronteira, então um CNPJ como `12.345.678/0001-90` pode ter um trecho capturado como se fosse "número da vaga". Diferente do EMP-01 (Plano 004, palavra-dentro-de-palavra): aqui o problema é dígito-embutido-em-sequência-pontuada — a correção é `(?:^|\s)...(?:\s|$)`, não `\b` (que já está presente e não resolve).

## Dependência real

Nenhuma.

## Acceptance Criteria

- [ ] Os 3 pontos citados (`:487, 570, 1192`) usam o padrão correto (`(?:^|\s)...(?:\s|$)`), não mais só `\b`
- [ ] Teste confirmando que um CNPJ não é interpretado como número de vaga
- [ ] Suíte completa passando

## Escopo

Ver "Scope" do plano.

## Test plan

Ver "Test plan" do plano.

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 013.
