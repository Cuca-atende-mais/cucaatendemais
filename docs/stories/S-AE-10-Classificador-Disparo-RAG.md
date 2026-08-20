# S-AE-10 — Classificador Disparo-vs-RAG com Regra No-Invention

## Status
Ready

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

## File List
_A preencher pelo @dev._

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-06-11 | @sm (River) | Criação da story (Draft) |
| 2026-06-14 | @po (Pax) | **Cascata S-AE-02:** `ultimo_disparo` e estado lidos de **`ae_conversas`** (camada própria), não de `conversas`. uazapi blindado. |
| 2026-08-20 | @sm (River) | **Ajuste (decisão do Junior, migração Meta direta):** passo 2 (RAG) passa a chamar o **motor-agente** (`agente_tipo='academia_enem'`) em vez de busca RAG bespoke no worker; breadcrumb do aviso lido da fila própria criada pela S-AE-09 reescrita (não mais `ae_conversas`). Adicionada análise de impacto sobre o `motor-agente` compartilhado. |
| 2026-08-20 | @po (Pax) | **Validação (GO, 8/10) → Status Draft→Ready.** A recomendação de de-risk (confirmar se `RAG_FONTES_POR_AGENTE` é mapa por chave antes de implementar) está corretamente colocada como bloqueante do dev, não como suposição aceita. |
