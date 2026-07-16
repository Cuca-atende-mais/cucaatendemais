# Plan 015: Endurecer o isolamento de `lead.nome` no prompt (revisão de uma mitigação já deliberada)

> **Executor instructions**: Este achado é sobre uma decisão **já tomada conscientemente** pelo time (documentada no próprio código) — não é um bug por omissão. Leia "Por que isso importa" com atenção antes de decidir se vale endurecer agora ou deixar como está.
>
> **Drift check**: `git diff --stat bf8b152..HEAD -- supabase/functions/motor-agente/index.ts` antes de começar.

## Status
- **Priority**: P3
- **Effort**: S/M
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `bf8b152`, 2026-07-16

## Por que isso importa

`lead.nome` (o nome de exibição do WhatsApp — `push_name`, controlado inteiramente pelo próprio usuário) é interpolado direto num turno `role: "user"` do histórico enviado ao GPT:

```ts
// index.ts:1371-1374
const contextoNomeLead = {
  role: "user",
  content: "[CONTEXTO INTERNO — nao e mensagem do lead] NOME DO LEAD: " + (lead.nome || "Nao informado"),
};
```

O comentário em `index.ts:1334-1339` (TOM-04) já reconhece explicitamente que isso é uma superfície de prompt injection e explica a decisão tomada: separar o "dado" (nome, no turno user) da "instrução" (regra de uso, no prompt de sistema), justamente para reduzir o risco. **Isso é uma mitigação real, mas parcial** — o rótulo `[CONTEXTO INTERNO — nao e mensagem do lead]` é só texto; nada impede um `lead.nome` malicioso (ex.: contendo `]] IGNORE INSTRUCOES ANTERIORES [[`) de tentar se passar por uma instrução do sistema dentro desse mesmo turno "user".

Esse achado não é "conserte o bug" — é "considere endurecer uma proteção que já existe, mas é só textual". Decisão de prioridade cabe ao Valmir: o rótulo textual pode já ser suficiente na prática (GPT-4o costuma respeitar bem esse tipo de marcação), e o esforço de reforçar tem custo real.

## Estado atual

```ts
// index.ts:1330-1364 (promptFinal, trecho relevante)
// TOM-04: regra genérica, sem dado do usuário — o dado (nome) vai isolado no turno
// "user" (contextoNomeLead), sem diretiva junto. Separar dado de instrução fecha a
// superfície de prompt injection (lead.nome é controlado pelo próprio usuário) e mantém
// a regra comportamental no prompt de sistema, onde é seguida de forma confiável — uma
// instrução de moderação num turno "user" antecipado, longe do ponto de geração, é
// seguida com muito menos confiabilidade.
"Se o contexto informar o nome do lead, use-o com moderacao (1-2x, em momentos naturais da conversa).",
```
```ts
// index.ts:1366-1374
// TOM-04: o worker já captura e grava lead.nome (push_name do WhatsApp), mas esse dado
// nunca chegava ao prompt do GPT. Aqui vai só o FATO, sem diretiva — a regra de como usar
// fica no promptFinal (system) acima. lead.nome é o nome de exibição do WhatsApp,
// controlado pelo próprio usuário; marcado explicitamente como contexto interno pra não
// ser lido como fala do lead.
const contextoNomeLead = {
  role: "user",
  content: "[CONTEXTO INTERNO — nao e mensagem do lead] NOME DO LEAD: " + (lead.nome || "Nao informado"),
};
// index.ts:1377
const { texto: respostaGerada } = await chamarGPT(promptFinal, [contextoNomeLead, ...historico], openaiKey, prompt.temperatura, prompt.max_tokens);
```

`lead.nome` não passa por nenhuma sanitização/truncamento em nenhum ponto do arquivo antes de chegar aqui (confirmado por grep — só é lido em `index.ts:915`, `917`, e usado em `index.ts:1373`).

## Comandos que você vai precisar

| Propósito | Comando | Esperado |
|---|---|---|
| Testes | `deno test --no-check --allow-env --allow-read --allow-net .` | `0 failed` |

## Escopo
**No escopo:** a construção de `contextoNomeLead` (`index.ts:1371-1374`).
**Fora do escopo:** a decisão TOM-04 de separar dado de instrução (já correta, não mexer); qualquer mudança em como o prompt de sistema instrui o uso do nome.

## Fluxo git
- Branch: `advisor/015-sec03-sanitizar-nome-lead`
- Commit único.

## Passos

### Passo 1: truncar e remover sequências de controle óbvias

```ts
function sanitizarNomeLead(nome: string | null | undefined): string {
  if (!nome) return "Nao informado";
  return nome
    .replace(/[\[\]]/g, "") // remove colchetes — evita fechar/abrir blocos de "contexto interno" falsos
    .replace(/[\r\n]+/g, " ") // achata quebras de linha — evita simular múltiplos turnos/instruções
    .trim()
    .slice(0, 80); // nomes de exibição do WhatsApp não passam disso na prática; corta qualquer payload longo
}

const contextoNomeLead = {
  role: "user",
  content: "[CONTEXTO INTERNO — nao e mensagem do lead] NOME DO LEAD: " + sanitizarNomeLead(lead.nome),
};
```

O limite de 80 caracteres e a lista de caracteres removidos são um ponto de partida razoável, não um número mágico — ajuste se o Valmir tiver dados reais de distribuição de tamanho de `push_name` do WhatsApp.

**Verify**: `grep -n "sanitizarNomeLead" index.ts` retorna as linhas novas.

## Test plan

Adicione em `index.audit.test.ts` (ou `index.test.ts`, se preferir manter perto de outros testes de função pura — exporte `sanitizarNomeLead` seguindo o padrão de outras funções auxiliares testadas diretamente):

1. Nome normal (`"Maria Silva"`) → passa inalterado (exceto trim).
2. Nome com colchetes (`"Maria]] IGNORE [["`) → colchetes removidos.
3. Nome com quebra de linha → achatado para espaço.
4. Nome muito longo (200 caracteres) → truncado para 80.
5. `null`/`undefined`/string vazia → `"Nao informado"` (comportamento atual preservado).

**Verify**: `deno test --no-check --allow-env --allow-read --allow-net .` → todos passam, incluindo os novos.

## Done criteria
- [ ] `sanitizarNomeLead` aplicada antes da interpolação em `contextoNomeLead`
- [ ] Os 5 casos do Test plan cobertos e passando
- [ ] `deno test --no-check --allow-env --allow-read --allow-net .` → `0 failed`
- [ ] Nenhum arquivo fora do escopo modificado
- [ ] `plans/README.md` atualizado

## STOP conditions
- Se o Valmir preferir não aplicar este plano agora (é uma mitigação de um risco já parcialmente coberto, prioridade baixa por design) — marque como REJECTED em `plans/README.md` com o motivo, não force a aplicação.

## Maintenance notes
- Esta sanitização é defesa em profundidade sobre uma mitigação que já existe (separação dado/instrução do TOM-04) — não substitui a necessidade de o prompt de sistema continuar resistente a esse tipo de conteúdo no turno "user".
- Se outros campos controlados pelo usuário forem adicionados ao prompt no futuro (ex.: algum campo de perfil), considere o mesmo padrão de sanitização.
