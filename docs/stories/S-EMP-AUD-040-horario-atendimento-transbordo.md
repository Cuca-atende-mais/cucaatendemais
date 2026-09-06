# S-EMP-AUD-040 — Horário de atendimento no transbordo do Emprega+

**Status:** InReview
**Epic:** Auditoria Empregabilidade
**Origem:** Demanda direta do Junior 2026-09-05 —
`docs/2026-09-05/PLANO-3-melhorias-empregabilidade-2026-09-05.md`, item 2.
**Prioridade:** P1 | **Esforço:** M | **Risco:** MED — mexe no funil único de transbordo do
canal, por onde passam 7 pontos de chamada; um erro de fuso ou de estado afeta todo pedido de
atendente humano.
**Depende de:** nada tecnicamente. Ordem definida pelo Junior: vem depois da S-WM-70.
**Deploy:** redeploy do serviço **`cuca-worker`** no EasyPanel após o merge.

## Contexto

Hoje o Emprega+ promete atendimento humano a qualquer hora. Um lead que pede atendente sexta às
19h, ou no sábado, recebe *"Em breve você será atendido por nossa equipe"* — promessa que ninguém
vai cumprir antes de segunda — e a conversa é marcada `awaiting_human`, o que **pausa a IA**: o
lead fica sem atendimento humano E sem autoatendimento até alguém abrir a fila.

Horário real de atendimento: **Segunda a sexta, 08:00 às 17:00**.

### Ponto de entrada único (já mapeado pelo @dev)

Todos os pontos que prometem atendente humano ao lead no Emprega+ passam por
**`_acionar_transbordo_empregabilidade`** (`worker/empregabilidade_engine.py:654`) — 7 chamadas:
linhas 878, 2426, 3368, 3957, 4014, 5425, 5454. É o único funil voltado ao lead, e é onde o gate
entra. Nenhum call site precisa ser alterado individualmente.

### ⛔ Onde o gate NÃO pode entrar

**`_notificar_transbordo` está fora.** As linhas 6050 e 6091 chamam essa função diretamente para o
aviso interno de *vaga/seleção criada* (`tag_finalidade="VagaCriada"`, S-EMP-AUD-027) — é ping
operacional pra equipe, não promessa de atendimento ao lead. **Confirmado pelo Junior (05/09): o
aviso de vaga e seleção nova continua disparando 24/7.** Gatear ali quebraria isso silenciosamente.

## O que precisa ser implementado

### Item A — Helper de janela de atendimento

`_dentro_horario_atendimento(agora: datetime | None = None) -> bool`:
- Segunda a sexta, **08:00 às 16:59** — às 17:00 em ponto já é fora do horário. É a leitura de
  "atende até as 17h"; **está registrado aqui de propósito** pra não virar achado de @qa depois.
- Sábado e domingo → sempre fora.
- **Feriado não é tratado** (decisão explícita do Junior, 05/09): feriado em dia útil cai
  normalmente no transbordo, dentro do horário. Comportamento deliberado, não é bug.
- **Fuso: `-03:00` explícito.** Reusar o padrão já existente `_TZ_FORTALEZA = timezone(timedelta(hours=-3))`
  (`worker/campanhas_engine.py:312`), com comentário deixando explícito que vale para São
  Paulo/Fortaleza (mesmo deslocamento, nenhum dos dois tem horário de verão desde 2019).
- Parâmetro `agora` injetável — é o que torna a função testável sem mock de relógio global.

**Por que o fuso é crítico:** o container do worker roda em **UTC** (a migration
`20260827161500_s_wm_68_cron_expirar_anexos.sql` já documenta "04:00 UTC = 01:00 BRT"). Um
`datetime.now()` sem fuso deixaria o gate **3 horas deslocado** — responderia "fora do horário"
durante boa parte do expediente real.

**Verificação já feita pelo @dev no banco de produção (`cuca`), a pedido do Junior:** `SHOW timezone`
= **UTC** e as colunas de data são `timestamptz`. Esse é o cenário **correto**: `timestamptz` grava
instante absoluto e converte na leitura — uma mensagem recebida não "carrega" o fuso de outro
estado/país pra dentro do registro. O risco levantado não se materializa nessas colunas; ele existe
apenas em código que gera/compara data **sem fuso**, e é por isso que o `-03:00` explícito aqui é
requisito e não detalhe.

### Item B — Janela HARDCODED no código, não em `configuracoes`

**Reversão consciente da proposta original do planejamento**, por instrução do Junior (05/09):
*nenhuma mudança pode valer em tempo real, só com redeploy*. Uma chave em `configuracoes` passaria
a valer no próximo `SELECT` do worker, sem deploy — exatamente o que não se quer. Perde-se ajustar
o horário sem deploy; ganha-se previsibilidade. Mudança futura de horário = PR.

### Item C — Fluxo fora do horário (sequência exata pedida pelo Junior)

Quando `_acionar_transbordo_empregabilidade` é chamada **fora da janela**:

1. **NÃO** marcar `status='awaiting_human'` e **NÃO** notificar o contato de transbordo — a IA
   segue ativa, a conversa não é parqueada;
2. enviar mensagem única informando o horário de atendimento (Seg–Sex, 08:00 às 17:00) **e
   perguntando se pode ajudar em outro assunto**.

   **Copy proposta pelo @po** (o @dev implementa esta, salvo se o Junior ajustar antes):

   > No momento nossa equipe não está disponível. 🕐
   > O atendimento humano funciona de **segunda a sexta, das 08:00 às 17:00**.
   >
   > Assim que abrirmos, é só chamar aqui que a gente te atende!
   > Enquanto isso, posso te ajudar com mais alguma coisa por aqui? 😊

   **Copy de encerramento cordial** (passo 4, quando o lead nega):

   > Combinado! Qualquer coisa é só me chamar — vou estar por aqui. 🤝
   > Tenha um ótimo dia!

   ✅ **Copy APROVADA pelo Junior em 2026-09-05.** Os dois textos acima são os definitivos —
   implementar literalmente, sem reescrever. Qualquer ajuste de redação vira nova decisão dele.
3. gravar uma etapa nova de estado (ex.: `fora_horario_aguardando_assunto`) no fluxo da conversa;
4. na resposta seguinte do lead:
   - **negação/agradecimento** ("não", "obrigado", "era só isso", "nada", "pode encerrar") →
     **encerrar com cordialidade**, tom solícito e prestativo, nunca seco;
   - **qualquer outro assunto** → segue o fluxo normal do Emprega+, sem perder a mensagem.

**Reusar o que já existe, não inventar:** `_quer_encerrar` (`empregabilidade_engine.py:740`) já
detecta negação/despedida, e `_encerrar_fluxo` (`:790`) já encerra com despedida — inclusive com
`mensagem_customizada`, o parâmetro adicionado na S-EMP-AUD-029 exatamente para casos em que a
despedida genérica soa fora de contexto.

**Isso não é uma troca de string:** a substituição do `mensagem_sucesso` sozinha não resolve,
porque o passo 4 exige estado. `_acionar_transbordo_empregabilidade` passa a ter dois caminhos —
dentro do horário (comportamento atual, intacto) e fora (novo).

## Acceptance Criteria

1. Dentro da janela (Seg–Sex 08:00–16:59, `-03:00`): comportamento **idêntico ao de hoje** nos 7
   call sites — marca `awaiting_human`, notifica o transbordo, envia o `mensagem_sucesso` do call
   site. Nada muda.
2. Fora da janela: a conversa **não** é marcada `awaiting_human`, o transbordo **não** é
   notificado, e a IA permanece ativa.
3. Fora da janela: o lead recebe a mensagem de horário + oferta de ajuda, **exatamente no texto
   aprovado** pelo Junior (Item C) — implementação literal, não paráfrase.
4. Se o lead responder com negação/agradecimento, a conversa é encerrada com cordialidade — tom
   solícito, deixando a porta aberta.
5. Se o lead responder com outro assunto, o fluxo normal do Emprega+ continua e a mensagem dele
   **não** é perdida.
6. Limites da janela corretos: sexta 16:59 = dentro; sexta 17:00 = fora; sábado 10:00 = fora;
   domingo 10:00 = fora; segunda 08:00 = dentro; segunda 07:59 = fora.
7. O gate converte para `-03:00` antes de comparar — um `datetime` recebido em UTC produz o mesmo
   veredito que o horário local equivalente.
8. **Não regride:** o aviso interno de vaga/seleção criada (`_notificar_transbordo` com
   `tag_finalidade="VagaCriada"`, linhas 6050 e 6091) continua disparando **24/7**, inclusive fora
   do horário e no fim de semana.
9. A janela está **no código**, não em `configuracoes` — não existe linha de banco capaz de alterar
   esse comportamento sem redeploy.
10. Se o transbordo falhar tecnicamente **dentro** do horário, o comportamento de reversão atual
    (restaurar `status='ativa'` + `_MSG_TRANSBORDO_FALHOU`) continua igual.

## Escopo

**In:** os 10 ACs acima, restritos a `worker/empregabilidade_engine.py` (helper novo, os dois
caminhos de `_acionar_transbordo_empregabilidade`, a etapa nova e seu tratamento) + testes.
**Out:**
- feriados (decisão explícita do Junior — fora de escopo, não é débito silencioso);
- horário por unidade ou por módulo — janela única para o canal;
- painel/config no portal para editar o horário (contraria o AC9);
- o mesmo tratamento nos canais Institucional e Academia Enem — se for desejado, é story própria;
- `worker/cv_processor.py:465`, que usa `datetime.utcnow().isoformat()` sem sufixo de fuso —
  **achado adjacente registrado pelo @dev**, mesmo padrão naive que motiva o cuidado desta story,
  mas não afeta este gate. Varredura de datas naive = story própria.

## ⚠️ Análise de impacto — por item

### Item A — Helper `_dentro_horario_atendimento`

- **Toca:** função nova em `worker/empregabilidade_engine.py`; nenhuma alteração de dado.
- **Consome hoje:** ninguém — função nova.
- **Impacto observável:** nenhum isolado.
- **Risco:** erro de fuso é o modo de falha realista — 3h de deslocamento faria o bot dizer
  "fechado" das 14h às 17h e "aberto" das 05h às 08h.
- **De-risk concreto:** AC6 e AC7 cobrem os limites com relógio injetado (`agora`), não mock global.

### Item B — Dois caminhos em `_acionar_transbordo_empregabilidade`

- **Toca:** `worker/empregabilidade_engine.py:654-735`.
- **Consome hoje:** **7 call sites** — pedido de atendente via `_escape_semantico_ou_none` (:878),
  número não autorizado (:2426), :3368, falhas repetidas (:3957, :4014), dúvida SQS-40 (:5425,
  :5454). Todos passam a herdar o gate sem alteração própria.
- **Impacto observável:** fora do horário, o lead deixa de receber uma promessa que não será
  cumprida e mantém o autoatendimento; a equipe deixa de encontrar conversas paradas na segunda.
  Dentro do horário, nada muda (AC1).
- **Risco:** a função hoje marca `awaiting_human` **antes** de notificar, com reversão em caso de
  falha. O caminho novo precisa sair **antes** desse bloco inteiro — se marcar e só depois checar o
  horário, a conversa fica parqueada mesmo no caminho novo, invertendo o objetivo.
- **De-risk concreto:** teste que verifica o `status` final da conversa nos dois cenários (AC1, AC2)
  — não só o texto da mensagem enviada.

### Item C — Etapa `fora_horario_aguardando_assunto`

- **Toca:** o dicionário de fluxo (`_set_fluxo_async`) e o roteador de etapas de
  `processar_mensagem_empregabilidade`.
- **Consome hoje:** o roteador percorre etapas por nome; uma etapa desconhecida cai no fallback
  genérico. **Verificar** se a etapa nova precisa entrar em listas já existentes —
  `_ETAPAS_NOTIFY_PORTAL` (loop proativo), `_ETAPAS_OFERTA_ATENDENTE`, `_ETAPA_ANTERIOR` (voltar),
  e a expiração por inatividade da S-EMP-AUD-033. Uma etapa fora dessas listas pode ficar **presa**
  se o lead simplesmente não responder.
- **Impacto observável:** o lead consegue sair do estado por negação (encerra) ou por novo assunto
  (segue). Sem a checagem acima, um lead que abandona a conversa ficaria travado nessa etapa até a
  expiração — ou indefinidamente, se a expiração não cobrir a etapa nova.
- **De-risk concreto:** grep explícito por essas 4 listas antes de implementar, e teste do caso
  "lead não responde nada" confirmando que a expiração por inatividade alcança a etapa nova.
- **Pergunta em aberto:** nenhuma — decidido por instrução do Junior.

### Item D — Regra "só vale com redeploy"

- **Toca:** decisão de onde a janela mora (código, não banco).
- **Impacto observável:** nenhuma conversa em andamento muda de comportamento no instante de uma
  gravação em banco; a mudança entra com o redeploy do `cuca-worker`.
- **De-risk concreto:** @qa deve confirmar (AC9) que nenhuma linha de `configuracoes` participa
  desta story.

## Test plan

- `pytest worker/tests/test_empregabilidade_engine.py` — suíte existente **verde antes e depois**.
- Testes novos com `agora` injetado nos 6 limites do AC6, mais o caso UTC do AC7.
- Teste do estado da conversa: dentro do horário → `awaiting_human` + notificação (AC1); fora →
  nenhum dos dois (AC2).
- Teste do diálogo: fora do horário → negação encerra (AC4); fora do horário → outro assunto segue
  (AC5); lead não responde → etapa alcançada pela expiração (Item C).
- Teste de não-regressão do aviso `VagaCriada` fora do horário (AC8) — é o risco mais fácil de
  quebrar sem perceber.
- ⚠️ **Sem navegador, sem localhost** (`qa-testes-sem-navegador-ao-vivo.md`).

## File List

- `worker/empregabilidade_engine.py`:
  - `_NEGATIVO_FORA_HORARIO_CURTO` (tupla) e `_quer_encerrar_fora_horario` — complemento a
    `_quer_encerrar` só pra esta etapa (ver Dev Agent Record, achado do gap).
  - `_ETAPAS_EXPIRAM_POR_INATIVIDADE`: `"fora_horario_aguardando_assunto"` adicionada.
  - `_resetar_fluxo_por_inatividade`: branch novo pra essa etapa (reset total, sem progresso a
    preservar).
  - `_MSG_FORA_HORARIO_ATENDIMENTO` / `_MSG_FORA_HORARIO_ENCERRAMENTO` — copy aprovada pelo
    Junior, implementação literal.
  - `_dentro_horario_atendimento(agora=None)` — Item A, helper novo.
  - `_acionar_transbordo_empregabilidade`: dois caminhos — fora do horário (novo, no topo da
    função) e dentro do horário (comportamento existente, intacto, sem alteração de linha).
  - `_processar_mensagem_empregabilidade_locked`: branch novo pra
    `etapa_atual == "fora_horario_aguardando_assunto"`, cross-cutting, mesmo ponto de
    `confirmando_troca_rota` (não pertence a nenhum perfil).
- `worker/tests/test_empregabilidade_engine.py`:
  - 6 testes pré-existentes ajustados (`_dentro_horario_atendimento` forçado a `True` via
    monkeypatch) — quebravam por dependência do relógio real, não por regressão de lógica (ver
    Dev Agent Record).
  - 34 testes novos, em 6 classes: `TestDentroHorarioAtendimento` (AC6/AC7),
    `TestAcionarTransbordoForaHorario` (AC1/AC2/AC3/AC8*/AC9),
    `TestQuerEncerrarForaHorario` (AC4, inclui o gap documentado de `_quer_encerrar` puro),
    `TestEtapaForaHorarioAguardandoAssunto` (AC4/AC5, via roteador completo),
    `TestExpiracaoAlcancaEtapaForaHorario` (Item C), `TestVagaCriadaNotificaForaDoHorario` (AC8).

## Dev Agent Record

- **Achado durante a implementação — gap em `_quer_encerrar`:** a story instruía reusar
  `_quer_encerrar` para detectar negação (Item C), citando "não", "nada" e "pode encerrar" como
  exemplos. Verifiquei empiricamente ANTES de codar: `_quer_encerrar("não")`,
  `_quer_encerrar("nada")` e `_quer_encerrar("pode encerrar")` retornam `False` — a função foi
  desenhada pra despedida em texto livre, não pra respostas curtas isoladas a uma pergunta
  fechada de sim/não. Implementar só com `_quer_encerrar` violaria o AC4 nos próprios exemplos da
  story. Criei `_quer_encerrar_fora_horario` (lista curta determinística + `_quer_encerrar` como
  fallback) em vez de inventar um mecanismo novo — continua reusando a função pedida, só cobre o
  que ela sozinha não cobre. `TestQuerEncerrarForaHorario.test_gap_documentado_em_quer_encerrar_puro`
  fixa esse gap como fato testado, não afirmação solta.
- **Achado durante a implementação — `metadata_update` teria quebrado o caso "dúvida" (SQS-40):**
  o caminho fora do horário, como desenhado na story, não tocava `metadata_update`. Rastreei o
  call site de `motivo="duvida"` (:5437-ish) e vi que ele depende de `metadata_update` ser
  persistido pra limpar `ultima_intencao` — sem isso, a PRÓXIMA mensagem do lead re-entraria no
  mesmo caminho de dúvida indefinidamente, nunca alcançando a etapa nova. Corrigido: o caminho
  fora do horário persiste `metadata_update` (só isso, sem tocar `status`).
  `test_fora_horario_persiste_metadata_update_mesmo_sem_marcar_status` cobre.
- **Fluxo restaurado, não parâmetro novo:** `_acionar_transbordo_empregabilidade` busca o fluxo
  atual internamente (`_get_fluxo_async`) em vez de receber como parâmetro — confirmado nos 8
  call sites reais (a story citava 7; achei 1 a mais, `_registrar_falha_e_oferecer_atendente`,
  mesma linha do funil) que nenhum já mutava o fluxo antes de chamar esta função, então buscar
  fresco reflete exatamente o estado pré-transbordo. Isso cumpre literalmente "nenhum call site
  precisa mudar" (Escopo/In da story) — os 8 continuam idênticos.
- **6 testes pré-existentes precisaram de ajuste, não de correção de bug:** rodei a suíte pela
  primeira vez num sábado às 21h (fora da janela) — 6 testes que assumiam o caminho "dentro do
  horário" incondicional passaram a cair no caminho novo. Não são regressões de lógica; são
  testes que agora precisam controlar o relógio, exatamente a consequência esperada de introduzir
  um gate de tempo. Corrigido via `monkeypatch.setattr(emp, "_dentro_horario_atendimento", lambda
  agora=None: True)` nos 6, preservando a intenção original de cada um.
- **AC8 (VagaCriada 24/7):** prova estrutural, não só a leitura de código já feita no
  planejamento — `TestVagaCriadaNotificaForaDoHorario` inspeciona o código-fonte de
  `_empregabilidade_notify_tick` via `inspect.getsource` e confirma que `_acionar_transbordo_empregabilidade`
  nunca aparece ali. Complementar: os testes pré-existentes desse loop (linhas ~4013-4352, ~6750)
  continuam 100% verdes sem precisar de nenhum ajuste de relógio — não passam pelo gate novo.
- **Ruff não disponível neste ambiente** (não instalado) — não foi possível rodar o lint
  configurado do projeto para Python. `python3 -c "import ast; ast.parse(...)"` confirma sintaxe
  válida; revisão manual de estilo seguiu o padrão já estabelecido no arquivo (imports locais com
  `noqa: PLC0415`, docstrings no mesmo formato).
- **Testes:** `pytest worker/tests/test_empregabilidade_engine.py` — 281 → 287 (6 ajustados) → 321
  (34 novos), **0 falhas** em todas as rodadas.
- **Worktree:** implementado em `/home/valmir/Documentos/cucaatendemais-s-emp-aud-040`
  (`git worktree`), branch `fix/s-emp-aud-040-horario-atendimento-transbordo`, isolado de
  propósito da branch `fix/ocr-curriculo-starvation-parsing` (WIP alheio no mesmo arquivo).

## Change Log

- v0.4 (2026-09-05): @dev implementa. Os 2 itens (A: helper de horário; B: dois caminhos no
  transbordo; C: etapa nova cross-cutting) seguidos conforme desenhado, com 2 achados registrados
  no Dev Agent Record que a story não previa (gap real em `_quer_encerrar`, e `metadata_update`
  do caso "dúvida" precisando ser persistido mesmo fora do horário) — ambos corrigidos, não só
  sinalizados. Suíte 281→321 (6 ajustados por dependência de relógio real, não regressão; 34
  novos), 0 falhas. Status: Ready → **InReview** (aguardando @qa).
- v0.3 (2026-09-05): Junior **aprova a copy** proposta (mensagem de fora do horário + encerramento
  cordial). Pendência do v0.2 encerrada; os textos do Item C passam a ser definitivos e o AC3 exige
  implementação literal. A story não tem mais nenhuma dependência de decisão externa.
- v0.2 (2026-09-05): @po valida — **GO condicional** (8/10). Lacuna encontrada: os ACs descreviam
  o comportamento mas **nenhum texto de mensagem estava definido** — o @dev teria que inventar copy
  num canal em que o Junior já reescreveu texto antes (S-EMP-AUD-025), o que quase garante
  retrabalho. Copy proposta adicionada ao Item C e referenciada no AC3, marcada como **pendente de
  confirmação do Junior** — o @dev pode começar pelos itens A e B (helper e fuso) sem esperar essa
  resposta. Ressalva registrada: o Item C (etapa nova) é a parte mais delicada da leva, e a
  checagem das 4 listas de etapas (`_ETAPAS_NOTIFY_PORTAL`, `_ETAPAS_OFERTA_ATENDENTE`,
  `_ETAPA_ANTERIOR`, expiração da S-EMP-AUD-033) é obrigatória, não sugestão — sem ela o lead
  trava na etapa nova. Status: Draft → **Ready**.
- v0.1 (2026-09-05): @sm cria a story a partir do item 2 do planejamento do @dev, com as decisões
  do Junior (05/09) já travadas: fora do horário **não** pausa a IA nem enfileira; sequência
  avisar → perguntar → encerrar com cordialidade se negar; feriado fora de escopo; aviso de vaga/
  seleção nova mantido 24/7; janela **hardcoded**, não em `configuracoes` (reversão consciente da
  proposta original, para atender a regra "só vale com redeploy"). O ponto de fuso levantado pelo
  Junior foi verificado no banco de produção e está documentado no Item A — banco em UTC com
  `timestamptz`, que é o cenário correto; o cuidado real fica no código, com `-03:00` explícito.
  Status: Draft — aguardando validação do @po.
