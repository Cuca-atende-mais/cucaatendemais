# S-EMP-AUD-002 — Consulta de candidatura para de vazar dado de terceiro (SEC-02)

**Status:** Ready
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/002-sec02-consulta-candidatura-vaza-dado-terceiro.md` (ler o plano completo — Step 1, Test plan, STOP conditions)
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 002"
**Prioridade:** P1 | **Esforço:** S | **Risco:** LOW
**Ordem de execução proposta:** Bloco 1 (junto com 001, 003) — independente das demais

## Contexto

As buscas por telefone e nome na etapa `aguardando_id_candidato` (`worker/empregabilidade_engine.py:1298-1336`) usam o valor **digitado na mensagem**, nunca o `phone` real de quem está mandando a mensagem. Qualquer pessoa que souber o nome/telefone de um candidato consegue puxar o status da candidatura e as `observacoes` internas do recrutador.

## Valor de negócio

Impede vazamento de status de candidatura e das `observacoes` internas do recrutador para quem não é o próprio candidato (ex-empregador, familiar, golpista) — dado pessoal exposto sem prova de identidade.

## Decisão de produto aplicada (sócio, 2026-07-29)

Normalizar os **2 lados** da comparação de telefone, não só o `phone` recebido. Verificação ao vivo em produção mostrou `candidaturas.telefone` com formatação inconsistente (46 linhas puro-dígito, 78 formatadas, ex. `"(85) 92146-7046"`) — comparar só um lado normalizado faria o fix falhar silenciosamente pra maioria dos registros reais. A busca por telefone/nome passa a trazer candidatas por período e filtrar em Python comparando ambos os lados normalizados (não mais `.eq()` direto no banco). +1 teste no plano (6 no total).

## Dependência real

Nenhuma. Pode ser implementada isoladamente.

## Acceptance Criteria

- [ ] Busca por telefone só retorna candidatura cujo `telefone` normalizado bate com o `phone` normalizado de quem pergunta
- [ ] Busca por nome exige também bater o telefone normalizado (nome sozinho não basta)
- [ ] Busca por código de referência (6 chars) permanece inalterada (não é PII, é token)
- [ ] Fix funciona mesmo com `candidaturas.telefone` formatado (teste #6, decisão do sócio)
- [ ] 6 testes novos + suíte completa passando

## Escopo

In: bloco de 4 estratégias de busca em `_processar_candidato`, etapa `aguardando_id_candidato` (`:1298-1336`), + testes.
Out: busca por código de referência (já segura), qualquer outro achado da auditoria, mudança de texto do bot além do necessário.

## Test plan

6 testes (ver plano — 5 originais + o novo de telefone formatado).

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 002, com a normalização dos 2 lados e o 6º teste (decisão do sócio) já incorporados.
- v0.2 (2026-07-29): @po validou — GO (8/10). Status Draft → Ready. Pontos fortes: AC específico, risco de dado real (formatação inconsistente) documentado com evidência.
- v0.3 (2026-07-29): @po adicionou seção "Valor de negócio" explícita.
