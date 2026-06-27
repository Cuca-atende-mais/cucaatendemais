# S-WM-07 — Fix Roteamento Outbound Reativo Meta: phone_number_id herdado do inbound

## Status
Done

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - pytest worker (regressão geral)
  - teste manual: inbound no número de teste → confirmar outbound sai pelo mesmo número
  - mcp supabase execute_sql (confirmar registros ativos em meta_phone_numbers)
```

## Story

**Como** usuário do WhatsApp que enviou mensagem para o número de teste da Empregabilidade,  
**quero** receber a resposta pelo mesmo número de teste,  
**para que** o fluxo de teste seja isolado e o número de produção não receba requisições indevidas.

## Causa-raiz Confirmada (Dex — diagnóstico read-only, 2026-06-27)

`empregabilidade_engine.py:79` — `_enviar()` recebe `instance_name` com o `phone_number_id` correto do inbound, mas **ignora** e chama `_get_meta_phone("Empregabilidade")`, que executa `SELECT phone_number_id ... WHERE agente_tipo='Empregabilidade' AND ativo=TRUE LIMIT 1` **sem ORDER BY**.

Com dois registros ativos para `agente_tipo='Empregabilidade'` (teste `1215172285010519` e produção `1245704551949387`), o `LIMIT 1` retorna o número de produção de forma não-determinística. O outbound sai por `1245704551949387`, a Meta aceita com 200 OK mas descarta (o número de produção não reconhece o destinatário de teste). Nada chega ao WhatsApp do usuário.

**Regra estabelecida:** resposta reativa (reply a mensagem recebida) deve SEMPRE sair pelo mesmo `phone_number_id` que recebeu a mensagem — herdado do `canal_origem` do inbound. Nunca re-resolver por `agente_tipo` numa resposta reativa.

## Auditoria de Outros Caminhos Reativos

| Caminho | Arquivo | Comportamento | Afetado? |
|---------|---------|---------------|----------|
| Motor-agente (Institucional/maria/sofia/ana) | `meta_adapter_inbound.py:429` | Chama `_meta_enviar(phone_number_id, ...)` diretamente com o `phone_number_id` do inbound | **NÃO** — seguro |
| Empregabilidade `_enviar()` | `empregabilidade_engine.py:79` | Ignora `instance_name`, chama `_get_meta_phone()` | **SIM** — bug confirmado |
| Notify loop (`empregabilidade_notify_loop`) | `empregabilidade_engine.py:2183` | Coleta `origem_id` da conversa (linha 2174) mas o marca como "vestigial" e chama `_get_meta_phone()` | **SIM** — mesmo anti-padrão, `origem_id` disponível mas ignorado |

## Decisão sobre `_get_meta_phone()`

Após as correções desta story, `_get_meta_phone()` **continua necessária** para dois usos legítimos de fluxo **proativo** (sem inbound para herdar):

1. `main.py:353` — fallback do endpoint `/send-message/{token}` quando `conversa_id` não é fornecido
2. Qualquer uso futuro em campanhas/disparos da Empregabilidade

A função **não é eliminada**, mas **recebe `ORDER BY phone_number_id`** para tornar o `LIMIT 1` determinístico e evitar surpresas quando houver múltiplos registros ativos.

## Escopo

### IN

**`worker/empregabilidade_engine.py`**

1. **`_enviar()` (linha 76-85):** substituir chamada `_get_meta_phone("Empregabilidade")` por uso direto do parâmetro `instance_name` como `phone_number_id` e `os.getenv("META_SYSTEM_USER_TOKEN", "")` como token. Remover o comentário `# instance_name e token são vestigiais — Meta usa meta_phone_numbers (S-WM-03)` — está incorreto.

2. **`empregabilidade_notify_loop` (linhas 2174-2186):** `origem_id` já é coletado da conversa (`c.get("origem_id", "")`). Substituir a chamada `_get_meta_phone("Empregabilidade")` (linha 2183) por `(instance_name, os.getenv("META_SYSTEM_USER_TOKEN", ""))`. Remover comentário `# vestigial` da linha 2174 — `origem_id` passa a ser usado. Remover comentário da linha 2175 (`# vestigial; _enviar usa _get_meta_phone (S-WM-03)`). Manter guard de segurança: se `instance_name` vazio após coleta, logar warning e `continue`.

3. **`_get_meta_phone()` (linha 62-68):** adicionar `.order("phone_number_id")` antes do `.limit(1)` para tornar o SELECT determinístico. Função permanece para uso proativo.

**Resultado esperado após correção:**

```
Inbound: phone_number_id = 1215172285010519 (teste)
  ↓ processar_webhook_meta → instance_name = "1215172285010519"
  ↓ processar_mensagem_empregabilidade(instance_name="1215172285010519")
  ↓ _enviar(instance_name="1215172285010519")
  ↓ _meta_enviar(phone_number_id="1215172285010519", ...) ← CORRETO
```

### OUT

- Motor-agente (Institucional/maria/sofia/ana): auditado, seguro, sem alteração
- `main.py:353` fallback proativo: não tem inbound para herdar; continua usando `_get_meta_phone()` (agora determinística com `ORDER BY`)
- Higiene de dados no cuca-dev: produção com `ativo=true` em staging é sujeira técnica anotada como dívida (ver seção de riscos). Não é resolvida aqui pois a correção de código torna o roteamento correto independentemente dos registros.
- Criação/aprovação de templates Meta
- Qualquer alteração no schema de banco

## Critérios de Aceite

1. **Given** mensagem inbound chega no número de teste `1215172285010519` mapeado para `agente_tipo=Empregabilidade`, **when** o worker processa e gera resposta, **then** o outbound é enviado via `POST graph.facebook.com/v23.0/1215172285010519/messages` — nunca pelo número de produção `1245704551949387`.

2. **Given** `_enviar(instance_name="1215172285010519", ...)` é chamada, **when** executa, **then** não há chamada a `_get_meta_phone()` dentro de `_enviar()` — `instance_name` é usado diretamente como `phone_number_id`.

3. **Given** `empregabilidade_notify_loop` processa uma conversa com `origem_id = "1215172285010519"`, **when** envia notificação de vaga criada ou candidatura confirmada, **then** o outbound sai por `1215172285010519` (não por `_get_meta_phone()`).

4. **Given** `_get_meta_phone("Empregabilidade")` é chamada com dois registros ativos (`1215172285010519` e `1245704551949387`), **when** executa, **then** retorna sempre o mesmo `phone_number_id` (menor valor lexicográfico por `ORDER BY phone_number_id`) — comportamento determinístico.

5. **Given** os comentários `# instance_name e token são vestigiais` e `# vestigial; _enviar usa _get_meta_phone` foram removidos, **when** @qa revisa o código, **then** não há comentários incorretos sobre o comportamento de `instance_name` em `_enviar()` ou no notify loop.

6. **Given** path do motor-agente (Institucional/maria/sofia/ana) em `meta_adapter_inbound.py:423-431`, **when** @qa audita, **then** confirma que `_meta_enviar(phone_number_id, ...)` usa o `phone_number_id` do inbound diretamente — sem chamada a `_get_meta_phone()` ou similar.

7. **Given** todos os testes do worker são executados após a correção, **when** `pytest worker/tests/`, **then** passam sem regressão.

## Dependências

- S-WM-01 (adapter inbound), S-WM-02 (adapter outbound), S-WM-03 (schema `meta_phone_numbers`) — todas concluídas
- Número de teste `1215172285010519` com `ativo=true` em `meta_phone_numbers` no cuca-dev (confirmado)

## Riscos

- **Notify loop com `origem_id` vazio:** se uma conversa antiga não tiver `origem_id` preenchido no campo correto, o guard de `if not instance_name: continue` evita envio pelo número errado. @dev garantir guard presente.
- **Dívida técnica de dados (fora de escopo):** cuca-dev tem `1245704551949387` (número de produção real) com `ativo=true`. Isso mascarou o bug e pode mascarar outros no futuro. Ação recomendada (pós-story, manual): setar `ativo=false` para registros de produção no cuca-dev ou criar número de teste separado.

## Estimativa

**XS** — mudança cirúrgica em 3 pontos do mesmo arquivo + ORDER BY. Menos de 30 linhas afetadas. Menos de 0,5 dia de @dev.

## Dev Agent Record

### File List
- `worker/empregabilidade_engine.py` — modificado (`_enviar()`, `empregabilidade_notify_loop`, `_get_meta_phone()`)
- `worker/meta_adapter_inbound.py` — comentário vestigial removido (linha 413)
- `worker/tests/test_meta_adapter_outbound.py` — teste atualizado para novo contrato (S-WM-07 substitui S-WM-03 AC#7)

### Tasks

- [x] Corrigir `_enviar()`: usar `instance_name` em vez de `_get_meta_phone()`; remover comentário incorreto
- [x] Corrigir `empregabilidade_notify_loop`: usar `origem_id` da conversa; remover comentários "vestigial"; adicionar guard se `origem_id` vazio
- [x] Corrigir `_get_meta_phone()`: adicionar `ORDER BY phone_number_id` antes de `LIMIT 1`
- [x] Auditar `meta_adapter_inbound.py:423-431` (motor-agente) — confirmar sem mudança necessária
- [x] Executar `pytest worker/tests/` e confirmar sem regressão

### Debug Log
_vazio_

### QA Results

```yaml
storyId: S-WM-07
verdict: PASS WITH CONCERNS
reviewer: "@qa (Quinn)"
date: "2026-06-27"
issues:
  - severity: low
    category: tests
    description: "token: str em _enviar() agora é dead code — callers passam '' mas é ignorado internamente."
    recommendation: "Remover parâmetro em story de limpeza futura junto com Q2."
  - severity: low
    category: tests
    description: "patch(_get_meta_phone) em test_loop_nao_avanca_estado_em_falha_meta é stale — sem efeito após fix, enganoso."
    recommendation: "Remover patch stale no mesmo cleanup da Q1."
  - severity: low
    category: tests
    description: "AC3 coberto transitivamente — sem teste direto que verifique phone_number_id passado ao _meta_enviar pelo caminho do loop."
    recommendation: "Adicionar test_loop_passa_origem_id_como_phone_number_id em hardening futuro."
  - severity: low
    category: tests
    description: "Sem teste para guard 'if not instance_name: continue' no notify loop."
    recommendation: "Adicionar test_loop_skips_conversa_sem_origem_id em hardening futuro."
```

### Completion Notes
_vazio_

### Change Log
| Data | Agente | Ação |
|---|---|---|
| 2026-06-27 | @sm (River) | Story criada a partir de diagnóstico do @dev (Dex) — aguardando validação do @po |
| 2026-06-27 | @po (Pax) | Validação GO 10/10 — status promovido Draft → Ready |
| 2026-06-27 | @dev (Dex) | Implementação concluída — 3 fixes cirúrgicos + teste atualizado; 44 passed 0 failed; status → InReview |
| 2026-06-27 | @devops (Gage) | QA PASS WITH CONCERNS (4x LOW) — commit + push feat/migracao-meta + PR → develop; status → Done |
