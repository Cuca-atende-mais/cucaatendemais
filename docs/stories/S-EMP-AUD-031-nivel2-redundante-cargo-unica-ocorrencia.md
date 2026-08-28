# S-EMP-AUD-031 — Nível 2 redundante trava o lead quando o cargo tem só 1 ocorrência

**Status:** InReview
**Epic:** Auditoria Empregabilidade
**Origem:** demanda direta do Junior, 2026-08-28 — achado a partir de análise de print de conversa
real, aprofundado com investigação de logs de produção
**Prioridade:** P0 (URGENTE) | **Esforço:** M | **Risco:** MÉDIO — toca fluxo de alto tráfego
(listagem de vagas), mas mudança contida em 2 funções + 1 handler, sem schema novo

> **Nota de processo:** story criada e implementada com o Junior engajando o @dev diretamente
> (fluxo comprimido, dado a urgência — achado + investigação + plano + aprovação aconteceram na
> mesma conversa, sem passar por @sm/@po antes da implementação). Registrada aqui pra manter
> rastreabilidade, como toda mudança do projeto.

## Contexto

O Junior percebeu, num print de conversa real, que o fluxo "Vaga Direta" (S-EMP-AUD-023, Nível 1 =
lista de cargos consolidados, Nível 2 = lista de ocorrências dentro do cargo escolhido) mostrava um
2º menu redundante quando o cargo escolhido só tinha 1 empresa/vaga por trás — o lead já tinha
escolhido corretamente no Nível 1 (ex.: "9"), e o Nível 2 pedia pra escolher de novo, mas com
numeração reiniciada em "1". O lead, sem perceber a troca de numeração, reusava o número do Nível 1
(que não existe mais nessa escala) e o fluxo travava, terminando em oferta de atendente humano.

## Investigação (produção, últimos 30 dias)

- 66 vezes o Nível 2 apareceu.
- **40 dessas 66 (60%) eram cargo com 1 única ocorrência** — pergunta sem propósito real.
- Dessas 40, **11 (27,5%) geraram confusão visível** (bot respondeu "Não entendi" ou ofereceu
  atendente humano logo em seguida).
- Confirmado 1:1 contra a transcrição real do print do Junior (mesma conversa, mesmo timestamp):
  lead escolhe "9" → Nível 2 pede escolher "1" → lead digita texto livre → "Não entendi" → lead
  repete "9" (o que já tinha funcionado) → bot oferece atendente, sem conseguir ajudar.
- Respostas de lead capturadas nesse ponto confirmam a causa: `"8, 10"`, `"9."`, `"4,9"`, `"3,10"`
  — números do Nível 1 (não existentes na escala do Nível 2) reaparecendo como resposta.

## Decisão de design (Junior, 2026-08-28)

Em vez de simplesmente pular o Nível 2 (1ª proposta do @dev), o Junior identificou a causa mais
precisa: o que o Nível 2 mostra de novo (empresa + unidade CUCA) que o Nível 1 não mostra. Solução:
**levar essa informação pro Nível 1** quando o cargo só tem 1 ocorrência — aí não sobra nada a
esclarecer num 2º passo.

## O que foi implementado

1. **`_mostrar_cargos_consolidados` (Nível 1):** quando um cargo tem só 1 ocorrência, a linha passa
   a incluir empresa e unidade direto (`*9.* JOVEM APRENDIZ (AREZZO&CO) - DOM LUIS — 5 vagas — MEIA
   SOLA ACESSORIOS DE MODA LTDA — CUCA Jangurussu`). Cargos com 2+ ocorrências continuam com a linha
   resumida — o Nível 2 continua necessário só pra esses.
2. **Handler `listou_cargos_consolidados`:** ao processar a escolha do lead, cargos com 1 ocorrência
   são roteados direto (reaproveitando `_rotear_ocorrencia_escolhida`, mesma função já usada pela
   fila automática do Nível 2) — sem mostrar Nível 2. Cargos com 2+ ocorrências continuam mostrando
   Nível 2, **só pra esses** (não repete os já resolvidos).
3. **Caso misto** (lead escolhe vários cargos de uma vez, alguns com 1 ocorrência e outros com 2+):
   os de 1 ocorrência ficam guardados em `ocorrencias_auto_pendentes` no fluxo e entram
   automaticamente na fila assim que o lead responde o Nível 2 (que aparece só pros cargos que
   realmente precisam) — sem exigir escolha adicional do lead pra eles.

## Acceptance Criteria

1. Cargo escolhido com 1 única ocorrência → nunca mostra Nível 2, vai direto pro próximo passo do
   fluxo (unidade/nome/link).
2. Cargo escolhido com 2+ ocorrências → Nível 2 continua aparecendo, comportamento inalterado.
3. Múltiplos cargos escolhidos juntos, todos com 1 ocorrência → nenhum Nível 2, todos roteados via
   fila automática (1º direto, resto em fila).
4. Múltiplos cargos escolhidos juntos, mistura de 1 e 2+ ocorrências → Nível 2 aparece só pros que
   precisam; os de 1 ocorrência entram na fila automaticamente depois que o Nível 2 é respondido.
5. Nível 1 (`_mostrar_cargos_consolidados`) mostra empresa + unidade na linha quando o cargo tem só
   1 ocorrência.

## Escopo

**In:** os 5 ACs acima, restritos a `worker/empregabilidade_engine.py` (funções
`_mostrar_cargos_consolidados`, handler `listou_cargos_consolidados`, handler
`listou_ocorrencias_cargo` — esse último só ganhou a leitura de `ocorrencias_auto_pendentes`).
**Out:** renumerar o Nível 2 pra bater com o Nível 1 quando ele ainda aparece (decisão da
S-EMP-AUD-023 de numeração corrida própria do Nível 2 continua valendo); mexer no fluxo
`listando_cargos_selecao` (SQS-49, escolha de cargo dentro de 1 seleção já aberta — usa
`_confirmar_cargos_selecao_evento` mas não passa pelo Nível 1/2 consolidado, não afetado).

## ⚠️ Análise de impacto — por item

### Item 1 — `_mostrar_cargos_consolidados` mostra mais informação por linha

- **Toca:** só a renderização da mensagem do Nível 1 — nenhuma mudança de dado, `empresa_nome`/
  `rotulo_tipo` já existiam em `grupo["ocorrencias"]`.
- **Consome hoje:** único consumidor é o próprio fluxo de WhatsApp — sem API externa dependendo do
  formato exato da mensagem.
- **Impacto observável:** mensagens de cargo com 1 ocorrência ficam mais longas (1 linha extra de
  texto); cargos com 2+ ocorrências não mudam.
- **De-risk:** teste automatizado novo cobre a renderização (`test_escolha_nivel1_unico_cargo_pula_
  nivel2` verifica indiretamente via fluxo completo; a asserção de texto renderizado já existia nos
  testes anteriores e foi preservada onde aplicável).

### Item 2 — Handler pula Nível 2 quando não há mais nada a esclarecer

- **Toca:** `listou_cargos_consolidados` — decide entre rotear direto ou mostrar Nível 2, com base
  em `len(ocorrencias) == 1` por cargo escolhido.
- **Consome hoje:** reaproveita `_rotear_ocorrencia_escolhida`, já usada pela fila automática do
  Nível 2 (regra 5, S-EMP-AUD-023) — mesma função, mesmo comportamento por tipo de vaga
  (`selecao_evento` vs `vaga_normal`), sem lógica nova de roteamento.
- **Impacto observável:** lead com cargo de 1 ocorrência avança 1 mensagem mais rápido, sem chance
  de reusar número errado. Lead com cargo de 2+ ocorrências não percebe diferença.
- **De-risk:** 4 testes novos + 1 teste existente ajustado (a numeração contínua entre blocos só
  faz sentido testar com cargos que genuinamente precisam de Nível 2 — ajustado pra isso, não
  removido). Suíte completa (`test_empregabilidade_engine.py` + `test_meta_adapter_inbound.py`,
  256 testes) rodada sem falhas novas.

### Item 3 — Fila `ocorrencias_auto_pendentes` no caso misto

- **Toca:** novo campo no fluxo (`ocorrencias_auto_pendentes`), lido pelo handler
  `listou_ocorrencias_cargo` e concatenado ao `fila_restante` já existente.
- **Consome hoje:** campo novo, não colide com nenhum campo de fluxo já usado (conferido por leitura
  de código — grep por `ocorrencias_auto_pendentes` antes de nomear).
- **Impacto observável:** só no caso misto (raro, segundo os dados de produção — a maioria das
  respostas confusas era escolha de 1 cargo só). Lead não precisa escolher de novo os cargos já
  resolvidos.
- **De-risk:** teste dedicado (`test_escolha_nivel1_mistura_unico_e_multiplo_mostra_nivel2_so_pro_
  que_precisa`) cobre o caminho completo: Nível 1 misto → Nível 2 só pro que precisa → resposta do
  lead → fila automática inclui o auto-resolvido.

## Test plan

- Cargo único, 1 ocorrência → pula Nível 2, vai direto pro próximo passo.
- Cargo único, 2+ ocorrências → Nível 2 continua aparecendo, numeração inalterada.
- Múltiplos cargos, todos com 1 ocorrência → todos roteados via fila, sem Nível 2.
- Múltiplos cargos, mistura → Nível 2 só pros que precisam; os de 1 ocorrência entram na fila depois.
- Regressão: suíte completa do worker (exceto 2 arquivos com erro de ambiente pré-existente, sem
  relação com esta mudança — `ModuleNotFoundError: openai`, confirmado também sem as mudanças desta
  story via `git stash`).

## File List

- `worker/empregabilidade_engine.py` (`_mostrar_cargos_consolidados`, handler
  `listou_cargos_consolidados`, handler `listou_ocorrencias_cargo`)
- `worker/tests/test_empregabilidade_engine.py` (1 teste ajustado, 4 testes novos)

## Change Log

- v0.1 (2026-08-28): Junior identifica a redundância a partir de print de conversa real. @dev
  investiga logs de produção (30 dias): 60% dos Níveis 2 mostrados eram cargo de 1 ocorrência,
  27,5% desses geravam confusão visível. Transcrição completa da conversa do print confirma a causa
  1:1. @dev propõe plano (pular Nível 2 quando resolve pra 1 ocorrência), Junior refina a solução
  (levar empresa/unidade pro Nível 1 em vez de só pular) e aprova. @dev implementa: Nível 1
  enriquecido pra cargo de 1 ocorrência, handler roteia direto nesse caso, caso misto tratado via
  fila `ocorrencias_auto_pendentes`. 4 testes novos + 1 ajustado, suíte completa sem falhas novas
  (256 testes). Status Draft → InReview (aguardando @qa).
- v0.2 (2026-08-28): @qa revisou — **CONCERNS** (aprovado, com 1 recomendação não-bloqueante). Ver
  "QA Results" abaixo.

## QA Results

### Review em 2026-08-28 — @qa Quinn

**Gate: CONCERNS** (aprovado — nenhum achado bloqueia, mas 1 ponto deveria ser considerado)

**7 checks:**

1. **Code review** — mudança bem contida (2 funções + 1 handler), comentários explicam a decisão e
   citam os números da investigação. Reaproveita `_rotear_ocorrencia_escolhida` sem duplicar lógica
   de roteamento por tipo de vaga. OK.
2. **Testes — achado MEDIUM, não-bloqueante.** Nenhum dos testes (novos ou existentes) faz uma
   asserção direta sobre o **texto renderizado** do Nível 1 enriquecido (AC5 — "mostra empresa +
   unidade na linha quando o cargo tem só 1 ocorrência"). Os 4 testes novos partem já da etapa
   `listou_cargos_consolidados` com `mapa_cargos_consolidados` pré-montado — testam a *decisão* do
   handler (pular ou não o Nível 2), não a *renderização* do Nível 1 em si. O único teste que
   renderiza o Nível 1 com cargo de 1 ocorrência (`test_entrada_fresca_mostra_nivel1_cargo_
   consolidado`, pré-existente) não foi atualizado pra checar o texto novo. Rodei manualmente
   `_mostrar_cargos_consolidados` com um cargo de 1 ocorrência e um de 2 — confirmei que a linha
   enriquecida sai correta (`*1.* JOVEM APRENDIZ (AREZZO&CO) - DOM LUIS — 5 vagas — MEIA SOLA
   ACESSORIOS DE MODA LTDA — Vaga individual — CUCA Jangurussu`, e a linha de 2 ocorrências continua
   resumida) — a implementação está certa, só falta a asserção automatizada que pegaria uma
   regressão futura nessa linha específica. Recomendo adicionar 1 assert em
   `test_entrada_fresca_mostra_nivel1_cargo_consolidado` (`"SINGULAR" in texto_enviado`) antes do
   push, é barato.
3. **Acceptance Criteria** — AC1-4 verificados por leitura de código + testes, atendidos. AC5
   verificado manualmente (ver achado 2) — comportamento correto, só falta o teste automatizado.
4. **Regressão** — rodei a suíte de novo, de forma independente: `test_empregabilidade_engine.py` +
   `test_meta_adapter_inbound.py`, 256 testes, zero falhas. Tracing manual do fluxo de dados
   confirma que `_rotear_ocorrencia_escolhida` (não tocada nesta mudança) se comporta de forma
   idêntica sendo chamada mais cedo (direto do Nível 1) ou como antes (depois do Nível 2) — a
   sanitização de fluxo (`_fluxo_sem_falhas_atendente`) acontece dentro dela mesma nos dois casos
   onde já acontecia antes, sem gap novo. Conferido que `ocorrencias_auto_pendentes` não colide com
   nenhum campo de fluxo já em uso (grep no arquivo).
5. **Performance** — sem impacto; é reorganização de um fluxo síncrono já rápido, sem chamada nova
   a banco ou API externa.
6. **Segurança** — sem superfície nova; dado que passa a aparecer no Nível 1 (empresa/unidade) já
   era público (aparecia no Nível 2 hoje), só mudou de tela.
7. **Documentação** — story completa com investigação, decisão de design, impacto por item, File
   List e Change Log. Nota de processo sobre o fluxo comprimido (sem @sm/@po) registrada com
   transparência. OK.

**Resumo:** aprovado para seguir. O achado de teste (item 2) é uma recomendação de qualidade sobre
uma parte já verificada manualmente como correta — fica a critério do @dev/Junior adicionar antes
ou depois do push.
