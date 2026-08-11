# SQS-57 — Currículo estruturado: geração de PDF e entrada na triagem da IA

## Status

Ready

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

- [ ] AC1 — Ao salvar um currículo estruturado, o sistema gera um **PDF real** com o mesmo layout da tela de impressão atual
- [ ] AC2 — O PDF é armazenado no R2 (mesma infra do upload) e `talent_bank.arquivo_cv_url` é preenchido
- [ ] AC3 — Regerar o currículo (edição) substitui o PDF e atualiza a URL, sem órfãos acumulando
- [ ] AC4 — Ao salvar, `talent_bank.skills_jsonb` é populado a partir dos dados estruturados, no mesmo formato já usado hoje (`habilidades`, `experiencia_meses`, `resumo_experiencias`, `escolaridade`, `resumo`, `justificativa_ia`, `origem`)
- [ ] AC5 — `skills_jsonb.origem` identifica a procedência (ex: `curriculo_estruturado`) para distinguir de OCR
- [ ] AC6 — Currículos estruturados passam a ser pontuados normalmente pelo `talent_bank_matcher`
- [ ] AC7 — O envio de currículo para a empresa (individual e lote) passa a anexar o PDF desses candidatos
- [ ] AC8 — **Decidido pelo Junior (2026-08-11):** os 57 currículos existentes sem arquivo recebem um **botão "gerar PDF" manual**, acionado pela equipe quando precisar enviar à empresa. **Sem** processamento em massa e **sem** geração automática ao abrir/editar
- [ ] AC0 — **Decidido pelo Junior (2026-08-11):** antes de qualquer implementação, um **spike** valida a biblioteca de PDF no ambiente real (build no contêiner + fidelidade visual do documento). A story só avança após o spike passar
- [ ] AC9 — Currículos enviados como arquivo (fluxo atual, OCR) não sofrem alteração de comportamento

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

- [ ] **T0 — SPIKE (bloqueante):** validar a lib de PDF no ambiente real antes de comprometer a story.
      Candidata: `@react-pdf/renderer` (JS puro, sem Chromium). Critérios de saída: build passa no
      contêiner do EasyPanel, PDF de 1–2 páginas sai com fidelidade aceitável ao layout de
      `print/[id]`, tempo de geração aceitável. **Se reprovar, reavaliar a abordagem antes de T1.**
- [ ] T1 — Adicionar a lib aprovada no spike
- [ ] T2 — Componente de PDF espelhando o layout de `print/[id]`
- [ ] T3 — Rota de geração + upload ao R2 + atualização de `arquivo_cv_url`
- [ ] T4 — Derivação de `skills_jsonb` a partir de `curriculos.dados`
- [ ] T5 — Integrar geração ao salvamento do "Criar Currículo" (interno)
- [ ] T6 — Botão manual "gerar PDF" para os 57 currículos existentes (AC8)
- [ ] T7 — Testes: formato de `skills_jsonb`, presença do anexo no envio, regressão do OCR

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

## Change Log

| Data | Autor | Mudança |
|---|---|---|
| 2026-08-11 | @sm | Criação. Origem: achado durante o levantamento das demandas 2 e 3; promovido a fundação por decisão do Junior |
| 2026-08-11 | @sm | Correções do NO-GO: Status como seção, Executor Assignment, Story em Como/quero/para que, aviso de CodeRabbit desabilitado, estimativa M, Fora de escopo, Dev Notes (números medidos + infra a reusar), Dev Agent Record, QA Results. Épico segue pendente — autoridade do @pm |
| 2026-08-11 | @po | **Correção de premissa** após medição em produção: a story afirmava que todo currículo montado era invisível à triagem da IA — são 6 linhas, não a base. Furos reordenados (PDF passa a ser o principal). Decisões do Junior incorporadas: AC8 = botão manual (57 casos), AC0/T0 = spike bloqueante da lib de PDF |
| 2026-08-11 | @po | **Revalidação: GO (10/10)** — bloqueadores resolvidos (AC8 decidido, T0 vira spike bloqueante); épico ratificado. Status `Draft` → `Ready` |
