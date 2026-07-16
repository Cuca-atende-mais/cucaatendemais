# Plan 013: Falha no lookup de `conversa_id` não deve criar conversa órfã silenciosamente

> **Executor instructions**: Siga passo a passo, verifique cada passo. STOP conditions → pare e reporte.
>
> **Drift check**: `git diff --stat bf8b152..HEAD -- supabase/functions/motor-agente/index.ts` antes de começar. **Este plano toca a mesma região de código do [plano 002](002-sec01-conversa-id-ownership-check.md) — se ambos forem executados, aplique o 002 primeiro e re-leia o código real antes de aplicar este.**

## Status
- **Priority**: P2
- **Effort**: S/M
- **Risk**: MED (ver STOP conditions — mudar "silencioso" para "falha visível" pode expor problemas de infraestrutura pré-existentes que hoje passam despercebidos)
- **Depends on**: **execute [plano 002](002-sec01-conversa-id-ownership-check.md) primeiro** — ele já modifica esse mesmo bloco de código (adiciona `lead_id` ao select e a checagem de ownership); aplicar os dois fora de ordem vai gerar conflito de merge desnecessário
- **Category**: bug
- **Planned at**: commit `bf8b152`, 2026-07-16

## Por que isso importa

Mesma família de bug do [plano 005](005-bug02-lead-lookup-error-handling.md) (que corrige o lookup de `lead`), mas aqui é o lookup de `conversa`: `.single()` não lança exceção em erro, retorna `{data: null, error}` — e o código só olha `data`. Se a busca de `conversa_id` (`index.ts:938-939`, ou já modificado pelo plano 002) falhar por qualquer motivo que não seja "não encontrado" (erro transiente de conexão, timeout), o código cai direto no branch de criar conversa nova (`index.ts:941-943`), gerando uma conversa órfã duplicada e perdendo o histórico da conversa real — quando o `conversa_id` era um valor válido, só a query que falhou temporariamente.

Isso é especialmente relevante porque o comentário em `index.ts:933-937` explica que `conversa_id` existe justamente para "resolver por PK e cair fora de qualquer corrida" (S-WM-31) — um erro de query tratado como "não encontrado" contorna essa garantia.

## Estado atual (antes do plano 002 rodar)

```ts
// index.ts:938-943
let { data: conversa } = conversa_id
  ? await supabase.from("conversas").select("id, status, metadata").eq("id", conversa_id).single()
  : await supabase.from("conversas").select("id, status, metadata").eq("lead_id", lead.id).eq("origem_id", canal_origem || "test").single();
if (!conversa) {
  const { data } = await supabase.from("conversas").insert({ lead_id: lead.id, origem_id: canal_origem || "test", agente_tipo, canal_ativo: "meta", status: "ativa" }).select("id, status, metadata").single();
  conversa = data; conversaJustCreated = true; conversaGenuinamenteNova = true;
}
```

**Se o plano 002 já rodou**, o código real vai ter `lead_id` no select e a checagem de ownership adicionada — releia o arquivo antes de aplicar este plano, o princípio da correção (capturar `error`) é o mesmo, só a linha exata muda.

## Comandos que você vai precisar

| Propósito | Comando | Esperado |
|---|---|---|
| Testes | `deno test --no-check --allow-env --allow-read --allow-net .` | `0 failed`, incluindo os novos |
| Typecheck | `deno check index.ts` | não piora vs. baseline |

## Escopo
**No escopo:** o bloco de resolução de `conversa` (`index.ts:938-943`, ou a versão já modificada pelo plano 002); testes novos em `index.audit.test.ts`.
**Fora do escopo:** o bloco de resolução de `lead` (já coberto pelo plano 005, não duplique o fix aqui).

## Fluxo git
- Branch: `advisor/013-bug03-erro-lookup-conversa`
- Commit único.

## Passos

### Passo 1: capturar e checar `error` na busca de `conversa_id`

Só para o caminho **com** `conversa_id` (o caminho sem `conversa_id`, linha 940, é um fallback legado documentado como "só existe 1 caller hoje" — tratar erro ali é menos crítico, mas você pode aplicar o mesmo princípio se quiser, não é obrigatório):

```ts
let { data: conversa, error: conversaSelectError } = conversa_id
  ? await supabase.from("conversas").select("id, status, metadata" /* + lead_id, se plano 002 já rodou */).eq("id", conversa_id).single()
  : await supabase.from("conversas").select("id, status, metadata" /* idem */).eq("lead_id", lead.id).eq("origem_id", canal_origem || "test").single();

if (conversa_id && !conversa && conversaSelectError) {
  throw new Error("Falha ao buscar conversa_id=" + conversa_id + ": " + conversaSelectError.message);
}

if (!conversa) {
  const { data } = await supabase.from("conversas").insert({ lead_id: lead.id, origem_id: canal_origem || "test", agente_tipo, canal_ativo: "meta", status: "ativa" }).select("id, status, metadata" /* idem */).single();
  conversa = data; conversaJustCreated = true; conversaGenuinamenteNova = true;
}
```

Note a assimetria proposital: só lança quando `conversa_id` foi explicitamente informado (o caller estava confiante de que essa conversa existe) E há um `error` real. O caminho sem `conversa_id` mantém o comportamento de fallback-para-insert mesmo em erro — é um caminho legado, tratar isso com o mesmo rigor é uma extensão opcional (ver "Maintenance notes").

**Verify**: `grep -n "conversaSelectError" index.ts` retorna as linhas novas.

## Test plan

Em `index.audit.test.ts`, modelo estrutural igual ao plano 005 (teste "select falha, deve lançar" vs. "select funciona, não regride"):

1. **`conversa_id` informado, select retorna erro**: mock `"conversas"` com `{ data: null, error: { message: "erro simulado" } }`. Chame `handler(requestFakeComConversaId("oi", "conv-999"), mockSupabase)`. Assert: `response.status === 500` — **não** deve chamar `insert` em `"conversas"` (confira em `chamadas`).
2. **`conversa_id` informado, não encontrado sem erro** (`{ data: null, error: null }`): comportamento atual preservado — cai no insert de conversa nova.
3. **`conversa_id` informado, encontrado com sucesso**: não regride — segue o fluxo normal.

**Verify**: `deno test --no-check --allow-env --allow-read --allow-net .` → todos passam, incluindo os novos.

## Done criteria
- [ ] `deno test --no-check --allow-env --allow-read --allow-net .` → `0 failed`, incluindo os testes novos
- [ ] Teste do cenário 1 (erro real) falha se você reverter o Passo 1 (confirme antes/depois)
- [ ] `deno check index.ts` não piora vs. baseline
- [ ] Nenhum arquivo fora do escopo modificado
- [ ] `plans/README.md` atualizado

## STOP conditions
- Se o plano 002 já modificou este bloco de forma que não bate com "Estado atual" acima — releia o código real antes de aplicar, não assuma que o trecho citado ainda é literal.
- Se tornar esse erro "visível" (500 em vez de silenciosamente criar conversa nova) causar uma quantidade inesperada de falhas em produção depois do deploy (sinal de que o erro transiente citado aqui é, na verdade, frequente) — isso seria uma descoberta importante para reportar ao Valmir, não um motivo para reverter silenciosamente o fix sem avisar.

## Maintenance notes
- O caminho sem `conversa_id` (fallback legado) não foi endurecido por este plano — hoje só o worker chama esta function e sempre manda `conversa_id` (S-WM-31), então esse caminho é baixo risco, mas se algum caller novo passar a depender dele sem `conversa_id`, vale revisitar o mesmo tratamento de erro ali.
- Revisor deve confirmar que o `throw` novo não interfere com o branch `else if (conversa.status === "encerrada")` logo abaixo (`index.ts:944-955`) — esse branch só roda quando `conversa` foi resolvida com sucesso, então não deveria ser afetado.
