# S-WM-16 — CRUD completo e seguro de Números e Templates Meta (Developer Console)

## Status
InProgress

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

1. **Given** um template com `status != 'aprovado'` OU `ativo = false`, **when** o developer abre `/developer/meta-templates/[id]`, **then** o campo nome é editável (não `readOnly`).
2. **Given** um template com `status = 'aprovado' AND ativo = true`, **when** o developer abre a mesma tela, **then** o campo nome permanece `readOnly`, igual ao comportamento atual.
3. **Given** o nome atual do template é `"cuca_programacao_mensal"` ou `"cuca_transbordo_colaborador"` **e** a Task 2 ainda não foi concluída, **when** o developer tenta salvar um novo nome, **then** um aviso explícito aparece citando a automação afetada, exigindo confirmação dupla antes do PATCH ser enviado.
4. **Given** a Task 2 foi concluída, **when** `grep -n '"cuca_programacao_mensal"\|"cuca_transbordo_colaborador"' worker/campanhas_engine.py worker/meta_adapter_inbound.py` é executado, **then** nenhuma ocorrência resta como valor de comparação de `nome` — o lookup usa `automacoes`/módulo.
5. **Given** um `phone_number_id` inválido (não numérico, ou fora de 15-17 dígitos) é enviado ao `PATCH /api/admin/meta-phone-numbers/{id}`, **when** a rota processa, **then** retorna 400 com mensagem clara, sem tocar o banco.
6. **Given** um `phone_number_id`/`waba_id` válido é enviado, **when** o developer confirma no modal de confirmação explícita, **then** o registro é atualizado e a UI reflete o novo valor sem reload manual.
7. **Given** um registro de `meta_phone_numbers`, **when** o developer aciona a exclusão (soft delete), **then** `ativo` vira `false` e a linha permanece no banco (histórico preservado) — mesmo padrão de `meta_templates`.
8. **Given** a suíte `pytest` do worker, **when** executada após a Task 2, **then** passa sem regressão (`worker/tests/test_meta_adapter_inbound.py` e qualquer teste cobrindo `campanhas_engine.py` explicitamente verificados).
9. **Given** um `phone_number_id` de um registro existente é editado no cuca-dev (Task 5), **when** uma mensagem de teste é simulada para o número novo, **then** o worker responde usando a configuração atualizada sem restart — confirmado via `get_logs`.
10. **Given** a Task 4 (opcional), **when** avaliada com @po, **then** a decisão (implementar nesta story / virar story separada / descartar) fica registrada no Change Log desta story antes de qualquer código da Task 4 ser escrito.

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

#### Task 3 — CRUD seguro de Número Meta (2026-07-03)

Backend (`meta-phone-numbers/[id]/route.ts`): `phone_number_id` e `waba_id` adicionados a `CAMPOS_PERMITIDOS`; validação de formato via `META_ID_REGEX = /^\d{15,17}$/` aplicada a **ambos** os campos (nota do @po/Junior incorporada — a validação original do plano só citava `phone_number_id`, estendi para `waba_id` com a mesma regex, já que os dois têm o mesmo formato observado nos exemplos reais do modal de criação). Erro 400 com mensagem específica por campo se inválido, antes de tocar o banco. Checagem de duplicidade de `phone_number_id` (excluindo o próprio registro) devolve 409 amigável. Rota `DELETE` adicionada, soft delete via `ativo=false`, mesmo padrão de `meta_templates/[id]/route.ts`.

Frontend (`meta-numeros/page.tsx`): `phone_number_id` e `waba_id` viraram inputs controlados no modo de edição da linha (antes eram `<code>` estático). Validação de formato replicada no frontend antes do submit (mesma regex). Confirmação por **modal** (não checkbox) ao detectar mudança em `phone_number_id`/`waba_id` — clicar "Salvar" com um desses campos alterado abre um Dialog ("Tem certeza? Isso muda para qual número as mensagens desta automação serão enviadas/recebidas.") antes de disparar o PATCH real; texto exato do plano original preservado. Botão de desativação (soft delete, ícone de lixeira) adicionado por linha fora do modo de edição, com modal de confirmação próprio explicando que é soft delete (`ativo=false`), não remoção real.

Verificação direta no cuca-dev (não apenas leitura de código) via `execute_sql`: criei um registro de teste (`phone_number_id='999999999999999'`), executei `UPDATE meta_phone_numbers SET phone_number_id = '777...'` — confirma que o Supabase/Postgres aceita update da PK sem erro, exatamente como a Nota de Escopo da Task 3 antecipava. Em seguida testei o soft delete (`ativo=false`) sobre o registro renomeado — linha permanece, dado preservado. Removi o registro de teste ao final (`DELETE`), já que era 100% descartável e criado só para esta verificação.

#### Task 5 — Auditoria de consistência (parcial, 2026-07-03)

Auditado o que Task 1 e Task 3 tocam: ambas as rotas usam `createAdminClient()` (service_role) e não passam por nenhuma camada de cache — qualquer `UPDATE` feito pela UI reflete imediatamente na próxima leitura do worker (mesmo princípio de S-WM-13/14, sem código novo de cache introduzido). O smoke test completo pedido no AC9 (editar `phone_number_id` de um registro real e confirmar via `get_logs` que uma mensagem simulada usa a config nova) **não foi executado** — depende de simular uma mensagem inbound real contra um número Meta configurado no cuca-dev, o que está fora do que consigo/devo fazer sem coordenar com Junior sobre qual número de teste usar (evitar mexer em mapeamento real usado por outras automações em andamento). Deixo como pendência explícita, não como "concluído".

### Completion Notes List
- **Task 1: concluída.** Nome editável condicionalmente, guard funcional para os 2 nomes hardcoded, validação de unicidade frontend + backend.
- **Task 2: BLOQUEADA — HALT.** Ambiguidade real confirmada em produção (dados do cuca-dev, não hipótese) nos dois pontos do worker. Não implementada — decisão de arquitetura necessária antes de codar (ver Debug Log). Escalando para o usuário/Junior decidir entre as 2 opções levantadas, ou outra.
- **Task 3: concluída.** `phone_number_id`/`waba_id` editáveis com validação de formato (regra estendida a `waba_id` por instrução do @po), modal de confirmação explícita, soft delete via nova rota `DELETE`. Verificado diretamente no cuca-dev que o update de PK funciona.
- **Task 4: não iniciada — gate intacto.** Aguardando avaliação de custo-benefício com @po, conforme a própria story exige antes de qualquer código.
- **Task 5: parcial.** Auditoria de reflexo imediato (sem cache) feita por inspeção de código. Smoke test end-to-end (AC9) pendente — precisa de coordenação sobre qual número de teste usar no cuca-dev.
- `pytest worker/tests/test_meta_adapter_inbound.py`: 25/25 passando (baseline, sem alteração no worker — Task 2 não implementada).
- `npx tsc --noEmit`: 0 erros.
- `npx eslint` nos 4 arquivos tocados: 5 erros remanescentes, todos pré-existentes (confirmado via diff contra a versão anterior do arquivo) — nenhum introduzido pelo código novo desta story.

### File List

**Modificados:**
- `cuca-portal/src/app/(dashboard)/developer/meta-templates/[id]/page.tsx` — nome editável condicional, guard de renomeação hardcoded, validação de unicidade frontend
- `cuca-portal/src/app/api/admin/meta-templates/[id]/route.ts` — checagem de duplicidade de nome amigável no PATCH
- `cuca-portal/src/app/(dashboard)/developer/meta-numeros/page.tsx` — phone_number_id/waba_id editáveis, modal de confirmação crítica, botão + modal de soft delete
- `cuca-portal/src/app/api/admin/meta-phone-numbers/[id]/route.ts` — CAMPOS_PERMITIDOS estendido, validação de formato Meta ID, checagem de duplicidade, rota DELETE (soft delete)

**Não modificados (Task 2 bloqueada):**
- `worker/campanhas_engine.py` — nenhuma alteração, hardcode de `cuca_programacao_mensal` permanece
- `worker/meta_adapter_inbound.py` — nenhuma alteração, hardcode de `cuca_transbordo_colaborador` permanece

### Tasks
- [x] **Task 1 — Liberar edição segura de "nome" de template:** concluída (ver Debug Log).
- [ ] **Task 2 — Remover hardcode de nome no worker:** **BLOQUEADA — HALT.** Ambiguidade real confirmada nos dois pontos do worker (ver Debug Log). Decisão de arquitetura pendente antes de codar.
- [x] **Task 3 — CRUD completo e seguro de Número Meta:** concluída, incluindo validação de `waba_id` (nota do @po incorporada) e rota DELETE.
- [ ] **Task 4 — Validação cruzada com a API real da Meta:** não iniciada — gate com @po intacto, conforme escopo da story.
- [ ] **Task 5 — Auditoria de consistência:** parcial — reflexo imediato auditado por inspeção de código; smoke test end-to-end (AC9) pendente.

## QA Results
_Pendente — aguardando execução @dev e posterior QA gate._

## Change Log
| Data | Agente | Ação |
|---|---|---|
| 2026-07-03 | @sm (River) | Story criada a partir do plano de Junior sobre cima da investigação read-only do @dev (turno anterior desta sessão): 5 tasks (edição segura de nome de template, remoção de hardcode no worker, CRUD seguro de número Meta, validação cruzada com a API da Meta — opcional, gate com @po antes de codar — e auditoria de consistência). Achados exatos do @dev citados como Dev Notes, sem reinvestigação. |
| 2026-07-03 | @po (Pax) | Validação GO 9/10 — Draft → Ready. Ver observações não-bloqueantes no veredito abaixo. |
| 2026-07-03 | @dev (Dex) | Ready → InProgress. Tasks 1 e 3 concluídas (nota do @po sobre validação de `waba_id` incorporada). Task 2 **BLOQUEADA (HALT)** — ambiguidade real de lookup confirmada em dados de produção do cuca-dev, não hipotética; ver Debug Log para as 2 opções levantadas. Task 4 não iniciada (gate @po intacto). Task 5 parcial. tsc limpo, eslint sem novos erros, pytest do worker 25/25 (baseline). |
