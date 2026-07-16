# Plan 005: Distinguir falha técnica de "lead bloqueado" na resolução do lead

> **Executor instructions**: Siga este plano passo a passo. Rode cada comando
> de verificação e confirme o resultado esperado antes do próximo passo. Se
> algo na seção "STOP conditions" ocorrer, pare e reporte.
>
> **Drift check (rodar primeiro)**: `git diff --stat bf8b152..HEAD -- supabase/functions/motor-agente`
> Se o arquivo mudou desde que este plano foi escrito, revalide os trechos de
> "Estado atual" antes de prosseguir.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `bf8b152`, 2026-07-16

## Por que isso importa

Na resolução do lead (`index.ts:915-920`), tanto o `select` inicial quanto o `insert` de fallback usam `.single()` e destructuram só `data`, nunca `error`:

```ts
let { data: lead } = await supabase.from("leads").select("id,nome,opt_in,bloqueado").eq("telefone", telefone).single();
if (!lead) {
  const { data } = await supabase.from("leads").insert({ telefone, unidade_cuca, origem: "whatsapp", opt_in: true }).select("id,nome,opt_in,bloqueado").single();
  lead = data;
}
if (!lead || lead.bloqueado) return new Response(JSON.stringify({ blocked: true }), { status: 200 });
```

O `supabase-js` **não lança exceção** em erro de query — ele retorna `{data: null, error: {...}}`. Se o `select` falhar por qualquer motivo (erro transiente de conexão, timeout) E o `insert` de fallback também falhar (ex.: corrida numa constraint `unique(telefone)`, ou o mesmo erro transiente ainda ativo), `lead` fica `null`/`undefined` — e a linha 920 trata isso como **"lead bloqueado"**, retornando `{blocked: true}` com `status: 200` (sucesso!) para o worker.

O worker (`meta_adapter_inbound.py`) não tem como diferenciar "esse lead está genuinamente bloqueado" de "o Supabase teve um erro transiente" — os dois casos produzem o mesmo sinal. Na prática, isso significa que uma falha técnica passageira do banco pode **suprimir silenciosamente a resposta a um lead legítimo e não-bloqueado**, sem nenhum log de erro, sem retry, sem alerta — parece só "esse lead está bloqueado" para quem olha os logs do worker depois.

## Estado atual

- `index.ts:914-920`:
  ```ts
  // 1. Lead
  let { data: lead } = await supabase.from("leads").select("id,nome,opt_in,bloqueado").eq("telefone", telefone).single();
  if (!lead) {
    const { data } = await supabase.from("leads").insert({ telefone, unidade_cuca, origem: "whatsapp", opt_in: true }).select("id,nome,opt_in,bloqueado").single();
    lead = data;
  }
  if (!lead || lead.bloqueado) return new Response(JSON.stringify({ blocked: true }), { status: 200 });
  ```
- Padrão de erro HTTP 500 já usado no arquivo, no catch top-level (`index.ts:1432-1436`):
  ```ts
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.error("[motor-agente v18] Erro:", errMsg);
    return new Response(JSON.stringify({ error: "Erro interno", details: errMsg }), { status: 500 });
  }
  ```
  (Nota: esse catch já existe e vai capturar uma exceção lançada aqui — ver Passo 1, que usa `throw` em vez de montar uma `Response` inline, pra reaproveitar esse tratamento já existente e consistente com o resto do arquivo.)

## Comandos que você vai precisar

| Propósito | Comando | Esperado no sucesso |
|---|---|---|
| Testes | `deno test --no-check --allow-env --allow-read --allow-net .` (pasta `supabase/functions/motor-agente`) | todos passam, incluindo os novos |
| Typecheck | `deno check index.ts` | não piora em relação à baseline |

## Escopo

**No escopo:**
- `supabase/functions/motor-agente/index.ts` — só o bloco `index.ts:914-920`
- `supabase/functions/motor-agente/index.audit.test.ts` — testes novos

**Fora do escopo:**
- O bloco de resolução de `conversa` (linhas 938-943) — tem o mesmo padrão de `.single()` sem checar `error`, e é um achado relacionado (BUG-03 no relatório de auditoria), mas é um plano separado, não escrito neste lote. Não misture os dois fixes.
- Qualquer mudança em `worker/meta_adapter_inbound.py` — o worker já trata `{blocked: true}` corretamente hoje; a mudança é só em como o `motor-agente` diferencia os dois cenários.

## Fluxo git

- Branch: `advisor/005-bug02-lead-error-handling`
- Commit único (fix + testes), mensagem no padrão do repo
- **Não** faça push nem abra PR a menos que instruído.

## Passos

### Passo 1: Capturar e checar `error` nas duas queries

Troque:
```ts
// 1. Lead
let { data: lead } = await supabase.from("leads").select("id,nome,opt_in,bloqueado").eq("telefone", telefone).single();
if (!lead) {
  const { data } = await supabase.from("leads").insert({ telefone, unidade_cuca, origem: "whatsapp", opt_in: true }).select("id,nome,opt_in,bloqueado").single();
  lead = data;
}
if (!lead || lead.bloqueado) return new Response(JSON.stringify({ blocked: true }), { status: 200 });
```
por:
```ts
// 1. Lead
let { data: lead, error: leadSelectError } = await supabase.from("leads").select("id,nome,opt_in,bloqueado").eq("telefone", telefone).single();
if (!lead) {
  const { data, error: leadInsertError } = await supabase.from("leads").insert({ telefone, unidade_cuca, origem: "whatsapp", opt_in: true }).select("id,nome,opt_in,bloqueado").single();
  lead = data;
  if (!lead && leadInsertError) {
    throw new Error("Falha ao resolver lead (select: " + (leadSelectError?.message ?? "sem linha") + "; insert: " + leadInsertError.message + ")");
  }
}
if (!lead || lead.bloqueado) return new Response(JSON.stringify({ blocked: true }), { status: 200 });
```

Por que `throw` em vez de montar um `Response` de erro inline: o arquivo já tem um catch top-level (`index.ts:1432-1436`, citado em "Estado atual") que formata erros de forma consistente (loga com `console.error`, retorna 500 com `{error, details}`). Lançar aqui reaproveita esse tratamento em vez de duplicar o formato de resposta de erro. Note que o caso "select falhou mas não retornou erro explícito, e o insert também não retornou linha nem erro explícito" (ambos `data: null, error: null` — teoricamente não deveria acontecer, mas o mock de teste pode simular isso) não deve lançar exceção adicional além do necessário; o `if (!lead && leadInsertError)` só lança quando há um `error` real do insert, preservando o comportamento atual (`blocked: true`) para o caso onde genuinamente não há erro e não há linha (que na prática só deveria ocorrer se o insert retornasse sucesso sem dados, o que não é esperado do Postgres, mas o código não deve quebrar se acontecer).

**Verify**: `grep -n "leadInsertError" index.ts` retorna as linhas novas.

## Test plan

Adicione em `index.audit.test.ts`, seguindo o padrão de `criarSupabaseMock` (que já suporta um segundo argumento `error` no objeto de resposta — confira a assinatura: `Record<string, { data: unknown }>`; você vai precisar estender levemente o mock OU usar uma tabela de respostas customizada por teste que inclua `error` no objeto resolvido pela chain, seguindo o mesmo espírito do `payload`/`args` já documentados no cabeçalho do mock).

1. **Select falha, insert falha (deve lançar/retornar 500, não `blocked: true`)**: configure o mock para que `"leads"` resolva com `{ data: null, error: { message: "erro simulado de conexao" } }` tanto no select quanto no insert (o mock atual sempre devolve a mesma resposta configurada por tabela independente do método — isso é suficiente pra esse cenário, já que tanto select quanto insert usam a mesma tabela `"leads"`). Chame `handler(requestFake("oi"), mockSupabase)`. Assert: `response.status === 500`, corpo tem `error: "Erro interno"` — **não** deve ser `{blocked: true}` com status 200.
2. **Lead genuinamente bloqueado (não deve regredir)**: mock de `"leads"` resolve com `{ data: { id: "lead-1", bloqueado: true }, error: null }`. Assert: `response.status === 200`, corpo `{ blocked: true }` — mesmo comportamento de hoje.
3. **Lead novo, insert funciona (não deve regredir)**: mock de `"leads"` no select resolve `{ data: null, error: null }` (não encontrado, sem erro) e você precisa diferenciar select de insert nesse caso — se o mock genérico não suportar isso diretamente, um teste de unidade mais simples (chamando só a lógica de resolução, extraída ou não) é aceitável; senão, adapte `criarSupabaseMock` para aceitar respostas diferentes por método (`select` vs `insert`) na mesma tabela, documentando a mudança no comentário do mock como já é o padrão do arquivo (ver como os comentários de `args`/`payload` explicam extensões aditivas).

**Verify**: `deno test --no-check --allow-env --allow-read --allow-net .` → todos passam, incluindo os novos.

## Done criteria

Machine-checkable. TODAS precisam valer:

- [ ] `deno test --no-check --allow-env --allow-read --allow-net .` → `0 failed`, incluindo os testes novos
- [ ] O teste do cenário 1 (falha dupla) falha se você reverter o Passo 1 (confirme antes/depois)
- [ ] `deno check index.ts` não piora em relação à baseline
- [ ] Nenhum arquivo fora do escopo modificado (`git status`)
- [ ] `plans/README.md` linha de status atualizada

## STOP conditions

Pare e reporte se:

- O código em `index.ts:914-920` não bater com o trecho em "Estado atual".
- Estender `criarSupabaseMock` para diferenciar `select` de `insert` na mesma tabela quebrar algum teste existente que dependia do comportamento atual (resposta única por tabela) — se isso acontecer, prefira um teste de unidade isolado (extraindo a lógica de resolução de lead para uma função testável separadamente) em vez de arriscar quebrar a suíte inteira, e reporte a dificuldade.

## Maintenance notes

- Esse mesmo padrão (`.single()` sem checar `error`) se repete em outros pontos do arquivo (ex.: a resolução de `conversa`, linhas 938-943 — BUG-03 no relatório, plano separado). Se este plano rodar bem, vale usar como referência de como tratar os outros pontos depois.
- O que um revisor deve escrutinar: que o `throw` novo não muda o comportamento do caso feliz (lead encontrado ou criado com sucesso) — só adiciona um caminho de erro que antes era silencioso.
