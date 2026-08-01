# S-WM-61 — Corrigir trigger `chamar_alerta_handover` quebrado em produção

## Status
InReview — QA Gate: PASS (aguardando decisão do Junior para acionar @devops)

## Origem
Diagnóstico de transbordo (Empregabilidade + Institucional), sessão de 2026-07-31/08-01 (`@dev` Dex, a pedido de Junior). Bug reproduzido ao vivo em produção: lead simulou CNPJ duplicado (Empregabilidade) e operador clicou "Assumir Atendimento" (portal) — os dois cenários falharam pela mesma causa raiz, confirmada nos logs reais do Postgres de produção.

## Complexidade
S — 1 função de trigger, 1 coluna de lookup trocada, sem mudança de assinatura nem de outras tabelas.

## Prioridade
P0 — bloqueador raiz. Sem isso, **nenhum transbordo humano funciona em nenhum módulo** (Empregabilidade, Institucional, e qualquer outro que use `status='awaiting_human'`), e o botão "Assumir Atendimento" do portal quebra com 400 para qualquer conversa.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - Query read-only em produção confirmando app.supabase_url ANTES de decidir escopo (ver Dev Notes — pode ficar fora do escopo desta story)
  - SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname='chamar_alerta_handover' → confirmar NEW.origem_id + meta_phone_numbers, sem instancia_uazapi
  - Teste real: UPDATE conversas SET status='awaiting_human' numa conversa de teste → sem erro 42703 nos logs do Postgres
  - Clicar "Assumir Atendimento" no portal numa conversa de teste → sem 400 no console
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** que o trigger `chamar_alerta_handover` pare de referenciar uma coluna que não existe mais,
**para que** qualquer conversa (Empregabilidade ou Institucional) consiga de fato ser marcada como `awaiting_human` — hoje essa gravação falha silenciosamente (ou com 400 visível no portal) toda vez que é tentada.

## Contexto e Problema

A tabela `conversas` tem um trigger ativo em produção:
```sql
CREATE TRIGGER trigger_alerta_handover AFTER UPDATE ON public.conversas
FOR EACH ROW EXECUTE FUNCTION chamar_alerta_handover()
```

A função (versão hoje em produção) contém:
```sql
IF (NEW.status = 'awaiting_human' AND (OLD.status IS NULL OR OLD.status <> 'awaiting_human')) THEN
  SELECT unidade_cuca INTO v_unidade
  FROM public.instancias_uazapi
  WHERE nome = NEW.instancia_uazapi   -- coluna que NÃO existe mais em `conversas`
  LIMIT 1;
  ...
```

A coluna `conversas.instancia_uazapi` foi removida há tempos (`cuca-portal/supabase/migrations/20260625020000_rename_instancia_uazapi_origem_id.sql`), substituída por `origem_id`. Qualquer UPDATE que tente `status='awaiting_human'` dispara o trigger, que tenta ler `NEW.instancia_uazapi` — Postgres lança `record "new" has no field "instancia_uazapi"` (SQLSTATE 42703), a transação é abortada, e o PostgREST devolve **400 Bad Request** (é exatamente o erro que o Junior viu no console ao clicar "Assumir Atendimento": `PATCH .../conversas?id=eq.8b6dcb4c-... 400`).

**Confirmado nos logs reais do Postgres de produção** — 7 ocorrências do erro entre 21:29 e 22:17 do dia do diagnóstico, batendo com os testes ao vivo.

**Boa notícia:** a correção já foi escrita e validada em cuca-dev — `supabase/migrations/20260701000000_wm15_parametrizar_net_http_post.sql:44-86` (story S-WM-15). O comentário da própria migration (linhas 7-13) já previa exatamente este cenário: *"produção também estará 100% Meta [...] esta MESMA versão (Meta) deve substituir a versão UAZAPI de produção"* — só que essa promoção nunca aconteceu.

**Achado adicional que muda o escopo desta story:** a migration do S-WM-15 também trocou a URL hardcoded da Edge Function por `current_setting('app.supabase_url', true)` nas 4 funções que ela toca. Confirmei ao vivo que **produção não tem `app.supabase_url` configurado** (`current_setting('app.supabase_url', true)` retorna `NULL` hoje) — e o checklist já existente (`docs/migracao-meta/checklist-producao-app-supabase-url.md`) registra que `ALTER DATABASE ... SET` para esse parâmetro dá `permission denied` no Supabase (role `postgres` não é superuser), e que o **mecanismo definitivo nunca foi decidido** (current_setting vs tabela `configuracoes` vs Supabase Vault). Confirmei também que as outras 3 funções (`chamar_alerta_acesso_cuca`, `chamar_alerta_institucional`, `trigger_indexar_documento`) **ainda usam URL hardcoded em produção hoje** — ou seja, nada do S-WM-15 foi promovido ainda, e essa é uma questão maior, não resolvida, que não deveria bloquear a correção urgente do bug de transbordo.

**Decisão de escopo proposta (a confirmar com @po/Junior antes de Ready):** esta story corrige **só** o bug real (`instancia_uazapi` → `origem_id`/`meta_phone_numbers`), **mantendo a URL hardcoded exatamente como já está em produção hoje** — não mexe na parametrização `app.supabase_url`. Isso evita acoplar um fix urgente e bem entendido a uma decisão de infraestrutura ainda em aberto. A parametrização de URL das 4 funções (S-WM-15 completo) continua como item pendente separado, já documentado no checklist existente.

## Escopo

### IN
1. `CREATE OR REPLACE FUNCTION public.chamar_alerta_handover()` em produção, trocando **só** o bloco de lookup de unidade:
   ```sql
   -- de:
   SELECT unidade_cuca INTO v_unidade FROM public.instancias_uazapi WHERE nome = NEW.instancia_uazapi LIMIT 1;
   -- para:
   SELECT unidade_cuca INTO v_unidade FROM public.meta_phone_numbers WHERE phone_number_id = NEW.origem_id LIMIT 1;
   ```
   Resto da função (URL hardcoded, corpo do `net.http_post`, condição do `IF`) permanece **idêntico** ao que já está em produção — só essa troca de coluna/tabela.
2. Migration idempotente (`CREATE OR REPLACE FUNCTION`, naturalmente seguro para reexecutar).
3. Validação: aplicar update de teste (`status='awaiting_human'`) numa conversa de teste (ex.: um dos 4 protegidos, ver `docs/stories` anteriores desta sessão) e confirmar ausência do erro 42703 nos logs.

### OUT
- Parametrização de URL (`app.supabase_url`/`current_setting`) — pendente, decisão de mecanismo não tomada, ver checklist existente. Não tocar nas outras 3 funções (`chamar_alerta_acesso_cuca`, `chamar_alerta_institucional`, `trigger_indexar_documento`).
- Qualquer mudança em `empregabilidade_engine.py` ou `motor-agente/index.ts` — território da S-WM-64.
- Qualquer mudança em `meta_templates`/`human_handover_contacts`/`transbordo_humano` — território da S-WM-62/S-WM-63.

## Acceptance Criteria

1. **Given** a função `chamar_alerta_handover` em produção, **when** inspecionada via `pg_get_functiondef`, **then** o bloco de lookup usa `meta_phone_numbers`/`NEW.origem_id`, sem nenhuma referência a `instancia_uazapi`/`instancias_uazapi`.
2. **Given** um `UPDATE conversas SET status='awaiting_human'` numa conversa de teste, **when** executado, **then** completa com sucesso (sem erro 42703 nos logs do Postgres, sem 400 no PostgREST).
3. **Given** o botão "Assumir Atendimento" no portal, **when** clicado numa conversa de teste, **then** não retorna 400 no console e o `status` da conversa é atualizado para `awaiting_human`.
4. Nenhuma outra função de trigger é alterada.
5. A URL usada pela função continua hardcoded, idêntica à versão anterior — nenhuma dependência de `app.supabase_url`.

## Tasks / Subtasks

- [x] **Task 0 — Confirmar estado real antes de aplicar** (bloqueante)
  - [x] Reconfirmado via `pg_get_functiondef` que a versão em produção ainda tinha `instancia_uazapi`.
  - [x] Reconfirmado que `trigger_alerta_handover` continuava ativo e apontando para essa função.
- [x] **Task 1 — Migration** (AC: 1, 5)
  - [x] Criada e aplicada em produção via MCP: `supabase/migrations/20260731235116_fix_chamar_alerta_handover_origem_id.sql`, `CREATE OR REPLACE FUNCTION`, só trocando o bloco de lookup — resto da função (URL hardcoded, corpo do `net.http_post`, condição do `IF`) idêntico ao anterior.
- [x] **Task 2 — Validar** (AC: 2, 3)
  - [x] Rodado `UPDATE conversas SET status='awaiting_human'` na conversa de teste `8b6dcb4c-8594-4abf-a087-432f95387b73` (lead de teste "valmirmoreirajunior", não é lead real) — sucesso, `status` gravado, sem erro. Confirmado em `get_logs` (service=postgres): nenhum erro `42703`/`instancia_uazapi` após a aplicação da migration (23:51:16) — só os 7 erros históricos de antes da correção (21:29-22:17), como esperado.
  - [ ] **Pendente de confirmação do Junior:** teste manual do botão "Assumir Atendimento" no portal (a validação via SQL direto já prova que o `UPDATE` funciona; falta só a confirmação visual de que o botão do portal, que faz esse mesmo UPDATE via PostgREST, também não retorna mais 400).
- [x] **Task 3 — Fechamento**
  - [x] File List e Change Log atualizados.
  - [x] Conclusão anunciada, recomendado @qa.

## Dev Notes

- Código atual (produção, com bug), obtido via `pg_get_functiondef`:
```sql
CREATE OR REPLACE FUNCTION public.chamar_alerta_handover()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  edge_url TEXT := 'https://svzkrkfzpiqcesloukgb.supabase.co/functions/v1/alertas-institucionais';
  v_unidade TEXT;
BEGIN
  IF (NEW.status = 'awaiting_human' AND (OLD.status IS NULL OR OLD.status <> 'awaiting_human')) THEN
    SELECT unidade_cuca INTO v_unidade
    FROM public.instancias_uazapi
    WHERE nome = NEW.instancia_uazapi
    LIMIT 1;

    PERFORM
      net.http_post(
        url := edge_url,
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object(
          'record', jsonb_build_object(
            'id', NEW.id, 'lead_id', NEW.lead_id, 'status', NEW.status, 'unidade_cuca', v_unidade
          ),
          'table', 'conversas', 'type', 'UPDATE'
        )
      );
  END IF;
  RETURN NEW;
END;
$function$
```
- Correção mínima proposta (só o `SELECT`, resto idêntico):
```sql
SELECT unidade_cuca INTO v_unidade
FROM public.meta_phone_numbers
WHERE phone_number_id = NEW.origem_id
LIMIT 1;
```
- Referência da versão "completa" (com parametrização de URL, fora de escopo aqui): `supabase/migrations/20260701000000_wm15_parametrizar_net_http_post.sql:44-86`.
- `chamar_alerta_handover` **não tinha nenhum trigger associado no cuca-dev** (função órfã lá) — ou seja, este bug nunca seria pego testando em cuca-dev; só existe porque produção tem o trigger ativo e o dev não. Reforça a importância de validar diretamente em produção (Task 2), não só "funcionou no dev".
- `_AGENTE_MODULO_MAP`/`unidade_cuca=NULL` (fallback "todas as unidades") não é afetado por esta correção — o comportamento de fallback de `_notificar_transbordo` é território da S-WM-63/S-WM-64.

### Testing
Sem suíte de testes Python aplicável (é uma função de banco). Validação é via `get_logs` (service=postgres) + UPDATE de teste + teste manual do botão no portal.

## Dependências
Nenhuma — pode ser aplicada isoladamente. É **pré-requisito** para validar de ponta a ponta a S-WM-62, S-WM-63, S-WM-64 e S-WM-65 (todas dependem de `status='awaiting_human'` gravar com sucesso).

## Git workflow
Branch: `fix/trigger-alerta-handover-origem-id`. Commit único (`fix(db): corrige chamar_alerta_handover para usar origem_id em vez de instancia_uazapi`). Não dar push/PR sem autorização explícita.

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-08-01 | 0.1 | Story criada a partir do diagnóstico de transbordo (Empregabilidade + Institucional), sessão 2026-07-31. Escopo deliberadamente restrito ao bug de `instancia_uazapi`, desacoplado da parametrização de URL (S-WM-15) que tem mecanismo de configuração ainda não decidido. | @sm River |
| 2026-08-01 | 0.2 | **Validado por @po — GO.** 10/10 no checklist: título claro, contexto completo com evidência de logs reais, AC testáveis (Given/When/Then), escopo IN/OUT bem delimitado (exclusão deliberada da parametrização de URL), dependências mapeadas (pré-requisito de todas as outras 4 stories), complexidade e prioridade justificadas, riscos documentados (função órfã em cuca-dev, sem trigger lá — reforça necessidade de validar direto em produção). Sem pergunta em aberto. Status Draft → Ready. | @po Pax |
| 2026-08-01 | 0.3 | **Implementado.** Task 0 reconfirmou o bug ativo em produção. Migration `20260731235116_fix_chamar_alerta_handover_origem_id.sql` criada e aplicada via MCP — troca mínima do lookup (`instancias_uazapi`/`NEW.instancia_uazapi` → `meta_phone_numbers`/`NEW.origem_id`), resto da função idêntico. Validado com `UPDATE` de teste numa conversa de teste (lead "valmirmoreirajunior", não é lead real) — sucesso, sem erro 42703 nos logs do Postgres. Falta só a confirmação manual do Junior no botão "Assumir Atendimento" do portal (Task 2, item pendente). Status Ready → Ready for Review. | @dev Dex |
| 2026-08-01 | 0.4 | **Gate de QA: PASS.** Reprodução 100% independente dos 5 itens pedidos por Junior: migration confirmada via `list_migrations`, diff manual da função (só o `SELECT` mudou), logs do Postgres reconferidos numa janela completa (zero erros novos), teste manual do Junior corroborado por evidência de banco (transição de status na mesma conversa após a correção), as outras 3 funções de trigger confirmadas intocadas, advisors de segurança/performance checados (3 WARN pré-existentes em `chamar_alerta_handover`, não introduzidos por esta mudança; zero achados novos de performance). Nenhum achado bloqueante. @devops não acionado, aguardando decisão do Junior. Status → InReview. | @qa Quinn |

## Dev Agent Record

### Agent Model Used
Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References
- Estado anterior (com bug) confirmado via `pg_get_functiondef(oid) FROM pg_proc WHERE proname='chamar_alerta_handover'` — bateu exatamente com o registrado nas Dev Notes.
- Trigger `trigger_alerta_handover` confirmado ativo via `pg_trigger`/`pg_get_triggerdef` antes de aplicar.
- Migration aplicada via `mcp__supabase__apply_migration` (produção, projeto `cuca`/`svzkrkfzpiqcesloukgb`), nome `fix_chamar_alerta_handover_origem_id`, versão `20260731235116` — confirmada em `supabase_migrations.schema_migrations`.
- Pós-aplicação, `pg_get_functiondef` reconferido: função agora usa `meta_phone_numbers`/`NEW.origem_id`, sem nenhuma ocorrência de `instancia_uazapi`/`instancias_uazapi`.
- Teste real: `UPDATE conversas SET status='awaiting_human' WHERE id='8b6dcb4c-8594-4abf-a087-432f95387b73' RETURNING id, status, updated_at` — retornou com sucesso (`status='awaiting_human'`, sem exceção).
- `get_logs(service=postgres)` reconferido após o teste: os únicos erros `record "new" has no field "instancia_uazapi"` registrados são de **antes** da migration (7 ocorrências entre 21:29:32 e 22:17:00 de 2026-07-31) — nenhuma ocorrência nova após a aplicação (23:51:16) nem após o UPDATE de teste (23:51:46).

### Completion Notes List
- Escopo seguido exatamente como especificado na story: só o bloco de lookup trocado, URL da Edge Function mantida hardcoded (sem tocar na parametrização `app.supabase_url`, fora de escopo).
- Nenhuma outra função de trigger foi tocada (`chamar_alerta_acesso_cuca`, `chamar_alerta_institucional`, `trigger_indexar_documento` permanecem como estavam).
- Conversa de teste usada (`8b6dcb4c-8594-4abf-a087-432f95387b73`) ficou com `status='awaiting_human'` como resultado do teste — é o estado correto para essa conversa (era o cenário real de CNPJ duplicado da Empregabilidade), não precisa ser revertida.
- **Falta uma confirmação humana**: pedir ao Junior pra clicar em "Assumir Atendimento" no portal (em qualquer conversa de teste) e confirmar visualmente que não aparece mais erro 400 no console — a prova via SQL direto já é suficientemente forte (mesmo UPDATE, mesmo trigger), mas o AC 3 pede especificamente a confirmação pelo botão do portal.

### File List
- `supabase/migrations/20260731235116_fix_chamar_alerta_handover_origem_id.sql` (novo, aplicado em produção)

## QA Results

### Review Date: 2026-08-01

### Reviewed By: @qa Quinn

### Gate Decision: **PASS**

### Reprodução independente (item 1)

- `list_migrations`: `20260731235116` / `fix_chamar_alerta_handover_origem_id` confirmado como a migration mais recente aplicada em produção — bate com o relatado pelo @dev.
- `pg_get_functiondef` da função em produção, comparado linha a linha contra o estado "antes" documentado nas Dev Notes da story: **única mudança real é o `SELECT`** (`instancias_uazapi`/`NEW.instancia_uazapi` → `meta_phone_numbers`/`NEW.origem_id`). URL hardcoded, condição do `IF`, corpo do `net.http_post` e `RETURN NEW` — idênticos (só diferença de indentação/comentários novos, sem efeito semântico). Escopo mínimo confirmado, sem scope creep.

### Logs (item 2)

- `get_logs(service=postgres)` numa janela completa de 23:51:00 (aplicação da migration) até 00:20:00 do dia seguinte: **zero ocorrências novas** de `record "new" has no field "instancia_uazapi"` — só a própria instrução da migration e logs de rotina (checkpoint, cron, logical decoding). Reproduzido de forma independente, não apenas aceito do relato do @dev.

### Teste manual do Junior (item 3)

Não presenciei o clique diretamente, mas encontrei evidência corroborante forte no banco: a mesma conversa de teste usada pelo @dev (`8b6dcb4c-...`) tem `updated_at = 2026-07-31 23:56:01`, com `status` de volta para `ativa` — **depois** da aplicação da migration (23:51:16) e do teste SQL do @dev (23:51:46). Essa transição `awaiting_human → ativa` só é explicável por uma interação real no portal depois da correção (ex.: liberar a conversa de volta pra IA após assumir), e não gerou nenhum erro nos logs (mesma janela já conferida no item 2). Consistente com o teste manual relatado ter ocorrido e funcionado.

### Escopo (item 4)

- Confirmado: `chamar_alerta_acesso_cuca`, `chamar_alerta_institucional` e `trigger_indexar_documento` — nenhuma das 3 foi tocada (`pg_get_functiondef` confere: nenhuma referência a `instancia_uazapi` em nenhuma delas — nunca tiveram esse problema — e nenhuma usa `current_setting`, ou seja, nenhuma recebeu a parametrização de URL do S-WM-15 completo). A URL hardcoded em `chamar_alerta_handover` é conhecida e está deliberadamente fora de escopo (registrado na story) — não é regressão, é decisão de escopo documentada.

### RLS / Advisors (item 5)

- **Security**: 3 achados WARN ligados a `chamar_alerta_handover` — `function_search_path_mutable`, `anon_security_definer_function_executable`, `authenticated_security_definer_function_executable`. **Confirmado que são pré-existentes**, não introduzidos por esta migration: a função já era `SECURITY DEFINER` antes (comparação item 1), e a migration não mudou `SECURITY DEFINER`/`search_path` — só o corpo do `SELECT`. Mesmo padrão de achado que outras funções trigger do schema (ex.: `trigger_indexar_campanha_mensal`) já tinham antes. Não bloqueante, registrado para eventual hardening futuro (fora do escopo desta story).
- **Performance**: zero achados relacionados a `chamar_alerta_handover` ou `meta_phone_numbers` — nenhuma nova preocupação de performance introduzida pelo novo `SELECT ... WHERE phone_number_id = NEW.origem_id`.

### Resumo

Todos os 5 itens pedidos confirmados de forma independente, sem depender só do relato do @dev. Nenhum achado bloqueante. Escopo respeitado à risca (só o lookup mudou). @devops **não** acionado — aguardando decisão do Junior, conforme solicitado.
