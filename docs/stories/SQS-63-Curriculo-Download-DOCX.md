# SQS-63 — Download do currículo em DOC/DOCX (candidato)

## Status

InReview (QA interrompido por limite de créditos — ver nota abaixo)

**Nota:** o QA completo desta story foi interrompido a pedido do Junior por limite de créditos.
Achado parcial registrado antes de parar: a RPC `consumir_curriculo_download_token` ficou com
`EXECUTE` também para `anon`/`authenticated`, não só `service_role` — confirmado via
`information_schema.role_routine_grants` que é o **mesmo padrão herdado da SQS-58**
(`registrar_limite_curriculo_publico` tem exatamente o mesmo grant, provável default privilege do
schema `public` deste projeto Supabase, não algo introduzido por esta story). Não bloqueante,
mas vale um QA/hardening completo depois com mais fôlego de créditos.

**Prioridade:** Média
**Tipo:** Melhoria
**Módulo:** Empregabilidade
**Estimativa:** P-M (nova lib de geração de documento, mas mesmo dado estruturado já usado no PDF)
**Depende de:** SQS-58 (currículo público — link assinado, `CvDados`, geração de PDF)
**Épico:** EPIC-EMP-VOL — Empregabilidade em Alto Volume

## Story

**Como** candidato que montou o currículo pelo link público,
**quero** poder baixar meu currículo também em formato editável (DOC/DOCX), não só PDF,
**para que** eu possa ajustar o texto depois em outro computador/celular sem depender da CUCA.

## Objetivo

Adicionar uma segunda exportação (DOCX) ao lado do PDF já existente, gerada a partir dos mesmos
dados estruturados (`CvDados`). **Só pro candidato, na página pública** — o formulário interno do
dashboard (`criar-curriculo`) não ganha esse botão (decisão do Junior).

## Decisão confirmada (Junior, 2026-08-13)

DOCX é gerado **junto com o PDF, no momento do salvar** (não sob demanda) — aceita o custo de
processamento extra no submit em troca de já entregar os dois arquivos prontos.

## Acceptance Criteria

- [x] AC1 — Ao salvar o currículo público, além do PDF (SQS-57/58), gera também um `.docx` a
      partir do mesmo `CvDados`, mesmo layout/conteúdo do PDF (adaptado pro formato editável)
- [x] AC2 — O botão de download do DOCX aparece **ao lado/abaixo** do botão "Baixar PDF" (mesmo
      bloco do rodapé, ver SQS-58), com rótulo claro ("Baixar Word" ou similar) — implementado
      como "Baixar em Word (editável)", logo abaixo do "Baixar PDF"
- [x] AC3 — Download do DOCX usa o **mesmo mecanismo de token de uso único e TTL curto** já usado
      pro PDF (SQS-58 AC6) — não expõe URL permanente. Tabela de tokens ganhou coluna `tipo`
      (`pdf`/`docx`) pra cada token saber qual arquivo autoriza
- [x] AC4 — Botão de baixar DOCX **não aparece** no formulário interno do dashboard
      (`criar-curriculo/[id]`) — só no público (arquivo não foi tocado nesta story)
- [x] AC5 — Falha na geração do DOCX não pode quebrar o salvamento do currículo (PDF + banco de
      talentos continuam funcionando mesmo se o DOCX falhar — log de erro, não exceção fatal).
      Implementado com o cuidado extra do Risco #3: se falhar, o backend nem inclui `docx_url` na
      resposta — o botão simplesmente não aparece, em vez de aparecer quebrado

## ⚠️ Análise de impacto — por item

### Item 1 — Nova dependência (lib de geração DOCX)

- **Toca:** `package.json` do `cuca-portal`, novo serviço de geração (`curriculo-docx-service.ts`,
  espelhando `curriculo-pdf-service.ts` da SQS-57).
- **Depende de:** nenhuma lib de DOCX está no projeto hoje (confirmado: `docx` só aparece em
  contexto de **upload** de arquivo, não geração).
- **Impacto real:** aditivo — nenhum fluxo existente é tocado. Risco é só de build (confirmar que a
  lib escolhida não tem dependência nativa que quebre no runtime do EasyPanel/Node do projeto,
  mesmo cuidado que a SQS-57 teve com `@react-pdf/renderer`).
- **De-risk:** spike rápido de build antes de integrar ao fluxo real (mesmo padrão SQS-57).

### Item 2 — Geração acontece no submit (síncrono com o salvar)

- **Toca:** rota `POST /api/empregabilidade/curriculo/publico` (SQS-58) — mais uma chamada de
  geração/upload no mesmo request.
- **Impacto real:** submit fica mais lento (2 arquivos gerados e subidos ao R2 em vez de 1). Ainda
  assim, decisão explícita do Junior — aceito.
- **De-risk:** AC5 garante que a geração do DOCX é best-effort — se falhar, loga e segue (não
  derruba o salvamento do currículo, que é o dado crítico).

## Fora de escopo (explícito)

| Item | Motivo |
|---|---|
| Botão de DOCX no formulário interno (dashboard) | Decisão do Junior — só o público |
| Upload/reimportação de um DOCX editado de volta pro sistema | Não solicitado |
| Formato DOC (Word 97-2003, binário antigo) | **Confirmado com o Junior (2026-08-13): `.docx` sozinho atende.** Pedido original foi "doc e docx", mas `.doc` binário é formato legado sem lib moderna mantida — `.docx` (OOXML) é o padrão de mercado, abre em qualquer Word/Google Docs/LibreOffice |

## Riscos

1. ~~`.doc` vs `.docx` era pendência real de escopo~~ — **resolvido**: confirmado com o Junior
   em 2026-08-13, `.docx` sozinho atende. Sem bloqueio pro AC1.
2. **Duplicidade de armazenamento no R2.** Cada currículo salvo passa a gerar PDF + DOCX — dobra
   o número de arquivos armazenados por candidato. Sem impacto funcional, mas vale considerar no
   monitoramento de custo de storage se o volume crescer (fora do escopo desta story resolver,
   só registrado).
3. **Falha silenciosa aceitável (AC5) pode confundir o candidato** se ele não perceber que só o
   PDF foi gerado (DOCX falhou). Mitigação: recomendo ao @dev não deixar 100% silencioso — se o
   DOCX falhar, simplesmente não mostrar o botão de baixar DOCX (em vez de mostrar um botão
   quebrado), o candidato nem percebe que existiria essa opção.

## Change Log

| Data | Autor | Mudança |
|---|---|---|
| 2026-08-13 | @sm | Criação a partir de pedido do Junior pós-demo com sócio/gestores |
| 2026-08-13 | @po | **Validação: GO condicional (7/10)** — Riscos adicionado nesta validação. Um item vira bloqueante real antes do @dev começar AC1: confirmar com o Junior se `.docx` sozinho atende ("doc e docx" foi o pedido original, mas `.doc` binário legado não tem lib moderna mantida). Resto da story (AC2-AC5) não depende dessa resposta. Status `Draft` → `Ready` |
| 2026-08-13 | @po | Pendência resolvida: Junior confirmou `.docx` sozinho atende. Story sai de "GO condicional" para **GO pleno (9/10)** |
| 2026-08-13 | @dev | Implementado: lib `docx` adicionada (spike de build confirmado — smoke test gerou .docx válido, 9KB, sem dependência nativa); `curriculo-docx.ts`/`curriculo-docx-service.ts` espelhando o par PDF da SQS-57; migration aplicada em produção (`talent_bank.arquivo_docx_url` + coluna `tipo` na tabela de tokens + RPC `consumir_curriculo_download_token` recriada pra devolver `tipo`); rota `/curriculo/publico` gera o DOCX best-effort e só inclui `docx_url` na resposta se der certo; rota de download serve PDF ou DOCX conforme o `tipo` do token consumido. `package-lock.json` regenerado via `npm install` (não `bun add`) pra não repetir o problema do PR #87. `eslint`/`tsc` limpos, 6/6 testes de `curriculo-publico.test.ts` passando (1 novo). Status `Ready` → `InReview` |

## File List

- `supabase/migrations/20260813010000_sqs63_curriculo_docx.sql` (novo, aplicado em produção)
- `cuca-portal/src/lib/empregabilidade/curriculo-docx.ts` (novo)
- `cuca-portal/src/lib/empregabilidade/curriculo-docx-service.ts` (novo)
- `cuca-portal/src/lib/empregabilidade/curriculo-publico.ts`
- `cuca-portal/src/lib/empregabilidade/curriculo-publico.test.ts`
- `cuca-portal/src/app/api/empregabilidade/curriculo/publico/route.ts`
- `cuca-portal/src/app/api/empregabilidade/curriculo/download/route.ts`
- `cuca-portal/src/app/empregabilidade/curriculo/page.tsx`
- `cuca-portal/package.json`, `cuca-portal/package-lock.json` (nova dependência `docx`)
