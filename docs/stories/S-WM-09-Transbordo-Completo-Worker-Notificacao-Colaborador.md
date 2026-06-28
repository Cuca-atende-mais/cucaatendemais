# S-WM-09 — Transbordo completo: worker seta awaiting_human e notifica colaborador via Meta template

## Status
Ready for Review

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - pytest worker (regressão geral)
  - teste manual (staging): disparar transbordo por keyword → confirmar conversas.status='awaiting_human' no banco via MCP
  - teste manual (staging com flag META_TEMPLATES_APROVADOS=false): confirmar que log registra intenção sem disparar mensagem
  - teste manual (staging com flag=true e template aprovado): confirmar que telefone_destino recebe mensagem Meta
  - mcp supabase execute_sql: SELECT * FROM human_handover_contacts WHERE ativo=true para confirmar registros de teste
```

## Story

**Como** colaborador do CUCA configurado em `human_handover_contacts`,
**quero** receber uma notificação via WhatsApp quando a IA detectar que o lead precisa de atendimento humano,
**para que** eu possa assumir o atendimento sem depender de monitorar o painel manualmente.

## Contexto e Problema

O transbordo existe em duas camadas — ambas incompletas:

**Camada 1 — worker (engine da Empregabilidade):**
Quando detecta `ultima_intencao=='duvida'` ou keyword de atendimento humano (`empregabilidade_engine.py:1899-1941`), envia mensagem neutral ao lead e encerra. Mas:
- `conversas.status` nunca é setado para `'awaiting_human'` → painel não muda de cor, guard S-WM-10 não tem efeito
- `human_handover_contacts` nunca é consultada → colaborador não é notificado

**Camada 2 — portal (CRUD já pronto):**
`/configuracoes/transbordo/page.tsx` tem CRUD completo sobre `human_handover_contacts` (modulo, unidade_cuca, telefone_destino, nome_responsavel, ativo). A tabela existe e pode ter registros configurados. Mas o worker nunca a lê.

**Módulos cobertos nesta story:**
- Empregabilidade (engine própria em `empregabilidade_engine.py`) — 2 gatilhos internos já mapeados
- Programação / Institucional / maria (motor-agente via `meta_adapter_inbound.py`) — transbordo detectado na resposta do motor-agente
- Ouvidoria / sofia (motor-agente via `meta_adapter_inbound.py`) — idem
- Acesso CUCA / ana: entra quando a página de atendimento for criada (futura story)

**`_notificar_transbordo` pertence ao worker Python** — nunca à Edge Function ou serviço externo. É chamada em `meta_adapter_inbound.py` para os caminhos motor-agente (maria/sofia/ana) e em `empregabilidade_engine.py` para os gatilhos internos da Empregabilidade. O motor-agente pode ter detecção interna de transbordo; o @dev deve verificar o contrato de resposta. A integração com `_notificar_transbordo` é sempre no worker, independente de onde a detecção ocorre.

**Template necessário:**
Template UTILITY `cuca_transbordo_colaborador` com 3 variáveis:
- `{{1}}` = nome_responsavel (ou "Equipe" se null)
- `{{2}}` = identificação do lead (telefone ou nome)
- `{{3}}` = nome do canal / módulo (ex: "Empregabilidade", "Ouvidoria")

Template precisa de aprovação Meta antes de uso em produção. Staging funciona com `META_TEMPLATES_APROVADOS=false` (log apenas, sem disparo).

## Escopo

### IN

**`worker/empregabilidade_engine.py`**

1. **Transbordo por dúvida (linha 1899-1913):** após enviar mensagem neutral ao lead:
   - Setar `conversas.status = 'awaiting_human'` via Supabase
   - Chamar função auxiliar `_notificar_transbordo(conversa_id, modulo, unidade_cuca, phone_number_id_origem)` (ver abaixo)

2. **Transbordo por keyword (linha 1929-1941):** idem — setar status e chamar `_notificar_transbordo`.

3. **Função `_notificar_transbordo(conversa_id, modulo, unidade_cuca, phone_number_id_origem)` (nova):**
   - Ler `human_handover_contacts WHERE modulo=X AND (unidade_cuca=Y OR unidade_cuca IS NULL) AND ativo=true ORDER BY unidade_cuca NULLS LAST` (prioridade: específico por unidade > global)
   - Se `META_TEMPLATES_APROVADOS=true` (env var): enviar `cuca_transbordo_colaborador` via `_meta_enviar(phone_number_id_origem, contato.telefone_destino, template_payload, token)` para cada contato retornado
   - Se `META_TEMPLATES_APROVADOS=false`: `logger.info("[transbordo] notificaria %s mas META_TEMPLATES_APROVADOS=false", contato.telefone_destino)` — sem disparo
   - Se nenhum contato encontrado: logar warning, não falhar o fluxo

**`worker/meta_adapter_inbound.py`**

4. **Motor-agente — dispatch em `meta_adapter_inbound.py` (linhas 423-431) — sofia (Ouvidoria), maria (Programação/Institucional), ana (Acesso CUCA):**
   - Verificar o contrato de resposta do motor-agente para sinal de transbordo (campo específico ou convenção existente).
   - Quando transbordo sinalizado: setar `conversas.status='awaiting_human'` e chamar `_notificar_transbordo(conversa_id, modulo, unidade_cuca, phone_number_id_origem)` — onde `modulo` é derivado de `agente_tipo` da conversa (`sofia_*`/`Sofia`/`Ouvidoria` → `'ouvidoria'`; `Institucional` → `'programacao'`; `ana`/`AcessoCuca` → `'acesso_cuca'`).
   - Se o motor-agente não sinaliza transbordo no contrato de resposta: documentar como dívida técnica no Completion Notes e criar sub-task futura. A integração de `_notificar_transbordo` fica preparada mas sem gatilho enquanto o contrato não expõe o sinal.
   - `_notificar_transbordo` é sempre implementada e chamada no worker Python — nunca delegada à Edge Function ou serviço externo do motor-agente.

**`worker/` (arquivo de config ou `.env.example`)**

5. Adicionar variável de ambiente `META_TEMPLATES_APROVADOS` (default `false`). Documentar em `.env.example` ou equivalente.

### OUT

- Criação / aprovação do template `cuca_transbordo_colaborador` junto à Meta (passo humano, via sócio)
- CRUD de `human_handover_contacts` no portal: já implementado, não alterar
- Schema de banco: `human_handover_contacts` já existe, `conversas.status` já existe. Nenhuma migration necessária.
- S-WM-10 (guard awaiting_human no inbound): story separada, implementada em paralelo
- Acesso CUCA/ana: sem página de atendimento — fora do escopo
- Academia Enem: BSP AuctaFlux, arquitetura separada

## Critérios de Aceite

1. **Given** lead envia "falar com atendente" para número da Empregabilidade, **when** `empregabilidade_engine.py` detecta a keyword, **then** `conversas.status` é setado para `'awaiting_human'` no banco (verificar via `execute_sql`).

2. **Given** `conversas.status='awaiting_human'` foi setado (AC1), **when** `META_TEMPLATES_APROVADOS=false`, **then** o log registra `"notificaria {telefone_destino} mas META_TEMPLATES_APROVADOS=false"` para cada contato ativo da tabela. Nenhuma chamada à Graph API é feita.

3. **Given** `conversas.status='awaiting_human'` foi setado (AC1), **when** `META_TEMPLATES_APROVADOS=true` e há pelo menos um contato ativo em `human_handover_contacts` com `modulo='empregabilidade'`, **then** é feito POST à Graph API para `{phone_number_id_origem}/messages` com o payload do template `cuca_transbordo_colaborador` para o `telefone_destino` configurado.

4. **Given** `human_handover_contacts` tem registro com `unidade_cuca='Barra'` e outro com `unidade_cuca IS NULL` para o mesmo módulo, **when** transbordo é disparado por lead de unidade `'Barra'`, **then** apenas o contato específico de `'Barra'` recebe a notificação (prioridade específico > global).

5. **Given** `human_handover_contacts` não tem nenhum contato ativo para o módulo, **when** transbordo é disparado, **then** o fluxo não falha — log de warning emitido, execução continua.

6. **Given** transbordo por `ultima_intencao=='duvida'` na Empregabilidade (linha 1899), **when** executado, **then** `conversas.status='awaiting_human'` é setado e `_notificar_transbordo` é chamada (mesmo comportamento dos ACs 1-5).

7. **Given** o motor-agente (sofia — Ouvidoria) sinaliza transbordo na resposta ao `meta_adapter_inbound.py`, **when** o worker processa a resposta, **then** `conversas.status='awaiting_human'` é setado e `_notificar_transbordo` é chamada com `modulo='ouvidoria'` — a função está no worker Python, não na Edge Function. Log registra `"[transbordo] motor-agente sofia sinalizado"`.

8. **Given** o motor-agente (maria — Programação/Institucional) sinaliza transbordo na resposta ao `meta_adapter_inbound.py`, **when** o worker processa a resposta, **then** `conversas.status='awaiting_human'` é setado e `_notificar_transbordo` é chamada com `modulo='programacao'`.

9. **Given** o contrato de resposta do motor-agente **não** expõe sinal de transbordo, **when** @qa audita, **then** o Completion Notes documenta esta limitação como dívida técnica, com descrição do campo que precisaria ser adicionado ao contrato para habilitar a integração. `_notificar_transbordo` existe e funciona para Empregabilidade (ACs 1-6).

10. **Given** `pytest worker/tests/` é executado após as alterações, **when** concluído, **then** passa sem regressão.

## Dependências

- S-WM-07 concluída (garante que `conversas.origem_id` está preenchido — necessário para identificar o `phone_number_id` de saída da notificação)
- Template `cuca_transbordo_colaborador` aprovado pela Meta para disparo em produção (necessário apenas para `META_TEMPLATES_APROVADOS=true`; staging funciona com `false`)
- Pelo menos um registro em `human_handover_contacts` no cuca-dev para teste dos ACs

## Riscos

- **Template não aprovado em tempo:** staging funciona com flag=false (log apenas). Não bloqueia a story — AC2 valida o caminho sem template.
- **Motor-agente sem sinalização de transbordo:** se o contrato de resposta do motor-agente não indica transbordo, a Programação/Ouvidoria ficam sem notificação. Documentar como dívida na task 4 e escalar para story separada.
- **Múltiplos contatos:** se `human_handover_contacts` tiver muitos contatos ativos, `_meta_enviar` é chamado N vezes sequencialmente. Para staging (1-2 contatos) é aceitável. Para produção com muitos contatos, considerar fila (dívida futura).
- **Status não revertido se lead envia nova mensagem:** se lead continua enviando mensagens enquanto `status='awaiting_human'`, o guard de S-WM-10 silencia a IA — correto. Mas se nenhum colaborador assumir e o status não for revertido, o lead fica sem atendimento indefinidamente. Documentar como comportamento esperado (reversão é manual via portal).

## Estimativa

**M** — lógica nova de notificação + integração com tabela existente + flag de ambiente. Dois arquivos de worker afetados + função auxiliar nova. Estimativa: 1,5-2 dias de @dev.

## Dev Agent Record

### File List
- `worker/empregabilidade_engine.py` — modificado (transbordo dúvida + keyword: status='awaiting_human' + chama _notificar_transbordo)
- `worker/meta_adapter_inbound.py` — modificado (_notificar_transbordo nova, _AGENTE_MODULO_MAP, _chamar_motor_agente com phone_number_id_origem + notificação no handover)
- `worker/.env.example` — adicionado META_TEMPLATES_APROVADOS=false
- `worker/tests/test_meta_adapter_inbound.py` — modificado (TestNotificarTransbordo: 3 novos testes; handover test atualizado; motor-agente handover test adicionado)

### Tasks

- [x] Criar função `_notificar_transbordo(conversa_id, modulo, unidade_cuca, phone_number_id_origem, lead_identificacao)`: ler `human_handover_contacts`, enviar template se flag=true, logar se flag=false, não falhar se sem contatos
- [x] `empregabilidade_engine.py` transbordo por dúvida (linha 1899): setar `conversas.status='awaiting_human'` + chamar `_notificar_transbordo`
- [x] `empregabilidade_engine.py` transbordo por keyword (linha 1929): idem
- [x] `meta_adapter_inbound.py` motor-agente: contrato de resposta JÁ expõe `handover=True` (verificado em S-WM-10 debug log: campo existe, código em _chamar_motor_agente:279). Integração: `_chamar_motor_agente` recebe `phone_number_id_origem`, chama `_notificar_transbordo` no bloco handover com `modulo` derivado de `_AGENTE_MODULO_MAP[agente_tipo]`. ACs 7-8 satisfeitos.
- [x] Adicionar `META_TEMPLATES_APROVADOS` (default false) em variáveis de ambiente; documentar
- [x] Executar `pytest worker/tests/` e confirmar sem regressão

### Debug Log

**Contrato motor-agente (Task 4):**
- Campo `handover` JÁ existe no contrato de resposta do motor-agente — confirmado em S-WM-10 debug log (`_chamar_motor_agente:279` já lia `data.get("handover")`). ACs 7-8 satisfeitos sem dívida.
- `_AGENTE_MODULO_MAP` adicionado em `meta_adapter_inbound.py`: `sofia→ouvidoria`, `Institucional→programacao`, `maria→programacao`, `ana→acesso_cuca`.
- `_chamar_motor_agente` recebeu 4º param `phone_number_id_origem: str = ""` (default vazio para backward compat com testes existentes). Dispatch site passa `phone_number_id`.
- `human_handover_contacts` vazia em cuca-dev (sem registros de teste). Comportamento confirmado via AC5: fluxo não falha, warning logado.
- `pytest worker/tests/`: 50/50 passed, 3 skipped — zero regressões.

### Completion Notes

- `_notificar_transbordo` vive em `meta_adapter_inbound.py` — chamada lazy-import por `empregabilidade_engine.py` (`from meta_adapter_inbound import _notificar_transbordo  # noqa: PLC0415`) para evitar circular import em módulo load. Padrão já existente no projeto.
- Prioridade 2-tier (AC4): query específica por unidade_cuca primeiro; se vazia, fallback global (is null). Um único tier notificado por execução.
- `_notificar_transbordo` envolve tudo em try/except global — nunca propaga falha ao fluxo principal.
- `META_TEMPLATES_APROVADOS=false` garante que staging funciona sem template aprovado (AC2): loga "notificaria {telefone} mas META_TEMPLATES_APROVADOS=false", sem POST à Graph API.
- `_enviar_template_meta` (em `campanhas_engine.py`) é async — chamada com `await` dentro do loop de contatos.
- Assinatura final: `_notificar_transbordo(conversa_id, modulo, unidade_cuca, phone_number_id_origem, lead_identificacao)` — 5 params (story listava 4; lead_identificacao adicionado para preencher {{2}} do template).
- Motor-agente (ACs 7-8): sinal `handover` existe, código já setava status. Esta story apenas adiciona log `[transbordo] motor-agente {agente_tipo} sinalizado` e chamada à `_notificar_transbordo`. Não há dívida técnica no contrato.
- AC9 N/A: sinal handover existe — nenhuma dívida a documentar.

## QA Results

### Review Date: 2026-06-28

### Reviewed By: Quinn (Test Architect)

**Veredito:** ✅ PASS WITH CONCERNS — 7/7 checks OK, ACs 1-2/4-10 atendidos, AC3 WAIVED, 50/50 testes passando.

**Checks:**
- Code Review: PASS — _notificar_transbordo com try/except global, lazy import correto, 2-tier priority, fallback defensivo no modulo map
- Unit Tests: PASS — 50/50 (4 novos testes: 3 × TestNotificarTransbordo + 1 handover motor-agente), handover test atualizado
- Acceptance Criteria: PASS (AC3 WAIVED per @po) — ACs 1,2,4,5,6,7,8,9,10 verificados
- Regressão: PASS — zero falhas nos 50 testes pré-existentes
- Performance: PASS — transbordo não é hot path, query O(1-2) contacts
- Segurança: PASS — nenhuma nova superfície, token de env var, dados de DB interno
- Documentação: PASS — .env.example, Completion Notes, Debug Log e Change Log completos

**Issues:**
- M-001 (MEDIUM): `test_processar_webhook_motor_agente_handover_chama_notificar` declara `mock_notif` mas não faz assert sobre ele. `_chamar_motor_agente` é mockado, logo `_notificar_transbordo` nunca corre nesse teste. Nome promete "chama_notificar" mas não verifica. Cobertura AC7/8 existe via `test_chamar_motor_agente_handover_atualiza_status`. Dívida de teste — não bloqueia.
- L-001 (LOW): `from campanhas_engine import _enviar_template_meta` dentro do `for` loop. Python faz cache do módulo — sem impacto funcional. Puramente idiomático.
- L-002 (LOW): AC3 sem teste automatizado (dependência de template Meta aprovado). WAIVED alinhado com @po.

### Gate Status

Gate: PASS WITH CONCERNS → docs/qa/gates/s-wm-09-transbordo-completo.yml

---

### Change Log
| Data | Agente | Ação |
|---|---|---|
| 2026-06-27 | @sm (River) | Story criada a partir de levantamento cross-módulo do @dev (Dex) |
| 2026-06-27 | @po (Pax) | Validação GO 10/10 — status promovido Draft → Ready. Obs: AC3 deve ser WAIVED pelo @qa se template não aprovado; usar AC2 como substituto |
| 2026-06-27 | @po (Pax) | Ajuste pós-validação: ACs expandidos para cobrir explicitamente motor-agente/sofia e motor-agente/maria (ACs 7-9); escopo e task 4 reescritos para deixar claro que _notificar_transbordo é sempre worker Python, nunca Edge Function; mapeamento agente_tipo→modulo adicionado |
| 2026-06-27 | @dev (Dex) | Implementação concluída — _notificar_transbordo, _AGENTE_MODULO_MAP, transbordo Empregabilidade dúvida+keyword, motor-agente handover integrado, META_TEMPLATES_APROVADOS; 50/50 testes OK |
| 2026-06-28 | @qa (Quinn) | QA Gate PASS WITH CONCERNS — 50/50 testes, ACs 1-2/4-10 verificados, AC3 WAIVED, M-001/L-001/L-002 registrados |
