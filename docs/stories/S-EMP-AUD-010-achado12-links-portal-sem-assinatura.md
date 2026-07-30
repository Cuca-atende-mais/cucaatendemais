# S-EMP-AUD-010 — Links do portal sem assinatura nem expiração (achado #12)

**Status:** Ready
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/010-achado12-links-portal-sem-assinatura.md`
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seção "Plano 010" — risco confirmado mais amplo do que a amostra original: as 4 páginas (`candidatura`, `vagas/editar`, `vagas/nova`, `selecao/nova`) não têm assinatura; a API por trás (`vagas/[id]/route.ts`) faz uma checagem de posse circular (usa o próprio `empresa_id` da URL) — não mitiga o risco.
**Prioridade:** P2 | **Esforço:** M | **Risco:** MED
**Ordem de execução proposta:** Bloco 5 (junto com 011) — pode rodar em paralelo com os blocos 2-4, sem dependência real com eles

## Contexto

Links do portal enviados por WhatsApp (candidatura, edição/criação de vaga, seleção) não têm assinatura nem expiração — qualquer um que souber ou adivinhar a URL acessa/edita dados de uma empresa/candidatura sem provar que é o destinatário legítimo.

## Valor de negócio

Impede que alguém com a URL adivinhada ou reutilizada acesse ou edite dado real de outra empresa/candidato (vaga, candidatura, seleção) sem provar que é o destinatário legítimo do link.

## Dependência real

Nenhuma.

## Acceptance Criteria

- [ ] Assinatura HMAC implementada (reaproveitando o padrão de `cuca-portal/src/lib/auctaflux/webhook.ts`, `crypto.createHmac`/`crypto.timingSafeEqual`) cobrindo as **4 páginas** confirmadas (não só 1)
- [ ] Verificação de assinatura no lado servidor, não só cosmética no front
- [ ] Suíte/typecheck do portal passando

## Escopo

Ver "Scope" do plano — cobrir as 4 páginas confirmadas na verificação da equipe, não só a amostra original da auditoria.

## Test plan

Ver "Test plan" do plano.

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 010, com o escopo ampliado para as 4 páginas confirmadas.
- v0.2 (2026-07-29): @po validou — GO (7/10). Status Draft → Ready. Ponto forte: escopo restatado diretamente (4 páginas nomeadas), risco elaborado (checagem de posse circular na API).
- v0.3 (2026-07-29): @po adicionou "Valor de negócio" explícito.
