# Plan 008: Cobertura de teste para `transcreverAudio` — CONDICIONAL ao plano 003

> **Executor instructions**: **Não execute este plano antes de resolver o [plano 003](003-sec02-ssrf-midia-url.md).** Se o plano 003 escolheu o caminho 2a (remoção do código), este plano fica automaticamente REJECTED — não há mais nada para testar. Só execute se o plano 003 escolheu o caminho 2b (allowlist, código mantido).
>
> **Drift check**: `git diff --stat bf8b152..HEAD -- supabase/functions/motor-agente/index.ts` antes de começar.

## Status
- **Priority**: P3 (condicional)
- **Effort**: S
- **Risk**: LOW
- **Depends on**: [`plans/003`](003-sec02-ssrf-midia-url.md) — resultado determina se este plano roda ou é rejeitado
- **Category**: tests
- **Planned at**: commit `bf8b152`, 2026-07-16

## Por que isso importa

Confirmei por grep em ambos os arquivos de teste (`index.test.ts`, `index.audit.test.ts`) que a função `transcreverAudio` (`index.ts:692-703`) e o branch que a invoca (`index.ts:911`, `midia_tipo === "audio" || midia_tipo === "ptt"`) não têm **nenhuma** cobertura de teste. Se o plano 003 manteve esse caminho (com allowlist), ele continua sem rede de segurança — qualquer regressão futura (mudança na checagem de `midia_tipo`, erro na montagem do `FormData`, erro no tratamento de falha do Whisper) passa despercebida.

## Estado atual

Ver [`plans/003`](003-sec02-ssrf-midia-url.md), seção "Estado atual" — cita o código exato de `transcreverAudio` e do allowlist (se aplicado). Não repito aqui para evitar duas fontes de verdade divergentes; leia o estado real do arquivo após o plano 003 ter rodado, não os trechos citados em 003 (podem já ter mudado).

Padrão de mock de `fetch` a reutilizar, já definido em `index.audit.test.ts:97-111` (`comFetchMockado`): intercepta por substring de URL, lança erro para qualquer URL não-mockada (falha alta, não falso-positivo silencioso). Este plano precisa de uma variante que também intercepte a URL de download do áudio e a chamada ao Whisper (`api.openai.com/v1/audio/transcriptions`).

## Comandos que você vai precisar

| Propósito | Comando | Esperado |
|---|---|---|
| Testes | `deno test --no-check --allow-env --allow-read --allow-net .` | `0 failed`, incluindo os novos |

## Escopo
**No escopo:** `index.audit.test.ts` — testes novos. Se `transcreverAudio` não estiver exportada, adicionar `export` a ela (mudança de 1 palavra em `index.ts`, mesmo padrão já usado para `avaliarSelecaoUnidade`/`evitarRepeticaoLiteral`/outras funções auxiliares testadas diretamente).
**Fora do escopo:** qualquer mudança de comportamento em `transcreverAudio` — este plano só adiciona teste, não muda lógica (a lógica já devia ter sido decidida pelo plano 003).

## Fluxo git
- Branch: `advisor/008-test02-cobertura-audio`
- Commit único.

## Passos

### Passo 1: exportar `transcreverAudio` (se ainda não estiver)
`grep -n "^function transcreverAudio\|^export function transcreverAudio" index.ts` — se retornar `function` sem `export`, adicione `export`.

**Verify**: `grep -n "export function transcreverAudio" index.ts` retorna a linha.

### Passo 2: testes de unidade para `transcreverAudio`

Em `index.audit.test.ts`, adicione (seguindo o padrão de mock de `fetch` de `comFetchMockado`, adaptado):
1. **Download de áudio falha** (`audioResp.ok === false`) → `transcreverAudio` rejeita com mensagem contendo "Falha ao baixar audio".
2. **Whisper retorna erro** (download ok, mas a chamada de transcrição retorna `!resp.ok`) → rejeita com mensagem contendo "Whisper error".
3. **Caminho feliz** → retorna o texto transcrito (`(await resp.json()).text`), mock retornando `{ text: "texto de teste transcrito" }`.
4. **Se o plano 003 aplicou allowlist**: um teste adicional confirmando que uma URL fora do allowlist rejeita SEM nunca chamar `fetch` (verificável mockando `globalThis.fetch` para lançar erro se for chamado, e confirmando que a rejeição acontece antes disso).

### Passo 3: teste de `handler()` fim-a-fim (opcional, mas recomendado)

Um teste com `requestFake`-like helper mandando `midia_tipo: "audio"` e `midia_url` de um host permitido, mock de `fetch` estendido pra também responder a essas 2 chamadas, confirmando que `handler()` usa o texto transcrito como `textoFinal` (ex.: verificando que a chamada ao chat/completions recebeu esse texto no histórico/prompt, ou verificando o efeito observável mais próximo disponível no mock).

**Verify**: `deno test --no-check --allow-env --allow-read --allow-net .` → todos passam, incluindo os novos.

## Test plan
Coberto nos Passos 2-3 acima — não há uma seção separada porque este plano inteiro é sobre adicionar testes.

## Done criteria
- [ ] `transcreverAudio` exportada
- [ ] Pelo menos os 3 testes de unidade do Passo 2 (download falha, Whisper falha, caminho feliz) passam
- [ ] `deno test --no-check --allow-env --allow-read --allow-net .` → `0 failed`
- [ ] Nenhum arquivo fora do escopo modificado
- [ ] `plans/README.md` atualizado

## STOP conditions
- Se o plano 003 ainda não rodou (ou não há registro de qual caminho — 2a ou 2b — foi escolhido) — pare, não assuma, marque este plano como BLOCKED em vez de tentar adivinhar.
- Se o plano 003 escolheu 2a (remoção) — marque este plano como REJECTED em `plans/README.md` com o motivo ("código removido pelo plano 003, nada a testar") e não escreva nenhum teste novo.

## Maintenance notes
- Se no futuro esse caminho for reativado por outro motivo (novo canal, nova integração), estes testes já cobrem os 3 casos principais (falha de download, falha de transcrição, sucesso).
