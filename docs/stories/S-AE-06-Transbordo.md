# S-AE-06 — Transbordo para Atendente Humano

## Status
Ready for Review

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
- [x] Detecção de intenção de humano no engine (reaproveitado o conjunto `_CONTAINS_HANDOVER` do `empregabilidade_engine.py` — `institucional_engine.py` não existe, ver Completion Notes da S-AE-04).
- [x] Confirmar que `_notificar_transbordo` filtra corretamente por `modulo` (de-risk acima) antes de cadastrar a linha nova — confirmado, e corrigido um achado relacionado (ver Completion Notes).
- [x] Tela de configuração (`/academia-enem/transbordo`, `ae_transbordo_config`) para cadastrar/editar/remover o(s) responsável(is) — a linha em `transbordo_humano` (`modulo='academia_enem'`) é criada pela própria tela, não por seed manual.
- [x] Notificação ao responsável — reaproveita `_notificar_transbordo` (histórico de conversa via template Meta, mesmo padrão dos outros módulos; não reimplementado).
- [x] `awaiting_human` em `conversas` + silêncio da IA.

## Dependências
Depende de **S-AE-00** (fundação), **S-AE-02** (serviço/canal), **S-AE-04** (entrada). Acionada por **S-AE-10**.

## Quality Gate
- Tipo: backend + config. Agentes: @qa. CodeRabbit: foco em `awaiting_human`, fallback de contato, e confirmação de que o filtro por `modulo` não vaza entre módulos.

## File List
- `worker/academia_enem_engine.py` — detecção de pedido de humano (`_quer_humano`, conjunto `_CONTAINS_HANDOVER`) + `acionar_transbordo()` (marca `awaiting_human`, chama `_notificar_transbordo`, reverte em falha) + wiring no início de `processar_mensagem_academia_enem` (prioridade sobre a máquina de estados).
- `worker/meta_adapter_inbound.py` — `MODULO_AUTOMACAO_MAP["academia_enem"] = "Academia Enem"` (achado, ver Completion Notes).
- `worker/tests/test_academia_enem_engine.py` — 11 testes novos (`_quer_humano` positivo/negativo, `acionar_transbordo` sucesso/falha, integração via `processar_mensagem_academia_enem`).
- `cuca-portal/src/app/api/academia-enem/transbordo/route.ts` (novo) — GET/POST/PATCH/DELETE, `checkAuth("ae_transbordo_config", ...)` + admin client, `modulo` sempre travado em `'academia_enem'`.
- `cuca-portal/src/app/(dashboard)/academia-enem/transbordo/page.tsx` (novo) — tela de cadastro/edição/ativação/remoção dos responsáveis.
- `cuca-portal/src/app/(dashboard)/configuracoes/perfis/page.tsx` — novo item de catálogo RBAC `ae_transbordo_config`.
- `cuca-portal/src/lib/constants.ts` — novo item de menu "Transbordo" em Academia Enem.

## Completion Notes
- **Achado (mesmo já documentado na S-AE-04): `worker/institucional_engine.py` não existe.** A story cita "reaproveitar mecânica de `institucional_engine.py`" — Institucional despacha pelo motor-agente (Edge Function), que decide handover no próprio servidor (`data.get("handover")`), não por palavra-chave em Python. O padrão real e aplicável é o de Empregabilidade (`_CONTAINS_HANDOVER`, keyword-based, em Python) — reaproveitado (mesmo conjunto de frases, adaptado com 2 adições explícitas da própria story: "não entendi"/"passa para [um] atendente").
- **Achado real (de-risk da própria story, Task 2): `_notificar_transbordo` filtra `modulo` corretamente** (`.eq("modulo", modulo)`, sem fallback cruzado) — mas o **lookup do template** (`meta_templates.automacoes`) usa `MODULO_AUTOMACAO_MAP.get(modulo, modulo)`, e esse mapa **não tinha entrada para `"academia_enem"`** — cairia no fallback (usaria o próprio `"academia_enem"`, snake_case, como tag de automação), enquanto o template já semeado pela S-AE-02 usa `"Academia Enem"` (capitalizado, mesmo padrão dos outros módulos). Sem a correção, a notificação nunca encontraria o template aprovado, mesmo com o contato cadastrado corretamente — falharia silenciosamente (log de warning, sem quebrar o fluxo, mas sem notificar ninguém). Corrigido com uma entrada nova no mapa.
- **AC3 (classificador aciona transbordo quando RAG não resolve) — seam pronto, não testável ainda de ponta a ponta.** Exponho `acionar_transbordo()` como função pública (sem `_`) exatamente para a S-AE-10 chamar quando o lead aceitar transferência — mas a condição "classificador não achou resposta" só existe quando a S-AE-10 (ainda no-op) for implementada. Comportamento honesto: a função funciona e está testada isoladamente; a ligação fim-a-fim de AC3 depende de uma story futura, como a própria story já antecipava na Task 4 (S-AE-06 "acionada pela S-AE-10").
- **AC5 (RBAC granular `ae_transbordo_config`) exigiu decisão de arquitetura não coberta pela story:** `transbordo_humano` tem RLS **hardcoded por nome de role** (`Developer`/`Super Admin Cuca` apenas — `20260417000000_fix_transbordo_rls_role_names.sql`), incompatível com "aprovar por perfil" via `has_permission`. Por isso **não** reaproveitei o componente compartilhado `<TransbordoSection moduloFixo>` (usado por Ouvidoria/Acesso CUCA, escreve direto do client) — construí uma tela e API dedicadas para a Academia Enem, seguindo o mesmo padrão já usado em `ae_leads_filtro`/`ae_leads_upload` (S-AE-13): `checkAuth()` via `has_permission` + `createAdminClient()` (service-role, bypassa a RLS hardcoded) para a escrita de fato. Nenhuma tabela nova, nenhuma mudança na RLS existente — só um caminho de escrita novo, específico da Academia Enem.
- Nenhuma migration de banco foi necessária: o catálogo RBAC (`configuracoes/perfis/page.tsx`) é a fonte da verdade das permissões disponíveis — `sys_permissions` é populado dinamicamente quando um admin marca a caixa e salva, não por seed. A linha em `transbordo_humano` (`modulo='academia_enem'`) é criada pela própria tela nova, não por migration manual.
- `pytest tests/test_academia_enem_engine.py` → 26/26. Suíte completa do worker (mesmas ressalvas de ambiente já documentadas na S-AE-04): 382 passed, 5 failed pré-existentes. `tsc --noEmit`/`eslint` nos arquivos tocados: sem erros novos (os 4 erros de `tsc` no projeto são pré-existentes, em arquivos de teste `.ts` não relacionados).
- Por instrução vigente do projeto (regra NON-NEGOTIABLE de não subir dev server/navegador sem autorização), a tela nova **não foi verificada visualmente no navegador** — verificação foi estática (leitura de código, `tsc`, `eslint`, comparação com telas AE equivalentes já existentes).

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-06-11 | @sm (River) | Criação da story (Draft) |
| 2026-06-14 | @po (Pax) | Cascata da decisão S-AE-02 (arquitetura anterior — tabela própria `ae_transbordo_contatos`) |
| 2026-08-20 | @sm (River) | **Reescrita completa (decisão do Junior, migração Meta direta):** abandona `ae_transbordo_contatos`; reaproveita `transbordo_humano` compartilhada com uma linha nova (`modulo='academia_enem'`), preservando responsável próprio da Academia Enem. Status resetado para Draft. |
| 2026-08-20 | @po (Pax) | **Validação (GO, 9/10) → Status Draft→Ready.** Boa prática: a story já inclui, como Task, confirmar que `_notificar_transbordo` filtra corretamente por `modulo` antes de cadastrar a linha nova — exatamente o de-risk certo antes de tocar tabela compartilhada. |
| 2026-08-20 | @dev (Dex) | **Implementação completa (Status Ready→Ready for Review).** Detecção de humano + `acionar_transbordo()` no engine; achado corrigido (`MODULO_AUTOMACAO_MAP` sem entrada para Academia Enem, template nunca seria encontrado); tela+API dedicadas para `ae_transbordo_config` (RLS hardcoded de `transbordo_humano` não suporta RBAC granular — decisão documentada). AC3 com seam pronto, integração fim-a-fim depende da S-AE-10 (futura). |
