# S-WM-16 — CRUD completo e seguro de Números e Templates Meta (Developer Console)

## Status
Ready for Review

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - diff de meta-templates/[id]/page.tsx: readOnly do campo nome passa a ser condicional (template.status === 'aprovado' && template.ativo), Input controlado (value+onChange), nome incluído no body de handleSave
  - guard de segurança visível e funcional na UI ao tentar renomear "cuca_programacao_mensal" ou "cuca_transbordo_colaborador" (Task 1) — OU ausência do guard justificada por Task 2 já ter eliminado o hardcode correspondente
  - grep -n "cuca_programacao_mensal\|cuca_transbordo_colaborador" worker/campanhas_engine.py worker/meta_adapter_inbound.py → zero ocorrências como valor literal de nome de template (lookup deve ser 100% via automacoes/módulo, não nome fixo)
  - diff de meta-phone-numbers/[id]/route.ts: CAMPOS_PERMITIDOS inclui phone_number_id e waba_id, com validação de formato (regex numérico 15-17 dígitos) antes do update, erro 400 claro se inválido
  - diff de meta-numeros/page.tsx: readOnly removido de phone_number_id e waba_id, inputs controlados, modal de confirmação explícita antes de salvar mudança desses 2 campos
  - rota DELETE em meta-phone-numbers/[id]/route.ts (soft delete via ativo=false, mesmo padrão de meta-templates/[id]/route.ts:92-120) — verificar via mcp supabase execute_sql (cuca-dev) que um registro de teste vira ativo=false sem perder a linha
  - pytest da suíte do worker (worker/tests/) sem regressão após Task 2 — rodar test_meta_adapter_inbound.py e qualquer teste de campanhas_engine.py explicitamente
  - smoke test manual (Task 5): editar phone_number_id de um registro existente no cuca-dev → mcp supabase get_logs confirma que a próxima mensagem simulada naquele número usa a config nova sem restart do worker
```

## Story

**Como** Junior (responsável pelo CUCA),
**quero** poder editar o nome de um template Meta e o `phone_number_id`/`waba_id` de um número Meta cadastrado diretamente pelo Developer Console, com as travas de segurança certas no lugar,
**para que** eu consiga trocar números de teste por números oficiais da Rede CUCA (estimativa de 8+ trocas ao longo da migração) e corrigir nomes de templates sem precisar recriar registros ou pedir intervenção manual no banco.

## Contexto e Problema

Investigação read-only do @dev (turno anterior desta sessão) mapeou exatamente onde estão as travas nas duas telas:

1. **Template "nome"** (`/developer/meta-templates/[id]`): trava é **só de UI** — `readOnly` incondicional em `meta-templates/[id]/page.tsx:227`. O backend (`CAMPOS_EDITAVEIS` em `api/admin/meta-templates/[id]/route.ts:19-23`) **já aceita** `nome` no PATCH. Isso significa que hoje já é possível renomear um template via chamada direta à API, sem qualquer aviso — a UI é a única barreira, e ela bloqueia até quem tem motivo legítimo.
2. **Risco real de renomear:** dois nomes de template estão **hardcoded como string literal** no worker, usados como chave de lookup:
   - `worker/campanhas_engine.py:447-448` — `.eq("nome", "cuca_programacao_mensal")`
   - `worker/meta_adapter_inbound.py:347-355` — fallback `.eq("nome", "cuca_transbordo_colaborador")`

   Renomear esses 2 templates pela tela hoje (via API direta) quebraria os fluxos de Divulgação mensal e de notificação de transbordo **silenciosamente** — sem erro visível, só falha de lookup (`tpl_res.data` vazio, `logger.warning` e o disparo é pulado).
3. **Número Meta** (`/developer/meta-numeros`): `phone_number_id` e `waba_id` têm **dupla trava** — `readOnly` na UI (`page.tsx:218-221` e `270-273`) **e** ausência em `CAMPOS_PERMITIDOS` do backend (`meta-phone-numbers/[id]/route.ts:19`). Diferente do template, aqui a trava é intencional e reforçada nas duas camadas.
4. `phone_number_id` é a **PRIMARY KEY** de `meta_phone_numbers` (`cuca-portal/supabase/migrations/20260625000000_create_meta_phone_numbers.sql:12`) — confirmado que **não há foreign key** apontando para essa coluna em nenhuma outra tabela (`grep` por `REFERENCES meta_phone_numbers` não retornou nada), então tecnicamente é seguro fazer `UPDATE` na PK. O único acoplamento indireto é `meta_templates.phone_number_ids` (array `text[]`, sem FK) — se um `phone_number_id` for trocado, templates que referenciavam o valor antigo nesse array ficam com uma entrada órfã (string que não bate com nenhum registro).
5. Não existe rota `DELETE` para `meta_phone_numbers` hoje.
6. O `POST` de criação (`meta-phone-numbers/route.ts:38-64`) só valida presença de campos e duplicidade — nenhuma validação de formato ou de existência real do número/WABA na Meta.

Esta story materializa o plano definido por Junior em cima desse levantamento — 5 tasks, sendo a Task 4 opcional/sujeita a avaliação de custo-benefício com @po antes de entrar em execução.

## Escopo

### IN

**Task 1 — Liberar edição segura de "nome" de template:**
- Trocar `readOnly` incondicional (`meta-templates/[id]/page.tsx:227`) por `readOnly={template.status === 'aprovado' && template.ativo}` — mesma lógica condicional já usada para outros campos sensíveis da tela.
- Tornar o `Input` controlado (`value` + `onChange`, estado próprio) e incluir `nome` no `body` de `handleSave` (`page.tsx:158-167`).
- Guard específico: se o nome atual for `"cuca_programacao_mensal"` ou `"cuca_transbordo_colaborador"`, exibir aviso claro antes de permitir salvar — "Este nome está fixo no código do worker. Alterá-lo quebra [nome da automação] até o código ser atualizado." — com confirmação dupla (checkbox ou modal), não deixar salvar direto no primeiro clique.
- Validação de unicidade no frontend antes do submit (checar contra a lista de templates já carregada, ou tratar o erro 500 do índice único `meta_templates_nome_unique` com uma mensagem amigável em vez de expor o erro cru do Postgres).

**Task 2 — Remover hardcode de nome no worker (elimina o risco da Task 1 pela raiz):**
- `worker/campanhas_engine.py:447-448` — trocar `.eq("nome", "cuca_programacao_mensal")` por lookup dinâmico por automação, no mesmo padrão já usado em `worker/meta_adapter_inbound.py:348` (`.contains("automacoes", [modulo])`).
- `worker/meta_adapter_inbound.py:347-355` — mesmo tratamento para o fallback de `"cuca_transbordo_colaborador"`.
- Após esta task, o guard da Task 1 pode ser removido (não é mais necessário) — ou mantido como segurança extra, a critério do @dev na implementação.
- **Cuidado:** os templates seed (`supabase/migrations/20260629000002_wm13_meta_templates.sql:41-91`) já têm `automacoes` preenchido para ambos (`cuca_programacao_mensal` → `['Institucional']`; `cuca_transbordo_colaborador` → `['Empregabilidade','Institucional','Programação','Ouvidoria']`) — confirmar que o filtro por automação não retorna múltiplos templates ativos/aprovados para o mesmo módulo antes de trocar o `.eq("nome", ...)` por `.contains(...)`; se houver ambiguidade, manter critério de desempate explícito (ex.: mais recente, ou `limit(1)` já usado hoje).

**Task 3 — CRUD completo e seguro de Número Meta (`phone_number_id` + `waba_id` editáveis):**
- Backend: adicionar `phone_number_id` e `waba_id` a `CAMPOS_PERMITIDOS` em `meta-phone-numbers/[id]/route.ts:19`.
- Validação obrigatória no backend antes de salvar: `phone_number_id` deve ser numérico, 15-17 dígitos (formato real da Meta); rejeitar formato inválido com erro claro (400, mensagem específica — não deixar o Postgres rejeitar cru).
- Frontend: remover `readOnly` de `phone_number_id` (`page.tsx:218-221`) e `waba_id` (`page.tsx:270-273`); tornar os `<code>` estáticos em inputs controlados dentro do modo de edição já existente na linha da tabela.
- Confirmação explícita (modal — "Tem certeza? Isso muda para qual número as mensagens desta automação serão enviadas/recebidas.") antes de salvar mudança de `phone_number_id` ou `waba_id` — fricção deliberada, diferente da edição simples de `display_name`/`agente_tipo`/`canal_tipo`/`ativo` que já existe.
- Rota `DELETE` (soft delete via `ativo=false`), mesmo padrão já usado em `meta_templates` (`api/admin/meta-templates/[id]/route.ts:92-120`) — permite descontinuar um registro de teste sem perder histórico.
- Nota de escopo: como `phone_number_id` é a PK, a implementação do `PATCH` precisa atualizar a linha pelo identificador **antigo** (parâmetro de rota) e gravar o **novo** valor no `update()` — confirmar que o Supabase client aceita update de coluna PK sem erro (teste direto antes de fechar a task).

**Task 4 — Validação cruzada com a API real da Meta (opcional — avaliar com @po antes de implementar):**
- Ao salvar um novo `phone_number_id`, fazer uma chamada de teste à Graph API (`GET /{phone_number_id}`) usando o `META_SYSTEM_USER_TOKEN` configurado, para confirmar que o número existe e o token tem permissão sobre ele, antes de persistir.
- Se a chamada falhar, mostrar erro específico (número não existe / token sem permissão) em vez de salvar às cegas.
- **Gate antes de codar:** confirmar com @po se o custo (chamada de rede síncrona no fluxo de salvar, dependência de token configurado em staging, tratamento de timeout/erro de rede da própria Meta) compensa o benefício, ou se vira story separada. Não iniciar implementação desta task sem essa validação — só a Task 4 está condicionada a isso; Tasks 1-3 e 5 seguem normalmente.

**Task 5 — Auditoria de consistência frontend↔backend↔banco↔worker:**
- Confirmar que toda mudança feita nas telas `/developer/meta-numeros` e `/developer/meta-templates` reflete imediatamente no comportamento do worker, sem necessidade de redeploy — princípio já estabelecido em S-WM-13/S-WM-14, esta task é validação, não implementação nova.
- Testar cenário completo: editar `phone_number_id` de um registro existente (cuca-dev) → confirmar via `mcp supabase get_logs` que a próxima mensagem simulada naquele número já usa a config nova, sem restart do worker.

### OUT
- Qualquer mudança em `agente_tipo`/`canal_tipo`/`display_name`/`unidade_cuca`/`ativo` de `meta_phone_numbers` — já editáveis hoje, fora de escopo.
- Qualquer mudança no fluxo de `corpo_texto`/variáveis/automações/status de template — já entregue em S-WM-13/S-WM-14, fora de escopo.
- Implementação da Task 4 sem validação prévia de custo-benefício com @po (ver gate na própria task).
- Aplicação de qualquer alteração em produção — todo o desenvolvimento e validação desta story ocorrem no cuca-dev/staging (`.claude/rules/cuca-deploy-environments.md`).

## Critérios de Aceite

> **Nota de reconciliação (@po, 2026-07-03):** a Task 2 foi redesenhada pelo Junior no meio da execução — de "manter nomes hardcoded no worker + guard de aviso na UI" para um **modelo 100% relacional** (template vinculado a automação + `phone_number_id`, nunca por string de nome). Os ACs 2, 3, 9 e 10 abaixo foram reescritos para refletir o comportamento final efetivamente implementado e validado por @qa (verdict CONCERNS, 2026-07-03) — o texto original descrevia um design intermediário que não chegou a ir para produção. ACs 1, 4-8 permanecem como escritos originalmente; continuam válidos e verificados.

1. **Given** um template qualquer, **when** o developer abre `/developer/meta-templates/[id]` ou o modal de criação, **then** o campo nome está **sempre** editável em texto livre.
2. **Given** o modelo relacional final substitui o readOnly condicional do design original, **when** o developer abre a tela de edição de qualquer template (independente de `status`/`ativo`), **then** o campo nome nunca fica `readOnly` — a proteção antes oferecida pelo readOnly condicional deixou de ser necessária porque nenhum lookup do worker depende mais de `nome` (ver AC3).
3. **Given** o modelo relacional (automação + `phone_number_id`, com uma 2ª tag de desambiguação quando necessário — ex. `"Transbordo"`, `"Pontual"`, `"Convite"` — para templates que compartilham automação e número), **when** o developer salva um template (criar ou editar), **then** `automacoes`, `phone_number_ids` e `waba_ids` são derivados automaticamente do número Meta escolhido no dropdown (nunca digitados à mão), e o salvamento é bloqueado com mensagem clara se nenhum número estiver selecionado. Não existe mais guard de renomeação — os antigos `cuca_programacao_mensal`/`cuca_transbordo_colaborador` foram migrados para nomes reais aprovados na Meta e removidos do banco.
4. **Given** a Task 2 foi concluída, **when** `grep -rn '\.eq("nome", "cuca_' worker/ cuca-portal/src/app/api/` é executado, **then** nenhuma ocorrência resta como valor literal de comparação de `nome` em nenhum ponto de lookup — nem os 2 pontos originalmente identificados (`campanhas_engine.py`, `meta_adapter_inbound.py`) nem o 3º ponto adicional achado durante a implementação (`feedback-submit/route.ts`).
5. **Given** um `phone_number_id` inválido (não numérico, ou fora de 15-17 dígitos) é enviado ao `PATCH /api/admin/meta-phone-numbers/{id}`, **when** a rota processa, **then** retorna 400 com mensagem clara, sem tocar o banco.
6. **Given** um `phone_number_id`/`waba_id` válido é enviado, **when** o developer confirma no modal de confirmação explícita, **then** o registro é atualizado e a UI reflete o novo valor sem reload manual.
7. **Given** um registro de `meta_phone_numbers`, **when** o developer aciona a exclusão (soft delete), **then** `ativo` vira `false` e a linha permanece no banco (histórico preservado) — mesmo padrão de `meta_templates`.
8. **Given** a suíte `pytest` do worker, **when** executada após a Task 2, **then** passa sem regressão (`worker/tests/test_meta_adapter_inbound.py` e qualquer teste cobrindo `campanhas_engine.py` explicitamente verificados).
9. **Given** um `phone_number_id` de um registro existente é editado no cuca-dev, **when** uma mensagem de teste é simulada para o número novo, **then** o worker confirma, via `get_logs`, (a) que usa a configuração de canal atualizada **e** (b) que seleciona o template correto pelo lookup relacional automação+`phone_number_id` — sem restart do worker. **Execução:** validação manual de Junior, pós-merge, com número de teste real. Não bloqueia o status "Ready for Review"/code-complete desta story (@qa já validou a disambiguação das 4 queries relacionais diretamente no cuca-dev via SQL), mas é pré-requisito para o status **Done**.
10. **Given** a Task 4 (opcional) permanece fora do escopo de execução desta story, **when** @po avaliar o custo-benefício em momento futuro, **then** a decisão (implementar nesta story / virar story separada / descartar) fica registrada no Change Log desta story (ou da story sucessora, se virar story separada) antes de qualquer código da Task 4 ser escrito. **Status atual:** Task 4 não iniciada — este AC não bloqueia o fechamento das Tasks 1, 2, 3 e 5, nem o status "Ready for Review" desta story.

## Dependências
- Investigação read-only do @dev nesta sessão (turno anterior) — usada como base dos achados acima, não precisa ser refeita.
- S-WM-13 (`meta_templates` — tabela, RLS, seed) e S-WM-14 (`corpo_texto` editável) — já entregues, esta story estende a mesma tela.
- S-WM-03 (`meta_phone_numbers` — tabela, PK `phone_number_id`) — já entregue.
- `.claude/rules/cuca-deploy-environments.md` — todo desenvolvimento/validação no cuca-dev, nunca produção.

## Riscos
- **Renomear template hardcoded sem a Task 2 aplicada primeiro:** se a Task 1 for entregue e usada em produção antes da Task 2, o guard de aviso é a única proteção — não é bloqueio técnico, só fricção de UI. Recomenda-se implementar/mergear as duas tasks juntas quando possível, ou pelo menos não remover o guard antes de confirmar que a Task 2 está em produção.
- **Ambiguidade no lookup por automação (Task 2):** trocar `.eq("nome", ...)` por `.contains("automacoes", [modulo])` pode retornar mais de um template se houver múltiplos templates ativos/aprovados para a mesma automação no futuro — o comportamento de desempate (qual template usar) precisa ficar explícito no código, não implícito na ordem de retorno do banco.
- **`meta_templates.phone_number_ids` órfão:** ao trocar o `phone_number_id` de um número (Task 3), qualquer template que referenciava o valor antigo nesse array fica com uma entrada que não bate com nenhum registro — não é erro técnico (não há FK), mas é inconsistência de dados. Fora do escopo desta story corrigir automaticamente; documentar como nota operacional (ex.: no aviso do modal de confirmação, lembrar de revisar templates associados).
- **Task 4 depende de infraestrutura externa:** `META_SYSTEM_USER_TOKEN` precisa estar configurado e válido no ambiente onde a validação roda; se não estiver, a task fica bloqueada até isso ser resolvido — não é motivo para bloquear Tasks 1-3 e 5, que são independentes.
- **DELETE mal-entendido como hard delete:** nomear o botão/endpoint de forma que fique claro que é soft delete (`ativo=false`), evitando expectativa de remoção real da linha.

## Estimativa
**M** (Tasks 1, 2, 3 e 5) — Task 4 fora da estimativa, sujeita a avaliação de custo-benefício com @po (pode virar story separada).

## Dev Notes

### Padrão de lookup dinâmico já correto (referência para a Task 2)
`worker/meta_adapter_inbound.py:347-350`:
```python
tpl_res = sb.table("meta_templates").select("nome, corpo_texto") \
    .contains("automacoes", [modulo]) \
    .eq("ativo", True).eq("status", "aprovado") \
    .limit(1).maybe_single().execute()
```
Este é o molde a replicar em `campanhas_engine.py:447-448` (Divulgação mensal) e no fallback hardcoded de `meta_adapter_inbound.py:352-355` (transbordo). Trocar o `.eq("nome", "...")` fixo por `.contains("automacoes", [modulo_correspondente])`, mantendo `.eq("ativo", True).eq("status", "aprovado").limit(1)`.

### Padrão de soft delete já existente (referência para a Task 3)
`cuca-portal/src/app/api/admin/meta-templates/[id]/route.ts:92-120` — `DELETE` faz `.update({ ativo: false })` e retorna `{ ok: true, desativado: data.nome }`. Replicar a mesma estrutura para `meta-phone-numbers/[id]/route.ts`, adaptando o campo de retorno (`display_name` em vez de `nome`).

### Padrão de CAMPOS_PERMITIDOS/CAMPOS_EDITAVEIS (referência para a Task 3)
`meta-phone-numbers/[id]/route.ts:19`:
```ts
const CAMPOS_PERMITIDOS = ["agente_tipo", "canal_tipo", "ativo", "display_name", "unidade_cuca"] as const
```
Task 3 adiciona `"phone_number_id"` e `"waba_id"` a este array — mas, diferente dos demais campos, esses dois precisam de validação de formato **antes** do loop que monta o `update` (não deixar passar direto como os outros campos passam).

### Schema de `meta_phone_numbers`
`cuca-portal/supabase/migrations/20260625000000_create_meta_phone_numbers.sql:2-13` — `phone_number_id varchar NOT NULL` é a **PRIMARY KEY**. Sem FK de nenhuma outra tabela apontando para ela (confirmado por grep nesta investigação). RLS: `service_role` tem acesso total, `authenticated` só leitura (linhas 15-23) — as rotas admin usam `createAdminClient()` (service_role), então não são afetadas por RLS, mas vale confirmar que isso continua válido após a Task 3.

### Testing
- Worker: `worker/tests/` usa pytest — rodar a suíte completa após a Task 2, com atenção especial a `test_meta_adapter_inbound.py` (cobre o fallback que está sendo alterado).
- Frontend: sem suíte de testes automatizados nas telas do Developer Console hoje (confirmado por ausência de arquivos `*.test.tsx` nos diretórios de `meta-templates`/`meta-numeros` durante a investigação) — validação é manual via smoke test (Task 5) + revisão de código no QA gate.
- Não introduzir suíte de testes de frontend nova nesta story — fora de escopo, seguir o padrão atual do projeto (validação manual + QA gate).

## Dev Agent Record

### Agent Model Used
Claude Sonnet 5 (claude-sonnet-5)

### Debug Log References

#### Task 1 — Nome de template editável com guard (2026-07-03)

Implementado conforme especificado: `readOnly` do campo nome agora é `template.status === 'aprovado' && template.ativo`; input controlado com estado próprio (`nome`/`nomeOriginal`); `nome` incluído no body de `handleSave`. Guard de segurança implementado como aviso inline (não modal) + checkbox de confirmação dupla, com o botão "Salvar template" desabilitado enquanto a checkbox não é marcada — cobre os dois nomes hardcoded (`cuca_programacao_mensal`, `cuca_transbordo_colaborador`) via um mapa `NOMES_HARDCODED_WORKER` que também nomeia a automação afetada no próprio aviso. Validação de unicidade no frontend: a tela agora busca a lista completa de templates (`GET /api/admin/meta-templates`) no `load()` e compara o nome digitado contra os nomes dos outros templates antes do submit. Adicionalmente, reforcei o backend (`PATCH /api/admin/meta-templates/[id]/route.ts`) com uma checagem explícita de duplicidade antes do `update()` (mesmo padrão já usado no `POST` da mesma feature) — devolve 409 com mensagem amigável em vez de deixar o índice único do Postgres estourar como 500 cru.

#### Task 2 — BLOQUEADA (2026-07-03): ambiguidade real confirmada nos dois pontos, não apenas hipotética

Antes de tocar o worker, consultei o estado **real** de `meta_templates` no cuca-dev via `execute_sql` (não confiei só no seed da migration, que está desatualizado — os dados já foram editados via Developer Console desde S-WM-13/14):

```
cuca_evento_pontual         | UTILITY | aprovado | ativo | automacoes=["Programação Pontual","Divulgação"]
cuca_evento_pontual_admin   | UTILITY | aprovado | ativo | automacoes=["Institucional"]
cuca_feedback_vaga          | UTILITY | aprovado | ativo | automacoes=["Empregabilidade"]
cuca_pesquisa_ouvidoria     | UTILITY | aprovado | ativo | automacoes=["Ouvidoria"]
cuca_programacao_mensal     | MARKETING | aprovado | ativo | automacoes=["Divulgação"]
cuca_transbordo_colaborador | UTILITY | aprovado | ativo | automacoes=["Empregabilidade","Institucional","Ouvidoria","Acesso CUCA"]
```

**Bloqueio 1 — `campanhas_engine.py:447-448` (Divulgação mensal):** trocar `.eq("nome", "cuca_programacao_mensal")` por `.contains("automacoes", ["Divulgação"])` é ambíguo — **`cuca_evento_pontual` também tem `"Divulgação"` em `automacoes`**. Sem `ORDER BY`, `.limit(1)` retorna uma linha arbitrária; a Divulgação mensal correria o risco real de disparar o corpo de texto do template de evento pontual (ou vice-versa), silenciosamente. Isso não é uma ambiguidade hipotética — é o estado real do banco agora.

**Bloqueio 2 — `meta_adapter_inbound.py:347-355` (transbordo):** o "padrão de referência" citado nos Dev Notes desta story como molde a replicar (`.contains("automacoes", [modulo])` nas linhas 347-350) **já existe hoje mas nunca funciona na prática**. `modulo` é montado em `meta_adapter_inbound.py:219-224,305` via `_AGENTE_MODULO_MAP` e vem em minúsculo/snake_case (`"ouvidoria"`, `"programacao"`, `"acesso_cuca"`, ou `agente_tipo_hdv.lower()`), enquanto `automacoes` no banco usa strings capitalizadas em português (`"Institucional"`, `"Divulgação"`, `"Acesso CUCA"`). Nenhum valor de `modulo` bate com nenhum valor de `automacoes` hoje — o `.contains(...)` sempre retorna vazio e a execução **sempre cai no fallback hardcoded** `.eq("nome", "cuca_transbordo_colaborador")`. Ou seja: o fallback hardcoded não é uma rede de segurança para um caso raro — é, na prática, **o único caminho que funciona hoje**. Removê-lo sem antes corrigir o mismatch de vocabulário quebra 100% das notificações de transbordo, não uma fração.

**Decisão:** não implementei Task 2. Corrigir isso exigiria uma de duas mudanças de escopo que a story atual não autoriza eu decidir sozinho (Article IV — No Invention):
1. Unificar o vocabulário de `modulo` com os valores de `automacoes` (ex.: mapear `_AGENTE_MODULO_MAP` para os mesmos rótulos capitalizados do banco) **e** resolver a ambiguidade de `cuca_evento_pontual`/`cuca_programacao_mensal` com um critério de desempate real (`categoria='MARKETING'` funcionaria hoje para esse par específico, mas é frágil — depende de nenhum outro template de Divulgação futuro também ser MARKETING).
2. Introduzir uma chave de lookup estável e dedicada (ex.: coluna `chave_interna`/`slug`, não editável pela UI, desacoplada tanto do `nome` livre quanto de `automacoes`) — resolve os dois bloqueios de raiz, mas é uma mudança de schema não coberta pelo escopo desta story.

Guard da Task 1 **permanece ativo e necessário** — não há contradição, o `NOMES_HARDCODED_WORKER` continua protegendo contra o cenário real de quebra.

#### Task 2 — Plano de resolução recebido de Junior, investigação adicional antes de aplicar (2026-07-03)

Junior decidiu: usar nomes reais aprovados na Meta em vez dos "cuca_*" inventados; lookup por nome exato (constante nomeada) para Divulgação mensal; mapeamento explícito modulo→automação para o transbordo. Antes de aplicar qualquer `UPDATE`/`INSERT` no banco ou código no worker (instrução explícita: só reportar o plano), investiguei mais:

- **`empregabilidade_convite_entrevista` (novo registro):** não existe *nenhum* corpo_texto real no histórico do repositório para reaproveitar. `cuca_convite_entrevista` foi um dos 12 seeds da S-WM-13, mas foi **deliberadamente deletado** na S-WM-14 (`supabase/migrations/20260629000003_wm14_corpo_texto_meta_templates.sql:7-22`, comentário "Remover os 12 seeds fabricados da WM-13") — ou seja, o texto que existia era reconhecido como fabricado/placeholder e removido de propósito. Preciso do corpo_texto real aprovado na Meta antes de criar este registro; não vou inventar texto de mensagem para candidatos reais.
- **Ambiguidade não totalmente resolvida no ponto 2 (transbordo), mesmo após o split:** consultei o estado atual do banco — `cuca_evento_pontual_admin` (mantido como está, fora de escopo desta rodada) já tem `automacoes=["Institucional"]`. Se `institucional_transbordo_v1` também for criado só com `automacoes=["Institucional"]`, a consulta `.contains("automacoes", ["Institucional"]).eq("ativo",true).eq("status","aprovado").limit(1)` fica ambígua entre os dois — exatamente o tipo de problema que motivou o HALT original, só que agora entre um template de transbordo e um de alerta administrativo (finalidades diferentes, mesma tag). Isso não é hipotético: os dois registros existem hoje com o mesmo status/ativo.
- **Cobertura de Ouvidoria/Acesso CUCA no transbordo:** o `cuca_transbordo_colaborador` atual cobre as 4 automações (`Empregabilidade`, `Institucional`, `Ouvidoria`, `Acesso CUCA`). O split proposto cria só 2 registros nomeados (Institucional, Empregabilidade). Confirmei em `human_handover_contacts` que hoje só existe configuração para `modulo='empregabilidade'` (zero linhas para ouvidoria/acesso_cuca) — ou seja, não quebra nada *hoje*, mas fica sem template de transbordo assim que Ouvidoria/Acesso CUCA forem configurados, a menos que seja proposital.
- **Mapeamento modulo→automação precisa ser mais abrangente que os 4 exemplos do plano:** `_AGENTE_MODULO_MAP` (`meta_adapter_inbound.py:219-224`) cobre hoje só `sofia`, `Institucional`, `maria`, `ana`. Encontrei em `supabase/functions/motor-agente/index.ts:9-15,154` que `agente_tipo` também assume `julia`, `sofia_global`, `sofia_unidade` — nenhum desses bate com as chaves atuais do mapa, caindo no fallback `.lower()` que nunca vai casar com uma tag de `automacoes`. Um mapeamento fiel ao pedido de Junior precisa cobrir essas variantes também, ou o mesmo tipo de bug ressurge para Ouvidoria via Sofia (variantes _global/_unidade).

Nenhum `UPDATE`/`INSERT` foi executado; nenhuma linha do worker foi alterada. Plano completo com essas 4 pendências reportado ao usuário/Junior para confirmação antes de qualquer aplicação.

#### Task 3 — CRUD seguro de Número Meta (2026-07-03)

Backend (`meta-phone-numbers/[id]/route.ts`): `phone_number_id` e `waba_id` adicionados a `CAMPOS_PERMITIDOS`; validação de formato via `META_ID_REGEX = /^\d{15,17}$/` aplicada a **ambos** os campos (nota do @po/Junior incorporada — a validação original do plano só citava `phone_number_id`, estendi para `waba_id` com a mesma regex, já que os dois têm o mesmo formato observado nos exemplos reais do modal de criação). Erro 400 com mensagem específica por campo se inválido, antes de tocar o banco. Checagem de duplicidade de `phone_number_id` (excluindo o próprio registro) devolve 409 amigável. Rota `DELETE` adicionada, soft delete via `ativo=false`, mesmo padrão de `meta_templates/[id]/route.ts`.

Frontend (`meta-numeros/page.tsx`): `phone_number_id` e `waba_id` viraram inputs controlados no modo de edição da linha (antes eram `<code>` estático). Validação de formato replicada no frontend antes do submit (mesma regex). Confirmação por **modal** (não checkbox) ao detectar mudança em `phone_number_id`/`waba_id` — clicar "Salvar" com um desses campos alterado abre um Dialog ("Tem certeza? Isso muda para qual número as mensagens desta automação serão enviadas/recebidas.") antes de disparar o PATCH real; texto exato do plano original preservado. Botão de desativação (soft delete, ícone de lixeira) adicionado por linha fora do modo de edição, com modal de confirmação próprio explicando que é soft delete (`ativo=false`), não remoção real.

Verificação direta no cuca-dev (não apenas leitura de código) via `execute_sql`: criei um registro de teste (`phone_number_id='999999999999999'`), executei `UPDATE meta_phone_numbers SET phone_number_id = '777...'` — confirma que o Supabase/Postgres aceita update da PK sem erro, exatamente como a Nota de Escopo da Task 3 antecipava. Em seguida testei o soft delete (`ativo=false`) sobre o registro renomeado — linha permanece, dado preservado. Removi o registro de teste ao final (`DELETE`), já que era 100% descartável e criado só para esta verificação.

#### Task 5 — Auditoria de consistência (parcial, 2026-07-03)

Auditado o que Task 1 e Task 3 tocam: ambas as rotas usam `createAdminClient()` (service_role) e não passam por nenhuma camada de cache — qualquer `UPDATE` feito pela UI reflete imediatamente na próxima leitura do worker (mesmo princípio de S-WM-13/14, sem código novo de cache introduzido). O smoke test completo pedido no AC9 (editar `phone_number_id` de um registro real e confirmar via `get_logs` que uma mensagem simulada usa a config nova) **não foi executado** — depende de simular uma mensagem inbound real contra um número Meta configurado no cuca-dev, o que está fora do que consigo/devo fazer sem coordenar com Junior sobre qual número de teste usar (evitar mexer em mapeamento real usado por outras automações em andamento). Deixo como pendência explícita, não como "concluído".

### Completion Notes List
- **Task 1: concluída (com revisão).** Guard/readOnly condicional dos 2 nomes hardcoded foi **removido** por decisão de Junior no ajuste final — Task 2 passou a ser 100% relacional (automação + phone_number_id), eliminando o motivo do guard. Nome do template agora é sempre editável em texto livre, tanto no modal de criação quanto na página de edição.
- **Task 2: concluída — redesenhada como CRUD relacional completo** (ajuste final de Junior, substitui o design original de "renomear nomes hardcoded"). Ver seção própria abaixo para detalhes técnicos.
- **Task 3: concluída.** `phone_number_id`/`waba_id` editáveis com validação de formato (regra estendida a `waba_id` por instrução do @po), modal de confirmação explícita, soft delete via nova rota `DELETE`. Verificado diretamente no cuca-dev que o update de PK funciona.
- **Task 4: não iniciada — gate intacto.** Aguardando avaliação de custo-benefício com @po, conforme a própria story exige antes de qualquer código.
- **Task 5: parcial.** Reflexo imediato (sem cache) confirmado por inspeção de código — rotas usam `createAdminClient()`/service_role, sem camada de cache. Disambiguação das 4 queries relacionais **verificada diretamente no cuca-dev via `execute_sql`** (não só por inspeção de código — rodei as 4 queries reais e confirmei 1 resultado único cada). **Smoke test E2E fim-a-fim com mensagem real fica para Junior** (validação final descrita na story, exige número de teste real — fora do que dá pra simular aqui).
- `pytest worker/tests/`: **74 passed, 3 skipped** (suíte completa, não só o arquivo de transbordo). 1 teste (`test_sem_template_aprovado_nao_envia`) precisou de atualização de mock — o mock antigo simulava a query de 2 passos (contains + fallback por nome) que não existe mais; atualizado para o novo formato de query única (automação + phone_number_id). Mudança de teste, não de comportamento — a asserção continua a mesma (sem template aprovado → não envia).
- `npx tsc --noEmit`: 0 erros em todo o portal.
- `npx eslint` nos arquivos tocados: erros remanescentes todos pré-existentes (confirmado via diff linha a linha contra a versão anterior de cada arquivo) — nenhum introduzido pelo código novo desta story.
- `python -m ast.parse`: sintaxe válida em `campanhas_engine.py` e `meta_adapter_inbound.py`.

### Task 2 (redesenhada) — CRUD relacional de templates Meta

**Modelo final:** todo template Meta se vincula a exatamente 1 número (`phone_number_id`), do qual `automação` (canal_tipo), `agente` (agente_tipo) e `waba_id` são derivados automaticamente — nunca digitados à mão. `nome` é sempre texto livre (o nome real aprovado na Meta). Nenhum nome de template está mais hardcoded em nenhum lookup do worker ou do portal.

**Decisão técnica não trivial, documentada aqui porque não veio de nenhuma instrução explícita — foi resolução minha durante a implementação:** vários templates compartilham a mesma automação + mesmo número (ex.: `institucional_transbordo_v1` e `institucional_programacao_mensal_v1` usam ambos `automacoes` contendo "Institucional" e o mesmo `phone_number_id`). Filtrar só por automação+número não bastava — adicionei uma **2ª tag específica** em `automacoes` para os casos que precisam de desambiguação: `"Transbordo"` (nos 2 templates de transbordo) e `"Pontual"`/`"Convite"` (nos 2 templates catálogo-only). O template "padrão" de cada canal (`institucional_programacao_mensal_v1`, `empregabilidade_feedback_empresa_v1`) fica com **1 tag só**, e o lookup dele usa **igualdade exata de array** (`.eq("automacoes", ["Institucional"])`), não `.contains`, pra não colidir com os templates de 2 tags. Verifiquei as 4 combinações reais no banco (query por query, ver Debug Log) — cada uma retorna exatamente 1 linha.

**Arquivos do worker:**
- `worker/meta_adapter_inbound.py`: `MODULO_AUTOMACAO_MAP` novo (normaliza `modulo`/`agente_tipo` em qualquer formato — `empregabilidade`, `julia`, `sofia_global`, `sofia_unidade`, `ana`, `Institucional`, `maria`, etc. — para a tag de automação salva no banco). `_notificar_transbordo` agora faz 1 query só (`automação`+`"Transbordo"`+`phone_number_id`), fallback hardcoded removido completamente.
- `worker/campanhas_engine.py`: `processar_disparos_divulgacao` reordenada — busca `phone_number_id` por `canal_tipo="Institucional"` (era `"Divulgação"`, trocado por decisão de Junior — o número de Divulgação é o mesmo do Institucional) **antes** do lookup do template, porque o template agora depende do `phone_number_id` para desambiguar. Removido o 3º parâmetro do `components` (`link_ou_msg`) — Junior confirmou que o template real só tem 2 variáveis (`nome`, `mês`).

**Arquivo do portal (3º ponto hardcoded, achado nesta investigação, fora dos 2 que Junior apontou originalmente):**
- `cuca-portal/src/app/api/empregabilidade/vagas/feedback-submit/route.ts`: `.eq("nome","cuca_feedback_vaga")` → lookup relacional (`automacoes=["Empregabilidade"]` exato + `phone_number_ids` contains). Por decisão explícita de Junior, os parâmetros que esse endpoint já envia (título da vaga, nome da empresa, contagem de aprovados) **não foram alterados** — o `corpo_texto` de `empregabilidade_feedback_empresa_v1` no catálogo (com `{{link_feedback}}`) documenta o template real aprovado, mas hoje esse endpoint específico ainda não envia esse conjunto de parâmetros. Divergência conhecida e aceita, a corrigir em story futura (também não migrei `solicitar-feedback/route.ts`, que hoje envia texto livre e seria o candidato mais natural pro conteúdo real do template — fora de escopo desta story, por decisão de Junior).

**Migration:** `supabase/migrations/20260703000000_wm16_templates_relacionais.sql`, aplicada via `apply_migration` no cuca-dev:
1. Índice único `meta_templates_nome_unique` recriado como **parcial** (`WHERE ativo = true`) — sem isso, soft-delete + recriar com o mesmo nome bateria 409 porque a linha antiga inativa ainda ocupava o nome. Também ajustei os 2 pre-checks de duplicidade no app (`meta-templates/route.ts` POST e `[id]/route.ts` PATCH) pra respeitarem `ativo=true`, senão o índice parcial resolvia mas o app continuava bloqueando.
2. Removidos `cuca_transbordo_colaborador`, `cuca_programacao_mensal`, `cuca_feedback_vaga` (substituídos pelos nomes reais).
3. Inseridos os 6 templates reais com nomes/corpos fornecidos por Junior — **placeholders nomeados convertidos para `{{1}}`, `{{2}}`... na ordem em que apareciam**, com o nome original preservado como `descricao` de cada posição em `variaveis` (Meta só aceita `{{N}}` numérico; confirmei lendo o código que `_enviar_template_meta` manda parâmetros posicionais, não lê `corpo_texto` — esse campo é só preview/documentação).

**Frontend:**
- `meta-templates/page.tsx` (criar) e `meta-templates/[id]/page.tsx` (editar): removidos os campos antigos (input de automações por vírgula na criação; checkboxes de automações + checkboxes de números na edição). Substituídos pelos 5 campos pedidos: nome livre, dropdown de telefone (`meta_phone_numbers` ativos), e 3 campos read-only (automação/agente/WABA) que atualizam instantaneamente ao trocar o telefone — sem chamada de rede, é só `.find()` na lista já carregada.
- CRUD de exclusão (soft delete) **já existia** em `meta-templates/page.tsx` (rota `DELETE` + modal de confirmação da S-WM-13/14) — não precisou de código novo, só passou a funcionar de verdade para recriar-com-mesmo-nome depois do índice parcial.

### File List

**Modificados nesta rodada (além dos 4 já listados acima, da Task 1/3):**
- `cuca-portal/src/app/(dashboard)/developer/meta-templates/page.tsx` — CreateTemplateModal redesenhado (dropdown telefone + 3 readonly, tipo `PhoneNumber` novo)
- `cuca-portal/src/app/(dashboard)/developer/meta-templates/[id]/page.tsx` — reescrito: guard/readOnly da Task 1 removido, checkboxes de automações/números substituídos por dropdown+readonly
- `cuca-portal/src/app/api/admin/meta-templates/route.ts` — pre-check de duplicidade de nome agora filtra `ativo=true`
- `cuca-portal/src/app/api/admin/meta-templates/[id]/route.ts` — idem, no PATCH
- `cuca-portal/src/app/api/empregabilidade/vagas/feedback-submit/route.ts` — hardcode de nome eliminado (3º ponto, achado nesta investigação)
- `worker/campanhas_engine.py` — lookup relacional da programação mensal, canal trocado Divulgação→Institucional, 3º parâmetro removido
- `worker/meta_adapter_inbound.py` — `MODULO_AUTOMACAO_MAP` novo, lookup relacional do transbordo, fallback hardcoded removido
- `worker/tests/test_meta_adapter_inbound.py` — mock de 1 teste atualizado pro novo formato de query (comportamento testado não mudou)

**Criados:**
- `supabase/migrations/20260703000000_wm16_templates_relacionais.sql` — índice único parcial + migração dos 6 templates reais

**Zero nome de template hardcoded restante** — confirmado por grep: nenhuma ocorrência de `.eq("nome", "cuca_...")` ou similar nos 3 arquivos que tinham esse padrão.

#### Ajuste final — eliminação total de hardcode + remoção dos 3 templates legados (2026-07-03)

Junior reportou que os 3 templates `cuca_evento_pontual`, `cuca_evento_pontual_admin`, `cuca_pesquisa_ouvidoria` (mantidos "fora de escopo" na rodada anterior) estavam "atrapalhando". Investigação read-only prévia (turno anterior) descartou ambiguidade de lookup (os 3 têm `phone_number_ids=[]`, nunca batem em nenhum `.contains("phone_number_ids",...)`) e identificou a causa real: a tela de edição (`[id]/page.tsx`) bloqueia salvar **qualquer** campo desses 3 templates porque exige um telefone selecionado, e eles nunca tiveram um `phone_number_id` fixo (usam seleção dinâmica de canal).

Junior then pediu eliminação total: **zero nome hardcoded em qualquer lugar do código**, com os 3 registros removidos do banco depois que o código parar de referenciá-los por nome.

**Grep completo (worker + portal + edge functions, não só os 2 arquivos originais):**
- `worker/campanhas_engine.py:207` — `.eq("nome", template_nome_exato)` em `processar_item_disparo` (usada por `eventos_pontuais`/`ouvidoria_eventos`) — não fazia parte do escopo original da Task 2.
- `worker/campanhas_engine.py:296,308` (linhas antigas) — `if template_name == "cuca_evento_pontual":` / `elif template_name == "cuca_pesquisa_ouvidoria":` na montagem de `components` — hardcode "silencioso" (não é query, mas ainda amarra lógica ao nome).
- **Achado não solicitado, fora do escopo "worker + portal" mas dentro do espírito do pedido:** `supabase/functions/alertas-institucionais/index.ts` tinha **3 lookups hardcoded** (`cuca_evento_pontual_admin` linha 67; `cuca_transbordo_colaborador` linhas 106 e 127). As duas últimas **já estavam quebradas em produção/cuca-dev** desde a migration anterior desta mesma story — `cuca_transbordo_colaborador` foi deletado quando os 6 templates reais foram criados, e essa edge function nunca foi atualizada. Isso não tinha sido pego pelo grep anterior porque eu só busquei em `worker/` e `cuca-portal/src/app/api/`, nunca em `supabase/functions/`. Reportando com transparência: foi uma lacuna minha na rodada anterior, corrigida agora.
- 3 comentários/docstrings desatualizados (`worker/.env.example:37`, `worker/campanhas_engine.py:414,421` antigas) citando nomes antigos — corrigidos também, apesar de não serem lógica executável.

**Verificação de impacto antes de aplicar (fato, não suposição):** consultei `eventos_pontuais`, `ouvidoria_eventos` e `solicitacoes_acesso` no cuca-dev — **as 3 tabelas estão com zero linhas** hoje. Ou seja, a migração de `processar_item_disparo` e da edge function não tem nenhum impacto funcional imediato no cuca-dev (nada está sendo disparado por esses caminhos agora).

**Migração aplicada:**
- `worker/campanhas_engine.py::processar_item_disparo`: reordenado (telefone antes do template, mesmo padrão da Task 2); lookup relacional com tag de automação por origem (`"Divulgação"` para `eventos_pontuais`/fallback, `"Ouvidoria"` para `ouvidoria_eventos`) + `phone_number_id`; `components` agora montado por `origem`, não por `template_name`. Sem template real cadastrado para essas 2 automações após a remoção dos 3 legados — **resultado esperado: pula graciosamente (loga e marca item como "pausada"), não derruba nada** — comportamento já existente na função para "sem template"/"sem telefone", só reaproveitado.
- `supabase/functions/alertas-institucionais/index.ts`: 3 lookups migrados para relacional.
  - Alerta admin de evento pontual → tag `["Institucional","EventoAdmin"]` — sem template correspondente hoje, pula graciosamente (mesma lacuna dos itens acima, tabela vazia).
  - **Handover (`conversas`/`awaiting_human`) → tag `["Institucional","Transbordo"]`** — bate com `institucional_transbordo_v1`, que já existe. **[Correção 2026-07-04, ver Debug Log "Ambiguidade de telefone" abaixo]** Prepara a correção do bug que a migration anterior desta story introduziu (a função estava buscando `cuca_transbordo_colaborador`, deletado) — mas o @qa verificou empiricamente que **não estava restaurado ainda**, por uma ambiguidade de telefone Institucional pré-existente e não relacionada a este lookup. Ambiguidade resolvida (ver abaixo); handover confirmado funcionando de ponta a ponta.
  - `solicitacoes_acesso` → tag `["Acesso CUCA","Transbordo"]` — não existe template com essa combinação ainda (gap já registrado no Debug Log anterior: split do transbordo só cobriu Institucional/Empregabilidade). Pula graciosamente, tabela vazia hoje também.
- Migration `supabase/migrations/20260703220000_wm16_remover_templates_cuca_legado.sql` — `DELETE` dos 3 registros, aplicada só depois do grep confirmar zero referência por nome.

**Grep final (prova, rodado por mim depois de tudo aplicado):**
```
grep -rn "cuca_evento_pontual|cuca_evento_pontual_admin|cuca_pesquisa_ouvidoria|cuca_transbordo_colaborador|cuca_programacao_mensal|cuca_feedback_vaga|cuca_convite_entrevista" worker/ cuca-portal/src/ supabase/functions/
→ 0 ocorrências (exit code 1)

grep -rn '.eq("nome", "' worker/ cuca-portal/src/app/api/ supabase/functions/
→ 0 ocorrências (exit code 1)
```
Rodei também um sweep repo-wide (`--include="*.py" --include="*.ts" --include="*.tsx" .`) pelos 3 nomes deletados — zero resultados em qualquer arquivo de código do repositório.

`pytest worker/tests/`: 74 passed, 3 skipped — sem regressão (sem teste dedicado a `campanhas_engine.py`, então a cobertura dessa função continua sendo verificação manual/leitura de código, como já documentado no Testing da story).

**Não testado (fora do meu alcance sem dados reais):** como as 3 tabelas estão vazias, não há como exercitar `processar_item_disparo`/`alertas-institucionais` ponta a ponta nesta sessão. A correção do bug do handover (`institucional_transbordo_v1`) e o comportamento gracioso das automações sem template ficam para validação de Junior quando/se essas automações forem usadas.

#### Ambiguidade de telefone Institucional — corrigida (2026-07-04)

@qa verificou empiricamente (não só por leitura de código) que a correção do handover institucional acima **não estava restaurada de fato**: `meta_phone_numbers` tinha 2 registros ativos com `canal_tipo='Institucional'` (`1233832826470497` "CUCA Institucional" real e `1215172285010519` "Test WhatsApp Business Account"). A query da edge function (`.eq("canal_tipo","Institucional").limit(1)`, sem `ORDER BY`) resolvia para o número de teste, não o real — então `institucional_transbordo_v1` (vinculado só ao número real) nunca batia.

Confirmei que a ambiguidade é **pré-existente** (visível desde a investigação da Task 3, antes de qualquer mudança desta story) e não foi introduzida pelo ajuste de hardcode. Corrigido:
1. `grep -rn "1215172285010519" worker/ cuca-portal/src/ supabase/functions/` → zero ocorrências — confirmado que nenhum código depende desse `phone_number_id` antes de tocá-lo.
2. `UPDATE meta_phone_numbers SET ativo=false WHERE phone_number_id='1215172285010519'` — aplicado direto via `execute_sql` (mudança de dado, não de schema — não precisa de migration).
3. Reconfirmado que `SELECT ... WHERE canal_tipo='Institucional' AND ativo=true LIMIT 1` agora resolve, sem ambiguidade, para `1233832826470497`.
4. **Teste real** (não só leitura de código): rodei a query exata que a edge function executa (`automacoes @> ['Institucional','Transbordo'] AND phone_number_ids @> ['1233832826470497']`) — retorna `institucional_transbordo_v1`. O handover institucional agora está de fato restaurado, confirmado ponta a ponta no nível de banco.

Textos anteriores no Debug Log e Change Log que diziam "resolve"/"restaura" o alerta de handover foram corrigidos para refletir que a restauração completa só aconteceu agora, após esta correção — não no commit anterior, como a redação original sugeria incorretamente.

### File List

**Modificados:**
- `cuca-portal/src/app/(dashboard)/developer/meta-templates/[id]/page.tsx` — nome editável condicional, guard de renomeação hardcoded, validação de unicidade frontend
- `cuca-portal/src/app/api/admin/meta-templates/[id]/route.ts` — checagem de duplicidade de nome amigável no PATCH
- `cuca-portal/src/app/(dashboard)/developer/meta-numeros/page.tsx` — phone_number_id/waba_id editáveis, modal de confirmação crítica, botão + modal de soft delete
- `cuca-portal/src/app/api/admin/meta-phone-numbers/[id]/route.ts` — CAMPOS_PERMITIDOS estendido, validação de formato Meta ID, checagem de duplicidade, rota DELETE (soft delete)

**Modificados (ajuste final — eliminação total de hardcode):**
- `worker/campanhas_engine.py` — `processar_item_disparo` migrada para lookup relacional; `components` montado por `origem`; comentários desatualizados corrigidos
- `worker/.env.example` — comentário desatualizado corrigido
- `supabase/functions/alertas-institucionais/index.ts` — 3 lookups migrados para relacional (1 conserta bug introduzido pela migration anterior)

**Criados (ajuste final):**
- `supabase/migrations/20260703220000_wm16_remover_templates_cuca_legado.sql` — remove os 3 templates legados, aplicada após confirmação por grep

### Tasks
- [x] **Task 1 — Liberar edição segura de "nome" de template:** concluída; guard/readOnly condicional removido no ajuste final (Task 2 elimina o motivo dele).
- [x] **Task 2 — CRUD relacional completo de templates Meta (redesenhada):** concluída, incluindo eliminação total de hardcode (worker + portal + edge functions) e remoção dos 3 templates legados. Zero nome de template hardcoded em todo o repositório — confirmado por grep final e sweep repo-wide.
- [x] **Task 3 — CRUD completo e seguro de Número Meta:** concluída, incluindo validação de `waba_id` (nota do @po incorporada) e rota DELETE.
- [ ] **Task 4 — Validação cruzada com a API real da Meta:** não iniciada — gate com @po intacto, conforme escopo da story.
- [~] **Task 5 — Auditoria de consistência:** reflexo imediato + disambiguação relacional verificados diretamente no cuca-dev (inclusive as novas queries de `campanhas_engine.py`/edge function). Smoke test E2E com mensagem real fica para Junior (validação final combinada) — agora inclui também validar o handover institucional (bug corrigido) quando houver tráfego real.

## QA Results

### Veredito: **CONCERNS** (aprovado para prosseguir, com follow-ups obrigatórios antes de "Done")

Revisão de @qa (Quinn), 2026-07-03. Verifiquei de forma independente — não confiei apenas no Dev Agent Record — os pontos abaixo. Nenhum achado CRITICAL/HIGH bloqueia o merge; os itens em CONCERNS são de sincronização de documentação (AC desatualizada após o pivot de design) e uma validação manual pendente que já era esperada ficar para Junior.

#### 1. Code review
Código limpo, consistente com os padrões já estabelecidos no projeto (mesmo formato de `assertDeveloper()`, `CAMPOS_PERMITIDOS`/`CAMPOS_EDITAVEIS`, soft delete). A decisão de desambiguação por 2ª tag em `automacoes` (`"Transbordo"`, `"Pontual"`, `"Convite"`) é uma solução de engenharia razoável para um problema real (múltiplos templates com mesma automação+número) — documentada com clareza no Debug Log, com a query exata que a motivou. Sem over-engineering perceptível; escopo respeitado (não tocou `agente_tipo`/`canal_tipo`/`unidade_cuca`/`ativo` de `meta_phone_numbers`, não mexeu em `corpo_texto`/variáveis fora do necessário).

#### 2. Testes unitários
Rodei a suíte completa eu mesmo (não só confiei no relato): `pytest worker/tests/` → **74 passed, 3 skipped**, confirma o relato do @dev. O teste que precisou de ajuste de mock (`test_sem_template_aprovado_nao_envia`) continua validando a mesma asserção de comportamento (sem template aprovado → não envia) — mudança de mock, não de cobertura.

**Achado não bloqueante:** `test_prioridade_unidade_especifica_nao_consulta_global` (mesmo arquivo) usa um mock de `meta_templates` com o formato de query **antigo** (`.contains().eq().eq()...`, sem o novo `.contains().contains()...`) e continua passando — mas só porque `MagicMock` absorve silenciosamente a chamada não configurada e retorna um objeto truthy, não porque o teste valida o comportamento novo. O teste não falha, mas também não verifica mais nada de relevante sobre o lookup de template nesse cenário. Registro como debt (MEDIUM) para @dev atualizar o mock numa próxima passagem — não bloqueia esta story.

#### 3. Critérios de Aceite — mapeamento contra o que foi implementado
A Task 2 foi **redesenhada pelo usuário no meio da execução** (de "manter nomes hardcoded + guard" para "modelo 100% relacional"). O @dev corretamente não editou a seção de Critérios de Aceite (fora da sua autoridade — só @po edita AC), mas isso deixou o texto formal desatualizado frente ao que foi de fato entregue:

| AC | Situação |
|---|---|
| 1 | Satisfeito trivialmente (nome sempre editável agora, então também é editável nesse caso) |
| 2 | **Não satisfeito como escrito** — nome NÃO fica mais readOnly para `aprovado+ativo`. Superseded por decisão explícita do usuário ("editável sempre"), registrada no chat e no Debug Log. Não é bug — é o AC que ficou obsoleto. |
| 3 | **Cenário não existe mais** — os 2 nomes citados (`cuca_programacao_mensal`, `cuca_transbordo_colaborador`) foram removidos do banco; o guard foi removido do código por decisão do usuário. AC moot. |
| 4 | ✅ Verificado por mim via grep independente — zero ocorrências de nome hardcoded em `campanhas_engine.py`/`meta_adapter_inbound.py` (e também em `feedback-submit/route.ts`, achado extra corrigido). |
| 5 | ✅ Verificado lendo o código — validação de formato roda antes de qualquer chamada ao banco. |
| 6 | ✅ Verificado — modal de confirmação real (Dialog), não checkbox; `fetchNumeros()` após save atualiza a UI sem reload manual. |
| 7 | ✅ Verificado — DELETE faz `.update({ativo:false})`, linha preservada (dev testou diretamente no cuca-dev, comportamento confirmado por leitura do código). |
| 8 | ✅ Verificado por mim, execução independente do pytest. |
| 9 | **Não executado.** Smoke test E2E com mensagem real fica explicitamente para Junior validar manualmente — decisão correta do @dev de não simular contra número real sem coordenação, mas o AC continua tecnicamente em aberto até isso acontecer. |
| 10 | Não aplicável ainda — Task 4 não foi iniciada, então não há "decisão de Task 4" a registrar. Sem violação, mas também sem o registro formal que o AC pede. |

**Recomendação:** @po precisa atualizar AC 2, 3, 9 e 10 (ou o @sm reabrir a story) para refletir o design final antes de marcar a story como `Done` — isso é housekeeping de documentação, não reabertura de trabalho.

#### 4. Regressões
Nenhuma regressão funcional encontrada. `tsc --noEmit`: 0 erros (portal inteiro). `eslint` nos arquivos tocados: confirmei via diff que todos os erros remanescentes já existiam antes desta story. Migration é idempotente (`DROP INDEX IF EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`, `ON CONFLICT ... DO NOTHING`), registrada corretamente em `list_migrations` (versão `20260703211037`).

#### 5. Performance
Sem preocupação. A reordenação em `campanhas_engine.py` (buscar `phone_number_id` antes do template) mantém o mesmo número de queries (2), só muda a ordem. `automacoes` já tem índice GIN (`meta_templates_automacoes_gin`, da S-WM-13) que cobre os `.contains()` novos. `phone_number_ids` não tem índice dedicado, mas a tabela tem 9 linhas hoje — não é uma preocupação real neste volume.

#### 6. Segurança
Rodei `get_advisors(type=security)` — **zero achados** referenciando `meta_templates` ou `meta_phone_numbers` (os achados existentes no projeto são de outras tabelas, pré-existentes, fora de escopo). Confirmei manualmente que `assertDeveloper()` (auth) está presente em todas as rotas novas/modificadas, incluindo a nova rota `DELETE` de `meta-phone-numbers/[id]/route.ts`. Validação de formato (`META_ID_REGEX`) roda antes de qualquer escrita no banco — nenhum input não validado chega ao Postgres.

#### 7. Documentação
Debug Log e Completion Notes do @dev são excepcionalmente detalhados e citam evidência real (queries SQL executadas, resultado de cada uma) em vez de afirmações genéricas — dá pra auditar cada decisão. O gap é só o já citado no item 3 (AC desatualizada), que é responsabilidade de @po, não do @dev.

### Resumo de ações pendentes (não bloqueiam merge, bloqueiam fechamento como "Done")
1. **@po:** atualizar AC 2, 3, 9, 10 para refletir o modelo relacional final.
2. **Junior:** executar o smoke test E2E manual (AC9) — editar um `phone_number_id` real, mandar mensagem de teste, confirmar via `get_logs`.
3. **@po (gate já existente na story):** decidir Task 4 (validação Graph API) — implementar, virar story separada, ou descartar.
4. **Debt não bloqueante:** atualizar mock de `test_prioridade_unidade_especifica_nao_consulta_global` pro novo formato de query (cosmético — teste passa, mas não valida mais nada relevante sobre o lookup de template).

---

### Revisão adicional — eliminação total de hardcode (2026-07-03, commit `6996464`)

**Veredito: CONCERNS** (código correto e sem regressão; 1 afirmação do commit/Debug Log não se confirma na prática — achado, não bloqueio).

**Confirmado de forma independente** (não confiei no relato do @dev):
- Grep repo-wide (worker + portal + edge functions + sweep geral): **zero** ocorrências de nome de template hardcoded — reproduzi os 2 comandos do Debug Log, mesmo resultado (exit code 1 = zero matches).
- `pytest worker/tests/`: 74 passed, 3 skipped — reproduzido, sem regressão.
- `ast.parse` em `campanhas_engine.py`: sintaxe válida. Diff revisado linha a linha — a lógica de `components` por `origem` (não mais por `template_name`) preserva exatamente o comportamento original para os 3 casos (`ouvidoria_eventos` → 2 parâmetros, `eventos_pontuais`/default → 6 parâmetros), incluindo o branch "else" que hoje é código morto (nenhum caller usa `origem` fora dos 2 valores esperados).
- `meta_templates`: confirmado só 6 linhas restantes (os 3 `cuca_*` legados removidos), migration `wm16_remover_templates_cuca_legado` registrada em `list_migrations`.

**Achado — a claim "restaura o alerta de handover institucional" não se sustenta hoje:**
O Debug Log e o Change Log (linha do @dev acima) afirmam que a correção do lookup em `alertas-institucionais/index.ts` (branch `conversas`/`awaiting_human`) "resolve esse bug lateral" e restaura o alerta via `institucional_transbordo_v1`. Testei isso na prática, não só na leitura do código:

- `institucional_transbordo_v1.phone_number_ids = ["1233832826470497"]` ("CUCA Institucional").
- A edge function resolve `phoneNumberId` via `.eq("canal_tipo","Institucional").eq("ativo",true).limit(1)` — **sem `ORDER BY`**. Rodei essa query exata: retorna `1215172285010519` ("Test WhatsApp Business Account"), **não** `1233832826470497`.
- Com `phoneNumberId=1215172285010519`, o novo `.contains("phone_number_ids",[phoneNumberId])` **não bate** com `institucional_transbordo_v1` — a função continua pulando graciosamente, exatamente como antes da correção, só que agora pelo motivo "phone não confere" em vez de "nome não existe".

**Isso não é uma regressão desta mudança** — a ambiguidade de 2 números ativos com `canal_tipo=Institucional` é pré-existente (visível desde a investigação da Task 3, antes deste ajuste) e não foi introduzida agora. O código novo está correto e vai funcionar automaticamente assim que essa ambiguidade for resolvida (ex.: desativar o número de teste, ou a query ganhar um critério de desempate). Mas a afirmação de que o alerta **já está restaurado** é factualmente incorreta no estado atual do cuca-dev — recomendo corrigir o texto do Debug Log/Change Log (trocar "resolve"/"restaura" por "prepara a correção, pendente da ambiguidade de telefone Institucional ser resolvida") para não gerar falsa confiança caso alguém dependa dessa alegação depois.

**Sem achados novos de segurança/performance** — mesmas rotas, mesmo padrão de auth (nenhuma rota nova foi criada nesta rodada), consultas com mesmo custo de antes.

## Change Log
| Data | Agente | Ação |
|---|---|---|
| 2026-07-03 | @sm (River) | Story criada a partir do plano de Junior sobre cima da investigação read-only do @dev (turno anterior desta sessão): 5 tasks (edição segura de nome de template, remoção de hardcode no worker, CRUD seguro de número Meta, validação cruzada com a API da Meta — opcional, gate com @po antes de codar — e auditoria de consistência). Achados exatos do @dev citados como Dev Notes, sem reinvestigação. |
| 2026-07-03 | @po (Pax) | Validação GO 9/10 — Draft → Ready. Ver observações não-bloqueantes no veredito abaixo. |
| 2026-07-03 | @dev (Dex) | Ready → InProgress. Tasks 1 e 3 concluídas (nota do @po sobre validação de `waba_id` incorporada). Task 2 **BLOQUEADA (HALT)** — ambiguidade real de lookup confirmada em dados de produção do cuca-dev, não hipotética; ver Debug Log para as 2 opções levantadas. Task 4 não iniciada (gate @po intacto). Task 5 parcial. tsc limpo, eslint sem novos erros, pytest do worker 25/25 (baseline). |
| 2026-07-03 | @dev (Dex) | Task 2 redesenhada por Junior como CRUD relacional completo (automação+número, zero nome hardcoded) e implementada de ponta a ponta: migration aplicada no cuca-dev (índice único parcial + 6 templates reais), 2 pontos do worker corrigidos, 3º ponto hardcoded achado e corrigido no portal (`feedback-submit/route.ts`), frontend das 2 telas de template redesenhado (dropdown telefone + 3 campos derivados), guard da Task 1 removido. Disambiguação de queries verificada diretamente no cuca-dev (não só teórica). pytest completo 74 passed/3 skipped (1 mock desatualizado corrigido). tsc 0 erros, eslint sem novos erros. InProgress → **Ready for Review**. Task 4 segue gated (@po). Smoke test E2E fica para Junior validar manualmente. Sugestão: chamar @qa para o gate. |
| 2026-07-03 | @qa (Quinn) | Review independente — verdict **CONCERNS**. Confirmou de forma independente (pytest 74 passed/3 skipped, grep próprio, leitura de código, `get_advisors` de segurança) que a implementação está correta e sem achados CRITICAL/HIGH. Apontou drift entre ACs 2/3 (design original, obsoleto) e o comportamento final entregue, AC9 não executado (E2E fica para Junior) e AC10 sem decisão formal registrada (Task 4 não iniciada, sem violação). Recomendou @po reconciliar os ACs antes do fechamento como Done. |
| 2026-07-03 | @po (Pax) | Reconciliação dos Critérios de Aceite 2, 3, 9 e 10 para refletir o modelo relacional final (automação+`phone_number_id`, sem guard de nomes hardcoded), conforme recomendado por @qa. AC4 reescrito com grep mais abrangente (cobre os 3 pontos hardcoded eliminados, não só os 2 originais) — verificado por mim antes de gravar (zero matches confirmado). ACs 1 e 5-8 mantidos inalterados (não afetados pelo redesenho). Status da story permanece **Ready for Review** — a reconciliação documental não altera o veredito de @qa nem dispensa as pendências (smoke test E2E de Junior, decisão da Task 4). |
| 2026-07-03 | @devops (Gage) | Push de `develop` para `origin/develop` (4 commits) — sem PR (trabalho direto em `develop`, sem branch de feature). Corrigido credential helper do git (`gh auth setup-git`) e removido token antigo embutido na URL do remote, causa raiz de um hang no push. |
| 2026-07-03 | @dev (Dex) | Eliminação total de hardcode de nome de template, por pedido de Junior após reportar que os 3 templates `cuca_*` legados "atrapalhavam". Investigação confirmou a causa real: tela de edição bloqueia salvar qualquer campo desses 3 templates por exigir telefone selecionado (eles nunca tiveram `phone_number_id` fixo). Migrado `worker/campanhas_engine.py::processar_item_disparo` (mais 1 ponto de hardcode que não fazia parte do escopo original) e, como achado extra, **3 lookups hardcoded em `supabase/functions/alertas-institucionais/index.ts`** — 2 deles já estavam quebrados desde a migration anterior desta story (buscavam `cuca_transbordo_colaborador`, já deletado); a correção **prepara** (não resolve sozinha, ver correção de @qa abaixo) o handover institucional. `eventos_pontuais`/`ouvidoria_eventos`/`solicitacoes_acesso` confirmadas com zero linhas no cuca-dev — migração sem impacto funcional imediato. Migration `20260703220000_wm16_remover_templates_cuca_legado.sql` removeu os 3 registros após grep confirmar zero referência por nome em todo o repositório (worker + portal + edge functions + sweep geral). pytest 74/3 skipped, sem regressão. |
| 2026-07-04 | @dev (Dex) | Achado do @qa confirmado e corrigido: 2 números `Institucional` ativos simultaneamente (`1233832826470497` real + `1215172285010519` teste) causavam ambiguidade na query sem `ORDER BY` de `alertas-institucionais`. Desativado o número de teste (`ativo=false`) — confirmado que nenhum código referencia esse `phone_number_id` (grep vazio). Query da edge function agora resolve, sem ambiguidade, para `1233832826470497`. Teste real: `institucional_transbordo_v1` agora é encontrado corretamente pela query exata da edge function (confirmado via `execute_sql`, não só leitura de código). Texto do Debug Log e desta linha do Change Log corrigidos conforme sugestão do @qa — "resolve"/"restaura" trocado por "prepara a correção" onde a alegação original não se sustentava. |
