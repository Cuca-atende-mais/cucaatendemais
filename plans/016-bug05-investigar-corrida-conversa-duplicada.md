# Plan 016 (INVESTIGAR): Corrida check-then-act pode duplicar `conversas` no caminho legado sem `conversa_id`

> **Executor instructions**: Este é um plano de **investigação**, não de fix — confiança baixa o suficiente para não prescrever uma solução sem antes confirmar o cenário é real. Produza um relatório curto (achado confirmado / achado descartado / achado real mas fora de escopo agir agora), não um diff de código, a menos que a investigação confirme um caminho de ação óbvio e de baixo risco.
>
> **Drift check**: `git diff --stat bf8b152..HEAD -- supabase/functions/motor-agente/index.ts worker/meta_adapter_inbound.py` antes de começar.

## Status
- **Priority**: P3
- **Effort**: M (investigação) — potencialmente maior se confirmado e decidido corrigir
- **Risk**: MED se um fix for aplicado (constraint de unicidade pode rejeitar linhas que hoje são aceitas)
- **Depends on**: none
- **Category**: bug (investigate)
- **Planned at**: commit `bf8b152`, 2026-07-16

## Por que isso importa (achado de baixa confiança — investigar antes de agir)

No caminho **sem** `conversa_id` (`index.ts:940`, fallback legado — o comentário em `index.ts:933-937` diz que "hoje só existe 1 caller, worker/meta_adapter_inbound.py", e esse caller sempre manda `conversa_id` via S-WM-31), duas requisições quase simultâneas para o mesmo `lead_id`+`origem_id` (ex.: um webhook duplicado da Meta) poderiam, em teoria, ambas observar `!conversa` e ambas executar o `insert()` (`index.ts:941-943`), criando 2 linhas de `conversas` para o mesmo lead/canal.

**Por que a confiança é baixa**: o único caller real hoje sempre manda `conversa_id` (confirmado por grep em `worker/`), então esse caminho só seria exercitado por um caller futuro que ainda não existe, ou por uma chamada direta à função fora do fluxo do worker (ver discussão de reachability nos planos 002/003 sobre a `anon key` pública). Não há evidência de que isso já aconteceu em produção — é um risco estrutural, não um bug observado.

## Estado atual

```ts
// index.ts:940-943 (caminho sem conversa_id)
: await supabase.from("conversas").select("id, status, metadata").eq("lead_id", lead.id).eq("origem_id", canal_origem || "test").single();
if (!conversa) {
  const { data } = await supabase.from("conversas").insert({ lead_id: lead.id, origem_id: canal_origem || "test", agente_tipo, canal_ativo: "meta", status: "ativa" }).select("id, status, metadata").single();
  conversa = data; conversaJustCreated = true; conversaGenuinamenteNova = true;
}
```

## Passos de investigação

### Passo 1: confirmar se existe alguma constraint de unicidade no banco hoje

Pergunte ao Valmir (ou, se tiver acesso ao schema real via `supabase/migrations/` no repo, procure) se `conversas` tem algum `UNIQUE(lead_id, origem_id)` ou índice equivalente. Se **já existir**, o 2º `insert` da corrida falharia com erro de constraint — nesse caso, o "bug" real não é duplicação, é que o 2º request receberia um erro não tratado (outro achado, relacionado ao [plano 013](013-bug03-erro-lookup-conversa-cria-orfa.md) — o `insert` também usa `.single()` sem checar `error`).

### Passo 2: confirmar se o worker está exposto a entregas duplicadas de webhook

Verifique em `worker/meta_adapter_inbound.py` se há alguma deduplicação de webhook por `wamid` (id da mensagem) antes de chegar a chamar `motor-agente` — isso reduziria (mas não eliminaria, por causa da reachability via anon key) a chance real desse cenário ocorrer via o fluxo legítimo.

### Passo 3: decidir se vale um fix agora

Se o Passo 1 confirmar que **não há** constraint de unicidade, e o Valmir considerar o risco real o suficiente para agir: a correção correta é adicionar `UNIQUE(lead_id, origem_id)` (migração de banco, fora do escopo de um único arquivo de Edge Function) + tratar o erro de conflito no `insert()` como "na verdade já existe, buscar de novo" (`ON CONFLICT DO NOTHING` + re-select, ou usar `upsert`). Isso é uma mudança de escopo maior que os outros planos deste lote (toca schema, não só `index.ts`) — se decidido, deveria virar um plano novo e completo, não um adendo a este.

## Done criteria (deste plano de investigação)
- [ ] Passo 1 respondido (existe ou não constraint de unicidade)
- [ ] Passo 2 respondido (existe ou não deduplicação de webhook por `wamid`)
- [ ] Decisão registrada em `plans/README.md`: acionar (vira plano novo), descartar (documentar por quê), ou aceitar o risco como está

## STOP conditions
- Não escreva um fix de código para este achado sem completar os Passos 1-2 primeiro — o risco de over-engineering uma proteção para um cenário que já é coberto por uma constraint existente é real.

## Maintenance notes
- Se decidido corrigir, a migração de banco (`UNIQUE(lead_id, origem_id)`) precisa ser cuidadosamente testada contra dados de produção existentes primeiro — se já existirem duplicatas hoje, a migração falharia ao tentar criar o índice.
