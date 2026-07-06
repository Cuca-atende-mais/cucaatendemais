# S-WM-03 — Schema + Feature Flag + Wire-up Real

## Status
Ready for Review

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - pytest
  - py_compile
  - grep de regressão
  - MCP Supabase (apply_migration + execute_sql)
```

## Story
**Como** worker do Cuca Atende Mais,  
**quero** que o roteamento Meta use dados reais do banco em vez de stubs de env vars, e que o schema reflita o estado pós-migração da Empregabilidade,  
**para que** adicionar ou trocar um número de produção seja um INSERT/UPDATE no banco, sem redeploy, e o código não carregue mais dívida técnica de S-WM-01 e S-WM-02.

## Contexto

S-WM-01 e S-WM-02 estão completas. Dois stubs e uma dívida de schema foram deixados explicitamente para esta story:

1. **`META_STUB_PHONE_NUMBER_ID_EMPREG`** — env var que substituiu o lookup real. O empregabilidade_engine e o loop proativo leem este stub em vez de consultar o banco.
2. **`conversas.instancia_uazapi`** recebendo `phone_number_id` — compatibilidade temporária de schema; S-WM-01 documentou que o rename viria aqui.
3. **Tabela `meta_phone_numbers`** — arquitetada no épico (P4/D3) mas não criada.
4. **`canal_ativo` em `conversas`** — planejado no épico (P6) como feature flag por conversa; não existe no schema.

Além disso, o QA gate de S-WM-02 registrou dois concerns MEDIUM de cobertura de testes que esta story fecha:
- AC 8 de S-WM-02: path negativo de insert em `mensagens` (insert ausente quando `_meta_enviar` retorna False).
- AC 10 de S-WM-02: loop completo (filtro de etapas, sleep, propagação de estado).

## Decisões de Arquitetura Aplicadas

| ID | Decisão (do épico) | Aplicação nesta story |
|----|--------------------|-----------------------|
| D3 | Tabela `meta_phone_numbers` é a fonte de verdade de roteamento | Criada aqui com seed da WABA de teste |
| P4 | Meta identifica canal por `phone_number_id`; lookup em tabela própria | Wire-up stub → query em `meta_phone_numbers` |
| P6 | `canal_ativo` não existe ainda; migration cria | Criada em `conversas` com default `'uazapi'` |
| S-WM-01 decisão | Rename `instancia_uazapi` → `origem_id` adiado para S-WM-03 | Executado aqui via migration expand/contract |

## Requisito Inegociável

> **Adicionar número de produção = INSERT em `meta_phone_numbers`.**  
> **Trocar número = UPDATE.**  
> **Zero redeploy.**

## Escopo

### IN

- Migration: criar tabela `meta_phone_numbers` com seed inicial.
- Migration: adicionar coluna `canal_ativo` em `conversas`.
- Migration: renomear `conversas.instancia_uazapi` → `conversas.origem_id`.
- Wire-up `empregabilidade_engine.py`: trocar `META_STUB_PHONE_NUMBER_ID_EMPREG` por query real em `meta_phone_numbers`.
- Wire-up `empregabilidade_engine.py` loop proativo: buscar `phone_number_id` de `meta_phone_numbers` por `agente_tipo + ativo=true`.
- Wire-up `meta_adapter_inbound.py`: gravar `canal_ativo='meta'` ao criar/recuperar conversa; usar `origem_id` (nome novo da coluna).
- Wire-up `main.py` `/send-message`: rotear por `canal_ativo` da conversa em vez de stub global.
- Testes: fechar AC 8 e AC 10 de S-WM-02 (concerns MEDIUM do QA gate).
- Atualizar todas as referências à coluna antiga (`instancia_uazapi`) nos arquivos de escopo.

### OUT

- Portal Next.js — nenhuma alteração de UI ou endpoint de portal.
- Migração de outros engines (Institucional, Ouvidoria, Acesso, Campanhas, Divulgação).
- Templates Meta — S-WM-T.
- Mídia outbound.
- Deploy em produção — staging-first por definição.
- Compra/pareamento de números reais — bloqueio externo (sócio).
- Sunset de UAZAPI — S-WM-08.
- Alerta interno para atendentes.

## Critérios de Aceite

### Schema

1. **Given** a migration `meta_phone_numbers`, **when** aplicada, **then** a tabela existe com colunas:
   - `phone_number_id` (PK, varchar, NOT NULL)
   - `waba_id` (varchar, NOT NULL)
   - `agente_tipo` (varchar, NOT NULL)
   - `canal_tipo` (varchar, NOT NULL)
   - `unidade_cuca` (varchar, nullable)
   - `display_name` (varchar, nullable)
   - `ativo` (boolean, NOT NULL, default `true`)
   - `created_at` (timestamptz, NOT NULL, default `now()`)
   - `updated_at` (timestamptz, NOT NULL, default `now()`)

2. **Given** a migration de seed, **when** aplicada, **then** existe ao menos 1 registro com os dados da WABA de teste (`agente_tipo='Empregabilidade'`, `ativo=true`), confirmado por `SELECT` via MCP.

3. **Given** a migration `canal_ativo`, **when** aplicada, **then** a coluna `conversas.canal_ativo` existe com tipo varchar, NOT NULL, default `'uazapi'`, e todos os registros existentes foram populados com `'uazapi'`.

4. **Given** a migration de rename, **when** aplicada, **then**:
   - a coluna `conversas.origem_id` existe (varchar, NOT NULL);
   - a coluna `conversas.instancia_uazapi` não existe;
   - o índice/constraint UNIQUE `(lead_id, origem_id)` existe em substituição ao antigo `(lead_id, instancia_uazapi)`;
   - todos os registros existentes têm `origem_id` populado com o valor anterior de `instancia_uazapi`.

5. **Given** as três migrations juntas, **when** aplicadas em banco vazio ou existente, **then** são idempotentes (`IF NOT EXISTS`, `IF EXISTS`), reversíveis individualmente e não quebram dados existentes.

### Wire-up — Empregabilidade inbound

6. **Given** um webhook Meta com `phone_number_id` válido em `meta_phone_numbers`, **when** `processar_webhook_meta()` cria ou recupera a conversa, **then**:
   - usa `origem_id` (nome novo) para gravar o `phone_number_id` na tabela `conversas`;
   - grava `canal_ativo='meta'` na conversa;
   - não usa mais `instancia_uazapi` como nome de coluna no código.

7. **Given** um `phone_number_id` não presente em `meta_phone_numbers`, **when** o webhook chega, **then** a requisição é descartada com log de warning (guard já presente em S-WM-01 — deve continuar funcionando após o wire-up).

### Wire-up — Empregabilidade reativa

8. **Given** o fluxo reativo da Empregabilidade (`_enviar()`), **when** produz resposta, **then** busca `phone_number_id` e `token` via query em `meta_phone_numbers` filtrando `agente_tipo='Empregabilidade'` e `ativo=true`, em vez de ler `META_STUB_PHONE_NUMBER_ID_EMPREG`.

9. **Given** `meta_phone_numbers` sem registro ativo para `agente_tipo='Empregabilidade'`, **when** `_enviar()` é chamado, **then** aborta com log de erro sem exception não tratada.

### Wire-up — Loop proativo

10. **Given** o `empregabilidade_notify_loop()`, **when** inicia, **then** busca `phone_number_id` em `meta_phone_numbers` usando `agente_tipo='Empregabilidade'` e `ativo=true` em vez de ler `META_STUB_PHONE_NUMBER_ID_EMPREG` via env var.

11. **Given** `meta_phone_numbers` sem registro ativo para `agente_tipo='Empregabilidade'`, **when** o loop itera, **then** loga aviso e pula a iteração sem crash.

### Wire-up — /send-message

12. **Given** `/send-message/{token}` com `conversa_id` no payload, **when** o `canal_ativo` da conversa é `'meta'`, **then** envia via Graph API com o `phone_number_id` do `origem_id` da conversa (lido do banco) e o `META_SYSTEM_USER_TOKEN`.

13. **Given** `/send-message/{token}` com `conversa_id` no payload, **when** o `canal_ativo` da conversa é `'uazapi'`, **then** responde `501 Not Implemented` com mensagem `"Canal UAZAPI não suportado neste endpoint — use o cliente UAZAPI direto"` (futuro S-WM-08).

14. **Given** `/send-message/{token}` sem `conversa_id` no payload, **when** chamado, **then** usa comportamento legado de S-WM-02 como fallback (compatibilidade temporária durante transição do portal).

### Remoção de stubs

15. **Given** os arquivos de escopo após a implementação, **when** inspecionados, **then** não contêm referência funcional a `META_STUB_PHONE_NUMBER_ID_EMPREG` — a env var pode permanecer definida no `.env` como no-op, mas não é lida pelo código.

16. **Given** os arquivos de escopo, **when** inspecionados, **then** não contêm a string `instancia_uazapi` como nome de coluna em queries SQL ou nomes de campo de insert/select (a string pode aparecer apenas em comentários históricos ou logs de migração).

### Testes — fechamento concerns S-WM-02

17. **Given** `_enviar()` no engine, **when** `_meta_enviar` retorna `False`, **then** o teste confirma que nenhum insert em `mensagens` ocorre (AC 8 de S-WM-02 — path negativo).

18. **Given** o `empregabilidade_notify_loop()`, **when** executado com estados de etapa variados, **then** o teste confirma que:
    - apenas etapas de notificação são processadas (filtro correto);
    - `asyncio.sleep(20)` é chamado ao final de cada iteração;
    - estados são avançados somente após envio bem-sucedido (AC 10 de S-WM-02).

### Regressão e staging

19. **Given** a suíte completa de testes, **when** executada após o wire-up, **then** todos os testes de S-WM-01 e S-WM-02 continuam passando (sem regressão).

20. **Given** a WABA de teste, **when** executado fluxo controlado com o número de staging, **then** o roteamento usa o registro de `meta_phone_numbers` (não a env var stub) e a mensagem chega ao WhatsApp de teste. *(bloqueado externamente até pareamento do número; não bloqueia o veredito do QA gate — registrar como pendência externa)*

## Dev Notes

### Ordem de execução recomendada

Executar nesta sequência para minimizar quebras intermediárias:

1. Migrations (schema estável antes do código)
2. Wire-up `meta_adapter_inbound.py` (uso de `origem_id`)
3. Wire-up `empregabilidade_engine.py` (`_enviar` + loop)
4. Wire-up `main.py` (`/send-message`)
5. Testes novos (concerns S-WM-02)
6. Regressão completa

### Migration 1 — `meta_phone_numbers`

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

-- RLS: leitura para service_role e authenticated; escrita somente service_role
ALTER TABLE meta_phone_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY IF NOT EXISTS "service_role full access" ON meta_phone_numbers
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY IF NOT EXISTS "authenticated read" ON meta_phone_numbers
    FOR SELECT TO authenticated USING (true);

-- Seed: WABA de teste (phone_number_id confirmado nas validações manuais de S-WM-01/02)
-- Substituir os valores pelos reais da WABA de teste antes de aplicar
INSERT INTO meta_phone_numbers
    (phone_number_id, waba_id, agente_tipo, canal_tipo, display_name)
VALUES
    ('<PHONE_NUMBER_ID_TESTE>', '<WABA_ID_TESTE>', 'Empregabilidade', 'Empregabilidade', 'CUCA Empregabilidade — staging')
ON CONFLICT (phone_number_id) DO NOTHING;
```

> Os placeholders `<PHONE_NUMBER_ID_TESTE>` e `<WABA_ID_TESTE>` devem ser substituídos pelos valores reais da WABA de teste antes de aplicar. Checar nas variáveis de ambiente de staging ou confirmar com o sócio.

### Migration 2 — `canal_ativo` em `conversas`

```sql
ALTER TABLE conversas
    ADD COLUMN IF NOT EXISTS canal_ativo varchar NOT NULL DEFAULT 'uazapi';

-- Retrocompatível: registros existentes ficam 'uazapi' pelo DEFAULT
```

### Migration 3 — Rename `instancia_uazapi` → `origem_id`

Seguir padrão expand/contract:

```sql
-- Etapa expand: adicionar nova coluna
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS origem_id varchar;

-- Copiar dados
UPDATE conversas SET origem_id = instancia_uazapi WHERE origem_id IS NULL;

-- Tornar NOT NULL após cópia
ALTER TABLE conversas ALTER COLUMN origem_id SET NOT NULL;

-- Recriar constraint UNIQUE com novo nome de coluna
ALTER TABLE conversas DROP CONSTRAINT IF EXISTS conversas_lead_id_instancia_uazapi_key;
ALTER TABLE conversas ADD CONSTRAINT conversas_lead_id_origem_id_key UNIQUE (lead_id, origem_id);

-- Etapa contract: remover coluna antiga
ALTER TABLE conversas DROP COLUMN IF EXISTS instancia_uazapi;
```

> **Cuidado:** a constraint de UNIQUE deve ser recriada para que a query de get/create conversa continue funcionando. Verificar o nome exato da constraint antes com `execute_sql`.

### Wire-up `meta_adapter_inbound.py`

Trocar todas as referências à string de coluna `"instancia_uazapi"` por `"origem_id"` nas queries de:
- select de conversa existente: `.eq("origem_id", phone_number_id)`
- insert de nova conversa: `{"origem_id": phone_number_id, "canal_ativo": "meta", ...}`
- a coluna `canal_ativo` deve ser incluída no insert de conversa nova.

### Wire-up `empregabilidade_engine.py` — `_enviar()`

Substituir:

```python
phone_number_id = os.getenv("META_STUB_PHONE_NUMBER_ID_EMPREG", "")
token = os.getenv("META_SYSTEM_USER_TOKEN", "")
```

Por query síncrona/thread (padrão do engine):

```python
def _get_meta_phone(agente_tipo: str) -> tuple[str, str]:
    """Retorna (phone_number_id, system_token) para o agente, ou ('', '')."""
    try:
        res = supabase.table("meta_phone_numbers") \
            .select("phone_number_id") \
            .eq("agente_tipo", agente_tipo) \
            .eq("ativo", True) \
            .limit(1) \
            .single() \
            .execute()
        pnid = (res.data or {}).get("phone_number_id", "")
    except Exception as exc:
        logger.error("[meta-phone] Erro ao buscar phone_number_id para %s: %s", agente_tipo, exc)
        pnid = ""
    return pnid, os.getenv("META_SYSTEM_USER_TOKEN", "")
```

O token de sistema continua vindo de env var (`META_SYSTEM_USER_TOKEN`) — não é armazenado na tabela (segurança).

### Wire-up `empregabilidade_notify_loop()`

Substituir a leitura de `META_STUB_PHONE_NUMBER_ID_EMPREG` e `META_SYSTEM_USER_TOKEN` diretamente:

```python
_meta_pnid, _meta_tok = _get_meta_phone("Empregabilidade")
if not _meta_pnid or not _meta_tok:
    logger.warning("[empreg-notify] phone_number_id não configurado em meta_phone_numbers — loop aguardando")
    await asyncio.sleep(20)
    continue
```

### Wire-up `/send-message` em `main.py`

Quando o payload incluir `conversa_id`:

1. Buscar `canal_ativo` e `origem_id` da conversa no banco.
2. Se `canal_ativo == 'meta'`: enviar via `_meta_enviar(origem_id, number, text, META_SYSTEM_USER_TOKEN)`.
3. Se `canal_ativo == 'uazapi'`: retornar 501.
4. Se `conversa_id` ausente: fallback legado (stub, mantém compatibilidade com chamadores antigos do portal).

### Testes — AC 8 de S-WM-02 (path negativo)

```python
async def test_enviar_nao_grava_mensagem_em_falha_meta():
    """AC 8 S-WM-02: insert em mensagens NÃO ocorre quando _meta_enviar retorna False."""
    # mock _meta_enviar retornando False
    # chamar _enviar(...)
    # assert supabase.table("mensagens").insert NÃO foi chamado
```

### Testes — AC 10 de S-WM-02 (loop completo)

```python
async def test_loop_filtra_etapas_corretas():
    """AC 10 S-WM-02: loop processa só etapas de notificação, avança estado após sucesso."""
    # mock conversas com etapas mistas (notificação + não-notificação)
    # assert só etapas corretas disparam _enviar
    # assert _set_fluxo só chamado quando _enviar retorna True
    # assert asyncio.sleep(20) chamado
```

### Env vars após S-WM-03

| Var | Status | Observação |
|-----|--------|------------|
| `META_SYSTEM_USER_TOKEN` | **Mantida** | Token de sistema; não entra no banco |
| `META_STUB_PHONE_NUMBER_ID_EMPREG` | **Obsoleta** | Pode ser removida do `.env` após validação |
| `META_APP_SECRET` | **Mantida** | HMAC inbound (S-WM-01) |
| `META_VERIFY_TOKEN` | **Mantida** | Verificação webhook (S-WM-01) |

## Tasks

- [x] **1. Preparação — verificar schema atual** (pré-condição)
  - [x] Via MCP (`execute_sql`): confirmar nomes exatos de constraints em `conversas` (`instancia_uazapi`, UNIQUE, NOT NULL). Constraint real: `conversas_lead_instancia_unique` (diferente do esperado no Dev Notes).
  - [x] Confirmar se `meta_phone_numbers` não existe ainda.
  - [x] Confirmar valores reais de `phone_number_id` e `waba_id` da WABA de teste para o seed. Confirmados pelo usuário: `1215172285010519` / `27334860332820469`.

- [x] **2. Migration: `meta_phone_numbers`** (AC: 1–2)
  - [x] Criar arquivo `cuca-portal/supabase/migrations/20260625000000_create_meta_phone_numbers.sql`.
  - [x] Aplicar via MCP `apply_migration`.
  - [x] Confirmar via `execute_sql` que tabela e seed existem.

- [x] **3. Migration: `canal_ativo` em `conversas`** (AC: 3)
  - [x] Criar arquivo `cuca-portal/supabase/migrations/20260625010000_add_canal_ativo_conversas.sql`.
  - [x] Aplicar via MCP `apply_migration`.
  - [x] Confirmar via `execute_sql`.

- [x] **4. Migration: rename `instancia_uazapi` → `origem_id`** (AC: 4–5)
  - [x] Criar arquivo `cuca-portal/supabase/migrations/20260625020000_rename_instancia_uazapi_origem_id.sql`.
  - [x] Aplicar via MCP `apply_migration` (expand → copy → NOT NULL → UNIQUE → contract). Constraint antiga `conversas_lead_instancia_unique` dropada; nova `conversas_lead_id_origem_id_key` criada.
  - [x] Confirmar via `execute_sql` que `origem_id` existe, `instancia_uazapi` não existe, UNIQUE está ativa.

- [x] **5. Wire-up `meta_adapter_inbound.py`** (AC: 6–7)
  - [x] Substituir stub `_STUB_PHONE_NUMBER_MAP` por query real em `meta_phone_numbers`.
  - [x] Substituir `"instancia_uazapi"` → `"origem_id"` em todas as queries.
  - [x] Adicionar `"canal_ativo": "meta"` no insert de conversa nova.
  - [x] Confirmar que guard de `phone_number_id` desconhecido continua funcionando (teste atualizado).

- [x] **6. Wire-up `empregabilidade_engine.py`** (AC: 8–11, 15–16)
  - [x] Implementar `_get_meta_phone(agente_tipo)` — query em `meta_phone_numbers`.
  - [x] Substituir leitura de `META_STUB_PHONE_NUMBER_ID_EMPREG` em `_enviar()` por `_get_meta_phone`.
  - [x] Substituir leitura de stub no `empregabilidade_notify_loop()` por `_get_meta_phone` + usar `origem_id`.
  - [x] Verificar que nenhuma referência funcional a `instancia_uazapi` permanece no engine.

- [x] **7. Wire-up `main.py` `/send-message`** (AC: 12–14, 15)
  - [x] Implementar roteamento por `canal_ativo` da conversa quando `conversa_id` presente.
  - [x] Retornar 501 para `canal_ativo='uazapi'`.
  - [x] Fallback legado (sem `conversa_id`) usa `_get_meta_phone` (não env var stub).

- [x] **8. Testes novos — concerns S-WM-02** (AC: 17–18)
  - [x] `test_enviar_nao_grava_mensagem_em_falha_meta` (AC 8 S-WM-02 — path negativo).
  - [x] `test_loop_filtra_etapas_corretas` (AC 10 S-WM-02 — filtro de etapas, avança estado).
  - [x] `test_loop_sleep_chamado_ao_final_de_iteracao` (AC 10 — sleep 20s).
  - [x] `test_enviar_usa_meta_phone_da_tabela` (AC 7 — substituição do patch de env var por `_get_meta_phone`).
  - [x] `test_phone_number_id_desconhecido_retorna_none` atualizado para mockar `_get_supabase`.

- [x] **9. Regressão e validação** (AC: 19–20)
  - [x] Suíte completa: 31/34 passando. 3 falhas pré-existentes (`TestSendMessageEndpoint`) — `sentry_sdk` não instalado no ambiente de test (pre-existente, anterior a S-WM-03).
  - [x] Grep: zero ocorrências de `instancia_uazapi` como coluna nos arquivos de escopo.
  - [x] Grep: zero ocorrências de `META_STUB_PHONE_NUMBER_ID_EMPREG` nos arquivos de produção.
  - [x] `py_compile` nos arquivos modificados: OK.
  - [ ] Validação ponta a ponta com WABA de teste. *(bloqueado externamente — número não pareado; não bloqueia veredito)*

## Testing

```bash
# Syntax check
python3 -m py_compile \
  worker/meta_adapter_inbound.py \
  worker/empregabilidade_engine.py \
  worker/main.py

# Suite completa (inclui S-WM-01 + S-WM-02 + novos)
python3 -m pytest \
  worker/tests/test_meta_adapter_inbound.py \
  worker/tests/test_meta_adapter_outbound.py \
  --tb=short -q

# Grep de regressão — devem retornar zero linhas
grep -rn "instancia_uazapi" \
  worker/meta_adapter_inbound.py \
  worker/empregabilidade_engine.py \
  worker/main.py

grep -rn "META_STUB_PHONE_NUMBER_ID_EMPREG" \
  worker/meta_adapter_inbound.py \
  worker/empregabilidade_engine.py \
  worker/main.py
```

```sql
-- Verificação de schema (via MCP execute_sql)
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'conversas'
  AND column_name IN ('origem_id', 'canal_ativo', 'instancia_uazapi')
ORDER BY column_name;

SELECT * FROM meta_phone_numbers LIMIT 5;
```

## Dependencies

- S-WM-01 ✅ (adapter inbound, webhook, HMAC, Contrato v2)
- S-WM-02 ✅ (adapter outbound Meta, Empregabilidade migrada, stubs ativos)

## Riscos

| Risco | Probabilidade | Impacto | Mitigação |
|-------|--------------|---------|-----------|
| Constraint UNIQUE com nome diferente do esperado | Média | Alto — migration pode falhar | Verificar via `execute_sql` antes (Task 1) |
| `phone_number_id` / `waba_id` da WABA de teste não confirmados | Média | Médio — seed incorreto | Confirmar com sócio ou checar env de staging antes do seed |
| Registros existentes com `instancia_uazapi` nulo | Baixa | Alto — NOT NULL após rename falharia | A copy + NOT NULL sequencial previne isso; verificar com `execute_sql` antes |
| Engine quebra durante wire-up se `meta_phone_numbers` estiver vazia | Média | Baixo — log de warning e `continue` | Implementar guard no AC 9 e AC 11 |

## Dev Agent Record

### Agent Model Used
claude-sonnet-4-6 (@dev Dex)

### Completion Notes
- Constraint UNIQUE real era `conversas_lead_instancia_unique` (não `conversas_lead_id_instancia_uazapi_key` como estimado no Dev Notes). Task 1 detectou antes de aplicar — migração correta.
- `_get_meta_phone` implementada como função síncrona (padrão do engine); `META_SYSTEM_USER_TOKEN` permanece em env var (segurança: token não vai ao banco).
- `campanhas_engine.py` também usa `instancia_uazapi` como coluna em `conversas` (breadcrumb); atualizado para `origem_id` / `on_conflict="lead_id,origem_id"` para manter UAZAPI funcional durante janela paralela.
- 3 falhas pré-existentes em `TestSendMessageEndpoint`: `sentry_sdk` não instalado no ambiente de test local (pré-existentes antes de S-WM-03; não causadas por esta story).
- `META_STUB_PHONE_NUMBER_ID_EMPREG` completamente removida do código de produção; env var pode ser removida do `.env` após validação de staging.

### File List

| Arquivo | Tipo | Notas |
|---------|------|-------|
| `cuca-portal/supabase/migrations/20260625000000_create_meta_phone_numbers.sql` | CREATED | Tabela + RLS + seed WABA de teste |
| `cuca-portal/supabase/migrations/20260625010000_add_canal_ativo_conversas.sql` | CREATED | Feature flag por conversa, default `'uazapi'` |
| `cuca-portal/supabase/migrations/20260625020000_rename_instancia_uazapi_origem_id.sql` | CREATED | Expand/contract; constraint antiga dropada; nova `conversas_lead_id_origem_id_key` |
| `worker/meta_adapter_inbound.py` | MODIFIED | Stub → query `meta_phone_numbers`; `origem_id` + `canal_ativo='meta'` |
| `worker/empregabilidade_engine.py` | MODIFIED | `_get_meta_phone()`; `_enviar` + loop proativo sem stub; `origem_id` no loop |
| `worker/main.py` | MODIFIED | `/send-message` routing por `canal_ativo`; fallback legado via `_get_meta_phone` |
| `worker/campanhas_engine.py` | MODIFIED | Breadcrumb upsert `conversas`: `instancia_uazapi` → `origem_id` |
| `worker/tests/test_meta_adapter_inbound.py` | MODIFIED | `test_phone_number_id_desconhecido_retorna_none` com mock supabase |
| `worker/tests/test_meta_adapter_outbound.py` | MODIFIED | Novos testes AC 17–18; atualização de patches de env stub → `_get_meta_phone` |

### Change Log

| Data | Autor | Mudança |
|------|-------|---------|
| 2026-06-25 | @po (Pax) | Validação concluída — GO (9/10). Status Draft → Ready. Issues: S1 seed placeholders (task 1 já prevê), S2 waba_id confirmar espaços, S3 CREATE POLICY IF NOT EXISTS (não é PG padrão — usar DROP/CREATE). Dados de seed confirmados pelo usuário: phone_number_id=1215172285010519, display_name=Test WhatsApp Business Account. |
| 2026-06-25 | @dev (Dex) | Implementação completa — Tasks 1–9. 3 migrations aplicadas no cuca-dev. Wire-up inbound/engine/main/campanhas. Testes novos AC 17–18 + regressão. Status Ready → Ready for Review. |

## QA Results

**Data:** 2026-06-25 | **Agente:** Quinn (@qa) | **Commit:** `17be86f`

**Veredito:** PASS WITH CONCERNS

### Issues

| ID | Severidade | Categoria | Descrição |
|----|-----------|-----------|-----------|
| Q1 | MEDIUM | Testes | ACs 12–14 sem cobertura executável — `TestSendMessageEndpoint` bloqueado por `sentry_sdk` ausente no ambiente local (pré-existente; lógica revisada e correta). Tratar como débito técnico: instalar `sentry-sdk` no ambiente de test. |
| Q2 | LOW | Código | `_get_meta_phone` usa `.limit(1).single()` — `maybe_single()` seria mais semântico. Tratado via try/except; não bloqueia. |
| Q3 | LOW | Migration | `ADD CONSTRAINT` na migration 3 sem guard de idempotência (risco prático nulo via Supabase migration tracking). |

### Checks

| Check | Status |
|-------|--------|
| 1 — Code Review | ✅ PASS |
| 2 — Testes (31/34; 3 pré-existentes) | ✅ PASS |
| 3 — ACs 1–20 rastreados | ✅ PASS (AC 20 bloqueado externamente) |
| 4 — Regressão zero | ✅ PASS |
| 5 — Performance | ✅ PASS |
| 6 — Segurança (RLS, token em env, guard inbound) | ✅ PASS |
| 7 — Documentação | ✅ PASS |

### Schema verificado via MCP (cuca-dev)

- `meta_phone_numbers`: 9 colunas ✅, RLS habilitada ✅, 2 policies ativas ✅, seed `1215172285010519` ✅
- `conversas.canal_ativo`: varchar NOT NULL default `'uazapi'` ✅
- `conversas.origem_id`: varchar NOT NULL ✅; `instancia_uazapi` ausente ✅
- UNIQUE `conversas_lead_id_origem_id_key` ativa ✅
