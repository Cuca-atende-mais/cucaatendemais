# S-EMP-FSL-07 — Banco de Talentos no chat (áreas de interesse)

**Status:** Ready for Review
**Epic:** Fluxo do candidato 100% no WhatsApp (sem link)
**Origem:** `PLANO-EXECUCAO-fluxo-sem-link.md` (FSL-07), sessão 2026-08-29.
**Prioridade:** P1 | **Esforço:** M | **Risco:** MÉDIO — destino paralelo à candidatura, mesma
fundação.
**Depende de:** FSL-01 (canal/portal), FSL-03 (sequência de coleta).

## Contexto

O Banco de Talentos é o destino quando não há vaga específica (ou quando o corte de idade da
FSL-04 manda pra cá). Mesma sequência de coleta da FSL-03, terminando em **escolha de áreas de
interesse** em vez de confirmar uma vaga.

**Categorias — decisão travada:** já existem **10** no sistema, idênticas em 3 lugares (formulário
`candidatura/page.tsx:14`, classificador `talent_bank_matcher.py:22`, e o banco — 114 pessoas em
"Serviços Gerais"). "Serviços Gerais" **já é separada**. O menu do WhatsApp **copia as 10
idênticas** — não inventa rótulo, não funde nada (senão o filtro por área do Portal quebra, como a
S-EMP-AUD já mostrou com o cast de `area_interesse`).

## As 10 áreas (idênticas ao formulário — copiar exatamente)
```
Serviços Gerais (limpeza, portaria, zeladoria)
Construção Civil (pedreiro, ajudante, eletricista, encanador)
Logística e Entregas (estoque, separação, entregador, motorista)
Comércio e Vendas (vendedor, caixa, atendimento)
Alimentação (cozinha, garçom, lanchonete)
Tecnologia (suporte técnico, programação, dados)
Criativo / Digital (design, vídeo, redes sociais)
Beleza e Estética (barbeiro, manicure, cabeleireiro)
Cuidados Pessoais (babá, cuidador de idosos)
Administrativo / Escritório (recepção, auxiliar administrativo)
```

## O que precisa ser implementado

1. **Sequência:** nome → é pra você → data nasc (FSL-04) → PCD → **menu das 10 áreas** → currículo.
2. **Menu de áreas:** lista numerada das 10, seleção múltipla até 3 (ex.: "1,2,5"), mesmo padrão já
   usado pra escolher vários cargos. Gravar a **string completa idêntica** ao formulário (com
   parênteses), não o rótulo curto.
3. **Gravação:** enviar pro Banco de Talentos via API do portal (a mesma rota que o formulário usa
   pra banco — `candidaturas` com `observacoes` contendo `banco_talentos`, ver
   `candidaturas/route.ts:166`), categorizando igual a hoje.
4. **Reaproveitamento de dados coletados:** se veio da FSL-04 (corte de idade), não recoletar
   nome/data/PCD — já tem.
5. **Gatear pelo botão.**

## Acceptance Criteria

1. Fluxo do Banco de Talentos coleta nome → é pra você → data → PCD → áreas → currículo, no chat.
2. Menu mostra as 10 áreas idênticas ao formulário; seleção múltipla até 3.
3. A área gravada é a **string completa** (igual ao formulário) — o filtro por área do Portal
   encontra quem respondeu pelo WhatsApp.
4. Grava no Banco de Talentos via API do portal, categorizado como hoje.
5. Vindo da FSL-04, reaproveita o que já foi coletado (não repete).
6. Botão off → o caminho de banco continua indo pro formulário/link como hoje.

## Escopo

**In:** sequência de banco no chat, menu das 10 áreas, gravação via portal. **Out:** a lógica de
categorização automática por IA (já existe, `talent_bank_matcher.py` — não mexer); o
reaproveitamento self geral (FSL-06).

## ⚠️ Análise de impacto — por item

### Item — Menu de áreas + gravação
- **Toca:** nova etapa de conversa + chamada à API de banco do portal.
- **Consome hoje:** o filtro por área do Portal (`banco-talentos/page.tsx`) busca pela string
  completa gravada em `area_interesse`. **Se o WhatsApp gravar diferente, o filtro não acha** —
  por isso a string tem que ser idêntica.
- **Impacto observável:** candidato entra no Banco de Talentos sem sair do WhatsApp, e aparece nos
  filtros por área do Portal.
- **De-risk:** gravar 1 registro pelo WhatsApp e confirmar que o card daquela área no Portal o
  encontra (o mesmo teste que pegou o bug do filtro na S-EMP-AUD anterior).

## Test plan

- Automatizado: sequência completa de banco → grava com as áreas certas.
- Automatizado: seleção múltipla "1,2,5" → 3 áreas gravadas, strings completas.
- Integração: registro criado pelo WhatsApp aparece no filtro por área do Portal.
- Automatizado: vindo da FSL-04 → não recoleta nome/data/PCD.
- Botão off → caminho de banco vai pro formulário como hoje.

## Done criteria

- [x] Sequência de banco no chat
- [x] Menu das 10 áreas idênticas, seleção múltipla até 3
- [x] Área gravada = string completa (filtro do Portal encontra) *(cópia exata comprovada por
  teste dedicado — `test_areas_identicas_ao_formulario`)*
- [x] Grava via portal, categorizado como hoje *(mesma rota `candidaturas`, `observacoes`
  contendo "banco_talentos" — o gatilho que o route.ts já usa pra upsertar em `talent_bank`)*
- [x] Reaproveita dados vindos da FSL-04 *(nome/data preservados; PCD segue perguntado, pois o
  corte de idade acontece ANTES do PCD — nunca tinha sido coletado ainda)*
- [x] Botão off → hoje intacto *(por construção: o dispatcher só desvia com o flag ligado)*

## Dev Agent Record

### Decisões-chave

1. **`_iniciar_coleta_chat` reaproveitado, não duplicado** — a sequência data→PCD já existente
   (FSL-03/04/06, incluindo a oferta de reaproveitamento) é EXATAMENTE a mesma pro banco de
   talentos; só recebeu um parâmetro `banco_talentos: bool = False` a mais. Nenhuma etapa nova
   antes do PCD.
2. **Bifurcação só depois do PCD:** `coletando_pcd` passou a checar `fluxo.get("banco_talentos")`
   — candidatura de vaga vai direto pro currículo (como sempre); banco de talentos passa antes
   pela nova etapa `escolhendo_areas_interesse`, que devolve pro MESMO
   `coletando_ou_confirmando_curriculo` de sempre (zero duplicação na parte de currículo).
3. **Dispatcher `_finalizar_coleta_curriculo_chat`** — os 2 pontos de finalização em
   `coletando_ou_confirmando_curriculo` agora chamam um dispatcher que decide entre
   `_finalizar_candidatura_chat` (vaga, FSL-03) e `_finalizar_banco_talentos_chat` (novo), em vez
   de decidir duas vezes.
4. **`_finalizar_banco_talentos_chat` usa a MESMA rota `candidaturas`** — `vaga_id: null` +
   `observacoes: "banco_talentos: cadastro via WhatsApp"` é exatamente o gatilho que
   `candidaturas/route.ts:178` já usa pra upsertar em `talent_bank`; não criei rota nova nem
   duplico a lógica de categorização (que continua sendo feita pelo próprio route.ts/
   `talent_bank_matcher.py`, fora de escopo — como o Out da story pede).
5. **10 áreas copiadas literalmente** de `candidatura/page.tsx:15` (conferido caractere a
   caractere, incluindo parênteses e "/"), com teste dedicado que falha se alguém alterar uma
   string sem atualizar as duas pontas — é exatamente o tipo de regressão silenciosa que a STOP
   condition desta story avisa.
6. **Reaproveitamento pós-corte de idade (AC5):** `oferta_banco_idade_fsl` (FSL-04) tinha um
   "sim" que sempre chamava `iniciar_banco_talentos()` (link, recoleta tudo) — como a FSL-07
   ainda não existia quando a FSL-04 foi feita, isso era o comportamento correto na época. Agora,
   com o flag ligado, o "sim" pula direto pra `coletando_pcd` preservando nome/data já digitados
   (PCD nunca tinha sido perguntado nesse ponto — o corte de idade acontece antes). Com o flag
   desligado, cai no `iniciar_banco_talentos()` de sempre — comportamento de hoje intacto (AC6).
7. **Gate único ampliado, não duplicado:** `_finalizar_candidatura_self` passou de `vaga_id and
   not banco_talentos` pra `(vaga_id or banco_talentos)` — `vaga_id` e `banco_talentos` são
   mutuamente exclusivos na prática (`iniciar_banco_talentos()` sempre zera
   `vaga_id_selecionada`), então não existe ambiguidade sobre qual dos dois destinos abrir.

### File List

- `worker/empregabilidade_engine.py` — `_AREAS_INTERESSE_BANCO_TALENTOS`;
  `_finalizar_banco_talentos_chat`; `_finalizar_coleta_curriculo_chat` (dispatcher); nova etapa
  `escolhendo_areas_interesse`; `coletando_pcd` bifurca por `banco_talentos`;
  `_iniciar_coleta_chat` ganhou parâmetro `banco_talentos`; `_finalizar_candidatura_self` amplia
  o gate; `oferta_banco_idade_fsl` reaproveita dados com o flag ligado; 3 sets de etapas
  atualizados.
- `worker/tests/test_empregabilidade_engine.py` — 1 teste existente atualizado (reflete o novo
  gate) + 15 testes novos (bifurcação por PCD, seleção múltipla/limite/inválido/sem-match, cópia
  exata das áreas, finalização do banco com/sem reuso de currículo, dispatcher, reaproveitamento
  pós-idade com flag on/off).

### Validação executada

- `pytest` engine + inbound + portal_client + academia_enem + intencao_detector → **432 passed**
  (16 novos/atualizados, zero regressão).
- `py_compile` OK.

### Pendente pro @qa / validação guiada (não bloqueia o código)

- Mesma pendência de sempre: validação ao vivo (registro criado pelo WhatsApp aparecendo no
  filtro por área do Portal) exige autorização do Junior. Payload e string de área já provados
  por teste unitário byte-a-byte contra o formulário.

## QA Results (@qa — Quinn)

**Veredito: PASS** (2026-08-29). Boa disciplina de reuso — a sequência inteira antes do PCD é
100% herdada da FSL-03/04/06, sem duplicação.

### 7 quality checks

1. **Code review — PASS.** Confirmei que `vaga_id`/`banco_talentos` são de fato mutuamente
   exclusivos em TODOS os pontos de entrada — rastreei os 3 lugares que setam `banco_talentos:
   True` (`iniciar_banco_talentos()`, `oferta_banco_talentos`'s `quer_banco`, e o novo ramo de
   `oferta_banco_idade_fsl`) e os 3 fazem **replace total do fluxo**, sem `vaga_id_selecionada`
   — o gate ampliado `(vaga_id or banco_talentos)` não tem ambiguidade real de qual destino abrir.
2. **Testes — PASS.** 432 passed, 16 novos/atualizados. Gostei da granularidade: seleção múltipla
   normal, seleção além de 3 (capada), número inválido ignorado, nenhum número reconhecido
   (repete o menu), e principalmente o teste que compara `_AREAS_INTERESSE_BANCO_TALENTOS`
   literalmente contra uma cópia inline das 10 strings — eu mesmo rodei um script à parte lendo
   `candidatura/page.tsx` e comparando com o array Python, byte a byte, sem depender do teste do
   @dev pra confirmar: **idênticas**.
3. **Acceptance Criteria — 6/6.** AC1 (sequência completa no chat) ✓; AC2 (10 áreas, seleção até
   3) ✓; AC3 (string completa gravada) ✓ — confirmado também contra o schema real: `area_interesse`
   é `text[]`, filtrado via `area_interesse_busca` (coluna derivada por trigger) — a string
   completa é exatamente o que esse mecanismo espera; AC4 (grava via portal, categorizado como
   hoje) ✓ — usei a mesma leitura do route.ts que o @dev citou e confirmei que
   `observacoes.toLowerCase().includes("banco_talentos")` bate com o payload enviado; AC5
   (reaproveita dados da FSL-04) ✓; AC6 (botão off intacto) ✓ por construção.
4. **Regressão — PASS.** O teste renomeado (`test_on_banco_talentos_tambem_vai_pro_chat_fsl07`)
   documenta corretamente a MUDANÇA de comportamento (banco de talentos agora vai pro chat também)
   em vez de só apagar silenciosamente o teste antigo que testava o comportamento anterior — dá
   pra ver a intenção no próprio histórico dos testes.
5. **Performance — PASS.** Mesmo perfil de custo da FSL-03 (um upload/consulta a mais só quando
   necessário).
6. **Segurança/LGPD — PASS.** Nenhuma rota nova; mesmo endpoint e mesma autenticação M2M já
   auditados na FSL-01.
7. **Docs — PASS.** Dev Agent Record claro sobre as 7 decisões, com rastreamento preciso de onde
   cada uma toca.

Sem CONCERNS. Story pronta pra `Done`.

## Change Log

- 2026-08-29 — @qa (Quinn): gate PASS (6/6 ACs, 432 testes, mutual exclusividade
  vaga_id/banco_talentos confirmada em todos os pontos de entrada, cópia das 10 áreas verificada
  por script independente contra o formulário, gatilho `observacoes`/`area_interesse` conferido
  contra o schema real).
- 2026-08-29 — @dev (Dex): FSL-07 — Banco de Talentos no chat, reaproveitando a sequência
  data/PCD da FSL-03/04/06 e desviando só depois do PCD pra escolha de áreas (10, cópia exata do
  formulário). Grava pela mesma rota `candidaturas` que o formulário já usa pro banco.
  Reaproveitamento pós-corte de idade (FSL-04) implementado. 16 testes novos/atualizados, 432 no
  total, zero regressão. Ready → Ready for Review.

## STOP conditions

- Qualquer divergência entre a string de área do WhatsApp e a do formulário → parar (quebraria o
  filtro do Portal silenciosamente). *(Não ocorreu — teste dedicado compara as 10 strings
  literalmente.)*
