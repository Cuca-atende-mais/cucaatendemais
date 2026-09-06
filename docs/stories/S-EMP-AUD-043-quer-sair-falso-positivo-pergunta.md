# S-EMP-AUD-043 — `quer_sair` falso-positivo encerra a conversa numa pergunta

**Status:** Ready for Review
**Epic:** Auditoria Empregabilidade
**Origem:** Achado adjacente da investigação @dev 2026-09-05 (mesma conversa que originou a
S-EMP-AUD-041) — `docs/2026-09-05/PLANO-3-melhorias-empregabilidade-2026-09-05.md`, §0 item 2.
Draft pedido pelo Junior em 05/09.
**Prioridade:** P1 | **Esforço:** S/M | **Risco:** MED — mexe no sinal de saída usado por
**5 pontos** do canal; endurecer demais deixa o lead preso, endurecer de menos mantém o bug.
**Depende de:** nada. **Não** conflita com as outras: toca regiões diferentes de
`empregabilidade_engine.py` (`:892`, `:1862`, `:5739`) e o prompt em `intencao_detector.py`.
Ainda assim, se for implementada junto da S-EMP-AUD-040/041, fazer em sequência, não em paralelo.
**Deploy:** redeploy do serviço **`cuca-worker`** no EasyPanel após o merge.

## Contexto

Mesma conversa real do "boxe" (canal Empregabilidade, 05/09/2026 13:57):

| Remetente | Mensagem |
|---|---|
| lead | "Bom dia, quando abre a vaga de boxe?" |
| agente | "No momento não há vagas para *boxe*. 😕 Você se interessa em deixar seu currículo no nosso Banco de Talentos?" |
| lead | **"Tem previsão pra abrir?"** |
| agente | "Boa sorte! Fique de olho nas mensagens da equipe CUCA. 🤝 Se precisar de mais alguma coisa, é só chamar. Até logo! 👋" |

A lead fez uma **pergunta sobre o assunto original** e foi despedida.

### Caminho rastreado no código

1. `:5827` — não achando vaga para o cargo, o bot grava a etapa **`oferta_banco_talentos`** e faz
   uma pergunta de sim/não;
2. "Tem previsão pra abrir?" não é sim nem não → o parser determinístico da etapa falha;
3. cai em `_escape_semantico_ou_none` (`:857`), que consulta `avaliar_mensagem_contextual`;
4. o classificador devolve `quer_sair=true` e a linha `:892` chama `_encerrar_fluxo` — **sem
   nenhuma corroboração adicional**.

### Por que o classificador erra aqui

O prompt (`intencao_detector.py:207`) define:

> `'quer_sair'`: true se o lead claramente quer encerrar/parar a conversa (despedida, **negativa
> de continuar, sem intenção de fazer outra coisa**)

Com `ultima_msg_bot` sendo uma **oferta de sim/não** ("quer deixar seu currículo?"), qualquer
mensagem que não seja "sim" tende a ser lida como "negativa de continuar" — inclusive uma pergunta
sobre o tema original. O contexto que deveria ajudar é justamente o que empurra o erro.

### Relação com a S-WM-70

É o **espelho** do defeito do Institucional, com causa **oposta** e em base de código diferente:
- **S-WM-70 (Deno/Institucional):** `quer_sair` **existe e não é lido** → o lead não consegue sair.
- **Esta (Python/Emprega+):** `quer_sair` **é lido sem corroboração e erra** → o lead sai sem querer.

As duas são independentes; nenhuma corrige a outra.

## O que precisa ser implementado

⚠️ **Step 1 é bloqueante e investigativo** — a story entra com a causa rastreada, mas **não** com a
solução escolhida. Não implementar o Step 2 antes do Step 1 estar registrado aqui.

### Step 1 (investigação, antes de codar): medir o alcance real

Levantar nos registros de produção quantas conversas foram encerradas com o texto de
`_encerrar_fluxo` ("Boa sorte! Fique de olho nas mensagens…" / a variante de empresa) quando a
mensagem anterior do lead **não** era despedida. Isso decide entre um ajuste barato e um mais
estruturado — e dá a linha de base para provar que a correção funcionou.

Também confirmar **quais dos 5 pontos** de consumo estão envolvidos de fato:
`_escape_semantico_ou_none:892`, `_quer_sair_semantico:1862` (3 call sites: `:3620`, `:3644`,
`:3716`, `:3930`) e o handler de menu livre `:5739`.

### ✅ Resultado do Step 1 (@dev, 2026-09-06) — registrado ANTES do Step 2

**Consulta read-only em produção** (`mensagens`/`conversas`, canal `Empregabilidade`), buscando
toda mensagem do agente com o texto de `_encerrar_fluxo` ("Boa sorte! Fique de olho…" ou a
variante de empresa) e comparando com a última mensagem do lead imediatamente anterior:

- **130 encerramentos** totais no canal (todo o histórico disponível).
- **2 falsos positivos confirmados**, ambos com o formato exato descrito na story — pergunta
  sobre o assunto original, não despedida: *"Tem previsão pra abrir?"* (o caso que originou a
  story) e *"E para operador de farmácia?"* (mesma classe de erro, empresa/cargo diferente).
  **Incidência: ~1,5% dos encerramentos** — baixa em volume, mas o padrão se repete (não é caso
  isolado) e o modo de falha é ruim (candidato a emprego é despedido no meio do atendimento).
- **1 candidato adicional descartado por não ser o defeito desta story**: um registro com
  `remetente='lead'` cujo conteúdo ("Deseja consultar outra candidatura ou encerrar?...") é,
  pelo teor, uma mensagem do **agente**, não do lead — indício de um problema de rotulagem em
  `mensagens.remetente` num ponto do funil de consulta de candidatura. **Fora de escopo desta
  story** (é outra causa raiz, num caminho diferente) — sinalizado como achado adjacente, não
  investigado a fundo aqui.
- **Varredura mais ampla** (excluindo despedidas óbvias — "tchau", "obrigad-", "não quero",
  "encerrar" etc.) mostrou um punhado de encerramentos precedidos por respostas curtas e
  ambíguas sem formato de pergunta ("Olá", "Ok", "2", "Obg") — não são o defeito desta story (não
  têm formato de pergunta, uma guarda de pergunta não os alcançaria) e não há evidência suficiente
  aqui pra afirmar que são falso-positivo (podem ser desengajamento real captado corretamente
  pelo classificador). **Registrado como observação para o futuro, não como pendência desta
  story** — se o Junior quiser investigar esse padrão separadamente, é outro levantamento.
- **Confirmação dos pontos de consumo:** o código real tem **3 lugares** que leem `quer_sair`
  diretamente (não 5 — a story contava call sites dos dois helpers, não locais de leitura):
  `_escape_semantico_ou_none` (compartilhado por ~14 call sites), `_quer_sair_semantico`
  (compartilhado por ~8 call sites) e o fallback semântico de `menu_inicial` (1 local). Colocar a
  guarda **dentro** dos dois helpers cobre todos os call sites deles de uma vez — não precisa
  tocar cada um individualmente.

**Decisão de escopo (Step 1 → Step 2):** volume baixo (~1,5%) justifica a abordagem **(a)**
(guarda determinística de pergunta) sozinha — barata, e cobre os dois casos reais confirmados com
precisão. **(b)** (endurecer o prompt) fica de fora por ora: o volume não justifica o custo/risco
de mexer no classificador compartilhado por todo o canal sem evidência de que (a) sozinha seja
insuficiente. **(c)** (confirmar antes de encerrar) também fica de fora: adicionaria atrito em
**todo** encerramento (os 98,5% corretos) pra proteger um caso de baixa incidência que (a) já
resolve sem esse custo.

### Step 2: implementar o caminho decidido no Step 1

Três abordagens avaliadas pelo @sm, **para o @dev escolher com o dado do Step 1** — não estão em
ordem de preferência fixa:

- **(a) Guarda determinístico de pergunta.** Mensagem terminada em `?` (ou iniciada por
  interrogativo — "tem", "quando", "como", "qual", "onde", "quanto") **não** encerra, mesmo com
  `quer_sair=true`. É o mais barato e pega o caso real exato. Risco: "posso encerrar?" e
  "tem como parar?" são perguntas que **querem** sair.
- **(b) Endurecer o prompt.** Reescrever a definição de `quer_sair` para exigir despedida ou
  recusa explícita, e instruir que **pergunta sobre o assunto nunca é `quer_sair`**. Mais próximo
  da causa, mas depende do comportamento do modelo — precisa de evidência, não de suposição.
- **(c) Confirmar antes de encerrar.** Em vez de despedir direto, perguntar ("posso encerrar por
  aqui?"). Mais seguro, mas adiciona uma volta na conversa em **todo** encerramento, inclusive nos
  corretos — atrito no caso comum para proteger o caso raro.

**Recomendação do @sm:** (a) + (b) juntos, se o Step 1 mostrar que o volume justifica; (c) só se os
dois primeiros não segurarem. Mas a decisão é do @dev com o dado na mão.

**Não confundir com encerramento legítimo:** `_quer_encerrar` (`:740`, determinístico, lista de
palavras) continua valendo e **não** é alvo desta story — quem erra é o caminho semântico.

## Acceptance Criteria

1. "Tem previsão pra abrir?", na etapa `oferta_banco_talentos`, **não** encerra a conversa.
2. **A conversa também não fica presa** (AC adicionado pelo @po — ver achado abaixo): a mensagem
   que deixa de encerrar precisa ter um destino definido. O @dev escolhe **um** e registra:
   - responder a pergunta e reapresentar a oferta de forma variada (não repetir o texto igual), ou
   - incluir `oferta_banco_talentos` em `_ETAPAS_OFERTA_ATENDENTE`, deixando a escalada por
     falhas repetidas atuar como saída, ou
   - reencaminhar ao menu principal após a 2ª falha na mesma etapa.

   ⚠️ **Achado @po, confirmado no código:** `oferta_banco_talentos` **não está** em
   `_ETAPAS_OFERTA_ATENDENTE` (`:117-124`). Hoje, `quer_sair` é o **único** jeito de sair dessa
   etapa quando o lead não responde sim/não. Remover esse caminho sem criar outro converte
   "encerra cedo demais" em **"loop infinito"** — exatamente o defeito que a S-WM-70 está
   corrigindo do outro lado. Este AC existe para impedir a troca de um bug pelo outro.
3. Despedida genuína continua encerrando: "tchau", "obrigado, era só isso", "não quero mais",
   "deixa pra lá" — o lead não pode ficar preso.
4. Pergunta que **de fato** quer sair continua encerrando: "posso encerrar?", "dá pra parar por
   aqui?" — o guarda não pode ser cego ao sentido.
5. O resultado do **Step 1** (alcance medido + pontos de consumo confirmados) está registrado nesta
   story **antes** do Step 2 ser implementado.
6. **Não regride:** `_quer_encerrar` (determinístico) mantém o comportamento atual.
7. **Não regride:** os outros sinais do classificador — `mudou_de_assunto`,
   `quer_atendente_humano`, `quer_voltar`, `cargo_mencionado` — não mudam de comportamento.
8. **Não regride:** os 5 pontos de consumo de `quer_sair` seguem funcionando; nenhum deles fica
   sem caminho de saída.
9. Se a solução escolhida mexer no prompt: os 6 cenários de regressão da S-EMP-01-01 e os casos da
   S-WM-20 Task 5 continuam passando — o classificador é compartilhado, não é peça isolada.

## Escopo

**In:** os 9 ACs acima — Step 1 (investigação) e Step 2 (correção escolhida), em
`worker/empregabilidade_engine.py` e/ou `worker/intencao_detector.py` + testes.
**Out:**
- o bug simétrico do Institucional (S-WM-70) — outra base de código, causa oposta;
- rever a etapa `oferta_banco_talentos` em si (ela faz uma pergunta de sim/não legítima; o
  problema não é a pergunta);
- substituir o classificador ou remover as `KEYWORDS_*` legadas (fase contract, já adiada de
  propósito em `intencao_detector.py`);
- o redirecionamento institucional da mesma conversa (S-EMP-AUD-041) — **nota:** com a
  S-EMP-AUD-041 no ar, "vaga de boxe" nem chega neste caminho. Isso **reduz** a incidência, mas
  **não corrige** o defeito: qualquer outra pergunta após uma oferta de sim/não cai no mesmo lugar.

## ⚠️ Análise de impacto — por item

### Item 1 — Step 1 (investigação)

- **Toca:** nenhuma mudança de código — só leitura de `mensagens`/`conversas` em produção,
  read-only.
- **Consome hoje:** define se a correção é barata ou estruturada, e dá a linha de base do "antes".
- **Impacto observável:** nenhum ainda.
- **De-risk concreto:** medir antes de escolher — o @dev não deve estimar o volume por intuição.

### Item 2 — Correção no caminho de `quer_sair`

- **Toca:** conforme a escolha — `_escape_semantico_ou_none:892`, `_quer_sair_semantico:1862`,
  o handler de menu `:5739`, e/ou o prompt em `intencao_detector.py:207`.
- **Consome hoje:** **5 pontos** do canal. Se a mudança for no prompt, o alcance é maior ainda:
  `avaliar_mensagem_contextual` é o classificador **primário** de todo o Emprega+, e mexer na
  definição de um campo pode deslocar os outros cinco campos do mesmo JSON.
- **Impacto observável:** lead que faz pergunta deixa de ser despedido no meio do atendimento.
- **Risco (o principal desta story):** **prender o lead**. Um guarda largo demais faz o "não, era
  só isso?" deixar de encerrar, e o lead fica preso num fluxo do qual não consegue sair — que é
  exatamente o defeito que a S-WM-70 está corrigindo do outro lado. AC2, AC3 e AC4 existem para
  travar isso e são obrigatórios.
- **De-risk concreto:** os casos do AC2/AC3 como teste automatizado, não conferência manual.
  `pytest worker/tests/test_empregabilidade_engine.py` verde antes e depois. Se mexer no prompt,
  AC8 exige rodar os cenários de regressão herdados.

### Item 3 — Interação com a S-EMP-AUD-041

- **Toca:** nada em comum no código.
- **Impacto observável:** a S-EMP-AUD-041 desvia o caso "boxe" antes deste caminho, o que pode
  **mascarar** o defeito em teste manual e dar falsa sensação de resolvido.
- **De-risk concreto:** os testes desta story devem usar um cenário que **não** dependa de
  modalidade esportiva (ex.: cargo real inexistente + pergunta de acompanhamento), para não
  medirem o efeito da outra story.

## Test plan

- `pytest worker/tests/test_empregabilidade_engine.py` — suíte existente **verde antes e depois**.
- Caso real do AC1, reproduzido na etapa `oferta_banco_talentos`.
- **Casos negativos obrigatórios (AC3/AC4):** despedidas genuínas seguem encerrando; perguntas que
  querem sair seguem encerrando.
- Se o prompt mudar: cenários de regressão da S-EMP-01-01 e da S-WM-20 Task 5 (AC9).
- Consulta read-only em produção para o Step 1 e para comparar o "antes/depois".
- ⚠️ **Sem navegador, sem localhost** (`qa-testes-sem-navegador-ao-vivo.md`).

## File List

- `worker/empregabilidade_engine.py`:
  - `_PADRAO_PERGUNTA_ASSUNTO` / `_PADRAO_PERGUNTA_DE_SAIDA` / `_pergunta_generica_nao_e_saida`
    (Step 2, abordagem (a)) — guarda determinística nova, colocada perto de `_encerrar_fluxo`.
  - `_escape_semantico_ou_none`: `if sem["quer_sair"]:` → `if sem["quer_sair"] and not
    _pergunta_generica_nao_e_saida(texto):` — único ponto de mudança na função, nenhuma outra
    linha tocada.
  - `_quer_sair_semantico`: mesma mudança, mesmo padrão.
  - Fallback semântico de `menu_inicial` (dentro de `_processar_menu_inicial`): mesma mudança —
    3º ponto de consumo direto de `quer_sair`, encontrado durante a implementação (ver Dev Agent
    Record).
  - Etapa `oferta_banco_talentos`: achado crítico durante a implementação — a guarda sozinha
    **não bastava** aqui, porque esta etapa tem um segundo `_encerrar_fluxo` incondicional logo
    depois de `_escape_semantico_ou_none` retornar `False` ("Recusa ou mensagem ambígua →
    encerramento"). Adicionado um segundo check da mesma guarda nesse ponto específico, com
    reoferta do banco de talentos em texto variado em vez de encerrar (AC2, opção (a) da story).
- `worker/tests/test_empregabilidade_engine.py`: 31 testes novos, em 5 classes —
  `TestOfertaBancoTalentos` (6 testes adicionados à classe existente: AC1/AC2/AC3/AC4, incluindo
  a prova de que um "sim" na mensagem seguinte à guarda continua funcionando),
  `TestPerguntaGenericaNaoESaida` (unitários da guarda pura: positivos, negativos-de-saída,
  despedida direta, case-insensitive), `TestEscapeSemanticoOuNoneGuardaPergunta` (inclui prova de
  que `quer_atendente_humano` não é afetado pela guarda — AC7), `TestQuerSairSemanticoGuardaPergunta`,
  `TestMenuInicialGuardaPergunta` (3º ponto de consumo).

## Dev Agent Record

- **Step 1 executado e registrado ANTES do Step 2**, conforme a story exige (AC5) — ver seção
  "Resultado do Step 1" acima, com os números reais (130 encerramentos, 2 falsos positivos
  confirmados ~1,5%, 1 candidato descartado por ser outro defeito, decisão de escopo justificada
  pelo volume medido, não por intuição.
- **Achado — a story contava "5 pontos" como call sites, não como locais de leitura de
  `quer_sair`:** o código real tem só **3 lugares** que leem `sem["quer_sair"]` diretamente
  (`_escape_semantico_ou_none`, `_quer_sair_semantico`, fallback de `menu_inicial`) — os dois
  helpers são compartilhados por ~14 e ~8 call sites respectivamente, que a story provavelmente
  estava contando ao citar `:3620`, `:3644`, `:3716`, `:3930`. Colocar a guarda dentro dos
  helpers cobre todos os call sites deles de uma vez, sem precisar tocar cada um.
- **Achado crítico — `oferta_banco_talentos` tinha um segundo encerramento incondicional que a
  guarda nos helpers não alcançava:** rastreei o call site real (não assumi que corrigir
  `_escape_semantico_ou_none` bastava) e vi que, quando essa função retorna `False` (sem sinal
  claro), a etapa `oferta_banco_talentos` tem seu próprio fallback: "Recusa ou mensagem ambígua →
  única despedida e encerramento" — um SEGUNDO `_encerrar_fluxo`, incondicional, logo depois. Se
  eu tivesse corrigido só os helpers, o caso real do AC1 ("Tem previsão pra abrir?") continuaria
  encerrando exatamente como antes, só que passando pelo segundo gate em vez do primeiro — a
  correção teria sido um no-op para o bug relatado. Corrigido com um segundo check da mesma
  guarda nesse ponto específico, com reoferta do banco de talentos (AC2).
- **Terceiro ponto de consumo de `quer_sair` encontrado durante a implementação, não estava nos
  dois helpers mapeados pela story:** o fallback semântico de `menu_inicial` (primeira mensagem
  não reconhecida por dígito/keyword) também lê `sem_menu["quer_sair"]` direto, fora dos dois
  helpers. Corrigido com a mesma guarda, por completude (AC8).
- **AC9 não se aplica:** a solução escolhida (abordagem (a)) não mexeu no prompt do classificador
  (`intencao_detector.py`) — só código determinístico no worker. Os cenários de regressão da
  S-EMP-01-01/S-WM-20 Task 5 não precisam ser re-executados porque nada que os afeta mudou.
- **Testes:** `pytest worker/tests/test_empregabilidade_engine.py` — 360 → 391 (31 novos), 0
  falhas, em todas as rodadas.
- **Ruff não disponível neste ambiente** (mesma limitação já registrada nas stories anteriores da
  leva) — sintaxe validada via `python3 -c "import ast; ast.parse(...)"`.
- **Worktree:** implementado em `/home/valmir/Documentos/cucaatendemais-s-emp-aud-043` (`git
  worktree`), branch `fix/s-emp-aud-043-quer-sair-falso-positivo-pergunta`, a partir de
  `origin/main` já com S-EMP-AUD-040/041/042 mergeadas.
- **Sem navegador/localhost usado** (`qa-testes-sem-navegador-ao-vivo.md`) — validação só por
  consulta read-only em produção (Step 1) e testes automatizados (Step 2), conforme o test plan
  da própria story já previa.

## QA Results

### Review em 2026-09-06 — @qa Quinn

**Gate: PASS**

**7 checks:**

1. **Code review** — PASS. Li o diff completo. A guarda entra em exatamente 4 pontos —
   `_escape_semantico_ou_none`, `_quer_sair_semantico`, o fallback de `menu_inicial` e o segundo
   gate de `oferta_banco_talentos` — sempre como `and not _pergunta_generica_nao_e_saida(texto)`
   ou um `if` isolado antes do encerramento existente, nunca reescrevendo lógica ao redor.
   Confirmei que `_quer_encerrar` (determinístico) não é tocado em nenhuma linha do diff — grep
   próprio, zero ocorrências.
2. **Testes** — PASS. Rodei a suíte de forma independente: **391/391**. Contei via
   `pytest --collect-only`: 35 testes nas 5 classes tocadas, 4 já existiam antes — bate exato com
   os "31 novos" declarados.
3. **Acceptance Criteria** — PASS, 9/9 verificados por mim (AC9 corretamente marcado N/A, já que
   o prompt do classificador não foi tocado — confirmei isso também, zero menção a
   `intencao_detector.py` no diff):
   - AC1 ✅ reproduzi "Tem previsão pra abrir?" na etapa `oferta_banco_talentos` — não encerra.
   - AC2 ✅ a lead não fica presa: testei eu mesma que um "sim" na mensagem seguinte à guarda
     continua funcionando pelo fast-path normal da etapa, sem precisar de nenhum destino novo.
   - AC3 ✅ despedidas diretas sem formato de pergunta ("tchau", "obrigado, era só isso") não
     batem no padrão da guarda — confirmado com script próprio, não só nos testes do @dev.
   - AC4 ✅ "posso encerrar?" e "dá pra parar por aqui?" continuam encerrando — reproduzido
     também num script independente, nas 3 camadas afetadas (`_escape_semantico_ou_none`,
     `_quer_sair_semantico`, `oferta_banco_talentos`).
   - AC5 ✅ Step 1 registrado na story **antes** do Step 2 — reexecutei a consulta read-only do
     Step 1 eu mesma, de forma independente: mesmos 2 falsos positivos confirmados, mesmo caso
     descartado (mensagem do agente rotulada como lead). O total de encerramentos subiu de 130
     para 142 entre a consulta do @dev e a minha — natural, é produção viva, não um dataset
     congelado; os casos específicos batidos são idênticos.
   - AC6 ✅ `_quer_encerrar` não aparece em nenhuma linha do diff.
   - AC7 ✅ as linhas de `quer_atendente_humano`, `quer_voltar` e `mudou_de_assunto` em
     `_escape_semantico_ou_none` não foram tocadas — só a linha de `quer_sair` mudou. Testei
     `quer_atendente_humano` eu mesma com um texto em formato de pergunta, pra confirmar que a
     guarda não vaza pra esse branch.
   - AC8 ✅ os 3 pontos reais de leitura de `quer_sair` (não 5 — achado do @dev, que confirmei)
     estão todos cobertos.
   - AC9 ✅ N/A, confirmado — prompt não tocado.
4. **Sem regressões** — PASS. 391/391, nenhum teste pré-existente precisou de ajuste.
5. **Performance** — PASS. Regex compilada uma vez, sem I/O adicional.
6. **Segurança** — PASS. Nenhum dado sensível envolvido; guarda opera só sobre o texto já
   recebido do lead.
7. **Documentação** — PASS. File List e Dev Agent Record batem com o diff real; os dois achados
   (segundo gate em `oferta_banco_talentos`, 3º ponto de consumo) são precisos e foram o que
   guiou minha verificação do AC2/AC8.

**Achado próprio, não bloqueante:** testei um caso de fronteira que a suíte do @dev não cobria —
frases que **começam** com uma palavra interrogativa ("tem", "quando", "como") mas são
**afirmações**, não perguntas, e **sem** `?` no fim (ex.: `"tem que ser hoje mesmo"`,
`"como assim, não quero mais nada disso"`). A guarda as classifica como "pergunta protegida"
mesmo sem interrogação — teoricamente isso poderia impedir um encerramento legítimo se o
classificador disparasse `quer_sair=true` para uma frase assim. **Busquei essa exata forma nos
142 encerramentos de produção** (frase sem `?` começando com uma das palavras do padrão) — **zero
ocorrências históricas**. É um risco de desenho real, mas sem evidência de que já aconteceu ou
vá acontecer com frequência relevante — registro para consciência futura (poderia exigir "OU
termina em `?` OU tem outro sinal de interrogação" mais estrito), não como bloqueio agora.

**Nenhum item bloqueia o avanço.** Recomendo seguir para @devops.

## Change Log

- v0.4 (2026-09-06): @qa revisa — **PASS**, 7/7 checks, 9/9 ACs (AC9 corretamente N/A) confirmados
  por verificação independente (suíte rodada de novo: 391/391; Step 1 reexecutado
  independentemente, mesmos casos batidos; AC4 reproduzido nas 3 camadas afetadas). 1 achado
  próprio, não bloqueante: a guarda protege frases que começam com palavra interrogativa mesmo
  sem `?` — risco de desenho real, mas zero ocorrência nos 142 encerramentos históricos
  verificados. Status: InReview → **Ready for Review** (aguardando @devops).
- v0.3 (2026-09-06): @dev executa o Step 1 (bloqueante) e registra o resultado ANTES de
  implementar o Step 2, conforme a story exige. Volume medido (~1,5%, 2 casos confirmados)
  justificou a abordagem (a) sozinha — guarda determinística de pergunta — descartando (b) e (c)
  por ora. Implementação encontrou 2 achados que a story não previa: (1) `oferta_banco_talentos`
  tinha um segundo `_encerrar_fluxo` incondicional que a guarda nos helpers compartilhados não
  alcançava — corrigido com um segundo check no ponto específico; (2) um 3º local de leitura
  direta de `quer_sair` (fallback de `menu_inicial`) não mapeado pela story — corrigido por
  completude. Suíte 360→391 (31 novos), 0 falhas. AC9 não se aplica (prompt não foi tocado).
  Status: Ready → **InReview** (aguardando @qa).
- v0.2 (2026-09-05): @po valida — **GO** (8/10, com 1 correção aplicada antes do GO). Lacuna: os
  ACs definiam só o **negativo** ("não encerra") sem dizer para onde a mensagem vai. Fui conferir e
  achei o agravante: `oferta_banco_talentos` **não está** em `_ETAPAS_OFERTA_ATENDENTE` (`:117`),
  então `quer_sair` é hoje a **única** saída dessa etapa para quem não responde sim/não — a
  correção, como estava escrita, trocaria "encerra cedo" por "loop infinito". AC2 novo adicionado
  com três caminhos possíveis para o @dev escolher e registrar. Mantido o Step 1 bloqueante: é a
  story com maior chance de a correção ser pior que o defeito, e medir antes é barato.
  Status: Draft → **Ready**.
- v0.1 (2026-09-05): @sm cria a story a pedido do Junior, a partir do achado adjacente registrado
  pelo @dev na investigação do "boxe". A story entra com o **caminho rastreado** (`:5827` →
  `_escape_semantico_ou_none:892` → `_encerrar_fluxo`) e a causa provável identificada no prompt
  (`intencao_detector.py:207`, "negativa de continuar" lida contra uma oferta de sim/não), mas
  **deliberadamente sem solução fechada**: as 3 abordagens estão descritas com trade-off, e o
  Step 1 (medir o alcance) é bloqueante antes de escolher — não faz sentido endurecer um sinal
  compartilhado por 5 pontos do canal sem saber o tamanho do problema. O risco de "prender o
  lead" — o defeito espelhado que a S-WM-70 corrige — virou AC obrigatório (AC2/AC3), não
  observação. Status: Draft — aguardando validação do @po.
