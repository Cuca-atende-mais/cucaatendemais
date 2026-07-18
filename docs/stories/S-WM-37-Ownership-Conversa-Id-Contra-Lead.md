# S-WM-37 — Impedir que `conversa_id` de outro lead seja aceito pelo `motor-agente`

## Status
Ready for Review

## Origem
Auditoria independente `motor-agente` (2026-07-16), achado SEC-01, Plano 002. Diagnóstico: `docs/qa/DIAGNOSTICO-motor-agente-2026-07-18.md` (seção 2.1 — risco de regressão confirmado LOW contra o worker real). Base: **`origin/main`** (`99f4395`).

## Complexidade
**S** — checagem pontual + testes.

## Prioridade
P1 — segurança, reachability confirmada (anon key pública + sem `verify_jwt` override).

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - deno test --no-check --allow-env --allow-read --allow-net . → todos os testes novos + suíte existente verdes
  - deno check index.ts → não pode piorar a baseline (ver S-WM-36)
  - grep -n "lead_id !== lead.id" index.ts → confirma a checagem nova presente
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** que o `motor-agente` rejeite um `conversa_id` que não pertence ao `lead` resolvido pelo `telefone` do mesmo request,
**para que** um chamador externo (via anon key pública, sem passar pelo worker) não consiga gravar mensagem, forçar handover/encerramento ou sobrescrever `metadata` de uma conversa alheia.

## Contexto e Problema

`index.ts:1096-1101`:
```ts
let { data: conversa } = conversa_id
  ? await supabase.from("conversas").select("id, status, metadata").eq("id", conversa_id).single()
  : await supabase.from("conversas").select("id, status, metadata").eq("lead_id", lead.id).eq("origem_id", canal_origem || "test").single();
if (!conversa) {
  const { data } = await supabase.from("conversas").insert({ lead_id: lead.id, origem_id: canal_origem || "test", agente_tipo, canal_ativo: "meta", status: "ativa" }).select("id, status, metadata").single();
  conversa = data; conversaJustCreated = true; conversaGenuinamenteNova = true;
}
```
O branch com `conversa_id` (quando informado) busca só por `id`, sem checar que a conversa pertence ao `lead` resolvido por `telefone`. O branch `else` já filtra por `lead_id`.

**Reachability confirmada:** `supabase/config.toml` não tem seção `[functions.motor-agente]` nem `verify_jwt` override; a `anon key` pública (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) está em `cuca-portal/src/lib/supabase/{client,server,middleware}.ts`. Qualquer request com JWT válido (a anon key serve) alcança a função direto, sem depender da service role key.

**Verificado contra o worker real (`worker/meta_adapter_inbound.py:627-648`):** o `conversa_id` que o worker manda vem de um `upsert` em `conversas` com `on_conflict="lead_id,origem_id"`, usando **o mesmo `lead_id`** recém-resolvido no upsert de `leads` (linhas 610-621). Não existe, no caminho real do worker, forma de `conversa_id` apontar para outro lead — o fix abaixo **nunca dispara para tráfego legítimo do worker**, só para o cenário de ataque (chamada direta com anon key).

## Escopo

### IN
1. Incluir `lead_id` no `select` de ambos os branches (linhas 1096-1098) e adicionar checagem pós-fetch quando `conversa_id` foi informado:
```ts
let { data: conversa } = conversa_id
  ? await supabase.from("conversas").select("id, status, metadata, lead_id").eq("id", conversa_id).single()
  : await supabase.from("conversas").select("id, status, metadata, lead_id").eq("lead_id", lead.id).eq("origem_id", canal_origem || "test").single();

if (conversa_id && conversa && conversa.lead_id !== lead.id) {
  return new Response(JSON.stringify({ error: "conversa_id nao pertence ao lead informado" }), { status: 403 });
}

if (!conversa) {
  const { data } = await supabase.from("conversas").insert({ lead_id: lead.id, origem_id: canal_origem || "test", agente_tipo, canal_ativo: "meta", status: "ativa" }).select("id, status, metadata, lead_id").single();
  conversa = data; conversaJustCreated = true; conversaGenuinamenteNova = true;
}
```
2. Confirmar (leitura, `grep -n "conversa\." index.ts`) que nenhum uso downstream de `conversa` depende de forma estrita do shape do objeto (campo extra `lead_id` é inofensivo em TS estrutural).

### OUT
- O branch `else` (sem `conversa_id`) — já correto, não mexer.
- `worker/meta_adapter_inbound.py` — já confia corretamente (verificado acima), não mexer.
- Qualquer lógica downstream que usa `conversa.id`/`conversa.status`/`conversa.metadata` — não deve mudar de comportamento para o caso legítimo.
- Deploy automático.

## Acceptance Criteria

1. **Given** um request com `conversa_id` de uma conversa que pertence a outro lead, **when** processado, **then** retorna `403` com `error` mencionando ownership — **sem** chamar `salvarMensagemAgente`/gravar nada em `mensagens` ou `conversas` além da leitura.
2. **Given** um request com `conversa_id` que pertence ao mesmo lead resolvido, **when** processado, **then** segue o fluxo normal até `200` — mesmo comportamento de hoje (não regride).
3. **Given** um request sem `conversa_id` (branch `else`), **when** processado, **then** continua funcionando exatamente como hoje — sem checagem adicional (já filtra por `lead_id` na query).
4. **Given** o teste do cenário 1 revertido (sem o fix aplicado), **when** rodado, **then** falha — prova que o teste exercita a proteção de verdade.
5. `deno test --no-check --allow-env --allow-read --allow-net .` → `0 failed`, incluindo os testes novos.
6. `deno check index.ts` não piora em relação à baseline da S-WM-36 (se já mergeada) ou à baseline de 75 erros.
7. Nenhum deploy é executado por esta story.

## Tasks / Subtasks

- [x] **Task 1 — Implementar a checagem de ownership** (AC: 1, 2, 3)
  - [x] Incluído `lead_id` no select (ambos os branches), adicionado o `if` de rejeição 403 (linhas 1097-1105, deslocadas +1 pela S-WM-36).
  - [x] `grep -n "conversa\." index.ts` — nenhum uso downstream depende do shape exato (campo extra inofensivo).
- [x] **Task 2 — Testes** (AC: 1, 2, 3, 4)
  - [x] Caso do bug → 403, sem gravar nada.
  - [x] Caso legítimo (mesmo `lead_id`) → 200, sem regressão.
  - [x] Caso sem `conversa_id` → 200, sem regressão.
  - [x] Mutation testing: teste do caso 1 revertido temporariamente → falhou como esperado (403 esperado, 200 obtido); restaurado e reconfirmado verde.
  - [x] Achado incidental: o teste pré-existente `S-WM-31 AC6` quebrou porque seu mock de `conversas` não tinha `lead_id` — corrigido na fonte (`respostasBaseHandler`, adicionado `lead_id: "lead-1"` por padrão, igual ao lead mockado), não no teste individual.
- [x] **Task 3 — Fechamento** (AC: 5, 6, 7)
  - [x] Suíte completa: 156 passed, 0 failed, 2 ignored. `deno check`: 36 erros (idêntico à S-WM-36, nenhum erro novo introduzido).
  - [x] File List e Change Log atualizados.

## Dev Notes

- Padrão de mock a reaproveitar: `criarSupabaseMock`/`respostasBaseHandler`/`comFetchMockado`/`requestFakeComConversaId` já definidos no topo de `index.audit.test.ts`.
- **Dependência de sequenciamento:** a S-WM-45 (Plano 013 — erro de lookup de `conversa_id` não deve criar conversa órfã) toca a mesma região de código. Mergear esta story (S-WM-37) **antes** da S-WM-45 evita conflito de merge.

### Testing
- `deno test --no-check --allow-env --allow-read --allow-net .` dentro de `supabase/functions/motor-agente/`.

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-07-18 | 0.1 | Story criada a partir do Plano 002 da auditoria motor-agente (2026-07-16), aprovado pelo sócio em 2026-07-18. Base: origin/main. Risco de regressão no caminho real do worker confirmado LOW (não hipotético) durante a análise de impacto. | @sm River |
| 2026-07-18 | 0.2 | @po validate-story-draft: **GO**. Status Draft → Ready. | @po Pax |
| 2026-07-18 | 0.3 | Implementada em branch `fix/motor-agente-auditoria-2026-07-16`, sobre S-WM-36. 3 testes novos + 1 teste pré-existente corrigido na fonte do mock (não na lógica nova). Mutation testing confirmou a proteção. Suíte: 156/0/2. Status Ready → Ready for Review. | @dev Dex |

## Dev Agent Record

### Agent Model Used
Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References
- `deno test`: 156 passed, 0 failed, 2 ignored (153 baseline S-WM-36 + 3 novos).
- Mutation testing: fix revertido temporariamente → teste do caso do bug falhou (200 obtido, 403 esperado); restaurado → verde de novo.
- `deno check`: 36 erros, idêntico à S-WM-36 (nenhum erro novo).

### Completion Notes List
- Implementado exatamente como especificado, linhas deslocadas +1 pela S-WM-36 (import novo), sem outra surpresa de drift.
- Achado incidental corrigido: teste `S-WM-31 AC6` (pré-existente) quebrou porque seu mock de `conversas` não incluía `lead_id`. Corrigi a fonte compartilhada (`respostasBaseHandler`), não o teste individual — mais robusto pra qualquer teste futuro que reaproveite o mock padrão.

### File List
- `supabase/functions/motor-agente/index.ts` (modificado: checagem de ownership)
- `supabase/functions/motor-agente/index.audit.test.ts` (modificado: `respostasBaseHandler` ganhou `lead_id` padrão; 3 testes novos S-WM-37 adicionados ao final)
| 2026-07-18 | 0.2 | @po validate-story-draft: **GO**. Escopo, AC e testes claros; reachability e comportamento do worker já verificados na origem. Dependência com S-WM-45 (mesma região) já documentada — mergear esta primeiro. Status Draft → Ready. | @po Pax |
