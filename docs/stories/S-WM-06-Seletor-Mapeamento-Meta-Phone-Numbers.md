# S-WM-06 — Seletor de Mapeamento de Números WhatsApp (Meta)

## Status
InReview

## Executor Assignment
```yaml
executor: "@dev"
quality_gate: "@qa"
quality_gate_tools:
  - pytest (sem impacto no worker — checar regressão)
  - TypeScript typecheck (portal)
  - verificação manual RBAC: rota acessível só a Super Admin
  - mcp supabase execute_sql (confirmar RLS em meta_phone_numbers)
```

## Story
**Como** Super Admin do portal,  
**quero** gerenciar os mapeamentos de `phone_number_id → agente_tipo` diretamente pelo Developer Console,  
**para que** a troca de canal/agente em produção não exija UPDATE manual no banco.

## Decisão

A tabela `meta_phone_numbers` já é a fonte de verdade lida dinamicamente pelo worker (S-WM-03). Esta story expõe CRUD parcial (sem DELETE) via interface no Developer Console, na sub-rota `/developer/meta-numeros`, seguindo o padrão visual e de autenticação já existente em `/developer/instancias`.

API route server-side com `SUPABASE_SERVICE_ROLE_KEY` — nunca exposta ao client.

## Escopo

### IN

**`cuca-portal/src/app/(dashboard)/developer/meta-numeros/page.tsx`** — nova página

- **Seção de listagem:** tabela com colunas `display_name`, `phone_number_id`, `agente_tipo`, `canal_tipo`, `waba_id`, `ativo`
- **Edição inline:** clique na linha habilita selects para `agente_tipo`, `canal_tipo` e toggle para `ativo`; botão "Salvar" envia PATCH
- **Novo registro:** botão "+ Adicionar Número" abre Dialog com campos: `phone_number_id` (obrigatório), `waba_id` (obrigatório), `display_name` (obrigatório), `agente_tipo` (select), `canal_tipo` (select), `unidade_cuca` (select, opcional), `ativo` (toggle, default true)
- Feedback visual: toast de sucesso/erro (padrão `sonner` já usado no projeto)
- Loading states durante fetch/submit

**`cuca-portal/src/app/api/admin/meta-phone-numbers/route.ts`** — GET + POST
- Auth (ambas as rotas): verificar sessão do usuário via `createServerClient` + confirmar `isDeveloper` (email na `DEVELOPER_EMAILS`); retornar 401 se não autenticado ou não-developer — **antes** de qualquer operação
- `GET`: `adminClient.from("meta_phone_numbers").select("*").order("display_name")` — retorna todos os registros
- `POST`: insere novo registro; valida `phone_number_id`, `waba_id`, `display_name` obrigatórios; retorna 409 se `phone_number_id` já existe (UK)
- Usa `createAdminClient` para a operação no banco, mas apenas após validar a sessão

**`cuca-portal/src/app/api/admin/meta-phone-numbers/[id]/route.ts`** — PATCH
- Auth: mesma verificação de sessão + `isDeveloper` antes de operar
- `PATCH`: atualiza campos permitidos (`agente_tipo`, `canal_tipo`, `ativo`, `display_name`, `unidade_cuca`) por `phone_number_id` (o `id` da rota é o `phone_number_id`)
- Campos não permitidos no PATCH: `waba_id`, `phone_number_id` (imutáveis após criação)

**`cuca-portal/src/app/(dashboard)/developer/page.tsx`** — adicionar card de acesso ao módulo
- Inserir card "Números WhatsApp (Meta)" na grade de módulos do Developer Console

### Constantes do formulário

```typescript
const AGENTES_META = ["Empregabilidade", "Institucional", "maria", "sofia", "ana"] as const
const CANAL_TIPOS_META = ["Empregabilidade", "Institucional", "Divulgação", "Ouvidoria", "Acesso"] as const
```

`unidade_cuca` no modal: usar `unidadesCuca` de `@/lib/constants` (já existente no projeto, mesma fonte de `/developer/instancias`).

### Guard de acesso (para @dev)

O layout `/developer/layout.tsx` já protege toda a sub-árvore via `isDeveloper` (baseado em `DEVELOPER_EMAILS` — `user-provider.tsx:200`). A nova page herda essa proteção automaticamente. Os endpoints de API precisam replicar a verificação server-side (ver escopo das routes acima).

### OUT

- Deletar registros (só desativar via `ativo = false`)
- Alterações no worker (já lê `meta_phone_numbers` dinamicamente — S-WM-03)
- Migração de banco (tabela e RLS existem desde S-WM-03)
- Criação/aprovação de templates na Meta
- Qualquer outra página fora do Developer Console

## Critérios de Aceite

1. **Given** usuário cujo email não está em `DEVELOPER_EMAILS`, **when** acessa `/developer/meta-numeros`, **then** é redirecionado para `/dashboard` (comportamento herdado do `DeveloperLayout` — sem código extra na page).

2. **Given** Super Admin acessa `/developer/meta-numeros`, **when** a página carrega, **then** exibe tabela com todos os registros de `meta_phone_numbers` ordenados por `display_name`.

3. **Given** Super Admin clica em uma linha da tabela, **when** edição inline ativa, **then** `agente_tipo` e `canal_tipo` tornam-se selects com os valores canônicos; `ativo` torna-se toggle; outros campos ficam somente leitura.

4. **Given** Super Admin altera `agente_tipo` e clica "Salvar", **when** PATCH `/api/admin/meta-phone-numbers/{phone_number_id}` executado, **then** `meta_phone_numbers` atualizado no banco e toast de sucesso exibido; worker passa a usar o novo `agente_tipo` na próxima requisição sem restart.

5. **Given** Super Admin clica "+ Adicionar Número" e preenche campos obrigatórios, **when** POST `/api/admin/meta-phone-numbers` executado, **then** novo registro criado e tabela recarregada.

6. **Given** POST com `phone_number_id` duplicado, **when** API recebe a requisição, **then** retorna 409 com mensagem `"phone_number_id já cadastrado"` e toast de erro exibido.

7. **Given** Super Admin toggle `ativo = false` em um número e salva, **when** worker processa próxima mensagem inbound desse `phone_number_id`, **then** `meta_phone_numbers` retorna `ativo = false` e o inbound descarta/registra conforme lógica existente.

8. **Given** `GET /api/admin/meta-phone-numbers` chamado sem sessão autenticada (ou por usuário não-developer), **when** a route handler executa a verificação de sessão, **then** retorna 401 antes de qualquer acesso ao banco — endpoints não são acessíveis sem cookie de sessão válido de um developer.

## Dependências

- S-WM-03 concluída (tabela `meta_phone_numbers` com schema canônico + UK em `phone_number_id`)
- Padrão de auth Super Admin do Developer Console (`/developer/instancias` como referência)
- `createAdminClient` de `@/lib/supabase/admin` (já existe no projeto)

## Riscos

- RLS em `meta_phone_numbers`: verificar se `service_role` consegue SELECT/INSERT/UPDATE sem restrição — esperado sim, mas @qa confirma via MCP antes do gate
- `phone_number_id` como parâmetro de rota: é um número de 16+ dígitos, não um UUID — sem impacto no Next.js `[id]` param, mas @dev verificar encoding na URL
- Endpoints de API sem guard de sessão: `createAdminClient` usa service_role mas não autentica o chamador — **@dev deve verificar sessão antes de operar** (corrigido no escopo acima; @qa verifica no gate)

## Estimativa

**S** — 1 dia de @dev + QA gate

## Dev Agent Record

### File List
- `cuca-portal/src/app/api/admin/meta-phone-numbers/route.ts` — novo (GET lista + POST cria, guard `assertDeveloper`)
- `cuca-portal/src/app/api/admin/meta-phone-numbers/[id]/route.ts` — novo (PATCH atualiza campos permitidos, guard `assertDeveloper`)
- `cuca-portal/src/app/(dashboard)/developer/meta-numeros/page.tsx` — novo (tabela, edição inline, modal "+ Adicionar Número")
- `cuca-portal/src/app/(dashboard)/developer/page.tsx` — modificado (card "Números WhatsApp (Meta)" adicionado à grade)

### Change Log
| Data | Agente | Ação |
|---|---|---|
| 2026-06-26 | @sm (River) | Story criada — aguardando revisão do usuário antes do @po |
| 2026-06-26 | @po (Pax) | Validação GO 9/10 — correções aplicadas: AC1 terminologia isDeveloper, AC8 + escopo routes com guard de sessão, risco de endpoint sem auth documentado — status Draft → Ready |
| 2026-06-26 | @dev (Dex) | Implementação concluída — TypeScript sem erros, 44/44 testes worker passando — status → Ready for Review |
| 2026-06-26 | @qa (Quinn) | QA gate — PASS WITH CONCERNS (Q1 LOW: DEVELOPER_EMAILS duplicado em 2 arquivos) — status → InReview |
