# SQS-48 — Fix Completo: Transbordo Empregabilidade + Portal de Atendimento

**Status:** Done
**Criado em:** 2026-04-18
**Prioridade:** Alta — bloqueava homologação do fluxo de atendimento humano

---

## Contexto

Após os fixes da SQS-45 (transbordo genérico e institucional), o transbordo da **Empregabilidade** ainda não funcionava, o portal de atendimento tinha a caixa de mensagem bloqueada, e o botão "Retornar para IA" não existia. Esta story documenta todos os erros encontrados, causas raiz, e os passos corretos que deveriam ter sido executados — servindo como skill/referência para implementações futuras.

---

## Problemas Identificados (Análise desta Sessão)

---

### BUG-1 — Transbordo Empregabilidade: mecanismo de disparo muito restrito

**Sintoma:** Worker não reagia. Logs mostravam apenas polling de background, nenhum `GET human_handover_contacts`.

**Causa raiz:**
O `empregabilidade_engine.py` tem apenas UM caminho para disparar transbordo:
```python
# linha ~1691
if cm_meta.get("ultima_intencao") == "duvida":
    ...dispara handover...
```

E `ultima_intencao = "duvida"` é setado SOMENTE quando o lead responde `"3"` ou `"dúvida"` a um convite de entrevista:
```python
# linha ~1779
if texto_norm.lower() in ("3", "dúvida", "duvida"):
    cm["ultima_intencao"] = "duvida"
```

Não há nenhum mecanismo geral de handover para conversas normais (lead procurando emprego, empresa cadastrando vaga, etc.). O `[[HANDOVER]]` do `main.py` genérico (linhas 650-739) **nunca alcança** o código de empregabilidade — pois o fluxo faz `return` imediatamente após chamar `processar_mensagem_empregabilidade`.

**Fix aplicado:**
Adicionar detecção por expressão natural **antes** do roteamento de perfil, no topo de `processar_mensagem_empregabilidade`:
```python
_CONTAINS_HANDOVER = {
    "falar com humano", "falar com um humano",
    "falar com atendente", "quero atendente",
    "atendimento humano", "falar com alguém", ...
}
if any(kw in texto.strip().lower() for kw in _CONTAINS_HANDOVER):
    # busca human_handover_contacts modulo=empregabilidade
    # dispara alerta + atualiza status awaiting_human
    return
```

**Lição:** Em engines state machine (sem LLM), o handover deve ser detectado por expressão natural antes do roteamento de perfil. Em engines com LLM (como institucional), o motor já retorna `handover: true`.

---

### BUG-2 — Transbordo não pausava a IA (status não virava `awaiting_human`)

**Sintoma:** Transbordo disparava e enviava WhatsApp para equipe, mas no portal o input continuava bloqueado (cinza, `pointer-events-none`).

**Causa raiz:**
O bloco de handover em `empregabilidade_engine.py` enviava a notificação via UAZAPI mas **não atualizava o status da conversa**:
```python
async with httpx.AsyncClient() as hc:
    await hc.post(f"{UAZAPI_URL}/send/text", ...)  # notifica equipe ✅
await _enviar(instance_name, token, phone, "estou te encaminhando...")  # avisa lead ✅
return  # ← sai sem atualizar status ❌
```

No `chat-window.tsx`, o input fica desabilitado quando `conversation.status === 'ativa'`:
```tsx
// line 306
conversation?.status === 'ativa' && "opacity-50 pointer-events-none grayscale"
```

Logo, sem mudar o status, o portal nunca desbloqueia o campo de texto.

**O mesmo bug existia** no bloco de `ultima_intencao == "duvida"`.

**Fix aplicado** (em ambos os blocos de handover):
```python
# Após enviar notificação e antes do return:
supabase.table("conversas").update({"status": "awaiting_human"}).eq("id", conversa_id).execute()
```

**Lição:** Todo fluxo de handover DEVE atualizar `status = awaiting_human` na tabela `conversas` para que o portal reflita o estado correto via Realtime.

---

### BUG-3 — Portal: botão "Retornar para IA" inexistente

**Sintoma:** Após assumir atendimento, não havia como re-ativar a IA pelo portal. O operador ficava preso em `awaiting_human` para sempre.

**Causa raiz:**
O `chat-window.tsx` só tinha o botão "Assumir Atendimento" (ativa → awaiting_human). Não havia o botão inverso.

**Fix aplicado** em `chat-window.tsx`:
```tsx
// Nova função
async function handleRetornarIA() {
    await supabase.from("conversas")
        .update({ status: "ativa", updated_at: new Date().toISOString() })
        .eq("id", conversationId);
    toast.success("IA reativada.");
}

// Novo botão — aparece quando status === 'awaiting_human'
{conversation?.status === 'awaiting_human' && hasPermission(moduloAtendimento, "update") && (
    <Button onClick={handleRetornarIA}>
        <Zap className="h-3 w-3" /> Retornar para IA
    </Button>
)}
```

**Lição:** Sempre implementar os dois lados de um toggle de estado: Assumir ↔ Retornar.

---

### BUG-4 — RLS: INSERT em `mensagens` bloqueado para Admin Empregabilidade (403)

**Sintoma:** Após assumir atendimento, clicar em Enviar retornava 403 no console.

**Causa raiz:**
A policy de INSERT em `mensagens` era:
```sql
WITH CHECK (
    auth.role() = 'service_role'
    OR has_permission('leads', 'create')  -- ← muito restrito
)
```

A função `has_permission('leads', 'create')` verifica módulos com `LIKE 'leads%'`. O role `Admin Empregabilidade` tem todos os módulos `leads_*` com `can_create = false`. Resultado: 403 para esse role.

**Fix aplicado** (migration `fix_mensagens_insert_rls_atendimentos`):
```sql
DROP POLICY "Mensagens: Criação permitida para service_role" ON mensagens;
CREATE POLICY "Mensagens: Criação permitida para service_role" ON mensagens
FOR INSERT WITH CHECK (
    auth.role() = 'service_role'
    OR has_permission('leads', 'create')
    OR has_permission('atendimentos', 'create')  -- ← cobre todos os roles de atendimento
);
```

`has_permission('atendimentos', 'create')` usa `LIKE 'atendimentos%'`, cobrindo:
- `atendimentos_empregabilidade` → Admin Empregabilidade ✅
- `atendimentos_institucional` → Gerente, Institucional ✅
- `atendimentos_programacao` → Gerente, Institucional ✅
- `atendimentos` → Auxiliar administrativo ✅

**Lição:** Policies de tabelas de atendimento (mensagens, conversas) devem incluir `has_permission('atendimentos', 'create/update')` além de `has_permission('leads', ...)`.

---

### BUG-5 — RLS: UPDATE em `conversas` sem nenhuma policy (403 silencioso)

**Sintoma:** Botão "Retornar para IA" clicado sem efeito — sem mensagem de erro visível ao usuário, mas UPDATE falhava silenciosamente.

**Causa raiz:**
A tabela `conversas` tinha RLS habilitado com apenas uma policy de SELECT. **Nenhuma policy de UPDATE existia**. Com RLS ativo e sem policy de UPDATE, toda operação de UPDATE é bloqueada para usuários autenticados.

Isso afetava:
- Botão "Assumir Atendimento" → `UPDATE conversas SET status = 'awaiting_human'`
- Botão "Retornar para IA" → `UPDATE conversas SET status = 'ativa'`
- Zerar `nao_lidas` → `UPDATE conversas SET nao_lidas = 0`

**Fix aplicado** (migration `fix_conversas_update_rls_atendimento`):
```sql
CREATE POLICY "Conversas: Update permitido para atendentes e service_role" ON conversas
FOR UPDATE
USING (
    auth.role() = 'service_role'
    OR is_developer()
    OR has_permission('atendimentos', 'update')
    OR has_permission('leads', 'update')
)
WITH CHECK (
    auth.role() = 'service_role'
    OR is_developer()
    OR has_permission('atendimentos', 'update')
    OR has_permission('leads', 'update')
);
```

**Lição:** Ao criar uma tabela com RLS, sempre criar policies para TODOS os comandos necessários: SELECT, INSERT, UPDATE, DELETE. A ausência silenciosa de uma policy UPDATE é difícil de diagnosticar pois não gera log explícito no frontend.

---

### BUG-6 — RLS: policy `human_handover_contacts` não incluía Admin Empregabilidade

**Sintoma:** 403 ao tentar criar regra em `/configuracoes/atendimento-humano` com o role Admin Empregabilidade.

**Causa raiz:**
A policy de INSERT/UPDATE em `human_handover_contacts` listava apenas: `Developer`, `Super Admin Cuca`, `Auxiliar administrativo`, `Institucional`. Não incluía `Admin Empregabilidade` nem `Gerente`.

**Fix aplicado** (migration `fix_human_handover_contacts_rls`):
```sql
-- Adicionados: Admin Empregabilidade, Gerente
AND sr.name = ANY(ARRAY[
    'Developer', 'Super Admin Cuca',
    'Auxiliar administrativo', 'Institucional',
    'Admin Empregabilidade', 'Gerente'      -- ← adicionados
])
```

**Lição:** Ao criar policies de escrita em tabelas de configuração, sempre incluir todos os roles administrativos relevantes ao módulo.

---

### BUG-7 — RLS: `transbordo_humano` bloqueava Admin Empregabilidade e Gerente

**Sintoma:** Mesmo após fix em `human_handover_contacts`, a tabela `transbordo_humano` ainda bloqueava esses roles.

**Fix aplicado** (migration `fix_transbordo_rls_role_names`):
- Adicionados `Admin Empregabilidade` e `Institucional`
- Adicionada lógica de acesso global para roles sem unidade (`get_my_unit() IS NULL`)

---

## Checklist de Implementação Correta (Skill)

Para qualquer funcionalidade de **transbordo/handover** no sistema:

### Worker (Python)

- [ ] **Engine com LLM** (ex: institucional): detectar `data.get("handover")` ou `[[HANDOVER]]` no texto da resposta
- [ ] **Engine state machine** (ex: empregabilidade): adicionar detecção por expressão natural **antes** do roteamento de perfil
- [ ] Após disparar notificação via UAZAPI: **sempre executar** `supabase.table("conversas").update({"status": "awaiting_human"})`
- [ ] Buscar contato em `human_handover_contacts` (não `transbordo_humano`)
- [ ] Fallback global: se não encontrar por unidade, buscar com `is_("unidade_cuca", "null")`
- [ ] Campos corretos: `telefone_destino` e `nome_responsavel` (não `telefone`/`responsavel`)

### Portal (Next.js)

- [ ] `chat-window.tsx`: input liberado quando `status !== 'ativa'`
- [ ] Botão "Assumir Atendimento": muda status para `awaiting_human`
- [ ] Botão "Retornar para IA": muda status para `ativa`
- [ ] Ambos os botões protegidos por `hasPermission(modulo, 'update')`

### Supabase RLS (Migrations)

- [ ] Tabela `conversas`: policy UPDATE para `has_permission('atendimentos', 'update')`
- [ ] Tabela `mensagens`: policy INSERT para `has_permission('atendimentos', 'create')`
- [ ] Tabela `human_handover_contacts`: policies INSERT/UPDATE para todos os roles de atendimento
- [ ] Tabela `transbordo_humano`: policies INSERT/UPDATE para todos os roles de atendimento

### Arquitetura de Tabelas

```
transbordo_humano          → Ouvidoria e Acesso CUCA
                             Gerenciado por: configurações WhatsApp (canal-tab)
                             Lido por: main.py genérico (linhas 665-691)
                             Campos: telefone, responsavel, modulo, unidade_cuca, ativo

human_handover_contacts    → Empregabilidade, Programação, Geral
                             Gerenciado por: /configuracoes/atendimento-humano
                             Lido por: empregabilidade_engine.py, institucional_engine.py
                             Campos: telefone_destino, nome_responsavel, modulo, unidade_cuca, ativo
```

### Regras de Pausa do Bot

| Evento | Mecanismo | Duração |
|---|---|---|
| Operador envia mensagem pelo WhatsApp (`fromMe=True`) | `metadata.bot_pausado_ate` = agora + 1 min | **1 minuto** (hardcoded, `main.py:398`) |
| Transbordo disparado pelo engine | `conversas.status = awaiting_human` | **Indefinido** — até operador clicar "Retornar para IA" no portal |
| Operador clica "Assumir Atendimento" no portal | `conversas.status = awaiting_human` | **Indefinido** — até operador clicar "Retornar para IA" |

**Verificação de pausa no worker (`main.py`):**
```python
# Linha ~525: ao receber mensagem do lead
_bot_pausa = _cm_meta.get("bot_pausado_ate")
if _bot_pausa:
    _pausa_ate = datetime.fromisoformat(_bot_pausa)
    if datetime.now(timezone.utc) < _pausa_ate:
        logger.info("Bot em pausa — mensagem ignorada")
        return  # IA não processa

# Linha ~539:
if conversation_status == "awaiting_human":
    logger.info("IA silenciada")
    return  # IA não processa
```

---

## Arquivos Modificados

### Worker
- `worker/empregabilidade_engine.py`
  - Detecção de handover por expressão natural
  - Ambos os blocos de handover: adicionado `status = awaiting_human`
  - Keywords expandidas para cobrir variações linguísticas

### Portal
- `cuca-portal/src/components/chat/chat-window.tsx`
  - Nova função `handleRetornarIA()`
  - Botão "Retornar para IA" quando `status === 'awaiting_human'`

### Migrations Supabase
- `fix_human_handover_contacts_rls` — Add Admin Empregabilidade + Gerente
- `fix_transbordo_rls_role_names` — Corrige roles na política
- `fix_mensagens_insert_rls_atendimentos` — Adiciona `has_permission('atendimentos', 'create')`
- `fix_conversas_update_rls_atendimento` — Cria policy UPDATE (inexistente)

---

## Dev Agent Record

### Agent Model Used
claude-sonnet-4-6

### Completion Notes
- Todo o fluxo de transbordo da empregabilidade está operacional end-to-end
- RLS das tabelas de atendimento corrigido para todos os roles relevantes
- Portal com ciclo completo: Assumir ↔ Retornar para IA

### Change Log
- 2026-04-18: Story criada como documentação/skill do processo de fix de transbordo — @dev (Dex)
