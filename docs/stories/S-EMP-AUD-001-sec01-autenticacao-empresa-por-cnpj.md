# S-EMP-AUD-001 — Empresa deixa de ser "autenticada" só pelo CNPJ (SEC-01)

**Status:** Ready for Review
**Epic:** Auditoria Empregabilidade (2026-07-29)
**Origem:** `docs/Auditoria Empregabilidade - Cuca Atende/plans/001-sec01-autenticacao-empresa-por-cnpj.md` (ler o plano completo antes de implementar — Steps 1-5, Test plan, STOP conditions)
**Verificação cruzada:** `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`, seções "Plano 001" e "Ciclo completo de autenticação"
**Prioridade:** P1 | **Esforço:** M | **Risco:** MED
**Ordem de execução proposta:** Bloco 1 (junto com 002, 003) — independente das demais

## Contexto

Hoje qualquer conversa que informe os 14 dígitos de um CNPJ já cadastrado recebe `empresa_id` sem nenhuma verificação contra o número real de quem está mandando a mensagem (`worker/empregabilidade_engine.py:753-768`). CNPJ não é segredo — qualquer um que souber o CNPJ de uma empresa concorrente pode assumir a identidade dela.

## Valor de negócio

Fecha o maior risco de segurança do módulo: hoje qualquer pessoa que souber um CNPJ (não é segredo) pode assumir a identidade de uma empresa real e cancelar/editar vagas dela, ou ver quantas candidaturas recebeu.

## Decisão de produto aplicada (sócio, 2026-07-29)

Desenho v2 já definido no plano: 1º WhatsApp que tocar um CNPJ se vincula automaticamente; qualquer outro precisa de verificação humana via transbordo (tabela nova `empresa_whatsapp_autorizados`). **Adição fechada nesta rodada — Step 5 novo do plano:** o endpoint de autorização (Step 3) passa a reverter `conversas.status` de `awaiting_human` para `ativa` e avisar o lead automaticamente, buscando a conversa por **telefone → lead_id** (nunca por `empresa_id`, que é zerado no transbordo). Sem isso, autorizar um número exigia 2 ações manuais desconectadas e o lead nunca era avisado — gap confirmado em `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md`.

## Dependência real

Nenhuma. Pode ser implementada isoladamente.

## Acceptance Criteria

- [ ] Migration `empresa_whatsapp_autorizados` criada e aplicada (tabela, UNIQUE `(empresa_id, telefone)`, RLS conferida)
- [ ] 1º toque de um CNPJ nunca antes autorizado faz backfill automático (sem transbordo)
- [ ] Número diferente de um CNPJ já autorizado aciona transbordo real (`awaiting_human` + `_notificar_transbordo`), não mensagem estática
- [ ] Endpoint de autorização no portal, com checagem de permissão adequada (não `DEVELOPER_EMAILS`) e 409 em conflito de UNIQUE
- [ ] Endpoint de autorização reverte `awaiting_human` → `ativa` e envia mensagem automática ao lead (Step 5) — busca por telefone → lead → conversa
- [ ] Ação de UI mínima em `empregabilidade/empresas/page.tsx` pra listar/adicionar números autorizados
- [ ] 4 testes novos do plano + suíte completa passando

## Escopo

Ver "Scope" do plano — inclui migration, `_processar_empresa` (branch de empresa existente + inserção de empresa nova), endpoint + UI do portal, Step 5 novo. Não inclui revogação de número, verificação fora de banda antes do 1º vínculo, nem login/senha completo (decisões de produto separadas, já descartadas pelo Junior).

## Test plan

4 testes em `TestEscapeHatchAguardandoCnpj` (ver plano, Step do Test plan) + teste manual do Step 5 (simular transbordo, autorizar, confirmar reversão de status e envio de mensagem).

## Change Log

- v0.1 (2026-07-29): Story criada por @sm River a partir do Plano 001, com o Step 5 (decisão do sócio) já incorporado.
- v0.2 (2026-07-29): @po validou — GO (8/10). Status Draft → Ready. Pontos fortes: AC concreto, dependências e riscos mapeados, decisão de produto (Step 5) documentada com justificativa.
- v0.3 (2026-07-29): @po adicionou seção "Valor de negócio" explícita — corrige critério aplicado de forma inconsistente entre as 19 stories na v0.2 (ver nota consolidada no relatório desta rodada).
- v0.4 (2026-07-29): @dev implementou Steps 1-2 (commit `dadd4fa`, branch `feat/auditoria-empregabilidade-p1`) — migration aplicada em produção (RLS habilitada, policy de leitura via `has_permission`), `_processar_empresa` corrigido (checagem de autorização + backfill nos 2 pontos de inserção de empresa nova), 4 testes com mutation check. **Steps 3-5 NÃO implementados — STOP condition do próprio plano**: nenhuma rota server-side do portal (nem as do módulo empregabilidade) checa permissão granular hoje, só sessão autenticada (`auth.getUser()`); esse endpoint concede controle de uma empresa a um número de WhatsApp, então "qualquer colaborador logado" é proteção mais fraca que o problema que este plano fecha. Decisão pendente: qual permissão usar (recomendação do @dev: `has_permission('empreg_vagas', 'update')`, mesma da policy de UPDATE de `empresas`). Status permanece InProgress até essa decisão liberar os Steps 3-5.
- v0.5 (2026-07-29): @dev retomou com decisão do Junior: endpoint + UI protegidos por `has_permission('empreg_vagas', 'update')`. Steps 3-5 implementados no portal: rota `autorizar-whatsapp` lista/insere números autorizados, trata UNIQUE com 409, grava `autorizado_por`, busca conversa por telefone -> lead -> `conversas.status='awaiting_human'`, reativa para `ativa` e aciona envio automático ao lead via worker `/send-message/{token}` com `conversa_id`. UI mínima adicionada em `empregabilidade/empresas` com botão/modal visível só para quem tem `empreg_vagas:update`. Status InProgress -> Ready for Review. Sem push/PR/deploy.
- v0.6 (2026-07-29): @dev corrigiu somente o achado HIGH do gate CONCERNS da @qa. Endpoint ficou idempotente para número já autorizado (`23505`/registro existente não bloqueia retentativa), e o Step 5 agora é recuperável: quando há conversa `awaiting_human`, o endpoint envia o aviso primeiro; se o worker/configuração falhar, retorna `502` explícito sem reativar a conversa, permitindo nova tentativa; só depois de aviso enviado atualiza `conversas.status` para `ativa`. UI passou a exibir “lead avisado” somente quando `aviso_lead.sent=true`. Sem correções fora do achado HIGH.

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- `cd cuca-portal && npx tsc --noEmit` — falhou apenas no baseline existente TS5097 em 4 testes que importam arquivos com extensão `.ts`: `tests/acompanhamento-envios-limite-diario-logic.test.ts`, `tests/acompanhamento-envios-logic.test.ts`, `tests/acompanhamento-envios-reenviar-logic.test.ts`, `tests/divulgacao-disparar-logic.test.ts`.
- `cd cuca-portal && npx tsc --noEmit --allowImportingTsExtensions` — passou.
- `cd cuca-portal && npm test` — passou: 1 arquivo, 24 testes.
- `cd cuca-portal && npm run lint` — interrompido após vários minutos sem output.
- `cd cuca-portal && npx eslint 'src/app/api/empregabilidade/empresa/[id]/autorizar-whatsapp/route.ts' 'src/app/(dashboard)/empregabilidade/empresas/page.tsx'` — passou sem erros; 2 warnings preexistentes na página (`Textarea` não usado e dependency de `useEffect`).
- Pós-correção HIGH QA: `cd cuca-portal && npm test` — passou: 1 arquivo, 24 testes.
- Pós-correção HIGH QA: `cd cuca-portal && npx tsc --noEmit --allowImportingTsExtensions` — passou.
- Pós-correção HIGH QA: `cd cuca-portal && npx eslint 'src/app/api/empregabilidade/empresa/[id]/autorizar-whatsapp/route.ts' 'src/app/(dashboard)/empregabilidade/empresas/page.tsx'` — passou sem erros; mesmas 2 warnings preexistentes na página.

### Completion Notes List

- Steps 3-5 concluídos usando a permissão confirmada `empreg_vagas:update`, sem `DEVELOPER_EMAILS` como proteção do endpoint.
- O envio automático ao lead é acionado somente quando há conversa `awaiting_human` encontrada pelo caminho exigido telefone -> lead -> conversa. Autorizações preventivas sem conversa em transbordo concluem sem erro e sem envio.
- Correção do achado HIGH da QA: autorização existente não retorna mais 409 e continua tentando concluir Step 5; falha no aviso não reativa a conversa e retorna erro recuperável para nova tentativa; UI não promete aviso quando `aviso_lead.sent=false`.
- Achados para @qa registrar no Bloco 1, sem correção nesta story: CPF tem brecha análoga à SEC-02; existem cerca de 12 telefones com dígitos implausíveis em candidaturas.
- Recomendação: acionar @qa para revisar o Bloco 1 inteiro, isto é, S-EMP-AUD-001 completo + S-EMP-AUD-002 + S-EMP-AUD-003, antes de qualquer liberação para Bloco 2 (004-007).

### File List

- `cuca-portal/src/app/api/empregabilidade/empresa/[id]/autorizar-whatsapp/route.ts`
- `cuca-portal/src/app/(dashboard)/empregabilidade/empresas/page.tsx`

## QA Results

### Review 2026-07-29 — @qa Quinn — Gate: CONCERNS

**Achado 1 — HIGH:** o Step 5 pode concluir parcialmente e deixar o operador sem caminho idempotente para completar a reativação/aviso. Em `cuca-portal/src/app/api/empregabilidade/empresa/[id]/autorizar-whatsapp/route.ts:132-145`, o número é inserido antes de buscar/reactivar a conversa e enviar o aviso; se qualquer operação posterior falhar, uma nova tentativa no mesmo endpoint retorna `409` e não executa novamente a reativação/aviso. Além disso, `notificarLeadAutorizado()` engole falhas de worker/configuração (`:42-73`) e a UI informa “conversa reativada e lead avisado” apenas por `conversa_reativada` (`empresas/page.tsx:243-246`), mesmo quando `aviso_lead.sent=false`. Isso viola a garantia operacional do Step 5: autorizar deve devolver a conversa para IA e avisar o lead de forma confiável/observável. Recomendação: tornar o endpoint idempotente para número já autorizado, sempre tentar Step 5 quando houver conversa `awaiting_human`, e só mostrar “lead avisado” quando o envio realmente retornar sucesso; se o envio falhar, retornar sucesso parcial explícito ou erro recuperável sem bloquear retentativa.

**Cobertura/validação:** worker via `.venv`: 34 passed / 3 failed esperados do Bloco 2 ainda não liberado. Portal: `npm test` passou (24 testes); `npx tsc --noEmit --allowImportingTsExtensions` passou; `npx tsc --noEmit` falha no baseline TS5097 em 4 testes de acompanhamento/divulgação; ESLint focal da rota/página passou sem erros, com 2 warnings preexistentes na página de empresas.

**Notas para follow-up:** CPF mantém brecha análoga à SEC-02 em `worker/empregabilidade_engine.py:1412-1420`, conforme STOP condition do Plano 002; não corrigido nesta story por instrução explícita. Também registrar investigação posterior para cerca de 12 telefones implausíveis em candidaturas.

### Re-review 2026-07-29 — @qa Quinn — Gate: PASS com follow-ups

**Resultado:** achado HIGH da revisão anterior foi corrigido. O endpoint `autorizar-whatsapp` agora é idempotente para número já autorizado/concorrência de UNIQUE, tenta completar o Step 5 mesmo quando a autorização já existe, e não reativa a conversa se o aviso automático ao lead falhar. A UI também só afirma “lead avisado” quando `aviso_lead.sent=true`. Com isso, o Bloco 1 fica aprovado para seguir ao próximo estágio de revisão/commit, mantendo apenas follow-ups fora do escopo atual.

**Evidência do Bloco 1:** `../.venv/bin/python -m pytest tests/test_empregabilidade_engine.py -v` resultou em 34 passed / 3 failed esperados do Bloco 2 ainda não liberado; todos os testes de S-EMP-AUD-001/002/003 passaram. Portal: `npm test` passou (24 testes); `npx tsc --noEmit --allowImportingTsExtensions` passou; ESLint focal da rota/página passou sem erros, com 2 warnings preexistentes na página de empresas.

**Follow-ups mantidos:** CPF com brecha análoga à SEC-02 e cerca de 12 telefones implausíveis em candidaturas seguem registrados para plano/backlog separado, conforme instrução explícita de não corrigir agora.
