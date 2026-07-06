# S-WM-00 — Investigação: Contrato de Comunicação UAZAPI (Estado Atual)

## Status
Done

## Story
**Como** time de migração,
**quero** documentar o fluxo completo de entrada e saída de mensagens via UAZAPI hoje,
**para que** o adapter da Meta Cloud API reproduza o mesmo contrato interno sem quebrar nenhuma automação existente.

## Complexidade
**XS** (leitura + documentação pura, zero alteração de código)

## Contexto
Épico: `EPIC-Migracao-WhatsApp-Meta.md`. Esta é a **story 0 (investigação)** — não produz código de feature, apenas documentação. Toda a arquitetura de adapter e flag das stories subsequentes (S-WM-01+) depende do contrato aqui documentado.

**Por que isso importa:** o adapter Meta precisará ingerir um payload completamente diferente (JSON da Meta Cloud API com `HMAC-SHA256`, `phone_number_id`, `waba_id`, objeto `messages[]`) e normalizá-lo para o mesmo contrato interno que o UAZAPI produz hoje — para que os handlers/engines existentes (Empregabilidade, Institucional, Ouvidoria, motor-agente) não precisem mudar.

## Escopo
### IN
- Documento `docs/migracao-meta/contrato-uazapi.md` com os 5 pontos abaixo.
- Nenhuma alteração em código de produção.

### OUT
- Qualquer implementação de adapter, flag, ou rota Meta.
- Código de teste ou mock.

## Critérios de Aceite (Given/When/Then)

1. **Given** o documento finalizado, **when** um desenvolvedor novo lê a Seção 1, **then** consegue responder: rota exata, método HTTP, formato do payload de entrada do UAZAPI, e o que o worker retorna ao UAZAPI.

2. **Given** o documento finalizado, **when** o desenvolvedor lê a Seção 2, **then** encontra o payload normalizado (dict Python) que é enviado à Edge Function `motor-agente`, com um exemplo real de valores preenchidos e anotações de cada campo.

3. **Given** o documento finalizado, **when** o desenvolvedor lê a Seção 3, **then** sabe se `CANAL_WHATSAPP` existe como env var, como variável global, ou se o controle de canal é feito por instância (`canal_tipo` na tabela `instancias_uazapi`) — incluindo onde no código esse valor é lido.

4. **Given** o documento finalizado, **when** o desenvolvedor lê a Seção 4, **then** conhece o endpoint UAZAPI chamado no envio (URL, método, headers, body), e em qual ponto do código (arquivo + linha) a decisão de canal de envio é tomada.

5. **Given** o documento finalizado, **when** o desenvolvedor lê a Seção 5, **then** encontra uma tabela com as 5 automações (Programação, RAG Programação, Empregabilidade, Ouvidoria, Acesso Cuca), o valor de `agente_tipo`/`canal_tipo` que as identifica, o arquivo Python que as trata e a linha de entrada do roteamento.

## Dev Notes

Esta story é **leitura + documentação pura** — não há `apply_migration`, nem `git add` de código. O entregável é um único arquivo Markdown.

### Ponto de partida (já mapeado pelo @sm)

| Artefato | Localização | Relevância |
|---|---|---|
| Webhook de entrada | `worker/main.py:1221` — `POST /webhook/{token}` | Seção 1 |
| Resposta 200 OK imediata | `worker/main.py:1234` | Seção 1 — anti-ban UAZAPI |
| Roteamento de eventos | `worker/main.py:248` — `process_webhook_payload()` | Seção 1 + 2 |
| Payload normalizado → motor-agente | `worker/main.py:681-691` | **Seção 2 — contrato-alvo** |
| `canal_tipo` lido do banco | `worker/main.py:465,469` | Seção 3 |
| Env var de controle global | Pesquisar `CANAL_WHATSAPP` em todo o código | Seção 3 |
| Envio de texto (resposta IA) | `worker/main.py:845-852` — `POST {UAZAPI_URL}/send/text` | Seção 4 |
| Envio de mídia (flyer) | `worker/main.py:830-842` — `POST {UAZAPI_URL}/message/sendMedia/{instance}` | Seção 4 |
| Envio STOP handler | `worker/main.py:547-558` — `POST {UAZAPI_URL}/message/sendText/{instance}` | Seção 4 |
| Envio manual (portal) | `worker/main.py:976` — `POST /send-message/{token}` | Seção 4 |
| Roteamento Empregabilidade | `worker/main.py:579-599` — `agente_tipo == "Empregabilidade"` | Seção 5 |
| Roteamento Institucional | `worker/main.py:601-619` — `canal_tipo == "Institucional"` | Seção 5 |
| Transbordo: modulo_alvo | `worker/main.py:748-755` — `if agente_tipo in [...]` | Seção 5 |
| Manager UAZAPI | `worker/uazapi_manager.py` | Seção 1 + 4 (UAZAPI_BASE_URL) |

### Dúvidas abertas a responder na investigação

- `agente_tipo` exato das automações **Programação** e **RAG Programação** — podem ser `"maria"`, `"maria_rag"`, ou algo registrado no banco mas não hardcoded em main.py.
- **Canais adicionais presentes no código mas fora do escopo desta migração** (mencionar na Seção 5 com nota "fora do escopo"): `Divulgação` (`agente_tipo="maria_divulgacao"`, `main.py:507`), `Institucional` (`canal_tipo="Institucional"`, `institucional_engine.py`, `main.py:601`), `Campanhas` (loop de startup, `campanhas_engine.py`, `main.py:219`). Esses canais existem e devem ser mencionados para que o documento seja completo, mesmo que a migração deles seja planejada separadamente.
- Headers inconsistentes no envio: alguns usos usam `{"token": inst_token}`, outros `{"apikey": inst_token}` — documentar qual é canônico.
- Existe alguma lógica de seleção de instância UAZAPI por automação ou é sempre a instância que gerou o webhook?
- O campo `instancia_uazapi` no payload normalizado (Seção 2) é suficiente para o adapter Meta saber qual WABA usar? Ou é necessário um mapeamento adicional?

### Estrutura esperada do documento de saída

```markdown
# Contrato de Comunicação UAZAPI — Estado Atual

## 1. Recepção de webhook (entrada)
## 2. Contrato interno normalizado (payload → motor-agente)
### 2.1 Exemplo de payload preenchido
### 2.2 Campos e semântica
## 3. Flag de canal: como CANAL_WHATSAPP funciona hoje
## 4. Envio de mensagens (saída)
### 4.1 Envio de resposta da IA
### 4.2 Envio de mídia (flyer)
### 4.3 Envio de transbordo
### 4.4 Envio manual (portal)
## 5. Mapeamento de automações
```

## Tasks

- [x] Ler `worker/main.py` e `worker/uazapi_manager.py` na íntegra — confirmar o fluxo ponta-a-ponta.
- [x] **Seção 1** — Documentar a rota `POST /webhook/{token}`: como o token identifica a instância, o formato do payload recebido (campos `event`, `instance`, `data`), e a resposta 200 OK imediata.
- [x] **Seção 2** — Documentar o dict `payload_edge` (contrato interno normalizado), com exemplo real de valores e anotação semântica de cada campo. Este é o **contrato-alvo** que o adapter Meta reproduzirá.
- [x] **Seção 3** — Confirmar que não existe env var `CANAL_WHATSAPP` global; documentar que o controle de canal é por instância via `canal_tipo` em `instancias_uazapi`, onde e como é lido.
- [x] **Seção 4** — Documentar os 4 pontos de envio via UAZAPI: payload, headers, endpoint e arquivo+linha de cada um.
- [x] **Seção 5** — Tabela das 5 automações com `agente_tipo`, `canal_tipo`, arquivo de tratamento e linha de entrada no roteamento.
- [x] Salvar resultado em `docs/migracao-meta/contrato-uazapi.md`.
- [x] Atualizar File List e Change Log desta story.

## Dependências
Nenhuma — é a story fundação do épico de migração.

**É a base de:** S-WM-01, S-WM-02, S-WM-03 e todas as stories de migração por automação.

## Quality Gate
- Tipo: documentação. Agente: @qa.
- @qa verifica: (a) os 5 critérios de aceite estão todos satisfeitos no documento; (b) exemplo de payload normalizado está presente e completo; (c) as seções 3 e 5 respondem às dúvidas abertas do Dev Notes; (d) nenhum código de produção foi alterado.

## File List
**Criados:**
- `docs/migracao-meta/contrato-uazapi.md` — documento de investigação: 5 seções + apêndice, referência canônica para adapter Meta

**Modificados:**
_(nenhum arquivo de código alterado — story de investigação pura)_

## Dev Agent Record

### Agent Model Used
claude-sonnet-4-6 (@dev / Dex)

### Completion Notes
- **AC #1:** Seção 1 documenta rota `POST /webhook/{token}`, identificação da instância pelo token, formato completo do payload UAZAPI v1/v2 com tabela de fallback por campo, e resposta 200 OK imediata anti-ban.
- **AC #2:** Seção 2 documenta o `payload_edge` com exemplo real preenchido e tabela semântica campo-a-campo. Inclui campos extras do `institucional_engine.py` (`numero_empregabilidade`, `instrucoes_adicionais`).
- **AC #3:** Seção 3 confirma: `CANAL_WHATSAPP` **não existe** no código. Controle por instância via `canal_tipo` + `agente_tipo` em `instancias_uazapi`, lido em `main.py:464-469`.
- **AC #4:** Seção 4 documenta 6 pontos de envio (resposta IA texto, flyer com mídia, STOP handler, manual portal, transbordo interno, campanhas). Inclui descoberta de **inconsistência de headers**: `{"token"}` (canônico v2) vs `{"apikey"}` (legado/v1) em endpoints diferentes.
- **AC #5:** Seção 5 mapeia as 5 automações com `agente_tipo`, `canal_tipo`, arquivo Python e linha de entrada. Documenta que "Programação" e "RAG Programação" são servidas pelo mesmo `institucional_engine.py` — distinção via `canal_tipo="Institucional"`. Adiciona 3 canais fora do escopo (Divulgação, Campanhas, Institucional como nota) conforme orientação do @po.
- **Dúvidas abertas resolvidas:**
  - `CANAL_WHATSAPP` → não existe
  - Programação/RAG Programação → ambas via `institucional_engine.py` com `canal_tipo="Institucional"` (verificar banco para `agente_tipo` exato)
  - Headers inconsistentes → documentados na tabela de resumo da Seção 4
  - Seleção de instância → sempre a instância que gerou o webhook (não há lógica de seleção)
- **Sem alterações de código:** nenhum arquivo de produção foi modificado.

## QA Results

### Veredito: PASS

**Data:** 2026-06-22 | **Agente:** @qa (Quinn)

#### Verificação dos 5 ACs

| AC | Resultado | Evidência no documento |
|---|---|---|
| AC #1 — Rota, método, payload, retorno | ✅ PASS | Seção 1.1 (rota + método), 1.2 (retorno 200 OK), 1.3 (payload completo v1/v2 com tabela de fallback) |
| AC #2 — Payload normalizado com exemplo e anotações | ✅ PASS | Seção 2.1 (dict Python com valores reais), 2.2 (tabela semântica 8 campos), 2.3 (destino motor-agente) |
| AC #3 — CANAL_WHATSAPP existe? Onde é lido? | ✅ PASS | Seção 3: `CANAL_WHATSAPP` não existe. Controle por `canal_tipo`/`agente_tipo` em `instancias_uazapi`, lido em `main.py:464-469` com snippet |
| AC #4 — Endpoints de envio com arquivo+linha | ✅ PASS | Seção 4: 6 pontos documentados (excede os 4 mínimos exigidos). Tabela de headers com análise canônica |
| AC #5 — Tabela das 5 automações | ✅ PASS | Seção 5.1: tabela completa. Dúvida aberta sobre `agente_tipo` de Programação/RAG corretamente documentada com instrução de verificação no banco |

#### Checklist Quality Gate

- [x] (a) 5 ACs satisfeitos no documento
- [x] (b) Exemplo de payload normalizado presente e completo
- [x] (c) Seções 3 e 5 respondem às dúvidas abertas do Dev Notes
- [x] (d) Nenhum código de produção alterado

#### Observações (não bloqueiam)

1. **AC #4 — legibilidade:** O AC pergunta "onde se decide o canal de envio" — a decisão está distribuída entre Seção 4 (os pontos) e Seção 5.2 (o roteamento). Não é um problema funcional. Para S-WM-01: o diagrama de roteamento em 5.2 responde a questão completa.
2. **Dúvida agente_tipo Programação/RAG:** Não existe distinção hardcoded — depende de dados em `instancias_uazapi`. Documentado e rastreável. Não impacta esta story.
3. **Inconsistência `UAZAPI_BASE_URL`:** Apêndice identifica dois valores padrão diferentes no código (uazapi_manager.py vs main.py). Risco latente para S-WM-01 ao mapear URLs que o adapter Meta substituirá.

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-06-22 | @sm (River) | Criação da story de investigação (Draft) |
| 2026-06-22 | @po (Pax) | Validação GO (8/10) — adicionado: complexidade XS, nota sobre canais adicionais fora do escopo (Divulgação/Institucional/Campanhas). Status: Draft → Ready |
| 2026-06-22 | @dev (Dex) | Investigação completa — `docs/migracao-meta/contrato-uazapi.md` produzido com 5 seções + apêndice. Todos os ACs satisfeitos. Status: Ready → Ready for Review |
| 2026-06-22 | @qa (Quinn) | QA Gate: PASS — todos os 5 ACs verificados. 3 observações menores registradas, nenhuma bloqueante. Status: Ready for Review → Done |
