# S-AE-04 — Automação de Entrada Humanizada (sem menu)

## Status
Ready for Review

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
- [x] Adaptar `academia_enem_engine.py` para escrever em `conversas`/`mensagens` (`agente_tipo='academia_enem'`).
- [x] Adaptar despacho do webhook (no serviço `cuca-academia-enem`) para rotear `agente_tipo='academia_enem'` ao engine certo — novo `elif` aditivo em `meta_adapter_inbound._executar_dispatch`.
- [x] Envio via `meta_adapter_outbound` (Graph API).
- [x] Encaminhar ao classificador (S-AE-10) após coletar nome.
- [x] Encerramento por palavras-chave.
- [x] Remover qualquer referência residual a `ae_conversas`/`ae_mensagens`/AuctaFlux no engine.

## Dependências
Depende de **S-AE-00** (fundação/canal) e **S-AE-02** (serviço/credenciais Meta). Integra **S-AE-05** (RAG), **S-AE-06** (transbordo), **S-AE-10** (classificador).

## Quality Gate
- Tipo: backend (worker). Agentes: @qa. CodeRabbit: foco em máquina de estados, no-invention, e regressão no despacho compartilhado do webhook (item 2 do Dev Notes).

## File List
- `worker/academia_enem_engine.py` — reescrito: I/O trocado de `ae_conversas`/`ae_mensagens`/AuctaFlux para `conversas`/`mensagens`/`meta_adapter_outbound`. Máquina de estados pura `decidir()` mantida sem alteração de lógica (só removido o campo `proximo_status`, que não se aplica mais — ver Completion Notes).
- `worker/meta_adapter_inbound.py` — novo `elif agente_tipo == "academia_enem":` em `_executar_dispatch` (aditivo, entre o ramo Empregabilidade e o ramo motor-agente).
- `worker/tests/test_academia_enem_engine.py` (novo) — 15 testes: 6 da máquina de estados pura (`decidir()`), 4 de `_extrair_nome`, 5 da camada de I/O (com Supabase mockado).

## Completion Notes
- **Achado — a story presumia `worker/institucional_engine.py` como referência de adaptação; esse arquivo não existe.** Confirmado por `ls worker/*.py`: Institucional (e `maria`/`sofia`/`ana`) não têm engine Python próprio — são despachados para o **motor-agente** (Edge Function Supabase), via `_AGENTES_MOTOR_AGENTE` em `meta_adapter_inbound.py`. Só **Empregabilidade** tem engine Python bespoke (`empregabilidade_engine.py`), que foi a referência real usada (a story já citava os dois arquivos; usei só o que existe e se aplica — Academia Enem segue o padrão "engine bespoke próprio", igual Empregabilidade, não o padrão motor-agente).
- **Estado da conversa:** `conversas` (tabela compartilhada) não tem coluna `estado` própria — confirmado lendo `empregabilidade_engine.py` (`_get_fluxo`/`_set_fluxo`, que leem/gravam só `metadata.empreg_fluxo`). A etapa da Academia Enem vive inteira em `metadata.ae_fluxo`, mesmo padrão. Por isso a máquina de estados pura `decidir()` recebe `fluxo.get("etapa")` como "estado" — não uma coluna separada.
- **`awaiting_human` não é rechecado dentro do engine:** já é checado de forma centralizada em dois pontos de `meta_adapter_inbound.py` (chegada da mensagem, e de novo no momento do dispatch adiado pelo debounce) — comum a todos os `agente_tipo`. Repetir a checagem dentro do engine seria redundante.
- **Envio manual pelo painel (S-AE-03) não precisou de mudança nesta story:** o endpoint `/send-message/{token}` do worker já roteia por `canal_ativo`/`origem_id` da própria conversa (agnóstico de `agente_tipo`), então funciona para Academia Enem sem alteração — confirmado lendo `main.py` linhas ~311-355.
- Removido o campo `proximo_status` que a versão AuctaFlux usava para setar `ae_conversas.status='encerrada'` num encerramento por palavra-chave — a tabela compartilhada `conversas` tem seu próprio enum de `status` (usado por `awaiting_human`/handover, não pela story) e Empregabilidade não usa esse mecanismo para fechamento simples de conversa (só marca `fluxo.perfil`/`etapa` internamente). Mantive o mesmo padrão de Empregabilidade: encerramento fica só em `metadata.ae_fluxo.etapa='encerrada'`, sem tocar `conversas.status`.
- `pytest tests/test_academia_enem_engine.py` → 15/15. Suíte completa do worker (`pytest`, ignorando `test_main_retomar_disparo.py`, que já falha na coleta neste ambiente por `ModuleNotFoundError: openai` — gap de tooling pré-existente, não relacionado): 371 passed, 5 failed — os 5 failed são pré-existentes em `test_meta_adapter_outbound.py` (import `worker.main`, também um gap de path pré-existente do ambiente, não desta mudança).

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
| 2026-08-20 | @dev (Dex) | **Implementação completa (Status Ready→Ready for Review).** Engine reescrito p/ `conversas`/`mensagens` + `meta_adapter_outbound`; despacho aditivo em `meta_adapter_inbound.py`. Achado: `worker/institucional_engine.py` não existe — Institucional usa motor-agente, não engine Python; Academia Enem segue o padrão de Empregabilidade (engine bespoke). 15 testes novos, suíte completa sem regressão. |

## Dev Agent Record (histórico — arquitetura obsoleta, AuctaFlux/`ae_*`)
> ⚠️ Descreve a implementação anterior, substituída por esta reescrita. Ver git log do arquivo para o texto completo (máquina de estados pura `decidir()`, bug de parser de nome corrigido, endpoint `/academia-enem/process` com auth M2M).

## QA Results (histórico — arquitetura obsoleta)
Veredito original: **CONCERNS**. Bug crítico `status`×`estado` corrigido; remoção segura da branch legada uazapi confirmada; endpoint sem auth corrigido (MEDIUM). Não se aplica à arquitetura atual — nova revisão @qa necessária após reimplementação.

## QA Results (implementação atual — Meta direta, `conversas`/`mensagens`)

**Revisor:** Quinn (@qa) · **Data:** 2026-08-20 · **Veredito do gate: CONCERNS**

### Verificação independente (refeita do zero)
1. **Código bate com a story:** li os 2 arquivos de produção por completo. `academia_enem_engine.py` grava/lê só `conversas`/`mensagens` via `meta_adapter_outbound._meta_enviar` — nenhuma referência funcional a `ae_conversas`/`ae_mensagens`/AuctaFlux restante (só em comentário/docstring explicando a migração). `meta_adapter_inbound.py` tem exatamente 1 `elif` novo, aditivo, entre os ramos Empregabilidade e motor-agente.
2. **Achado do @dev confirmado de forma independente:** `ls worker/*.py` não lista `institucional_engine.py` — Institucional/`maria`/`sofia`/`ana` são despachados ao motor-agente via `_AGENTES_MOTOR_AGENTE` (linha 283 de `meta_adapter_inbound.py`), não um engine Python próprio. Confere com o relato — Academia Enem seguindo o padrão de Empregabilidade (engine bespoke) é a escolha correta dado o que a story pede (saudação humanizada sem menu, coleta de nome).
3. **`conversas` sem coluna `estado` própria — confirmado:** `empregabilidade_engine._get_fluxo`/`_set_fluxo` leem/gravam só `metadata.empreg_fluxo`. O uso de `metadata.ae_fluxo.etapa` como "estado" da máquina pura é consistente com o padrão real do módulo irmão, não inventado.
4. **Regressão — rastreado o dispatch compartilhado (item 2 do Dev Notes, risco mais alto desta story):** `elif agente_tipo == "academia_enem":` fica ANTES do `elif agente_tipo in _AGENTES_MOTOR_AGENTE:` — string `"academia_enem"` não colide com `"Empregabilidade"` nem com nenhum membro de `_AGENTES_MOTOR_AGENTE` (`Institucional`/`maria`/`sofia`/`ana`). Rodei a suíte completa de `test_meta_adapter_inbound.py` (68 testes) e `test_empregabilidade_engine.py` (183 testes) — 100% verde, nenhuma regressão.
5. **`awaiting_human` não duplicado:** confirmado que a checagem central em `meta_adapter_inbound.py` (chegada + momento do dispatch pós-debounce) já cobre `academia_enem` sem precisar de checagem própria no engine — está correto não repeti-la.
6. **Envio manual (S-AE-03) não precisava mudar:** confirmado lendo `main.py` (~linhas 311-355) — `/send-message/{token}` roteia por `canal_ativo`/`origem_id` da conversa, agnóstico de `agente_tipo`. Nenhuma alteração necessária, nenhuma esquecida.
7. **Testes:** 15 novos em `test_academia_enem_engine.py`, rodados de forma independente — 15/15 verde. Cobertura honesta: a máquina pura tem 6 testes que checam o CONTEÚDO da decisão (não só que uma chamada aconteceu), e a camada de I/O tem 5 testes que usam um mock memoizado por tabela (corrigido para refletir estado real pós-chamada, não uma instância nova sempre "limpa" — verifiquei o mock em si, não só os testes passando).
8. **Suíte completa do worker:** `pytest` (ignorando `test_main_retomar_disparo.py`, que já falha na coleta neste ambiente por `ModuleNotFoundError: openai`, gap de tooling pré-existente confirmado por mim antes desta story) → 371 passed, 5 failed. Os 5 failed são os mesmos pré-existentes de `test_meta_adapter_outbound.py` (import `worker.main`, path issue do ambiente, não desta mudança) — confirmei rodando a suíte na branch `main` antes deste PR e o resultado é idêntico.

### Achado NÃO reportado pelo @dev (CONCERNS)
**`worker/main.py`, endpoint `POST /academia-enem/process` (linhas ~423-448) ficou com assinatura quebrada.** Esse endpoint é resquício da arquitetura AuctaFlux (chamado pelo webhook `cuca-portal/src/app/api/academia-enem/webhook/auctaflux/route.ts`, também código morto da arquitetura anterior) e ainda chama:
```python
background_tasks.add_task(processar_mensagem_academia_enem, ae_conversa_id)
```
— 1 argumento posicional (`ae_conversa_id`). A função pública nova é `processar_mensagem_academia_enem(texto, phone, phone_number_id, lead_id, conversa_id)` — **5 parâmetros obrigatórios**. Se esse endpoint for chamado hoje, estoura `TypeError: missing 4 required positional arguments` dentro da background task (silenciosamente logado, sem afetar a resposta HTTP 200 já enviada — mascarado do chamador).
- **Impacto real:** o endpoint já está efetivamente morto (nada no fluxo Meta novo o aciona; o webhook AuctaFlux do portal que o chamava não está mais conectado à AuctaFlux de verdade). Não é uma regressão de comportamento hoje observável — não bloqueia os ACs desta story, que são sobre o webhook `/webhook/meta`, não sobre `/academia-enem/process`.
- **Por que não é FAIL:** nenhum AC da story depende deste endpoint; a suíte de testes não o exercita com sucesso (só um docstring de outro teste o menciona); nenhum caminho de produção do fluxo Meta passa por ele.
- **Por que é CONCERNS, não WAIVED silencioso:** é código morto que ficou inconsistente com a API pública do módulo que ele próprio importa — deixado assim, confunde qualquer leitura futura do arquivo, e um rollback acidental de rota no portal reativaria um 500 mascarado. Cabe um follow-up de limpeza (remover o endpoint + a rota do portal que o chama, ambos resquícios AuctaFlux) — não travar esta story por isso.

### 7 Quality Checks
1. **Code review** — ✅ Mudança mínima e aditiva; reuso correto do padrão de Empregabilidade (fluxo em metadata, `_meta_enviar`).
2. **Testes** — ✅ 15 testes novos, cobertura da máquina pura + camada de I/O, sem regressão na suíte completa.
3. **Acceptance Criteria** — ✅ AC1 (saudação sem menu), AC2 (nome persistido + hand-off classificar), AC3 (encerramento por palavra-chave), AC4 (estado em metadata, sem reapresentar saudação — confirmado por teste), AC5 (acionamento via `/webhook/meta` do serviço, sem `ae_conversas`/`ae_mensagens`/portal) — todos atendidos.
4. **Regressão** — ✅ Rastreamento extra dado ao dispatch compartilhado (maior risco da story); suítes de Empregabilidade e meta_adapter_inbound 100% verdes.
5. **Performance** — ✅ Aceitável (mesmo padrão de 2 round-trips select+update de Empregabilidade, não é uma regressão nova).
6. **Segurança** — ✅ Token (`META_SYSTEM_USER_TOKEN`) nunca logado; nenhuma exposição nova.
7. **Documentação** — ✅ Dev Agent Record/Completion Notes completos e precisos; achado do `institucional_engine.py` bem documentado.

### Issues
| Sev | Cat | Descrição | Recomendação |
|-----|-----|-----------|--------------|
| Medium | dead-code | `main.py` `/academia-enem/process` chama `processar_mensagem_academia_enem` com assinatura antiga (1 arg em vez de 5) — quebraria se invocado | Follow-up: remover o endpoint e a rota do portal (`api/academia-enem/webhook/auctaflux/route.ts`) que o chama — ambos resquícios AuctaFlux sem consumidor real |

### Decisão de Gate
**CONCERNS.** Implementação correta, testada de forma honesta e sem regressão nos canais em produção — todos os ACs atendidos. O único achado (endpoint morto com assinatura quebrada) não bloqueia nenhum AC nem afeta o fluxo Meta real, mas é uma inconsistência real que merece limpeza — registrado como follow-up, não como bloqueio. Liberado para @devops, com o item Medium documentado para tratamento posterior (não necessariamente nesta story).
