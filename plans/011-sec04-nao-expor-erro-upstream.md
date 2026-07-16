# Plan 011: Não repassar texto de erro upstream (OpenAI) cru na resposta HTTP

> **Executor instructions**: Siga passo a passo, verifique cada passo. STOP conditions → pare e reporte.
>
> **Drift check**: `git diff --stat bf8b152..HEAD -- supabase/functions/motor-agente/index.ts` antes de começar.

## Status
- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `bf8b152`, 2026-07-16

## Por que isso importa

O catch top-level (`index.ts:1432-1436`) retorna `{ error: "Erro interno", details: errMsg }`, onde `errMsg` pode ser texto de erro cru de terceiros — `"GPT-4o error: " + await resp.text()` (`index.ts:752`), `"Whisper error: " + await resp.text()` (`index.ts:701`), `"Embedding error: " + await resp.text()` (`index.ts:710`). Esse texto (potencialmente incluindo detalhes internos da API da OpenAI) é repassado verbatim ao caller HTTP — hoje o worker, mas potencialmente qualquer chamador (ver reachability discutida no plano 002). Baixo impacto isolado, mas é informação de diagnóstico interna vazando pra fora do limite de confiança da função.

## Estado atual

```ts
// index.ts:1432-1436
} catch (error: unknown) {
  const errMsg = error instanceof Error ? error.message : String(error);
  console.error("[motor-agente v18]", errMsg);
  return new Response(JSON.stringify({ error: "Erro interno", details: errMsg }), { status: 500 });
}
```

## Comandos que você vai precisar

| Propósito | Comando | Esperado |
|---|---|---|
| Testes | `deno test --no-check --allow-env --allow-read --allow-net .` | `0 failed` |

## Escopo
**No escopo:** `index.ts:1432-1436` (o catch top-level).
**Fora do escopo:** os `throw new Error(...)` que geram `errMsg` (linhas 701, 710, 752, etc.) — continuam lançando o texto completo, que é correto para o `console.error` (log interno); a mudança é só no que vai na `Response`.

## Fluxo git
- Branch: `advisor/011-sec04-erro-upstream-generico`
- Commit único.

## Passos

### Passo 1: separar log interno de resposta ao caller
```ts
} catch (error: unknown) {
  const errMsg = error instanceof Error ? error.message : String(error);
  console.error("[motor-agente v18]", errMsg);
  return new Response(JSON.stringify({ error: "Erro interno" }), { status: 500 });
}
```
Removi `details: errMsg` do corpo da resposta — o `console.error` já preserva o detalhe completo para quem tem acesso aos logs (Valmir/observabilidade), sem expor esse texto ao caller HTTP.

**Verify**: `grep -n "details: errMsg" index.ts` não retorna nada.

## Test plan

Verifique se algum teste existente depende do campo `details` na resposta de erro (`grep -n "details" index.audit.test.ts index.test.ts`) — se sim, atualize esses testes para não mais assertar sobre `details` (ou assertar que ele está ausente), preservando o assert de `error: "Erro interno"` e `status: 500`.

Se nenhum teste existente cobre isso, adicione um: force uma exceção (mesmo padrão do Passo 5 do plano 010, se esse plano já rodou — ou um cenário mínimo próprio) e confirme que a resposta JSON não contém a chave `details`.

**Verify**: `deno test --no-check --allow-env --allow-read --allow-net .` → `0 failed`.

## Done criteria
- [ ] Resposta de erro do catch top-level não inclui `details`
- [ ] `console.error` continua logando o `errMsg` completo (não perder o detalhe do lado do log)
- [ ] `deno test --no-check --allow-env --allow-read --allow-net .` → `0 failed`
- [ ] Nenhum arquivo fora do escopo modificado
- [ ] `plans/README.md` atualizado

## STOP conditions
- Se o worker (`worker/meta_adapter_inbound.py`) tiver alguma lógica que dependa especificamente do campo `details` da resposta de erro (não só do `error`/status) — confira com `grep -rn "details" worker/meta_adapter_inbound.py` antes de aplicar; se encontrar uso real, pare e reporte em vez de quebrar o consumidor.

## Maintenance notes
- Se o time quiser manter algum nível de detalhe pro caller no futuro (ex.: um código de erro estruturado em vez de texto livre), isso é uma decisão de design separada — este plano só remove o vazamento de texto cru, não propõe um novo contrato de erro.
