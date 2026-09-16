# S-AE-CONF-02 — Fazer o sistema entender o clique no botão

**Status:** Ready for Review | **Prioridade:** P0 | **Esforço:** P | **Risco:** BAIXO
**Epic:** Confirmação de presença — Simulado Academia Enem 2026
**Objetivo único da epic:** mandar o convite, receber o sim/não, e devolver a planilha de respostas
para a Academia Enem. Nada além disso.
**Depende de:** nada. **Bloqueia:** tudo que vem depois. **Deploy:** redeploy do `cuca-worker`.

## O problema

Hoje o sistema **não sabe ler resposta de botão**. Verificado no código: ele entende texto, áudio,
imagem e documento. Botão cai no caso "não sei o que é isso" e vira texto vazio.

O que acontece na prática, sem esta story:

1. O jovem aperta "Sim, eu vou!"
2. O sistema grava a mensagem dele como **"[Mídia enviada]"** — a resposta se perde
3. Como não sabe interpretar, **ignora a mensagem em silêncio**
4. **O jovem não recebe nenhuma resposta**

Ou seja: 621 pessoas apertam o botão e ninguém é atendido, e não sobra registro de quem confirmou.
É pior do que se o template não tivesse botão.

## Acceptance Criteria

**AC1** — O sistema passa a entender resposta de botão nos dois formatos que a Meta usa.

**AC2** — O que o jovem apertou é gravado como **texto de verdade** — nunca mais "[Mídia enviada]".

**AC3** — A mensagem deixa de ser ignorada: o jovem recebe resposta normalmente.

**AC4** — Registrar no log o conteúdo completo do botão na primeira vez que chegar. Hoje nada disso
é registrado, e sem esse log não há como conferir o formato real.

**AC5** — Se o texto do botão vier diferente do esperado, **registrar no log** em vez de descartar.

**AC6** — Nenhum outro tipo de mensagem muda de comportamento.

## Teste obrigatório antes do envio em massa

Com esta story **já no ar**, enviar para **1 ou 2 números** e apertar os dois botões, conferindo:
a resposta chega, é gravada com o conteúdo certo, e o jovem recebe retorno.

A ordem importa: **primeiro esta story, depois o teste, depois os 621**. Antes dela o clique não
deixa rastro nenhum, então o teste não mostraria nada.

---

## Dev Agent Record

**Agent Model Used:** claude-opus-5
**Branch:** `feat/s-ae-conf-02-ler-clique-botao` (criada de `main` @ `f5174ca`)

### O que foi feito

Dois ramos novos em `_parse_mensagem_meta`, um para cada formato de botão da Meta:

| `type` do webhook | Campo lido | Fallback | Retorno |
|---|---|---|---|
| `button` (quick reply de template) | `button.text` | `button.payload` | `(texto, None, "text")` |
| `interactive` (botão/lista fora de template) | `interactive.<subtipo>.title` | `.id` | `(texto, None, "text")` |

O ponto central: os dois retornam **`midia_tipo="text"`**. `"text"` já está em
`_MIDIA_TIPOS_COM_INTERPRETACAO`, então o guard de `_executar_dispatch` deixa passar e o
motor-agente é chamado normalmente — sem precisar mexer no guard nem abrir exceção para ele.
O rótulo do botão É a mensagem do lead; não existe caminho especial rio abaixo.

O subtipo do `interactive` nomeia o próprio campo que carrega a resposta
(`"button_reply"` → `interactive["button_reply"]`), então a resolução por indireção cobre
`button_reply` e `list_reply` sem um ramo para cada.

### Cobertura dos AC

| AC | Como foi atendido |
|---|---|
| AC1 | Ramos `button` e `interactive` no parser |
| AC2 | Texto real retornado → gravado em `mensagens` no lugar de `[Mídia enviada]` |
| AC3 | `midia_tipo="text"` passa pelo guard → dispatch acontece → lead recebe resposta |
| AC4 | `_logar_payload_botao_primeira_vez` loga o payload cru, uma vez por formato por processo |
| AC5 | Payload sem texto aproveitável vira `logger.warning` com o conteúdo, não descarte calado |
| AC6 | Nenhum ramo existente tocado; `_MIDIA_TIPOS_COM_INTERPRETACAO` inalterada |

Sobre o AC4: escolhi **uma vez por formato, por processo** em vez de todo clique. Com 621
disparos, logar cada um encheria o log sem acrescentar nada — o objetivo era conhecer o formato
real, e a primeira ocorrência já entrega isso. O texto já resolvido continua logado em toda
mensagem (linha curta), então não se perde rastreabilidade de quem apertou o quê.

Sobre o AC5: quando o payload vem genuinamente vazio, o retorno preserva o `midia_tipo` cru
(`"button"`/`"interactive"`). Isso faz a mensagem cair no guard e não ser despachada — de
propósito: mandar string vazia ao motor-agente devolveria `400 "Nenhuma mensagem"`. A diferença
em relação a antes é que agora fica um `warning` com o payload, em vez de silêncio.

### Análise de Impacto (`impact-analysis-mandatory.md`)

**1. `_parse_mensagem_meta` — ramos novos.** Toca: só os `type` `button`/`interactive`, que
antes caíam no `else`. Consome esse retorno hoje: `build_contrato_v2` e `processar_webhook_meta`
(gravação em `mensagens`) e `_executar_dispatch` (guard). Impacto observável: clique de botão
passa a ser atendido. Nenhum outro `type` muda de caminho — o `else` continua idêntico.

**2. Guard `_MIDIA_TIPOS_COM_INTERPRETACAO`.** Toca: **nada** — a constante não foi alterada.
Só o comentário acima dela, que listava `button, interactive` como exemplos de tipos que caem no
`else`, foi corrigido (ficou mentindo depois desta mudança). Risco de a mudança "vazar" para
outros agentes: nulo, porque o guard não mudou.

**3. Caminho Academia Enem isolado (`_processar_webhook_academia_enem`).** Recebe `mensagem`/
`midia_tipo` do mesmo parser, então também passa a entender botão. Isso é consequência desejada
e inofensiva — aquele módulo está pausado, e o comportamento novo é estritamente melhor.

**4. Teste parametrizado existente** (`test_parse_mensagem_tipo_sem_interpretacao`) cobre
`sticker`/`video`/`location`/`contacts` — nenhum deles na mudança. Continua passando sem edição,
que é exatamente o sinal de que o `else` não regrediu.

### Validações executadas

- `pytest tests/test_meta_adapter_inbound.py` → **91 passed** (84 antes + 7 novos)
- `pytest` (suíte worker, exceto 2 módulos que não coletam por falta do pacote `openai` no
  ambiente local) → **689 passed, 5 failed**
- As 5 falhas são **pré-existentes** e todas em `test_meta_adapter_outbound.py` — confirmado
  rodando o mesmo arquivo com as minhas duas alterações guardadas em stash: **as mesmas 5
  falham**. 3 são `ModuleNotFoundError: No module named 'worker'` (import por pacote, questão de
  ambiente) e 2 são de transbordo/loop proativo, ambas em outbound, que esta story não toca.

### Teste com números reais — ainda pendente

A story exige, antes dos 621: disparar para 1-2 números, apertar os dois botões e conferir que a
resposta chega gravada com o conteúdo certo e que o jovem recebe retorno. Isso **depende do
redeploy do `cuca-worker`**, que vem depois do merge. Não executei nada em produção.

### File List

| Arquivo | Ação |
|---|---|
| `worker/meta_adapter_inbound.py` | modificado — 2 ramos no parser, helper de log, docstring e comentário do guard |
| `worker/tests/test_meta_adapter_inbound.py` | modificado — classe `TestParseRespostaBotao` (7 testes) |

### Change Log

| Data | Versão | Descrição | Autor |
|---|---|---|---|
| 2026-09-16 | 0.1 | Draft inicial | @sm (River) |
| 2026-09-16 | 1.0 | Implementação dos AC1-AC6 + 7 testes; status → Ready for Review | @dev (Dex) |
