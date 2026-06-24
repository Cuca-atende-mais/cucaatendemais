# S-WM-02 — Migração Total Outbound Meta: Empregabilidade

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
  - teste integrado na WABA de staging
```

## Story
**Como** worker do Cuca Atende Mais,  
**quero** processar e enviar mensagens da Empregabilidade exclusivamente pela Meta Cloud API,  
**para que** o fluxo funcione ponta a ponta sem instâncias, tokens ou infraestrutura UAZAPI.

## Decisão

Migração total para Meta. Não existe coexistência, ponte ou fallback UAZAPI no fluxo principal nem na Empregabilidade.

No mundo Meta:

- origem: `phone_number_id`;
- autenticação: `META_SYSTEM_USER_TOKEN` global;
- não existe `instance_name`;
- não existe token por instância;
- não existe lookup de envio em `instancias_uazapi`.

### Compatibilidade temporária de persistência

Até a migration da S-WM-03, o valor de `phone_number_id` será armazenado em `conversas.instancia_uazapi`.

Esta é uma compatibilidade exclusivamente de schema:

- a coluna é `varchar`, `NOT NULL` e participa da chave única da conversa;
- o valor continua sendo semanticamente uma string de identificação da origem;
- não representa uma instância UAZAPI;
- não autoriza lookup em `instancias_uazapi`, token por instância ou transporte UAZAPI;
- S-WM-03 renomeará/migrará a coluna e removerá definitivamente o nome legado.

## Escopo

### IN

- Criar `worker/meta_adapter_outbound.py`.
- Fechar o dispatch inbound Meta → engine.
- Migrar todo envio da Empregabilidade para Graph API.
- Migrar o loop proativo da Empregabilidade.
- Tornar `/send-message/{token}` Meta puro.
- Remover infraestrutura UAZAPI de `worker/main.py`.
- Remover `worker/uazapi_manager.py`.
- Remover endpoint `/read-message/{token}` e integrações `/chat/read`.
- Remover eventos de conexão, status de ban e anti-ban do fluxo principal.
- Atualizar env vars e testes.

### Exceções preservadas

- `worker/campanhas_engine.py` permanece intacto, incluindo warm-up e UAZAPI.
- Divulgação permanece intacta.
- Outros engines (`institucional`, Ouvidoria e Acesso) não são migrados nesta story.
- Resíduos UAZAPI nesses arquivos fora do escopo são permitidos, mas não podem ser importados ou executados pelo fluxo Meta da Empregabilidade.

### OUT

- Portal Next.js.
- Schema real de `meta_phone_numbers` — S-WM-03.
- Templates Meta.
- Mídia outbound.
- Alerta interno para atendentes.
- Migração de Campanhas, Divulgação e outros engines.
- Produção.

## Critérios de Aceite

1. **Given** `_meta_enviar(phone_number_id, to, text, token)`, **when** chamado, **then** envia:

   ```http
   POST https://graph.facebook.com/v23.0/{phone_number_id}/messages
   Authorization: Bearer {token}
   Content-Type: application/json
   ```

   ```json
   {
     "messaging_product": "whatsapp",
     "to": "DESTINATARIO",
     "type": "text",
     "text": {"body": "MENSAGEM"}
   }
   ```

2. **Given** resposta `2xx`, **when** o envio conclui, **then** retorna sucesso testável, sem delay anti-ban.

3. **Given** `4xx`, `5xx`, timeout ou erro de rede, **when** o envio falha, **then** registra erro sanitizado e retorna/propaga falha testável, sem fallback UAZAPI.

4. **Given** token ou `phone_number_id` ausente, **when** há tentativa de envio, **then** falha antes do HTTP e não expõe segredo em logs.

5. **Given** um webhook Meta válido, **when** `processar_webhook_meta()` constrói o Contrato v2, **then**, antes do dispatch:
   - faz upsert de `leads` por `telefone`;
   - recupera ou cria a `conversa` usando `(lead_id, phone_number_id)`, persistindo temporariamente `phone_number_id` em `conversas.instancia_uazapi`;
   - insere a mensagem inbound em `mensagens` com `remetente="lead"`;
   - incrementa `nao_lidas`;
   - respeita `bloqueado` e o status atual da conversa;
   - não consulta `instancias_uazapi`.

6. **Given** Lead, Conversa e Mensagem persistidos com sucesso, **when** o Contrato v2 possui `agente_tipo="Empregabilidade"`, **then** despacha para `processar_mensagem_empregabilidade()` usando `agente_tipo` e `canal_tipo`, com `phone_number_id`, telefone, mensagem, unidade, `lead_id`, `conversa_id` e nome disponíveis, sem chamar `process_webhook_payload()` e sem envelope UAZAPI.

7. **Given** o fluxo reativo da Empregabilidade, **when** produz resposta, **then** usa somente `_meta_enviar()` com:
   - `META_STUB_PHONE_NUMBER_ID_EMPREG`;
   - destinatário `phone`;
   - `META_SYSTEM_USER_TOKEN`.

8. **Given** uma resposta Meta enviada com sucesso, **when** houver `conversa_id`, **then** preserva a gravação em `mensagens` para exibição no painel.

9. **Given** o cidadão pede atendimento humano, **when** o engine detecta dúvida ou palavra-chave de transbordo, **then**:
   - envia ao cidadão: `Sua solicitação foi registrada. Em breve você será atendido por nossa equipe.`;
   - registra log estruturado com evento, telefone mascarado, conversa, unidade e motivo;
   - não envia alerta ao atendente;
   - não marca transferência como concluída.

10. **Given** o loop `empregabilidade_notify_loop()`, **when** encontra retorno pendente do portal, **then** preserva filtro, intervalo, mensagens e estados, mas usa exclusivamente `META_STUB_PHONE_NUMBER_ID_EMPREG` + `META_SYSTEM_USER_TOKEN`.

11. **Given** falha Graph API no loop proativo, **when** o envio não retorna `2xx`, **then** não avança o estado da conversa e não tenta UAZAPI.

12. **Given** `/send-message/{token}`, **when** recebe `{number, text, instance}`, **then**:
   - valida `WEBHOOK_INTERNAL_TOKEN`;
   - ignora `instance` apenas por compatibilidade temporária do contrato do portal;
   - envia via Graph API com `META_STUB_PHONE_NUMBER_ID_EMPREG`;
   - não consulta `instancias_uazapi`;
   - não possui ramo UAZAPI.

13. **Given** os dois chamadores antigos que enviam `phone/message` e token de instância, **when** chamam o endpoint, **then** são rejeitados pelo contrato atual; seus arquivos do portal não são corrigidos nesta story.

14. **Given** `worker/main.py` após a implementação, **when** inspecionado, **then** não contém:
   - router/import de `uazapi_manager`;
   - `/webhook/{token}` UAZAPI;
   - connection events UAZAPI;
   - ban detection UAZAPI;
   - anti-ban passivo;
   - `/send/text`;
   - `/message/sendMedia`;
   - `/chat/read`;
   - lookup de token para envio em `instancias_uazapi`.

15. **Given** `worker/uazapi_manager.py`, **when** a story termina, **then** o arquivo está removido, pois só era importado por `main.py`.

16. **Given** a configuração do worker principal, **when** revisada, **then** remove:
   - `UAZAPI_MASTER_TOKEN`;
   - `WORKER_PUBLIC_URL`;
   - usos de `UAZAPI_BASE_URL` fora das exceções preservadas.

17. **Given** os arquivos de Empregabilidade e Meta, **when** executado o grep de regressão, **then** não há referências funcionais a instância/token UAZAPI ou endpoints UAZAPI.

18. **Given** a suíte automatizada, **when** executada, **then** cobre cliente Graph API, dispatch inbound, engine, transbordo neutro, loop proativo, `/send-message` Meta puro, falhas e ausência de segredos.

19. **Given** a WABA “Rede CUCA - Ivida teste”, **when** executado um fluxo controlado, **then** uma mensagem inbound Meta chega ao engine e a resposta outbound é recebida pelo WhatsApp de teste.

## Dev Notes

### Cliente outbound

Criar `worker/meta_adapter_outbound.py`:

```python
GRAPH_API_VERSION = "v23.0"

async def _meta_enviar(
    phone_number_id: str,
    to: str,
    text: str,
    token: str,
):
    ...
```

Não implementar mídia, template, delay ou fallback.

### Dispatch inbound

Em `worker/meta_adapter_inbound.py`, após `build_contrato_v2()`:

```text
Contrato v2
  → upsert Lead por telefone
  → recuperar/criar Conversa do canal Meta
  → inserir Mensagem inbound
  → incrementar não lidas
  → agente_tipo/canal_tipo
  → engine correspondente
```

Nesta story, fechar obrigatoriamente o caminho de Empregabilidade. Outros engines permanecem fora do escopo.

Não chamar `process_webhook_payload()`: essa função pertence ao envelope UAZAPI.

Adaptar o padrão existente de `worker/main.py:363-434`:

- `leads.upsert(..., on_conflict="telefone")`;
- fresh select de `bloqueado`;
- recuperar ou criar conversa por `lead_id + phone_number_id` e preservar seu `status`;
- gravar temporariamente o `phone_number_id` em `conversas.instancia_uazapi`, sem consultar a tabela `instancias_uazapi`;
- inserir em `mensagens` antes do engine;
- `increment_nao_lidas` para mensagem do cidadão.

Não buscar `agente_tipo`, `canal_tipo` ou token em `instancias_uazapi`: esses valores já vêm do Contrato v2.

O nome legado da coluna é tolerado somente na camada de persistência até S-WM-03. Em variáveis, contratos, logs e APIs, usar `phone_number_id`/`canal_origem`.

### Contexto Meta da Empregabilidade

Remover `instance_name` e token UAZAPI das assinaturas usadas para envio. O engine recebe `phone_number_id`.

Stub:

```python
META_STUB_PHONE_NUMBER_ID_EMPREG
```

Token:

```python
META_SYSTEM_USER_TOKEN
```

S-WM-03 substituirá o stub por query em `meta_phone_numbers`.

### `/send-message`

Contrato temporariamente preservado para o portal:

```json
{"number": "...", "text": "...", "instance": "..."}
```

`instance` é ignorado. O endpoint é Meta puro.

Contrato antigo `phone/message` não será suportado.

### Transbordo

Mensagem exata:

```text
Sua solicitação foi registrada. Em breve você será atendido por nossa equipe.
```

Log estruturado mínimo:

```python
{
    "event": "handover_requested",
    "telefone": "<mascarado>",
    "conversa_id": "...",
    "unidade_cuca": "...",
    "motivo": "duvida|palavra_chave",
}
```

### Remoção de UAZAPI

`uazapi_manager.py` pode ser excluído: a busca confirmou que é importado somente por `worker/main.py`.

Remover de `main.py`:

- router do manager;
- `process_webhook_payload()` e rota `/webhook/{token}` UAZAPI;
- connection/ack/message handlers UAZAPI;
- STOP handler UAZAPI;
- anti-ban;
- transbordo UAZAPI;
- flyer/media UAZAPI;
- `/read-message/{token}`.

### Exceções

Não alterar:

- `worker/campanhas_engine.py`;
- código específico de Divulgação;
- `worker/institucional_engine.py`;
- portal.

Se esses arquivos ainda contiverem UAZAPI, isso não viola esta story. Eles não podem, porém, ser usados pelo fluxo Meta da Empregabilidade.

### Env vars

Adicionar:

```text
META_STUB_PHONE_NUMBER_ID_EMPREG=
```

Manter:

```text
META_SYSTEM_USER_TOKEN=
```

Remover da configuração do worker principal:

```text
UAZAPI_MASTER_TOKEN
WORKER_PUBLIC_URL
```

`UAZAPI_BASE_URL` só pode permanecer onde exigido pelas exceções Campanhas/Divulgação.

## Tasks

- [x] **1. Cliente Graph API** (AC: 1–4)
  - [x] Criar `meta_adapter_outbound.py`.
  - [x] Implementar validação, logs sanitizados e tratamento de falhas.

- [x] **2. Persistência inbound Meta** (AC: 5)
  - [x] Fazer upsert do Lead por telefone.
  - [x] Verificar bloqueio com fresh select.
  - [x] Recuperar ou criar a Conversa por `(lead_id, phone_number_id)`.
  - [x] Persistir temporariamente `phone_number_id` em `conversas.instancia_uazapi`.
  - [x] Inserir a Mensagem inbound antes do engine.
  - [x] Incrementar mensagens não lidas.
  - [x] Não consultar `instancias_uazapi`.

- [x] **3. Dispatch inbound Meta** (AC: 6)
  - [x] Despachar Contrato v2 persistido para Empregabilidade.
  - [x] Passar `lead_id` e `conversa_id` reais ao engine.
  - [x] Não reutilizar `process_webhook_payload()`.

- [x] **4. Migrar Empregabilidade** (AC: 7–9, 17)
  - [x] Trocar `_enviar()` por `_meta_enviar()`.
  - [x] Propagar `phone_number_id`.
  - [x] Preservar persistência no painel.
  - [x] Implementar transbordo neutro e log estruturado.
  - [x] Remover todos os transportes UAZAPI do engine.

- [x] **5. Migrar loop proativo** (AC: 10–11)
  - [x] Remover lookup em `instancias_uazapi`.
  - [x] Usar env vars Meta.
  - [x] Atualizar estado somente após `2xx`.

- [x] **6. Tornar `/send-message` Meta puro** (AC: 12–13)
  - [x] Preservar autenticação interna e body canônico.
  - [x] Ignorar `instance`.
  - [x] Rejeitar contrato antigo.
  - [x] Remover ramo UAZAPI.

- [x] **7. Remover infraestrutura UAZAPI principal** (AC: 14–16)
  - [x] Limpar `main.py`.
  - [x] Excluir `uazapi_manager.py`.
  - [x] Remover env vars obsoletas (`UAZAPI_MASTER_TOKEN`, `WORKER_PUBLIC_URL` removidos de main.py; `UAZAPI_BASE_URL` permanece somente nas exceções Campanhas/Divulgação).
  - [x] Preservar arquivos explicitamente fora do escopo.

- [x] **8. Testes e staging** (AC: 18–19)
  - [x] Criar `worker/tests/test_meta_adapter_outbound.py`.
  - [x] Testar persistência inbound, dispatch, engine, loop, endpoint e transbordo.
  - [x] Executar regressão inbound S-WM-01.
  - [ ] Validar ponta a ponta na WABA de staging. *(bloqueado: número não pareado; pendente liberação pelo sócio)*
  - [x] Registrar evidência sanitizada no Dev Agent Record.

## Testing

```bash
python3 -m py_compile \
  worker/meta_adapter_inbound.py \
  worker/meta_adapter_outbound.py \
  worker/empregabilidade_engine.py \
  worker/main.py

python3 -m pytest \
  worker/tests/test_meta_adapter_inbound.py \
  worker/tests/test_meta_adapter_outbound.py
```

Regressão:

```bash
rg -n \
  "uazapi_manager|UAZAPI_BASE_URL|UAZAPI_MASTER_TOKEN|WORKER_PUBLIC_URL|/send/text|/message/sendMedia|/chat/read|inst_token" \
  worker/main.py worker/empregabilidade_engine.py worker/meta_adapter_inbound.py worker/meta_adapter_outbound.py
```

Resultado esperado: zero ocorrências funcionais.

## Riscos

| Risco | Mitigação |
|---|---|
| Corte total quebra fluxo legado | Testes de regressão + staging antes de produção |
| Inbound despacha sem contexto de conversa/lead | Criar/recuperar lead e conversa no dispatch Meta antes de chamar engine |
| Graph API falha e estado avança | Atualizar estado somente após envio `2xx` |
| Chamadores antigos do portal deixam de enviar | Dívida conhecida; não ampliar escopo |
| Código UAZAPI removido afeta exceções | Não alterar Campanhas/Divulgação/outros engines |

## Dependências

- S-WM-01.
- `META_SYSTEM_USER_TOKEN` de staging.
- `META_STUB_PHONE_NUMBER_ID_EMPREG`.
- Número autorizado na WABA de teste.

**Desbloqueia:** S-WM-03.

## Quality Gate

`@qa` bloqueia se:

- Lead, Conversa e Mensagem não forem persistidos antes do dispatch;
- o inbound Meta não alcançar a Empregabilidade;
- existir fallback ou transporte UAZAPI no fluxo Meta/Empregabilidade;
- `main.py` ainda expuser infraestrutura UAZAPI;
- `uazapi_manager.py` permanecer;
- estado avançar após falha de envio;
- segredo aparecer em logs;
- Campanhas/Divulgação/outros engines forem alterados;
- não houver validação staging.

## PO Validation Results

### Veredito

**GO — 10/10. Story aprovada para implementação.**

**Data:** 2026-06-24  
**Agente:** `@po` (Pax)

O ajuste solicitado resolveu o bloqueio de contexto do dispatch: a story exige upsert de Lead, recuperação/criação de Conversa e insert de Mensagem antes de chamar o engine.

Também estão resolvidos os antigos bloqueios de:

- dispatch Meta → Empregabilidade;
- roteamento híbrido — removido, `/send-message` agora é Meta puro;
- transbordo — mensagem neutra e log estruturado definidos.

### Decisão técnica aprovada

O schema local atual ainda exige:

```text
conversas.instancia_uazapi NOT NULL
UNIQUE (lead_id, instancia_uazapi)
```

Evidências:

- `schema_producao.sql:1769`;
- `schema_producao.sql:2941`.

Aprovada a opção 2:

- armazenar temporariamente `phone_number_id` em `conversas.instancia_uazapi`;
- usar `(lead_id, phone_number_id)` para recuperar/criar a conversa;
- tratar a coluna apenas como armazenamento legado de uma string de origem;
- não consultar `instancias_uazapi`;
- não usar token ou transporte UAZAPI;
- migrar/renomear a coluna em S-WM-03.

### Resultado final

Todos os bloqueios anteriores estão resolvidos:

- persistência antes do dispatch;
- dispatch inbound Meta → Empregabilidade;
- `/send-message` Meta puro;
- transbordo neutro;
- identidade temporária da conversa definida.

A story está autocontida, testável e pronta para `@dev`.

## Dev Agent Record

### Agent Model Used
claude-sonnet-4-6

### Completion Notes

- `meta_adapter_outbound.py` criado do zero: cliente Graph API v23.0, lazy import de httpx, token nunca exposto em logs, sem delay anti-ban.
- `meta_adapter_inbound.py`: adicionado lazy singleton para supabase (evita colisão de namespace com pasta `supabase/`), implementada persistência completa (upsert lead, fresh select bloqueado, get/create conversa por `(lead_id, phone_number_id)`, insert mensagem, increment_nao_lidas), dispatch para `processar_mensagem_empregabilidade`.
- `empregabilidade_engine.py`: `_enviar()` migrada para `_meta_enviar()` (retorna bool), transbordo neutro sem alerta ao atendente, `empregabilidade_notify_loop()` remove lookup em `instancias_uazapi`, `_set_fluxo()` só chamado após `_ok=True`. Import httpx tornado lazy.
- `main.py`: removidos anti-ban, router uazapi_manager, `process_webhook_payload()` (~630 linhas), rota `/webhook/{token}`, `/read-message/{token}`. Endpoint `/send-message/{token}` é Meta puro.
- `uazapi_manager.py`: arquivo removido.
- `test_meta_adapter_inbound.py`: touch point 1 atualizado para refletir remoção de `process_webhook_payload` (S-WM-02).
- `test_meta_adapter_outbound.py`: 15 testes ativos (3 skipped por ausência de fastapi no ambiente de teste), todos passando.
- Regressão limpa: zero referências funcionais UAZAPI nos arquivos de escopo.
- AC #19 (WABA staging) bloqueado — número não pareado; pendente liberação pelo sócio.

### File List

#### Criados
- `worker/meta_adapter_outbound.py`
- `worker/tests/test_meta_adapter_outbound.py`

#### Modificados
- `worker/meta_adapter_inbound.py`
- `worker/empregabilidade_engine.py`
- `worker/main.py`
- `worker/tests/test_meta_adapter_inbound.py`

#### Removidos
- `worker/uazapi_manager.py`

### Change Log

| Data | Agente | Alteração |
|---|---|---|
| 2026-06-24 | @dev | Task 1: `meta_adapter_outbound.py` criado (ACs 1–4) |
| 2026-06-24 | @dev | Task 2: persistência inbound Meta em `meta_adapter_inbound.py` (AC 5) |
| 2026-06-24 | @dev | Task 3: dispatch inbound → Empregabilidade (AC 6) |
| 2026-06-24 | @dev | Task 4: migração `_enviar()` + transbordo neutro em `empregabilidade_engine.py` (ACs 7–9, 17) |
| 2026-06-24 | @dev | Task 5: loop proativo migrado para Meta (ACs 10–11) |
| 2026-06-24 | @dev | Task 6: `/send-message` Meta puro, `/read-message` removido (ACs 12–13) |
| 2026-06-24 | @dev | Task 7: remoção de infraestrutura UAZAPI de main.py + exclusão de uazapi_manager.py (ACs 14–16) |
| 2026-06-24 | @dev | Task 8: testes, regressão, py_compile (AC 18); AC 19 bloqueado — staging pendente |

## QA Results
_A preencher pelo @qa._

## Change Log

| Data | Versão | Descrição | Autor |
|---|---:|---|---|
| 2026-06-23 | 1.0 | Reescrita: migração total Meta, sem coexistência ou ponte UAZAPI | @sm (River) |
| 2026-06-24 | 1.1 | AC #5/#6 ampliados com persistência de Lead, Conversa e Mensagem antes do dispatch; revalidação PO 8/10 com bloqueio de schema | @po (Pax) |
| 2026-06-24 | 1.2 | Decisão aprovada: `phone_number_id` armazenado temporariamente em `conversas.instancia_uazapi` até S-WM-03. Validação PO GO 10/10 | @po (Pax) |
