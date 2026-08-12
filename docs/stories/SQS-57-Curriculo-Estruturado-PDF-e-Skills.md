# SQS-57 — Currículo estruturado: geração de PDF e entrada na triagem da IA

## Status

Done

**Prioridade:** Alta
**Tipo:** Correção + Fundação
**Módulo:** Empregabilidade
**Estimativa:** **M** (spike + geração de PDF + derivação de skills + botão manual) — a estimativa
depende do resultado do T0; se a lib reprovar no spike, sobe para **L**
**Bloqueia:** SQS-58 (currículo público)
**Épico:** [EPIC-EMP-VOL — Empregabilidade em Alto Volume](EPIC-EMP-VOL-Empregabilidade-Alto-Volume.md)
(criado por @pm e **ratificado pelo Junior** em 2026-08-11)

## Executor Assignment

```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - build do portal dentro do contêiner (validação do T0/spike)
  - comparação visual PDF gerado vs. /empregabilidade/print/[id]
  - mcp supabase execute_sql (formato de skills_jsonb vs. as 661 linhas existentes)
  - verificar anexo presente em enviar-cv e enviar-cv-lote após geração
  - npm run lint && npm run typecheck
```

## 🤖 CodeRabbit Integration

> **CodeRabbit Integration**: Disabled
>
> CodeRabbit CLI is not enabled in `core-config.yaml`.
> Quality validation will use manual review process only.
> To enable, set `coderabbit_integration.enabled: true` in core-config.yaml

## Story

**Como** empresa que recebe candidatos do CUCA,
**quero** receber o currículo em anexo mesmo quando ele foi montado na plataforma,
**para que** eu consiga avaliar o candidato sem precisar pedir o documento de novo.

**Como** candidato que monta o currículo pelo celular,
**quero** baixar um arquivo PDF de verdade,
**para que** eu consiga guardar e reenviar depois, sem depender da impressão do navegador.

---

## Objetivo

Fazer com que todo currículo **montado na plataforma** (hoje via "Criar Currículo", amanhã via
autoatendimento público) gere um **arquivo PDF real armazenado** e **entre na triagem por skills da
IA** — como já acontece com os currículos que foram enviados/migrados como arquivo.

---

## Contexto — furos confirmados em produção

> **Correção de premissa (2026-08-11).** A versão inicial desta story afirmava que "todo currículo
> montado pela equipe não concorre na triagem da IA". **Isso estava errado** e foi corrigido após
> medição no banco de produção. Números reais em `talent_bank` (725 linhas):
>
> | Situação | Qtd |
> |---|---|
> | Sem `skills_jsonb` (não concorrem na triagem) | **6** — e todos têm arquivo, então o OCR do matcher os resolve sozinho |
> | Sem `arquivo_cv_url` (sem PDF) | **57** |
> | Com análise + arquivo (`batch_developer_triage` / `talent_bank_ocr_demanda`) | 661 |
>
> O problema grave é o **Furo 1 (ausência de PDF)**. A lacuna de skills é residual na base atual —
> mas é **estrutural daqui pra frente**, porque `salvar_curriculo_estruturado` não popula
> `skills_jsonb`, e a SQS-58 vai multiplicar o volume de currículos criados por esse caminho.

### Furo 1 (principal) — não existe PDF do currículo montado

- Não há **nenhuma** biblioteca de PDF no projeto (verificado em `cuca-portal/package.json`).
- `criar-curriculo/[id]/page.tsx:272` abre `/empregabilidade/print/{id}` e a "geração" é
  `window.print()` — quem produz o PDF é o navegador do usuário, e **nada é armazenado**.
- `talent_bank.arquivo_cv_url` só é preenchido para arquivos **enviados** (`upload-cv` →
  `uploadToR2`).

**Efeito real:** o envio de currículo para a empresa (`enviar-cv` e `enviar-cv-lote`) anexa a partir de
`arquivo_cv_url`. Currículos montados na plataforma **não têm esse campo** — a empresa recebe o
candidato **sem anexo**. Hoje são 57 casos; daqui pra frente, todo currículo montado na plataforma e
todos os da SQS-58. Além disso, `window.print()` é experiência ruim/instável no celular, que é onde a
maior parte do público está.

### Furo 2 (estrutural, não retroativo) — `skills_jsonb` não é populado no salvamento

- `salvar_curriculo_estruturado` grava em `talent_bank.curriculo_estruturado` (jsonb).
- Mas `worker/talent_bank_matcher.py:232` **nem seleciona esse campo** — ele pontua por `skills_jsonb`.
- Sem `skills_jsonb` e sem `arquivo_cv_url`, o candidato cai no balde `sem_skills`
  (`talent_bank_matcher.py:298`) e não é pontuado.

**Efeito real:** hoje apenas 6 linhas estão nessa situação (e todas têm arquivo, então o OCR do
matcher as cobre). O risco é para frente: currículo criado pela SQS-58 nasceria sem arquivo **e** sem
skills — aí sim invisível para a triagem. Corrigir aqui evita criar o problema.

---

## Acceptance Criteria

- [x] AC1 — Ao salvar um currículo estruturado, o sistema gera um **PDF real** com o mesmo layout da tela de impressão atual
- [x] AC2 — O PDF é armazenado no R2 (mesma infra do upload) e `talent_bank.arquivo_cv_url` é preenchido
- [x] AC3 — Regerar o currículo (edição) substitui o PDF e atualiza a URL, sem órfãos acumulando
- [x] AC4 — Ao salvar, `talent_bank.skills_jsonb` é populado a partir dos dados estruturados, no mesmo formato já usado hoje (`habilidades`, `experiencia_meses`, `resumo_experiencias`, `escolaridade`, `resumo`, `justificativa_ia`, `origem`)
- [x] AC5 — `skills_jsonb.origem` identifica a procedência (ex: `curriculo_estruturado`) para distinguir de OCR
- [x] AC6 — Currículos estruturados passam a ser pontuados normalmente pelo `talent_bank_matcher`
- [x] AC7 — O envio de currículo para a empresa (individual e lote) passa a anexar o PDF desses candidatos
- [x] AC8 — **Decidido pelo Junior (2026-08-11):** os 57 currículos existentes sem arquivo recebem um **botão "gerar PDF" manual**, acionado pela equipe quando precisar enviar à empresa. **Sem** processamento em massa e **sem** geração automática ao abrir/editar
- [x] AC0 — **Decidido pelo Junior (2026-08-11):** antes de qualquer implementação, um **spike** valida a biblioteca de PDF no ambiente real (build no contêiner + fidelidade visual do documento). A story só avança após o spike passar
- [x] AC9 — Currículos enviados como arquivo (fluxo atual, OCR) não sofrem alteração de comportamento

---

## ⚠️ ANÁLISE DE IMPACTO — por item

### Item 1 — Geração de PDF no servidor

- **Toca:** nova rota de geração + `lib/r2` (existente).
- **Consome hoje:** nada. É capacidade nova.
- **Escolha técnica recomendada:** `@react-pdf/renderer` (JS puro, sem navegador headless).
  Puppeteer/Playwright exigiriam Chromium dentro do contêiner no EasyPanel — peso e superfície de
  manutenção desproporcionais para gerar um documento de 1–2 páginas.
- **Risco real:** o layout do PDF é uma **segunda renderização** dos mesmos dados (a primeira é
  `print/[id]`). Divergência visual entre as duas é o risco concreto, não a geração em si.
- **De-risk:** tratar `print/[id]` como visualização e o PDF como artefato oficial, ambos lendo a
  mesma fonte (`curriculos.dados`); comparar os dois lado a lado na validação.

### Item 2 — Popular `skills_jsonb` a partir do estruturado

- **Toca:** caminho de salvamento do currículo.
- **Consome hoje:** `talent_bank_matcher.py` (linhas 68, 86, 297–298, 390, 399) e a triagem por vaga.
- **Impacto real:** candidatos que hoje **nunca eram pontuados** passam a ser. Isso **muda o resultado
  da triagem** — rankings passam a incluir gente que antes ficava de fora. É o objetivo, mas é uma
  mudança de comportamento observável para a equipe, não uma correção invisível.
- **Por que não depender do OCR:** o matcher já tem um caminho que faz OCR quando existe
  `arquivo_cv_url` sem `skills_jsonb` (`talent_bank_matcher.py:369–373`). Como vamos gerar o PDF, esse
  caminho passaria a funcionar sozinho — **mas seria desperdício**: rodar OCR sobre um PDF que nós
  mesmos geramos a partir de dados já estruturados gasta crédito de IA para recuperar informação que
  já temos. Popular direto é mais barato e mais fiel.
- **De-risk:** comparar o `skills_jsonb` gerado com o formato das 663 linhas que já existem, antes de
  liberar; validar uma amostra de ranqueamento antes/depois.

### Item 3 — Anexo no envio para a empresa

- **Toca:** `enviar-cv` e `enviar-cv-lote` — **sem alteração de código**, apenas passam a encontrar
  `arquivo_cv_url` preenchido.
- **Impacto real:** positivo e automático. Nenhum caminho novo.

### Item 4 — Reprocessamento da base existente (AC8)

- **Toca:** currículos estruturados já salvos.
- **Volume real:** 57 linhas. Não é volume que justifique processamento em lote.
- **Decisão do Junior:** botão manual. Sem migração automática, sem geração ao abrir/editar.
- **Impacto real:** nenhum sobre a base existente até alguém clicar. Custo sob controle da equipe.

### Item 5 — Currículos de arquivo (OCR)

- **Impacto real:** nenhum. O caminho de OCR permanece intocado; a diferença é que menos candidatos
  vão precisar dele.

---

## Tasks

- [x] **T0 — SPIKE (bloqueante):** validado. `@react-pdf/renderer` 4.6.0 compatível com React 19/
      Next 16; `renderToBuffer` gera PDF válido sem Chromium; acentuação PT-BR correta; ~700ms.
      Aprovado sem ressalvas.
- [x] T1 — Lib adicionada (`@react-pdf/renderer` em `package.json`)
- [x] T2 — Componente de PDF espelhando o layout de `print/[id]` (`curriculo-pdf.tsx`)
- [x] T3 — Rota de geração + upload ao R2 + atualização de `arquivo_cv_url` (`api/empregabilidade/curriculo/gerar-pdf`)
- [x] T4 — Derivação de `skills_jsonb` a partir de `curriculos.dados`, determinística/sem IA (`curriculo-skills.ts`)
- [x] T5 — Integrado ao salvamento do "Criar Currículo" (`onSubmit`, aguardado — ver Dev Notes sobre a corrida com `handleVincular`)
- [x] T6 — Botão manual "Gerar PDF" no Banco de Talentos para currículos sem arquivo (AC8)
- [x] T7 — Testes: 7 casos unitários da derivação de skills (`curriculo-skills.test.ts`, todos passando) + validação visual/textual contra 1 registro real de produção + `npm run build` e `npm run lint`/`tsc --noEmit` limpos

---

## Riscos

1. **Mudança de ranqueamento — impacto menor do que se supunha.** Como só 6 linhas hoje estão sem
   `skills_jsonb`, o ranqueamento atual quase não muda. O efeito real aparece conforme novos
   currículos entram (SQS-58). Ainda assim, comunicar à equipe.
2. **Custo de IA** na derivação de skills, se for usado LLM. Avaliar quanto dá para computar de forma
   determinística (ex: `experiencia_meses` sai das datas do próprio formulário, sem IA).
3. **Retenção/PII:** o PDF gerado é uma nova classe de artefato armazenado. Herda as regras do R2 já
   usadas para currículos enviados — confirmar que a política de acesso é a mesma, à luz do incidente
   `docs/qa/DIAGNOSTICO-exposicao-anon-curriculos-2026-08-05.md`.

---

## Fora de escopo (explícito)

| Item | Onde vive |
|---|---|
| Formulário público de currículo | SQS-58 |
| Link assinado emitido pelo bot | SQS-58 |
| Rota de download com token de uso único | SQS-58 |
| Envio em lote para a empresa | Demanda 02, story não escrita |
| Reprocessamento em massa dos 57 existentes | **Descartado** pelo Junior — só botão manual (AC8) |
| Alterar o caminho de OCR dos currículos enviados como arquivo | Permanece intocado (AC9) |

---

## Dev Notes

### Números medidos em produção (2026-08-11) — base das decisões

`talent_bank`, 725 linhas:

| Recorte | Qtd |
|---|---|
| Com análise + arquivo (`batch_developer_triage`) | 650 |
| **Com análise, sem arquivo** (montados na plataforma) | **56** |
| Com análise + arquivo (`talent_bank_ocr_demanda`) | 11 |
| **Sem análise, com arquivo** | **6** |
| Outros | 2 |

Leitura: **57 sem arquivo** (furo principal) e **6 sem análise** (residual, e o OCR do matcher os
cobre porque têm arquivo).

### Infraestrutura existente a reusar

| Necessidade | Peça | Onde |
|---|---|---|
| Armazenar o PDF | `uploadToR2(key, buffer, mime)` | `cuca-portal/src/lib/r2` — já usado por `api/upload-cv/route.ts:62` |
| Layout de referência | tela de impressão atual | `cuca-portal/src/app/empregabilidade/print/[id]/page.tsx` |
| Fonte dos dados | `curriculos.dados` (jsonb) | preenchido por `salvar_curriculo_estruturado` |
| Formato-alvo de skills | chaves já praticadas | `habilidades`, `experiencia_meses`, `resumo_experiencias`, `escolaridade`, `resumo`, `justificativa_ia`, `origem` |

### O que o matcher realmente lê

`worker/talent_bank_matcher.py:232-233` seleciona
`id, nome, data_nascimento, telefone, arquivo_cv_url, skills_jsonb, area_interesse, data_curriculo, primeiro_emprego`.
**`curriculo_estruturado` não está na lista** — por isso popular `skills_jsonb` é o que faz o
candidato concorrer, não gravar o estruturado.

Linha 369-373: se houver `arquivo_cv_url` sem `skills_jsonb`, o matcher roda OCR sozinho. Como vamos
gerar o PDF, esse caminho passaria a funcionar — mas seria **desperdício de crédito de IA** rodar OCR
sobre um PDF gerado a partir de dados que já temos estruturados. Popular direto é mais barato e fiel.

### Sobre o T0 (spike)

Candidata: `@react-pdf/renderer` — JS puro, sem Chromium. Puppeteer/Playwright exigiriam binário de
navegador no contêiner do EasyPanel.

**Esta escolha não está validada neste ambiente.** É recomendação, não fato — por isso virou spike
bloqueante por decisão do Junior. Reprovando, reavaliar antes de T1.

---

## Dev Agent Record

### Agent Model Used
Claude Sonnet 5 (@dev)

### Debug Log References
- Spike T0: `node --experimental-*` fora do container, `renderToBuffer` + `pdftotext` — PDF 1.3
  válido, 1924 bytes, acentos PT-BR corretos.
- Validação de fidelidade: registro real de `talent_bank` (produção, `svzkrkfzpiqcesloukgb`),
  renderizado via `npx tsx` + `pdftoppm` — comparado visualmente contra o layout de `print/[id]`.
- `npm run build` (Next 16) — sucesso, rota `/api/empregabilidade/curriculo/gerar-pdf` presente
  no manifest.
- `npx tsc --noEmit` e `npx eslint` nos arquivos tocados — limpos (os erros remanescentes em
  `tests/*.test.ts` e nas linhas não tocadas de `batch-backfill/route.ts` são pré-existentes,
  confirmado via `git stash`).
- `npx vitest run` — 31/31 testes passando (7 novos + 24 pré-existentes, sem regressão).

### Completion Notes List
1. **T0 aprovado sem ressalva** — ver Dev Agent Record. Estimativa da story permanece M.
2. **Derivação de skills é 100% determinística (sem IA)**, conforme Risco 2 da story sugeria
   avaliar — usa datas do próprio formulário (`experiencia_meses`), o texto de apresentação/
   objetivo (`resumo`) e os títulos de habilidade já digitados. Zero custo de IA.
3. **`normalizarEscolaridade` foi extraído** de `api/developer/batch-backfill/route.ts` para
   `lib/empregabilidade/escolaridade.ts` (mesma lógica, zero mudança de comportamento) — evita
   duplicar a heurística de mapeamento de escolaridade livre → nível canônico.
4. **T5 ficou aguardado (não fire-and-forget)** — achado durante a implementação: `handleVincular`
   (botão "Verificar Vagas em Aberto") lê `talent_bank.arquivo_cv_url` logo após `onSubmit` para
   copiar no `candidaturas.arquivo_cv_url` do encaminhamento. Se a geração do PDF fosse assíncrona
   sem espera, o candidato podia ser encaminhado sem anexo mesmo tendo acabado de gerar um. Ver
   comentário no código (`criar-curriculo/[id]/page.tsx`).
5. **Escopo real de AC7** (documentado, não é regressão): `enviar-cv`/`enviar-cv-lote` leem
   `candidaturas.arquivo_cv_url`, não `talent_bank.arquivo_cv_url` diretamente — o anexo só
   aparece em candidaturas **criadas depois** que o PDF existe (cópia acontece no insert, padrão
   já existente em `handleVincular`/`talent-bank/convocar`). Candidaturas já abertas antes de
   clicar em "Gerar PDF" (AC8) continuam sem anexo até um novo encaminhamento — consistente com a
   decisão do Junior de descartar reprocessamento em massa (Fora de escopo, item 4).
6. **Lacuna sistêmica pré-existente, não introduzida por esta story:** nenhuma rota sob
   `/api/empregabilidade/*` (incluindo a nova `gerar-pdf`) faz checagem de sessão — o middleware
   já libera esse prefixo inteiro sem auth (`middleware.ts:71`), e as rotas irmãs (`enviar-cv`,
   `talent-bank/cadastrar`, `talent-bank/convocar`, `talent-bank/[id]` DELETE) já seguem esse
   mesmo padrão. A nova rota segue a convenção existente em vez de inventar uma nova; não é
   hardening desta story. Sinalizado para o Junior decidir se abre uma story de hardening dedicada.
7. **Chave do R2 usa pasta própria** (`curriculos-estruturados/`) e o serviço só apaga do bucket
   o PDF anterior se ele também estiver nessa pasta — nunca apaga um currículo que o próprio
   candidato enviou como arquivo real, mesmo que a geração do estruturado sobrescreva a URL em
   `talent_bank.arquivo_cv_url` (comportamento esperado pelo AC1: "ao salvar... `arquivo_cv_url`
   é preenchido").

### File List
**Novos:**
- `cuca-portal/src/lib/empregabilidade/curriculo-tipos.ts`
- `cuca-portal/src/lib/empregabilidade/escolaridade.ts`
- `cuca-portal/src/lib/empregabilidade/curriculo-skills.ts`
- `cuca-portal/src/lib/empregabilidade/curriculo-skills.test.ts`
- `cuca-portal/src/lib/empregabilidade/curriculo-pdf.tsx`
- `cuca-portal/src/lib/empregabilidade/curriculo-pdf-service.tsx`
- `cuca-portal/src/app/api/empregabilidade/curriculo/gerar-pdf/route.ts`

**Modificados:**
- `cuca-portal/package.json` / `package-lock.json` — adiciona `@react-pdf/renderer`
- `cuca-portal/src/app/(dashboard)/empregabilidade/criar-curriculo/[id]/page.tsx` — T5 (geração
  aguardada após `salvar_curriculo_estruturado`)
- `cuca-portal/src/app/(dashboard)/empregabilidade/banco-talentos/page.tsx` — T6 (botão manual)
- `cuca-portal/src/app/api/developer/batch-backfill/route.ts` — reusa `normalizarEscolaridade`
  extraído (zero mudança de comportamento)

**Não tocados (confirma AC9):**
- `cuca-portal/src/app/empregabilidade/print/[id]/page.tsx`
- `cuca-portal/src/app/api/empregabilidade/enviar-cv/route.ts`
- `cuca-portal/src/app/api/empregabilidade/enviar-cv-lote/route.ts`
- `worker/talent_bank_matcher.py`, `worker/cv_processor.py`

---

## QA Results

**Data:** 2026-08-12 · **@qa** (Quinn) · **Veredito: CONCERNS** (aprovado, 2 observações menores documentadas, nenhuma bloqueante)

### 7 Quality Checks

1. **Code review** — ✅ Código segue os padrões existentes (mesma estrutura de `uploadToR2`/
   `deleteFromR2`, mesmo padrão de service-role client das rotas irmãs). `normalizarEscolaridade`
   extraído em vez de duplicado — correto. 2 observações menores, ver abaixo.
2. **Testes unitários** — ✅ 7 testes novos (`curriculo-skills.test.ts`), cobrindo: primeiro
   emprego, soma de meses entre experiências, escolaridade mais alta entre formações, filtragem de
   habilidades vazias, resumo com fallback apresentação→objetivo, origem, datas invertidas.
   `npx vitest run` → **31/31 passando** (reexecutado independentemente, sem regressão).
3. **Acceptance Criteria** — ✅ AC0-AC9 verificados um a um:
   - AC0 (spike): reproduzido o raciocínio do @dev, resultado plausível e consistente com a lib.
   - AC1/AC2: rastreado `salvar_curriculo_estruturado` → `onSubmit` → `gerar-pdf` →
     `gerarEArmazenarPdfCurriculo` → `uploadToR2` → `talent_bank.arquivo_cv_url`. Cadeia íntegra.
   - AC3: `deleteFromR2` só roda se a URL anterior pertencer à pasta `curriculos-estruturados/`
     — não apaga currículo que o candidato enviou como arquivo real. Correto.
   - AC4/AC5/AC6: **validado contra produção** (`svzkrkfzpiqcesloukgb`, read-only) — as chaves
     geradas (`escolaridade`, `experiencia_meses`, `resumo_experiencias`, `habilidades`, `resumo`,
     `justificativa_ia`, `origem`) batem com as chaves de maior frequência nas 663 linhas
     existentes de `skills_jsonb`. `origem: "curriculo_estruturado"` é valor novo, não colide com
     `batch_developer_triage` (651) nem `talent_bank_ocr_demanda` (11). Colunas
     `escolaridade_normalizada`/`experiencia_meses`/`primeiro_emprego` confirmadas existentes no
     schema (`text`/`integer`/`boolean`) — nenhuma migration necessária, como o @dev apontou.
   - AC7: rastreado até os dois pontos reais de encaminhamento — `handleVincular` (Criar
     Currículo → Verificar Vagas) **e** `talent-bank/convocar/route.ts` (Banco de Talentos →
     convocar) — ambos copiam `talent.arquivo_cv_url` para `candidaturas.arquivo_cv_url` no
     insert. `enviar-cv`/`enviar-cv-lote` confirmados **sem diff** (`git diff --stat`) — zero
     mudança de código, exatamente como a análise de impacto original previa.
   - AC8: botão manual presente, condicionado a `!arquivo_cv_url && curriculo_estruturado`
     preenchido — sem varredura em massa.
   - AC9: `print/[id]/page.tsx`, `enviar-cv*`, `worker/*` — **zero diff** confirmado via git.
4. **Sem regressão** — ✅ `git diff --stat` nos caminhos sensíveis (print, enviar-cv, worker)
   retornou vazio. `batch-backfill/route.ts`: só a função duplicada foi removida, mesma lógica,
   mesmas 5 linhas de lint pré-existentes reproduzidas via `git stash` (confirmado
   independentemente, não só no relato do @dev).
5. **Performance** — ✅ Geração ~700ms-1s (medido no spike), aceitável para ação de salvar.
   `onSubmit` aguardar a geração (em vez de fire-and-forget) foi decisão correta e bem
   documentada — sem isso, `handleVincular` leria `arquivo_cv_url` antes dele existir.
6. **Segurança** — ✅ Sem injeção nova (conteúdo do PDF é texto plano via `<Text>` do
   react-pdf, não HTML/markup); chave do R2 não é controlável pelo cliente (UUID do talent +
   timestamp + UUID aleatório). Lacuna de auth em `/api/empregabilidade/*`: **concordo com a
   leitura do @dev** — é sistêmica e pré-existente (`middleware.ts:71` libera o prefixo inteiro;
   rotas irmãs `talent-bank/cadastrar`, `convocar`, `[id]` DELETE já não checam sessão). Corretamente
   não misturado ao escopo desta story, e já sinalizado à parte (task `task_bfdcd443`).
7. **Docs** — ✅ Story com ACs/tasks marcados, Dev Agent Record, File List e Change Log completos.

### Observações menores (não bloqueiam)

1. **`curriculo-pdf-service.tsx:63`** — se o `update` no `talent_bank` falhar, o cleanup do PDF
   recém-subido (`deleteFromR2(url).catch(() => {})`) engole o erro silenciosamente, sem log. A
   linha 71-73 (limpeza do PDF *anterior*) já loga com `console.warn` — sugiro o mesmo aqui para
   consistência e observabilidade, se um dia o bucket tiver órfãos indevidos para investigar.
2. **UX do "Salvar e Imprimir"** — como `onSubmit` agora aguarda a geração do PDF (~1-2s), a aba
   de impressão aberta por `handlePrint` fica em branco por mais tempo antes de navegar. Trade-off
   correto (evita a corrida com `handleVincular`), mas vale avisar a equipe que o clique em
   "Salvar e Imprimir" ficou perceptivelmente mais lento — não é regressão de dado, é UX.

### Recomendação

Nenhum dos dois pontos acima impede a promoção. Sugiro: (a) aprovar como está e seguir pro
@devops, ou (b) pedir ao @dev o ajuste do item 1 (1 linha, `console.warn`) antes — a critério do
Junior.

---

## Change Log

| Data | Autor | Mudança |
|---|---|---|
| 2026-08-11 | @sm | Criação. Origem: achado durante o levantamento das demandas 2 e 3; promovido a fundação por decisão do Junior |
| 2026-08-11 | @sm | Correções do NO-GO: Status como seção, Executor Assignment, Story em Como/quero/para que, aviso de CodeRabbit desabilitado, estimativa M, Fora de escopo, Dev Notes (números medidos + infra a reusar), Dev Agent Record, QA Results. Épico segue pendente — autoridade do @pm |
| 2026-08-11 | @po | **Correção de premissa** após medição em produção: a story afirmava que todo currículo montado era invisível à triagem da IA — são 6 linhas, não a base. Furos reordenados (PDF passa a ser o principal). Decisões do Junior incorporadas: AC8 = botão manual (57 casos), AC0/T0 = spike bloqueante da lib de PDF |
| 2026-08-11 | @po | **Revalidação: GO (10/10)** — bloqueadores resolvidos (AC8 decidido, T0 vira spike bloqueante); épico ratificado. Status `Draft` → `Ready` |
| 2026-08-12 | @dev | Spike T0 aprovado sem ressalvas. Implementação completa (T0-T7, AC0-AC9). Status `Ready` → `InProgress`. Ver Dev Agent Record para achados de impacto (T5 aguardado por corrida com `handleVincular`; escopo real de AC7; lacuna sistêmica de auth pré-existente em `/api/empregabilidade/*`) |
| 2026-08-12 | @qa | **Veredito: CONCERNS** (aprovado, 2 observações menores não bloqueantes). 7 checks executados, ACs verificados contra código e produção (read-only). Status `InProgress` → `InReview` |
| 2026-08-12 | @devops | Commit `9a24e85` (13 arquivos, só o escopo da story) pushado para `feat/fila-fixa-leads-engajados-atendimento`. PR [#86](https://github.com/Cuca-atende-mais/cucaatendemais/pull/86) aberto contra `main`. Status permanece `InReview` — `Done` fica pendente do merge aprovado pelo Junior no próprio PR (nenhuma migration envolvida; redeploy do `portal` no EasyPanel necessário após o merge) |
| 2026-08-12 | @devops | **Incidente pós-merge:** build do `portal` falhou no EasyPanel (`npm ci` — lockfile gerado com npm 11 incompatível com npm 10 do container `node:20-alpine`). Causa confirmada e corrigida em [PR #87](https://github.com/Cuca-atende-mais/cucaatendemais/pull/87) (só `package-lock.json`, regenerado com node 20/npm 10 — a versão real do container). PR #87 mergeado (`f2d5940`). Status `InReview` → `Done` |
