# S-AE-CONF-07 — Responder "que horas?" sem template: documento de FAQ na base global

**Status:** InReview | **Prioridade:** P0 — URGENTE (prova dia 20/09) | **Esforço:** PP | **Risco:** BAIXO
**Epic:** Confirmação de presença — Simulado Academia Enem 2026
**Depende de:** nada. **Bloqueia:** nada. **Deploy:** **nenhum** — é cadastro de documento no portal.

## O problema

Os horários do simulado não foram informados a tempo e **não entraram no template**. Editar o
template exige nova aprovação da Meta, que demora — e o envio já está atrasado.

Depois de responder "sim" ou "não", o jovem vai perguntar **que horas é**. Essa resposta precisa
aparecer sem template.

## Por que dá para responder sem template

O template só é exigido para **iniciar** conversa. Quando o jovem responde (clique no botão ou
texto), abre-se a **janela de 24 horas de atendimento** — dentro dela o sistema responde texto
livre, sem template e sem aprovação de ninguém. É o que já aconteceu no teste de 17/09: o agente
respondeu 14 segundos depois do clique.

Ou seja: o caminho já existe. Falta só o agente **saber** os horários.

## A saída: um documento de FAQ na Base de Conhecimento Global

Quem responde essas mensagens é o **agente Institucional** (o número próprio da Academia Enem nunca
foi pareado — ver a correção v1.1 da S-AE-CONF-03). Então o documento vai na base do Institucional,
**não** na base da Academia Enem.

Caminho verificado no código (`supabase/functions/motor-agente/index.ts:2325-2341`): quando o lead
faz uma pergunta e ainda não escolheu unidade — que é exatamente o caso dele —, o agente busca
**só em documentos do tipo `FAQ` sem unidade**. É o único tipo consultado nesse caminho.

## Acceptance Criteria

**AC1** — Documento criado no portal em **Developer → Base de conhecimento**, com:
- **tipo: `FAQ`** (não "Horários" — esse tipo existe no formulário, mas o caminho de quem ainda não
  escolheu unidade consulta **apenas** `FAQ`, e o documento nunca seria encontrado);
- **sem unidade** (documento global);
- **ativo**.

**AC2** — Conteúdo com as duas datas separadas, sem ambiguidade:

```
SIMULADO ACADEMIA ENEM 2026 — HORÁRIOS

DIA 20 DE SETEMBRO DE 2026 (sábado)
12:00 — portões abrem
13:00 — alunos em sala
13:30 — início da prova
15:00 — liberação para deixar o local de prova
19:00 — fim da prova para alunos com necessidades especiais
20:00 — fim da prova para alunos sem necessidades especiais

DIA 27 DE SETEMBRO DE 2026 (sábado)
12:00 — portões abrem
13:00 — alunos em sala
13:30 — início da prova
15:00 — liberação para deixar o local de prova
18:30 — fim da prova para alunos com necessidades especiais
19:30 — fim da prova para alunos sem necessidades especiais
```

**AC3** — Confirmar que o documento foi **indexado**: o `trigger_indexar_documento` chama a
`processar-documento` em todo insert (só pula `resumo_rede` e `servicos_rede`, ver
`supabase/migrations/20260720000000_swm51_servicos_rede_skip_indexacao.sql`). Conferir que existem
chunks em `chunks_documentos` para o documento novo — sem chunk, a busca vetorial não acha nada.

**AC4** — Teste real no WhatsApp, com o lead de teste: responder o convite e em seguida perguntar
**"que horas começa?"** — a resposta tem que trazer os horários.

Esse teste também cobre um risco conhecido: no teste de 17/09 o agente classificou a confirmação
como despedida e marcou a conversa como `encerrada`. Pelo código
(`supabase/functions/motor-agente/index.ts:1827`), a mensagem seguinte **reabre** a conversa — mas
isso precisa ser visto acontecendo, não suposto.

**AC5** — O documento é **temporário**: sai da base depois de 27/09. Enquanto estiver lá, **qualquer
pessoa** que perguntar de horário no Institucional pode receber essa resposta — por isso o conteúdo
diz, com todas as letras, que é do Simulado da Academia Enem.

## O que esta story não faz

- Não mexe em template, não espera aprovação da Meta.
- Não muda código nenhum — **sem deploy**, sem redeploy no EasyPanel.
- Não garante a redação exata da resposta: quem escreve a frase final é o agente, a partir do
  documento. O que a story garante é que ele **tem** a informação certa.

## PO Validation — @po (Pax) · 2026-09-17

**Veredito: GO — 9/10. Status `Draft` → `Ready`.** Story curta, de dado, sem deploy, com o caminho
do código verificado linha a linha. Nada aqui justifica segurar.

| # | Ponto | Resultado |
|---|---|---|
| 1 | Título claro | ✅ |
| 2 | Descrição completa | ✅ Explica por que não precisa de template (janela de 24h) |
| 3 | ACs testáveis | ✅ AC4 é teste real no WhatsApp; AC3 é verificável em `chunks_documentos` |
| 4 | Escopo IN/OUT | ✅ "Não muda código, não espera Meta" está explícito |
| 5 | Dependências | ✅ Nenhuma — e o motivo de ir na base do Institucional está rastreado no código |
| 6 | Complexidade | ✅ PP — cadastro de um documento |
| 7 | Valor de negócio | ✅ Sem isso, 621 pessoas perguntam o horário e ninguém responde |
| 8 | Riscos documentados | ✅ Inclusive o risco da conversa `encerrada` |
| 9 | Critério de pronto | ⚠️ Ver achado 1 |
| 10 | Alinhamento com a epic | ✅ |

### Achado 1 (NÃO BLOQUEANTE) — quem executa e quem remove

A AC1 diz **onde** cadastrar, não **quem**. A tela fica no módulo **Developer**, que por decisão de
RBAC só o Junior e o sócio enxergam — o @dev pode não ter acesso. Duas saídas, as duas válidas: o
Junior cadastra pela tela, ou o @dev insere em `documentos_rag` via MCP (o trigger de indexação
dispara igual, é gatilho de banco).

A AC5 tem o mesmo buraco: manda remover depois de 27/09, sem dizer quem. Documento temporário sem
dono é documento que fica. Combinar isso ao cadastrar, não depois.

### Achado 2 (NÃO BLOQUEANTE, de produto) — "que horas" não vai ser a única pergunta

Se o horário não estava no template, é provável que **o local também não esteja**. A próxima
pergunta depois de "que horas" é "onde é" — e "o que preciso levar". Cadastrar o documento agora e
descobrir isso amanhã custa o dobro do trabalho e mais uma rodada de teste.

**Recomendação:** incluir no mesmo documento, se a informação existir, o **endereço do local de
prova** e **o que levar** (documento com foto, caneta). Não bloqueia: se a informação não estiver
disponível agora, o documento entra só com horários e é editado depois — a reindexação também é
automática.

### Observação sobre as duas datas no mesmo documento

Está certo manter as duas — o agente não tem como saber de qual rodada o jovem é. A consequência
aceita é que quem perguntar vai receber as duas datas na resposta. Preferível a receber a errada.

## Dev Agent Record — @dev (Dex) · 2026-09-17

**Verificação em produção (`cuca`, read-only, via Management API):**

| AC | Resultado | Evidência |
|---|---|---|
| AC1 | ✅ | Documento `929ad61f…` — `tipo = 'FAQ'`, `unidade_cuca = null`, `ativo = true`, criado 13:05 UTC |
| AC2 | ✅ | Conteúdo confere com o texto da story, as duas datas separadas |
| AC3 | ✅ | `chunks_documentos`: **1 chunk, com embedding** — indexação concluída |
| AC4 | ⏳ | Teste no WhatsApp — pendente, é do Junior |
| AC5 | ⏳ | Remoção depois de 27/09 — pendente, sem dono definido |

**Checagem extra (não pedida, mas decisiva):** a `buscar_chunks_similares` inclui documento global
mesmo quando a busca passa uma unidade — a cláusula é
`(p_unidade_cuca IS NULL OR dr.unidade_cuca IS NULL OR dr.unidade_cuca = p_unidade_cuca)`. E `FAQ`
está nas fontes do agente Institucional nos **dois** caminhos (`RAG_FONTES_POR_AGENTE.Institucional`
e o caminho de quem ainda não escolheu unidade). Ou seja: o documento é alcançável tanto para quem
já escolheu unidade quanto para quem não escolheu.

**Observação:** existe um documento antigo `Academia Enem - Simulado` (`45f81391…`) do tipo
`eventos_pontuais` com `unidade_cuca` nulo. Pela mesma cláusula ele também é alcançável — mas só
nos caminhos que pedem `eventos_pontuais`, nunca no de quem ainda não escolheu unidade. Não
atrapalha; só não serve para este caso.

## Atualização v0.4 (17/09) — o documento de FAQ não resolveu; o porteiro responde

### O teste real falhou

Depois do disparo de teste, o Junior perguntou **"Qual o horario?"** e o agente respondeu
perguntando **qual turma de natação** ele queria saber. O documento existe, está ativo e indexado —
mas perdeu para o assunto anterior da conversa. A AC4 desta story **falhou em produção**.

Isso confirma o limite do caminho de RAG: ele depende de a pergunta ser parecida o bastante com o
documento **e** de o histórico não puxar para outro assunto. Para 622 pessoas com conversas
anteriores variadas, não dá para contar com isso.

### A saída (decisão do Junior, 17/09): resposta fixa pelo porteiro

Quem **é da campanha** (mesma checagem da S-AE-CONF-03: categoria do evento + entrega comprovada de
disparo da campanha) e pergunta horário recebe **texto fixo**, e o agente **não é chamado** para
essa mensagem. Quem não é da campanha não é afetado em nada — segue para o atendimento normal.

**AC6 (nova)** — Pergunta de horário de lead da campanha é respondida com o texto fixo abaixo,
enviado no lugar da resposta do agente:

```
Aqui estão os horários do Simulado Academia Enem 👇

*20 de setembro (sábado)*
12:00 — portões abrem
13:00 — alunos em sala
13:30 — início da prova
15:00 — liberação para deixar o local
19:00 — fim da prova (alunos com necessidades especiais)
20:00 — fim da prova (demais alunos)

*27 de setembro (sábado)*
12:00 — portões abrem
13:00 — alunos em sala
13:30 — início da prova
15:00 — liberação para deixar o local
18:30 — fim da prova (alunos com necessidades especiais)
19:30 — fim da prova (demais alunos)

📍 Unichristus — Campus Benfica, Rua Princesa Isabel, 1920
(entrada pela Rua Luís de Miranda, 536)
```

**AC7 (nova)** — O documento de FAQ **continua** na base. Ele cobre quem pergunta horário sem ser
da campanha e serve de rede se o texto fixo for removido depois de 27/09.

### Achado do teste: a campanha tinha mais de um evento pontual

A programação pontual **não reabre para reenviar** — o envio de teste criou um evento novo. Isso
tornava o vínculo por disparo frágil. Resolvido na raiz pela mudança de regra da S-AE-CONF-03 v2.0:
**o gatilho do porteiro passou a ser só a categoria do evento**, e evento/disparo deixaram de
participar da decisão.

### Dev Agent Record — @dev (Dex)

| Arquivo | O que mudou |
|---|---|
| `worker/academia_enem_porteiro.py` | `pergunta_horario`, `TEXTO_HORARIOS`, `processar_mensagem_campanha`, gatilho por categoria (v2.0) e lote vindo da categoria de lote |
| `worker/meta_adapter_inbound.py` | O hook passa a poder **responder e encerrar** o turno quando é pergunta de horário de lead da campanha — o envio acontece **depois** do guard de `awaiting_human` (achado 8 do @qa), a anotação continua antes |
| `worker/tests/test_academia_enem_porteiro.py` | +10 testes (detecção de horário, texto fixo, quem não é da campanha não recebe, vários eventos) |

**Banco (já aplicado):** `configuracoes.academia_enem_confirmacao.lotes` mapeando a categoria `Lote 1`.

**Testes:** 127 passando (porteiro + inbound). `pyflakes` limpo.

**Precisa deploy:** sim — **redeploy do `cuca-worker`** depois do merge. Enquanto não for, a
pergunta de horário continua caindo no agente.

## QA Results — @qa (Quinn) · 2026-09-17 (v0.4 + mudança de regra da CONF-03 v2.0/2.1)

**Veredito: CONCERNS — um ajuste de ordem antes de subir.** O resto está correto.

### Achado 8 (BLOQUEANTE, mover 20 linhas) — a resposta automática de horário atropela o atendimento humano

No inbound, a resposta fixa de horário é enviada na **linha 1242**, e o guard de
`awaiting_human` — que silencia a IA quando um colaborador assumiu a conversa — só aparece na
**linha 1298**.

Ou seja: se um colaborador estiver atendendo um dos 622 pela tela e a pessoa perguntar "que
horas?", o bot responde por cima dele. Hoje isso não acontece com nenhuma resposta automática: até
o opt-out, que também responde direto, vem antes **mas é uma exceção já aceita** (é pedido legal de
LGPD). Horário não é.

**Correção:** mover o bloco que envia a resposta de horário para **depois** do guard de
`awaiting_human`. A parte que só **anota** (sim/não) pode continuar onde está — anotar não fala com
o lead, então não conflita com o atendimento humano.

### O que está correto

| Item | Resultado |
|---|---|
| Gatilho por categoria (v2.0) | ✅ Evento e disparo saíram da decisão; lote vem da categoria de lote |
| Resposta fixa de horário | ✅ Só para quem está na categoria; quem não é da campanha segue para o agente |
| Conversa não encerra (AC9) | ✅ E **desfaz** o encerramento que o motor-agente faz por dentro — sem isso não funcionaria |
| Campanha fechada | ✅ Volta a encerrar normalmente |
| Custo | ✅ A checagem de encerramento só roda quando o agente decide encerrar, não em toda mensagem |
| Testes | ✅ 39 no porteiro, **708 passando** na suíte (a única falha é a pré-existente do `worker_scope`) |
| `pyflakes` | ✅ Limpo |

### Observação (não bloqueia) — a resposta de horário não passa pelo debounce

Três perguntas seguidas e rápidas geram três respostas iguais. O atendimento normal agrupa (o
debounce existe para isso); este caminho responde na hora. Aceitável para 3 dias de campanha;
registrar para não virar surpresa.

### Observação (não bloqueia) — detecção de horário é propositalmente larga

`horário`, `que horas`, `portões`, `termina`, `acaba`. Como só vale para quem está na categoria da
campanha, o pior caso é alguém do simulado perguntar outra coisa sobre horas e receber a tabela do
simulado. Preferível ao contrário.

## QA Results — @qa (Quinn) · 2026-09-17 (fechamento)

**Veredito: PASS.** Achado 8 corrigido e o fluxo que o Junior pediu está verificado. Liberado para
o @devops.

### O fluxo pedido, testado

| Passo | Resultado |
|---|---|
| Lead da categoria responde "Sim, eu vou!" | ✅ Anotado; a mensagem segue para o atendimento normal |
| **Depois**, o mesmo lead pergunta "Qual o horario?" | ✅ **Recebe os horários**, com texto fixo, sem passar pelo agente |

Virou teste automatizado (`test_responde_presenca_e_depois_pergunta_horario`), com o texto exato
que o Junior usou no teste real que falhou.

### Achado 8 — corrigido

O envio da resposta de horário está agora **depois** do guard de `awaiting_human`. Colaborador
atendendo → IA calada, inclusive nessa resposta. A anotação continua antes, o que está certo:
anotar não fala com o lead.

### Achado 9 (NÃO BLOQUEANTE, registrado em teste) — mensagem que confirma e pergunta junto

"Sim, eu vou! Que horas começa?" numa mensagem só: o porteiro **anota** a confirmação e deixa a
pergunta com o agente — que foi justamente quem errou no teste de 17/09.

Não bloqueia: com botão, o clique vem sozinho, e a pessoa pergunta depois (o fluxo testado acima).
Só acontece com quem digita tudo junto. A correção, se incomodar, é devolver as duas coisas na
mesma passagem — três linhas. Está documentado em teste para não virar surpresa.

### Estado

- **41 testes** no porteiro, **708** na suíte (a única falha é a pré-existente do `worker_scope`).
- `pyflakes` limpo.
- Banco já configurado: categoria do evento, mapa de lote e fechamento.

**Precisa redeploy do `cuca-worker`** depois do merge — sem isso nada disso vale em produção.

## Change Log

| Data | Versão | Descrição | Autor |
|---|---|---|---|
| 2026-09-17 | 0.1 | Draft inicial — horários via FAQ global, sem template | @sm (River) |
| 2026-09-17 | 0.2 | Validação @po: **GO 9/10** — status `Draft` → **`Ready`**; 2 achados não bloqueantes | @po (Pax) |
| 2026-09-17 | 0.3 | @dev verificou em produção: documento `FAQ` global, ativo e **indexado** (1 chunk com embedding). AC1-AC3 ✅; falta o teste no WhatsApp (AC4) | @dev (Dex) |
| 2026-09-17 | 0.4 | AC4 falhou no teste real (agente respondeu sobre natação). Resposta fixa pelo porteiro (AC6/AC7) + suporte a vários eventos pontuais. Status → **`Ready for Review`** | @dev (Dex) |
| 2026-09-17 | 0.5 | QA: **CONCERNS** — achado 8 (resposta de horário antes do guard de atendimento humano). Resto aprovado; 708 testes passando | @qa (Quinn) |
| 2026-09-17 | 0.6 | Achado 8 corrigido: resposta de horário movida para depois do guard de atendimento humano; anotação segue antes. 708 testes passando | @dev (Dex) |
| 2026-09-17 | 0.7 | QA: **PASS** — fluxo sim/não → pergunta de horário verificado e coberto por teste; achado 9 (mensagem mista) registrado como limitação | @qa (Quinn) |
