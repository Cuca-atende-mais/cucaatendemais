# S-AE-CONF-07 — Responder "que horas?" sem template: documento de FAQ na base global

**Status:** InProgress | **Prioridade:** P0 — URGENTE (prova dia 20/09) | **Esforço:** PP | **Risco:** BAIXO
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

## Change Log

| Data | Versão | Descrição | Autor |
|---|---|---|---|
| 2026-09-17 | 0.1 | Draft inicial — horários via FAQ global, sem template | @sm (River) |
| 2026-09-17 | 0.2 | Validação @po: **GO 9/10** — status `Draft` → **`Ready`**; 2 achados não bloqueantes | @po (Pax) |
| 2026-09-17 | 0.3 | @dev verificou em produção: documento `FAQ` global, ativo e **indexado** (1 chunk com embedding). AC1-AC3 ✅; falta o teste no WhatsApp (AC4) | @dev (Dex) |
