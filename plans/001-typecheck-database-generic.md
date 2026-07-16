# Plan 001: Restaurar `deno check` funcional no `motor-agente` (gerar tipos do Supabase)

> **Executor instructions**: Siga este plano passo a passo. Rode cada comando
> de verificação e confirme o resultado esperado antes do próximo passo. Se
> algo na seção "STOP conditions" ocorrer, pare e reporte — não improvise.
> Ao terminar, atualize a linha de status deste plano em `plans/README.md`
> (a menos que quem te despachou tenha dito que cuida do índice).
>
> **Drift check (rodar primeiro)**: `git diff --stat bf8b152..HEAD -- supabase/functions/motor-agente`
> Se algum arquivo no escopo mudou desde que este plano foi escrito, compare
> os trechos de "Estado atual" abaixo com o código real antes de prosseguir;
> se não baterem, trate como STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (mas os planos 002–005 pressupõem que `deno check` volta a rodar limpo, então fazer este primeiro evita ambiguidade sobre "esse erro já existia ou eu introduzi")
- **Category**: dx / tech-debt
- **Planned at**: commit `bf8b152`, 2026-07-16

## Por que isso importa

`deno check index.ts` hoje falha com **75 erros de tipo**, todos rastreáveis a uma única causa: `createClient(...)` (linha 906) e o tipo `ReturnType<typeof createClient>` usado em todo o arquivo são chamados/declarados **sem o generic `Database`**. Sem esse generic, o `supabase-js` v2 não consegue inferir os tipos de linha das tabelas, e qualquer `.update({...})`/`.insert({...})` acaba tipado como `never` — daí os erros `TS2339`/`TS2345`/`TS18047` em cascata.

Isso não são 75 bugs distintos — é **1 causa raiz**. Mas o efeito prático é grave: hoje os testes só rodam com a flag `--no-check` (confirmado em `docs/qa/AUDITORIA-motor-agente-institucional-2026-07-07.md:204`), ou seja, **não existe nenhuma rede de segurança de tipos rodando sobre o arquivo mais crítico do repo**. Qualquer regressão de tipo (passar `undefined` onde não pode, esquecer um campo obrigatório num `.insert()`) passa despercebida até virar bug em produção. Corrigir a causa raiz restaura essa rede de segurança para todo o resto do trabalho (incluindo os planos 002–005 deste lote).

## Estado atual

- `supabase/functions/motor-agente/index.ts` — arquivo único de 1437 linhas, a Edge Function em Deno.
  - Linha 2: `import { createClient } from "jsr:@supabase/supabase-js@2";`
  - Linha 183: `supabase: ReturnType<typeof createClient>,` (parâmetro de função — mesmo padrão se repete nas linhas 687, 756, 818, 842, 871, 895)
  - Linha 906: `const supabase = supabaseOverride ?? createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);`
- `supabase/functions/motor-agente/deno.json` — hoje só tem `{"nodeModulesDir": "auto"}`, sem `imports`/paths para um arquivo de tipos.
- Não existe nenhum `database.types.ts` (ou nome equivalente) em lugar nenhum do repo — confirmado por busca. Não há Supabase CLI instalada nesta máquina de auditoria (`supabase --version` → command not found); a máquina do Valmir deve ter (ele já faz deploy das Edge Functions).
- `project_id` do Supabase, de `supabase/config.toml:5`: `cucaatendemais`.
- Exemplo de erro real de hoje (rodando `deno check index.ts` na pasta `supabase/functions/motor-agente`):
  ```
  TS2339 [ERROR]: Property 'id' does not exist on type 'never'.
        await salvarMensagemAgente(supabase, conversa.id, lead.id, parte);
  TS2345 [ERROR]: Argument of type '{ status: string; updated_at: string; }' is not assignable to parameter of type 'never'.
  ```

## Comandos que você vai precisar

| Propósito | Comando | Esperado no sucesso |
|---|---|---|
| Gerar tipos (via projeto remoto, precisa login/token) | `npx supabase@latest gen types typescript --project-id cucaatendemais --schema public` | JSON/TS válido no stdout, sem erro de auth |
| Typecheck (baseline atual) | `deno check index.ts` (dentro de `supabase/functions/motor-agente`) | HOJE: `Found 75 errors` — depois do fix: `exit 0` sem output de erro |
| Testes | `deno test --no-check --allow-env --allow-read --allow-net .` (mesma pasta) | `127 passed \| 0 failed \| 2 ignored` (ou mais, se planos 002–005 já rodaram antes) — **não deve regredir** |

## Escopo

**No escopo:**
- `supabase/functions/motor-agente/database.types.ts` (criar, arquivo gerado)
- `supabase/functions/motor-agente/index.ts` (só as linhas que declaram/usam `createClient`/`ReturnType<typeof createClient>` — trocar para o client tipado)
- `supabase/functions/motor-agente/deno.json` (se precisar de um import map para o arquivo de tipos)

**Fora do escopo (não mexer, mesmo que pareça relacionado):**
- Qualquer erro de tipo **real** (não causado pela ausência do generic) que sobrar depois do fix — ver STOP conditions abaixo. Não tente "corrigir" esses erros silenciosamente; eles são achados novos, não parte deste plano.
- `index.test.ts` / `index.audit.test.ts` — não precisam mudar; continuam rodando com `--no-check`.
- Qualquer outra Edge Function do repo (`supabase/functions/*`) — fora do escopo deste plano, mesmo que tenha o mesmo problema.

## Fluxo git

- Branch: `advisor/001-typecheck-database-generic` (ou a convenção de branch que vocês já usam pras stories S-WM-*)
- Um commit por passo lógico (gerar tipos / tipar o client / limpar erros residuais)
- Mensagem de commit: seguir o padrão observado no `git log` do repo (ex.: `fix(motor-agente): S-WM-XX — ...` ou `chore(motor-agente): ...` — este não é uma "story" numerada, então `chore(motor-agente): restaura deno check via tipos gerados do Supabase` é razoável)
- **Não** faça push nem abra PR a menos que instruído.

## Passos

### Passo 1: Gerar o arquivo de tipos

Rode, na raiz do repo ou em `supabase/functions/motor-agente`:

```
npx supabase@latest gen types typescript --project-id cucaatendemais --schema public > supabase/functions/motor-agente/database.types.ts
```

Isso requer estar autenticado (`supabase login` previamente, ou variável `SUPABASE_ACCESS_TOKEN`). Se o comando falhar por falta de auth, **não invente credenciais nem tente contornar** — pare e reporte (ver STOP conditions).

**Verify**: `head -5 supabase/functions/motor-agente/database.types.ts` mostra um `export type Database = { public: { Tables: { ... } } }` válido (ou estrutura equivalente do gerador).

### Passo 2: Tipar o client em todos os pontos de declaração

Em `index.ts`:
1. Adicione o import: `import type { Database } from "./database.types.ts";` (logo abaixo da linha 2)
2. Troque toda ocorrência de `ReturnType<typeof createClient>` por `ReturnType<typeof createClient<Database>>` — são as linhas 183, 687, 756, 818, 842, 871, 895 (confirme com `grep -n "ReturnType<typeof createClient>" index.ts` antes e depois — deve ir de N ocorrências para 0 sem generic).
3. Na linha 906, troque `createClient(...)` por `createClient<Database>(...)`.

**Verify**: `grep -n "ReturnType<typeof createClient>$" index.ts` (sem o `<Database>`) não deve mais ter nenhum resultado dentro de tipos de parâmetro — só pode sobrar, se houver, dentro do próprio `database.types.ts` gerado (que você não deve editar).

### Passo 3: Rodar o typecheck e resolver o que sobrar

```
deno check index.ts
```

Depois do Passo 2, a expectativa é que a **grande maioria** dos 75 erros desapareça (eram todos `never`-typed por causa do client não tipado). Pode sobrar um número pequeno de erros **reais** (ex.: um campo que o código lê mas não existe na tabela, um `.single()` sem tratar `null`) — esses são achados novos, não bugs que você deve corrigir neste plano.

**Se sobrar qualquer erro após o Passo 2**: pare, liste os erros restantes (mensagem completa + `file:line`) e reporte como um achado separado — não tente "fazer o `deno check` passar" mudando lógica de negócio ou adicionando `as any`/`@ts-ignore` para calar o erro. Isso violaria o propósito do plano.

**Verify**: `deno check index.ts` roda até o fim (não trava) e você tem uma lista fechada de erros restantes (idealmente 0).

## Test plan

- Não são necessários testes novos — este plano é puramente de tipos, não de comportamento.
- **Verificação obrigatória de não-regressão**: `deno test --no-check --allow-env --allow-read --allow-net .` continua com `0 failed` (o mesmo número de `passed` de antes, ou mais se outro plano já rodou).
- Opcional, mas recomendado: depois que `deno check` passar limpo, rode `deno test --allow-env --allow-read --allow-net .` (SEM `--no-check`) uma vez, para confirmar que os testes também passam com typecheck ligado. Se passar, considere remover o `--no-check` do comando de teste padrão do time (fora do escopo mecânico deste plano — é uma sugestão pro Valmir decidir, não uma ação obrigatória).

## Done criteria

Machine-checkable. TODAS precisam valer:

- [ ] `supabase/functions/motor-agente/database.types.ts` existe e não está vazio
- [ ] `deno check index.ts` (dentro de `supabase/functions/motor-agente`) sai com exit 0 **OU** você reportou explicitamente os erros reais restantes como achado separado (não os escondeu)
- [ ] `deno test --no-check --allow-env --allow-read --allow-net .` continua `0 failed`
- [ ] `grep -n "ReturnType<typeof createClient>" index.ts` só retorna ocorrências com `<Database>` explícito
- [ ] Nenhum arquivo fora do escopo listado foi modificado (`git status`)
- [ ] `plans/README.md` linha de status deste plano atualizada

## STOP conditions

Pare e reporte (não improvise) se:

- O comando `supabase gen types` falhar por falta de autenticação/permissão — não tente gerar tipos manualmente escrevendo o arquivo à mão; isso viraria fonte de verdade errada.
- Depois do Passo 2, sobrarem erros de tipo que parecem apontar para um **bug de comportamento real** (não um problema de tipagem) — por exemplo, um campo que o código sempre assume presente mas o schema marca como nullable. Reporte como achado, não corrija a lógica aqui.
- O `deno check` continuar reportando `never` em algum ponto mesmo depois do generic aplicado — sinal de que pode haver mais de um client sendo criado sem tipo em outro arquivo (`getOpenAIKey`, etc. já usam o parâmetro tipado se o Passo 2 foi feito certo; se algum ainda vazar `never`, é sinal de um site que você perdeu no grep).

## Maintenance notes

- Sempre que o schema do Postgres mudar (nova coluna, nova tabela usada pelo `motor-agente`), `database.types.ts` precisa ser regenerado (mesmo comando do Passo 1). Isso hoje é manual — vale considerar (fora do escopo deste plano) automatizar via um script `npm run gen:types` ou hook de CI, mas essa é uma decisão do Valmir, não deste plano.
- Se outras Edge Functions do repo (`supabase/functions/*`, fora de `motor-agente`) tiverem o mesmo padrão de `createClient()` sem generic, elas têm o mesmo problema — não estão no escopo aqui, mas valem uma auditoria futura.
- O que um revisor deve checar no diff: que nenhuma lógica de negócio mudou — este plano só deveria tocar imports/tipos e o arquivo gerado.
