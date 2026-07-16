# Plan 004: Aplicar `evitarRepeticaoLiteral` na resposta de ambiguidade de unidade

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

`evitarRepeticaoLiteral` (`index.ts:809-815`) existe especificamente para evitar que o bot mande a **mesma frase literal** duas vezes seguidas — o comentário acima da função (linhas ~805-807) descreve isso como parte do trabalho de "soar menos como robô" (TOM-05). Ela é aplicada em 3 dos 4 lugares onde uma resposta enlatada (não gerada por LLM) é enviada: `index.ts:1074`, `1120`, `1148`. O 4º lugar — a mensagem de confirmação de ambiguidade de unidade (`index.ts:1044-1046`, "Só pra confirmar: você quer saber sobre outra unidade CUCA?...") — grava e retorna a resposta direto, sem passar pelo wrapper.

Esse branch (ambiguidade real: o lead mudou de assunto mas não ficou claro pra qual unidade) é justamente um cenário onde repetição é plausível: se o lead responder de forma ambígua de novo, ele recebe **a mesma frase idêntica** pela segunda vez seguida — exatamente o padrão que TOM-05 foi criado para eliminar nos outros 3 pontos.

**Descoberta adicional relevante**: ao procurar um teste existente para usar como exemplar, não encontrei **nenhum teste, em nenhum dos dois arquivos de teste, que cubra `evitarRepeticaoLiteral` em nenhum dos 3 call sites já existentes** (`grep -rn "evitarRepeticaoLiteral\|De novo, foi mal" index.test.ts index.audit.test.ts` não retorna nada). Ou seja, esse mecanismo inteiro está sem cobertura de teste hoje — não é um problema deste plano corrigir isso nos outros 3 pontos (fora de escopo), mas o teste que este plano escreve para o 4º ponto vai ser, na prática, o primeiro teste automatizado do mecanismo como um todo. Vale o Valmir saber disso.

## Estado atual

- `index.ts:809-815` (a função, sem mudança):
  ```ts
  export function evitarRepeticaoLiteral(respostaCandidata: string, historico: { role: string; content: string }[]): string {
    const ultimaDoAgente = [...historico].reverse().find((m) => m.role === "assistant");
    if (ultimaDoAgente && ultimaDoAgente.content === respostaCandidata) {
      return "De novo, foi mal! 😅\n\n" + respostaCandidata;
    }
    return respostaCandidata;
  }
  ```
- `index.ts:1037-1046` (o branch com o bug):
  ```ts
  } else if (avaliacaoTroca.mudou_de_assunto && !avaliacaoTroca.pergunta_geral && !avaliacaoTroca.quer_sair) {
    // Ambiguidade real: ...
    const respostaAmbiguidade = "Só pra confirmar: você quer saber sobre outra unidade CUCA? Me diz qual! 😊\n\n" + MENU_UNIDADES;
    await salvarMensagemAgente(supabase, conversa.id, lead.id, respostaAmbiguidade);
    return new Response(JSON.stringify({ success: true, resposta: respostaAmbiguidade, handover: false }), { headers: { "Content-Type": "application/json" } });
  }
  ```
- Exemplo do padrão correto (linha 1074), usado nos outros 3 pontos:
  ```ts
  const respostaFinal = evitarRepeticaoLiteral(decisao.resposta, historico);
  ```
  (seguido de `salvarMensagemAgente(..., respostaFinal)` e retorno usando `respostaFinal`, não a variável original).
- `historico` já está disponível neste ponto do handler (carregado na linha 965, antes do bloco de resolução de unidade).

## Comandos que você vai precisar

| Propósito | Comando | Esperado no sucesso |
|---|---|---|
| Testes | `deno test --no-check --allow-env --allow-read --allow-net .` (pasta `supabase/functions/motor-agente`) | todos passam, incluindo os novos |
| Typecheck | `deno check index.ts` | não piora em relação à baseline |

## Escopo

**No escopo:**
- `supabase/functions/motor-agente/index.ts` — só o bloco `index.ts:1044-1046`
- `supabase/functions/motor-agente/index.audit.test.ts` — testes novos

**Fora do escopo:**
- Os outros 3 call sites de `evitarRepeticaoLiteral` (linhas 1074, 1120, 1148) — já corretos, não mexer.
- Adicionar cobertura de teste retroativa para os outros 3 call sites — mencionado acima como observação, não é obrigação deste plano (se quiser fazer, trate como plano separado).
- Qualquer mudança na lógica de detecção de ambiguidade (`avaliacaoTroca.mudou_de_assunto`, etc.) — este plano só toca o que acontece DEPOIS de já ter decidido que é ambiguidade.

## Fluxo git

- Branch: `advisor/004-bug01-ambiguidade-repeticao`
- Commit único (fix + teste), mensagem no padrão do repo
- **Não** faça push nem abra PR a menos que instruído.

## Passos

### Passo 1: Aplicar o wrapper

Troque:
```ts
const respostaAmbiguidade = "Só pra confirmar: você quer saber sobre outra unidade CUCA? Me diz qual! 😊\n\n" + MENU_UNIDADES;
await salvarMensagemAgente(supabase, conversa.id, lead.id, respostaAmbiguidade);
return new Response(JSON.stringify({ success: true, resposta: respostaAmbiguidade, handover: false }), { headers: { "Content-Type": "application/json" } });
```
por:
```ts
const respostaAmbiguidade = evitarRepeticaoLiteral("Só pra confirmar: você quer saber sobre outra unidade CUCA? Me diz qual! 😊\n\n" + MENU_UNIDADES, historico);
await salvarMensagemAgente(supabase, conversa.id, lead.id, respostaAmbiguidade);
return new Response(JSON.stringify({ success: true, resposta: respostaAmbiguidade, handover: false }), { headers: { "Content-Type": "application/json" } });
```
(Note que aqui, diferente do padrão dos outros 3 pontos, dá pra aplicar o wrapper direto na declaração da constante em vez de criar uma variável `respostaFinal` separada — mantém o nome `respostaAmbiguidade` usado nas duas linhas seguintes sem precisar renomear nada. Isso é uma escolha de estilo local, não uma divergência do padrão — o efeito é idêntico.)

**Verify**: `grep -n "respostaAmbiguidade = evitarRepeticaoLiteral" index.ts` retorna a linha nova.

## Test plan

Adicione em `index.audit.test.ts`, seguindo o padrão de `respostasBaseHandler`/`criarSupabaseMock`/`comFetchMockado`/`requestFake` já definidos no topo do arquivo:

1. **Repetição detectada**: monte o mock de `"mensagens"` (histórico) para que a última mensagem do agente (`remetente` != `"lead"`) seja **exatamente** o texto "Só pra confirmar: você quer saber sobre outra unidade CUCA? Me diz qual! 😊\n\n" + `MENU_UNIDADES` (importe `MENU_UNIDADES` do `index.ts`, já é exportado). Configure o mock/stub de forma que o branch de ambiguidade seja atingido (`avaliacaoTroca.mudou_de_assunto=true`, `pergunta_geral=false`, `quer_sair=false` — veja como os testes AUD-01/VAL-13 existentes no mesmo arquivo simulam a resposta do GPT para cair nesse branch, e siga o mesmo padrão de `comFetchMockado` com uma `respostaChatCompletions` que produza esse JSON de avaliação). Assert: a resposta retornada começa com `"De novo, foi mal! 😅"`.
2. **Sem repetição (não deve regredir)**: mesmo setup, mas o histórico não tem a mensagem idêntica como última do agente. Assert: a resposta é exatamente o texto original, sem o prefixo "De novo, foi mal".

Se montar o cenário completo do branch de ambiguidade via `handler()` for muito complexo de reproduzir isoladamente (múltiplas condições precisam bater ao mesmo tempo), uma alternativa aceitável é testar `evitarRepeticaoLiteral` diretamente com o texto exato da mensagem de ambiguidade como entrada (teste de unidade puro, sem precisar do `handler()` inteiro) — isso já prova que o texto correto foi passado para a função. Prefira o teste de `handler()` fim-a-fim se conseguir montá-lo sem muito esforço; caso contrário, o teste de unidade é uma verificação válida e mais simples.

**Verify**: `deno test --no-check --allow-env --allow-read --allow-net .` → todos passam, incluindo os novos.

## Done criteria

Machine-checkable. TODAS precisam valer:

- [ ] `deno test --no-check --allow-env --allow-read --allow-net .` → `0 failed`, incluindo os testes novos
- [ ] O teste de "repetição detectada" falha se você reverter o Passo 1 (confirme rodando antes/depois do fix)
- [ ] `deno check index.ts` não piora em relação à baseline
- [ ] Nenhum arquivo fora do escopo modificado (`git status`)
- [ ] `plans/README.md` linha de status atualizada

## STOP conditions

Pare e reporte se:

- O código em `index.ts:1037-1046` não bater com o trecho em "Estado atual".
- Montar o cenário completo do branch de ambiguidade via `handler()` exigir mockar mais de ~3 condições simultâneas de forma frágil — nesse caso, use o teste de unidade direto em `evitarRepeticaoLiteral` (descrito acima) em vez de insistir no teste fim-a-fim, e reporte a dificuldade.

## Maintenance notes

- Se o texto da mensagem de ambiguidade (`"Só pra confirmar..."`) mudar no futuro, nada quebra — `evitarRepeticaoLiteral` compara com o que estiver no histórico, não com um texto fixo.
- Vale o Valmir considerar, como follow-up separado (fora deste plano): adicionar cobertura de teste para os outros 3 call sites de `evitarRepeticaoLiteral` já existentes, já que hoje nenhum tem teste direto.
- O que um revisor deve escrutinar: que o retorno da função (`respostaAmbiguidade` pós-wrapper) é o que é salvo E o que é retornado na resposta HTTP — as duas linhas seguintes precisam usar a variável já processada, não a original.
