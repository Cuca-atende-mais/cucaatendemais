# EPIC — Migração WhatsApp UAZAPI → Meta Cloud API

> **Status:** Em definição
> **Autor:** @sm (River)
> **Autoridade épica:** @pm (Morgan) — este documento é proposta de @sm; @pm/@po devem ratificar antes das stories posteriores.

---

## CORREÇÕES DE PREMISSA (aplicadas em 2026-06-22 — NON-NEGOTIABLE)

Levantamento técnico @dev (BLOCOS 1-6) invalidou premissas do backlog original. As correções abaixo valem para TODO o épico:

| # | Premissa anterior (incorreta) | Fato real (confirmado em código) | Impacto |
|---|---|---|---|
| P1 | Worker usa Celery/Redis/fila externa | FastAPI + uvicorn processo único, BackgroundTasks + asyncio (`main.py:1232`) | Remover toda menção a Celery de todas as stories; o adapter Meta usa o mesmo padrão BackgroundTasks existente. Celery = épico futuro separado. |
| P2 | Adapter Meta replica payload_edge com vocabulário UAZAPI | Engines Python não leem payload_edge por nome (Bloco 4.2) — custo do rename é BAIXO e limitado a 3 pontos | Renomear campo `instancia_uazapi` → `canal_origem` e valor `"ptt"` → `"voz"`. Ver Contrato v2 abaixo. |
| P3 | Engines recebem payload_edge dict | Engines recebem parâmetros Python diretos, NÃO o dict | IA intocada é requisito inegociável. Nenhuma story altera lógica de engine. |
| P4 | Lookup por nome de instância via token UAZAPI | Meta identifica canal por `phone_number_id` (sem token na URL) | Tabela de mapeamento `meta_phone_numbers` (phone_number_id → agente/canal/unidade) é responsabilidade de S-WM-03. |
| P5 | Áudio Meta usa MediaKey/HKDF (igual UAZAPI) | Meta usa `media_id` → GET `graph/{media_id}` → URL temporária → download Bearer | Sem `.enc` / HKDF no fluxo Meta. Whisper pode ser reutilizado (`main.py:492-497`). |
| P6 | `canal_ativo` existe em `instancias_uazapi` | Coluna NÃO existe (confirmado via schema do banco) | Migration de S-WM-03 cria a coluna. `agente_tipo` é NOT NULL (sem default). |
| P7 | Transbordo (handover) é 100% desacoplado do UAZAPI | Notificação de handover vai para WhatsApp pessoal do atendente (não em WABA) | Automações Meta mantêm "ponte UAZAPI" para transbordo durante toda a Fase 2; sai só no sunset (S-WM-08). |

---

## 1. Visão Geral

Migrar o canal de WhatsApp das automações do Cuca Atende Mais do UAZAPI (solução não-oficial via WhatsApp Web simulado) para a **Meta Cloud API** (canal oficial, BSP/WABA), tornando os envios conformes com as políticas da plataforma, eliminando riscos de banimento e habilitando recursos como templates aprovados e múltiplas WABAs.

### Princípio fundamental

Migração **incremental e paralela**: as duas camadas (UAZAPI e Meta) coexistem via adapter + feature flag por instância. O UAZAPI é removido apenas quando a Meta estiver 100% validada em produção. Rollback = reverter a flag.

### IA intocada (requisito inegociável)

Os engines (`institucional_engine.py`, `empregabilidade_engine.py`, motor-agente Edge Function) recebem **parâmetros Python diretos** — não o dict do contrato. Nenhuma story deste épico modifica lógica de engine de IA.

---

## 2. Arquitetura Alvo

| Dimensão | Estado Atual | Estado Alvo |
|---|---|---|
| Canal de envio | UAZAPI (unofficial) | Meta Cloud API (oficial) |
| Autenticação | `token` por instância na URL | `phone_number_id` + HMAC-SHA256 em URL única |
| Roteamento entrada | `/webhook/{token}` (1 URL por instância) | `/webhook/meta` (URL única, HMAC autentica) |
| WABAs | 1 implícito | 3: WABA #1 Programação+RAG · WABA #2 Empregabilidade · WABA #3 Serviço Cuca |
| Feature flag | Inexistente | Por instância via coluna `canal_ativo` em `instancias_uazapi` (`'uazapi'`\|`'meta'`) — **coluna NÃO existe ainda** |
| Roteamento multi-WABA | N/A | Tabela `meta_phone_numbers` (`phone_number_id` → `{agente_tipo, canal_tipo, unidade_cuca, waba_id}`) |
| Engines (IA) | Sem alteração | Sem alteração — requisito inegociável |
| Runtime | FastAPI + BackgroundTasks + asyncio | Mesmo padrão — sem Celery |
| Anti-ban delay | Ativo no fluxo UAZAPI (`main.py:627-660`) | **Não se aplica** nas automações Meta (rate limits gerenciados pela Meta) |
| Transbordo para atendente | Via instância UAZAPI receptora | Ponte temporária UAZAPI durante Fase 2; sunset em S-WM-08 |

---

## 3. Contrato v2 — Mapeamento de Campos (Decisão B)

O adapter Meta produz o **Contrato v2** (nomes neutros). O mesmo contrato substitui o payload_edge UAZAPI nos 3 touch points identificados pelo @dev.

### De-para campo a campo

| Campo v1 (payload_edge atual) | Campo v2 (contrato renomeado) | Tipo de mudança | Fonte no payload Meta |
|---|---|---|---|
| `instancia_uazapi` | `canal_origem` | **RENAME** | `metadata.phone_number_id` via lookup em `meta_phone_numbers` |
| `telefone` | `telefone` | sem mudança | `messages[0].from` (já são só dígitos) |
| `agente_tipo` | `agente_tipo` | sem mudança | lookup → `agente_tipo` |
| `unidade_cuca` | `unidade_cuca` | sem mudança | lookup → `unidade_cuca` |
| `canal_tipo` | `canal_tipo` | sem mudança | lookup → `canal_tipo` |
| `mensagem` | `mensagem` | sem mudança | `text.body` ou transcrição Whisper |
| `midia_url` | `midia_url` | sem mudança | URL pública Meta ou `None` |
| `midia_tipo` | `midia_tipo` | valor `"ptt"` → `"voz"` | tipo da mensagem Meta |
| `data_atual` | `data_atual` | sem mudança | `datetime.now(UTC-3)` formatado |
| `numero_empregabilidade` | `numero_empregabilidade` | sem mudança | lookup dinâmico (institucional_engine) |
| `instrucoes_adicionais` | `instrucoes_adicionais` | sem mudança | string montada (institucional_engine) |

### Touch points do rename (todos em S-WM-01)

| Ponto | Arquivo | Linha | Mudança |
|---|---|---|---|
| 1 | `worker/main.py` | 683 | `"instancia_uazapi": instance_name` → `"canal_origem": instance_name` |
| 2 | `worker/institucional_engine.py` | 267 | idem |
| 3 | Edge Function `motor-agente` | Supabase/Deno | consume `canal_origem` (remover leitura de `instancia_uazapi`) |

> **Timing**: o rename nos 3 pontos acontece em S-WM-01 em um único commit coordenado. O adapter Meta produz `canal_origem`; o fluxo UAZAPI também é atualizado no mesmo commit. Não há período de transição com nome antigo.

---

## 4. Automações no Escopo

| # | Automação | Engine atual | WABA Alvo | `agente_tipo` / `canal_tipo` |
|---|-----------|-------------|-----------|------------------------------|
| 1+2 | Programação + RAG Programação | `institucional_engine.py` | WABA #1 | `canal_tipo="Institucional"` |
| 3 | Empregabilidade (Julia) | `empregabilidade_engine.py` | WABA #2 | `agente_tipo="Empregabilidade"` |
| 4 | Ouvidoria (Sofia) | motor-agente Edge Function | WABA #3 | `agente_tipo∈{sofia,ouvidoria}` |
| 5 | Acesso Cuca (Ana) | motor-agente Edge Function | WABA #3 | `agente_tipo∈{ana,acesso}` |

**Fora do escopo (confirmado pelo @dev — Bloco 4.1):**
- Campanhas (`campanhas_engine.py`) — permanecem em UAZAPI
- Divulgação (`agente_tipo="maria_divulgacao"`) — permanece em UAZAPI
- Academia Enem (`academia_enem_engine.py`) — **isolado do fluxo UAZAPI**, independente; fora do épico

---

## 5. Backlog de Stories

### Fase 0 — Investigação (concluída)

| Story | Título | Status | Deps |
|-------|--------|--------|------|
| S-WM-00 | Investigação: Contrato de Comunicação UAZAPI | ✅ Done | — |

### Fase 1 — Infraestrutura do Adapter + Templates (caminho crítico paralelo)

| Story | Título | Status | Deps | Bloqueio externo | Impacto das correções P1-P7 |
|-------|--------|--------|------|-----------------|------------------------------|
| **S-WM-01** | Adapter inbound Meta — `/webhook/meta`, HMAC-SHA256, normalização para **Contrato v2** + rename nos 3 touch points | **⚠️ Draft** _(rebaixado de Ready — reescrita necessária)_ | S-WM-00 ✅ | — | Produz contrato v2 (não payload_edge antigo). BackgroundTasks (não Celery). Guard 200+discard para phone_number_id desconhecido. Áudio via media_id/Bearer (não MediaKey/HKDF). |
| S-WM-02 | Adapter outbound Meta — cliente Graph API (texto, imagem, marca-lida) | Backlog | S-WM-00 ✅ | — | Bearer token único (sem inconsistência token/apikey). Anti-ban delay NÃO se aplica para automações Meta. |
| S-WM-03 | Schema + feature flag `canal_ativo` + tabela `meta_phone_numbers` | Backlog | S-WM-01 + S-WM-02 | — | Criar coluna `canal_ativo` (NOT EXISTS confirmado). Tabela de mapeamento `phone_number_id` → instância. Wire-up stub → DB real de S-WM-01. |
| **S-WM-T** | **Templates do épico — levantamento, categorização e preparação para aprovação Meta** | **Backlog** | **S-WM-00 ✅** | **⚠️ Sócio: criar WABAs + parear números no WhatsApp Manager** | Caminho crítico por lead time de aprovação Meta (dias a semanas). Início imediato recomendado. |

> S-WM-01 e S-WM-02 podem ser desenvolvidas em paralelo após validação do @po.
> S-WM-T deve ser iniciada imediatamente (paralela a S-WM-01/02) — lead time é o maior risco do épico.

### Fase 2 — Migração por automação

| Story | Título | Status | Deps | Observação |
|-------|--------|--------|------|------------|
| S-WM-04 | Migrar Empregabilidade (Julia) → WABA #2 | Backlog | S-WM-03 | Transbordo via **ponte UAZAPI** (temporária, explícita). A Empregabilidade **NÃO fica 100% livre de UAZAPI** nesta fase — documentar. |
| S-WM-05 | Migrar Programação + RAG → WABA #1 | Backlog | S-WM-03 + S-WM-T (template aprovado) | Requer template aprovado pela Meta. Único AC que depende de S-WM-T. |
| S-WM-06 | Migrar Ouvidoria (Sofia) → WABA #3 | Backlog | S-WM-03 | Transbordo via ponte UAZAPI. |
| S-WM-07 | Migrar Acesso Cuca (Ana) → WABA #3 | Backlog | S-WM-06 | Execução serial por contenção de risco. Transbordo via ponte UAZAPI. |

> **Rationale da ordem:** Empregabilidade primeiro — exercita todos os padrões críticos (passivo, ativo com links, transbordo) em WABA isolada (WABA #2), contendo risco. Programação requer dados reais em massa e template aprovado.

### Fase 3 — Sunset

| Story | Título | Status | Deps | Observação |
|-------|--------|--------|------|------------|
| S-WM-08 | Sunset UAZAPI para 5 automações migradas + remoção da ponte de transbordo | Backlog | S-WM-04+05+06+07 (todas validadas em staging) | Remove ponte UAZAPI de S-WM-04/06/07. Academia Enem **não está no escopo** (já isolada). Campanhas e Divulgação permanecem em UAZAPI (épico futuro). |

### Diagrama de dependências (atualizado)

```
S-WM-00 ✅
   ├── S-WM-01 (Draft⚠️) ──────┐
   ├── S-WM-02 (Backlog) ───────┴── S-WM-03 ── S-WM-04 ──┐
   │                                             S-WM-06 ──┤── S-WM-07 ──┐
   └── S-WM-T (⚠️bloqueio ext) ──────────────── S-WM-05 ──┘              │
                                                                            S-WM-08
```

---

## 6. Decisões de Arquitetura Registradas

| ID | Decisão | Alternativas consideradas | Rationale |
|---|---|---|---|
| D1 | **Sem Celery** — BackgroundTasks + asyncio (padrão existente) | Celery + Redis | Infraestrutura não existe. Celery = épico futuro por durabilidade/escala. Sem justificativa de complexidade neste épico. |
| D2 | **Contrato v2** — rename `instancia_uazapi` → `canal_origem` | Manter nome UAZAPI; nome completamente novo | Custo baixo (3 touch points). Engines intocados. Vocabulário neutro para suportar futuros canais. |
| D3 | **Transbordo via ponte UAZAPI** durante Fase 2 | Template de transbordo Meta pré-aprovado | Atendentes usam WhatsApp pessoal (não WABA). Template proativo exigiria aprovação adicional e delay. Ponte sai no sunset. |
| D4 | **Anti-ban delay NÃO portado** para Meta | Manter delay por precaução | Meta Cloud API tem rate limits próprios. Delay artificial é anti-padrão para canal oficial. |
| D5 | **Academia Enem fora do escopo** | Incluir no épico | `academia_enem_engine.py` já é isolado do fluxo UAZAPI (Bloco 4.1 confirmado). |
| D6 | **Rename nos 3 pontos em S-WM-01** (único commit coordenado) | Rename em S-WM-03; compat layer temporária | Sem período de transição com dois nomes. Motor-agente atualizado simultaneamente. |

---

## 7. Diretrizes e Requisitos Transversais

### DIRETRIZ DE SEQUÊNCIA (2026-06-23) — NON-NEGOTIABLE

Todo desenvolvimento e homologação ocorre no **staging** (WABA de teste, app **"Rede CUCA - Ivida teste"**) antes de qualquer promoção para produção. A **Fase 2 inteira (S-WM-04 a S-WM-07)** é executada no staging primeiro. Produção (app **"CucaAtende+ Produção"**, 3 WABAs a criar pelo sócio) recebe apenas código validado no staging.

| Fase | Ambiente | Condição de promoção |
|------|----------|----------------------|
| Fase 1 (S-WM-01/02/03/T) | Staging (WABA teste) | @qa PASS no staging |
| Fase 2 (S-WM-04/05/06/07) | Staging primeiro, depois produção | @qa PASS no staging + aprovação humana (Junior) |
| Fase 3 (S-WM-08) | Staging → produção | Todas as 4 automações validadas em produção |

### REQUISITO TRANSVERSAL (S-WM-03) — MUST

O mapeamento `phone_number_id → automação` deve ser **editável via banco de dados sem necessidade de deploy** (`UPDATE` em tabela, não variável de ambiente hardcoded). Isso permite substituição do Phone Number ID temporário (staging) pelo oficial (produção) sem redeploy.

> **Impacto em S-WM-03:** a tabela `meta_phone_numbers` deve ser a fonte de verdade, não `.env`. O stub de S-WM-01 usa env vars apenas como provisório; S-WM-03 elimina o stub e passa a consultar o banco.

---

## Change Log

| Data | Autor | Mudança |
|------|-------|---------|
| 2026-06-22 | @sm (River) | Criação do épico (Draft) |
| 2026-06-22 | @sm (River) | Backlog completo: 8 stories (S-WM-01..08) detalhadas com deps, arquitetura alvo atualizada, WABAs definidos |
| 2026-06-22 | @sm (River) | Ajuste aprovado: reordem Fase 2 (Empregabilidade primeiro), S-WM-T adicionada (caminho crítico templates), AC S-WM-05 requer template real |
| 2026-06-22 | @sm (River) | **Reconstrução pós-levantamento técnico @dev (BLOCOS 1-6):** correções de premissa P1-P7, Contrato v2 definido (mapeamento de-para completo), decisões D1-D6 registradas, S-WM-01 rebaixada para Draft, academia_enem confirmada fora do escopo, ponte UAZAPI de transbordo documentada, Celery removido do escopo |
