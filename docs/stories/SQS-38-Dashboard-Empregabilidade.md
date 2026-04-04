# Story: SQS-38 — Dashboard Real de Empregabilidade

**Epic:** Sprint 38 — Dashboard Real de Empregabilidade
**Status:** InProgress
**Agentes Envolvidos:** `@architect` (Design), `@dev` (Implementação)
**Dependências:** SQS-37-HF concluída (escolaridade_normalizada disponível)

---

## Visão Geral

Substituir qualquer dado fictício/mock no painel principal de Empregabilidade por dados reais vindos do Supabase. A API de analytics (`/api/empregabilidade/analytics`) deve agregar todos os indicadores necessários; o frontend deve consumir e exibir esses dados com fidelidade.

---

## Critérios de Aceite (Acceptance Criteria)

- [x] **AC-01 — Total de Vagas Abertas:** O dashboard exibe o total de vagas com `status = 'aberta'` em tempo real (via `vagas.por_status.aberta` da API). Nenhum valor hardcoded ou mock.

- [x] **AC-02 — Candidaturas por Status:** O dashboard exibe cards individuais (ou seção dedicada) para cada status de candidatura: **Pendentes**, **Selecionados**, **Contratados** e **Rejeitados**. Os valores vêm de `candidaturas.por_status` retornado pela API.

- [x] **AC-03 — Gráfico de Escolaridade:** O BarChart de escolaridade usa dados de `escolaridade_normalizada` (os 11 níveis canônicos). Proibido usar texto livre ou enums hardcoded no frontend.

- [x] **AC-04 — Vagas Mais Disputadas:** A API retorna e o dashboard exibe uma tabela/lista com as top 5 vagas com maior número de candidaturas. Cada entrada deve mostrar: título da vaga, empresa e total de candidatos.

- [x] **AC-05 — Zero Mocks/Math.random:** Nenhum dado fictício, `Math.random()` ou array estático é usado em qualquer indicador do painel de Empregabilidade.

- [x] **AC-06 — Performance da API:** Todos os agregados são calculados no lado do servidor (API route). O frontend não faz múltiplos `fetch` paralelos — consome um único endpoint `/api/empregabilidade/analytics`.

---

## Escopo

**IN:**
- `cuca-portal/src/app/api/empregabilidade/analytics/route.ts` — adicionar query de vagas mais disputadas
- `cuca-portal/src/app/(dashboard)/empregabilidade/page.tsx` — adicionar seção de candidaturas por status e vagas mais disputadas

**OUT:**
- Outras páginas do portal (vagas, candidatos, empresas)
- Worker/bot WhatsApp
- Autenticação ou RLS

---

## Complexidade

**T-shirt:** M — Adição de query SQL + novo bloco de UI

---

## Lista de Arquivos Modificados

- `cuca-portal/src/app/api/empregabilidade/analytics/route.ts`
- `cuca-portal/src/app/(dashboard)/empregabilidade/page.tsx`

---

## Change Log

| Data | Agente | Ação |
|------|--------|------|
| 2026-04-04 | @architect/@dev | Story criada e implementação executada (YOLO mode) |
