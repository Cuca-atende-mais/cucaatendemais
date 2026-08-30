# S-EMP-FSL-04 — Corte de idade na conversa → Banco de Talentos + data tolerante

**Status:** Ready for Review
**Epic:** Fluxo do candidato 100% no WhatsApp (sem link)
**Origem:** `PLANO-EXECUCAO-fluxo-sem-link.md` (FSL-04), sessão 2026-08-29. Cruza com o achado
S-EMP-AUD-026 (faixa etária), resolvendo-o na conversa.
**Prioridade:** P1 | **Esforço:** M | **Risco:** MÉDIO — regra de negócio (idade) que existe por
motivo real (conformidade); não pode simplesmente afrouxar.
**Depende de:** FSL-03 (a etapa de data de nascimento) e FSL-07 (destino Banco de Talentos).

## Contexto

No passo da data de nascimento (FSL-03), se a idade não bate com o que a vaga exige, o bot para com
jeito e oferece o Banco de Talentos na própria conversa — em vez do bloqueio seco que o formulário
faz hoje (`candidatura/page.tsx:191`, `candidaturas/route.ts:46`). Também trata a data digitada
torta.

**Duas peças:**
1. **Data tolerante:** se vier data quebrada ou só a idade ("tenho 17"), aceita como aproximada
   pra não travar, e pede a data exata depois como complemento não obrigatório.
2. **Corte de idade → banco de talentos:** compara a data com a exigência da vaga; não bateu →
   mensagem gentil + oferta de ir pro Banco de Talentos, reaproveitando o que já foi coletado.

## O que precisa ser implementado

### 1. Parser tolerante de data
- Aceita `DD/MM/AAAA` (e variações com `-`) → data exata.
- Aceita só idade em anos ("19", "tenho 19 anos") → calcula data aproximada (ex.: 1º de janeiro do
  ano correspondente) e marca `data_nascimento_aproximada: true`.
- Guardar essa marca pra, após a candidatura confirmada, pedir a data exata como complemento **não
  bloqueante** ("consegue confirmar sua data completa? não é obrigatório, ajuda a gente").

### 2. Corte de idade
- Após obter a idade (exata ou aproximada), comparar com a exigência da vaga — **a mesma regra que
  o formulário/portal já aplica** (não inventar critério novo; ver como `faixa_etaria` é
  interpretada hoje).
- Não bateu → mensagem gentil explicando ("essa vaga pede idade mínima X") + pergunta se quer ir
  pro Banco de Talentos.
  - **Sim** → segue pro fluxo do Banco de Talentos (FSL-07), reaproveitando nome/data/PCD já
    coletados. Não recoleta o que já tem.
  - **Não** → oferece ver outras vagas ou encerrar; a IA conduz conforme a resposta.

## Acceptance Criteria

1. Data digitada como `DD/MM/AAAA` → gravada exata.
2. Resposta só com idade ("tenho 17") → aceita, marcada como aproximada, fluxo não trava.
3. Após candidatura confirmada com data aproximada, o bot pede a data exata como complemento não
   obrigatório (o lead pode ignorar sem perder a candidatura).
4. Idade abaixo do exigido pela vaga → bot não bloqueia seco: explica e oferece Banco de Talentos.
5. "Sim, quero o banco" → vai pro FSL-07 reaproveitando dados; "não" → ver outras vagas/encerrar.
6. Comportamento gateado pelo botão (desligado = formulário/link como hoje).

## Escopo

**In:** parser tolerante de data, marca de aproximado + complemento posterior, corte de idade →
oferta de banco na conversa. **Out:** a decisão de dado por vaga do achado 026 (revisão vaga-a-vaga
de qual exige 18+) — esta story usa a regra de idade **como já está** no sistema; corrigir o dado
das vagas Jovem Aprendiz é trabalho separado (fora do fluxo sem link).

## ⚠️ Análise de impacto — por item

### Item 1 — Data tolerante
- **Toca:** etapa `coletando_data_nascimento` (FSL-03).
- **Impacto observável:** menos gente travada por digitar a data fora do padrão; dado pode ficar
  aproximado (menos preciso) até o complemento.
- **De-risk:** testes com data válida, data torta, só idade, texto sem número nenhum.

### Item 2 — Corte de idade
- **Toca:** a mesma etapa, após obter a idade. Reusa a interpretação de `faixa_etaria` existente.
- **Consome hoje:** a regra de idade já existe no formulário — reusar, não recriar, pra não
  divergir.
- **Impacto observável:** menor de idade não é mais barrado sem alternativa — vai pro banco.
  **Resolve na conversa o que o 026 resolveria no formulário.**
- **De-risk:** testar com data que passa e data que não passa; confirmar que a que passa segue o
  fluxo normal (não regride) e a que não passa oferece o banco.

## Test plan

- Automatizado: data exata / data torta / só idade / lixo → comportamento certo em cada.
- Automatizado: idade abaixo do exigido → oferta de banco; idade ok → segue candidatura.
- Automatizado: aproximado → complemento pedido depois, não bloqueante.
- Regressão: botão off → formulário aplica a regra como hoje.

## Done criteria

- [x] Parser tolerante (4 casos)
- [x] Aproximado marcado + complemento posterior não bloqueante *(o bot pede o complemento; não
  existe hoje uma rota de update pra persistir a resposta — implementar uma ficaria fora do que
  esta story descreve, ver Dev Agent Record)*
- [x] Corte de idade oferece banco em vez de bloquear
- [ ] Reaproveita dados ao ir pro banco *(diferido pra FSL-07 por decisão explícita do Junior —
  "segue com opção 1": a FSL-04 dependia da FSL-07, que ainda não existe; o "sim" hoje usa o fluxo
  de Banco de Talentos JÁ EXISTENTE — `iniciar_banco_talentos()` — que recoleta o nome. Quando a
  FSL-07 entrar, ela assume esse ramo e herda nome/data/PCD já coletados aqui, sem precisar tocar
  na FSL-04 de novo — mesmo padrão que a FSL-03 usou pro botão desligado.)*
- [x] Botão off → regra de hoje intacta *(por construção: as etapas novas só são alcançadas dentro
  do fluxo de coleta no chat, que só é aberto pelo dispatcher `_finalizar_candidatura_self` quando o
  flag já está ligado)*

## Dev Agent Record

### Decisões-chave

1. **Dependência da FSL-07 resolvida (opção 1, decisão explícita do Junior em 2026-08-29):** a
   story original previa "Sim, quero o banco" → FSL-07 (reaproveitando nome/data/PCD). Como a
   FSL-07 não existe ainda, o "sim" cai no fluxo de Banco de Talentos **já existente**
   (`iniciar_banco_talentos()`, hoje baseado em link, recoleta o nome) — não é uma amarra
   temporária pra religar depois, é reusar o que já está construído e funcionando (mesmo padrão do
   fallback pro link que a FSL-03 usou pro botão desligado). O núcleo real desta story — parser
   tolerante + corte de idade → oferta com jeito (achado S-EMP-AUD-026) — está 100% pronto e não
   depende de nada da FSL-07.
2. **Parser tolerante (`_data_nascimento_tolerante`)** — data exata (`DD/MM/AAAA`) tem prioridade.
   Se falhar e o texto tiver pontuação de data (`/`, `-`, `.`, ex.: "32/13/2020"), **não** cai pra
   idade solta — evita adivinhar errado a partir de fragmentos de uma data mal digitada; melhor
   seguir sem data (None) do que inventar uma idade a partir do dia/mês/ano de uma data inválida.
   Só interpreta como idade quando não há essa pontuação e o número está numa faixa plausível
   (5-99). A data aproximada usa 1º de janeiro do ano correspondente (convenção do plano) e é
   marcada com `data_nascimento_aproximada: true`.
3. **Corte de idade (`_vaga_exige_maioridade`)** — replica **a mesma regra que o portal já aplica**
   (`candidaturas/route.ts`): só a faixa `"Maior de 18 anos"` tem corte ativo no servidor hoje
   (`"A partir de 14 anos"` existe como opção no cadastro de vaga, mas não é reforçada em lugar
   nenhum do backend — confirmado por grep/leitura do route.ts e do modal de vaga). Fail-open em
   erro de consulta: o portal continua sendo o gate real aplicado no INSERT; esta checagem no chat
   é só antecipação de UX (oferecer o banco com jeito, em vez do lead levar um 400 seco).
4. **Nova etapa `oferta_banco_idade_fsl`** — sim → `iniciar_banco_talentos()` (existente); não →
   `pos_candidatura` (ver outras vagas/encerrar, reusando o handler já existente dessa etapa);
   ambíguo → repergunta. Entra nos 3 conjuntos de etapas (`_ETAPAS_PUBLICO`,
   `_ETAPAS_EXPIRAM_POR_INATIVIDADE`, `_ETAPAS_COLETA_CHAT_FSL`) — sem tratamento especial de
   inatividade, mesmo raciocínio das etapas da FSL-03.
5. **Complemento não-bloqueante (AC3)** — quando `data_nascimento_aproximada` é true, a mensagem de
   sucesso (`_emitir_sucesso_candidatura_vaga`, compartilhada com a FSL-03) ganha uma linha extra
   pedindo a data completa, deixando claro que é opcional. **Escopo desta story é só pedir:** não
   existe hoje uma rota de update pra persistir uma resposta posterior a essa pergunta — criar uma
   ficaria fora do que a story descreve tecnicamente (Artigo IV — No Invention). Se o Junior quiser
   a persistência de fato, é um ajuste pequeno e separado (endpoint PATCH + captura da próxima
   mensagem), não implementado aqui.

### File List

- `worker/empregabilidade_engine.py` — `_data_nascimento_tolerante`, `_idade_a_partir_de_iso`,
  `_vaga_exige_maioridade`; etapa `coletando_data_nascimento` ganhou o corte de idade; nova etapa
  `oferta_banco_idade_fsl`; complemento não-bloqueante em `_emitir_sucesso_candidatura_vaga`; 3
  novas entradas nos sets de etapas (`_ETAPAS_PUBLICO`, `_ETAPAS_EXPIRAM_POR_INATIVIDADE`,
  `_ETAPAS_COLETA_CHAT_FSL`)
- `worker/tests/test_empregabilidade_engine.py` — 21 testes novos (parser tolerante, cálculo de
  idade, checagem de faixa etária, corte de idade → oferta, etapa de oferta, complemento na
  mensagem de sucesso)

### Validação executada

- `pytest` engine + inbound + portal_client + academia_enem + intencao_detector → **404 passed**
  (21 novos, zero regressão).
- `py_compile` OK.

### Pendente pro @qa / validação guiada (não bloqueia o código)

- Mesma pendência da FSL-03: validação ao vivo ponta-a-ponta exige autorização do Junior
  (`qa-testes-sem-navegador-ao-vivo.md`).
- Quando a FSL-07 entrar, revisar se o "sim" desta story deve trocar de `iniciar_banco_talentos()`
  pra uma versão que herda os dados já coletados aqui (nome/data/PCD) — item já sinalizado no Done
  criteria acima, sem ambiguidade sobre o que falta.

## QA Results (@qa — Quinn)

**Veredito: PASS** (2026-08-29). Regra de negócio sensível (idade/conformidade) implementada com
fidelidade ao que já existe no portal, sem inventar critério novo.

### 7 quality checks

1. **Code review — PASS.** Rastreei os 3 helpers novos linha a linha:
   `_data_nascimento_tolerante` não deixa uma data mal digitada (`32/13/2020`) virar idade por
   acidente — a checagem de pontuação (`/`, `-`, `.`) antes de tentar o regex de idade solta é
   exatamente o tipo de cuidado que evita adivinhar errado; `_vaga_exige_maioridade` é fail-open
   (não bloqueia em erro de consulta, o portal segue sendo o gate real); `_idade_a_partir_de_iso`
   usa o mesmo idioma de comparação de tupla `(mês, dia)` que o `route.ts` usa em JS. A consulta ao
   banco só acontece quando `data_iso` já é truthy — sem I/O desperdiçado em texto que não parseia.
2. **Testes — PASS.** 21 testes novos, **404 passed** na suíte combinada, zero regressão. Cobrem os
   4 casos do parser (exata, idade solta, data torta, lixo), o cálculo de idade, os 2 valores reais
   de `faixa_etaria` (`"Maior de 18 anos"` / `"A partir de 14 anos"`) + falha de consulta, e os 3
   ramos da nova etapa (sim/não/ambíguo).
3. **Acceptance Criteria — 5/6 explícitos, 1 conscientemente diferido.** AC1 (data exata) ✓; AC2
   (idade solta aceita, não trava) ✓; AC3 (complemento não-bloqueante pedido) ✓ — nota abaixo sobre
   o alcance; AC4 (oferece banco em vez de bloquear seco) ✓ — mensagem "Entendo! 💙..." troca o 400
   raso do formulário por uma saída gentil; AC5 ("sim"/"não" com destino correto) ✓; AC6 (gateado
   pelo botão) ✓ **por construção**, as etapas novas só são alcançadas dentro do fluxo que a FSL-03
   já gateia. O item "reaproveita dados ao ir pro banco" do Done Criteria fica **conscientemente
   em aberto** — decisão já tomada por você (opção 1) antes desta implementação começar, não uma
   surpresa que o @dev esteja me entregando agora.
4. **Regressão — PASS.** Validei que a extração da faixa etária só dispara quando `data_iso` existe
   (sem custo extra em texto não-parseável) e que o `_emitir_sucesso_candidatura_vaga` compartilhado
   com a FSL-03 só manda a mensagem de complemento quando `data_nascimento_aproximada` é
   explicitamente `True` — segui o call site do fluxo do **formulário**
   (`aguardando_confirmacao_candidatura`, linha ~3287) e confirmei que o `fluxo_atual` de lá nunca
   carrega essa chave (linhagem de estado totalmente separada do fluxo no chat), então o formulário
   não pode ganhar essa mensagem por engano.
5. **Performance — PASS.** Uma consulta leve (`select faixa_etaria`) só quando há data parseada;
   nenhum novo I/O em loop.
6. **Segurança/LGPD — PASS.** Nenhuma rota nova; a regra de idade replicada é a mesma já pública no
   cadastro de vagas do portal (não é dado sensível novo sendo exposto).
7. **Docs — PASS.** Dev Agent Record explícito sobre a decisão da dependência da FSL-07 e sobre o
   escopo do complemento (só pedir, sem endpoint de persistência) — nenhuma das duas leituras exige
   uma pergunta minha, já vieram documentadas com o raciocínio.

### Observação (não bloqueia)

- O teste `test_numero_fora_da_faixa_plausivel_de_idade` (entrada `"200"`) não exercita de fato o
  filtro `5 <= idade <= 99` — o regex `\b(\d{1,2})\b` já não casa um número de 3 dígitos por causa
  do `\b` (boundary), então o resultado `(None, False)` vem do "não achei número", não do "achei
  idade fora da faixa". Funcionalmente correto (o resultado esperado bate), só o nome do teste
  promete uma cobertura que o regex torna estruturalmente inalcançável (nenhuma entrada de 1-2
  dígitos pode passar de 99). Não bloqueia — é só uma nota de precisão de teste, sem ação
  necessária.

## Change Log

- 2026-08-29 — @qa (Quinn): gate PASS (5/6 ACs explícitos + 1 conscientemente diferido por decisão
  prévia do Junior, 21+404 testes, isolamento do complemento não-bloqueante confirmado contra o
  fluxo do formulário). 1 observação não-bloqueante sobre precisão de nome de teste.
- 2026-08-29 — @dev (Dex): FSL-04 — parser tolerante de data + corte de idade → oferta de Banco de
  Talentos na conversa (resolve S-EMP-AUD-026 no chat). Dependência da FSL-07 resolvida via opção 1
  (decisão do Junior): "sim" usa o fluxo de banco de talentos já existente. 21 testes novos, 404
  no total, zero regressão. Ready → Ready for Review.

## STOP conditions

- A interpretação de `faixa_etaria` no sistema for ambígua/inconsistente entre vagas → levantar
  com o Junior (é o próprio nó do achado 026) antes de fixar a comparação.
