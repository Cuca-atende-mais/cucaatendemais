# Plan 010: Cobertura de teste para os branches de erro/saída antecipada do `handler()`

> **Executor instructions**: Siga passo a passo, verifique cada passo. STOP conditions → pare e reporte.
>
> **Drift check**: `git diff --stat bf8b152..HEAD -- supabase/functions/motor-agente/index.ts` antes de começar.

## Status
- **Priority**: P2
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none — mas é **pré-requisito recomendado** para o [plano 017](017-td01-extrair-secoes-handler.md) (refatoração do `handler()`), que não deveria rodar sem esta rede de segurança primeiro
- **Category**: tests
- **Planned at**: commit `bf8b152`, 2026-07-16

## Por que isso importa

`handler()` (`index.ts:895-1437`) é o entrypoint de produção do bot por mensagem. Confirmei por grep em ambos os arquivos de teste que os seguintes branches **não têm nenhum teste**: rejeição de request malformado (405/400), o estado de lead bloqueado, o menu de boas-vindas da Sofia, e o catch top-level (500). `respostasBaseHandler()` (`index.audit.test.ts:79-90`) sempre monta um lead válido e não-bloqueado e uma conversa existente — nenhum teste atual exercita os caminhos "abaixo" dessas suposições.

Sem isso, qualquer mudança futura no `handler()` (incluindo a refatoração proposta no plano 017) pode quebrar silenciosamente: rejeição de método errado, validação de campos obrigatórios, o controle de moderação (lead bloqueado), o fluxo de boas-vindas de outro agente (Sofia), ou o formato da resposta de erro — com a suíte de 127 testes continuando 100% verde.

## Estado atual

Branches confirmados sem teste (grep contra `index.test.ts` + `index.audit.test.ts`):

```ts
// index.ts:896
if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
// index.ts:904
if (!telefone || !agente_tipo) return new Response(JSON.stringify({ error: "telefone e agente_tipo sao obrigatorios" }), { status: 400 });
// index.ts:912
if (!textoFinal) return new Response(JSON.stringify({ error: "Nenhuma mensagem" }), { status: 400 });
// index.ts:920
if (!lead || lead.bloqueado) return new Response(JSON.stringify({ blocked: true }), { status: 200 });
// index.ts:970
if (!prompt) throw new Error("Prompt nao encontrado para: " + agente_tipo);
// index.ts:972-976 (menu de boas-vindas Sofia)
const isSofia = agente_tipo === "sofia" || agente_tipo === "sofia_global" || agente_tipo === "sofia_unidade";
if (conversaJustCreated && isSofia && prompt.menu_boas_vindas) { ... }
// index.ts:1432-1436 (catch top-level)
} catch (error: unknown) {
  const errMsg = error instanceof Error ? error.message : String(error);
  console.error("[motor-agente v18]", errMsg);
  return new Response(JSON.stringify({ error: "Erro interno", details: errMsg }), { status: 500 });
}
```

Harness já existente pra reaproveitar (`index.audit.test.ts:47-146`): `criarSupabaseMock`, `respostasBaseHandler`, `comFetchMockado`, `requestFake`/`requestFakeComConversaId`.

## Comandos que você vai precisar

| Propósito | Comando | Esperado |
|---|---|---|
| Testes | `deno test --no-check --allow-env --allow-read --allow-net .` | `0 failed`, incluindo os novos |

## Escopo
**No escopo:** `index.audit.test.ts` — só testes novos.
**Fora do escopo:** qualquer mudança em `index.ts` — este plano é puramente de cobertura, nenhuma linha de produção deveria mudar (se algum teste "quebrar" o handler ao escrevê-lo, é sinal de um bug novo — reporte como achado separado, não corrija aqui).

## Fluxo git
- Branch: `advisor/010-test01-cobertura-handler-erros`
- Commit único.

## Passos

### Passo 1: método/campos obrigatórios (400/405)
```ts
Deno.test("handler: rejeita metodo != POST com 405", async () => {
  const req = new Request("http://localhost/motor-agente", { method: "GET" });
  const resp = await handler(req);
  assertEquals(resp.status, 405);
});

Deno.test("handler: rejeita request sem telefone/agente_tipo com 400", async () => {
  const req = new Request("http://localhost/motor-agente", { method: "POST", body: JSON.stringify({ mensagem: "oi" }) });
  const resp = await handler(req);
  assertEquals(resp.status, 400);
});
```
(Sem necessidade de mock de Supabase — esses branches retornam antes de qualquer chamada ao banco.)

### Passo 2: lead bloqueado (200, `{blocked: true}`)
Use `respostasBaseHandler` sobrescrevendo `"leads"` para `{ data: { id: "lead-1", nome: "Fulano", opt_in: true, bloqueado: true } }`. Chame `handler(requestFake("oi"), mockSupabase)`. Assert: status 200, corpo `{ blocked: true }`, e nenhuma chamada de `insert`/`update` em `mensagens` (verifique em `chamadas`).

### Passo 3: prompt ausente (500 via catch top-level)
Sobrescreva `"prompts_agentes"` para `{ data: null }`. Assert: status 500, corpo `{ error: "Erro interno", details: ... }` contendo "Prompt nao encontrado".

### Passo 4: boas-vindas Sofia
Monte um cenário com `agente_tipo: "sofia"`, `conversaJustCreated=true` (conversa nova — não passe `conversa_id`, ou mock `"conversas"` como vazio pra forçar o insert), e `"prompts_agentes"` retornando `menu_boas_vindas: "Bem-vindo à Sofia!"`. Assert: a mensagem de boas-vindas é salva/enviada (verifique `chamadas` ou a resposta, conforme o que `handler()` efetivamente retorna nesse branch — leia `index.ts:972-990` pra confirmar o efeito observável exato antes de escrever o assert).

### Passo 5: catch top-level genérico (qualquer exceção não tratada)
Force uma exceção não relacionada aos outros passos — por exemplo, faça `comFetchMockado` lançar para a URL do chat/completions (simulando uma falha de rede genuína, não um 429/503 tratado pelo retry). Assert: status 500, corpo com `error: "Erro interno"` e `details` contendo a mensagem do erro forçado.

**Verify a cada passo**: `deno test --no-check --allow-env --allow-read --allow-net .` → todos passam, incluindo os novos até aquele ponto.

## Test plan
Já detalhado nos Passos 1-5 acima — este plano inteiro é sobre adicionar testes, não há uma seção de test plan separada da lista de passos.

## Done criteria
- [ ] Os 5 branches listados em "Estado atual" têm pelo menos 1 teste cada
- [ ] `deno test --no-check --allow-env --allow-read --allow-net .` → `0 failed`, incluindo os ~6-7 testes novos
- [ ] Nenhuma linha de `index.ts` modificada
- [ ] `plans/README.md` atualizado

## STOP conditions
- Se escrever um teste para qualquer um dos 5 branches revelar que o comportamento real diverge do que os comentários/nome de variável sugerem (ex.: o menu de boas-vindas da Sofia não dispara como esperado) — pare, não "conserte" silenciosamente; documente como um achado novo e mantenha o teste vermelho até decisão do Valmir.
- Se `respostasBaseHandler`/`criarSupabaseMock` não conseguir expressar algum cenário (ex.: diferenciar select de insert na mesma tabela, mesma limitação notada no plano 005) — use um teste de unidade mais isolado se possível, ou reporte a limitação em vez de forçar um mock frágil.

## Maintenance notes
- Este plano é pré-requisito recomendado (não obrigatório, mas fortemente recomendado) para o [plano 017](017-td01-extrair-secoes-handler.md) — a refatoração do `handler()` proposta lá é arriscada sem esses testes de característica (characterization tests) já em verde.
- Revisor deve confirmar que nenhum teste novo depende de estado externo real (rede, banco) — todos devem rodar via os mocks já estabelecidos.
