# S-WM-10 — Guard awaiting_human no worker: silenciar IA quando colaborador assumiu o atendimento

## Status
Done

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - pytest worker (regressão geral)
  - teste manual (staging): setar conversas.status='awaiting_human' via MCP execute_sql → enviar mensagem pelo número mapeado → confirmar que worker retorna 200 sem processar (log "IA silenciada")
  - confirmar cobertura dos dois caminhos de dispatch: Empregabilidade (linha 407-421) e motor-agente (linha 423-431)
```

## Story

**Como** colaborador que assumiu o atendimento de um lead,
**quero** que a IA pare de responder automaticamente enquanto estou no controle,
**para que** minhas mensagens e as do lead não sejam interrompidas por respostas automáticas conflitantes.

## Contexto e Problema

`meta_adapter_inbound.py:372-378` lê `conversas.status` da conversa inbound. O status é selecionado no campo `status` (`id, status`) mas **nunca é usado** antes do dispatch. Se o colaborador clicou em "Assumir Atendimento" no portal (que seta `conversas.status='awaiting_human'`), a IA continua respondendo por cima.

```python
# situação atual (meta_adapter_inbound.py ~372)
conversa_res = supabase.table("conversas").select("id, status, ...").eq(...).execute()
# status é lido mas descartado — dispatch acontece incondicionalmente
```

**Referência implementada:** `academia_enem_engine.py:214-217`:
```python
if conv.get("status") == "awaiting_human":
    logger.info("IA silenciada — conversa %s em atendimento humano.", conversa_id)
    return
```
Esta story aplica o mesmo padrão no inbound compartilhado, cobrindo todos os módulos que passam por `meta_adapter_inbound.py`.

**Dois caminhos de dispatch a cobrir:**
- Empregabilidade (linhas 407-421): `processar_mensagem_empregabilidade(...)`
- Motor-agente / Institucional / sofia / ana (linhas 423-431): chamada ao motor-agente

**Atenção:** verificar se o motor-agente (Edge Function ou serviço externo) tem guard próprio internamente. Se sim, documentar — o guard no inbound é um defense-in-depth. Se não, o guard no inbound é a única barreira.

## Escopo

### IN

**`worker/meta_adapter_inbound.py`**

1. **Após ler `status` da conversa (linha ~378):** inserir guard antes de qualquer dispatch:
   ```python
   if conversa.get("status") == "awaiting_human":
       logger.info(
           "[awaiting_human] IA silenciada — conversa %s em atendimento humano. Descartando inbound.",
           conversa_id,
       )
       return JSONResponse({"status": "silenced"}, status_code=200)
   ```
   O guard cobre **ambos** os caminhos de dispatch (Empregabilidade e motor-agente) por estar antes do bloco `if/elif`.

2. **Verificação do motor-agente:** ler o arquivo ou contrato do motor-agente para confirmar se existe guard interno. Documentar resultado no Debug Log da story:
   - Se guard interno existe: adicionar comentário inline no código (`# defense-in-depth — motor-agente também tem guard`)
   - Se guard interno não existe: o guard do inbound é suficiente; documentar como dívida técnica no motor-agente

3. **Campo `status` no SELECT:** confirmar que `status` está incluído no SELECT da query de `conversas` (linha ~372). Se não estiver, adicioná-lo.

### OUT

- `handleAssumirAtendimento()` / `handleRetornarIA()` no portal: já implementados corretamente (`chat-window.tsx:260-289`), não alterar
- `academia_enem_engine.py`: já tem guard, não alterar
- S-WM-09 (transbordo que seta o status): story separada. Esta story assume que `status='awaiting_human'` pode vir de qualquer origem (portal UI, S-WM-09 futuro)
- Schema de banco: `conversas.status` já existe com valores `'ativa'`, `'awaiting_human'`, `'encerrada'`
- Qualquer alteração em outras engines (fora do inbound compartilhado)

## Critérios de Aceite

1. **Given** `conversas.status='awaiting_human'` está setado para uma conversa no cuca-dev, **when** o lead envia uma mensagem e o webhook Meta aciona o worker, **then** o worker retorna HTTP 200 sem chamar `processar_mensagem_empregabilidade` nem o motor-agente. O log contém `"[awaiting_human] IA silenciada"`.

2. **Given** o guard está ativo, **when** a conversa tem `status='ativa'`, **then** o dispatch ocorre normalmente (Empregabilidade ou motor-agente conforme `agente_tipo`). Sem regressão no fluxo normal.

3. **Given** a query de `conversas` em `meta_adapter_inbound.py` (linha ~372), **when** @qa inspeciona o código, **then** `status` está incluído no `SELECT` e o guard verifica `status == 'awaiting_human'` antes do bloco de dispatch.

4. **Given** o guard cobre o caminho Empregabilidade (linhas 407-421), **when** @qa verifica a posição do guard no código, **then** o guard está posicionado **antes** do `if agente_tipo == 'Empregabilidade'` — cobrindo ambos os caminhos com uma única verificação.

5. **Given** a verificação do motor-agente foi realizada, **when** @qa revisa o Debug Log da story, **then** há registro indicando se o motor-agente tem ou não guard interno, com referência ao arquivo/linha verificado.

6. **Given** `pytest worker/tests/` é executado após as alterações, **when** concluído, **then** passa sem regressão.

## Dependências

- Nenhuma dependência de outras stories WM. Pode iniciar imediatamente após S-WM-07.
- `conversas.status` com valores `'ativa'`/`'awaiting_human'`/`'encerrada'` já existe no schema (confirmado pelo portal que já seta esses valores via `handleAssumirAtendimento`).

## Riscos

- **Guard muito cedo no fluxo:** se inserido antes da criação da conversa (lead novo), o guard não tem efeito — `conversas` ainda não existe. O guard opera sobre conversa existente buscada por `origem_id + wa_id`. Verificar que o guard está no ponto correto (após fetch da conversa, não antes).
- **`status` null em conversas antigas:** conversas UAZAPI podem ter `status=null`. O guard `== 'awaiting_human'` não dispara para null — comportamento correto (dispatch segue normalmente).
- **Conversa não encontrada:** se `conversa_res.data` é null (lead novo, primeira mensagem), o guard não deve ser aplicado. Verificar que o guard está dentro do bloco onde `conversa` é garantidamente não-null.

## Estimativa

**XS** — uma inserção de 4-5 linhas em posição precisa + verificação de cobertura + confirmação do campo no SELECT. Menos de 0,5 dia de @dev. Pode ser implementada em paralelo com S-WM-08.

## Dev Agent Record

### File List
- `worker/meta_adapter_inbound.py` — modificado (guard awaiting_human antes do dispatch)
- `worker/tests/test_meta_adapter_inbound.py` — modificado (2 novos testes: awaiting_human silencia IA; status null não silencia)

### Tasks

- [x] Confirmar que `status` está no SELECT de `conversas` (~linha 372); adicionar se ausente
- [x] Inserir guard `if status == 'awaiting_human': log + return 200` antes do bloco de dispatch (~linha 405)
- [x] Verificar motor-agente: tem guard interno? Documentar resultado no Debug Log com arquivo:linha
- [x] Executar `pytest worker/tests/` e confirmar sem regressão

### Debug Log

**Verificação motor-agente (Task 3):**

- `worker/meta_adapter_inbound.py:213-295` — função `_chamar_motor_agente`: **sem guard `awaiting_human`**. Chama diretamente a Edge Function via HTTP POST sem verificar status da conversa.
- `supabase/functions/motor-agente/index.ts:134` — Edge Function: seleciona `id, status, metadata` mas **não verifica `status === "awaiting_human"` antes de processar**. Apenas verifica `status === "encerrada"` (linha 138) para reativar conversa.
- **Conclusão:** o guard em `meta_adapter_inbound.py` é a **única barreira** (defense-in-depth). Nenhum guard interno no motor-agente (inbound nem Edge Function). Documentado como dívida técnica do motor-agente.

**SELECT confirmado:** `select("id, status")` na linha 372 — campo `status` já presente, nenhuma alteração necessária.

**pytest:** 21/21 passed, 0 regressões.

### Completion Notes

- Guard inserido em `meta_adapter_inbound.py` após extração de `conversa_status` no bloco `if conv_result.data:` / `else:`. Posicionado antes do `# ── Dispatch ──`, cobre Empregabilidade E motor-agente com uma única verificação.
- Uso de `bare return` (não `JSONResponse`) — função é background task (`-> None`); retorno de JSONResponse seria descartado pelo runner do FastAPI.
- Conversas novas (bloco `else:`) iniciam com `conversa_status = "ativa"` — guard nunca dispara para leads novos.
- Status `None` (UAZAPI legado): `None == "awaiting_human"` → `False` — dispatch segue normalmente. Comportamento correto.

## QA Results

### Review Date: 2026-06-27

### Reviewed By: Quinn (Test Architect)

**Veredito:** ✅ PASS — 7/7 checks OK, 6/6 ACs atendidos, 21/21 testes passando.

**Checks:**
- Code Review: PASS — guard posicionado corretamente, bare return, log consistente
- Unit Tests: PASS — 21/21 (2 novos testes cobrem awaiting_human + status null)
- Acceptance Criteria: PASS — 6/6 ACs verificados
- Regressão: PASS — todos os testes pré-existentes passam
- Performance: PASS — comparação de string, zero I/O adicional
- Segurança: PASS — sem nova superfície de ataque
- Documentação: PASS — Debug Log completo com referências de arquivo:linha

**Issue LOW registrado:**
- `DOC-001` (low) — Dívida técnica motor-agente (ausência de guard em `index.ts:134`) documentada no Debug Log, não como backlog item formal. Sugestão: registrar em sprint oportuna.

### Gate Status

Gate: PASS → docs/qa/gates/s-wm-10-guard-awaiting-human-worker.yml

---

### Change Log
| Data | Agente | Ação |
|---|---|---|
| 2026-06-27 | @sm (River) | Story criada a partir de levantamento cross-módulo do @dev (Dex) |
| 2026-06-27 | @po (Pax) | Validação GO 10/10 — status promovido Draft → Ready |
| 2026-06-27 | @dev (Dex) | Implementação concluída — guard awaiting_human + 2 testes novos + debug log motor-agente |
| 2026-06-27 | @qa (Quinn) | QA Gate PASS — 21/21 testes, 6/6 ACs, DOC-001 low registrado |
| 2026-06-27 | @devops (Gage) | QA PASS — commit + push feat/migracao-meta + PR → develop; status → Done |
