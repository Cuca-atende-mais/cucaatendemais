# Plan 007: Unificar `UNIDADES_MAP` e `nomesUnidades` (elimina duplicação)

> **Executor instructions**: Siga passo a passo, verifique cada passo. STOP conditions → pare e reporte.
>
> **Drift check**: `git diff --stat bf8b152..HEAD -- supabase/functions/motor-agente/index.ts` antes de começar.

## Status
- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `bf8b152`, 2026-07-16

## Por que isso importa

`UNIDADES_MAP` (`index.ts:17-22`) e `nomesUnidades` (declarada dentro de `detectarTrocaUnidade`, `index.ts:254-257`) contêm os mesmos 6 pares chave→label (`barra`, `jangurussu`, `mondubim`, `pici`, `jose walter`/`josé walter`/`walter`), diferindo só em `UNIDADES_MAP` também ter as chaves de dígito (`'1'`-`'5'`). Nada garante que fiquem sincronizados — um rename de unidade ou correção de typo precisa ser aplicado em 2 lugares, e já há evidência de drift (formatação de linha diferente entre as duas, sinal de origem copy-paste).

## Estado atual

```ts
// index.ts:17-22
const UNIDADES_MAP: Record<string, string> = {
  'barra': 'Cuca Barra', 'jangurussu': 'Cuca Jangurussu', 'mondubim': 'Cuca Mondubim',
  'pici': 'Cuca Pici', 'josé walter': 'Cuca José Walter',
  'jose walter': 'Cuca José Walter', 'walter': 'Cuca José Walter',
  '1': 'Cuca Barra', '2': 'Cuca Jangurussu', '3': 'Cuca Mondubim', '4': 'Cuca Pici', '5': 'Cuca José Walter',
};
```
```ts
// index.ts:252-257 (dentro de detectarTrocaUnidade)
export function detectarTrocaUnidade(texto: string, unidadeAtual: string): string | null {
  const lower = texto.toLowerCase().trim();
  const nomesUnidades: Record<string, string> = {
    'barra': 'Cuca Barra', 'jangurussu': 'Cuca Jangurussu', 'mondubim': 'Cuca Mondubim',
    'pici': 'Cuca Pici', 'josé walter': 'Cuca José Walter', 'jose walter': 'Cuca José Walter', 'walter': 'Cuca José Walter',
  };
  for (const [chave, unidade] of Object.entries(nomesUnidades)) {
    if (contemPalavra(lower, chave) && unidade !== unidadeAtual) {
      return unidade;
    }
  }
  // ... resto da função
```

Testes existentes que fixam o comportamento de `detectarTrocaUnidade` (padrão a seguir): `index.test.ts:103-156` (busque por `detectarTrocaUnidade` nesse arquivo).

## Comandos que você vai precisar

| Propósito | Comando | Esperado |
|---|---|---|
| Testes | `deno test --no-check --allow-env --allow-read --allow-net .` | `0 failed`, mesma contagem de antes |
| Typecheck | `deno check index.ts` | não piora vs. baseline |

## Escopo
**No escopo:** `index.ts:17-22` e `index.ts:254-257`.
**Fora do escopo:** qualquer outro uso de `UNIDADES_MAP` no arquivo (ex.: `detectarUnidadeDireta`, que usa as chaves de dígito) — não deve mudar de comportamento.

## Fluxo git
- Branch: `advisor/007-td02-unificar-mapa-unidades`
- Commit único.

## Passos

### Passo 1: derivar `nomesUnidades` de `UNIDADES_MAP`

Troque o literal duplicado dentro de `detectarTrocaUnidade` por uma derivação do módulo-level `UNIDADES_MAP`, filtrando as chaves numéricas:

```ts
const NOMES_UNIDADES_POR_PALAVRA: Record<string, string> = Object.fromEntries(
  Object.entries(UNIDADES_MAP).filter(([chave]) => !/^\d$/.test(chave))
);
```
Declare essa constante no nível de módulo, logo depois de `UNIDADES_MAP` (linha 22), e troque o corpo de `detectarTrocaUnidade` para usar `NOMES_UNIDADES_POR_PALAVRA` em vez do literal local `nomesUnidades`:

```ts
export function detectarTrocaUnidade(texto: string, unidadeAtual: string): string | null {
  const lower = texto.toLowerCase().trim();
  for (const [chave, unidade] of Object.entries(NOMES_UNIDADES_POR_PALAVRA)) {
    if (contemPalavra(lower, chave) && unidade !== unidadeAtual) {
      return unidade;
    }
  }
  // ... resto da função igual
```

**Verify**: `grep -n "nomesUnidades" index.ts` não retorna mais o literal duplicado (só, no máximo, a nova constante `NOMES_UNIDADES_POR_PALAVRA` se você optar por um nome que contenha a palavra — ajuste o grep conforme o nome escolhido).

## Test plan

Nenhum teste novo necessário — isso é uma refatoração comportamento-preservando. A suíte existente para `detectarTrocaUnidade` (`index.test.ts:103-156`, cobre exact-match e typo-tolerant conforme §4/Item 4 do arquivo) já pina o comportamento exato; se ela continuar verde, a extração está correta.

**Verify**: `deno test --no-check --allow-env --allow-read --allow-net .` → `0 failed`, mesma contagem de `passed`.

## Done criteria
- [ ] `grep -n "'barra': 'Cuca Barra'" index.ts` retorna só 1 ocorrência (antes eram 2)
- [ ] `deno test --no-check --allow-env --allow-read --allow-net .` → `0 failed`
- [ ] `deno check index.ts` não piora vs. baseline
- [ ] Nenhum arquivo fora do escopo modificado
- [ ] `plans/README.md` atualizado

## STOP conditions
- Se `NOMES_UNIDADES_POR_PALAVRA` (filtrando chaves de 1 dígito) capturar ou deixar de capturar alguma chave que `nomesUnidades` original tinha e `UNIDADES_MAP` não — não deveria acontecer (mesmas 6 chaves de texto em ambos), mas se o `grep`/leitura mostrar qualquer chave a mais/a menos nos dois literais originais, pare e reporte em vez de assumir que são idênticos.

## Maintenance notes
- Daqui pra frente, adicionar/renomear uma unidade só precisa tocar `UNIDADES_MAP`.
- Revisor deve confirmar que `detectarUnidadeDireta` (outro consumidor de `UNIDADES_MAP`, fora do escopo deste plano) continua recebendo as chaves numéricas normalmente — a filtragem só afeta a constante derivada nova, não o `UNIDADES_MAP` original.
