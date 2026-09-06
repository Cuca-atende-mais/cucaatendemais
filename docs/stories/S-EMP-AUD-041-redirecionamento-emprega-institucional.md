# S-EMP-AUD-041 — Redirecionamento Emprega+ → Institucional (Cuca Atende+)

**Status:** Ready for Review
**Epic:** Auditoria Empregabilidade
**Origem:** Demanda direta do Junior 2026-09-05 —
`docs/2026-09-05/PLANO-3-melhorias-empregabilidade-2026-09-05.md`, item 1.
**Prioridade:** P1 | **Esforço:** S | **Risco:** MED — o modo de falha não é quebrar, é
**misdirecionar**: mandar quem procura emprego para o Institucional é pior que o bug original.
**Depende de:** ordem definida pelo Junior — vem depois da S-EMP-AUD-040 **e os dois tocam
`worker/empregabilidade_engine.py`**. Não implementar em paralelo: conflito garantido.
**Deploy:** redeploy do serviço **`cuca-worker`** no EasyPanel após o merge.

## Contexto

O Institucional já sabe encaminhar para o Emprega+ quando o lead pergunta de vagas. **O inverso
não existe** — leads perguntando de oficina/turma dentro do Emprega+ são tratados como candidatos
a emprego.

Conversa real, canal Empregabilidade, 05/09/2026 13:57:

| Remetente | Mensagem |
|---|---|
| lead | "Bom dia, quando abre a vaga de boxe?" |
| agente | "No momento não há vagas para *boxe*. 😕 Você se interessa em deixar seu currículo no nosso Banco de Talentos?" |
| lead | "Tem previsão pra abrir?" |
| agente | "Boa sorte! Fique de olho nas mensagens da equipe CUCA. 🤝 ... Até logo! 👋" |

Mesma família de assunto aparece em outras conversas do canal: "E amanhã vai ter aula", "curso
gratuito... teste de conhecimento".

### Causa rastreada — NÃO é keyword

O classificador LLM (`avaliar_mensagem_contextual`) devolveu `intencao=candidato_vaga` +
`cargo_mencionado="boxe"`; o branch de `cargo_mencionado` (`empregabilidade_engine.py:5798`,
feature S-EMP-AUD-030 "tem vaga de enfermeira?") buscou "boxe" nos títulos de vaga, não achou, e
emitiu a linha exata acima (`:5824`).

`IntencaoDetector.KEYWORDS_VAGA` **não participa** — o docstring de `intencao_detector.py` registra
que keywords deixaram de ser consultadas antes do LLM (são fallback/legado à espera da fase
contract). **Isso define o ponto de inserção: dentro do branch `candidato_vaga`, imediatamente
antes de `if cargo_mencionado:` na linha 5798.**

### Padrão a espelhar (já em produção, do outro lado)

`supabase/functions/motor-agente/index.ts:157-232` — o Institucional monta a mensagem de
encaminhamento **inteiramente a partir de código + config, nunca do texto do GPT**:
`montarMensagemEncaminhamento` sanitiza o número para só dígitos e, se a config faltar, cai no
texto `semNumero` — nunca gera `wa.me/None`. Copiar essa estrutura defensiva, não inventar outra.

## O que precisa ser implementado

### Item A — Chave `institucional` em `configuracoes.numeros_canais_cuca`

Migration **idempotente** que faz **merge** da chave nova, sem sobrescrever o objeto:

- número do Cuca Atende+ = **`5585999401027`**;
- ⚠️ **CONFERIR DÍGITO A DÍGITO:** os dois números diferem em **um** dígito —
  Emprega+ `55859994010`**`57`** × Institucional `55859994010`**`27`**. Trocá-los inverteria os
  dois sentidos de redirecionamento de uma vez, e o erro seria sutil (o link funciona, só leva ao
  canal errado);
- usar merge (`valor || jsonb_build_object(...)`), **nunca** substituir o objeto: `motor-agente`
  lê esse mesmo JSON, e um `UPDATE` cheio apagaria os números existentes;
- estado atual conferido em produção: `{"empregabilidade":"5585999401057","acesso_cuca":null,"ouvidoria":null,"academia_enem":null}`.

### Item B — Pré-filtro determinístico `_assunto_institucional`

No worker, **antes** de `if cargo_mencionado:` (`:5798`), dentro do branch `candidato_vaga`.

**Lista fechada e ESTREITA** — só nomes de atividade que nunca nomeiam um cargo no CUCA:
`boxe, judô/judo, capoeira, natação/natacao, muay thai, jiu-jitsu, ballet, vôlei/volei, futsal,
skate, grafite, zumba`.

Match por **palavra inteira** (`(?<!\w)termo(?!\w)`) — mesmo princípio do `contemPalavra` do
motor-agente.

### ✅ PERGUNTA DE NEGÓCIO — RESPONDIDA (Junior, 2026-09-05): **não há vaga de oficineiro**

A Rede CUCA contrata **oficineiros/instrutores** para essas mesmas modalidades? Se sim,
*"tem vaga de capoeira?"* pode significar **duas** coisas opostas: "quero me matricular na turma"
(→ Institucional) ou "quero trabalhar como instrutor de capoeira" (→ Emprega+). A lista estreita
não distingue as duas, e redirecionaria as duas.

**Evidência levantada:** das **31 vagas** hoje na base, **nenhuma** tem título de
professor/instrutor/oficineiro/monitor/educador de modalidade. Isso **sustenta** a lista — mas 31
é amostra pequena, e as vagas vêm de empresas parceiras, não do próprio CUCA.

**Resposta do Junior (05/09): a Rede CUCA não divulga vaga de oficineiro/instrutor neste canal.**
A ambiguidade não existe na prática — **a lista fica como está**, sem marcadores de ocupação. Isso
alinha com a evidência da base (31 vagas, nenhuma de instrutor/oficineiro).

📌 **Registrado para o futuro, não para agora:** se um dia a Rede passar a divulgar vaga de
oficineiro/instrutor no Emprega+, esta lista precisa ser revista — "tem vaga de capoeira?" volta a
ser ambíguo. A mitigação já mapeada seria não redirecionar quando a frase contiver marcador de
ocupação (`professor`, `instrutor`, `oficineiro`, `monitor`, `educador`, `treinador`,
`trabalhar como`). **Não implementar agora** — é premissa a revisitar, não código pendente.

**Termos ambíguos ficam DE FORA, deliberadamente:** `curso, aula, turma, academia, oficina,
matrícula, atestado, quadra, evento, projeto`. Uma lista larga com "excludente de contexto" foi
avaliada e **descartada pelo @dev** porque não separa "vaga de boxe" de "vaga de auxiliar de
**academia**" — as duas frases têm a mesma forma, e "**curso** técnico exigido na vaga" é pedido
legítimo de emprego. Esses casos continuam com o classificador LLM, como hoje. **Falso positivo
aqui é pior que o bug original.**

### Item C — Mensagem montada só de código + config

- com número → texto explicando o canal + `wa.me/<institucional>` (número **sanitizado para só
  dígitos**);
- sem número (config ausente/malformada) → texto que explica o canal **sem link**, nunca
  `wa.me/None`;
- depois de redirecionar, **oferecer voltar ao menu do Emprega+** — não encerrar seco. É o mesmo
  cuidado de tom das outras stories desta leva.

**Custo em escala:** regex em memória, sem I/O e sem chamada de LLM adicional — importa pelo volume
de acessos previsto. O número pode ser lido com cache em processo (TTL curto) para evitar um
`SELECT` por mensagem redirecionada.

## Acceptance Criteria

1. "Bom dia, quando abre a vaga de boxe?" → resposta de redirecionamento ao Cuca Atende+, **não**
   a oferta de Banco de Talentos.
2. As demais frases de modalidade da lista fechada redirecionam da mesma forma.
3. **Não redireciona (caso negativo obrigatório):** "vaga de auxiliar de academia", "curso técnico
   exigido na vaga", "atestado pra admissão" — seguem no fluxo de emprego, como hoje.
4. A mensagem final é construída **só** a partir de código + config; o número aparece sanitizado
   (só dígitos) e é exatamente `5585999401027`.
5. Config ausente/malformada → texto sem link, nunca `wa.me/None` nem link quebrado.
6. Depois do redirecionamento o lead recebe a opção de voltar ao menu do Emprega+.
7. O pré-filtro **só** roda em mensagem livre no branch `candidato_vaga` — nunca dentro de etapa
   de coleta de dado (nome, e-mail, CNPJ, telefone), onde um valor legítimo não pode ser
   reinterpretado.
8. **Não regride:** a feature `cargo_mencionado` (S-EMP-AUD-030) continua funcionando para cargos
   reais — "tem vaga de enfermeira?" segue listando/respondendo como hoje.
9. A migration é idempotente e **preserva** as chaves existentes de `numeros_canais_cuca`
   (`empregabilidade` continua `5585999401057`).
10. Nenhum comportamento muda em tempo real: gravar a chave nova é **inerte** até o redeploy, já
    que o código do worker que a lê não existe antes disso (e `motor-agente` nunca consulta a chave
    `institucional`).

## Escopo

**In:** os 10 ACs acima — migration da chave, helper de pré-filtro, montagem da mensagem e retorno
ao menu, em `worker/empregabilidade_engine.py` + testes.
**Out:**
- a regra opcional de "objeto" (`vaga/turma/aula/curso **de** <termo>`), que ampliaria a cobertura
  ao custo de mais regex — **não incluída**; se o Junior quiser depois, é incremento;
- os termos ambíguos (`curso`, `academia`, `oficina`…) — decisão consciente, não esquecimento;
- o bug do "Tem previsão pra abrir?" (`quer_sair` numa pergunta) visto na **mesma** conversa —
  causa diferente, story própria ainda não criada;
- preencher `acesso_cuca`, `ouvidoria`, `academia_enem` em `numeros_canais_cuca` (seguem `null`).

## ⚠️ Análise de impacto — por item

### Item A — Chave `institucional` na config

- **Toca:** uma linha de `configuracoes` (chave `numeros_canais_cuca`) no banco `cuca` (produção).
- **Consome hoje:** `motor-agente/index.ts::buscarNumeroCanal` lê **esse mesmo JSON** para os 4
  canais de encaminhamento do Institucional.
- **Impacto observável:** nenhum no Institucional, **desde que** a migration faça merge. Um
  `UPDATE` que troque o objeto inteiro derrubaria o encaminhamento Institucional → Emprega+ que
  hoje funciona (visível na própria conversa da S-WM-70).
- **De-risk concreto:** `execute_sql` read-only **antes e depois**, conferindo que
  `empregabilidade` continua `5585999401057` **e** que `institucional` gravou `5585999401027` —
  os dois, dígito a dígito.

### Item B — Pré-filtro antes de `cargo_mencionado`

- **Toca:** `worker/empregabilidade_engine.py:5789-5798`.
- **Consome hoje:** todo lead classificado como `candidato_vaga`. A feature S-EMP-AUD-030
  (`cargo_mencionado`) é quem produz a resposta errada do "boxe"; o pré-filtro entra na frente dela
  e **nada mais no branch muda**.
- **Impacto observável:** lead de modalidade esportiva recebe o contato do Institucional em vez de
  ser puxado pro Banco de Talentos.
- **Risco:** falso positivo mandaria candidato a emprego pro canal errado. Mitigado pela lista
  estreita — nenhum cargo no CUCA se chama "boxe" ou "capoeira" — e pelo AC3, que fixa os três
  casos negativos como teste obrigatório, não como observação.
- **De-risk concreto:** teste unitário com as frases reais do banco como positivo **e** os três
  falsos positivos como negativo. `pytest worker/tests/test_empregabilidade_engine.py`.

### Item C — Montagem da mensagem

- **Toca:** função nova de montagem no worker.
- **Consome hoje:** ninguém — código novo. Espelha `montarMensagemEncaminhamento` (Deno), que já
  roda em produção com essa estrutura defensiva.
- **Impacto observável:** o lead recebe um link válido ou nenhum link — nunca um link quebrado.
- **Risco:** número mal formatado no banco geraria link inválido. Mitigado pela sanitização e pelo
  fallback `semNumero` (AC5), copiados do original.
- **De-risk concreto:** teste com config `null`, string vazia e número com máscara
  (`(85) 99940-1027`) — os três têm que produzir saída válida.

### Item D — Conflito com a S-EMP-AUD-040

- **Toca:** o mesmo arquivo (`worker/empregabilidade_engine.py`) que a story anterior.
- **Impacto observável:** nenhum funcional — é risco de processo. As duas stories editam regiões
  diferentes (`:654` vs `:5798`), mas implementá-las em paralelo, em branches separadas, gera
  conflito de merge e retrabalho.
- **De-risk concreto:** respeitar a ordem definida pelo Junior — S-EMP-AUD-040 primeiro, esta
  depois, com rebase na base já atualizada.

## Test plan

- `pytest worker/tests/test_empregabilidade_engine.py` — suíte existente **verde antes e depois**
  (AC8 é o risco maior de regressão).
- Positivos: as frases reais do banco + a lista fechada de modalidades (AC1, AC2).
- **Negativos obrigatórios:** "vaga de auxiliar de academia", "curso técnico exigido na vaga",
  "atestado pra admissão" (AC3).
- Montagem da mensagem: com número, sem número, número mascarado (AC4, AC5).
- Etapa de coleta de dado: mensagem contendo "boxe" durante `coletando_email_responsavel` **não**
  redireciona (AC7).
- Banco: `SELECT` de `numeros_canais_cuca` antes e depois da migration (AC9).
- ⚠️ **Sem navegador, sem localhost** (`qa-testes-sem-navegador-ao-vivo.md`).

## File List

- `supabase/migrations/20260906000000_s_emp_aud_041_numero_institucional_canal.sql` — Item A,
  migration idempotente (`INSERT ... ON CONFLICT DO UPDATE` com merge via `||`).
- `worker/empregabilidade_engine.py`:
  - `_MODALIDADES_INSTITUCIONAL` (tupla) e `_MODALIDADES_INSTITUCIONAL_REGEX` — lista fechada
    do Item B, match por palavra inteira.
  - `_assunto_institucional(texto)` — Item B, pré-filtro determinístico.
  - `_TTL_CACHE_NUMERO_INSTITUCIONAL_SEGUNDOS` / `_CACHE_NUMERO_INSTITUCIONAL` /
    `_buscar_numero_institucional()` — Item A/C, leitura com cache em processo (TTL 300s) e
    fallback seguro (nunca propaga exceção).
  - `_MSG_INSTITUCIONAL_COM_NUMERO` / `_MSG_INSTITUCIONAL_SEM_NUMERO` /
    `_montar_mensagem_institucional(numero)` — Item C, montagem só a partir de código + config,
    espelhando `montarMensagemEncaminhamento` (motor-agente).
  - Branch `candidato_vaga` (`_rotear_por_intencao`): chamada a `_assunto_institucional` inserida
    imediatamente antes de `if cargo_mencionado:` — nenhuma outra linha do branch alterada.
- `worker/tests/test_empregabilidade_engine.py`: 39 testes novos, em 4 classes —
  `TestAssuntoInstitucional` (AC1/AC2/AC3), `TestMontarMensagemInstitucional` (AC4/AC5/AC6),
  `TestBuscarNumeroInstitucional` (cache/fallback), `TestRotaCandidatoVagaAssuntoInstitucional`
  (fiação completa via `_rotear_por_intencao`, incluindo AC7 estrutural e AC8 de não-regressão).

## Dev Agent Record

- **Linhas da story estavam desatualizadas, ponto de inserção confirmado por grep:** a story
  referenciava `:5798`/`:5824`; o arquivo já tinha crescido por causa da S-EMP-AUD-040 (mesmo
  arquivo, implementada antes, conforme a ordem definida pelo Junior). Confirmei o ponto real via
  `grep -n cargo_mencionado` — o branch `candidato_vaga` estava em `:5951-5962` no momento da
  implementação. A lógica descrita (inserir antes de `if cargo_mencionado:`) continua válida
  literalmente, só o número da linha mudou.
- **Cache de config: não havia padrão pronto pra reusar, segui o padrão mais próximo do arquivo:**
  o worker não tem nenhuma leitura cacheada de `configuracoes` hoje. Copiei a estrutura de TTL já
  usada em `_CACHE_NORMALIZACAO_CARGOS`/`_normalizar_cargos_via_ia` (dict `{chave: (time.time(),
  valor)}`, TTL em segundos, nunca propaga exceção) em vez de inventar um mecanismo novo.
- **`_buscar_numero_institucional` não é chamado quando o pré-filtro não dispara:** confirmado via
  teste (`buscar_numero_spy.assert_not_awaited()` em
  `test_cargo_real_nao_regride_por_estar_perto_de_modalidade`) — o SELECT em `configuracoes` só
  acontece quando o texto realmente bate na lista fechada, preservando o "regex em memória, sem
  I/O adicional" pedido no Item B para o caso comum (candidato de emprego normal).
- **AC7 verificado estruturalmente, não só por leitura:** `_assunto_institucional` só é chamado
  dentro de `_rotear_por_intencao` — os três dispatchers de etapa de coleta de dado
  (`_processar_empresa`, `_processar_candidato`, `_processar_publico`) nunca o referenciam.
  `test_prefiltro_nao_roda_em_etapa_de_coleta_de_dado` usa `inspect.getsource` pra fixar isso como
  fato testado (mesmo princípio da prova estrutural do AC8 na S-EMP-AUD-040), não afirmação
  aceita de bandeja.
- **De-risk do Item A rodado de fato, não só planejado:** `execute_sql` antes e depois da
  migration confirmou, dígito a dígito: `empregabilidade` = `5585999401057` (inalterado) e
  `institucional` = `5585999401027` (novo) — os dois valores conferidos, não assumidos. As demais
  chaves (`acesso_cuca`, `ouvidoria`, `academia_enem`) seguem `null`, como esperado (fora de
  escopo).
- **Copy do Item C não tinha texto definido na story** (diferente da S-EMP-AUD-040, onde o Junior
  aprovou copy explícita) — a story só descrevia a estrutura ("com número → texto + wa.me; sem
  número → texto sem link; oferecer voltar ao menu"). Escrevi o texto seguindo o tom das 4
  mensagens já em produção no motor-agente (`MENSAGENS_CANAL`, Deno) — desculpa/contexto curto,
  emoji único, sem jargão.
- **Copy aprovada pelo Junior em 06/09/2026 — só a variante COM NÚMERO** (`_MSG_INSTITUCIONAL_COM_NUMERO`):
  como o número já está configurado em produção (Item A), é essa a que roda de fato; o lead
  precisa do direcionamento (link), não de um "aguarde". A variante SEM NÚMERO
  (`_MSG_INSTITUCIONAL_SEM_NUMERO`) segue como fallback defensivo — só dispararia se a config
  ficasse ausente/malformada — e **não foi objeto de aprovação**, por não ser o caminho esperado
  em uso normal.
- **Ruff não disponível neste ambiente** (mesma limitação já registrada na S-EMP-AUD-040) —
  sintaxe validada via `python3 -c "import ast; ast.parse(...)"`; estilo manual seguindo o padrão
  já estabelecido no arquivo.
- **Testes:** `pytest worker/tests/test_empregabilidade_engine.py` — 321 → 360 (39 novos), 0
  falhas, em todas as rodadas (antes e depois de cada trecho de código).
- **Worktree:** implementado em `/home/valmir/Documentos/cucaatendemais-s-emp-aud-041` (`git
  worktree`), branch `fix/s-emp-aud-041-redirecionamento-emprega-institucional`, criado a partir
  de `origin/main` já com a S-EMP-AUD-040 mergeada (Item D do impact analysis — ordem respeitada,
  sem conflito de merge).

## QA Results

### Review em 2026-09-06 — @qa Quinn

**Gate: PASS**

**7 checks:**

1. **Code review** — PASS. Conferi o diff completo, não só a descrição: a inserção do pré-filtro
   fica inteiramente antes de `if cargo_mencionado:`, e nenhuma linha do branch `candidato_vaga`
   pré-existente foi tocada — o `git diff` mostra só adição, zero remoção fora do ponto de
   inserção. `_buscar_numero_institucional` segue exatamente o mesmo padrão de cache TTL já usado
   em `_normalizar_cargos_via_ia`/`_CACHE_NORMALIZACAO_CARGOS` (reuso de padrão do arquivo, não
   mecanismo novo inventado) — verifiquei eu mesma lendo os dois lado a lado.
2. **Testes** — PASS. Rodei a suíte de forma independente: **360 passed, 0 failed**. Contei via
   `pytest --collect-only -k "..."` (não grep, que errou por causa dos parametrize) — bate exato
   com os 39 novos declarados. Rodei também isoladamente os 5 testes pré-existentes de
   `cargo_mencionado` (S-EMP-AUD-030) — os 5 passam sem qualquer ajuste, confirmando a
   não-regressão do AC8 na prática, não só por leitura de diff.
3. **Acceptance Criteria** — PASS, 10/10 verificados por mim:
   - AC1/AC2 ✅ reproduzi eu mesma, fora do arquivo de teste, a frase real da auditoria ("Bom dia,
     quando abre a vaga de boxe?") e as demais 14 variantes da lista fechada contra
     `_assunto_institucional` — todas `True`.
   - AC3 ✅ reproduzi os 3 casos negativos obrigatórios da story ("vaga de auxiliar de academia",
     "curso técnico exigido na vaga", "atestado pra admissão") — todos `False`, confirmado em
     script próprio, não só no teste do @dev.
   - AC4 ✅ `_montar_mensagem_institucional("5585999401027")` gera `wa.me/5585999401027` — número
     exato, sanitizado.
   - AC5 ✅ testei `None`, string vazia e número mascarado (`(85) 99940-1027`) — nenhum gera
     `wa.me` quebrado nem a string `"None"`.
   - AC6 ✅ as duas variantes de mensagem (com e sem número) terminam oferecendo ajuda com vagas de
     emprego — não encerram seco.
   - AC7 ✅ confirmei estruturalmente, eu mesma, com `inspect.getsource`: `_assunto_institucional`
     só aparece dentro de `_rotear_por_intencao`; os três dispatchers de etapa de coleta
     (`_processar_empresa`, `_processar_candidato`, `_processar_publico`) não o referenciam.
   - AC8 ✅ os 5 testes pré-existentes de `cargo_mencionado` continuam verdes sem ajuste; "tem vaga
     de enfermeira?" não contém nenhum termo da lista fechada, então nunca entra no branch novo —
     confirmei isso rodando a frase direto contra `_assunto_institucional` (`False`).
   - AC9 ✅ `execute_sql` (read-only) antes e depois: `empregabilidade` permanece
     `5585999401057`, `institucional` gravou `5585999401027` — os dois, dígito a dígito, e as
     chaves `acesso_cuca`/`ouvidoria`/`academia_enem` seguem `null` como esperado. A migration em
     si (`INSERT ... ON CONFLICT DO UPDATE` com merge via `||`) é idempotente por construção —
     reexecutá-la converge sempre pro mesmo estado, nunca duplica nem apaga outras chaves.
   - AC10 ✅ o código que lê a chave `institucional` só existe a partir deste PR — antes do
     redeploy do `cuca-worker`, gravar a chave é inerte por definição (nenhum consumidor existente
     lê essa chave hoje).
4. **Sem regressões** — PASS. Além dos 5 testes de `cargo_mencionado`, rodei a suíte completa
   (360/360) — nenhum teste pré-existente precisou de ajuste (diferente da S-EMP-AUD-040, que
   exigiu 6 ajustes de relógio; aqui a mudança é puramente aditiva, sem gate de tempo).
5. **Performance** — PASS. Regex compilada uma vez no import do módulo, sem I/O; o SELECT em
   `configuracoes` só acontece quando o pré-filtro bate — confirmei isso no próprio teste do @dev
   (`buscar_numero_spy.assert_not_awaited()` no caso "enfermeira") e também por leitura do código:
   a chamada a `_buscar_numero_institucional` está dentro do `if`, não antes dele. Cache de 300s
   evita repetição de SELECT em picos de mensagens.
6. **Segurança** — PASS. Nenhuma interpolação de string em SQL (client Supabase parametrizado);
   `numero` só vem de config confiável, nunca do texto do lead; a sanitização (`re.sub(r"\D", "",
   numero)`) impede qualquer valor malformado de virar link quebrado ou injetar conteúdo na
   mensagem.
7. **Documentação** — PASS. File List e Dev Agent Record batem com o diff real, item por item; a
   aprovação da copy (só variante com número) está registrada com data e justificativa.

**Achado próprio, não bloqueante:** testei alguns casos de fronteira que a suíte do @dev não
cobria explicitamente — palavras que **começam** com um termo da lista mas são cargos/palavras
diferentes: `"voleibol é uma boa opção de carreira"`, `"trabalho com skatelandia"` e
**principalmente `"grafiteiro profissional contratado"`** (grafiteiro é uma ocupação real). Os
três retornam `False` — o boundary `(?!\w)` já protege contra isso corretamente, sem precisar de
nenhuma mudança. Registro como confirmação adicional, não como código pendente; sugiro considerar
adicionar "grafiteiro" ao menos como caso de teste explícito num incremento futuro, já que é o
caso mais realista de colisão (job title real vs. termo da lista).

**Nenhum item bloqueia o avanço.** Recomendo seguir para @devops.

## Change Log

- v0.5 (2026-09-06): @qa revisa — **PASS**, 7/7 checks, 10/10 ACs confirmados por verificação
  independente (suíte rodada de novo pelo @qa: 360/360; AC1/AC2/AC3 reproduzidos em script
  próprio; AC7 confirmado via `inspect.getsource` rodado pelo próprio @qa; AC9 conferido com
  `execute_sql` read-only antes e depois, dígito a dígito). 1 achado próprio, não bloqueante:
  boundary de palavra inteira protege corretamente contra colisão com "grafiteiro" (ocupação
  real) e outras palavras que começam com termo da lista — confirmado, sem necessidade de ajuste.
  Status: InReview → **Ready for Review** (aguardando @devops).
- v0.4 (2026-09-06): @dev implementa. Os 3 itens (A: chave `institucional` na config via
  migration idempotente aplicada e conferida em produção; B: pré-filtro `_assunto_institucional`;
  C: montagem de mensagem só por código+config, com cache de número em processo) seguidos
  conforme desenhado. Achado registrado no Dev Agent Record: a copy do Item C não veio definida
  na story (diferente da S-EMP-AUD-040) — texto escrito seguindo o tom das mensagens já em
  produção no motor-agente, **ainda sem aprovação do Junior**. Suíte 321→360 (39 novos), 0
  falhas. Status: Ready → **InReview** (aguardando @qa).
- v0.3 (2026-09-05): Junior responde as duas pendências do v0.2: **copy aprovada** (implementação
  literal) e **não há vaga de oficineiro/instrutor no canal** — a ambiguidade levantada não existe
  na prática, a lista estreita fica como está, sem marcadores de ocupação. A premissa ficou
  registrada no Item B como algo a revisitar **se** esse tipo de vaga passar a existir, não como
  código pendente. A story não tem mais nenhuma dependência de decisão externa.
- v0.2 (2026-09-05): @po valida — **GO condicional** (8/10). Duas lacunas: (1) nenhum texto de
  mensagem definido, mesma pendência da S-EMP-AUD-040 — copy proposta adicionada ao Item C;
  (2) **pergunta de negócio que só o Junior responde** — se a Rede CUCA divulga vaga de
  oficineiro/instrutor dessas mesmas modalidades no Emprega+, "tem vaga de capoeira?" é ambíguo e
  a lista estreita erraria justamente quem procura emprego. Consultei a base: das 31 vagas
  existentes, nenhuma é de instrutor/oficineiro — sustenta a lista, mas é amostra pequena e as
  vagas vêm de empresas parceiras. Pergunta e mitigação (marcadores de ocupação) registradas no
  Item B. Não bloqueia o início — os itens A e C podem andar. Status: Draft → **Ready**.
- v0.1 (2026-09-05): @sm cria a story a partir do item 1 do planejamento do @dev, com o número do
  Cuca Atende+ (`5585999401027`) informado pelo Junior em 05/09 e o alerta dos dois números que
  diferem em um dígito registrado em destaque, a pedido dele. Incorporada a correção de rota do
  @dev sobre a causa raiz (é o branch `cargo_mencionado`/S-EMP-AUD-030 na linha 5798, não
  `KEYWORDS_VAGA`) e a redução deliberada da lista de termos — larga demais, ela misdirecionaria
  candidatos a emprego, e os três casos negativos entraram como AC obrigatório em vez de
  observação. Ordem em relação à S-EMP-AUD-040 registrada como dependência de processo (mesmo
  arquivo). Status: Draft — aguardando validação do @po.
