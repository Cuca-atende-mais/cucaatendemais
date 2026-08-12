# SQS-56 — Seleção sem coleta prévia de currículo

## Status

Ready

**Prioridade:** Alta
**Tipo:** Nova Funcionalidade
**Módulo:** Empregabilidade
**Estimativa:** **L** (worker: 2 etapas novas na máquina de estados · portal: página + modal + CRUD · 1 migration aditiva)
**Depende de:** SQS-49 (`selecao_evento` — já em produção)
**Épico:** [EPIC-EMP-VOL — Empregabilidade em Alto Volume](EPIC-EMP-VOL-Empregabilidade-Alto-Volume.md)
(criado por @pm e **ratificado pelo Junior** em 2026-08-11)

## Executor Assignment

```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - pytest worker (regressão dos interceptadores A e B — test_empregabilidade_engine.py:1401-1430)
  - mcp supabase execute_sql (confirmar colunas aditivas e ausência de status novo)
  - npm run lint && npm run typecheck (portal)
  - validação em staging com número de teste (fluxo ponta a ponta)
```

## 🤖 CodeRabbit Integration

> **CodeRabbit Integration**: Disabled
>
> CodeRabbit CLI is not enabled in `core-config.yaml`.
> Quality validation will use manual review process only.
> To enable, set `coderabbit_integration.enabled: true` in core-config.yaml

## Story

**Como** empresa que marca uma seleção presencial no CUCA,
**quero** indicar que não preciso de currículo antes do dia da seleção,
**para que** os candidatos apenas confirmem presença e eu conduza a triagem no próprio evento.

**Como** candidato que escolhe uma seleção desse tipo,
**quero** receber a convocação na hora e confirmar presença rapidamente,
**para que** eu fique livre para me candidatar a outras vagas na mesma conversa.

**Como** equipe de Empregabilidade,
**quero** uma lista de presença com nome e contato, alimentada pela automação e por cadastro manual,
**para que** eu tenha registro de quem foi e possa cobrar da empresa o retorno de quem foi selecionado.

---

## Objetivo

Permitir que uma seleção por evento seja criada **sem coleta de currículo**: a empresa quer apenas a
presença do candidato no dia/hora marcados, levando currículo impresso. Nesse modo, o candidato
recebe a convocação **na hora da candidatura**, confirma presença informando nome e telefone, e é
liberado para se candidatar a outras vagas — sem passar pelo fluxo de currículo, análise de IA ou
convite pós-seleção.

Toda a operação ganha um menu próprio (`Seleções`), separado de Vagas.

---

## Contexto

A maioria das seleções marcadas por empresas é convocação presencial: a divulgação acontece por
mídia social e a automação é **complemento de convocação + ferramenta de criação da vaga**. A empresa
conduz seleção e contratação; o CUCA precisa da **lista de presença** (nome + contato) para registro,
ações futuras e para cobrar o feedback de quem foi selecionado.

Diferença central em relação ao que existe hoje: **a confirmação do candidato acontece no momento da
candidatura**, não depois da seleção pela empresa. Isso exige um caminho isolado, sob pena de
contaminar o fluxo pós-seleção que já roda em produção.

---

## Acceptance Criteria

- [ ] AC1 — Formulário de seleção ganha campo **bloqueante** "Precisa do currículo antes?" (Sim / Não, só presença)
- [ ] AC2 — Formulário de seleção ganha campo "Observações" (ex: levar caneta, RG, currículo impresso)
- [ ] AC3 — Seleções existentes e novas com "Sim" mantêm **exatamente** o comportamento atual
- [ ] AC4 — Com "Não": após escolher o(s) cargo(s), o candidato recebe a convocação imediata (empresa, cargo, data, hora, local, observação)
- [ ] AC5 — A mensagem instrui: "Para confirmar sua presença, digite seu nome completo"
- [ ] AC6 — Se o candidato responder "sim"/afirmação sem nome, a IA reconduz pedindo o nome completo (não registra)
- [ ] AC7 — Após o nome, coleta telefone, normalizado no formato aceito pela Meta; formato inválido → reexplica e repergunta
- [ ] AC8 — A presença só é registrada com **nome E telefone**; sem os dois, não grava
- [ ] AC9 — Transbordo imediato + pausa da IA quando **qualquer** um destes gatilhos objetivos ocorrer (ver "Gatilhos de transbordo" nas Dev Notes): (a) 2 respostas consecutivas não reconhecidas na mesma etapa; (b) `metadata.ultima_intencao == "duvida"`; (c) palavra-chave de atendimento humano
- [ ] AC10 — Mensagem final confirma empresa, data e hora, e pergunta "continuar procurando vagas ou encerrar?" — interpretado por IA
- [ ] AC11 — Novo menu `Empregabilidade → Seleções` lista as seleções (empresa, cargos/quantidades, data, confirmados, status)
- [ ] AC12 — Modal da seleção exibe tabela de confirmados (nome, telefone de contato, cargo, confirmação, status editável na linha)
- [ ] AC13 — CRUD manual para incluir candidatos vindos de outros canais (redes sociais)
- [ ] AC14 — Botão de feedback da empresa disponível no modal (reusa `solicitar-feedback`)
- [ ] AC15 — Neste tipo ficam **desativados**: análise de CV pela IA, convite de entrevista, envio de currículo, banco de talentos — bloqueados também no servidor, não só na UI
- [ ] AC16 — Seleções deixam de aparecer na listagem de Vagas (opção A, decidida pelo Junior)
- [ ] AC17 — Vagas normais (`vaga_normal`) não sofrem nenhuma alteração de comportamento

---

## ⚠️ ANÁLISE DE IMPACTO — por item

> Regra `impact-analysis-mandatory.md`. Cada item rastreado até o consumidor real.

### Item 1 — `vagas.coleta_curriculo` (boolean, DEFAULT `true`)

- **Toca:** tabela `vagas`.
- **Consome hoje:** nada (coluna nova).
- **Impacto real:** nenhum. `DEFAULT true` faz toda seleção já existente manter o comportamento atual
  (coleta currículo). Nenhuma query existente referencia a coluna.
- **De-risk:** mesmo padrão aditivo já aplicado 3x nesta tabela (`tipo`, `cargos_lista`, `datas_selecao`).

### Item 2 — `vagas.observacoes_selecao` (text, nulo)

- **Impacto real:** nenhum. Aditiva, exibida só no ramo novo.

### Item 3 — `candidaturas.telefone_contato` (text, nulo)

- **Toca:** tabela `candidaturas`.
- **Por que coluna nova, e não reusar `candidaturas.telefone`:** `telefone` é **identidade** e sustenta
  8 pontos verificados — anti-duplicidade (`candidaturas/route.ts:100` e `:183`), interceptadores do
  worker (`empregabilidade_engine.py:2767` e `:2895`), envio ao banco de talentos
  (`candidaturas/[id]/rejeitar/route.ts:60`), vínculo de CV (`cv_processor.py:378`) e consulta da
  própria candidatura pelo WhatsApp. Sobrescrever com o número digitado permitiria a mesma pessoa se
  inscrever 2x no mesmo cargo com números diferentes.
- **Impacto real:** nenhum. `telefone` segue recebendo o número do WhatsApp; `telefone_contato` é
  registro para avisos e disparos futuros.

### Item 4 — Ramo novo no worker (etapas de confirmação)

- **Toca:** `worker/empregabilidade_engine.py`, ponto de inserção em `listando_cargos_selecao`
  (linhas 2252–2282) e na detecção de `selecao_evento` (linhas 2443–2470).
- **Consome hoje:** máquina de estados do WhatsApp (zona vermelha).
- **Impacto real:** nenhum em `vaga_normal` — esse trecho só é alcançado por vagas
  `tipo = 'selecao_evento'`, e o ramo novo entra atrás de `coleta_curriculo = false`.
- **Isolamento dos interceptadores existentes (crítico):**
  | Interceptador | Onde | Dispara com | Por que NÃO dispara aqui |
  |---|---|---|---|
  | A — convite pós-seleção (SQS-40) | linha 2759 | `status = convite_enviado`, **sem exigir conversa ativa** | o fluxo novo **nunca** grava `convite_enviado` |
  | B — presença de selecionado (SQS-49) | linha 2884 | conversa vazia + `status = selecionado` | o fluxo novo roda **com conversa ativa** (etapa própria) e nunca grava `selecionado` |
- **Decisão derivada:** a candidatura nasce e permanece `pendente` — mesmo status de qualquer
  candidatura hoje (`candidaturas/route.ts:77`). **Não** criar status novo: evita migration na CHECK
  constraint de `candidaturas.status` e evita contaminar contadores e o quadro em
  `vagas/[id]/page.tsx:441`.
- **De-risk:** rodar `pytest` do worker (a suíte já cobre os interceptadores A e B —
  `test_empregabilidade_engine.py:1401–1430`) e confirmar que seguem verdes.

### Item 5 — Feedback da empresa

- **Toca:** nada. **Verificado:** `feedback-token/[token]/route.ts:54` filtra
  `.in("status", ["pendente","selecionado"])` — como a candidatura fica `pendente`, ela **já aparece**
  sem alteração. A tela `feedback-empresa/[token]/page.tsx` renderiza apenas nome + avaliação, sem
  currículo/score — **já é compatível** com candidato sem CV.
- **Impacto real:** nenhum. Nenhuma linha alterada no pipeline de feedback.

### Item 6 — Desativar recursos (AC15)

- **Toca:** `vagas/convocar`, `enviar-cv`, `enviar-cv-lote`, triagem de banco de talentos.
- **Impacto real:** nenhum em vaga normal — as travas são condicionais a `coleta_curriculo = false`.
- **De-risk:** trava no **servidor**, não só ocultando botão. Ocultar na UI não impede chamada direta.

### Item 7 — AC16: seleções saem da lista de Vagas

- **Toca:** `cuca-portal/src/app/(dashboard)/empregabilidade/vagas/page.tsx` (hoje trata
  `tipo === "selecao_evento"` na linha 154 e abre `selecao-modal`).
- **Impacto real:** **este é o único item que altera tela existente.** Quem hoje procura uma seleção
  em Vagas deixa de encontrá-la ali.
- **De-risk:** avisar a equipe na virada. Decisão explícita do Junior (opção A).

### Item 8 — Menu `Seleções`

- **Toca:** `cuca-portal/src/lib/constants.ts:41`.
- **Estado atual:** o item **já existe** como "Marcar Seleção", apontando para
  `/empregabilidade/selecao/nova` — que é o **formulário público** usado pela empresa via link
  assinado, não uma listagem interna.
- **Impacto real:** repontar para a listagem nova. A permissão `empreg_selecao` **já existe no banco**
  (3 papéis com `can_read`) — **não há migration de RBAC**.

---

## Tasks

- [ ] T1 — Migration: `vagas.coleta_curriculo`, `vagas.observacoes_selecao`, `candidaturas.telefone_contato` (idempotente, aditiva)
- [ ] T2 — Formulário/modal de seleção: campo bloqueante + observações
- [ ] T3 — `selecao/route.ts`: persistir os dois campos novos
- [ ] T4 — Worker: etapa de confirmação por nome (com recondução da IA e transbordo)
- [ ] T5 — Worker: etapa de telefone com normalização Meta e validação de formato
- [ ] T6 — Worker: gravação da candidatura só com nome + telefone; mensagem final + "continuar/encerrar"
- [ ] T7 — Página `Seleções` (listagem) + repontar menu
- [ ] T8 — Modal: tabela de confirmados + edição de status na linha + CRUD manual
- [ ] T9 — Travas server-side dos recursos desativados (AC15)
- [ ] T10 — Remover seleções da listagem de Vagas (AC16)
- [ ] T11 — Testes: worker (pytest) + regressão dos interceptadores A e B

---

## Reuso (nada disso precisa ser criado)

| Necessidade | Peça existente |
|---|---|
| Transbordo + pausar IA | `_acionar_transbordo_empregabilidade` (engine:342), já usado para "dúvida" na linha 2717 |
| Telefone formato Meta | `normalizar_telefone` (campanhas_engine), já reusado na engine:1708 |
| 9º dígito no envio | `_normalizar_telefone_br` (meta_adapter_outbound:13) |
| IA "continuar ou encerrar" | `_quer_sair_semantico` (603) e `_escape_semantico_ou_none` (531) |
| Modal criar/editar seleção | `components/empregabilidade/selecao-modal.tsx` |
| Feedback da empresa | `solicitar-feedback` → `/feedback-empresa/[token]` → `feedback-submit` |
| Abas | `components/ui/tabs.tsx` |
| Permissão RBAC | `empreg_selecao` já provisionada |

---

## Riscos e decisões registradas

1. **Convocação é texto livre, não template Meta.** O candidato está no meio da conversa (janela de
   24h), e `_enviar` (engine:152) manda texto livre. **Não precisa de template aprovado.** Se algum
   dia essa convocação virar proativa, a regra de template volta a valer.
2. **Abandono após o "sim":** quem confirmar e sumir antes de dar nome/telefone **não é registrado**
   (decisão do Junior). A equipe verá menos confirmados que "sins" recebidos; o CRUD manual cobre.
3. **`pendente` não distingue "confirmou" de "não respondeu"** no quadro. A distinção vive em
   `confirmacao_presenca` e **precisa** aparecer como coluna na tabela da aba.

---

## Fora de escopo (explícito)

Não entram nesta story — cada item tem destino próprio:

| Item | Onde vive |
|---|---|
| Envio de currículo em lote para a empresa | Demanda 02, story ainda não escrita |
| Currículo por autoatendimento público | SQS-58 |
| Geração de PDF e `skills_jsonb` | SQS-57 |
| Seleção **com** coleta de currículo | Comportamento atual da SQS-49 — permanece intocado |
| Nível "empresas" no menu do candidato | Decidido manter como está (a vaga já nomeia a empresa) |
| Automatizar o disparo do feedback após a data da seleção | Sugerido, **não aprovado** — o botão manual existente permanece |

---

## Dev Notes

### Gatilhos de transbordo (AC9) — definição objetiva

O @po reprovou "detecta confusão" por não ser verificável. Os gatilhos abaixo são mensuráveis e
**dois dos três já existem** no código:

| # | Gatilho | Base existente |
|---|---|---|
| a | 2 respostas consecutivas não reconhecidas na mesma etapa (nome vazio/inválido ou telefone que não normaliza) | **novo** — contador no `fluxo` da conversa |
| b | `conversas.metadata.ultima_intencao == "duvida"` | `empregabilidade_engine.py:2716` (SQS-40) |
| c | Palavra-chave de atendimento humano | `_CONTAINS_HANDOVER`, `empregabilidade_engine.py:2732` |

Os gatilhos (b) e (c) já rodam **antes** do roteamento por perfil, então cobrem o fluxo novo sem
alteração. Só o (a) precisa ser implementado, e é local à etapa.

Todos usam `_acionar_transbordo_empregabilidade` (`empregabilidade_engine.py:342`), que já marca
`conversas.status = 'awaiting_human'`, notifica e **reverte o status** se a notificação falhar.
Usar `motivo` próprio (ex.: `selecao_presenca_confusao`) para rastreabilidade.

### Pontos de inserção verificados

| O quê | Arquivo:linha |
|---|---|
| Detecção de `selecao_evento` (antes de listar cargos) | `worker/empregabilidade_engine.py:2443-2470` |
| Handler `listando_cargos_selecao` (onde o ramo novo entra) | `worker/empregabilidade_engine.py:2252-2282` |
| Interceptador A — convite pós-seleção (NÃO tocar) | `worker/empregabilidade_engine.py:2759-2805` |
| Interceptador B — presença de selecionado (NÃO tocar) | `worker/empregabilidade_engine.py:2884-2920` |
| Status de criação da candidatura (`pendente`) | `cuca-portal/src/app/api/empregabilidade/candidaturas/route.ts:77` |
| Filtro da tela de feedback da empresa | `.../vagas/feedback-token/[token]/route.ts:54` |
| Item de menu a repontar | `cuca-portal/src/lib/constants.ts:41` |
| Lista de Vagas (remover seleções — AC16) | `.../empregabilidade/vagas/page.tsx:154` |

### Regra inegociável de isolamento

O fluxo novo **nunca** grava `status = 'convite_enviado'` nem `'selecionado'`. É isso que impede os
interceptadores A e B de capturarem o "sim" do candidato. Qualquer desvio aqui quebra o fluxo
pós-seleção que já roda em produção.

---

## Dev Agent Record

### Agent Model Used
_A preencher pelo @dev._

### Debug Log References
_A preencher pelo @dev._

### Completion Notes List
_A preencher pelo @dev._

### File List
_A preencher pelo @dev._

---

## QA Results

_A preencher pelo @qa._

---

## Ressalva de escopo

A afirmação "não afeta vaga normal" está verificada nos pontos lidos: engine linhas 342, 1698–1711,
2252–2282, 2443–2470, 2717, 2759–2805, 2884–2920. **Não** houve varredura completa do
`empregabilidade_engine.py` (3.372 linhas) nem do `cv_processor.py` — isso é tarefa do @dev na
implementação, antes de tocar a máquina de estados.

---

## Change Log

| Data | Autor | Mudança |
|---|---|---|
| 2026-08-11 | @sm | Criação a partir do levantamento e decisões do Junior |
| 2026-08-11 | @po | Validação: **NO-GO** (6,0/10) — template incompleto, sem estimativa, sem épico, AC9 não verificável |
| 2026-08-11 | @sm | Correções do NO-GO: Status como seção, Executor Assignment, Story em Como/quero/para que, aviso de CodeRabbit desabilitado, estimativa L, Fora de escopo, Dev Notes, Dev Agent Record, QA Results. **AC9 reescrito com 3 gatilhos objetivos** (2 já existentes no código). Épico segue pendente — criação é autoridade do @pm |
| 2026-08-11 | @po | **Revalidação: GO (10/10)** — todas as correções aplicadas; AC9 agora objetivo; épico EPIC-EMP-VOL ratificado. Status `Draft` → `Ready` |
