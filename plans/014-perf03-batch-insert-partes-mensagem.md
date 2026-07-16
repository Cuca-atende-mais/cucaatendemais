# Plan 014: Avaliar batch dos inserts de partes de mensagem — ou aceitar o custo como intencional

> **Executor instructions**: Este plano é mais uma investigação com uma recomendação condicional do que um fix mecânico direto — leia toda a seção "Por que isso importa" antes de decidir qual dos 2 caminhos (Passo 2a ou 2b) seguir.
>
> **Drift check**: `git diff --stat bf8b152..HEAD -- supabase/functions/motor-agente/index.ts` antes de começar.

## Status
- **Priority**: P3
- **Effort**: S
- **Risk**: MED (risco de embaralhar ordem do histórico se o batch for feito sem cuidado — ver abaixo)
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `bf8b152`, 2026-07-16

## Por que isso importa

`index.ts:1424-1426` insere cada parte de uma resposta dividida (até 3, por `dividirRespostaEmPartes`) em um loop sequencial — 1 round-trip de banco por parte:

```ts
for (const parte of mensagens) {
  await salvarMensagemAgente(supabase, conversa.id, lead.id, parte);
}
```

Isso adiciona até 2 round-trips extras de latência no fim de toda resposta longa/listável (feature TOM-03b, `index.ts:772-799`) — um caso comum o suficiente para valer investigar.

**O risco real de "só trocar por `Promise.all`"**: o histórico é lido depois por `ORDER BY created_at ASC` (`index.ts:965`, `.order("created_at", { ascending: true })`... conferir orientação exata no código real). Se os 3 inserts rodarem em paralelo, a ordem de conclusão (e portanto o `created_at` de cada linha, se o banco usar `now()` no momento da escrita) não é garantida de bater com a ordem lógica das partes (abertura → lista → fechamento). Isso quebraria a leitura de histórico do próximo turno, que assume ordem cronológica = ordem lógica.

## Estado atual

```ts
// index.ts:1424-1426
for (const parte of mensagens) {
  await salvarMensagemAgente(supabase, conversa.id, lead.id, parte);
}
```
```ts
// salvarMensagemAgente, index.ts:756-758
async function salvarMensagemAgente(supabase: ReturnType<typeof createClient>, conversa_id: string, lead_id: string, conteudo: string) {
  await supabase.from("mensagens").insert({ conversa_id, lead_id, tipo: "text", conteudo, remetente: "agente" });
}
```
```ts
// leitura de histórico, index.ts:965
const { data: hist } = await supabase.from("mensagens").select("conteudo,remetente").eq("conversa_id", conversa.id).order("created_at", { ascending: false }).limit(MAX_HISTORICO);
const historico = (hist || []).reverse().map(...);
```
`dividirRespostaEmPartes` limita a no máximo ~3 partes (`index.ts:772-799`) — o teto é baixo, o que reduz a urgência real desse achado (o custo máximo é 2 round-trips extras, não N).

## Comandos que você vai precisar

| Propósito | Comando | Esperado |
|---|---|---|
| Testes | `deno test --no-check --allow-env --allow-read --allow-net .` | `0 failed` |

## Escopo
**No escopo:** `index.ts:1424-1426` e, se o Passo 2b for escolhido, a tabela `mensagens` (checar se há uma coluna de sequência/ordem explícita além de `created_at` — se não houver, ver STOP conditions).
**Fora do escopo:** `dividirRespostaEmPartes` (a lógica de divisão em si, já correta); a leitura de histórico (linha 965) — não mude o `order by` sem entender completamente o impacto em todo o resto do arquivo que depende dessa ordem.

## Fluxo git
- Branch: `advisor/014-perf03-batch-insert-mensagens`
- Commit único.

## Passos

### Passo 1: investigar se `mensagens` tem coluna de sequência explícita

Como não há acesso a schema/migrations neste escopo de auditoria (arquivo único), verifique com o Valmir ou em `supabase/migrations/` (fora do escopo do arquivo auditado, mas acessível no repo) se a tabela `mensagens` tem alguma coluna além de `created_at` que garanta ordem (ex.: um `sequencia`/`ordem` incremental, ou se `created_at` tem precisão de microssegundos suficiente para nunca colidir em um insert em lote no mesmo milissegundo).

### Passo 2a: SE não houver garantia de ordem — manter sequencial, documentar a decisão

Se não houver coluna de sequência e `created_at` não tiver precisão suficiente para garantir ordem determinística num insert paralelo, **não aplique batch**. Em vez disso, adicione um comentário no código explicando que o loop é sequencial de propósito (evita ambiguidade de ordem no histórico), para que isso não seja re-reportado como achado de performance numa próxima auditoria:

```ts
// Sequencial de propósito: a ordem das partes (abertura/lista/fechamento) precisa bater com
// created_at na leitura de histórico (linha ~965) — um Promise.all aqui arriscaria embaralhar
// a ordem lógica. Custo aceito: até 2 round-trips extras por resposta dividida (máx. 3 partes,
// dividirRespostaEmPartes). Ver plans/014 para o raciocínio completo.
for (const parte of mensagens) {
  await salvarMensagemAgente(supabase, conversa.id, lead.id, parte);
}
```

**Verify**: `grep -n "Sequencial de propósito" index.ts` retorna a linha nova.

### Passo 2b: SE houver garantia de ordem (coluna de sequência explícita, ou você confirma que um insert em lote preserva ordem de array na tabela) — batch com campo de ordem

```ts
async function salvarMensagensAgente(supabase: ReturnType<typeof createClient>, conversa_id: string, lead_id: string, partes: string[]) {
  await supabase.from("mensagens").insert(
    partes.map((conteudo, i) => ({ conversa_id, lead_id, tipo: "text", conteudo, remetente: "agente" /*, sequencia: i — se a coluna existir */ }))
  );
}
```
E troque o loop por uma única chamada: `await salvarMensagensAgente(supabase, conversa.id, lead.id, mensagens);`. Ajuste a leitura de histórico (linha 965) para ordenar por essa coluna nova em vez de (ou além de) `created_at`, SE necessário — mudança fora do escopo original deste plano, trate como extensão que precisa de sua própria verificação cuidadosa.

**Verify**: `deno test --no-check --allow-env --allow-read --allow-net .` → `0 failed`, incluindo um teste novo que confirma ordem preservada (ver Test plan).

## Test plan

**Se seguiu 2a**: nenhum teste novo necessário, só o comentário.

**Se seguiu 2b**: adicione em `index.audit.test.ts` um teste que monta uma resposta que gera 3 partes (via `dividirRespostaEmPartes` real, não mock) e confirma, via o mock de Supabase (inspecionando `chamadas`/`payload` do insert em `mensagens`), que as 3 partes foram enviadas em um único `insert` com array, na ordem correta (abertura, lista, fechamento).

**Verify**: `deno test --no-check --allow-env --allow-read --allow-net .` → todos passam.

## Done criteria
- [ ] Passo 1 (investigação) documentado — qual caminho (2a/2b) foi escolhido e por quê
- [ ] Caminho escolhido aplicado
- [ ] `deno test --no-check --allow-env --allow-read --allow-net .` → `0 failed`
- [ ] Nenhum arquivo fora do escopo modificado
- [ ] `plans/README.md` atualizado

## STOP conditions
- Se não for possível confirmar com confiança que um insert em lote preserva ordem de leitura subsequente (nem por `created_at` com precisão suficiente, nem por uma coluna de sequência) — não arrisque, siga o Passo 2a (manter sequencial, documentar).
- Se qualquer teste do histórico de conversa (busca por "hist" ou "historico" em `index.audit.test.ts`) falhar depois do Passo 2b — reverta para 2a, o risco se materializou.

## Maintenance notes
- Este é o tipo de achado onde "não fazer nada, documentar a razão" é um resultado legítimo (ver rubrica de priorização do próprio processo de auditoria) — não force o batch só para "resolver" o achado se o risco de ordem não puder ser descartado com confiança.
