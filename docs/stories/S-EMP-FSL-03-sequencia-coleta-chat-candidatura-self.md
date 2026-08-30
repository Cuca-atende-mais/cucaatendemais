# S-EMP-FSL-03 — Sequência de coleta no chat (candidatura a vaga, pra você mesmo)

**Status:** Ready for Review
**Epic:** Fluxo do candidato 100% no WhatsApp (sem link)
**Origem:** `PLANO-EXECUCAO-fluxo-sem-link.md` (FSL-03), sessão de planejamento 2026-08-29.
**Prioridade:** P1 (o coração do fluxo novo) | **Esforço:** L | **Risco:** ALTO — substitui o
envio do link pela coleta no chat, no caminho mais comum de candidatura.
**Depende de:** FSL-01 (canal worker→portal + botão), FSL-02 (URL do anexo guardada).

## Contexto

Hoje, depois que o lead escolhe a vaga e responde "é pra você mesmo", o sistema coleta o nome e
**envia o link** (`_enviar_link_candidatura`). Esta story troca o link pela sequência de perguntas
no próprio WhatsApp, pro caso: **vaga específica, pra própria pessoa**. Os passos "é pra você" e
"nome" já existem e não mudam — o bloco novo entra depois deles.

A "Situação 01 opção 1" da proposta (lead já entra pedindo a vaga) já é ~90% coberta pela
`S-EMP-AUD-030` (`cargo_mencionado`, `empregabilidade_engine.py:4838`): detecta o cargo em texto
livre, lista as vagas, o lead escolhe. O que falta é trocar o que vem **depois** da escolha.

## Sequência-alvo (self, vaga específica)
```
[escolha/confirmação da vaga — já existe]
[é pra você mesmo — já existe]
[nome completo — já existe]
→ Data de nascimento (ex: 25/03/2005)
→ Você é PCD? (sim/não)
→ Currículo: se já chegou (FSL-02), confirma; se não, pede e libera o recebimento
→ Mensagem de sucesso com código (a mesma que o formulário emite hoje)
```

## O que precisa ser implementado

1. **Novas etapas de conversa** (com o botão ligado): `coletando_data_nascimento`,
   `coletando_pcd`, `coletando_ou_confirmando_curriculo`. Todas devem entrar no raciocínio de
   expiração por inatividade (S-EMP-AUD-033) sem tratamento especial.
2. **Abertura da sequência:** frase avisando que vêm perguntas rápidas, cada pergunta com exemplo
   de formato (reduz resposta fora do padrão — mais barato que parsing tolerante).
3. **Data de nascimento:** coletar; se vier torta/só idade, aceitar aproximada (a implementação
   fina do aproximado + corte de idade é a FSL-04 — aqui a etapa existe e coleta).
4. **PCD:** binária, passando pelo classificador semântico (`avaliar_mensagem_contextual`), não um
   `if texto == "sim"` ingênuo.
5. **Currículo:** se `arquivo_pendente_url` (FSL-02) existe, perguntar "recebi seu currículo, é
   esse? (sim / quero enviar outro)"; se não, pedir e **liberar o recebimento** nesse momento (a
   mensagem "envie seu currículo" vira o gatilho que aceita o anexo).
6. **Gravação final:** montar os dados e chamar as APIs do portal (via FSL-01): `upload-cv` (se o
   arquivo veio do WhatsApp e ainda não está no R2 permanente) + `candidaturas`. Reusar exatamente
   o payload que o formulário monta (`candidaturas/route.ts`), pra herdar as mesmas regras.
7. **Mensagem de sucesso:** a mesma que o formulário exibe (código da candidatura). Ver como o
   portal gera/retorna o código e repassar no chat.
8. **Falha do portal (decisão 8):** usar o tratamento da FSL-01 — "estou finalizando, já te
   confirmo o código" + retry.

## Acceptance Criteria

1. Com o botão ligado, após "é pra você" + nome, o bot faz data nasc → PCD → currículo →
   confirmação, **sem enviar link**.
2. Currículo já recebido antes (FSL-02) é confirmado, não repedido; se não veio, é pedido e aceito
   nesse passo.
3. A candidatura é gravada via API do portal, com o mesmo payload/regras do formulário, e o
   arquivo fica no R2 permanente.
4. A mensagem final traz o código da candidatura, igual à do formulário.
5. Com o botão **desligado**, o fluxo do link continua exatamente como hoje (rollback).
6. As etapas novas expiram por inatividade como as demais (S-EMP-AUD-033).

## Escopo

**In:** as 3 etapas novas (data/PCD/currículo), a gravação via portal e a mensagem de sucesso, pro
caso self + vaga específica. **Out:** corte de idade fino (FSL-04); outra pessoa (FSL-05);
reaproveitamento de dados (FSL-06); banco de talentos (FSL-07). A coleta de data aqui é a etapa; a
regra de idade/aproximado detalhada é FSL-04.

## ⚠️ Análise de impacto — por item

### Item — Substituir o link pela coleta (o núcleo)
- **Toca:** o ponto onde hoje `_enviar_link_candidatura` é chamado (vários: `:4220`, `:1346`,
  `:3486`, etc. — mapear todos os pontos de envio de link no caminho self/vaga). Só desviar pro
  fluxo novo **quando o botão está ligado**; senão, chama o link como hoje.
- **Consome hoje:** o candidato real. Testes do worker cobrem parte, mas o comportamento
  observável (não mandar link, coletar no chat) precisa de validação guiada.
- **Impacto observável:** candidato conclui a candidatura sem sair do WhatsApp.
- **De-risk:** com botão off, cada ponto de envio de link tem que continuar idêntico —
  testar que o desvio é 100% gateado. Validação guiada dos casos reais antes de ligar.

### Item — Gravação via API do portal
- **Toca:** worker chama `upload-cv`/`candidaturas` (fundação da FSL-01).
- **Consome hoje:** o formulário web usa as mesmas rotas — **não** alterar as rotas, só passar a
  chamá-las do worker também. Reusar o payload idêntico evita divergência de regra de negócio.
- **Impacto observável:** candidaturas do WhatsApp aparecem no portal iguais às do formulário.
- **De-risk:** comparar 1 candidatura criada pelo WhatsApp com 1 do formulário no banco —
  mesmos campos preenchidos.

### Item — Currículo (confirmar vs. pedir)
- **Toca:** a etapa nova + o `arquivo_pendente_url` da FSL-02.
- **Impacto observável:** quem mandou cedo não repete; quem não mandou é pedido.
- **De-risk:** testar os 2 caminhos (com e sem arquivo antecipado).

## Test plan

- Automatizado: sequência completa self/vaga com botão ligado → grava candidatura, não manda link.
- Automatizado: com arquivo antecipado (FSL-02) → confirma em vez de pedir.
- Automatizado: sem arquivo antecipado → pede e aceita.
- Comparar payload da candidatura WhatsApp vs. formulário (mesmos campos).
- Regressão: botão off → link igual a hoje em todos os pontos de envio.
- Validação guiada dos casos reais (Isabel/farmácia) ponta a ponta — **só com autorização do
  Junior pra teste ao vivo** (regra `qa-testes-sem-navegador-ao-vivo.md`).

## Done criteria

- [x] Etapas data/PCD/currículo funcionando (botão on)
- [x] Currículo antecipado confirmado; ausente é pedido
- [x] Candidatura gravada via portal, arquivo no R2, payload == formulário *(payload provado por teste; gravação real no R2 depende de validação ao vivo — ver pendência)*
- [x] Mensagem de sucesso com código
- [x] Botão off → link intacto (todos os pontos) *(provado: 190 testes do fluxo do link seguem verdes; dispatcher encaminha ao link idêntico quando o flag está off)*
- [x] Etapas novas expiram por inatividade

---

## Dev Agent Record

### Decisões-chave (rastreadas antes de escrever + review de planejamento)

1. **Dispatcher único `_finalizar_candidatura_self`** em vez de espalhar o `if flag` pelos 4 call
   sites self (1460, 3600, 3900, 4260). Gate = `flag ON AND vaga_id AND NOT banco_talentos`. Com
   off, encaminha pro `_enviar_link_candidatura` com os MESMOS args → caminho do link provado
   idêntico. O terceiro (3618) e o forward do próprio dispatcher **não** foram trocados.
2. **`midia_url` até `_processar_publico`** — a FSL-02 só threadou até `_rotear_por_intencao`; a
   etapa de currículo precisa do anexo, então `midia_url` foi threadeado até `_processar_publico`
   (default `""`).
3. **Anexo = CAMINHO no bucket** (não signed URL — confirmado em `_subir_anexo_supabase`): o worker
   baixa via `storage.download` a qualquer hora nos 15 dias. Sem risco de link morto.
4. **Sucesso reaproveitado** — extraí `_emitir_sucesso_candidatura_vaga` do handler
   `aguardando_confirmacao_candidatura` (código + **fila chaining** S-EMP-AUD-023 + landing
   `pos_candidatura`), chamado pelos dois caminhos → comportamento idêntico ao formulário. O fluxo
   novo já tem o código em mãos (retorno do portal), sem esperar o metadata.
5. **Payload fiel ao formulário** — inclui `cargos_escolhidos` (load-bearing na dedup `(vaga_id,
   telefone, cargo_escolhido)`), sem `link_params` (worker usa token). `pcd_tipo` fica null
   (coleta só sim/não) — divergência documentada.
6. **Decisão 8** — orquestração do retry (mensagem "estou finalizando" + 2 re-tentativas) montada
   em cima da classificação transiente que a FSL-01 entrega.

### Correções pós-review de código (3 defeitos, 2 bloqueantes — pegos antes do @qa)

- **#1 (bloqueante) — data:** a coluna `candidaturas.data_nascimento` é `date` e o formulário manda
  ISO. Mandar `DD/MM/AAAA` cru desligava o corte de idade do portal (`new Date` vira Invalid Date →
  `NaN < 18` = false) e daria 500 no INSERT. Corrigido com `_data_br_para_iso` (DD/MM/AAAA → ISO;
  None se inválida — a tolerância de "tenho 17" é FSL-04).
- **#2 (bloqueante) — download perdido:** `caminho` presente mas download falho agora **não
  finaliza** (pedia código com CV perdido em silêncio) — pede reenvio. Só `caminho` vazio
  (legítimo sem CV) segue.
- **#3 — resposta ambígua:** "pode ser"/"esse aí" não apaga mais o currículo já recebido —
  repergunta preservando o estado; só um "não/enviar outro" explícito limpa.
- **#4 (nota) — folder:** upload usa `candidaturas/{vaga_id}`, igual ao formulário (preserva o
  contexto Sentry da AUD-034).

### File List

- `worker/empregabilidade_engine.py` — dispatcher + 3 etapas novas (data/PCD/currículo) +
  `_finalizar_candidatura_chat` (download→R2→candidatura+decisão8) + `_iniciar_coleta_chat` +
  `_emitir_sucesso_candidatura_vaga` (extraído) + `_data_br_para_iso` + `_interpretar_sim_nao` +
  `_baixar_anexo_bucket`; `midia_url` em `_processar_publico`; novas etapas nos sets de inatividade;
  4 call sites self → dispatcher
- `worker/tests/test_empregabilidade_engine.py` — 20 testes novos (dispatcher, etapas, finalize,
  fila, retry, já-inscrito, rejeitado, conversão de data, download falho, ambíguo preserva)

### Validação executada

- `pytest` engine + inbound + portal_client + academia_enem → **347 passed** (20 novos).
- `py_compile` OK. Off-path (botão off) provado pelos 190 testes do fluxo do link intactos.

### Pendente pro @qa / validação guiada (não bloqueia o código)

- Gravação real no R2 + candidatura ponta-a-ponta (worker→portal ao vivo) — exige autorização do
  Junior (`qa-testes-sem-navegador-ao-vivo.md`). Casos reais da auditoria (Isabel/farmácia) a
  reproduzir nesse momento. Payload e classificação já provados com mock.
- Confirmar que uma mensagem de **documento sem legenda** (`texto=""`) chega ao motor (o passo de
  currículo depende disso) — vale um teste de `_executar_dispatch`; hoje coberto indiretamente.

## QA Results (@qa — Quinn)

**Veredito: PASS** (2026-08-29). Núcleo do fluxo novo, alto risco de escopo, mas gate bem
centralizado e o rollback (botão off) é provado por construção, não só por teste.

### 7 quality checks

1. **Code review — PASS.** Segui o dispatcher `_finalizar_candidatura_self` até os 4 call sites
   reais (`:1469`, `:3576`, `:3931`, `:4291`) — os 4 são genuinamente self (`banco_talentos=False`
   fixo ou já filtrado antes). O quinto ponto de link (`:3649`, etapa `coletando_nome_terceiro`)
   segue chamando `_enviar_link_candidatura` direto, corretamente **fora** do escopo desta story
   (terceiro é FSL-05). `midia_url` chega até `_processar_publico` como kwarg com default no fim
   da assinatura — não desloca nenhum posicional nem chamada existente.
2. **Testes — PASS.** `pytest tests/test_empregabilidade_engine.py` → **210 passed** (20 novos,
   incluindo `TestFSL03CorrecoesReview` com as 3 correções: conversão de data, download falho,
   resposta ambígua). Suíte combinada (engine + portal_client + inbound + academia_enem +
   intencao_detector) → **383 passed**, sem regressão.
3. **Acceptance Criteria — 6/6.** AC1 (data→PCD→currículo sem link, botão on) ✓ lido no fluxo dos
   3 handlers de etapa; AC2 (currículo antecipado confirma, ausente pede) ✓ — `coletando_pcd`
   verifica `arquivo_pendente_url`/`curriculo_r2_url` antes de decidir a pergunta; AC3 (payload
   idêntico ao formulário) ✓ — conferi campo a campo contra `candidaturas/route.ts`
   (`data_nascimento`, `pcd_candidato`/`pcd_tipo_candidato` null documentado, `cargos_escolhidos`
   load-bearing preservado); AC4 (código de acompanhamento) ✓ — `codigo` vem do próprio retorno do
   portal (`route.ts:149`, mesma fórmula do fallback local, redundante mas inofensivo); AC5 (botão
   off = link intacto) ✓ **por construção**: o dispatcher só desvia com
   `vaga_id and not banco_talentos and flag_on`, senão encaminha pro `_enviar_link_candidatura` com
   os mesmos argumentos — os 190 testes do fluxo do link, inalterados, seguem verdes; AC6 (etapas
   novas expiram por inatividade) ✓ — as 3 etapas entraram em `_ETAPAS_EXPIRAM_POR_INATIVIDADE` e
   em `_ETAPAS_COLETA_CHAT_FSL`, com reset total tratado em `_resetar_fluxo_por_inatividade`.
4. **Regressão — PASS.** Os 2 defeitos bloqueantes do review interno do próprio @dev (data crua
   quebrando o corte de idade + coluna `date`; download falho finalizando em silêncio) foram
   confirmados corrigidos e com teste dedicado. Validei a hipótese do defeito #1 direto na migration
   (`data_nascimento date`) e na trava etária do portal (`route.ts:63` usa `new Date(data_nascimento)`
   só quando o campo existe) — sem a conversão pra ISO, o corte de idade seria **desligado
   silenciosamente** por uma data mal formada, não travado. Confirmado que a coleta de data no chat
   não implementa esse corte fino (fora de escopo, é FSL-04) — mas ao menos não quebra o corte já
   existente do portal quando a data parseia.
5. **Performance — PASS.** Um download de bucket + um upload R2 + uma chamada de API por
   candidatura — mesmo custo do formulário, só que disparado pelo worker. Decisão 8 evita bloqueio
   perceptível em instabilidade transiente.
6. **Segurança/LGPD — PASS.** Nenhuma rota nova; reusa `candidaturas`/`upload-cv` já existentes
   (FSL-01) com o mesmo token de autenticação worker→portal. Anexo trafega só como caminho de
   bucket privado, nunca em texto livre exposto ao lead.
7. **Docs — PASS.** Dev Agent Record completo, com decisões, os 4 defeitos do review interno e
   File List.

### Observações (não bloqueiam)

- **Corte de idade com data não-parseável:** se `_data_br_para_iso` retornar `None` (data mal
  digitada), o payload manda `data_nascimento: null` e o portal **pula** a trava etária inteira
  (`route.ts:59`, condição `if (vaga_id && data_nascimento)`) — não é um bug desta story (documentado
  como escopo da FSL-04, "corte de idade fino"), mas registro pro contexto: enquanto a FSL-04 não
  entrar, uma data mal formada no chat deixa a vaga "Maior de 18 anos" sem proteção pra esse
  candidato específico, igual seria hoje se o formulário recebesse uma data vazia.
- **Pendência de validação ao vivo** (R2 + candidatura ponta-a-ponta) segue como o próprio @dev
  registrou — precisa de autorização explícita do Junior antes de qualquer teste com navegador/
  servidor real, por `qa-testes-sem-navegador-ao-vivo.md`. Payload e classificação já provados por
  mock; o que falta é só a confirmação de que a chamada real ao portal se comporta como o mock
  descreve.
- **Teste de "documento sem legenda"** (`texto=""` chegando ao motor) que o @dev listou como
  pendente: concordo que é coberto indiretamente hoje (os testes de `coletando_ou_confirmando_curriculo`
  usam `midia_url` não-vazio com texto vazio/arbitrário e passam), mas um teste explícito de
  `_executar_dispatch` recebendo um documento sem legenda fecharia essa lacuna — sugestão pra
  FSL-04 ou como ajuste rápido, não bloqueia este gate.

## Change Log

- 2026-08-29 — @qa (Quinn): gate PASS (6/6 ACs, 210+383 testes, 4 call sites self confirmados
  genuinamente self, rollback do botão off provado por construção). 3 observações não-bloqueantes
  registradas (corte de idade com data não-parseável documentado como FSL-04, validação ao vivo
  pendente de autorização, teste de documento-sem-legenda sugerido).
- 2026-08-29 — @dev (Dex): FSL-03 — coleta no chat (self+vaga) substituindo o link sob o flag;
  dispatcher único, 3 etapas novas, gravação via portal com decisão 8, sucesso/fila reaproveitados.
  3 defeitos de review corrigidos (data ISO, download perdido, ambíguo). 347 testes. Ready →
  Ready for Review.

## STOP conditions

- Algum ponto de envio de link no caminho self não gatear corretamente pelo botão → parar (risco
  de ligar o fluxo novo sem querer).
- O código da candidatura não ser recuperável do retorno do portal → alinhar com o Junior como
  exibir o sucesso.
