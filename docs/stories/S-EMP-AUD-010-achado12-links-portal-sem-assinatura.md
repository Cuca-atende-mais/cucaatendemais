# S-EMP-AUD-010 — Links do portal sem assinatura nem expiração (achado #12)

**Status:** Ready for Review
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

- [x] Assinatura HMAC implementada (reaproveitando o padrão de `cuca-portal/src/lib/auctaflux/webhook.ts`, `crypto.createHmac`/`crypto.timingSafeEqual`) cobrindo as **4 páginas** confirmadas (não só 1)
- [x] Verificação de assinatura no lado servidor, não só cosmética no front
- [x] Suíte/typecheck do portal passando

## Escopo

Ver "Scope" do plano — cobrir as 4 páginas confirmadas na verificação da equipe, não só a amostra original da auditoria.

## Test plan

Ver "Test plan" do plano.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Drift pós-Bloco 4: `rg` encontrou 7 gerações de links para as 4 rotas públicas; todos foram cobertos, incluindo reenvios de link.
- Baseline worker: `cd worker && ../.venv/bin/python -m pytest tests/test_empregabilidade_engine.py -v` resultou em `47 passed, 2 warnings`.
- Baseline portal: `cd cuca-portal && npx tsc --noEmit` falhou por TS5097 preexistente em testes que importam `.ts`; comando adotado nos blocos anteriores (`npx tsc --noEmit --allowImportingTsExtensions`) passou.
- Compatibilidade HMAC Python→Node validada com link gerado por `_assinar_link_portal` e verificado via `crypto.createHmac("sha256", "segredo-teste")`: `valido=true`.
- Validação final worker: `cd worker && ../.venv/bin/python -m pytest tests/test_intencao_detector.py tests/test_empregabilidade_engine.py -v` resultou em `81 passed, 2 warnings`.
- Validação final portal: `cd cuca-portal && npx tsc --noEmit --allowImportingTsExtensions` passou.
- Validação final portal: `cd cuca-portal && npm test` resultou em `24 passed`.

### Completion Notes

- Criado `_assinar_link_portal` no worker com HMAC-SHA256, `exp` e fail-open logado quando `EMPREGABILIDADE_LINK_SECRET` não está configurado.
- As quatro rotas públicas do portal (`candidatura`, `vagas/editar`, `vagas/nova`, `selecao/nova`) agora recebem links assinados pelo worker.
- Criado helper server-side do portal com `crypto.createHmac` e `crypto.timingSafeEqual`, mais endpoint `/api/empregabilidade/link-assinado` para validação inicial das páginas client-side.
- API routes públicas de edição/criação/candidatura/seleção também validam `link_params` no servidor antes de ler ou gravar dados sensíveis.
- Documentada `EMPREGABILIDADE_LINK_SECRET` em `worker/.env.example` e `cuca-portal/.env.example`; o valor real precisa ser o mesmo nos serviços worker e portal no EasyPanel.

### File List

- `worker/empregabilidade_engine.py`
- `worker/tests/test_empregabilidade_engine.py`
- `worker/.env.example`
- `cuca-portal/.env.example`
- `cuca-portal/src/lib/empregabilidade/link-assinado.ts`
- `cuca-portal/src/lib/empregabilidade/link-assinado-client.ts`
- `cuca-portal/src/app/api/empregabilidade/link-assinado/route.ts`
- `cuca-portal/src/app/api/empregabilidade/vagas/[id]/route.ts`
- `cuca-portal/src/app/api/empregabilidade/vagas/route.ts`
- `cuca-portal/src/app/api/empregabilidade/candidaturas/route.ts`
- `cuca-portal/src/app/api/empregabilidade/selecao/route.ts`
- `cuca-portal/src/app/empregabilidade/vagas/editar/page.tsx`
- `cuca-portal/src/app/empregabilidade/vagas/nova/page.tsx`
- `cuca-portal/src/app/empregabilidade/selecao/nova/page.tsx`
- `cuca-portal/src/app/empregabilidade/candidatura/page.tsx`

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 010, com o escopo ampliado para as 4 páginas confirmadas.
- v0.2 (2026-07-29): @po validou — GO (7/10). Status Draft → Ready. Ponto forte: escopo restatado diretamente (4 páginas nomeadas), risco elaborado (checagem de posse circular na API).
- v0.3 (2026-07-29): @po adicionou "Valor de negócio" explícito.
- v0.4 (2026-07-30): @dev implementou links assinados HMAC no worker e validação server-side no portal. Status Ready → Ready for Review.
