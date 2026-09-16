# S-AE-CONF-02 — Fazer o sistema entender o clique no botão

**Status:** InReview (QA: CONCERNS — aprovado) | **Prioridade:** P0 | **Esforço:** P | **Risco:** BAIXO
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

---

## QA Results

**Revisor:** @qa (Quinn) · **Data:** 2026-09-16 · **Veredito: CONCERNS** — aprovado para seguir,
com duas observações registradas. Nenhuma exige volta ao @dev.

### 7 Quality Checks

| # | Check | Resultado |
|---|---|---|
| 1 | Code review | ✅ Ramos isolados, `else` intacto, guard não alterado |
| 2 | Testes | ✅ 91 passed no inbound; rodei por conta própria |
| 3 | Acceptance Criteria | ✅ AC1-AC6 atendidos (ressalva no AC5, abaixo) |
| 4 | Regressão | ✅ Nenhum `type` existente muda de caminho |
| 5 | Performance | ✅ Parsing puro, sem I/O; log cru limitado a 1x por formato |
| 6 | Segurança / LGPD | ✅ Verificado contra os rótulos reais — ver achado 2 |
| 7 | Documentação | ✅ Comentário do guard corrigido junto (estava mentindo) |

### Achado 1 — O problema era pior do que a story descrevia (MÉDIO, já resolvido pelo fix)

A story dizia que o clique era gravado como `"[Mídia enviada]"`. **Não era.** Conferi a constraint
em produção (banco `cuca`, read-only):

```
mensagens_tipo_check  CHECK (tipo IN ('text','image','audio','video','document','location'))
```

`"button"` e `"interactive"` **não estão na lista**. Antes desta story o insert em `mensagens`
violava a constraint, caía no `except` e virava `logger.critical [DATA-LOSS]` — o clique não era
gravado **de forma nenhuma**, nem como texto genérico. Ou seja: além de ninguém ser atendido, não
sobrava nem o registro parcial que a story supunha existir.

O fix resolve isso pelo caminho certo e sem querer: ao devolver `midia_tipo="text"`, o insert
passa a respeitar a constraint. **Não é preciso mudar nada** — registro aqui porque a decisão de
mapear para `"text"` tinha uma segunda justificativa que ninguém tinha visto, e porque a
descrição do problema na story fica corrigida para quem ler depois.

### Achado 2 — Os rótulos reais não disparam opt-out (verificado, sem ação)

Este era o risco de regressão mais sério: com o botão virando texto normal, ele passa a atravessar
`_eh_pedido_opt_out` (linha 1214). Um rótulo que casasse com um dos 7 padrões marcaria
`opt_in=false` no lead — que é filtrado nos 3 pontos de disparo do `campanhas_engine`. O jovem
confirmaria presença e sairia das campanhas futuras em silêncio.

Rótulos reais, lidos de `meta_templates.observacoes` do `ae_simulado_v2` em produção:
**"Sim, eu vou!"** e **"Nao poderei comparecer"**. Conferi os dois contra os 7 padrões de
`_PADROES_OPT_OUT` — **nenhum casa**. Caminho limpo.

⚠️ **Isso não é uma garantia permanente.** Um template futuro com botão rotulado "Cancelar" ou
"Não quero mais receber" registraria opt-out de verdade. Vale como regra ao criar template novo
com botão, não como pendência desta story.

### Ressalva no AC5 (BAIXO, aceito)

Quando o payload de botão vem sem texto aproveitável, o retorno preserva `"button"`/`"interactive"`
— que, pelo achado 1, **também viola a constraint**. Nesse caminho a linha não é gravada.

Aceito como está: o AC5 pede registro em vez de descarte silencioso, e o caso gera **dois** logs
(o `warning` do @dev e o `critical [DATA-LOSS]`). A alternativa — devolver `"text"` para salvar a
linha — empurraria mensagem vazia ao motor-agente, que responderia `400`. É troca ruim por um
caso que só acontece com payload malformado da Meta.

### Observação de sequenciamento — para o Junior, não para o código

A ordem acordada é 01 → 02 → teste com 1-2 números → 04 → **envio dos 621** → 03 (porteiro).
Com a 02 sozinha, o clique chega e é atendido — mas quem responde é o agente Institucional normal,
com o que o RAG produzir para "Nao poderei comparecer". **Nada ainda garante resposta adequada
nem guarda a confirmação** — isso é a 03.

O teste obrigatório com 1-2 números vai mostrar exatamente o que o Institucional responde. Vale
olhar esse retorno antes de liberar os 621: se vier ruim, é decisão sua adiantar a 03.

### Fora de escopo, mas anotado para a 03

`meta_templates` **não tem coluna de botões** — os rótulos vivem em `observacoes`, como texto
livre. A 03 vai precisar casar a resposta do jovem contra os rótulos; hoje não existe fonte
estruturada para isso no banco.

### Banco de dados

Nenhuma mudança de schema nesta story. Validação feita read-only contra `cuca` (produção),
conforme `cuca-deploy-environments.md` §4.

### Deploy

Exige **redeploy do `cuca-worker`** após o merge. O teste com números reais só faz sentido depois.
