# S-WM-65 — Recriar/reaprovar `institucional_transbordo_v1` na WABA real

## Status
InProgress

## Origem
Diagnóstico de transbordo (Empregabilidade + Institucional), sessão de 2026-07-31/08-01. Item que já estava pendente de uma investigação anterior na mesma sessão (correção de `meta_phone_numbers`/`meta_templates` do Institucional) — na ocasião, Junior decidiu "seguir sem ele por ora" enquanto os outros 2 templates (`programacao_agosto_v3`, `aviso_ae_v2`) eram resolvidos.

## Complexidade
S (do ponto de vista de banco) — mas depende inteiramente de uma ação humana externa (Meta Business Manager) que não tem prazo controlável por nós.

## Prioridade
P2 — não bloqueia o transbordo do Institucional no nível de infraestrutura (S-WM-61/63/64 resolvem o mecanismo), mas sem este template a **notificação real ao humano** por WhatsApp falha com o mesmo erro `#132001` já visto e resolvido hoje pros outros 2 templates.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - GET /1035278895899806/message_templates?name=institucional_transbordo_v1 → status:"APPROVED" (ação humana prévia, fora do nosso controle)
  - SELECT waba_ids, phone_number_ids FROM meta_templates WHERE nome='institucional_transbordo_v1' AND ativo=true → deve bater com o template_id real confirmado via API
```

## Story

**Como** Junior (ou o sócio, com acesso ao Meta Business Manager),
**quero** que o template `institucional_transbordo_v1` seja recriado e aprovado sob a WABA real do número institucional novo,
**para que** a notificação de transbordo humano do Institucional (Empregabilidade já resolvida via S-WM-62) volte a funcionar de verdade, e não só pareça funcionar por causa do `try/except` amplo que hoje mascara a falha.

## Contexto e Problema

Já confirmamos hoje, por chamada real à Graph API (não print — mesmo rigor usado para os outros 2 templates do Institucional nesta sessão): `GET /1035278895899806/message_templates?name=institucional_transbordo_v1` retornou `data: []` — **o template nunca foi criado/aprovado na WABA real** (`1035278895899806`). Ele só existe aprovado na WABA antiga (`26300927882916268`), a mesma que os outros 2 templates do Institucional estavam presos antes de serem recriados hoje.

Diferente da S-WM-62 (que é só correção de dado no nosso banco), este item **não tem solução técnica isolada** — precisa que alguém com acesso ao Meta Business Manager recrie o template `institucional_transbordo_v1` (mesmo texto/formato do já existente na WABA antiga, ou uma versão ajustada) e submeta pra aprovação sob a WABA `1035278895899806`. Só depois disso um `@dev` atualiza `meta_templates` com o novo `template_id`/`waba_ids`/`phone_number_ids` confirmados via API — **exatamente o mesmo processo já seguido hoje** para `programacao_agosto_v3` e `aviso_ae_v2`.

## Escopo

### IN
1. **Ação humana (fora do pipeline @dev):** recriar/submeter `institucional_transbordo_v1` (ou nome equivalente, ex. `institucional_transbordo_v2`) no Meta Business Manager, sob a WABA `1035278895899806`.
2. **Depois de aprovado:** confirmar via Graph API real (`GET /1035278895899806/message_templates?name=...`) o `status: "APPROVED"` e capturar o `template_id` real.
3. Migration idempotente atualizando/criando o registro em `meta_templates` (mesmo padrão das migrations já aplicadas hoje: `waba_ids`, `phone_number_ids`, `status`, `template_id` registrado em comentário/relatório).
4. Se o nome do template mudar (ex. `_v2`), decidir Opção A (renomear registro existente) vs Opção B (novo registro + desativar antigo) — **mesma decisão já tomada hoje para os outros 2 templates: Opção B**, manter consistência.

### OUT
- Não inventa nem aprova nada sozinho — a aprovação é 100% da Meta, fora do nosso controle de prazo.
- Não mexe em `_notificar_transbordo` nem no mecanismo de notificação em si (S-WM-63/64).

## Acceptance Criteria

1. **Given** o template recriado no Business Manager, **when** confirmado via `GET /1035278895899806/message_templates?name=...`, **then** `status: "APPROVED"`.
2. **Given** a confirmação do AC 1, **then** `meta_templates` é atualizado (novo registro se o nome mudou, seguindo Opção B) com `waba_ids=['1035278895899806']`, `phone_number_ids=['1291080677418758']`, `status='aprovado'`, `ativo=true`, e o registro antigo (WABA errada) é desativado.
3. **Given** um teste real de transbordo no Institucional, **when** disparado, **then** a notificação chega de fato ao contato configurado (depende também da S-WM-61 e S-WM-63 já aplicadas).
4. Nenhuma correção de banco é aplicada **antes** da confirmação via API (repetir o erro já cometido 2x nesta sessão — corrigir `waba_ids` sem confirmação prévia — não é aceitável aqui).

## Tasks / Subtasks

- [x] **Task 0 — Bloqueante, ação humana** — Junior/sócio recria e submete o template no Business Manager, WABA `1035278895899806`.
- [x] **Task 1 — Confirmar aprovação via API** (AC: 1)
  - [x] `GET /1035278895899806/message_templates?name=<nome>` → confirmar `APPROVED`, capturar `template_id`.
- [x] **Task 2 — Migration** (AC: 2)
  - [x] Se nome mudou: `INSERT` novo registro + `UPDATE ativo=false` no antigo (Opção B, mesmo padrão de hoje).
  - [x] Se nome igual: `UPDATE` direto do registro existente.
- [ ] **Task 3 — Validar** (AC: 3)
  - [ ] Teste real coordenado com Junior, depois de S-WM-61/63/64 aplicadas.
- [ ] **Task 4 — Fechamento**

## Dev Notes

- Processo idêntico ao já seguido hoje 2x nesta sessão (ver migrations `20260731160225_substitui_templates_institucional_programacao_ae_v2.sql` como referência de formato — comentário com evidência de API, `template_id` real registrado, Opção B com `INSERT ... WHERE NOT EXISTS` + `UPDATE ativo=false`).
- **Não repetir o erro de "consertar antes de confirmar"** — esta sessão já corrigiu `waba_ids` errado 2 vezes seguidas confiando em evidência indireta (print, depois aprovação-sem-confirmar-membership) antes de finalmente confirmar via `GET /waba/phone_numbers`. Aqui, só aplicar migration DEPOIS do `GET /message_templates` confirmar `APPROVED` na WABA certa.
- Template atual (WABA errada, referência de conteúdo pra recriação, se for manter o mesmo texto): consultar `meta_templates.corpo_texto_aprovado` do registro `institucional_transbordo_v1` existente (`id=368d89fd-48d6-4063-989a-3af8e0df450f`).

### Testing
Sem teste automatizado — validação via Graph API real + teste manual de transbordo coordenado com Junior.

## Dependências
**Bloqueada pela Task 0 (ação humana, sem prazo controlável)**. Para validação de ponta a ponta (AC 3), depende também de **S-WM-61** e **S-WM-63** aplicadas.

## Git workflow
Sem branch de código — migration de dado, aplicada via MCP só depois da confirmação de API.

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-08-01 | 0.1 | Story criada a partir do item já pendente da sessão de correção de templates do Institucional (2026-07-31) — formalizado agora dentro do diagnóstico completo de transbordo. | @sm River |
| 2026-08-01 | 0.2 | **Validado por @po — GO.** 10/10 no checklist: escopo claro, dependência externa (ação humana no Business Manager) documentada como bloqueante em vez de escondida, AC exigem prova via API antes de qualquer mudança de banco (evita repetir o erro já cometido 2x nesta sessão). Sem pergunta em aberto. Status Draft → Ready. | @po Pax |
| 2026-08-01 | 0.3 | **Iniciada por @dev; bloqueada temporariamente.** Branch criada a partir de `origin/main`, mas a confirmação obrigatória via Graph API não pôde ser executada com sucesso com o token antigo local. Nenhuma migration aplicada naquele momento, conforme AC4. Status Ready → Blocked. | @dev Dex |
| 2026-08-01 | 0.4 | **Tasks 0-2 concluídas.** Junior forneceu token Meta válido temporário; Graph API confirmou `institucional_transbordo_v1` APPROVED na WABA real, template_id `1529393162293040`. Migration `20260801101000_swm65_institucional_transbordo_waba_real.sql` aplicada pontualmente em produção e registrada no ledger remoto. Falta teste real de transbordo (Task 3). Status Blocked → InProgress. | @dev Dex |
| 2026-08-01 | 0.5 | **Task 3 falhou no teste real; causa raiz isolada.** Logs/dados de produção mostraram que a conversa continuou `ativa` e o motor respondeu sem `handover:true`, portanto `_notificar_transbordo` nunca foi chamado. Adicionado gatilho determinístico no `motor-agente` para pedidos explícitos de humano no Institucional/Maria. Requer deploy da Edge Function antes de repetir o teste real. | @dev Dex |

## Dev Agent Record

### Agent Model Used
GPT-5 Codex

### Debug Log References
- Branch nova criada a partir de `origin/main`: `feat/s-wm-65-institucional-transbordo`.
- `origin/main` sincronizada em `5c59f3a`, já contendo os merges da S-WM-64 (#74) e do bloqueio permanente paralelo (#75).
- `GET https://graph.facebook.com/v20.0/1035278895899806/message_templates?name=institucional_transbordo_v1` com `META_SYSTEM_USER_TOKEN` local → falhou com `OAuthException`, code `200`, mensagem `(#200) Provide valid app ID`.
- Sanity check `GET https://graph.facebook.com/v20.0/me` com o mesmo token → falhou com `OAuthException`, code `2500`, mensagem `An active access token must be used to query information about the current user.`
- Depois que Junior colou token temporário válido em `worker/.env.example`: `GET /1035278895899806/message_templates?name=institucional_transbordo_v1&fields=id,name,status,category,parameter_format,components` → retornou `id=1529393162293040`, `status=APPROVED`, `category=UTILITY`, `parameter_format=NAMED`.
- Token temporário removido de `worker/.env.example` imediatamente após a consulta; arquivo restaurado ao placeholder original.
- Migration criada: `supabase/migrations/20260801101000_swm65_institucional_transbordo_waba_real.sql`.
- Migration aplicada pontualmente em produção via `supabase db query --linked < supabase/migrations/20260801101000_swm65_institucional_transbordo_waba_real.sql` → exit 0.
- Pós-aplicação: `select nome, status, ativo, waba_ids, phone_number_ids, parameter_format, observacoes from meta_templates where nome='institucional_transbordo_v1'` → `status='aprovado'`, `ativo=true`, `waba_ids=['1035278895899806']`, `phone_number_ids=['1291080677418758']`, `parameter_format='NAMED'`.
- Ledger remoto atualizado com `supabase migration repair --linked --status applied 20260801101000` → exit 0; `supabase migration list --linked | tail -30` mostra `20260801101000` em Local e Remote.
- `git diff --check` → passou.
- Pós-falha do teste real da Task 3: consulta em produção encontrou a conversa `9eb8483a-2e12-423c-8065-2da0c01cf115`; mensagens `quero falar com atendente` (`2026-08-01 04:20:11+00`) e `quero falar com humano` (`2026-08-01 04:21:41+00`) foram respondidas pelo agente com status da conversa ainda `ativa`. Não houve `handover:true`, logo o worker não chamou `_notificar_transbordo`.
- Correção de código adicionada em `motor-agente`: pedidos explícitos de humano/atendente para `Institucional`/`maria` agora retornam `handover:true` de forma determinística, antes de RAG/GPT, com guarda simples para negações.
- `deno test --no-check --allow-env --allow-net supabase/functions/motor-agente/index.test.ts` → 61 passed, 2 ignored.
- `deno test --no-check --allow-env --allow-net supabase/functions/motor-agente/index.audit.test.ts` → 138 passed.

### Completion Notes List
- Template `institucional_transbordo_v1` confirmado como aprovado na WABA real antes de qualquer alteração de banco, cumprindo AC4.
- Como o nome do template foi preservado, a migration usa `UPDATE` direto do registro ativo, com fallback idempotente de `INSERT` apenas se não existir registro ativo.
- Banco produção já está atualizado e ledger remoto marcado como aplicado para `20260801101000`.
- Falha do teste real não era reflexo pendente da migration: o banco/template já estavam corretos em produção. O bloqueio estava no código da Edge Function `motor-agente`, que dependia do GPT emitir `[[HANDOVER]]` e não reconheceu frases explícitas como `quero falar com atendente`.
- Falta aplicar o fluxo obrigatório desta story para o novo ajuste de código: deploy da Edge Function `motor-agente` no Supabase produção cuca antes de push+PR; depois repetir o teste real de transbordo Institucional para fechar AC3/Task 3.

### File List
- `docs/stories/S-WM-65-Institucional-Transbordo-V1-Reaprovar-Waba-Real.md` (registro de bloqueio)
- `supabase/migrations/20260801101000_swm65_institucional_transbordo_waba_real.sql`
- `supabase/functions/motor-agente/index.ts`
- `supabase/functions/motor-agente/index.audit.test.ts`

## QA Results
### Review 2026-08-01 — @qa Quinn

**Gate: PASS com follow-up obrigatório**

O ajuste cobre a causa raiz reproduzida na Task 3: o teste real não chegou ao número de transbordo porque o `motor-agente` respondeu sem `handover:true`; portanto o worker nunca chamou `_notificar_transbordo`. A correção adiciona reconhecimento determinístico para pedidos explícitos de humano/atendente em `Institucional`/`maria`, antes de RAG/GPT, e mantém guarda para negações simples.

**Rastreabilidade**

- AC1/AC4: evidência registrada de Graph API real antes de alterar banco: `institucional_transbordo_v1`, `status=APPROVED`, `template_id=1529393162293040`, WABA `1035278895899806`.
- AC2: produção cuca validada via query: `status='aprovado'`, `ativo=true`, `automacoes=['Institucional','Transbordo']`, `waba_ids=['1035278895899806']`, `phone_number_ids=['1291080677418758']`, `parameter_format='NAMED'`.
- AC3: teste real anterior falhou por ausência de `handover:true`; code path corrigido e coberto por teste automatizado. Falta repetir o teste real após deploy da Edge Function.

**Evidências executadas**

- Query produção cuca em `meta_templates` para `institucional_transbordo_v1` → 1 registro ativo/aprovado com WABA e phone_number_id corretos.
- `deno test --no-check --allow-env --allow-net supabase/functions/motor-agente/index.test.ts` → 61 passed, 2 ignored.
- `deno test --no-check --allow-env --allow-net supabase/functions/motor-agente/index.audit.test.ts` → 138 passed.
- `git diff --check` → passou.

**Follow-up obrigatório**

Depois do deploy da Supabase Edge Function `motor-agente` em produção cuca, repetir o teste real da Task 3 com `quero falar com atendente`/`quero falar com humano` e confirmar que a notificação chega ao contato de transbordo. Sem esse deploy, produção continuará com o comportamento antigo.

**Observação não bloqueante**

O caminho Institucional ainda depende do worker processar `handover:true` e chamar `_notificar_transbordo`; se no futuro a notificação falhar por contato/template/token, o teste real deve capturar. Para esta S-WM-65, o template e o gatilho reproduzido estão cobertos.
