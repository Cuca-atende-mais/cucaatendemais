# Contrato de Comunicação UAZAPI — Estado Atual

> **Gerado por:** S-WM-00 (Investigação) — @dev (Dex)
> **Data:** 2026-06-22
> **Finalidade:** Referência canônica para implementação do adapter Meta Cloud API (S-WM-01/S-WM-02).
> O adapter Meta deverá reproduzir o contrato da Seção 2 para que handlers e engines existentes funcionem sem alteração.

---

## 1. Recepção de webhook (entrada)

### 1.1 Rota

```
POST /webhook/{token}
```

- **Arquivo:** `worker/main.py:1221`
- **`{token}`:** token único da instância UAZAPI. É gerado no Passo A da criação (`POST /instance/init`) e armazenado na coluna `token` de `instancias_uazapi`. O próprio token identifica qual instância enviou o evento — não há header de autenticação adicional no webhook.
- **Isenção de rate limit:** a rota `/webhook/` é explicitamente excluída do rate limiter (main.py:166).

### 1.2 Resposta imediata — anti-ban

O worker retorna **200 OK antes de processar** (main.py:1234). Isso é requisito crítico do UAZAPI para evitar reenvios agressivos e bloqueio de conta:

```python
return Response(status_code=200, content=json.dumps({"status": "received"}))
```

O processamento pesado ocorre em `background_tasks.add_task(process_webhook_payload, payload, token)`.

### 1.3 Formato do payload de entrada

O UAZAPI envia JSON no body. O formato varia entre v1 e v2 (ambas tratadas via fallback):

#### Envelope comum

```json
{
  "event": "messages.upsert",
  "EventType": "messages",
  "instance": "nome_da_instancia",
  "instanceName": "nome_da_instancia",
  "data": { ... }
}
```

- `event` ou `EventType` → tipo do evento. Valores possíveis: `messages.upsert`, `messages`, `connection`, `connection.update`, `messages.update`, `ack`
- `instance` pode ser string ou objeto `{"name": "..."}` — o worker normaliza ambos (main.py:253-257)

#### Payload de mensagem (`event = "messages.upsert"` ou `"messages"`)

```json
{
  "event": "messages.upsert",
  "instance": "cuca_institucional_01",
  "data": {
    "key": {
      "remoteJid": "558599999999@s.whatsapp.net",
      "fromMe": false,
      "id": "3EB0B5FABDBBF09DA87A"
    },
    "pushName": "João Silva",
    "message": {
      "conversation": "Olá, quero saber sobre cursos"
    },
    "messageType": "conversation",
    "mediaType": ""
  }
}
```

**Extração de campos — lógica de fallback (main.py:313-354):**

| Campo interno | Fonte primária (v2) | Fonte fallback (v1) |
|---|---|---|
| `remote_jid` | `data.key.remoteJid` | `payload.chat.wa_chatid` |
| `phone` | `remote_jid.split("@")[0]` | `payload.chat.phone` (normalizado) |
| `from_me` | `data.key.fromMe` | `payload.message.fromMe` |
| `push_name` | `data.pushName` | `payload.chat.wa_name` / `payload.chat.name` |
| `text_content` | `data.message.conversation` | `data.message.extendedTextMessage.text` / `data.message.text` / `data.message.content` (se string) |
| `msg_type` | `data.message.messageType` | `data.message.type` |
| `media_type` | `data.message.mediaType` | — |

#### Payload de conexão (`event = "connection"` ou `"connection.update"`)

```json
{
  "event": "connection.update",
  "instance": "cuca_institucional_01",
  "data": {
    "instance": {
      "status": "open",
      "lastDisconnectReason": ""
    },
    "status": {
      "connected": true,
      "loggedIn": true,
      "jid": { "user": "558599999999" }
    },
    "wuid": "558599999999@s.whatsapp.net"
  }
}
```

Tratado em `uazapi_manager.handle_connection_update()` via `main.py:292-296`.

---

## 2. Contrato interno normalizado (payload → motor-agente)

Este é o **contrato-alvo**: o adapter Meta Cloud API deverá construir exatamente este dict antes de despachar para o motor de IA.

### 2.1 Exemplo de payload preenchido

```python
# main.py:681-691 — payload_edge construído antes de chamar a Edge Function motor-agente
payload_edge = {
    "telefone":        "558599999999",
    "instancia_uazapi": "cuca_institucional_01",
    "agente_tipo":     "Institucional",
    "unidade_cuca":    "Cuca Barra",
    "canal_tipo":      "Institucional",
    "mensagem":        "Olá, quero saber sobre cursos de música",
    "midia_url":       None,
    "midia_tipo":      "text",
    "data_atual":      "Segunda-feira, 22 de junho de 2026, 10:30",
}
```

### 2.2 Campos e semântica

| Campo | Tipo | Origem | Semântica |
|---|---|---|---|
| `telefone` | `str` | `remote_jid.split("@")[0]` | Somente dígitos: DDI + DDD + número (ex: `"558599999999"`). Sem `+`, sem `@`, sem espaços. |
| `instancia_uazapi` | `str` | `instance_name` do envelope | Nome da instância que recebeu a mensagem (chave FK para `instancias_uazapi.nome`). Para o adapter Meta, este campo mapeia para o `phone_number_id` + WABA. |
| `agente_tipo` | `str` | `instancias_uazapi.agente_tipo` (com normalização) | Persona do agente de IA. Valores conhecidos: `"maria"`, `"maria_divulgacao"`, `"Empregabilidade"`, `"Institucional"`, `"sofia"`, `"ouvidoria"`, `"ana"`, `"acesso"`. Hardcoded `"Institucional"` no `institucional_engine.py`. |
| `unidade_cuca` | `str \| None` | `instancias_uazapi.unidade_cuca` | Unidade física da Rede CUCA vinculada à instância (ex: `"Cuca Barra"`). `None` para canais globais (Divulgação, Ouvidoria). |
| `canal_tipo` | `str` | `instancias_uazapi.canal_tipo` | Tipo de canal da instância. Valores: `"Institucional"`, `"Divulgação"`, `"Empregabilidade"`, `""` (não definido). |
| `mensagem` | `str` | texto extraído/transcrito | Conteúdo da mensagem. Áudios são transcritos via Whisper antes de chegar aqui (main.py:492-498). |
| `midia_url` | `str \| None` | extraído da mensagem | URL de mídia quando presente. Atualmente sempre `None` no fluxo de texto/áudio — flyers são enviados na resposta, não na entrada. |
| `midia_tipo` | `str` | detectado no payload | `"text"` (padrão), `"ptt"` (push-to-talk), `"audio"`. Áudio transcrito vira `"text"` (main.py:498). |
| `data_atual` | `str` | `datetime.now(UTC-3)` | Data/hora atual em Fortaleza, formatada. Ex: `"Segunda-feira, 22 de junho de 2026, 10:30"`. |

#### Campos extras do `institucional_engine.py`

O motor Institucional adiciona dois campos extras que NÃO estão no fluxo genérico (institucional_engine.py:265-277):

```python
{
    ...campos acima...,
    "numero_empregabilidade": "558599999998",  # str|None: tel da instância Empregabilidade
    "instrucoes_adicionais":  "REGRA INQUEBRÁVEL: Se o usuário demonstrar...",  # str
}
```

O adapter Meta deverá replicar esses campos adicionais para o motor Institucional.

### 2.3 Destino do payload

```
POST {SUPABASE_URL}/functions/v1/motor-agente
Headers:
  Authorization: Bearer {SUPABASE_KEY}
  Content-Type: application/json
  x-internal-token: {WEBHOOK_INTERNAL_TOKEN}
Timeout: 45s
```

Resposta esperada: `{"success": true, "resposta": "...", "handover": false}`

---

## 3. Flag de canal: como CANAL_WHATSAPP funciona hoje

### Conclusão direta

**`CANAL_WHATSAPP` não existe.** Não há env var, variável global, ou feature flag com esse nome em nenhum arquivo Python do worker (confirmado por busca ampla — zero ocorrências em `worker/main.py`, `worker/uazapi_manager.py`, `worker/*.py`, nem em `.env*`).

### Como o canal é controlado

O controle é **por instância**, via duas colunas na tabela `instancias_uazapi`:

| Coluna | Tipo | Papel |
|---|---|---|
| `canal_tipo` | `str` | Determina qual engine/motor trata a mensagem |
| `agente_tipo` | `str` | Determina qual persona de IA responde |

**Onde é lido no código:**

```python
# main.py:464-469 — após identificar a instância pelo token do webhook
inst_result = supabase.table("instancias_uazapi") \
    .select("unidade_cuca, agente_tipo, token, canal_tipo") \
    .eq("nome", instance_name).single().execute()

agente_tipo = inst_result.data.get("agente_tipo", "maria")
canal_tipo  = inst_result.data.get("canal_tipo", "")
```

**Normalização de `agente_tipo`:**

```python
# main.py:507-508
if canal_tipo == "Divulgação":
    agente_tipo = "maria_divulgacao"
    unidade_cuca = None
```

### Implicação para a migração

Não existe uma flag global que alterna o canal. A migração UAZAPI → Meta precisará:
1. Adicionar coluna (ou usar `canal_tipo`) para identificar quais instâncias usam Meta vs UAZAPI
2. Ou usar uma env var por instância mapeada por `phone_number_id`
3. O design da feature flag é decisão de S-WM-03

---

## 4. Envio de mensagens (saída)

O `UAZAPI_URL` base é sempre lido de: `os.getenv("UAZAPI_BASE_URL", "https://uazapi.com.br")`

### 4.1 Resposta de IA — texto

**Arquivo:** `main.py:844-852`

```python
await client.post(
    f"{UAZAPI_URL}/send/text",
    headers={"token": inst_token, "Content-Type": "application/json"},
    json={
        "number": phone,     # str: somente dígitos com DDI
        "delay": 1200,       # ms: delay simulado de digitação (anti-ban)
        "text": resposta_ia  # str: resposta da IA
    }
)
```

### 4.2 Resposta de IA — mídia com flyer

**Arquivo:** `main.py:830-842`

```python
await client.post(
    f"{UAZAPI_URL}/message/sendMedia/{instance_name}",
    headers={"apikey": inst_token, "Content-Type": "application/json"},  # ⚠️ header "apikey"
    json={
        "number": phone,
        "options": {"delay": 1500, "presence": "composing"},
        "mediaMessage": {
            "mediatype": "image",
            "caption": resposta_ia,  # texto como legenda da imagem
            "media": media_url       # URL da imagem
        }
    }
)
```

### 4.3 STOP handler — confirmação de opt-out

**Arquivo:** `main.py:547-558`

```python
await client.post(
    f"{UAZAPI_URL}/message/sendText/{instance_name}",
    headers={"apikey": inst_token, "Content-Type": "application/json"},  # ⚠️ header "apikey"
    json={
        "number": phone,
        "delay": 1200,
        "text": "✅ Pronto! Você foi removido da nossa lista..."
    }
)
```

### 4.4 Envio manual via Portal

**Arquivo:** `main.py:976-1018` — rota `POST /send-message/{WEBHOOK_INTERNAL_TOKEN}`

```python
await client.post(
    f"{UAZAPI_URL}/send/text",
    headers={"token": inst_token, "Content-Type": "application/json"},
    json={
        "number": number,
        "delay": 1200,
        "text": text
    }
)
```

O portal chama esta rota passando `instance` no body; o worker busca o `inst_token` no banco.

### 4.5 Notificação interna de transbordo

**Arquivo:** `main.py:808-818` — enviado para o número de contato humano registrado em `human_handover_contacts`

```python
UAZAPI_URL = os.getenv("UAZAPI_BASE_URL", "https://uazapi.com.br")
await hc.post(
    f"{UAZAPI_URL}/send/text",
    headers={"token": inst_token, "Content-Type": "application/json"},
    json={
        "number": tel_destino,  # número do atendente humano
        "text": msg_handover,   # resumo formatado da conversa
        "delay": 1200
    }
)
```

### 4.6 Campanhas (disparos em massa)

**Arquivo:** `campanhas_engine.py:296-331` — texto e flyer

```python
# Texto puro:
await client.post(
    f"{UAZAPI_URL}/send/text",
    headers={"token": inst_token, "Content-Type": "application/json"},
    json={"number": numero, "text": texto, "delay": 1200}
)

# Flyer + texto:
await client.post(
    f"{UAZAPI_URL}/send/media",  # endpoint diferente: /send/media (sem /{instance})
    headers={"token": inst_token, "Content-Type": "application/json"},
    json={"number": numero, "type": "image", "file": midia_url, "delay": 1200}
)
```

### Resumo: inconsistência de headers

| Cenário | Header usado | Endpoint |
|---|---|---|
| Resposta IA (texto) | `{"token": inst_token}` | `/send/text` |
| Manual (portal) | `{"token": inst_token}` | `/send/text` |
| Transbordo | `{"token": inst_token}` | `/send/text` |
| Campanhas (texto) | `{"token": inst_token}` | `/send/text` |
| Campanhas (mídia) | `{"token": inst_token}` | `/send/media` |
| Flyer com legenda | `{"apikey": inst_token}` | `/message/sendMedia/{instance}` |
| STOP handler | `{"apikey": inst_token}` | `/message/sendText/{instance}` |
| Marcar como lida | `{"apikey": inst_token}` | `/chat/read/{instance}` |

**Header canônico (spec uazapiGO v2.0):** `{"token": inst_token}` — definido em `uazapi_manager.py:62-67` como `_instance_headers()`. O `{"apikey": inst_token}` é remanescente de v1 ou de endpoints alternativos/legados. O adapter Meta não precisará lidar com essa inconsistência: usará apenas a Meta Graph API para envio.

---

## 5. Mapeamento de automações

### 5.1 Automações no escopo da migração

| Automação | `agente_tipo` (banco) | `canal_tipo` (banco) | Engine/Motor | Arquivo | Linha de entrada |
|---|---|---|---|---|---|
| **Programação** (genérica/RAG) | qualquer (ex: `"maria"`, `"Institucional"`) | `"Institucional"` | `institucional_engine.py` | `worker/institucional_engine.py` | `main.py:601` |
| **RAG Programação** | _ver nota abaixo_ | `"Institucional"` | Mesmo engine Institucional | `worker/institucional_engine.py` | `main.py:601` |
| **Empregabilidade** (Julia) | `"Empregabilidade"` | qualquer | `empregabilidade_engine.py` | `worker/empregabilidade_engine.py` | `main.py:579-580` |
| **Ouvidoria** (Sofia) | `"sofia"` ou `"ouvidoria"` | qualquer | Edge Function `motor-agente` | `main.py` → Supabase Edge | `main.py:626` |
| **Acesso Cuca** (Ana) | `"ana"` ou `"acesso"` | qualquer | Edge Function `motor-agente` | `main.py` → Supabase Edge | `main.py:626` |

#### Nota sobre Programação vs RAG Programação

No código atual, **não existe distinção hardcoded** entre "Programação" e "RAG Programação" — ambas são servidas pelo `institucional_engine.py` com `canal_tipo = "Institucional"`. O engine apresenta um menu de unidades CUCA e depois chama o motor-agente RAG (main.py:601-619). O módulo de transbordo referenciado é `"programacao"` (institucional_engine.py:316).

A distinção pode existir como valores de `agente_tipo` no banco de dados (ex: `"maria"` para Programação genérica e `"Institucional"` para RAG). **Verificar diretamente na tabela `instancias_uazapi` do Supabase para confirmar os valores reais.**

### 5.2 Lógica de roteamento

```
POST /webhook/{token}
  ↓
process_webhook_payload(payload, token)
  ↓
  ├─ event = "connection*"  → handle_connection_update()  [uazapi_manager.py]
  ├─ event = "messages.update"/"ack" + status "1004"  → log (sem motor IA)
  └─ event = "messages.upsert"/"messages"
       ↓
       normaliza campos (phone, from_me, text_content, midia_tipo)
       ↓
       upsert lead + upsert conversa + insert mensagem
       ↓
       carrega instância (agente_tipo, canal_tipo, token) do banco  [main.py:464-469]
       ↓
       normaliza agente_tipo se canal_tipo == "Divulgação"  [main.py:507]
       ↓
       ├─ STOP handler (opt-out)  [main.py:538-559]  → envia confirmação + return
       ├─ bot_pausado_ate (transbordo ativo)  [main.py:562-577]  → return
       ├─ agente_tipo == "Empregabilidade"  [main.py:579-599]  → empregabilidade_engine.py
       ├─ canal_tipo == "Institucional"  [main.py:601-619]  → institucional_engine.py
       └─ fluxo genérico  [main.py:626-873]
              ├─ anti-ban delay + limite diário
              ├─ POST motor-agente Edge Function
              └─ envia resposta via UAZAPI
                   ├─ se flyer → /message/sendMedia/{instance} (apikey)
                   └─ se texto → /send/text (token)
                         └─ se HANDOVER → notificação transbordo + /send/text (token)
```

### 5.3 Canais FORA do escopo desta migração

Existem no código mas serão migrados separadamente (ou não migrados):

| Canal | `canal_tipo` | `agente_tipo` | Engine | Arquivo | Linha |
|---|---|---|---|---|---|
| **Divulgação** | `"Divulgação"` | `"maria_divulgacao"` (forçado) | motor-agente genérico | `main.py` | 507 |
| **Campanhas** (disparos em massa) | qualquer | N/A (loop próprio) | `campanhas_engine.py` | `worker/campanhas_engine.py` | startup loop (`main.py:219`) |
| **Institucional** | `"Institucional"` | do banco | `institucional_engine.py` | `worker/institucional_engine.py` | `main.py:601` — _este é o "Programação+RAG" da migração_ |

> **Atenção:** "Institucional" na tabela 5.3 é apenas para destacar que ele está no código como `canal_tipo = "Institucional"`, mas na perspectiva de negócio, este canal É o "Programação+RAG" planejado para a primeira WABA Meta.

---

## Apêndice: variáveis de ambiente relevantes

| Env var | Usado em | Padrão |
|---|---|---|
| `UAZAPI_BASE_URL` | main.py, campanhas_engine.py, institucional_engine.py | `"https://uazapi.com.br"` (usado em vários lugares) / `"https://cucaatendemais.uazapi.com"` (uazapi_manager.py, campanhas_engine.py) |
| `UAZAPI_MASTER_TOKEN` | uazapi_manager.py (criação de instâncias) | `""` |
| `WEBHOOK_INTERNAL_TOKEN` | main.py:979, institucional_engine.py:24 | N/A — obrigatório |
| `SUPABASE_URL` | todos | N/A — obrigatório |
| `SUPABASE_SERVICE_ROLE_KEY` | todos | N/A — obrigatório |
| `WORKER_PUBLIC_URL` | uazapi_manager.py (configuração de webhook) | `"https://api.cucaatendemais.com.br"` |
| `OPENAI_API_KEY` | main.py (Whisper), main.py/ouvidoria | N/A |

> **Atenção:** `UAZAPI_BASE_URL` tem valor padrão inconsistente — `uazapi_manager.py:33` usa `"https://cucaatendemais.uazapi.com"` enquanto `main.py:542,808,825,994,1034` usa `"https://uazapi.com.br"`. Em produção, a env var deve estar configurada corretamente.
