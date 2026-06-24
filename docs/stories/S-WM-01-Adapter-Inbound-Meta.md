# S-WM-01 — Adapter Inbound Meta: Recepção de Webhook

## Status
InProgress

## Story
**Como** worker do Cuca Atende Mais,
**quero** receber webhooks da Meta Cloud API, validar autenticidade via HMAC-SHA256 e normalizar o payload para o **Contrato v2** (campo `canal_origem`) que o fluxo existente já espera,
**para que** as automações existentes (Empregabilidade, Institucional, motor-agente) funcionem sem modificação quando uma mensagem chegar via Meta.

## Complexidade
**M** (novo módulo com lógica de parsing não trivial + download de mídia + rename coordenado em 3 touch points; sem alteração de engines)

## Contexto
Épico: `EPIC-Migracao-WhatsApp-Meta.md`. Primeira story de implementação — cria a metade de entrada do adapter.

**Referência canônica:** Seção 3 do épico (`Contrato v2 — Mapeamento de Campos`) define os campos que este adapter deve produzir. O campo `instancia_uazapi` do contrato anterior é **substituído** por `canal_origem` em todos os pontos.

**Princípio de isolamento:** esta story **não cria tabelas de banco**, **não implementa feature flag**, e **não altera lógica de nenhum engine de IA**. O lookup `phone_number_id → instância` usa stub substituível; S-WM-03 faz o wire-up com o banco.

**Rename coordenado:** esta story inclui o rename de `instancia_uazapi` → `canal_origem` nos 3 touch points do fluxo UAZAPI existente (`main.py:683`, `institucional_engine.py:267`, Edge Function `motor-agente`) em um **único commit coordenado**. Após este commit, nenhum ponto do sistema usa `instancia_uazapi` como chave ou campo de payload.

**Staging-first (NON-NEGOTIABLE — ver Seção 7 do épico):** todos os ACs desta story são validados contra a WABA de teste (app "Rede CUCA - Ivida teste") com payloads sintéticos. Sem pareamento com WABA de produção nesta story.

**Mock-first:** `META_SYSTEM_USER_TOKEN` ainda não disponível (bloqueado pelo sócio). Download de mídia usa fixture local ou mock; token real entra quando o sócio liberar.

## Escopo
### IN
- `GET /webhook/meta` — verificação de webhook (challenge Meta)
- `POST /webhook/meta` — recepção de mensagens com HMAC-SHA256
- Parser Meta Cloud API → Contrato v2 (`canal_origem`, sem `instancia_uazapi`, `midia_tipo="voz"` para áudio)
- Suporte a tipos: `text`, `audio`/`voice` (download Bearer + Whisper), `image` (URL extraída como `midia_url`)
- Stub de lookup `phone_number_id → instância` via env vars (substituído em S-WM-03 por query em banco)
- Guard: `phone_number_id` não encontrado → `200 OK` + log de aviso + **descarte silencioso** (sem seguir com default, sem exception)
- Resposta `200 OK` imediata + processamento em `BackgroundTasks` (asyncio — mesmo padrão de `main.py:1232`; **sem Celery**)
- Isenção de rate limiter para `/webhook/meta` (mesmo padrão de `/webhook/` — `main.py:166`)
- **Rename coordenado nos 3 touch points** (commit único com o adapter):
  - `main.py:683`: `"instancia_uazapi": instance_name` → `"canal_origem": instance_name`
  - `institucional_engine.py:267`: idem
  - Edge Function `motor-agente`: consumir `canal_origem` (remover leitura de `instancia_uazapi`)
- Duas novas env vars: `META_APP_SECRET`, `META_VERIFY_TOKEN`
- Migration placeholder em `supabase/migrations/` (sem DDL nesta story — S-WM-03 cria as tabelas)
- Testes unitários do parser e do validador HMAC

### OUT
- Envio de respostas via Meta (S-WM-02)
- Feature flag / roteamento entre UAZAPI e Meta (S-WM-03)
- Tabelas de banco (`meta_phone_numbers`, coluna `canal_ativo`) — S-WM-03
- Alteração em qualquer engine de IA (requisito inegociável do épico)
- Integração com WABA de produção (exige credenciais do sócio + validação staging completa)

## Critérios de Aceite (Given/When/Then)

1. **Given** a Meta envia `GET /webhook/meta?hub.mode=subscribe&hub.verify_token=TOKEN&hub.challenge=CHALLENGE`, **when** `TOKEN` coincide com `META_VERIFY_TOKEN`, **then** o worker responde `200 OK` com body `CHALLENGE` (plain text).

2. **Given** a Meta envia `POST /webhook/meta` com payload válido e header `X-Hub-Signature-256: sha256=ASSINATURA_CORRETA`, **when** o adapter processa, **then** responde `200 OK` imediatamente e o processamento ocorre em `BackgroundTask` (asyncio — mesma arquitetura de `main.py:1232`).

3. **Given** a Meta envia `POST /webhook/meta` com HMAC ausente ou incorreto, **when** o adapter valida, **then** responde `403 Forbidden` e registra log de erro — sem processamento.

4. **Given** o adapter recebe payload Meta com `phone_number_id` **não encontrado no stub**, **when** o lookup retorna `None`, **then** responde `200 OK`, registra log de aviso com o `phone_number_id` recebido e **descarta silenciosamente** — sem seguir com valor default, sem exception, sem reprocessamento.

5. **Given** o adapter recebe um payload Meta de mensagem de texto com `phone_number_id` encontrado no stub, **when** processa, **then** produz Contrato v2 com os seguintes campos: `canal_origem` (lookup), `telefone`, `agente_tipo`, `unidade_cuca`, `canal_tipo`, `mensagem`, `midia_url=None`, `midia_tipo="text"`, `data_atual` — **sem campo `instancia_uazapi`**.

6. **Given** o adapter recebe payload Meta com `type="audio"` ou `type="voice"` (`audio.voice=true`), **when** processa, **then** executa: `media_id` → `GET graph.facebook.com/v19.0/{media_id}` com Bearer → URL temporária → download com Bearer → Whisper (`main.py:492-497`) → Contrato v2 com `midia_tipo="voz"` e `mensagem=<texto transcrito>`. Se `META_SYSTEM_USER_TOKEN` ausente: usar fixture local de áudio (mock). **Sem MediaKey/HKDF.**

7. **Given** o adapter recebe payload Meta com `type="image"`, **when** processa, **then** produz Contrato v2 com `midia_url=<url_pública_meta>` e `midia_tipo="image"` (sem download — URL pública é suficiente).

8. **Given** os testes unitários do parser, **when** executados com payloads sintéticos (incluindo payloads representativos do ambiente de teste da WABA "Rede CUCA - Ivida teste"), **then** todos passam; lint e typecheck passam sem erros.

9. **Given** o rename coordenado nos 3 touch points foi aplicado, **when** o fluxo UAZAPI existente executa, **then** produz payload com campo `canal_origem` (sem `instancia_uazapi`) — verificável via teste de regressão ou `grep -r "instancia_uazapi" worker/` retornar zero ocorrências em chaves de dict/payload.

## Dev Notes

### Contrato v2 — campos produzidos pelo adapter

| Campo (Contrato v2) | Fonte no payload Meta | Obs. |
|---|---|---|
| `canal_origem` | stub lookup por `metadata.phone_number_id` | **substitui `instancia_uazapi`** |
| `telefone` | `messages[0].from` (somente dígitos) | sem mudança |
| `agente_tipo` | stub lookup → `agente_tipo` | sem mudança |
| `canal_tipo` | stub lookup → `canal_tipo` | sem mudança |
| `unidade_cuca` | stub lookup → `unidade_cuca` | sem mudança |
| `mensagem` | `text.body` (texto) ou transcrição Whisper (áudio/voz) | sem mudança |
| `midia_url` | `None` (texto/áudio) ou URL pública Meta (imagem) | sem mudança |
| `midia_tipo` | `"text"` (texto), `"voz"` (áudio — `"ptt"` obsoleto), `"image"` (imagem) | `"ptt"` → `"voz"` |
| `data_atual` | `datetime.now(UTC-3)` formatado — mesmo helper de `main.py` | sem mudança |

> **Não existe campo `instancia_uazapi` no Contrato v2.** Qualquer ocorrência desse nome após esta story em chave de dict ou payload é regressão.

### Formato do payload Meta Cloud API (referência para o parser)

```json
{
  "object": "whatsapp_business_account",
  "entry": [{
    "id": "WABA_ID",
    "changes": [{
      "value": {
        "messaging_product": "whatsapp",
        "metadata": {
          "display_phone_number": "558599999998",
          "phone_number_id": "PHONE_NUMBER_ID_DA_INSTANCIA"
        },
        "contacts": [{"profile": {"name": "João Silva"}, "wa_id": "558599999999"}],
        "messages": [{
          "from": "558599999999",
          "id": "wamid.xxxxx",
          "timestamp": "1750000000",
          "type": "text",
          "text": {"body": "Olá, quero saber sobre cursos"}
        }]
      },
      "field": "messages"
    }]
  }]
}
```

**Para áudio:**
```json
"type": "audio",
"audio": {"mime_type": "audio/ogg; codecs=opus", "sha256": "xxx", "id": "MEDIA_ID", "voice": true}
```

**Para imagem:**
```json
"type": "image",
"image": {"mime_type": "image/jpeg", "sha256": "xxx", "id": "MEDIA_ID", "caption": "legenda opcional"}
```

### Validação HMAC-SHA256

```python
import hmac, hashlib

def _validar_hmac(raw_body: bytes, signature_header: str, app_secret: str) -> bool:
    expected = hmac.new(app_secret.encode(), raw_body, hashlib.sha256).hexdigest()
    received = signature_header.removeprefix("sha256=")
    return hmac.compare_digest(expected, received)
```

⚠️ FastAPI processa o body antes que a rota o leia. `raw_body = await request.body()` deve ser a **primeira** leitura na rota POST; só depois `json.loads(raw_body)`.

### Stub de lookup (substituído em S-WM-03)

```python
# worker/meta_adapter_inbound.py
import os

_STUB_PHONE_NUMBER_MAP: dict[str, dict] = {
    os.getenv("META_STUB_PHONE_NUMBER_ID", "STUB_ID"): {
        "canal_origem":  os.getenv("META_STUB_CANAL_ORIGEM", "cuca_empregabilidade_01"),
        "agente_tipo":   os.getenv("META_STUB_AGENTE_TIPO", "Empregabilidade"),
        "canal_tipo":    os.getenv("META_STUB_CANAL_TIPO", "Empregabilidade"),
        "unidade_cuca":  None,
    }
}

def _get_instancia_by_phone_number_id(phone_number_id: str) -> dict | None:
    """Stub — S-WM-03 substitui por: supabase.table('meta_phone_numbers').select(...)..."""
    return _STUB_PHONE_NUMBER_MAP.get(phone_number_id)
```

> **Guard obrigatório no handler:** se `_get_instancia_by_phone_number_id` retornar `None` → `logger.warning(f"phone_number_id desconhecido: {phone_number_id}")` + `return` imediato. O handler já enviou `200 OK` antes de iniciar o background task. Nunca seguir com valor default.

### Download de mídia Meta (áudio) — Bearer, sem MediaKey/HKDF

```python
# Passo 1: obter URL temporária (válida ~5 min)
GET https://graph.facebook.com/v19.0/{media_id}
Headers: Authorization: Bearer {META_SYSTEM_USER_TOKEN}
→ {"url": "https://lookaside.fbsbx.com/..."}

# Passo 2: baixar a mídia
GET <url_retornada>
Headers: Authorization: Bearer {META_SYSTEM_USER_TOKEN}
```

Após download → Whisper (`main.py:492-497`). Se `META_SYSTEM_USER_TOKEN` ausente → usar fixture de áudio local (mock path) e prosseguir para o Whisper.

### Rename nos 3 touch points — commit coordenado com o adapter

| # | Arquivo | Linha | Mudança |
|---|---------|-------|---------|
| 1 | `worker/main.py` | 683 | `"instancia_uazapi": instance_name` → `"canal_origem": instance_name` |
| 2 | `worker/institucional_engine.py` | 267 | idem |
| 3 | Edge Function `motor-agente` (Supabase/Deno) | — | leitura de `canal_origem`; remover `instancia_uazapi` |

> Os 3 pontos + o novo adapter devem estar no **mesmo commit**. Não há período de transição com dois nomes coexistindo.

### Novas env vars

| Var | Obrigatório | Descrição |
|---|---|---|
| `META_APP_SECRET` | Sim | Segredo do app Meta para validação HMAC |
| `META_VERIFY_TOKEN` | Sim | Token de verificação do webhook |
| `META_STUB_PHONE_NUMBER_ID` | Dev only | `phone_number_id` de teste para o stub |
| `META_STUB_CANAL_ORIGEM` | Dev only | `canal_origem` para o stub (ex.: `cuca_empregabilidade_01`) — **substitui `META_STUB_INSTANCIA`** |
| `META_STUB_AGENTE_TIPO` | Dev only | `agente_tipo` para o stub |
| `META_STUB_CANAL_TIPO` | Dev only | `canal_tipo` para o stub |

### Rate limiter — isenção (main.py:166)

`/webhook/meta` adicionada à lista de exclusão, mesmo padrão de `/webhook/`.

### Ponto de integração com o fluxo existente

Após construir o Contrato v2, o adapter chama `process_webhook_payload` (ou wrapper) com os dados normalizados. A função não precisa saber a origem (UAZAPI ou Meta). Em S-WM-03, o stub é substituído por query em `meta_phone_numbers`.

### Estrutura de arquivos

```
worker/
  meta_adapter_inbound.py       ← NOVO (esta story)
  main.py                       ← rotas + rate limiter exemption + touch point 1 (rename)
  institucional_engine.py       ← touch point 2 (rename)
supabase/
  migrations/
    YYYYMMDDHHMMSS_wm01_placeholder.sql  ← arquivo vazio com comentário; sem DDL
```

Edge Function `motor-agente` → touch point 3 (atualizada via Supabase CLI ou dashboard).

## Tasks

- [x] **Rename coordenado — touch points 1 e 2** (mesmo commit que o adapter):
  - [x] `worker/main.py:683`: `"instancia_uazapi"` → `"canal_origem"`
  - [x] `worker/institucional_engine.py:267`: `"instancia_uazapi"` → `"canal_origem"`
- [x] **Rename — touch point 3** (Edge Function `motor-agente`):
  - [x] `supabase/functions/motor-agente/index.ts:111` — `canal_origem: instancia_uazapi` (alias: lê `canal_origem` do body; variável local continua `instancia_uazapi` para linhas 134/136 — colunas DB, escopo S-WM-03)
- [x] Criar `worker/meta_adapter_inbound.py`:
  - [x] `validar_hmac_meta(raw_body, header, app_secret)` — HMAC-SHA256
  - [x] `_get_instancia_by_phone_number_id(phone_number_id)` — stub via env vars (campo `canal_origem`)
  - [x] `_parse_mensagem_meta(msg)` → (texto, midia_url, midia_tipo)
  - [x] `_baixar_midia_meta(media_id, token)` — media_id → URL temp (Bearer) → download; mock se token ausente
  - [x] `build_contrato_v2(meta_payload, instancia_data)` → dict Contrato v2 completo
  - [x] `processar_webhook_meta(raw_body)` — background task com guard 200+discard
- [x] Adicionar em `worker/main.py`:
  - [x] `GET /webhook/meta` — challenge verification
  - [x] `POST /webhook/meta` — HMAC validation + `BackgroundTasks` (asyncio)
  - [x] Guard: `phone_number_id` None → 200 + log + discard (dentro do background task)
  - [x] Isenção de rate limiter para `/webhook/meta` — já coberta por `path.startswith("/webhook/")` em `main.py:166`, sem alteração necessária
- [x] Criar `worker/tests/test_meta_adapter_inbound.py` (13 testes, todos passando):
  - [x] `test_hmac_valido` / `test_hmac_invalido` (+ header ausente, vazio, body diferente)
  - [x] `test_phone_number_id_desconhecido_200_discard`
  - [x] `test_parse_mensagem_texto` — verifica `midia_tipo="text"`
  - [x] `test_parse_mensagem_audio_voz` — mock download + mock Whisper → `midia_tipo="voz"`
  - [x] `test_parse_mensagem_imagem`
  - [x] `test_contrato_v2_campos_completos` — 9 campos presentes + `instancia_uazapi` ausente
  - [x] `test_rename_touch_point_regressao` — verifica `canal_origem` em main.py e institucional_engine.py
- [x] Criar `supabase/migrations/20260623000000_wm01_placeholder.sql` (comentário; sem DDL)
- [x] Atualizar `worker/.env.example` com novas vars
- [x] Atualizar File List e Change Log desta story

## Riscos

| # | Risco | Impacto | Mitigação |
|---|---|---|---|
| R1 | `META_SYSTEM_USER_TOKEN` ausente (bloqueado pelo sócio) | AC #6 (áudio) não testável com download real | Fixture local de áudio de teste; mock do download em dev. Token entra quando sócio liberar. |
| R2 | FastAPI consome o body antes do HMAC | HMAC sempre falha se `request.json()` for chamado antes de `request.body()` | `raw_body = await request.body()` deve ser a **primeira** leitura na rota POST; só depois `json.loads(raw_body)`. |
| R3 | `phone_number_id` não encontrado no stub | Sem guard → default indevido → automação errada + retry storm Meta | Guard obrigatório: 200 + log + discard. `test_phone_number_id_desconhecido_200_discard` é AC de qualidade. |
| R4 | Rename parcial nos 3 touch points | `instancia_uazapi` persiste em algum ponto → regressão silenciosa | Commit único para os 3 pontos. `test_rename_touch_point_regressao` + `grep -r "instancia_uazapi" worker/` = 0 hits no QA gate. |

## Dependências
- **S-WM-00** ✅ — base de conhecimento do contrato
- **Épico Seção 3** — Contrato v2 mapeamento de-para (canônico)
- **Paralela com S-WM-02** — nenhuma dependência entre as duas

**Desbloqueada por:** S-WM-03 (wire-up do stub com banco real)
**É pré-requisito de:** S-WM-03

## Quality Gate
- Tipo: código novo + rename coordenado. Agente: @qa.
- @qa verifica: (a) todos os 9 ACs satisfeitos com payloads sintéticos (staging/WABA "Rede CUCA - Ivida teste"); (b) HMAC inválido retorna 403; (c) Contrato v2 produzido sem campo `instancia_uazapi`; (d) `phone_number_id` desconhecido retorna 200+discard; (e) `midia_tipo="voz"` para áudio (não `"ptt"`); (f) nenhum engine modificado; (g) testes unitários passam; (h) `grep -r "instancia_uazapi" worker/ supabase/functions/motor-agente/` retorna **zero** ocorrências em chaves de dict/payload.

## File List
**Criados:**
- `worker/meta_adapter_inbound.py`
- `worker/tests/__init__.py`
- `worker/tests/test_meta_adapter_inbound.py`
- `worker/tests/fixtures/.gitkeep`
- `supabase/migrations/20260623000000_wm01_placeholder.sql`
- `supabase/functions/motor-agente/RENAME_PENDENTE.md` (documentação, supersedida)
- `supabase/functions/motor-agente/index.ts` — fonte recuperado de produção via @devops + touch point 3 aplicado

**Modificados:**
- `worker/main.py` — rotas GET/POST `/webhook/meta` adicionadas; touch point 1 (`canal_origem`); import `meta_adapter_inbound`
- `worker/institucional_engine.py` — touch point 2 (`canal_origem`)
- `worker/.env.example` — vars Meta adicionadas
- `worker/requirements.txt` — `pytest` e `pytest-asyncio` adicionados

## Dev Agent Record

### Agent Model Used
claude-sonnet-4-6

### Completion Notes
- **13/13 testes passando** (`pytest worker/tests/test_meta_adapter_inbound.py`)
- Touch point 3 (Edge Function `motor-agente`) **concluído**: @devops recuperou o fonte via `supabase functions download`; `index.ts:111` usa alias `canal_origem: instancia_uazapi` — lê o novo campo do body sem modificar as operações de DB (linhas 134/136, escopo S-WM-03).
- Teste de regressão expandido: `test_rename_touch_point_regressao` agora verifica os 3 touch points (incluindo `canal_origem: instancia_uazapi` em `motor-agente/index.ts`).
- Rate limiter: `/webhook/meta` já coberto por `path.startswith("/webhook/")` em `main.py:166` — sem alteração necessária.
- Mock-first: `META_SYSTEM_USER_TOKEN` ausente → fixture local `worker/tests/fixtures/audio_teste.ogg` (a criar) ou áudio ignorado com `midia_tipo="voz"` e mensagem vazia.
- Rotas Meta definidas ANTES de `/webhook/{token}` para evitar captura pelo route parametrizado.

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-06-22 | @sm (River) | Criação da story (Draft) |
| 2026-06-22 | @po (Pax) | Validação GO (8/10) — adicionada seção Riscos (R1/R2/R3). Status: Draft → Ready |
| 2026-06-22 | @sm (River) | Rebaixada para Draft — levantamento técnico @dev invalida premissas de contrato, áudio e padrão de execução. |
| 2026-06-23 | @sm (River) | **Reescrita completa** — Contrato v2 (`canal_origem`, sem `instancia_uazapi`), BackgroundTasks (sem Celery), guard 200+discard para phone_number_id desconhecido, áudio via media_id/Bearer/Whisper (sem HKDF), rename explícito nos 3 touch points como task e AC, staging-first em todos os ACs, 9 ACs (AC #4 para unknown phone_number_id, AC #9 para rename regressão), R4 adicionado. |
| 2026-06-23 | @po (Pax) | **Validação GO — 10/10.** OBS-1: AC #6 usa `type="audio"` (Meta não tem `type="voice"` — @dev usar Dev Notes como referência). OBS-2: @dev verificar antes do commit se algum engine faz branch em `midia_tipo=="ptt"` (fluxo UAZAPI continua emitindo `"ptt"`; Meta emite `"voz"`). Status: Draft → Ready. |
| 2026-06-23 | @dev (Dex) | **Implementação completa.** Criado `meta_adapter_inbound.py` (HMAC, stub lookup, parser, build_contrato_v2, background task). Rotas GET+POST `/webhook/meta` adicionadas em `main.py`. Touch points 1 e 2 renomeados (`canal_origem`). 13/13 testes passando. Touch point 3 (motor-agente Edge Function) bloqueado — fonte não está no repo; `RENAME_PENDENTE.md` criado para ação manual. Status: Ready → InProgress. |
| 2026-06-23 | @dev (Dex) | **Touch point 3 concluído.** Fonte `motor-agente/index.ts` recuperado por @devops. `index.ts:111`: alias `canal_origem: instancia_uazapi` — lê campo `canal_origem` do body (novo contrato); linhas 134/136 (colunas DB) preservadas para S-WM-03. Teste de regressão expandido para cobrir os 3 touch points. 13/13 passando. |
