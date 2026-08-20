# S-AE-03 — Painel de Atendimento Academia Enem

## Status
Ready

## ⚠️ Story reaberta e reescrita em 2026-08-20 — mudança de arquitetura
Implementação anterior (Ready for Review, commit `7539e9a`) foi construída sobre as tabelas próprias `ae_conversas`/`ae_mensagens` e o provider AuctaFlux. Essa arquitetura foi abandonada (decisão do Junior, 2026-08-20): o painel passa a operar sobre as tabelas **compartilhadas** `conversas`/`mensagens` (as mesmas de Institucional/Empregabilidade), filtradas por canal — só a conexão com a Meta (credenciais/webhook) é isolada no serviço `cuca-academia-enem` (S-AE-02). Dev Agent Record e QA Results anteriores (abaixo) descrevem a implementação **obsoleta** — mantidos como histórico, não como estado atual.

## Story
**Como** atendente do módulo Academia Enem,
**quero** visualizar e responder as conversas do número da Academia Enem em tempo real,
**para que** eu acompanhe e atenda os leads, igual ao atendimento da Empregabilidade — reaproveitando o mesmo painel de chat.

## Contexto
Reaproveita **diretamente** os componentes de chat já existentes e validados (`components/chat/chat-sidebar.tsx`, `chat-window.tsx`, os mesmos usados por Institucional/Empregabilidade), filtrando as conversas por `agente_tipo='academia_enem'` (ou pelo `phone_number_id` cadastrado em S-AE-02). Os arquivos `ae-chat-sidebar.tsx`/`ae-chat-window.tsx` da implementação anterior viram código morto, a apagar.

## Escopo
### IN
- Rota `/academia-enem/mensagens` protegida por `atendimentos_academia_enem:read`.
- Lista de conversas e chat realtime usando `conversas`/`mensagens` (tabelas compartilhadas), filtradas pelo canal da Academia Enem.
- Envio manual via `meta_adapter_outbound` (mesmo mecanismo já usado por Institucional/Empregabilidade) — **não** mais `auctaflux.enviarTexto`.
- Indicador de janela de 24h (mesma regra Meta que os outros canais já respeitam) e bloqueio de texto livre fora da janela.
- Indicação visual de `awaiting_human` (transbordo, S-AE-06) silenciando a IA.

### OUT
- Automação/IA de resposta (S-AE-04/S-AE-10), transbordo em si (S-AE-06), envio de template/disparo (S-AE-09).

## Critérios de Aceite (Given/When/Then)
1. **Given** atendente com `atendimentos_academia_enem:read`, **when** abre o painel, **then** vê só as conversas do canal Academia Enem, em tempo real.
2. **Given** uma nova mensagem do lead, **when** chega pelo webhook do serviço `cuca-academia-enem`, **then** aparece no painel sem refresh manual.
3. **Given** a janela de 24h aberta, **when** o atendente envia texto, **then** a mensagem sai via `meta_adapter_outbound` e é gravada em `mensagens` (tabela compartilhada), sem misturar com conversas de outros canais na listagem.
4. **Given** a janela de 24h fechada, **when** o atendente tenta texto livre, **then** o envio é bloqueado com aviso de usar template.
5. **Given** conversa em `awaiting_human`, **then** a IA fica silenciada e o atendente assume.
6. **Given** um usuário sem permissão em `atendimentos_academia_enem`, **then** a rota/menu fica bloqueada (403 server-side, item invisível no menu).

## Dev Notes — análise de impacto (item por item)
1. **Toca:** troca da fonte de dados do painel, de `ae_conversas`/`ae_mensagens` para `conversas`/`mensagens` (compartilhadas); reuso de `components/chat/chat-sidebar.tsx`/`chat-window.tsx` já usados por Institucional/Empregabilidade.
   **Depende disso hoje:** os componentes compartilhados já são consumidos pelas telas de Institucional/Empregabilidade/Ouvidoria/Acesso Cuca.
   **Impacto real:** o painel da Academia Enem passa a ser **mais um consumidor** desses componentes, filtrando por canal — não altera o componente para os módulos existentes (o filtro de canal é um parâmetro, não uma mudança de comportamento default). Nenhuma regressão esperada nos outros módulos, desde que o filtro por canal seja aditivo (nunca removendo o filtro que já existe para os demais).
   **De-risk:** conferir, antes de implementar, como o filtro de canal é feito hoje nos componentes compartilhados (por `agente_tipo`? por rota?) — reaproveitar o mesmo padrão, não inventar um novo mecanismo de filtro.
2. **Toca:** apagar `ae-chat-sidebar.tsx`/`ae-chat-window.tsx` (código morto pós-migração).
   **Depende disso hoje:** nada — são arquivos exclusivos da rota `/academia-enem/mensagens`, sem outro consumidor.
   **Impacto real:** nenhum fora da própria rota.

## Tasks
- [ ] Rota/página de atendimento do módulo (lista + chat realtime), reaproveitando `components/chat/*`, filtrada por canal Academia Enem.
- [ ] Envio manual via `meta_adapter_outbound`.
- [ ] Indicador/bloqueio de janela de 24h (reaproveitar a mesma regra/lib já usada pelos outros canais).
- [ ] Respeitar `awaiting_human`.
- [ ] Apagar `ae-chat-sidebar.tsx`/`ae-chat-window.tsx` e qualquer referência a `ae_conversas`/`ae_mensagens` nesta rota.

## Dependências
Depende de **S-AE-00** (fundação/menu) e **S-AE-02** (serviço/número Meta da Academia Enem). Relaciona-se com **S-AE-06** (transbordo).

## Quality Gate
- Tipo: front realtime. Agentes: @qa. CodeRabbit: foco em cleanup de subscriptions realtime, regra de janela de 24h, e confirmação de que o filtro por canal não afeta os outros módulos que usam os mesmos componentes.

## File List
_A preencher pelo @dev — substitui integralmente o File List da implementação anterior (ae-chat-*)._

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-06-11 | @sm (River) | Criação da story (Draft) |
| 2026-06-14 | @po (Pax) | Cascata da decisão S-AE-02 (arquitetura anterior — tabelas próprias `ae_*`) |
| 2026-06-16 | @po (Pax) | Validação de draft (GO) → Status Draft→Ready |
| 2026-06-16 | @dev (Dex) | Implementação sobre `ae_conversas`/`ae_mensagens` (arquitetura anterior) |
| 2026-06-16 | @qa (Quinn) | QA gate CONCERNS (arquitetura anterior) |
| 2026-06-16 | @devops (Gage) | Push para `main` (commit `7539e9a`, arquitetura anterior) |
| 2026-08-20 | @sm (River) | **Reabertura e reescrita completa (decisão do Junior, migração Meta direta):** painel passa a usar `conversas`/`mensagens` compartilhadas + `meta_adapter_outbound`, reaproveitando `components/chat/*` (não mais `ae-chat-*`). Status resetado para Draft. Dev Agent Record/QA Results anteriores mantidos abaixo como histórico da arquitetura obsoleta. |
| 2026-08-20 | @po (Pax) | **Validação (GO, 8/10) → Status Draft→Ready.** Consistente com S-AE-02 (depende do serviço/número). Ponto de atenção não-bloqueante levado ao Dev Notes da própria story: confirmar que o filtro por `agente_tipo` já é aplicado por todas as telas que hoje leem `conversas`/`mensagens`, para não vazar dados entre módulos. |

## Dev Agent Record (histórico — arquitetura obsoleta, AuctaFlux/`ae_*`)
> ⚠️ Descreve a implementação anterior, substituída por esta reescrita. Mantido só para rastreabilidade.

### Agent Model Used
Dex (@dev) — claude-opus-4-8

### Completion Notes (obsoletas)
Implementação original usava `ae_conversas`/`ae_mensagens`, componentes próprios `ae-chat-*`, envio via `auctaflux.enviarTexto`. Ver histórico do arquivo (git log) para o texto completo.

## QA Results (histórico — arquitetura obsoleta)
Veredito original: **CONCERNS**. Bug crítico `status`×`estado` corrigido; RLS confirmada; AC#3 não verificado ao vivo (número `pending_signup`, AuctaFlux). Não se aplica à arquitetura atual — nova revisão @qa necessária após reimplementação.
