# SQS-52 — Portal: Quality Gates Minimos para Typecheck e Testes

**Status:** Ready for Development
**Criado em:** 2026-05-07
**Tipo:** Story tecnica
**Epic:** Sprint 37 (estabilizacao producao)
**Prioridade:** Alta — destrava validacao confiavel antes de deploy
**Servico impactado:** `portal/frontend` (`cuca-portal`)

---

## 1. Contexto

Durante a SQS-51, os gates definidos em `AGENTS.md` nao puderam ser executados de forma completa no pacote `cuca-portal`:

- `npm run typecheck` nao existe no `package.json`;
- `npm test` nao existe no `package.json`;
- `npm run lint` existe, mas o lint completo falhou localmente por OOM do Node (`JavaScript heap out of memory`);
- `npx eslint 'src/app/(dashboard)/configuracoes/perfis/page.tsx'` passou quando executado de forma direcionada;
- `npm run build` existe, mas em execucao local atingiu timeout antes de concluir.

O projeto ja possui `typescript`, `eslint`, `eslint-config-next`, `next`, `react` e `react-dom`. Falta instalar/configurar a stack minima de testes e declarar scripts padronizados para que o agente consiga executar os gates de qualidade de forma repetivel antes de commit/push.

---

## 2. Problema

Sem scripts e ferramentas de teste no `package.json`, o processo de validacao fica incompleto e depende de comandos manuais. Isso aumenta o risco de:

- correcoes serem entregues sem typecheck executavel por script;
- regressao em componentes/hooks do portal passar sem teste automatizado;
- divergencia entre ambiente local, CI e VPS por falta de lockfile;
- story ficar com gates pendentes mesmo quando a alteracao e pequena.

---

## 3. Objetivo

Habilitar o minimo necessario para o pacote `cuca-portal` executar os gates de qualidade do projeto:

- lint completo com memoria suficiente;
- typecheck via script;
- testes unitarios/componentes via Vitest;
- build de producao preservado;
- lockfile npm versionado para instalacoes reprodutiveis.

---

## 4. Escopo

### IN

- Atualizar `cuca-portal/package.json` com scripts:
  - `lint`;
  - `typecheck`;
  - `test`;
  - `test:watch` (opcional, mas recomendado para dev local).
- Instalar devDependencies minimas:
  - `vitest`;
  - `@vitejs/plugin-react`;
  - `jsdom`;
  - `@testing-library/react`;
  - `@testing-library/jest-dom`;
  - `@testing-library/user-event`.
- Criar configuracao minima:
  - `cuca-portal/vitest.config.ts`;
  - `cuca-portal/src/test/setup.ts`.
- Gerar e versionar `cuca-portal/package-lock.json`.
- Adicionar pelo menos um teste smoke simples para validar que a stack executa.

### OUT

- Testes E2E Playwright.
- Pipeline GitHub Actions.
- Refatoracao de componentes existentes apenas para facilitar teste.
- Mudancas no `cuca-worker`.
- Mudancas em banco/Supabase.

---

## 5. Acceptance Criteria

- [ ] **AC1 — Scripts padronizados:** `cuca-portal/package.json` possui `lint`, `typecheck`, `test`, `test:watch` e `build`.
- [ ] **AC2 — Typecheck executavel:** `npm run typecheck` executa `tsc --noEmit`.
- [ ] **AC3 — Test runner instalado:** Vitest + Testing Library estao instalados em `devDependencies`, nao em `dependencies`.
- [ ] **AC4 — Config de teste:** `vitest.config.ts` usa ambiente `jsdom` e carrega `src/test/setup.ts`.
- [ ] **AC5 — Smoke test:** existe ao menos um teste simples que passa com `npm test`.
- [ ] **AC6 — Lint resiliente:** `npm run lint` usa memoria/cache suficiente para reduzir risco de OOM local.
- [ ] **AC7 — Lockfile:** `cuca-portal/package-lock.json` e gerado e versionado.
- [ ] **AC8 — Gates locais:** antes de concluir, rodar e registrar resultado:
  - [ ] `npm run lint`
  - [ ] `npm run typecheck`
  - [ ] `npm test`
  - [ ] `npm run build`

---

## 6. Plano de Implementacao

1. Entrar em `cuca-portal`.
2. Instalar dependencias de teste apenas como devDependencies.
3. Atualizar scripts no `package.json`.
4. Criar `vitest.config.ts`.
5. Criar `src/test/setup.ts`.
6. Criar um smoke test pequeno e estavel, preferencialmente de utilitario ou componente simples que nao dependa de Supabase real.
7. Rodar os gates completos.
8. Atualizar File List, Dev Agent Record e Change Log desta story.
9. Commit/push ao final via autoridades corretas.

---

## 7. Arquivos Esperados

| Arquivo | Acao esperada |
|---|---|
| `cuca-portal/package.json` | Atualizar scripts e devDependencies |
| `cuca-portal/package-lock.json` | Gerar/versionar lockfile |
| `cuca-portal/vitest.config.ts` | Criar configuracao Vitest |
| `cuca-portal/src/test/setup.ts` | Criar setup global de testes |
| `cuca-portal/src/**/*.test.ts(x)` | Criar ao menos um smoke test |

---

## 8. Riscos e Cuidados

| Risco | Mitigacao |
|---|---|
| Dependencias de teste irem para `dependencies` | Instalar com `npm install -D` e revisar `package.json` |
| `package-lock.json` revelar divergencias de resolucao | Rodar `npm install`, commitar lockfile e validar build |
| Teste depender de ambiente externo/Supabase | Usar smoke test isolado, sem rede e sem banco real |
| Lint continuar estourando memoria | Usar `NODE_OPTIONS=--max-old-space-size=4096` e `--cache`; se persistir, registrar causa |
| Build local exceder timeout | Registrar tempo real, saida e ponto de parada no Dev Agent Record |

---

## 9. QA Gate

**Obrigatorio antes de Ready for Review:**

- [ ] `npm run lint`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`

**Validacao de impacto:**

- [ ] Confirmar que nenhuma dependencia de teste foi adicionada em `dependencies`.
- [ ] Confirmar que o bundle/runtime do portal nao passa a depender de Vitest/Testing Library.
- [ ] Confirmar que o `cuca-worker` nao foi alterado.

---

## 10. File List

- [x] `docs/stories/SQS-52-Portal-Quality-Gates-Typecheck-Testes.md`

---

## 11. Dev Agent Record

### Debug Log

- Story criada para destravar gates minimos do `cuca-portal`.

### Completion Notes

- Pendente implementacao.

### Change Log

| Data | Agente | Acao |
|---|---|---|
| 2026-05-07 | @sm | Story tecnica SQS-52 criada para habilitar typecheck/testes no portal |
