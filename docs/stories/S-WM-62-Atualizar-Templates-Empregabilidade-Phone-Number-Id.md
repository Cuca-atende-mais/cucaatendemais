# S-WM-62 — Atualizar `phone_number_ids` dos templates de Empregabilidade

## Status
Aprovada com CONCERNS — liberada por Junior para prosseguir; Task 2 (teste real de envio) fica como validação pendente pós-aplicação

## Origem
Diagnóstico de transbordo (Empregabilidade + Institucional), sessão de 2026-07-31/08-01. Achado colateral ao investigar por que `_notificar_transbordo` poderia falhar mesmo depois de corrigido o trigger (S-WM-61): mesmo padrão de bug já resolvido hoje para o canal Institucional (ver histórico desta mesma sessão — `meta_phone_numbers`/`meta_templates` desatualizados após troca de número).

## Complexidade
S — migration de dado, mesmo padrão já validado 3x hoje para o Institucional.

## Prioridade
P1 — sem isso, `_notificar_transbordo` (usado por Empregabilidade) e os envios de convite de entrevista / feedback de empresa falham silenciosamente por não encontrar template aprovado para o `phone_number_id` certo, mesmo depois da S-WM-61 e S-WM-63/64 corrigidas.

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - SELECT phone_number_ids FROM meta_templates WHERE automacoes && ARRAY['Empregabilidade'] → todos devem ter '1222392144295329'
  - SELECT phone_number_id FROM meta_phone_numbers WHERE agente_tipo='Empregabilidade' AND ativo=true → confirmar que ainda é '1222392144295329' antes de aplicar (pode ter mudado de novo)
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** que os templates de WhatsApp da Empregabilidade apontem para o número realmente ativo hoje,
**para que** convites de entrevista, feedback de empresa e notificações de transbordo não falhem silenciosamente por template não encontrado.

## Contexto e Problema

Confirmado direto no banco (produção `cuca`): os 3 templates ativos de Empregabilidade apontam para `phone_number_ids=["1245704551949387"]`:

| Template | `phone_number_ids` atual | `waba_ids` atual |
|---|---|---|
| `empregabilidade_convite_entrevista_v1` | `["1245704551949387"]` | `["1524581392742603"]` |
| `empregabilidade_feedback_empresa_v1` | `["1245704551949387"]` | `["1524581392742603"]` |
| `empregabilidade_transbordo_v1` | `["1245704551949387"]` | `["1524581392742603"]` |

Mas o `phone_number_id` **realmente ativo hoje** em `meta_phone_numbers` (agente_tipo='Empregabilidade', ativo=true) é `1222392144295329` — confirmado por **tráfego real**: conversas de hoje (João Escórcio e Valmir, fluxo de cadastro de empresa) usam esse `origem_id` com sucesso, tanto no envio quanto no recebimento. A WABA (`1524581392742603`) **não mudou** — só o `phone_number_id` mudou, mesmo padrão do Institucional (onde só o número mudou, não a WABA — nesse caso confirmado por membership real via `GET /waba/phone_numbers`).

O worker resolve template por `.contains("phone_number_ids", [phone_number_id])` (`worker/campanhas_engine.py`, mesmo padrão usado no disparo mensal) — com o valor desatualizado, a busca não encontra nenhuma linha, e a ação (convite, feedback, notificação de transbordo) é abortada silenciosamente, sem erro visível pro usuário.

**Diferença importante em relação ao Institucional:** aqui **não há indicação de que a WABA tenha mudado** (só o número) — mas antes de aplicar, o Task 0 desta story deve reconfirmar que `1222392144295329` continua sendo o número ativo (o Institucional já trocou 2x nesta mesma sessão; vale checar de novo, não presumir que ficou estável).

## Escopo

### IN
1. Migration idempotente atualizando `phone_number_ids` dos 3 templates para `["1222392144295329"]`.
2. Reconfirmação (Task 0) de que esse é o `phone_number_id` ativo no momento da aplicação.

### OUT
- Não mexe em `waba_ids` (não há evidência de que tenha mudado).
- Não mexe em nenhum outro template (Institucional já resolvido nesta mesma sessão).
- Não cria nem edita templates na Meta — só atualiza a referência no nosso banco (diferente da S-WM-65, que precisa de ação humana no Business Manager).

## Acceptance Criteria

1. **Given** os 3 templates ativos de Empregabilidade, **when** consultados após a migration, **then** todos têm `phone_number_ids = ['1222392144295329']`.
2. **Given** um envio real de teste (convite de entrevista, feedback, ou transbordo), **when** disparado após a correção, **then** o worker encontra o template aprovado (sem log de "nenhum template aprovado").
3. Nenhum outro template é alterado.

## Tasks / Subtasks

- [x] **Task 0 — Reconfirmar phone_number_id ativo** (bloqueante)
  - [x] `SELECT phone_number_id FROM meta_phone_numbers WHERE agente_tipo='Empregabilidade' AND ativo=true` — reconfirmado `1222392144295329`, sem mudança desde o diagnóstico.
- [x] **Task 1 — Migration** (AC: 1)
  - [x] Aplicado via MCP em produção: `supabase/migrations/20260801003346_fix_meta_templates_empregabilidade_phone_number_id.sql`. Os 3 templates confirmados com `phone_number_ids=['1222392144295329']` após a aplicação.
- [ ] **Task 2 — Validar** (AC: 2)
  - [ ] **Pendente de confirmação do Junior:** teste real de envio (convite de entrevista, feedback de empresa, ou transbordo) confirmando que o worker encontra o template aprovado.
- [x] **Task 3 — Fechamento**
  - [x] File List, Change Log atualizados.

## Dev Notes

- Padrão idêntico ao usado hoje 3x para o Institucional nesta mesma sessão — ver migrations `20260731140551_fix_meta_templates_institucional_phone_number_id.sql` e `20260731150515_...` / `20260731150926_...` como referência de formato (comentário explicando a causa raiz, `UPDATE` chaveado por `nome`/`ativo`, idempotente).
- **Não presumir que o `phone_number_id` de Empregabilidade continua `1222392144295329`** — nesta mesma sessão o número do Institucional trocou 2 vezes em poucas horas. Task 0 é bloqueante por esse motivo.

### Testing
Sem teste automatizado aplicável (é migration de dado). Validação via query read-only + teste real de envio (coordenado com Junior).

## Dependências
Nenhuma bloqueante para aplicar a migration em si. Para validar de ponta a ponta (AC 2, especialmente pro caso de transbordo), depende da **S-WM-61** já aplicada.

## Git workflow
Sem branch de código — é migration de dado aplicada via MCP, versionada em `supabase/migrations/`. Sem push/PR necessário (mesmo padrão das correções de template já feitas hoje).

## Change Log

| Date | Version | Description | Author |
|---|---|---|---|
| 2026-08-01 | 0.1 | Story criada a partir do diagnóstico de transbordo — mesma classe de bug já corrigida hoje para o Institucional (3x, no canal já corrigido). | @sm River |
| 2026-08-01 | 0.2 | **Validado por @po — GO.** 10/10 no checklist: escopo mínimo e preciso (só `phone_number_ids`, sem mexer em `waba_ids`), risco de "número pode ter mudado de novo" já coberto por Task 0 bloqueante, AC testáveis, dependência com S-WM-61 explicitada (só para validação, não para aplicar a migration). Sem pergunta em aberto. Status Draft → Ready. | @po Pax |
| 2026-08-01 | 0.3 | **Implementado.** Task 0 reconfirmou `1222392144295329` como `phone_number_id` ativo (sem mudança). Migration `20260801003346_fix_meta_templates_empregabilidade_phone_number_id.sql` aplicada em produção via MCP — os 3 templates (`empregabilidade_convite_entrevista_v1`, `empregabilidade_feedback_empresa_v1`, `empregabilidade_transbordo_v1`) confirmados com `phone_number_ids=['1222392144295329']`. `waba_ids` não tocado, como previsto. Falta só a confirmação do Junior de um teste real de envio (Task 2). Status Ready → Ready for Review. | @dev Dex |
| 2026-08-01 | 0.4 | **Gate de QA: CONCERNS.** Migration e os 3 registros confirmados corretos no banco (item 1 e 2). Mas 2 lacunas de validação registradas, não bugs: (a) checagem cruzada via Graph API real (phone_number_id↔WABA + templates APPROVED nessa WABA especificamente) não foi feita — sem acesso a token nesta sessão; (b) Task 2 (teste real de envio) confirmada como não executada, por decisão do Junior de avançar mesmo assim. Sem essas 2 provas, não há confirmação de ponta a ponta — mesma lição da correção do Institucional hoje, onde o banco "parecia certo" 2x antes da API revelar o erro real. @devops não acionado, aguardando decisão do Junior. Status → InReview. | @qa Quinn |
| 2026-08-01 | 0.5 | **2ª passagem do gate — CONCERNS mantido, motivo mais estreito.** Metade do item 3 (os 3 templates aprovados na WABA `1524581392742603`) confirmada com evidência real de API (`GET /message_templates`, IDs reais da Meta registrados) — aceito sem ressalva. A outra metade (pareamento `phone_number_id`↔`waba_id`) foi apresentada só por **print** do Business Manager, não pela chamada `GET /{waba_id}/phone_numbers` que resolveu de fato o caso equivalente do Institucional hoje — sinalizado explicitamente que print não tem o mesmo peso de evidência, dado o precedente de hoje (o print do Institucional errou 2x). Task 2 (teste real de envio) continua sendo a lacuna decisiva, não substituível por nenhuma chamada de API. @devops não acionado. | @qa Quinn |
| 2026-08-01 | 0.6 | **3ª passagem do gate — item 3 100% fechado.** `GET /1524581392742603/phone_numbers` (API real, não print) confirmou `1222392144295329` com `platform_type=CLOUD_API`, `VERIFIED`, webhook apontando pro worker real — mesmo padrão de prova que fechou o caso do Institucional. As 3 frentes de checagem cruzada (membership, templates aprovados, coerência com o banco) estão fechadas. **CONCERNS mantido** por avaliação técnica própria, não por falta de confiança na correção: configuração 100% confirmada elimina o risco estrutural, mas não substitui a prova de entrega ponta a ponta que só a Task 2 (teste real de envio) traz — mesma régua que Junior estabeleceu hoje ("sem certeza absoluta, CONCERNS antes de PASS"). Único item pendente agora: Task 2. @devops não acionado. | @qa Quinn |
| 2026-08-01 | 0.7 | **Liberado por Junior para prosseguir com CONCERNS** (decisão explícita, ciente da Task 2 pendente). @devops confirmou por conta própria: os 3 templates em produção já refletem a correção (nada pendente de aplicar); migration local (`supabase/migrations/20260801003346_...sql`) presente e não rastreada no git, mesmo padrão das demais correções de template de dado puro desta sessão (nenhuma delas passou por commit/PR — só a S-WM-61, que mexeu em função/trigger, teve branch e PR próprios). Sem código de worker/portal alterado — nenhum redeploy necessário no EasyPanel. Task 2 (teste real de envio) registrada como validação pendente pós-aplicação, a ser confirmada quando o Junior rodar o teste. | @devops Gage |

## Dev Agent Record

### Agent Model Used
Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References
- Task 0: `SELECT phone_number_id, waba_id, ativo, updated_at FROM meta_phone_numbers WHERE agente_tipo='Empregabilidade' AND ativo=true` → `1222392144295329` / `1524581392742603` / `true` — confirmado antes de aplicar.
- Estado anterior dos 3 templates confirmado via query direta antes da migration: todos com `phone_number_ids=["1245704551949387"]`, `waba_ids=["1524581392742603"]`, `status='aprovado'`, `ativo=true`.
- Migration aplicada via `mcp__supabase__apply_migration` (produção `cuca`/`svzkrkfzpiqcesloukgb`), nome `fix_meta_templates_empregabilidade_phone_number_id`, versão `20260801003346` — confirmada em `supabase_migrations.schema_migrations`.
- Pós-aplicação, reconferido: os 3 templates com `phone_number_ids=['1222392144295329']`, `waba_ids` inalterado (`['1524581392742603']`), `status`/`ativo` inalterados.

### Completion Notes List
- Escopo seguido exatamente como especificado: só `phone_number_ids`, `waba_ids` intocado (sem evidência de ter mudado, diferente do caso Institucional).
- Nenhum outro template foi alterado.
- Não foi criada branch de código nem PR, conforme já definido no Git workflow desta story (migration de dado, mesmo padrão das correções de template do Institucional feitas nesta sessão, que também não passaram por PR).
- **Falta uma confirmação humana**: pedir ao Junior um teste real de envio (convite de entrevista, feedback de empresa, ou transbordo) pra confirmar que o worker agora encontra o template aprovado.

### File List
- `supabase/migrations/20260801003346_fix_meta_templates_empregabilidade_phone_number_id.sql` (novo, aplicado em produção)

## QA Results

### Review Date: 2026-08-01

### Reviewed By: @qa Quinn

### Gate Decision: **CONCERNS**

### O que foi confirmado (itens 1 e 2)

- **Migration**: `list_migrations` confirma `fix_meta_templates_empregabilidade_phone_number_id` (versão `20260801003346`) como a mais recente aplicada — bate com o relatado pelo @dev.
- **Os 3 registros em `meta_templates`**: conferidos campo a campo. `phone_number_ids=['1222392144295329']` nos 3 (`empregabilidade_convite_entrevista_v1`, `empregabilidade_feedback_empresa_v1`, `empregabilidade_transbordo_v1`). `waba_ids` permanece `['1524581392742603']`, inalterado. `status='aprovado'`, `ativo=true`, `automacoes`, `variaveis` e `corpo_texto` de cada um — todos intactos, nada além do campo pretendido foi tocado.

### O que NÃO foi confirmado (itens 3 e Task 2) — lacunas de validação, não bugs

**Item 3 — checagem cruzada via Graph API real:** não fiz essa checagem. Não tenho acesso ao token da Meta nesta sessão (mesma limitação já registrada em gates anteriores hoje). Não consigo confirmar, de forma independente, que:
- o `phone_number_id` `1222392144295329` realmente pertence à WABA `1524581392742603` (via `GET /1524581392742603/phone_numbers`, checando membership real — não só o que está escrito no nosso banco);
- os 3 templates estão de fato `APPROVED` **nessa WABA especificamente** (via `GET /1524581392742603/message_templates?name=...`).

Isso é exatamente o mesmo tipo de risco que já vimos hoje na correção do Institucional — lá, o banco "parecia certo" duas vezes seguidas e só a chamada real à API revelou o erro de WABA. Aqui, a evidência que temos é: (a) o `phone_number_id` está confirmado como ativo por **tráfego real** (conversas de Empregabilidade trocando mensagem com sucesso usando esse `origem_id`); mas (b) o pareamento `phone_number_id` ↔ `waba_id` específico, e a aprovação dos 3 templates nessa WABA, **nunca foram confirmados via API** — só herdados do que já estava no banco desde antes desta sessão. Diferente do Institucional, aqui não há alerta concreto de que algo mudou, mas também não há prova positiva.

**Task 2 (teste real de envio):** confirmado que não foi executada, conforme já sinalizado pelo Junior antes do gate. Sem isso, não há prova de ponta a ponta de que `_notificar_transbordo`/os fluxos de convite e feedback realmente encontram e enviam o template.

### Por que CONCERNS, não PASS

Seguindo o padrão já estabelecido hoje (preferir CONCERNS a PASS quando não há certeza plena): a correção no banco está tecnicamente correta e bem escopada, mas faltam **2 provas independentes** de que ela funciona de ponta a ponta — a checagem cruzada via API (item 3) e o teste real de envio (Task 2). Nenhuma das duas é um defeito encontrado; são lacunas de validação que ficam registradas, não escondidas.

### Recomendação

Antes de considerar esta story fechada de verdade:
1. Alguém com acesso ao token da Meta rodar `GET /1524581392742603/phone_numbers` (confirmar `1222392144295329` na lista) e `GET /1524581392742603/message_templates?name=<cada um dos 3>` (confirmar `APPROVED`).
2. Um teste real de envio (Task 2) em pelo menos 1 dos 3 fluxos.

@devops **não acionado** — aguardando decisão do Junior, conforme solicitado.

---

### Atualização — 2026-08-01 (2ª passagem)

**Metade do item 3 resolvida, com evidência real de API — aceito sem ressalva:**

`GET /1524581392742603/message_templates` — chamada real à Graph API (não print), confirmando os 3 templates `APPROVED` nessa WABA, com IDs reais da Meta:

| Template | ID real Meta | Status |
|---|---|---|
| `empregabilidade_convite_entrevista_v1` | 27996162699981413 | APPROVED |
| `empregabilidade_feedback_empresa_v1` | 1756327212034250 | APPROVED |
| `empregabilidade_transbordo_v1` | 1750611299433971 | APPROVED |

Mesmo padrão de rigor que usamos hoje pro Institucional — **este ponto está fechado**.

**A outra metade do item 3 — pareamento `phone_number_id` ↔ `waba_id` — NÃO está no mesmo nível de confiança, e preciso registrar isso com clareza:**

A confirmação apresentada foi um **print do Business Manager** ("Rede Cuca - Empregabilidade", +55 85 9940-1057, status Conectado), não uma chamada `GET /1524581392742603/phone_numbers`. Print de tela é **exatamente o tipo de evidência que já se provou insuficiente hoje**, duas vezes, no caso do Institucional — só a chamada de membership real (`GET /{waba_id}/phone_numbers`, conferindo `platform_type=CLOUD_API` e o `id` na lista) resolveu de fato lá, depois de o print ter indicado um WABA errado por 2 rodadas seguidas.

Isso importa tecnicamente, não é formalismo: quando o worker manda `POST /{phone_number_id}/messages` com o nome do template, a Meta valida o template contra a WABA **real** dona daquele `phone_number_id` — não contra o que está escrito no nosso banco nem no que aparece num print. Se o pareamento real for outro (mesmo que hoje pareça consistente), o envio falharia com o mesmo erro `#132001` de antes, mesmo com os templates corretamente aprovados numa WABA — só que na WABA errada relativa a esse número.

**Reclassificando o item 3:**
- ✅ Templates aprovados na WABA declarada — confirmado via API real.
- ⚠️ `phone_number_id` pertence de fato a essa WABA — confirmado só por print, **não** pela chamada de membership equivalente à que fechou o caso do Institucional. Fica como ponto de atenção, não bloqueante isoladamente (o tráfego real já indica o número ativo, e a aprovação dos templates na WABA declarada é um indício indireto a favor), mas não tem o mesmo nível de certeza que aplicamos ao canal Institucional hoje.

### Gate Decision (atualizado): **CONCERNS** (mantido, motivo mais estreito agora)

Não é mais "faltam 2 verificações completas" — é: (a) o pareamento phone↔WABA segue confirmado só por print, não por API de membership (risco baixo mas não zero, dado o precedente de hoje); (b) **Task 2 (teste real de envio) continua não executada** — essa é a lacuna que realmente decide se o fluxo funciona de ponta a ponta, e nenhuma chamada de API substitui isso.

@devops **não acionado** — aguardando decisão do Junior sobre rodar a Task 2 (e, se quiser fechar 100%, a chamada de membership real) antes de prosseguir.

---

### Atualização — 2026-08-01 (3ª passagem, checagem de membership real)

**Item que faltava resolvido, com o mesmo padrão de força de prova do Institucional:**

`GET /1524581392742603/phone_numbers` (chamada real à Graph API, não print) retornou `1222392144295329` com `platform_type=CLOUD_API`, `VERIFIED`, e `webhook_configuration.application` apontando pro nosso worker real (`cuca-cuca-worker.wte0ij.easypanel.host/webhook/meta`) — exatamente a mesma combinação de sinais (`platform_type`, apontamento de webhook pro worker real) que resolveu o caso do Institucional hoje. **Aceito sem ressalva — este é o padrão correto de verificação, não um print.**

**Item 3 agora está 100% fechado, nas 3 frentes:**
1. ✅ `phone_number_id` pertence à WABA declarada — confirmado por `GET /phone_numbers` real.
2. ✅ Os 3 templates estão `APPROVED` nessa WABA — confirmado por `GET /message_templates` real.
3. ✅ Os 3 registros em `meta_templates`/`meta_phone_numbers` batem com essa realidade — confirmado direto no banco (item 2, 1ª passagem).

### Avaliação técnica sobre o veredito

Junior pediu minha avaliação, então vou ser direto: **mantenho CONCERNS, não subo para PASS ainda** — e explico o porquê, não é cautela por cautela.

Toda a parte de **configuração** (qual número, qual WABA, quais templates, todos aprovados e coerentes entre si) está agora confirmada com o nível de rigor mais alto que aplicamos hoje em qualquer story. Isso fecha o risco estrutural (o mesmo tipo de erro que travou o Institucional 2 vezes) — esse risco específico não existe mais aqui.

Mas configuração correta não é a mesma coisa que **entrega de ponta a ponta confirmada**. A Task 2 (teste real de envio) verifica uma camada que nenhuma chamada de API cobre: se o worker monta corretamente os parâmetros do template (`_montar_parametros_named`), se o envio respeita `daily_limit`/`messaging_limit_tier`, se a notificação de transbordo realmente dispara e chega no telefone certo em produção — nada disso é garantido só por template aprovado + número certo. É exatamente a mesma régua que Junior estabeleceu explicitamente hoje ("se não conseguir confirmar com certeza absoluta, prefira CONCERNS a PASS") — e "certeza absoluta de entrega" é justamente o que só um envio real prova.

**Resumindo:** isso está tecnicamente pronto para o teste real acontecer — não há mais nenhum bloqueio de configuração conhecido. CONCERNS aqui significa "aprovado condicionalmente, uma prova de fogo real away de PASS pleno", não "ainda hesitante sobre a correção em si".

### Gate Decision (final desta rodada): **CONCERNS**

Único item pendente: **Task 2 — teste real de envio** (convite de entrevista, feedback de empresa, ou transbordo). Assim que isso for feito e confirmado, o veredito natural seria PASS.

@devops **não acionado** — aguardando decisão do Junior sobre rodar a Task 2.
