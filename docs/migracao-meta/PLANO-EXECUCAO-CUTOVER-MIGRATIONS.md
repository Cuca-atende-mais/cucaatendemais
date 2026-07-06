# Plano de Execução — Migrations para Cutover de Produção

> **Autor:** @devops (Gage) · **Data:** 2026-07-05 · **Natureza:** planejamento/documentação. **Nada aplicado, produção não tocada.**
>
> Resolve os 2 achados do **Relatório 4** (`RELATORIO-4-auditoria-seguranca-migrations.md`): dependência de ordem entre as duas pastas de migration, e a tabela de debug órfã. Consolida os 22 arquivos existentes + 1 novo em uma **única lista ordenada de execução**, pronta para seguir passo a passo no dia do cutover.

---

## ⚠️ PRÉ-CONDIÇÃO CRÍTICA — este plano exige aplicação seletiva, não um replay em massa

**Este plano NÃO pode ser executado por um mecanismo que aplica os arquivos pendentes verbatim** (ex.: `supabase db push` apontado para as pastas, ou `apply_migration` alimentado com o arquivo original sem edição). Um replay em massa de qualquer uma das pastas aplicaria os **2 itens 🔴 exatamente como o Relatório 4 mandou excluir**:

- o passo **4 é PULADO** (arquivo `seed_dev01_developer_console.sql` inteiro não entra na fila — não "aplicar e depois reverter", **não aplicar**);
- o passo **5 roda SQL manual** (o bloco da seção 2, que é o arquivo original **sem** o `INSERT` final) — **não** o arquivo `create_meta_phone_numbers.sql` como está no repositório.

Todos os demais passos (exceto os marcados 🟡, que exigem rodar uma verificação antes) são replay direto do arquivo do repositório. A coluna **"Modo"** na tabela da seção 1 marca isso passo a passo. **Se o mecanismo escolhido por Junior só suporta replay em massa de uma pasta inteira, os passos 4 e 5 precisam ser retirados manualmente do lote antes de rodar — não dá para confiar no mecanismo para pular sozinho.**

---

## 0. Pré-requisito operacional — resolve o achado #1 do Relatório 4

**As duas pastas de migration devem ser aplicadas como um único fluxo, ordenado por timestamp — nunca pasta por pasta.**

Motivo: `wm04_insert_meta_phone_numbers` (`supabase/migrations/`, timestamp `20260626000001`) faz `INSERT` na tabela `meta_phone_numbers`, que só é criada por `create_meta_phone_numbers` (`cuca-portal/supabase/migrations/`, timestamp `20260625000000`). Por sorte, **a ordem cronológica real já resolve isso** — `0625000000 < 0626000001` — então a Lista Ordenada da seção 1 já está na sequência correta. O único requisito é: **não separar por pasta na hora de aplicar.**

☐ **Confirmar com Junior:** qual mecanismo será usado para aplicar em produção (Supabase CLI, SQL Editor manual, MCP)? Se for aplicação manual arquivo a arquivo, seguir estritamente a ordem numerada da seção 1 abaixo — não a ordem "primeiro tudo de `supabase/migrations/`, depois tudo de `cuca-portal/...`".

---

## 1. Lista ordenada final de execução (22 migrations no repo, 1 excluída + 1 nova = 22 efetivamente aplicadas)

**Modo:** `replay` = aplicar o arquivo do repositório tal como está · `SQL manual` = rodar o bloco específico desta doc, não o arquivo · `PULAR` = não entra na fila de execução, de forma alguma.

| # | Timestamp | Migration | Pasta | Status | Modo | Ação no cutover |
|---|---|---|---|:---:|:---:|---|
| 1 | `20260621000000` | `seed_sys_roles_super_admin` | `supabase/` | 🟡 | replay | Rodar verificação **V1** (seção 3) → aplicar como está |
| 2 | `20260621000001` | `seed_categoria_academia_enem_e_limpa_eventos_teste` | `supabase/` | 🟡 | replay | Rodar verificação **V2** (seção 3) → aplicar só se resultado for seguro |
| 3 | `20260621000002` | `fix_unidade_cuca_admin_e_role_developer` | `supabase/` | 🟡 | replay | Rodar verificação **V3** (seção 3) → aplicar como está |
| — | `20260621000003` | ~~`seed_dev01_developer_console`~~ | `supabase/` | 🔴 | **PULAR** | **NÃO ENTRA NA FILA** — usuário de teste com senha fixa (ver seção 4) |
| 4 | `20260623000000` | `wm01_placeholder` | `supabase/` | 🟢 | replay | Aplicar (vazia, só registra no histórico de migrations) |
| 5 | `20260625000000` | `create_meta_phone_numbers` | `cuca-portal/` | 🟢 | **SQL manual** | Rodar o bloco da **seção 2** — **NÃO** o arquivo original (que tem o INSERT de teste) |
| 6 | `20260625010000` | `add_canal_ativo_conversas` | `cuca-portal/` | 🟢 | replay | Aplicar como está |
| 7 | `20260625020000` | `rename_instancia_uazapi_origem_id` | `cuca-portal/` | 🟢 | replay | Aplicar como está |
| 8 | `20260626000001` | `wm04_insert_meta_phone_numbers` | `supabase/` | 🟡 | replay | Rodar verificação **V4** (seção 3) → aplicar como está |
| 9 | `20260629000001` | `wm12_replica_identity_full_conversas_mensagens` | `supabase/` | 🟢 | replay | Aplicar como está |
| 10 | `20260629000002` | `wm13_meta_templates` | `supabase/` | 🟢 | replay | Aplicar como está |
| 11 | `20260629000003` | `wm14_corpo_texto_meta_templates` | `supabase/` | 🟢 | replay | Aplicar como está |
| 12 | `20260703000000` | `wm16_templates_relacionais` | `supabase/` | 🟢 | replay | Aplicar como está |
| 13 | `20260703220000` | `wm16_remover_templates_cuca_legado` | `supabase/` | 🟢 | replay | Aplicar como está |
| 14 | `20260704000000` | `wm16_desativar_numero_teste_institucional` | `supabase/` | 🟡 | replay | Rodar verificação **V5** (seção 3) — esperado no-op → aplicar como está |
| 15 | `20260704040000` | `debug_wamid_capture_temporario` | `supabase/` | 🟢 | replay | Aplicar como está |
| 16 | `20260704043531` | `wm17_remover_debug_wamid_capture` | `supabase/` | 🟢 | replay | Aplicar como está |
| 17 | `20260704050000` | `debug_wamid_capture_rota_temporario` | `supabase/` | 🟢 | replay | Aplicar como está |
| 18 | `20260704200000` | `wm20_wamid_dedupe_mensagens` | `supabase/` | 🟢 | replay | Aplicar como está |
| 19 | `20260705000000` | `wm19_rls_disparos_divulgacao_insert_update` | `supabase/` | 🟢 | replay | Aplicar como está |
| 20 | `20260705000001` | `wm19_meta_templates_parameter_format` | `supabase/` | 🟢 | replay | Aplicar como está |
| 21 | `20260705000002` | `wm19_leads_soft_delete` | `supabase/` | 🟢 | replay | Aplicar como está |
| 22 | `20260705100000` | **`cleanup_remove_debug_wamid_capture_rota`** (NOVA — criada nesta preparação) | `supabase/` | 🟢 | replay | Aplicar como está — resolve o achado #2 do Relatório 4 |

**Resumo:** 22 migrations no repo → **1 pulada inteira** (`seed_dev01`, passo sem número acima) + **1 nova** (`cleanup...rota`) = **22 migrations efetivamente aplicadas no cutover** (dos quais 1 — o passo 5 — é SQL manual, não replay do arquivo), em uma única sequência ordenada.

**Reconciliação com os "7 🟡" do Relatório 4** (para quem for conferir contra aquele documento): dos 7 itens amarelos listados lá, **5 viraram verificação executável aqui** (V1–V5, passos 1/2/3/8/14); **1 foi rebaixado a 🔴 e removido da fila** (`seed_dev01`, que no Relatório 4 aparecia em 🟡 e 🔴 ao mesmo tempo — o veredito final sempre foi não aplicar); **1 foi resolvido estruturalmente** (a dependência de ordem entre pastas — não sobra como checagem em tempo de execução porque a seção 0 + a ordem desta lista já a eliminam).

---

## 2. Migration #5 — aplicar em versão parcial (sem o seed de teste)

**Arquivo original:** `cuca-portal/supabase/migrations/20260625000000_create_meta_phone_numbers.sql`

**Não editar o arquivo no repositório** (já foi aplicado como está no cuca-dev; alterá-lo quebraria o histórico de migrations desse ambiente). Em produção, aplicar manualmente **apenas o bloco abaixo** — que é o arquivo original **sem** o `INSERT` final:

```sql
CREATE TABLE IF NOT EXISTS meta_phone_numbers (
    phone_number_id  varchar        NOT NULL,
    waba_id          varchar        NOT NULL,
    agente_tipo      varchar        NOT NULL,
    canal_tipo       varchar        NOT NULL,
    unidade_cuca     varchar,
    display_name     varchar,
    ativo            boolean        NOT NULL DEFAULT true,
    created_at       timestamptz    NOT NULL DEFAULT now(),
    updated_at       timestamptz    NOT NULL DEFAULT now(),
    CONSTRAINT meta_phone_numbers_pkey PRIMARY KEY (phone_number_id)
);

ALTER TABLE meta_phone_numbers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access" ON meta_phone_numbers;
CREATE POLICY "service_role full access" ON meta_phone_numbers
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated read" ON meta_phone_numbers;
CREATE POLICY "authenticated read" ON meta_phone_numbers
    FOR SELECT TO authenticated USING (true);
```

**Bloco excluído (NÃO rodar em produção):**
```sql
-- Seed: WABA de teste (dados confirmados 2026-06-25) — NÃO APLICAR EM PRODUÇÃO
INSERT INTO meta_phone_numbers
    (phone_number_id, waba_id, agente_tipo, canal_tipo, display_name)
VALUES
    ('1215172285010519', '27334860332820469', 'Empregabilidade', 'Empregabilidade', 'Test WhatsApp Business Account')
ON CONFLICT (phone_number_id) DO NOTHING;
```

---

## 3. Verificações manuais — comandos prontos para rodar e confirmar

Cada bloco abaixo é **read-only** (só `SELECT`) exceto onde indicado. Rodar no SQL Editor de produção antes de aplicar a migration correspondente.

### V1 — antes da migration #1 (`seed_sys_roles_super_admin`)

```sql
-- 1) Confirmar se o role 'Super Admin Cuca' já existe (não deveria)
SELECT id, name, description FROM sys_roles WHERE name = 'Super Admin Cuca';

-- 2) Confirmar que o e-mail de dev não existe em produção (o UPDATE deve ser no-op)
SELECT id, email, role_id FROM colaboradores WHERE email = 'admin@cucadev.com.br';
```
**Esperado:** ambas retornam 0 linhas. Se a query 1 retornar 1 linha, a migration é idempotente mesmo assim (reaproveita o `id` existente) — só confirme que a intenção de ter esse role em produção é sua. Se a query 2 retornar 1 linha, pare e avise antes de aplicar (o e-mail de dev não deveria existir em produção).

**Decisão:** ☐ Aplicar  ☐ Ajustar antes de aplicar

---

### V2 — antes da migration #2 (`seed_categoria_academia_enem_e_limpa_eventos_teste`)

```sql
-- Ver EXATAMENTE quais linhas seriam apagadas pelo DELETE, antes de decidir
SELECT id, titulo, data_inicio, categorias_alvo, created_at
FROM eventos_pontuais
WHERE data_inicio IS NULL
ORDER BY created_at;
```
> Corrigido em 2026-07-05 após o ensaio de rollback em staging: a query original referenciava `categoria_id`, coluna que não existe em `eventos_pontuais` (a coluna real é `categorias_alvo`, jsonb) — erro pego ao rodar de verdade contra cuca-dev, não em revisão de texto.
**Critério de decisão:** se **todas** as linhas retornadas tiverem título com sufixo `(Teste)` (ou claramente forem placeholders), a migration é segura — pode aplicar (o `DELETE` afeta só essas linhas). Se **qualquer linha** parecer um evento real (sem o sufixo, com dados de produção plausíveis), **NÃO aplicar o DELETE** — extrair o texto do `INSERT` da categoria separadamente e tratar o `DELETE` manualmente, linha a linha, ou pular esta migration inteira e criar uma versão sem o `DELETE`.

**Decisão:** ☐ Todas as linhas são teste — aplicar como está  ☐ Há linha real — NÃO aplicar o DELETE (separar o INSERT da categoria)

---

### V3 — antes da migration #3 (`fix_unidade_cuca_admin_e_role_developer`)

```sql
-- 1) Confirmar se esse user_id específico (UUID de cuca-dev) existe em produção
SELECT user_id, email, unidade_cuca FROM colaboradores WHERE user_id = '06d8d6fc-e287-40a1-aa4b-1cf3c6c7c3ab';

-- 2) Confirmar estado atual do role Developer
SELECT name, unidade_cuca FROM sys_roles WHERE name = 'Developer';
```
**Esperado:** query 1 retorna 0 linhas (UUID pertence ao ambiente cuca-dev) — se retornar 1 linha, confirme antes que é de fato o registro do admin de produção e que faz sentido limpar a `unidade_cuca` dele. Query 2: se retornar 0 linhas, a 2ª parte da migration é no-op (role ainda não existe em produção); se retornar 1 linha com `unidade_cuca` preenchida, confirme que zerar esse campo é a mudança desejada.

**Decisão:** ☐ Aplicar  ☐ Ajustar antes de aplicar

---

### V4 — antes da migration #8 (`wm04_insert_meta_phone_numbers`)

```sql
-- Confirmar que a tabela ainda não tem estes phone_number_id (evita dado divergente)
SELECT phone_number_id, display_name, ativo FROM meta_phone_numbers;
```
**Esperado:** 0 linhas (tabela recém-criada pela migration #5) ou, se houver linhas, nenhuma com `phone_number_id` = `1233832826470497` ou `1245704551949387`.

**Confirmação adicional (não é SQL — é checagem manual no Meta Business Manager):** confirmar que `1233832826470497` (Institucional) e `1245704551949387` (Empregabilidade) são de fato os `phone_number_id` corretos e ativos da conta de produção antes de aplicar. Isso não dá para verificar via banco — só no painel da Meta.

**Decisão:** ☐ Números confirmados no Meta Business Manager — aplicar  ☐ Divergência encontrada — não aplicar, corrigir valores primeiro

---

### V5 — antes da migration #14 (`wm16_desativar_numero_teste_institucional`)

```sql
-- Confirmar que o número de teste NÃO está em produção (esperado, já que a migration #5
-- foi aplicada sem o INSERT de teste — ver seção 2)
SELECT phone_number_id, ativo FROM meta_phone_numbers WHERE phone_number_id = '1215172285010519';
```
**Esperado:** 0 linhas → esta migration aplica como **no-op seguro** (o `UPDATE` não casa nenhuma linha, sem erro). Se por algum motivo retornar 1 linha (por exemplo, se o número de teste tiver sido inserido manualmente por engano), a migration ainda é segura de aplicar — ela só desativaria esse número, que de qualquer forma não deveria estar ativo em produção.

**Decisão:** ☐ Confirmado 0 linhas — aplicar (no-op esperado)  ☐ Encontrou linha — investigar antes

---

## 4. Migrations excluídas — nunca aplicar em produção

| Migration | Motivo | Tratamento |
|---|---|---|
| `20260621000003_seed_dev01_developer_console` | Cria `dev01@cucadev.com.br` em `auth.users` com senha fixa (`DevCuca2026!temp`) | **Excluída inteira** da lista de execução (posição 4 riscada na seção 1) |
| Bloco `INSERT` dentro de `create_meta_phone_numbers` (migration #5) | Insere `phone_number_id='1215172285010519'` como "Test WhatsApp Business Account" | **Excluído do arquivo aplicado** — ver versão parcial na seção 2 |

---

## 5. Checklist consolidado — dia do cutover

```
☐ 0. Confirmar com Junior o mecanismo de aplicação (CLI/manual/MCP) e que será
     um fluxo ÚNICO ordenado por timestamp, não pasta por pasta.
☐ 0b. Pré-requisitos do Relatório 3 (tag de restauração + backup com timestamp
      + registro da imagem EasyPanel atual) já feitos ANTES do passo 1 abaixo.

☐ 1. seed_sys_roles_super_admin           → rodar V1 → aplicar
☐ 2. seed_categoria_academia_enem...      → rodar V2 → aplicar (condicional)
☐ 3. fix_unidade_cuca_admin_e_role_dev... → rodar V3 → aplicar
   [seed_dev01_developer_console          → EXCLUÍDA, pular]
☐ 4. wm01_placeholder                     → aplicar
☐ 5. create_meta_phone_numbers            → aplicar VERSÃO PARCIAL (seção 2)
☐ 6. add_canal_ativo_conversas            → aplicar
☐ 7. rename_instancia_uazapi_origem_id    → aplicar
☐ 8. wm04_insert_meta_phone_numbers       → rodar V4 → aplicar
☐ 9. wm12_replica_identity_full...        → aplicar
☐ 10. wm13_meta_templates                 → aplicar
☐ 11. wm14_corpo_texto_meta_templates     → aplicar
☐ 12. wm16_templates_relacionais          → aplicar
☐ 13. wm16_remover_templates_cuca_legado  → aplicar
☐ 14. wm16_desativar_numero_teste_inst... → rodar V5 → aplicar (no-op esperado)
☐ 15. debug_wamid_capture_temporario      → aplicar
☐ 16. wm17_remover_debug_wamid_capture    → aplicar
☐ 17. debug_wamid_capture_rota_temporario → aplicar
☐ 18. wm20_wamid_dedupe_mensagens         → aplicar
☐ 19. wm19_rls_disparos_divulgacao_...    → aplicar
☐ 20. wm19_meta_templates_parameter_...   → aplicar
☐ 21. wm19_leads_soft_delete              → aplicar
☐ 22. cleanup_remove_debug_wamid_capture_rota (NOVA) → aplicar

☐ Pós-cutover: rodar Fase 5 do Relatório 3 (healthcheck + fluxo E2E + contagens de tabela).
```

---

## ⚠️ Risco conhecido — ordem de aplicação real pode divergir da ordem por nome de arquivo (passos 15–17)

Achado no ensaio de rollback em staging (`ENSAIO-ROLLBACK-STAGING-20260705.md`): em cuca-dev, a ordem **real de aplicação** das 3 migrations de debug wamid (passos 15–17) não seguiu a ordem dos nomes de arquivo — `debug_wamid_capture_rota_temporario` foi aplicada **antes** de `wm17_remover_debug_wamid_capture`, o inverso do que os timestamps sugerem. Resultado nesse ambiente: nenhuma das duas tabelas de debug sobrou.

**Isso não significa que o passo 22 (cleanup) seja dispensável.** Produção provavelmente aplica via `supabase db push`, que respeita a ordem por nome de arquivo — nesse caso a sequência real seria `040000 → 043531 → 050000`, deixando `_debug_wamid_capture_rota` órfã (exatamente o que o Relatório 4 descreveu, e por isso o passo 22 continua na lista). O ponto de atenção é o oposto: **se o mecanismo de aplicação em produção não for estritamente ordenado por timestamp de arquivo** (aplicação manual fora de ordem, por exemplo), o comportamento pode divergir do que foi observado em staging — o passo 22 (`DROP TABLE IF EXISTS`) é seguro em qualquer um dos dois cenários (idempotente), mas vale confirmar com Junior qual mecanismo real será usado (ver seção 0).

---

## Referências

- `RELATORIO-1-diff-codigo-main-vs-develop.md` — escopo do delta e itens fora do escopo Meta
- `RELATORIO-2-diff-variaveis-ambiente.md` — checklist de env vars do cutover
- `RELATORIO-3-plano-de-rollback.md` — procedimento de rollback e pré-requisitos de backup
- `RELATORIO-4-auditoria-seguranca-migrations.md` — análise de risco estrutural que originou este plano
- `ENSAIO-ROLLBACK-STAGING-20260705.md` — execução real deste plano em staging (cuca-dev): backup, aplicação e restore validados
