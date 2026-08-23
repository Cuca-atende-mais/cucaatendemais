# S-AE-10 — Classificador Disparo-vs-RAG com Regra No-Invention

## Status
Ready for Review

## Story
**Como** lead que recebeu um aviso da Academia Enem,
**quero** que, ao tirar uma dúvida, a IA entenda se minha pergunta é sobre o aviso recebido ou um assunto geral, e responda da fonte certa,
**para que** eu receba informação correta — e **nunca** uma resposta inventada.

## ⚠️ Story ajustada em 2026-08-20 — mecanismo de RAG passa a usar o motor-agente
Decisão do Junior confirma o item 3 do plano de migração: em vez de uma busca RAG bespoke feita direto no worker Python, o passo 2 (RAG) desta story passa a **chamar o motor-agente** (Edge Function com IA + busca em base de conhecimento, já usado por Institucional/Sofia/Ana), com um `agente_tipo` novo (`academia_enem`). Isso exige criar uma linha em `prompts_agentes` para a persona da Academia Enem e uma entrada em `RAG_FONTES_POR_AGENTE` apontando para o conteúdo ingerido pela S-AE-05. O passo 1 (aviso/`ultimo_disparo`) continua sendo lógica própria do módulo, porque depende do breadcrumb gravado pela S-AE-09 (fila própria).

## Contexto
Épico: `EPIC-Academia-Enem.md` (item 8 — **peça central**, "a IA JAMAIS PODE INVENTAR NADA, ISSO É UMA REGRA INEGOCIÁVEL"). Integra entrada (S-AE-04), RAG via motor-agente (S-AE-05 fornece o conteúdo ingerido), transbordo (S-AE-06) e o breadcrumb de disparo (S-AE-09 — arquitetura reescrita, fila própria da Academia Enem). O breadcrumb do último aviso é gravado na tabela própria de disparo da Academia Enem (S-AE-09), lido por `conversas.metadata` ou join equivalente — **não mais em `ae_conversas`** (tabela abandonada).

## Regra inegociável (Artigo IV — No Invention)
Quando nenhuma fonte (aviso disparado **ou** RAG) contém a resposta, a IA **não inventa**: responde "Não tenho essa informação, quer que te transfira para nossa equipe?" → se sim, transbordo (S-AE-06); se não, encerra.

## Lógica (fluxo determinístico)
Entrada: mensagem do lead já com nome coletado (S-AE-04).

1. **Há `metadata.ultimo_disparo`?**
   - **Sim →** classificar: a pergunta se refere ao **aviso enviado**?
     - **Refere-se ao aviso:** ler o texto do `ultimo_disparo`.
       - **Encontrou a resposta no aviso →** responder com base no aviso.
       - **Não encontrou →** NÃO inventa → "Não tenho essa informação, quer que te transfira para nossa equipe?" → sim=transbordo / não=encerramento.
     - **Não se refere ao aviso (pergunta diferente):** seguir para o passo 2 (RAG).
   - **Não →** seguir para o passo 2 (RAG).
2. **Chamar o motor-agente** com `agente_tipo='academia_enem'` (RAG via `RAG_FONTES_POR_AGENTE`, conteúdo ingerido pela S-AE-05).
   - **Encontrou →** responder com base na resposta do motor-agente.
   - **Não encontrou →** NÃO inventa → "Não tenho essa informação, quer que te transfira para nossa equipe?" → sim=transbordo / não=encerramento.

> Em **todos** os ramos de "não encontrou", a resposta é a mesma mensagem padrão e o caminho leva a transbordo ou encerramento. Nunca há geração livre sem fonte.

## Escopo
### IN
- Implementar a lógica acima no `academia_enem_engine` (chamada após coleta de nome, S-AE-04).
- Classificador "a pergunta se refere ao aviso?" (LLM ou heurística) usando o texto do breadcrumb do último aviso (S-AE-09).
- Leitura/answer a partir do aviso quando aplicável.
- **Criar linha em `prompts_agentes`** para a persona da Academia Enem.
- **Adicionar entrada em `RAG_FONTES_POR_AGENTE`** (motor-agente) apontando para o conteúdo ingerido pela S-AE-05.
- Chamada ao motor-agente com `agente_tipo='academia_enem'` quando a pergunta não se refere ao aviso.
- Mensagem padrão de "não tenho essa informação" + oferta de transbordo; ramificação sim/não.
- Acionar S-AE-06 quando o lead aceita transbordo; encerrar quando recusa.

### OUT
- Geração do aviso e breadcrumb (S-AE-09), ingestão de RAG (S-AE-05), lógica interna do motor-agente, mecanismo de transbordo (S-AE-06) — apenas consome.

## Critérios de Aceite (Given/When/Then)
1. **Given** o lead recebeu um aviso "Amanhã, aula às 18h no Cuca Barra" e **when** pergunta "Que horas é a aula?", **then** a IA classifica como referente ao aviso, lê o aviso e responde "18h".
2. **Given** o mesmo aviso e **when** o lead pergunta algo cujo dado **não está** no aviso (ex.: "que horas termina?"), **then** a IA **não inventa** e responde a mensagem padrão oferecendo transbordo.
3. **Given** o lead pergunta algo **diferente do aviso** (ex.: "como faço a inscrição no Enem?"), **then** a IA busca no RAG e responde a partir dos chunks `academia_enem`.
4. **Given** uma pergunta sem cobertura nem no aviso nem no RAG, **then** a IA responde a mensagem padrão e **nunca** gera resposta inventada.
5. **Given** a oferta de transbordo, **when** o lead responde "sim", **then** aciona S-AE-06; **when** responde "não", **then** encerra educadamente.
6. **Given** não há `ultimo_disparo`, **then** o fluxo vai direto ao RAG (passo 2).
7. **Testes:** cobertura dos 3 caminhos (aviso-encontrou, RAG-encontrou, nenhuma-fonte→transbordo).

## Dev Notes
- O breadcrumb do último aviso (texto/título/enviado_em) é gravado na tabela própria de disparo da Academia Enem (S-AE-09) — garantir que o disparo grave o **texto completo** do aviso para permitir a leitura.
- Classificação "refere-se ao aviso?" deve ser conservadora: na dúvida, tentar o aviso e, se não houver dado, cair no fluxo no-invention (não pular direto para invenção).
- Logar a fonte usada (aviso/motor-agente/none) para auditoria do no-invention.

## Dev Notes — análise de impacto (item por item, mudança de 2026-08-20)
1. **Toca:** `motor-agente` (Edge Function) — adiciona `agente_tipo='academia_enem'` a `RAG_FONTES_POR_AGENTE` e uma linha em `prompts_agentes`.
   **Depende disso hoje:** Institucional/Sofia/Ana já chamam essa mesma Edge Function com seus próprios `agente_tipo`.
   **Impacto real:** aditivo — uma chave nova no mapa `RAG_FONTES_POR_AGENTE` e uma linha nova em `prompts_agentes` não alteram o comportamento para os `agente_tipo` já existentes, desde que o código trate `agente_tipo` desconhecido/novo isoladamente (sem fallback genérico que colidisse com outro agente).
   **De-risk concreto:** antes de implementar, ler `motor-agente/index.ts` e confirmar que `RAG_FONTES_POR_AGENTE` é de fato um mapa por chave (não uma lista ordenada com matching ambíguo) — se for mapa por chave, o risco de regressão nos outros agentes é baixo; se não for, precisa relatar antes de prosseguir.
   **Nota:** sem entrada em `isAgenteProgramacao`, a Academia Enem cai no branch genérico do motor-agente (busca vetorial simples, sem lógica de unidade/menu do Institucional) — comportamento correto e intencional para este módulo (não tem unidade, não tem menu).

## Tasks
- [ ] Implementar o fluxo determinístico no engine.
- [ ] Classificador referente-ao-aviso.
- [ ] Answer a partir do aviso + integração RAG.
- [ ] Mensagem padrão no-invention + ramificação transbordo/encerramento.
- [ ] Testes dos 3 caminhos.

## Dependências
Depende de **S-AE-04** (entrada), **S-AE-05** (RAG), **S-AE-06** (transbordo), **S-AE-09** (breadcrumb). É a integração final do módulo.

## Quality Gate
- Tipo: backend (worker) + IA. Agentes: @architect, @qa. CodeRabbit: foco **máximo** em no-invention (nenhum ramo pode gerar resposta sem fonte) e cobertura de testes dos 3 caminhos.

## ⚠️ Desenho definitivo (2026-08-23) — isolamento total, sem exceção

**Histórico da decisão, registrado por transparência:** a primeira tentativa de implementação
(2026-08-23, manhã) delegava ao `motor-agente` compartilhado (Edge Function que atende o
Institucional em produção) — chave nova em `RAG_FONTES_POR_AGENTE`, persona nova em
`prompts_agentes`, breadcrumb lido de `documentos_rag`/`chunks_documentos` compartilhadas. O
Junior identificou corretamente que isso violava o princípio de isolamento do módulo — mesmo
sendo tecnicamente aditivo (não alterava o comportamento do Institucional), qualquer deploy
futuro da Academia Enem exigiria redeployar a mesma Edge Function que o Institucional depende
**agora, em produção**, acoplando o risco dos dois canais. **O commit dessa tentativa foi
desfeito por completo** (nunca chegou a ser pusheado) e a persona/achados de QA daquela rodada
(A-1: tag `[[ENCAMINHAR]]` sem gate por `agente_tipo`; A-2: `canal_origem` incorreto) ficaram
obsoletos — não existem mais no desenho final, porque a causa raiz (compartilhar o motor-agente)
deixou de existir.

**Desenho final, confirmado pelo Junior (textualmente, "TUDO SEPARADO, ABSOLUTAMENTE
SEPARADO"):**
- **Edge Function própria:** `supabase/functions/academia-enem-agente/index.ts` — cópia adaptada
  do necessário do motor-agente (chamada GPT, embeddings, tags de handover/encerramento),
  **sem nenhum import do motor-agente**, deploy 100% independente. Persona "Duda" **hardcoded**
  no arquivo (não depende de `prompts_agentes`, tabela compartilhada). **Não implementa
  `[[ENCAMINHAR:canal]]`** — estruturalmente impossível de a Academia Enem redirecionar pra
  outro canal (antes era só uma instrução de prompt, agora nem existe o código que processaria
  a tag).
- **RAG próprio:** tabelas novas `ae_documentos_rag`/`ae_chunks_documentos` (mesmo shape de
  `documentos_rag`/`chunks_documentos`, mas isoladas — RLS keyed só a `ae_rag`, sem OR com
  `programacao_rag_global` como a versão compartilhada tinha) + RPC própria
  `ae_buscar_chunks_similares` (nunca `buscar_chunks_similares`). Ingestão via Edge Function
  própria `academia-enem-processar-documento` (nunca `processar-documento`).
- **Log de disparo próprio:** tabela nova `logs_disparo_academia_enem` (nunca `logs_disparo`).
  A coluna aditiva `disparo_academia_enem_id` que a S-AE-09 tinha criado em `logs_disparo`
  compartilhada foi **removida** (0 linhas usavam, confirmado antes de remover — sem perda de
  dado). `_contar_enviados_hoje_sync` (função compartilhada, usada por Institucional/
  Divulgação/Ouvidoria) voltou a ter só os 2 blocos originais — o teto diário da Academia Enem
  tem sua própria função isolada (`_contar_enviados_academia_enem_hoje_sync`).
- **O que continua sendo reaproveitado, por decisão explícita do Junior** ("aproveita somente a
  parte de template e numero meta para ter controle"): `meta_phone_numbers`/`meta_templates`
  (infraestrutura de credencial/template Meta) e a RPC `get_openai_key` (só lê uma credencial de
  `configuracoes`, não é lógica de canal).
- **Fora de escopo desta story, sinalizado ao Junior:** `leads`/`conversas`/`mensagens`
  continuam compartilhadas — arquitetura definida na S-AE-02/03/04/07/08/11/13 (**antes** desta
  sessão, já em produção). Separar isso também exigiria reabrir 6 stories já entregues — não foi
  feito aqui, aguardando confirmação explícita se/quando for prioridade.

## File List
**Migrations (aplicadas em produção via MCP):**
- `cuca-portal/supabase/migrations/20260823010000_ae_rag_proprio.sql` — `ae_documentos_rag`,
  `ae_chunks_documentos`, RLS própria (`ae_rag`, sem OR com outra permissão), RPC
  `ae_buscar_chunks_similares`.
- `cuca-portal/supabase/migrations/20260823020000_ae_logs_disparo_proprio.sql` — remove
  `logs_disparo.disparo_academia_enem_id` (0 linhas, sem perda de dado); cria
  `logs_disparo_academia_enem` (RLS própria, `ae_disparo`).

**Edge Functions novas (deploy próprio, pendente):**
- `supabase/functions/academia-enem-agente/index.ts` — GPT + RAG isolado + persona "Duda"
  hardcoded + tags handover/encerrar. Sem `[[ENCAMINHAR]]`.
- `supabase/functions/academia-enem-processar-documento/index.ts` — ingestão (chunking +
  embedding) exclusiva, grava em `ae_chunks_documentos`.

**Worker:**
- `worker/academia_enem_engine.py` — `classificar()` chama `_chamar_academia_enem_agente`
  (HTTP direto pra Edge Function própria); handover aciona `acionar_transbordo` (já existia,
  isolado por `modulo='academia_enem'`).
- `worker/campanhas_engine.py` — breadcrumb ganha campo `texto` (corpo completo do aviso, não só
  título); `_contar_enviados_academia_enem_hoje_sync`/`_resolver_limite_restante_hoje_academia_enem_sync`
  novas (isoladas); `_contar_enviados_hoje_sync` (compartilhada) sem o bloco da Academia Enem;
  ledger de envio grava em `logs_disparo_academia_enem`.
- `worker/meta_adapter_inbound.py` — atualização de status de entrega (webhook) tenta também
  `logs_disparo_academia_enem` (best-effort, no-op pros outros módulos).
- `worker/tests/test_academia_enem_engine.py` — testes novos confirmam que `classificar()`
  nunca toca `meta_adapter_inbound._chamar_motor_agente` (isolamento verificado por teste).
- `worker/tests/test_campanhas_engine_academia_enem.py` — testes da contagem isolada.

**Portal:**
- `cuca-portal/src/app/(dashboard)/academia-enem/base-conhecimento/page.tsx` — lê/grava
  `ae_documentos_rag` (não mais `documentos_rag`), indexa via Edge Function própria.

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-06-11 | @sm (River) | Criação da story (Draft) |
| 2026-06-14 | @po (Pax) | **Cascata S-AE-02:** `ultimo_disparo` e estado lidos de **`ae_conversas`** (camada própria), não de `conversas`. uazapi blindado. |
| 2026-08-20 | @sm (River) | **Ajuste (decisão do Junior, migração Meta direta):** passo 2 (RAG) passa a chamar o **motor-agente** (`agente_tipo='academia_enem'`) em vez de busca RAG bespoke no worker; breadcrumb do aviso lido da fila própria criada pela S-AE-09 reescrita (não mais `ae_conversas`). Adicionada análise de impacto sobre o `motor-agente` compartilhado. |
| 2026-08-20 | @po (Pax) | **Validação (GO, 8/10) → Status Draft→Ready.** A recomendação de de-risk (confirmar se `RAG_FONTES_POR_AGENTE` é mapa por chave antes de implementar) está corretamente colocada como bloqueante do dev, não como suposição aceita. |
| 2026-08-23 | @dev (Dex) | **Tentativa 1 (desfeita):** implementação delegando ao `motor-agente` compartilhado. QA achou 2 problemas (A-1: tag `[[ENCAMINHAR]]` sem gate por `agente_tipo`; A-2: `canal_origem` incorreto). Antes de corrigir, o Junior identificou que a causa raiz era arquitetural — compartilhar Edge Function/RAG/persona com o Institucional viola o isolamento do módulo, mesmo com mudanças aditivas. **Commit inteiro desfeito** (nunca pusheado), persona removida do banco. |
| 2026-08-23 | Junior | **Decisão definitiva: isolamento total.** "TUDO SEPARADO, ABSOLUTAMENTE SEPARADO" — Edge Function própria, RAG próprio, log de disparo próprio; persona pode copiar a estrutura/regras do Institucional (idêntica, com outro nome), mas nunca reaproveitar o mesmo processo/tabela. Única exceção confirmada: template + número Meta (infraestrutura de credencial, não lógica de canal). `leads`/`conversas`/`mensagens` ficam fora de escopo (decisão de sessões anteriores, já em produção) — sinalizado, não alterado sem confirmação explícita. |
| 2026-08-23 | @dev (Dex) | **Reconstrução completa com isolamento total.** Edge Function própria (`academia-enem-agente`, persona hardcoded, sem `[[ENCAMINHAR]]`), RAG próprio (`ae_documentos_rag`/`ae_chunks_documentos`/`ae_buscar_chunks_similares`, RLS sem OR cruzado), log de disparo próprio (`logs_disparo_academia_enem`, coluna aditiva removida de `logs_disparo` compartilhada), ingestão própria (`academia-enem-processar-documento`). Suíte: 375 passando. `tsc`/`eslint` limpos. Status InProgress→Ready for Review. |
