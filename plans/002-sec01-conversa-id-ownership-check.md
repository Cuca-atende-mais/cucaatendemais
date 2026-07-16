# Plan 002: Impedir que `conversa_id` de outro lead seja aceito pelo `motor-agente`

> **Executor instructions**: Siga este plano passo a passo. Rode cada comando
> de verificação e confirme o resultado esperado antes do próximo passo. Se
> algo na seção "STOP conditions" ocorrer, pare e reporte — não improvise.
> Ao terminar, atualize a linha de status deste plano em `plans/README.md`.
>
> **Drift check (rodar primeiro)**: `git diff --stat bf8b152..HEAD -- supabase/functions/motor-agente`
> Se o arquivo mudou desde que este plano foi escrito, compare os trechos de
> "Estado atual" com o código real antes de prosseguir; se não baterem, trate
> como STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (independente do plano 001, mas se ambos forem executados, faça 001 primeiro pra ter `deno check` como rede de segurança extra neste)
- **Category**: security
- **Planned at**: commit `bf8b152`, 2026-07-16

## Por que isso importa

Quando o request para `motor-agente` inclui `conversa_id`, a conversa é buscada **só por `id`**, sem checar que ela pertence ao `lead` resolvido pelo `telefone` do mesmo request (`index.ts:938-939`). O caminho alternativo (sem `conversa_id`, `index.ts:940`) já filtra por `lead_id` — só o caminho com `conversa_id` explícito tem esse buraco.

**Isso é alcançável de fora do worker.** Confirmei em `supabase/config.toml` que não há override de `verify_jwt` para `motor-agente` (nenhuma seção `[functions.motor-agente]`), e que a `anon key` do projeto está exposta publicamente no `cuca-portal` (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, usada em `cuca-portal/src/lib/supabase/client.ts`). Isso significa que qualquer requisição com JWT válido (a anon key pública serve) pode chamar a função diretamente em `https://<project>.supabase.co/functions/v1/motor-agente`, sem passar pelo worker — não depende de vazar a `SUPABASE_SERVICE_ROLE_KEY`.

Com um `conversa_id` de outra conversa (de outro lead) no body, o request:
- grava uma mensagem de agente na conversa alheia com `lead_id` do atacante misturado ao `conversa_id` da vítima (`index.ts:1425`, via `salvarMensagemAgente`) — quebra integridade referencial entre `mensagens`/`conversas`/`leads`;
- pode forçar `status` da conversa alheia para `awaiting_human` ou `encerrada` (`index.ts:1427-1428`);
- pode sobrescrever `metadata` da conversa alheia (múltiplos `.update({metadata: ...})` ao longo do handler, todos usando `conversa.id` sem checagem de dono).

**Confirme com o Valmir antes de assumir isso como só teórico**: eu não tenho como testar contra o projeto Supabase real a partir desta auditoria (sem acesso às chaves) — o que confirmei é que o código não tem a checagem e que a configuração não bloqueia chamadas externas com a anon key. Se por algum motivo a anon key NÃO tiver permissão de invocar Edge Functions neste projeto específico (configuração fora do que está versionado no repo), a severidade cai — mas o fix vale de qualquer forma como defesa em profundidade.

## Estado atual

- `supabase/functions/motor-agente/index.ts:938-943`:
  ```ts
  let { data: conversa } = conversa_id
    ? await supabase.from("conversas").select("id, status, metadata").eq("id", conversa_id).single()
    : await supabase.from("conversas").select("id, status, metadata").eq("lead_id", lead.id).eq("origem_id", canal_origem || "test").single();
  if (!conversa) {
    const { data } = await supabase.from("conversas").insert({ lead_id: lead.id, origem_id: canal_origem || "test", agente_tipo, canal_ativo: "meta", status: "ativa" }).select("id, status, metadata").single();
    conversa = data; conversaJustCreated = true; conversaGenuinamenteNova = true;
  }
  ```
  Note que o branch `conversa_id ? ...` (linha 939) não tem `.eq("lead_id", lead.id)`; o branch `else` (linha 940) tem.
- `lead.id` já está disponível neste ponto do handler — resolvido nas linhas 914-920, antes deste bloco.
- Convenção de erro HTTP já usada no arquivo: respostas de erro usam `new Response(JSON.stringify({ error: "..." }), { status: N })` — ver exemplos em `index.ts:896` (405), `index.ts:904` (400), `index.ts:912` (400).

## Comandos que você vai precisar

| Propósito | Comando | Esperado no sucesso |
|---|---|---|
| Typecheck | `deno check index.ts` (pasta `supabase/functions/motor-agente`) | exit 0 (assumindo plano 001 já rodou; se não, os 75 erros pré-existentes não devem aumentar) |
| Testes | `deno test --no-check --allow-env --allow-read --allow-net .` (mesma pasta) | todos passam, incluindo os novos deste plano |

## Escopo

**No escopo:**
- `supabase/functions/motor-agente/index.ts` (só o bloco de resolução de `conversa`, linhas ~938-943, e o `select` de campos)
- `supabase/functions/motor-agente/index.audit.test.ts` (adicionar os testes novos — é o arquivo usado para testes de auditoria, ver cabeçalho do arquivo)

**Fora do escopo (não mexer):**
- O branch `else` (linha 940, sem `conversa_id`) — já está correto, não precisa de mudança.
- Qualquer lógica downstream que usa `conversa.id`/`conversa.status`/`conversa.metadata` depois deste ponto — não deve mudar de comportamento para o caso legítimo (mesmo lead).
- `worker/meta_adapter_inbound.py` — o caller confia corretamente hoje (sempre manda o `conversa_id` certo para o `lead_id` certo); a correção é no lado que recebe, não no que envia.

## Fluxo git

- Branch: `advisor/002-sec01-conversa-ownership`
- Um commit cobrindo fix + testes
- Mensagem no padrão do repo, ex.: `fix(motor-agente): valida ownership de conversa_id contra lead resolvido`
- **Não** faça push nem abra PR a menos que instruído.

## Passos

### Passo 1: Incluir `lead_id` no select e validar após o fetch

Troque o bloco `index.ts:938-943` para incluir `lead_id` no `select` de ambos os branches e adicionar uma checagem explícita pós-fetch quando `conversa_id` foi informado:

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

Por que checagem pós-fetch (em JS) **além** de idealmente também restringir a query: a suíte de testes usa um mock de Supabase (`criarSupabaseMock` em `index.audit.test.ts`) que resolve `.eq()` sem realmente filtrar por valor — ele não consegue expressar "a query com esse `.eq()` retorna vazio". A checagem explícita em código é o que torna o comportamento **testável** sem depender de um Postgres real, e funciona como defesa em profundidade mesmo que a query real do Postgres já devesse ter sido restrita por RLS (fora do escopo deste plano — ver "Maintenance notes").

**Verify**: `grep -n "lead_id !== lead.id" index.ts` retorna a linha nova.

### Passo 2: Confirmar que os outros usos de `conversa.lead_id` não quebram

O objeto `conversa` agora carrega um campo `lead_id` a mais. Confirme que nenhum código downstream faz alguma checagem estrita de forma (ex.: comparação de chaves de objeto) que dependa do shape exato de `conversa` — `grep -n "conversa\." index.ts` para revisar rapidamente os usos. Não é esperado que isso quebre nada (TypeScript estrutural, campo extra é inofensivo), mas confirme antes de prosseguir.

**Verify**: leitura manual do grep acima — nenhum uso de `Object.keys(conversa)` ou serialização estrita de `conversa` inteiro que dependeria de não ter `lead_id`.

## Test plan

Adicione em `supabase/functions/motor-agente/index.audit.test.ts`, seguindo o padrão de `respostasBaseHandler`/`criarSupabaseMock`/`comFetchMockado`/`requestFakeComConversaId` já definidos no topo do arquivo (linhas ~47-146):

1. **Caso do bug (deve ser rejeitado)**: monte `respostasPorTabela` com `"leads": { data: { id: "lead-1", ... } }` e `"conversas": { data: { id: "conv-999", status: "ativa", metadata: {}, lead_id: "lead-OUTRO" } }` (ou seja, a conversa retornada pertence a um lead diferente do resolvido). Chame `handler(requestFakeComConversaId("oi", "conv-999"), mockSupabase)`. Assert: `response.status === 403` e o corpo tem `error` mencionando ownership/conversa — **não** deve chamar `salvarMensagemAgente`/gravar nada (confira em `chamadas` que não há `insert`/`update` em `mensagens` ou `conversas` além do esperado).
2. **Caso legítimo (não deve regredir)**: mesmo setup, mas `conversas.lead_id === "lead-1"` (igual ao lead resolvido) — handler deve prosseguir normalmente até uma resposta `200` (mesmo comportamento de antes do fix).
3. **Caso sem `conversa_id` (branch else, não deve regredir)**: use `requestFake(...)` (sem `conversa_id`) com o mock padrão — deve continuar funcionando exatamente como hoje.

Modelo estrutural: use `respostasBaseHandler(metadata)` como base e sobrescreva só `"conversas"` no objeto retornado, do mesmo jeito que os testes AUD-04/VAL-12 existentes fazem (ver exemplos no arquivo a partir da linha ~148).

**Verify**: `deno test --no-check --allow-env --allow-read --allow-net .` → todos os testes passam, incluindo os 2-3 novos.

## Done criteria

Machine-checkable. TODAS precisam valer:

- [ ] `deno test --no-check --allow-env --allow-read --allow-net .` → `0 failed`, incluindo os testes novos deste plano
- [ ] Teste do "caso do bug" falha se você reverter o Passo 1 (confirme rodando o teste ANTES do fix — deve falhar; DEPOIS do fix — deve passar). Isso prova que o teste realmente exercita a proteção.
- [ ] `deno check index.ts` não piora em relação à baseline (idealmente exit 0, se plano 001 já rodou)
- [ ] Nenhum arquivo fora do escopo listado foi modificado (`git status`)
- [ ] `plans/README.md` linha de status deste plano atualizada

## STOP conditions

Pare e reporte se:

- O código em `index.ts:938-943` não bater com o trecho em "Estado atual" (arquivo já mudou).
- Existir algum caller legítimo além do worker que dependa do comportamento atual (sem checagem) — não encontrei nenhum no repo (`grep -rn "motor-agente" worker/` só mostra `meta_adapter_inbound.py`), mas se você encontrar outro, pare antes de quebrar esse caller.
- O teste do "caso do bug" passar mesmo SEM o fix aplicado (sinal de que o teste não está exercitando o código certo — revise o mock antes de seguir).

## Maintenance notes

- Este fix é uma checagem em código (defesa em profundidade). O ideal a longo prazo é também ter Row Level Security (RLS) no Postgres restringindo `conversas`/`mensagens` por caller — isso é uma mudança de infraestrutura/schema, fora do escopo deste plano, mas vale o Valmir avaliar como follow-up, especialmente dado que a `anon key` está exposta publicamente.
- Se no futuro outro caller legítimo (além do worker) começar a chamar `motor-agente` passando `conversa_id` de um lead diferente por design (ex.: um painel administrativo agindo "em nome de"), esse fix vai bloquear esse caso — reavaliar a checagem nesse cenário.
- O que um revisor deve escrutinar: que a checagem de 403 acontece **antes** de qualquer leitura/escrita adicional usando `conversa.id`, e que o branch de `conversa_id` ausente (linha 940) continua sem a checagem (não faz sentido lá, já filtra por `lead_id` na query).
