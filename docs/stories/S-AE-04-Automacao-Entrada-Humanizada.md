# S-AE-04 — Automação de Entrada Humanizada (sem menu)

## Status
Ready

## ⚠️ Story reaberta e reescrita em 2026-08-20 — mudança de arquitetura
Implementação anterior (Ready for Review) rodava sobre `ae_conversas`/`ae_mensagens`, acionada pelo webhook AuctaFlux (portal). Essa arquitetura foi abandonada (decisão do Junior, 2026-08-20). O engine passa a ser acionado pelo **webhook do serviço `cuca-academia-enem`** (S-AE-02, conexão Meta direta), e escreve nas tabelas **compartilhadas** `conversas`/`mensagens`, com `agente_tipo='academia_enem'` — mesmo padrão que `institucional_engine.py`/`empregabilidade_engine.py` já usam. Dev Agent Record/QA Results anteriores mantidos como histórico obsoleto.

## Story
**Como** lead que escreve para o número da Academia Enem,
**quero** ser recebido por uma mensagem humanizada que coleta meu nome e conduz a conversa naturalmente,
**para que** eu não precise navegar por um menu numérico para ser atendido.

## Contexto
Adapta os engines existentes (`worker/institucional_engine.py`, `worker/empregabilidade_engine.py`), removendo o menu de opções. Roda como parte do serviço `cuca-academia-enem` (mesmo código-base do worker, deploy separado — S-AE-02), não mais como um caminho isolado disparado pelo portal.

## Arquitetura (revisada 2026-08-20)
- `worker/academia_enem_engine.py` passa a escrever em **`conversas`/`mensagens`** (compartilhadas), com `agente_tipo='academia_enem'`, `canal_ativo='meta'`, `origem_id=phone_number_id` — o mesmo modelo já usado por Institucional/Empregabilidade.
- Acionamento: `POST /webhook/meta` do serviço `cuca-academia-enem` (mesmo endpoint padrão já implementado em `worker/main.py`, rodando nesse serviço com as credenciais próprias da Academia Enem) → `processar_webhook_meta` → despacha para `academia_enem_engine` quando `agente_tipo=='academia_enem'` (join por `phone_number_id` em `meta_phone_numbers`).
- Envio via `meta_adapter_outbound` (Graph API), respeitando a janela de 24h.

## Escopo
### IN
- Engine de entrada: 1ª mensagem → saudação humanizada + pedido de nome (sem listar opções numeradas); persistir nome no lead/metadata da conversa.
- Após coletar o nome, avançar o estado e expor o seam de roteamento `classificar(conversa)`, implementado pela S-AE-10 (que agora liga ao motor-agente — ver S-AE-10 reescrita).
- Detecção de intenção de encerramento (reuso de `_PALAVRAS_ENCERRAR` do `empregabilidade_engine.py`).

### OUT
- Lógica do classificador disparo-vs-RAG (S-AE-10) e do RAG em si (S-AE-05) — apenas integra.
- Transbordo (S-AE-06) — apenas aciona.

## Critérios de Aceite (Given/When/Then)
1. **Given** um lead novo, **when** envia a 1ª mensagem, **then** recebe uma saudação humanizada pedindo o nome — sem menu numérico.
2. **Given** o lead respondeu o nome, **when** envia a próxima mensagem, **then** o nome é persistido e a conversa avança para o estado de roteamento, chamando o seam `classificar()`.
3. **Given** uma conversa em andamento, **when** o lead diz algo como "tchau/obrigado", **then** o fluxo encerra educadamente.
4. **Given** o estado é mantido entre mensagens, **then** reflete a etapa atual sem reapresentar a saudação.
5. **Given** o canal Academia Enem, **then** o acionamento parte do webhook Meta do serviço `cuca-academia-enem` — sem depender do portal nem de `ae_conversas`/`ae_mensagens`.

## Dev Notes — análise de impacto (item por item)
1. **Toca:** `worker/academia_enem_engine.py` passa a escrever em `conversas`/`mensagens` (tabelas usadas por Institucional/Empregabilidade/Ouvidoria/Acesso Cuca).
   **Depende disso hoje:** o painel (S-AE-03), os disparos de outros módulos, e as consultas de KPI/relatório que já leem `conversas`/`mensagens`.
   **Impacto real:** desde que `agente_tipo='academia_enem'` seja sempre gravado corretamente, os registros da Academia Enem ficam **identificáveis e filtráveis**, sem se misturar visualmente com os de outros módulos nas telas existentes — mas é preciso confirmar que nenhuma tela hoje lista "todas as conversas" sem filtrar por `agente_tipo`/canal (isso apareceria como vazamento cruzado).
   **De-risk concreto:** antes de implementar, grep em `cuca-portal` por queries em `conversas`/`mensagens` que não filtram por `agente_tipo` — se existir alguma tela assim, ela passará a mostrar também Academia Enem sem intenção; precisa ser corrigida ou o filtro precisa ser adicionado.
2. **Toca:** despacho no `worker/main.py`/`meta_adapter_inbound.py` — precisa reconhecer `agente_tipo='academia_enem'` e chamar o engine certo (hoje só reconhece Institucional/Empregabilidade).
   **Depende disso hoje:** o mesmo despacho atende Institucional e Empregabilidade.
   **Impacto real:** aditivo (`elif agente_tipo == 'academia_enem'`) — não deveria alterar o comportamento dos dois `elif` já existentes, mas precisa de teste de regressão confirmando que webhooks de Institucional/Empregabilidade continuam caindo nos engines certos após a mudança.

## Tasks
- [ ] Adaptar `academia_enem_engine.py` para escrever em `conversas`/`mensagens` (`agente_tipo='academia_enem'`).
- [ ] Adaptar despacho do webhook (no serviço `cuca-academia-enem`) para rotear `agente_tipo='academia_enem'` ao engine certo.
- [ ] Envio via `meta_adapter_outbound` (Graph API).
- [ ] Encaminhar ao classificador (S-AE-10) após coletar nome.
- [ ] Encerramento por palavras-chave.
- [ ] Remover qualquer referência residual a `ae_conversas`/`ae_mensagens`/AuctaFlux no engine.

## Dependências
Depende de **S-AE-00** (fundação/canal) e **S-AE-02** (serviço/credenciais Meta). Integra **S-AE-05** (RAG), **S-AE-06** (transbordo), **S-AE-10** (classificador).

## Quality Gate
- Tipo: backend (worker). Agentes: @qa. CodeRabbit: foco em máquina de estados, no-invention, e regressão no despacho compartilhado do webhook (item 2 do Dev Notes).

## File List
_A preencher pelo @dev — substitui o File List da implementação anterior._

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-06-11 | @sm (River) | Criação da story (Draft) |
| 2026-06-14 | @po (Pax) | Cascata S-AE-02 (arquitetura anterior — `ae_conversas`/`ae_mensagens`) |
| 2026-06-16 | @po (Pax) | Validação (GO condicional → GO) |
| 2026-06-16 | @dev (Dex) | Implementação sobre `ae_conversas`/`ae_mensagens` + webhook AuctaFlux (arquitetura anterior) |
| 2026-06-16 | @qa (Quinn) | QA gate CONCERNS (arquitetura anterior) |
| 2026-08-20 | @sm (River) | **Reabertura e reescrita completa (decisão do Junior, migração Meta direta):** engine passa a escrever em `conversas`/`mensagens` compartilhadas, acionado pelo webhook Meta do serviço `cuca-academia-enem`. Status resetado para Draft. Dev Agent Record/QA Results anteriores mantidos abaixo como histórico da arquitetura obsoleta. |
| 2026-08-20 | @po (Pax) | **Validação (GO, 8/10) → Status Draft→Ready.** Análise de impacto no despacho compartilhado do webhook (item 2 do Dev Notes) está adequada — cobre exatamente o risco de regressão em Institucional/Empregabilidade que este tipo de mudança carrega. |

## Dev Agent Record (histórico — arquitetura obsoleta, AuctaFlux/`ae_*`)
> ⚠️ Descreve a implementação anterior, substituída por esta reescrita. Ver git log do arquivo para o texto completo (máquina de estados pura `decidir()`, bug de parser de nome corrigido, endpoint `/academia-enem/process` com auth M2M).

## QA Results (histórico — arquitetura obsoleta)
Veredito original: **CONCERNS**. Bug crítico `status`×`estado` corrigido; remoção segura da branch legada uazapi confirmada; endpoint sem auth corrigido (MEDIUM). Não se aplica à arquitetura atual — nova revisão @qa necessária após reimplementação.
