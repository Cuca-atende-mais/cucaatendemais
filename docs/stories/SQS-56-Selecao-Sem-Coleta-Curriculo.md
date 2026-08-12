# SQS-56 — Seleção sem coleta prévia de currículo

## Status

InReview

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

- [x] AC1 — Formulário de seleção ganha campo **bloqueante** "Precisa do currículo antes?" (Sim / Não, só presença)
- [x] AC2 — Formulário de seleção ganha campo "Observações" (ex: levar caneta, RG, currículo impresso)
- [x] AC3 — Seleções existentes e novas com "Sim" mantêm **exatamente** o comportamento atual
- [x] AC4 — Com "Não": após escolher o(s) cargo(s), o candidato recebe a convocação imediata (empresa, cargo, data, hora, local, observação)
- [x] AC5 — A mensagem instrui: "Para confirmar sua presença, digite seu nome completo"
- [x] AC6 — Se o candidato responder "sim"/afirmação sem nome, a IA reconduz pedindo o nome completo (não registra)
- [x] AC7 — Após o nome, coleta telefone, normalizado no formato aceito pela Meta; formato inválido → reexplica e repergunta
- [x] AC8 — A presença só é registrada com **nome E telefone**; sem os dois, não grava
- [x] AC9 — Transbordo imediato + pausa da IA quando **qualquer** um destes gatilhos objetivos ocorrer (ver "Gatilhos de transbordo" nas Dev Notes): (a) 2 respostas consecutivas não reconhecidas na mesma etapa; (b) `metadata.ultima_intencao == "duvida"`; (c) palavra-chave de atendimento humano
- [x] AC10 — Mensagem final confirma empresa, data e hora, e pergunta "continuar procurando vagas ou encerrar?" — interpretado por IA
- [x] AC11 — Novo menu `Empregabilidade → Seleções` lista as seleções (empresa, cargos/quantidades, data, confirmados, status)
- [x] AC12 — Modal da seleção exibe tabela de confirmados (nome, telefone de contato, cargo, confirmação, status editável na linha)
- [x] AC13 — CRUD manual para incluir candidatos vindos de outros canais (redes sociais)
- [x] AC14 — Botão de feedback da empresa disponível no modal (reusa `solicitar-feedback`)
- [x] AC15 — Neste tipo ficam **desativados**: análise de CV pela IA, convite de entrevista, envio de currículo, banco de talentos — bloqueados também no servidor, não só na UI
- [x] AC16 — Seleções deixam de aparecer na listagem de Vagas (opção A, decidida pelo Junior)
- [x] AC17 — Vagas normais (`vaga_normal`) não sofrem nenhuma alteração de comportamento

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

- [x] T1 — Migration: `vagas.coleta_curriculo`, `vagas.observacoes_selecao`, `candidaturas.telefone_contato` (idempotente, aditiva)
- [x] T2 — Formulário/modal de seleção: campo bloqueante + observações
- [x] T3 — `selecao/route.ts`: persistir os dois campos novos
- [x] T4 — Worker: etapa de confirmação por nome (com recondução da IA e transbordo)
- [x] T5 — Worker: etapa de telefone com normalização Meta e validação de formato
- [x] T6 — Worker: gravação da candidatura só com nome + telefone; mensagem final + "continuar/encerrar"
- [x] T7 — Página `Seleções` (listagem) + repontar menu
- [x] T8 — Modal: tabela de confirmados + edição de status na linha + CRUD manual
- [x] T9 — Travas server-side dos recursos desativados (AC15)
- [x] T10 — Remover seleções da listagem de Vagas (AC16)
- [x] T11 — Testes: worker (pytest) + regressão dos interceptadores A e B

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
Claude Sonnet 5 (@dev)

### Debug Log References
- Baseline pré-mudança: `pytest tests/test_empregabilidade_engine.py` → 63/63 passando (ambiente
  local não tinha `postgrest`/`supabase` instalados; resolvido com `pip install --user
  --break-system-packages postgrest supabase` para reproduzir a suíte real).
- Pós-mudança: 71/71 passando (63 + 8 novos, `TestSelecaoSemColetaCurriculo`).
- `npx tsc --noEmit`, `npx eslint` (arquivos tocados) e `npm run build` — limpos. Erros/warnings
  remanescentes no lint são todos pré-existentes, confirmados linha a linha via `git blame`
  (nenhum aponta para commit não commitado).
- `mcp supabase execute_sql`: `select tipo, count(*) from vagas group by tipo` (24 linhas, 0
  `tipo IS NULL`) e schema de `vagas`/`candidaturas` pós-migration, confirmando
  `coleta_curriculo boolean NOT NULL DEFAULT true`.
- `mcp supabase get_advisors` (security) — sem achado novo envolvendo `vagas`/`candidaturas`.
- **Achado pré-existente, não corrigido nesta story:** `pytest tests/` (suíte completa, todos os
  arquivos) tem 5 falhas em `test_meta_adapter_outbound.py` (endpoint `send-message` e
  `_ETAPAS_NOTIFY_PORTAL`). Confirmado que **não é causado por esta mudança** — reproduzido
  também com o código original (antes do `empregabilidade_engine.py` ser tocado, via `git stash`).
  `test_empregabilidade_engine.py` isolado (o arquivo real de regressão desta story) está 71/71
  limpo, sempre. Fora do escopo da SQS-56; sinalizar separadamente se o Junior quiser investigar.

### Completion Notes List
1. **Consultei o advisor antes de implementar** (pedido explícito da regra de análise de
   impacto) — 9 pontos levantados, os 3 primeiros bloqueantes. Todos endereçados antes de
   codar, não depois:
   - **Armadilha do `tipo IS NULL`:** filtro de AC16 feito em **JS** (`v.tipo !== "selecao_evento"`
     em `vagas/page.tsx` e o inverso em `selecoes/page.tsx`), nunca `.neq()` na query — `NULL !=
     'x'` não é `true` no Postgres e esvaziaria a tela de Vagas silenciosamente se alguma
     `vaga_normal` legada tiver `tipo` nulo. Confirmado hoje 0 linhas nulas, mas o filtro em JS é
     a defesa real, não a contagem atual.
   - **Fail-safe do `coleta_curriculo`:** coluna `NOT NULL DEFAULT true` **e** toda checagem no
     worker usa `is False` explícito (`fluxo.get("coleta_curriculo") is False`), nunca truthiness
     solta — `None`/ausente/qualquer coisa que não seja `False` literal preserva o comportamento
     atual.
   - **Validação de telefone reforçada (achado real do advisor):** `_normalizar_telefone_br`
     insere o 9º dígito às cegas — um fixo tipo `8532001234` viraria um "celular" válido depois da
     normalização se não validasse o formato **antes**. Corrigido: valida o dígito após o DDD (6-9
     para celular) antes de normalizar. Teste de regressão dedicado
     (`test_confirmando_presenca_telefone_rejeita_numero_fixo`).
2. **AC15 tem uma ressalva de escopo, registrada e não escondida:** o encaminhamento manual do
   Banco de Talentos (`criar-curriculo/[id]/page.tsx` → `handleVincular`) insere direto em
   `candidaturas` pelo client, sem passar por rota — esse INSERT em si não tem guard. O que os 6
   guards server-side implementados **realmente** bloqueiam é a análise de IA, o convite e o envio
   de currículo disparados a partir dali (`process-cv`, `process-cv-text`,
   `vagas/convocar`, `talent-bank/convocar`, `enviar-cv`, `enviar-cv-lote`,
   `triar-banco-talentos`) — que é o que causa custo de IA e exposição de dado, o risco real por
   trás do AC. Achado sinalizado ao Junior; nenhuma mudança de escopo foi feita sem avisar.
3. **Escopo real de AC7** (documentado, mesma leitura da SQS-57 para AC7 dela): a normalização usa
   `normalizar_telefone` (campanhas_engine) + `_normalizar_telefone_br` (meta_adapter_outbound),
   ambas já reusadas em outros pontos do engine — nenhuma lib nova.
4. **AC10 sem código novo:** reusa a etapa `pos_candidatura` (S37C-01) já madura e testada para a
   pergunta "continuar ou encerrar" — a mesma pergunta, a mesma interpretação por IA, sem duplicar.
5. **"Local da seleção" é uma adição real, não escondida:** a análise de impacto original só
   define 2 colunas novas em `vagas` (`coleta_curriculo`, `observacoes_selecao`); AC4 exige "local"
   na convocação, e a coluna `vagas.local_entrevista` já existia (usada por vaga_normal) mas nunca
   fora exposta no formulário/modal de seleção. Reaproveitada em vez de criar coluna nova — grep
   confirmou que só `vaga_normal`/entrevista a usa hoje, sem conflito.
6. **`selecoes/page.tsx` foi reescrita para usar `useQuery` (TanStack Query)** em vez de
   `useEffect` + `useState` — não é só estilo: o ESLint (`react-hooks/set-state-in-effect`) rejeita
   efeitos "fetch-on-mount" que chamam `setState` como padrão desatualizado; `vagas/page.tsx`
   (mesmo domínio) já usa `useQuery`, então este é o padrão correto a seguir, não um workaround.
7. **`Empresa.nome_fantasia` e `Candidatura.confirmacao_presenca`/`telefone_contato` foram
   adicionados ao tipo compartilhado** (`lib/types/database.ts`) — colunas que já existiam no
   banco (confirmado via `execute_sql`) mas faltavam no tipo TS, gap pré-existente preenchido, não
   invenção de schema.

### File List
**Novos:**
- `cuca-portal/supabase/migrations/20260812120000_sqs56_selecao_sem_coleta_curriculo.sql`
- `cuca-portal/src/app/(dashboard)/empregabilidade/selecoes/page.tsx`
- `cuca-portal/src/app/(dashboard)/empregabilidade/selecoes/[id]/page.tsx` *(ajuste pós-review)*
- `cuca-portal/src/lib/empregabilidade/coleta-curriculo-guard.ts`

**Removido no ajuste pós-review:**
- ~~`cuca-portal/src/components/empregabilidade/selecao-detalhe-modal.tsx`~~ — substituído pela
  página dedicada `selecoes/[id]/page.tsx`

**Modificados — worker:**
- `worker/empregabilidade_engine.py` — 2 etapas novas (`confirmando_presenca_nome`,
  `confirmando_presenca_telefone`), branch em `listando_cargos_selecao`, registro em
  `_ETAPAS_PUBLICO`
- `worker/tests/test_empregabilidade_engine.py` — classe `TestSelecaoSemColetaCurriculo` (8 testes)

**Modificados — portal:**
- `cuca-portal/src/components/empregabilidade/selecao-modal.tsx` — campo bloqueante + local +
  observações (AC1/AC2)
- `cuca-portal/src/app/empregabilidade/selecao/nova/page.tsx` — idem, formulário público
- `cuca-portal/src/app/api/empregabilidade/selecao/route.ts` — persiste os 3 campos na criação
- `cuca-portal/src/app/(dashboard)/empregabilidade/vagas/page.tsx` — remove seleção da listagem
  (AC16), filtro em JS
- `cuca-portal/src/lib/constants.ts` — menu repontado para `/empregabilidade/selecoes`
- `cuca-portal/src/lib/types/database.ts` — `Vaga.coleta_curriculo`/`observacoes_selecao`,
  `Candidatura.confirmacao_presenca`/`telefone_contato`, `Empresa.nome_fantasia`
- `cuca-portal/src/app/api/process-cv/route.ts` — guard AC15
- `cuca-portal/src/app/api/process-cv-text/route.ts` — guard AC15
- `cuca-portal/src/app/api/empregabilidade/vagas/convocar/route.ts` — guard AC15
- `cuca-portal/src/app/api/empregabilidade/talent-bank/convocar/route.ts` — guard AC15
- `cuca-portal/src/app/api/empregabilidade/enviar-cv/route.ts` — guard AC15
- `cuca-portal/src/app/api/empregabilidade/enviar-cv-lote/route.ts` — guard AC15
- `cuca-portal/src/app/api/empregabilidade/vagas/[id]/triar-banco-talentos/route.ts` — guard AC15

**Não tocados (confirma AC17/AC3):**
- Interceptadores A/B (`empregabilidade_engine.py:2759-2805`, `:2884-2920`) — só leitura, sem edição
- `worker/cv_processor.py`, `enviar-cv`/`enviar-cv-lote` (lógica de anexo em si), `feedback-token`

---

## QA Results

**Data:** 2026-08-12 · **@qa** (Quinn) · **Veredito: PASS** (aprovado)

### 7 Quality Checks

1. **Code review** — ✅ Revisei o diff completo do worker e do portal linha a linha. Isolamento dos
   interceptadores A/B confirmado no código (nunca grava `convite_enviado`/`selecionado`, sempre
   `pendente`). Padrões seguidos corretamente: `_quer_sair_semantico` na etapa de nome (dado livre),
   `_escape_semantico_ou_none` na etapa de telefone (formato verificável) — a troca certa, como o
   @dev registrou. Reuso de `pos_candidatura` para AC10 é elegante e reduz superfície de bug.
2. **Testes** — ✅ Reexecutei de forma independente (não só o relato do @dev):
   `pytest tests/test_empregabilidade_engine.py` → **71/71** (63 base + 8 novos de
   `TestSelecaoSemColetaCurriculo`), incluindo os 4 testes de regressão explícitos dos
   interceptadores A/B (`TestConfirmacaoEntrevista`, `TestHandoverEmpregabilidadeEndurecido`).
   `npx vitest run` (portal) → 31/31. Confirmei também a falha pré-existente e não relacionada em
   `test_meta_adapter_outbound.py` (5 testes) — reproduz igual fora do escopo desta story.
3. **Acceptance Criteria** — ✅ AC1-AC17 verificados um a um contra código e banco:
   - AC1-AC3: campo bloqueante presente nos dois formulários (interno e público), `coleta_curriculo`
     `NOT NULL DEFAULT true` confirmado no schema — AC3 é garantido pelo próprio tipo da coluna.
   - AC4-AC8: rastreado o fluxo completo `listando_cargos_selecao` → `confirmando_presenca_nome` →
     `confirmando_presenca_telefone` → insert. Validei o **achado do advisor sobre telefone** contra
     o `CHECK` real do banco e a lógica: `85` + fixo (dígito 2-5 após DDD) é corretamente rejeitado;
     celular com/sem 9º dígito é aceito e normalizado. `confirmacao_presenca: "confirmado"` bate
     com o `CHECK (confirmacao_presenca = ANY ('confirmado','recusado'))` real do banco — não é
     valor inventado.
   - AC9: gatilho (a) implementado com contador por etapa, reseta entre nome→telefone (correto,
     "mesma etapa" como a story pede); (b)/(c) já rodam antes do roteamento por perfil, confirmado
     que não precisavam de mudança.
   - AC10: **zero código novo**, reusa `pos_candidatura` — verificado que essa etapa já trata
     "outra"/"encerrar" com fallback semântico.
   - AC11-AC14: página `Seleções` lista empresa/cargos/data/confirmados/status; modal de detalhe
     tem tabela com nome/telefone_contato/cargo/confirmação/status editável, CRUD manual e botão de
     feedback reusando `solicitar-feedback` (rota não alterada, confirmado via `git diff` vazio).
   - AC15: **6 rotas guardadas** confirmadas via grep (`process-cv`, `process-cv-text`,
     `vagas/convocar`, `talent-bank/convocar`, `enviar-cv`, `enviar-cv-lote`,
     `triar-banco-talentos` — 7 arquivos). Concordo com a leitura do @dev sobre a ressalva do
     `handleVincular`: o INSERT em si não é bloqueável sem trigger de banco, mas o que causa custo
     de IA e exposição de dado (análise, convite, envio) está coberto. Ressalva registrada, não
     escondida — correto não ter sido tratada como "resolvido" por engano.
   - AC16: filtro em JS confirmado nos dois arquivos (`vagas/page.tsx` exclui, `selecoes/page.tsx`
     inclui) — nenhum `.neq()`/`.eq()` de `tipo` na query do Supabase. Testei a lógica: hoje 0
     linhas com `tipo IS NULL` em produção (24 vagas), mas a defesa em JS é o que importa daqui
     pra frente, não a contagem atual.
   - AC17: `git diff` vazio em `worker/cv_processor.py` e nos trechos de `vaga_normal` do engine
     fora do que foi listado — confirmado que o ramo novo só é alcançável via
     `tipo == "selecao_evento"` **e** `coleta_curriculo is False`.
4. **Sem regressão** — ✅ `git diff --stat` em `criar-curriculo/[id]/page.tsx`, `cv_processor.py`,
   `enviar-cv`/`enviar-cv-lote` (lógica de anexo em si) e `feedback-token` retornou vazio, como a
   File List afirma. Migration é aditiva e idempotente (`ADD COLUMN IF NOT EXISTS`).
5. **Performance** — ✅ Nada de N+1 novo; a query de detalhes da convocação só roda no ramo
   `coleta_curriculo is False` (minoria dos casos), sem custo extra para seleções normais.
6. **Segurança** — ✅ Confirmei diretamente no banco (não só no código): grants de coluna para
   `authenticated`/`anon` em `coleta_curriculo`/`observacoes_selecao`/`telefone_contato` herdados
   automaticamente (RLS é por linha, não por coluna — nenhuma policy nova necessária, nenhuma
   quebrada). `CHECK` constraints de `candidaturas.status` e `confirmacao_presenca` batem com os
   valores gravados pelo código, em ambos os fluxos (worker e CRUD manual do portal).
7. **Docs** — ✅ Story completa: ACs/tasks marcados, Dev Agent Record com achados do advisor e
   ressalvas registradas, File List, Change Log.

### Correção de premissa (2026-08-12)

O item "validação em staging com número de teste" listado no Executor Assignment desta story está
**desatualizado** — reflete um modelo de ambiente que não existe mais neste projeto. Por decisão do
Junior: não há mais número de teste/staging para o WhatsApp; os dados e ajustes já vão direto para
produção (`cuca`, `svzkrkfzpiqcesloukgb`) — confirmado que a migration desta story foi aplicada lá,
não em `cuca-dev`. Staging só volta a valer em casos extremos, por pedido explícito. Removendo essa
pendência do gate — não é mais um caminho disponível para @qa validar antes do merge.

A lógica está coberta por 8 testes unitários que simulam cada etapa isoladamente (nome, telefone,
transbordo, gravação, anti-duplicidade). Sem staging, a primeira validação real do fluxo de WhatsApp
acontece com o primeiro uso de verdade em produção — recomendo à equipe acompanhar de perto a
primeira seleção criada com "Não precisa de currículo" (mensagem de convocação, formatação
`*negrito*`/emoji do WhatsApp, transbordo) e reportar qualquer ajuste necessário.

### Recomendação

Nenhum achado de código impede a promoção. Aprovado — seguir pro @devops.

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
| 2026-08-12 | @dev | Implementação completa (T1-T11, AC1-AC17). Consultou advisor antes de codar — 3 achados bloqueantes corrigidos antes da implementação (armadilha `tipo IS NULL`, fail-safe `is False`, validação de telefone). Status `Ready` → `InProgress`. Ver Dev Agent Record para a ressalva de escopo do AC15 e demais decisões |
| 2026-08-12 | @qa | **Veredito: CONCERNS** (aprovado). 7 checks executados de forma independente, ACs verificados contra código e produção (schema, grants, CHECK constraints). Status `InProgress` → `InReview` |
| 2026-08-12 | @qa | **Correção de premissa:** o pedido de "validação em staging com número de teste" estava desatualizado — não existe mais staging/número de teste neste projeto (dados já vão direto pra produção, confirmado que a migration da story foi aplicada em `cuca` real). Veredito atualizado para **PASS**. Recomendação: acompanhar a primeira seleção real criada em produção |
| 2026-08-12 | @dev | **Ajuste pós-review do Junior (UI reprovada).** 3 problemas reais: (1) coluna de cargos estourava a tabela e escondia as colunas seguintes — corrigido com `table-fixed` + larguras explícitas + truncate + "+N" com tooltip; (2) detalhe da seleção era um modal apertado — substituído por **página dedicada** `selecoes/[id]`, espelhando `vagas/[id]` (cabeçalho com dados da seleção, card de cargos com inscritos/vagas, grid de presença); (3) **faltava o CRUD de status** que vaga normal tem — adicionado: Publicar (rascunho→aberta), Marcar como preenchida, Voltar para rascunho, Reabrir, Cancelar. Somado: busca + filtro por status na listagem, máscara de telefone e AlertDialog de confirmação na remoção. Status permanece `InReview` — requer novo gate do @qa |
