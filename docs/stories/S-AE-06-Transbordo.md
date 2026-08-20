# S-AE-06 — Transbordo para Atendente Humano

## Status
Ready

## ⚠️ Story reescrita em 2026-08-20 — mudança de arquitetura
Versão anterior previa criar uma tabela própria `ae_transbordo_contatos`. Decisão do Junior (2026-08-20, confirmando a recomendação técnica do levantamento de migração): **não criar tabela nova**. O mecanismo genérico já existente (`transbordo_humano`, usado por Institucional/Empregabilidade/Ouvidoria/Acesso Cuca) já suporta contato/config **por módulo** — só precisa de uma linha nova para `modulo='academia_enem'`, com o telefone/responsável **próprio** da Academia Enem (confirmado pelo Junior: quem recebe o alerta de transbordo da Academia Enem é diferente de quem recebe o de Institucional/Empregabilidade — isso já é possível sem tabela nova).

## Story
**Como** lead da Academia Enem,
**quero** poder pedir para falar com um atendente humano ("quero falar com alguém", "passa para um atendente", "não entendi"),
**para que** eu seja transferido quando a IA não resolver minha dúvida — e que o alerta chegue para o responsável certo da Academia Enem, não para o de outro módulo.

## Contexto
Reaproveita o mecanismo já validado em produção (`_notificar_transbordo` em `worker/meta_adapter_inbound.py`, já parametrizado por `modulo`) e a tabela `transbordo_humano`. Referência: bloco de transbordo do `institucional_engine.py`.

## Escopo
### IN
- Detecção de intenção de falar com humano no `academia_enem_engine` (palavras-chave + sinal do classificador S-AE-10 quando não há resposta).
- **Cadastro de uma linha em `transbordo_humano`** para `modulo='academia_enem'`, com o telefone/responsável próprio da Academia Enem — via tela de configuração (rota protegida por `ae_transbordo_config`, mesma UX de `configuracoes/transbordo`, mas gravando no registro do módulo certo).
- Notificação ao responsável (via `meta_adapter_outbound`, template `cuca_transbordo_colaborador` ou equivalente) com histórico da conversa (de `mensagens`, filtrado pela conversa).
- Colocar a conversa em `awaiting_human` (em `conversas`) e silenciar a IA até liberação — mesmo mecanismo já usado por Institucional/Empregabilidade.

### OUT
- Painel de atendimento humano em si (S-AE-03).
- Criação de tabela nova — explicitamente fora de escopo por decisão do Junior.

## Critérios de Aceite (Given/When/Then)
1. **Given** um lead que diz "quero falar com alguém", **when** a mensagem é processada, **then** a conversa entra em `awaiting_human` e a IA para de responder.
2. **Given** o transbordo acionado, **when** ocorre, **then** o responsável **da Academia Enem** (linha `transbordo_humano` com `modulo='academia_enem'`) recebe alerta com telefone do lead, histórico e link `wa.me` — **nunca** o responsável de outro módulo.
3. **Given** o classificador (S-AE-10) não encontrou resposta nem no aviso nem no RAG e o lead aceitou ser transferido, **then** o transbordo é acionado pelo mesmo caminho.
4. **Given** nenhum contato configurado para `modulo='academia_enem'`, **then** registra log de aviso e usa fallback, sem quebrar o fluxo — e **sem** cair silenciosamente no contato de outro módulo.
5. **Given** um usuário sem `ae_transbordo_config:update`, **then** não edita o contato de transbordo (403).

## Dev Notes — análise de impacto (item por item)
1. **Toca:** `transbordo_humano` — tabela compartilhada com Institucional/Empregabilidade/Ouvidoria/Acesso Cuca.
   **Depende disso hoje:** os 4 módulos já cadastrados leem essa tabela para decidir quem notificar.
   **Impacto real:** um `INSERT` novo (`modulo='academia_enem'`) é aditivo — não altera as linhas existentes dos outros módulos. Risco só existiria se a query de busca não filtrasse por `modulo` corretamente (bug pré-existente causaria vazamento cruzado independente desta story).
   **De-risk concreto:** antes de cadastrar, conferir com `execute_sql` (read-only) que a query de `_notificar_transbordo` sempre filtra por `modulo=<correto>` — se não filtrar, o bug precisa ser corrigido primeiro (é regressão de segurança para todos os módulos, não só Academia Enem).
2. **Toca:** `academia_enem_engine.py` — adiciona lógica de detecção de intenção de transbordo.
   **Depende disso hoje:** nada além do próprio engine (código novo, sem consumidor externo).
   **Impacto real:** nenhum fora do módulo.

## Tasks
- [ ] Detecção de intenção de humano no engine (reaproveitar mecânica de `institucional_engine.py`).
- [ ] Confirmar que `_notificar_transbordo` filtra corretamente por `modulo` (de-risk acima) antes de cadastrar a linha nova.
- [ ] Cadastrar linha em `transbordo_humano` (`modulo='academia_enem'`) via tela de configuração.
- [ ] Notificação ao responsável com histórico.
- [ ] `awaiting_human` em `conversas` + silêncio da IA.

## Dependências
Depende de **S-AE-00** (fundação), **S-AE-02** (serviço/canal), **S-AE-04** (entrada). Acionada por **S-AE-10**.

## Quality Gate
- Tipo: backend + config. Agentes: @qa. CodeRabbit: foco em `awaiting_human`, fallback de contato, e confirmação de que o filtro por `modulo` não vaza entre módulos.

## File List
_A preencher pelo @dev._

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-06-11 | @sm (River) | Criação da story (Draft) |
| 2026-06-14 | @po (Pax) | Cascata da decisão S-AE-02 (arquitetura anterior — tabela própria `ae_transbordo_contatos`) |
| 2026-08-20 | @sm (River) | **Reescrita completa (decisão do Junior, migração Meta direta):** abandona `ae_transbordo_contatos`; reaproveita `transbordo_humano` compartilhada com uma linha nova (`modulo='academia_enem'`), preservando responsável próprio da Academia Enem. Status resetado para Draft. |
| 2026-08-20 | @po (Pax) | **Validação (GO, 9/10) → Status Draft→Ready.** Boa prática: a story já inclui, como Task, confirmar que `_notificar_transbordo` filtra corretamente por `modulo` antes de cadastrar a linha nova — exatamente o de-risk certo antes de tocar tabela compartilhada. |
