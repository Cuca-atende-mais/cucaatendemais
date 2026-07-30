# S-EMP-AUD-001 — Empresa deixa de ser "autenticada" só pelo CNPJ (SEC-01)

**Status:** InProgress (parcial — ver v0.4 no Change Log)
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
