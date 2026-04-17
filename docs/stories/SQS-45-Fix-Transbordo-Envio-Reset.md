# SQS-45 — Fix: Transbordo Humano, Envio Manual e Reset de Memória

**Status:** InProgress
**Criado em:** 2026-04-17
**Prioridade:** Alta — bloqueia demonstrações de entrega

---

## Contexto

Análise profunda identificou 3 bugs críticos que bloqueiam as features de transbordo e atendimento humano.
Os bugs afetam Programação (institucionalredecuca), Empregabilidade (empregoredecuca) e o portal de atendimento.

---

## Problemas Identificados (Análise Revisada)

### Bug 1 — Transbordo anuncia mas não notifica o atendente

**Evidência no log:**
```
INFO:institucional_engine:[inst-engine] resposta motor: success=True
INFO:httpx:HTTP Request: POST https://cucaatendemais.uazapi.com/send/text "HTTP/1.1 200 OK"
```
O worker envia a mensagem "estou te transferindo..." ao lead, mas nenhum `GET` para `human_handover_contacts` é feito.

**Causa raiz — 3 camadas:**

**1a. Early return antes da lógica de handover (main.py):**
```python
# linha 554-568
if not from_me and canal_tipo == "Institucional":
    await processar_mensagem_institucional(...)
    return  # ← sai AQUI

# linha 534-551
if not from_me and agente_tipo == "Empregabilidade":
    await processar_mensagem_empregabilidade(...)
    return  # ← sai AQUI

# A lógica de notificação (linhas 640-723) NUNCA é alcançada por esses dois fluxos
```

**1b. institucional_engine sem notificação (institucional_engine.py):**
```python
# linha 280-284: apenas remove o marcador e substitui mensagem
handover_match = re.search(r'\[\[HANDOVER\]\]...', resposta_ia)
if handover_match:
    resposta_ia = resposta_ia.replace(handover_match.group(0), '').strip()
    if not resposta_ia:
        resposta_ia = "Certo, estou te transferindo..."
# FIM — nenhum lookup de contato, nenhum alerta enviado
```

**1c. Worker lê tabela errada:**
Portal cadastra contatos em `human_handover_contacts` (via `/configuracoes/transbordo`).
Worker consulta `transbordo_humano` (via engines de empregabilidade e main.py genérico).
```
Portal escreve em:   human_handover_contacts  ← tabela correta para Programação/Empregabilidade
Worker lê de:        transbordo_humano         ← tabela de Ouvidoria/Acesso → sempre vazio para esses módulos
```

**Fix necessário:**
- `institucional_engine.py`: após detectar `[[HANDOVER]]`, buscar em `human_handover_contacts` com `modulo='programacao'` e disparar alerta via UAZAPI.
- `empregabilidade_engine.py`: na lógica de handover explícito, alterar lookup de `transbordo_humano` para `human_handover_contacts` com `modulo='empregabilidade'`.

---

### Bug 2 — Reset de memória apaga configuração de transbordo

**Causa raiz — função SQL `reset_automation_memory`:**
```sql
DELETE FROM transbordo_humano WHERE true;  -- ← apaga configuração, não deve estar aqui
```

`transbordo_humano` é uma **tabela de configuração permanente** (nome do responsável + telefone de atendimento), não uma fila temporária. Foi erroneamente incluída no reset por confusão de nomenclatura.

**Agravante:** pg_cron ativo rodando `SELECT reset_automation_memory()` **todo dia às 00:00 BRT**:
```sql
jobname: reset_automation_memory_daily
schedule: 0 3 * * *  (UTC = 00:00 BRT)
active: true
```

Qualquer configuração cadastrada em `transbordo_humano` é apagada automaticamente a cada dia.

**Fix necessário:**
- Remover `DELETE FROM transbordo_humano WHERE true` da função SQL via migration.
- A UI do reset (`/developer/reset`) exibe "Fila de atendimento humano" como descrição — corrigir para não confundir.

---

### Bug 3 — Botão enviar mensagem no chat de atendimento não funciona

**Causa raiz confirmada — variável de ambiente ausente no portal:**

`chat-window.tsx` linha 64 e 136:
```typescript
const token = process.env.NEXT_PUBLIC_INTERNAL_TOKEN;
if (!workerUrl || !token) throw new Error("Worker URL não configurada");
```

Portal tem: `WEBHOOK_INTERNAL_TOKEN=cuca_internal_token_2026`
Portal **NÃO tem**: `NEXT_PUBLIC_INTERNAL_TOKEN` ← **ausente**

Em Next.js, variáveis client-side precisam do prefixo `NEXT_PUBLIC_`. O código usa `NEXT_PUBLIC_INTERNAL_TOKEN` mas o `.env` do portal tem apenas `WEBHOOK_INTERNAL_TOKEN` (sem o prefixo). No cliente, `process.env.NEXT_PUBLIC_INTERNAL_TOKEN` retorna `undefined` → **o envio falha 100% das vezes para todos os usuários**.

Afeta também:
- `markAsRead()` (linha 64): silencia e retorna sem executar — mensagens nunca são marcadas como lidas no WhatsApp.

**Fix necessário:**
- Adicionar `NEXT_PUBLIC_INTERNAL_TOKEN=cuca_internal_token_2026` no `.env` do portal no EasyPanel.
- Fazer redeploy do serviço **portal**.

> ⚠️ Esta é uma variável de build-time no Next.js — apenas adicionar no EasyPanel não basta se já foi buildado. Precisa de redeploy completo.

---

## Acceptance Criteria

- [ ] AC-1: Quando lead pede transbordo na instância `institucionalredecuca`, o worker envia alerta WhatsApp para o número cadastrado em `human_handover_contacts` com `modulo='programacao'`
- [ ] AC-2: Quando lead pede transbordo na instância `empregoredecuca`, o worker envia alerta WhatsApp para o número cadastrado em `human_handover_contacts` com `modulo='empregabilidade'`
- [ ] AC-3: O reset de automações (`/developer/reset`) NÃO apaga registros de `transbordo_humano`
- [ ] AC-4: O cron diário de reset NÃO apaga registros de `transbordo_humano`
- [ ] AC-5: O botão "Enviar" no chat de atendimento funciona para todos os usuários com permissão
- [ ] AC-6: Mensagens enviadas manualmente pelo portal chegam ao WhatsApp do lead via `send/text` do worker

---

## Tasks

### T1 — Fix Bug 3: Variável de ambiente `NEXT_PUBLIC_INTERNAL_TOKEN`
- [ ] Verificar e documentar que `NEXT_PUBLIC_INTERNAL_TOKEN` está ausente no portal
- [ ] Adicionar no `.env` do EasyPanel (portal): `NEXT_PUBLIC_INTERNAL_TOKEN=cuca_internal_token_2026`
- [ ] Instruir redeploy do serviço **portal** no EasyPanel

### T2 — Fix Bug 2: Remover `transbordo_humano` do reset ✅
- [x] Migration `20260417000001_fix_reset_preserva_transbordo.sql` aplicada
- [x] UI `/developer/reset/page.tsx` atualizada

### T3 — Fix Bug 1a/1b: Notificação de transbordo em `institucional_engine.py` ✅
- [x] Após detectar `[[HANDOVER]]`, busca em `human_handover_contacts` com `modulo='programacao'`
- [x] Fallback global (unidade_cuca null) se não houver regra específica
- [x] Alerta disparado via `UAZAPI_URL/send/text`

### T4 — Fix Bug 1c: Notificação de transbordo em `empregabilidade_engine.py` ✅
- [x] Lookup alterado de `transbordo_humano` para `human_handover_contacts`
- [x] Colunas corrigidas: `telefone` → `telefone_destino`, `responsavel` → `nome_responsavel`

---

## Dev Notes

### Arquitetura de Tabelas de Transbordo
```
transbordo_humano          → Ouvidoria e Acesso CUCA
                             Gerenciado por: canal-whatsapp-tab.tsx
                             Lido por: main.py (fluxo genérico, linhas 665-691)

human_handover_contacts    → Programação, Empregabilidade, Geral
                             Gerenciado por: /configuracoes/transbordo/page.tsx
                             Lido por: NINGUÉM ainda (bug) ← precisa ser corrigido nos engines
```

### Fluxo de Roteamento no main.py
```
Mensagem recebida
  ├── canal_tipo == "Institucional" → institucional_engine → return (linha 568)
  ├── agente_tipo == "Empregabilidade" → empregabilidade_engine → return (linha 551)
  └── outros → motor-agente genérico → tem lógica de handover (linha 640-723)
                                         mas lê transbordo_humano, não human_handover_contacts
```

### Env Vars Confirmadas
```
worker/.env:
  WEBHOOK_INTERNAL_TOKEN=cuca_internal_token_2026
  UAZAPI_BASE_URL=https://cucaatendemais.uazapi.com

portal/.env (EasyPanel):
  NEXT_PUBLIC_WORKER_URL=https://api.cucaatendemais.com.br    ✅ presente
  WEBHOOK_INTERNAL_TOKEN=cuca_internal_token_2026             ✅ presente (mas server-side only)
  NEXT_PUBLIC_INTERNAL_TOKEN=???                              ❌ AUSENTE ← causa do Bug 3
```

### Serviços para Redeploy após Fixes
- Bug 3 (env var): redeploy **portal**
- Bug 2 (migration SQL): já aplica no banco via Supabase, redeploy não necessário
- Bug 1 (worker Python): redeploy **worker**

---

## File List

### Modificados
- `worker/institucional_engine.py` — T3
- `worker/empregabilidade_engine.py` — T4
- `cuca-portal/supabase/migrations/20260417000001_fix_reset_transbordo_humano.sql` — T2
- `cuca-portal/src/app/(dashboard)/developer/reset/page.tsx` — T2 (UI)

### Configuração Externa (EasyPanel)
- `.env` do serviço **portal** no EasyPanel: adicionar `NEXT_PUBLIC_INTERNAL_TOKEN`

---

## Dev Agent Record

### Agent Model Used
claude-sonnet-4-6

### Debug Log References

### Completion Notes

### Change Log
- 2026-04-17: Story criada por análise de bugs em transbordo, reset e envio manual — @dev (Dex)
