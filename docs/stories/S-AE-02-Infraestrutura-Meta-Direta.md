# S-AE-02 — Infraestrutura Meta Direta: Serviço `cuca-academia-enem`, Credenciais, Número e Templates

## Status
InProgress

## ⚠️ Story reescrita em 2026-08-20 — mudança de arquitetura
Esta story **substitui por completo** a versão anterior ("Instanciamento de Número via AuctaFlux BSP"). O plano de sair do AuctaFlux e ir direto para a Meta oficial (`docs/migracao-meta/PLANO-Academia-Enem-Migracao-Meta-Direta.md`) foi aprovado pelo Junior em 2026-08-20, incluindo a decisão de a Academia Enem usar uma **conta/Business Manager própria** (diferente da "Ivida", usada por Institucional/Empregabilidade/Ouvidoria/Acesso Cuca) — por isso ela roda num **serviço de backend isolado**, não como só mais uma linha na conta compartilhada. **As credenciais dessa conta já foram recebidas pelo Junior** — esta story é sobre **cadastrar e conectar**, não sobre obtê-las.

## Story
**Como** administrador do módulo Academia Enem,
**quero** um serviço próprio no EasyPanel, configurado com as credenciais da conta Meta da Academia Enem, conectado ao banco de produção e com o número/templates cadastrados,
**para que** o módulo consiga enviar e receber mensagens pela API oficial da Meta sem depender do AuctaFlux nem da conta "Ivida" dos outros módulos.

## Contexto
Substitui o AuctaFlux por completo (nenhum dado real de conversa existe hoje para migrar — `ae_conversas`/`ae_mensagens`/`ae_webhook_capturas` têm 0 linhas reais). O banco de dados usado pelo módulo passa a ser o mesmo dos outros canais (`conversas`, `mensagens`, `meta_phone_numbers`, `meta_templates`, `transbordo_humano` — ver S-AE-03/04/06 reescritas). Só a camada de credencial Meta e o endpoint de webhook ficam isolados, porque a Academia Enem usa uma conta Meta diferente da "Ivida".

## Escopo
### IN
1. **Criar o serviço `cuca-academia-enem`** no EasyPanel, dentro do projeto `cuca` (produção) — irmão de `cuca-worker` e `portal`, não um projeto separado.
2. **Cadastrar as credenciais da conta Meta da Academia Enem** nas variáveis de ambiente desse serviço (já recebidas pelo Junior): `META_APP_SECRET`, `META_VERIFY_TOKEN` (a definir por nós, mesma lógica do worker principal), `META_SYSTEM_USER_TOKEN`, mais `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` apontando para o **mesmo banco `cuca`** já usado pelo `cuca-worker`.
3. **Configurar o endereço de webhook** desse serviço (domínio/subdomínio próprio) e registrá-lo do lado da conta Meta da Academia Enem (verificação handshake `GET`, challenge/token).
4. **Testar a conexão** via terminal/`curl` antes de considerar pronto (ver Critérios de Aceite 4-5).
5. **Cadastrar o número/WABA da Academia Enem** em `meta_phone_numbers` (`phone_number_id`, `waba_id`, `agente_tipo='academia_enem'`, `canal_tipo='academia_enem'`) e os templates da Academia Enem em `meta_templates`.

### OUT
- Lógica de conversa/automação (S-AE-04), painel de atendimento (S-AE-03), RAG (S-AE-05), disparo (S-AE-09), upload de leads (S-AE-13) — todos dependem desta story, mas não são feitos aqui.
- Código do engine em si — só a infraestrutura que ele vai usar.

## Passo a passo — infraestrutura no EasyPanel

1. No projeto `cuca` (produção) do EasyPanel, criar um novo **App/Serviço** chamado `cuca-academia-enem`.
2. Apontar a origem do build para o mesmo repositório do worker (`worker/`, mesmo `Dockerfile`), como uma **instância separada** — mesma imagem/código, variáveis de ambiente diferentes.
3. Configurar a porta (padrão `8000`, igual ao `cuca-worker`) e gerar/associar um domínio próprio (ex.: `academia-enem.<domínio-cuca>` ou subdomínio equivalente) — esse é o endereço que vai receber o webhook da Meta.
4. Cadastrar as variáveis de ambiente do serviço novo (ver tabela abaixo).
5. Subir o serviço e confirmar healthcheck (`GET /health`) respondendo OK.

## Onde coletar/conferir as informações dentro da Meta (Business Suite / Developer)

> As credenciais já foram recebidas pelo Junior — esta seção documenta **onde elas vivem dentro da conta Meta**, para conferência e para quando precisar rotacionar.

| Informação | Onde fica na Meta | Usada como |
|---|---|---|
| **App ID / App Secret** | Meta for Developers → App da Academia Enem → Configurações Básicas | `META_APP_SECRET` |
| **Verify Token** | Definido por nós (qualquer string secreta) — cadastrado em Meta for Developers → WhatsApp → Configuração → Webhooks, no campo "Verify token" | `META_VERIFY_TOKEN` |
| **System User Token** | Business Manager da Academia Enem → Configurações de negócio → Usuários do sistema → gerar/gerenciar token com permissão `whatsapp_business_messaging` + `whatsapp_business_management` | `META_SYSTEM_USER_TOKEN` |
| **phone_number_id** | Meta for Developers → WhatsApp → Introdução (ou API Setup) → número ativo | linha em `meta_phone_numbers` |
| **waba_id** (WhatsApp Business Account ID) | Business Manager → Contas do WhatsApp Business | linha em `meta_phone_numbers` |

## Variáveis de ambiente do serviço `cuca-academia-enem`

| Variável | Valor | Observação |
|---|---|---|
| `META_APP_SECRET` | (da conta Meta da Academia Enem) | própria, **não** a da Ivida |
| `META_VERIFY_TOKEN` | (definida por nós) | própria, **não** a da Ivida |
| `META_SYSTEM_USER_TOKEN` | (da conta Meta da Academia Enem) | própria, **não** a da Ivida |
| `SUPABASE_URL` | `https://svzkrkfzpiqcesloukgb.supabase.co` | **mesma** do `cuca-worker` (banco compartilhado) |
| `SUPABASE_SERVICE_ROLE_KEY` | (mesma do `cuca-worker`) | mesma |
| `WEBHOOK_INTERNAL_TOKEN` | (mesma do `cuca-worker`, se este serviço expuser endpoints internos chamados pelo portal) | a definir pelo @dev conforme desenho do engine |
| `ENVIRONMENT` | `production` | — |

> `AUCTAFLUX_RESELLER_API_KEY` / `AUCTAFLUX_BASE_URL` **não existem** nesse serviço — não há AuctaFlux nesta arquitetura.

## Como testar a conexão (curl / terminal)

1. **Healthcheck do serviço:**
   ```
   curl -s https://<domínio-do-servico>/health
   ```
   Esperado: 200 OK.

2. **Handshake do webhook (equivalente ao que a Meta faz ao salvar a configuração):**
   ```
   curl -s "https://<domínio-do-servico>/webhook/meta?hub.mode=subscribe&hub.verify_token=<META_VERIFY_TOKEN>&hub.challenge=12345"
   ```
   Esperado: responde `12345` (eco do challenge) com status 200.

3. **Teste de envio via Graph API** (confirma que o `META_SYSTEM_USER_TOKEN` e o `phone_number_id` são válidos), rodado do terminal, **usando o número de teste já em análise**:
   ```
   curl -X POST "https://graph.facebook.com/v20.0/<phone_number_id>/messages" \
     -H "Authorization: Bearer <META_SYSTEM_USER_TOKEN>" \
     -H "Content-Type: application/json" \
     -d '{"messaging_product":"whatsapp","to":"<numero_de_teste>","type":"text","text":{"body":"teste de conexão cuca-academia-enem"}}'
   ```
   Esperado: resposta JSON com um `id` de mensagem (`wamid...`), sem erro de autenticação/permissão.

## Critérios de Aceite (Given/When/Then)
1. **Given** o serviço `cuca-academia-enem` criado no EasyPanel, **when** se acessa `/health`, **then** responde 200.
2. **Given** as variáveis de ambiente cadastradas, **when** a Meta salva a configuração do webhook apontando para o domínio do serviço, **then** o handshake (`GET /webhook/meta`) responde o challenge corretamente.
3. **Given** o `META_SYSTEM_USER_TOKEN` e o `phone_number_id` cadastrados, **when** se roda o teste de envio via `curl` para o número de teste, **then** a Meta retorna um `wamid` válido (sem erro 401/403).
4. **Given** o número/WABA da Academia Enem, **when** se consulta `meta_phone_numbers`, **then** existe uma linha com `agente_tipo='academia_enem'`, `ativo=true`.
5. **Given** os templates da Academia Enem (mesmo que ainda pendentes de aprovação pela Meta), **when** se consulta `meta_templates`, **then** existem linhas correspondentes com `automacoes` incluindo `'Academia Enem'`.
6. **Given** o serviço novo, **then** ele **nunca** lê nem escreve nenhuma variável `AUCTAFLUX_*` — não existem nesse serviço.

## Dev Notes — análise de impacto (item por item)

1. **Toca:** criação de serviço novo no EasyPanel (infraestrutura, fora do controle de agente — ação do Junior/`@devops` acompanhando) + inserts em `meta_phone_numbers`/`meta_templates` (tabelas compartilhadas com Institucional/Empregabilidade).
   **Depende disso hoje:** `worker/campanhas_engine.py` e `worker/meta_adapter_outbound.py` leem `meta_phone_numbers`/`meta_templates` para todos os canais — um `INSERT` novo não altera linhas existentes, é aditivo.
   **Impacto real:** nenhum, para os canais já em produção — é só uma linha nova numa tabela já compartilhada, sem alterar schema nem linhas de Institucional/Empregabilidade.
   **De-risk:** conferir com `execute_sql` (read-only) que o `phone_number_id` novo não colide com nenhum já cadastrado antes do insert.
2. **Toca:** criação de um serviço de backend novo, rodando o mesmo código do worker mas com credenciais Meta diferentes.
   **Depende disso hoje:** nada — é um serviço novo, sem consumidor existente.
   **Impacto real:** nenhum nos serviços existentes (`cuca-worker`, `portal`) — comprovadamente isolado (domínio, variáveis e processo próprios).
   **De-risk:** confirmar que o `SUPABASE_SERVICE_ROLE_KEY` usado é o mesmo do `cuca-worker` (evita criar uma segunda chave de serviço desnecessária) e que o healthcheck do novo serviço não compete por porta/recursos com os já existentes.

## Tasks
- [ ] **(Ação humana — Junior)** Criar serviço `cuca-academia-enem` no EasyPanel (projeto `cuca`), com domínio próprio.
- [ ] **(Ação humana — Junior)** Cadastrar variáveis de ambiente (tabela acima — @dev conferiu contra `worker/Dockerfile`/`worker/.env.example`, ver Dev Agent Record).
- [ ] **(Ação humana — Junior)** Configurar webhook do lado da Meta (conta da Academia Enem) apontando para o domínio novo.
- [ ] **(Ação humana — Junior)** Rodar os 3 testes via `curl`/terminal (healthcheck, handshake, envio).
- [x] Preparar migration de `meta_phone_numbers` (número/WABA da Academia Enem) — **não aplicada** (placeholder até o número real existir).
- [x] Preparar migration de `meta_templates` (templates da Academia Enem, `status='pendente'`) — **não aplicada** (idem).
- [x] Renomear o recurso RBAC `ae_instancia` → `ae_infra_meta` — **autorizado pelo Junior e concluído**: `UPDATE sys_permissions` (3 linhas) + rename em `constants.ts`/`perfis/page.tsx`.

## Dependências
Fundação de todo o módulo migrado. Bloqueia S-AE-03, S-AE-04, S-AE-06, S-AE-09, S-AE-13 (todas dependem do serviço/número existirem).

## Quality Gate
- Tipo: infraestrutura + configuração. Agentes: @devops (acompanha a criação do serviço, execução exclusiva do Junior em produção), @qa (confere via MCP que as linhas em `meta_phone_numbers`/`meta_templates` estão corretas e que RLS/policies não foram tocadas).

## File List
**Novos:**
- `cuca-portal/supabase/migrations/20260820000000_ae_meta_phone_numbers_templates_seed.sql` — migration idempotente com `INSERT` placeholder para `meta_phone_numbers`/`meta_templates` da Academia Enem. **Não aplicada** (`phone_number_id`/`waba_id` são placeholder — só existem após o pareamento).

**Modificados:**
- `cuca-portal/src/lib/constants.ts` — item de menu "Instâncias WhatsApp" agora usa `recurso: "ae_infra_meta"`.
- `cuca-portal/src/app/(dashboard)/configuracoes/perfis/page.tsx` — catálogo de perfis atualizado (`ae_instancia`→`ae_infra_meta`, rótulo sem menção a "AuctaFlux").

**Migration de banco:**
- Aplicada via `apply_migration` (`rename_ae_instancia_to_ae_infra_meta`): `UPDATE sys_permissions SET module='ae_infra_meta' WHERE module='ae_instancia'` — 3 linhas afetadas, confirmado 0 restantes em `ae_instancia`.

## Dev Agent Record

### Agent Model Used
Dex (@dev) — claude-sonnet-5

### Completion Notes
- **⚠️ Achado que muda a recomendação do @po — reportando antes de agir:** rodei a checagem `execute_sql` (read-only, projeto `svzkrkfzpiqcesloukgb`) pedida como pré-condição do rename. Ao contrário do que o @po registrou ("nunca atribuído a nenhuma role"), **existem 3 linhas** em `sys_permissions` com `module='ae_instancia'`:
  - `role_id` = **Developer** → `can_read/create/update/delete = true` (todos).
  - `role_id` = **Super Admin Cuca** → `can_read/create/update/delete = true` (todos).
  - `role_id` = **Atendente Geral** → `can_read/create/update/delete = false` (todos) — linha de negação explícita, não uma concessão real.
  - **Leitura:** isso é exatamente o padrão esperado do seed (`Super Admin Cuca`/`Developer` = bypass total; demais perfis = negado por padrão) — **nenhum perfil não-Developer tem acesso real hoje**.
- **✅ Rename autorizado pelo Junior e concluído nesta rodada:** `apply_migration` (`rename_ae_instancia_to_ae_infra_meta`) → `UPDATE sys_permissions SET module='ae_infra_meta' WHERE module='ae_instancia'` (3 linhas afetadas, confirmado via `execute_sql` 0 restantes em `ae_instancia`). Renomeado também em `constants.ts` (item de menu) e `perfis/page.tsx` (catálogo, rótulo sem "AuctaFlux").
- **⚠️ Achado adicional, fora do escopo autorizado desta rodada — reportando, não corrigindo:** existem **6 arquivos** (`cuca-portal/src/app/api/academia-enem/instancias/{route,assumir/route,liberar/route}.ts`, `webhook/auctaflux/route.ts`, `mensagens/enviar/route.ts`, `(dashboard)/academia-enem/instancias/page.tsx`) que ainda chamam `checkAuth("ae_instancia", ...)`/`hasPermission("ae_instancia", ...)` — a string antiga, hardcoded, não a variável do catálogo. **Não há regressão real hoje:** confirmei lendo a definição SQL de `has_permission` que o bypass de Developer/Super Admin (`is_developer()`) ocorre **antes** de qualquer checagem de `module`, e o único outro perfil com linha para esse recurso (`Atendente Geral`) já estava com tudo negado — então ninguém perde nem ganha acesso por causa do rename. Essas 6 referências pertencem à página/rotas antigas de "Instâncias AuctaFlux" (`ae_instancias`, `ae_conversas`, `ae_mensagens`), que a arquitetura reescrita (S-AE-02/03/04) já marca para **apagar** — não faz sentido corrigir a string nelas agora, é código morto que será removido, não mantido. Registrando para o @dev que pegar a implementação completa da S-AE-02 (criação real do serviço) não esquecer de apagar esses arquivos junto.
- **Variáveis de ambiente da story conferidas contra o código real:** `worker/.env.example` e `worker/Dockerfile` confirmam que o worker lê exatamente `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `META_SYSTEM_USER_TOKEN`, roda na porta `8000` com `gunicorn`/`uvicorn` e expõe `/health` — a tabela de variáveis e os testes via `curl` na story batem com o código real, nenhum ajuste necessário.
- **Migration de `meta_phone_numbers`/`meta_templates` preparada, não aplicada:** criada como placeholder explícito (`SUBSTITUIR_PHONE_NUMBER_ID`/`SUBSTITUIR_WABA_ID`), idempotente (`ON CONFLICT DO NOTHING`), aditiva — confirmado por leitura que não colide com as linhas já existentes de Institucional (`1233832826470497`) / Empregabilidade (`1245704551949387`). Não usei `apply_migration` porque os valores reais ainda não existem (dependem do pareamento, ação humana pendente).
- **Passos de infraestrutura (criação do serviço, webhook do lado da Meta, testes curl):** fora do alcance de qualquer agente — nenhuma ferramenta de EasyPanel/Meta Business Suite disponível. A story já documenta o passo a passo completo para o Junior executar manualmente; não há nada a "implementar" nessa parte além de revisar o texto, que já fiz.

### Debug Log References
- `execute_sql` (projeto `svzkrkfzpiqcesloukgb`): `SELECT ... FROM sys_permissions WHERE module='ae_instancia'` → 3 linhas (Developer, Super Admin Cuca, Atendente Geral). `SELECT id, name FROM sys_roles WHERE id IN (...)` → confirmou os 3 papéis acima.

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-06-11 | @sm (River) | Criação original da story (Instanciamento via AuctaFlux BSP) |
| 2026-06-13 | @po (Pax) | Decisão do cliente: fluxo Listar→Selecionar→Assumir via console AuctaFlux |
| 2026-08-20 | @sm (River) | **Reescrita completa (decisão do Junior):** AuctaFlux abandonado. Story vira "Infraestrutura Meta Direta" — criação do serviço `cuca-academia-enem` no EasyPanel, cadastro de credenciais próprias (conta Meta distinta da "Ivida"), passo a passo de coleta na Meta, testes via curl, e cadastro em `meta_phone_numbers`/`meta_templates`. Status resetado para Draft — aguarda validação @po. |
| 2026-08-20 | @po (Pax) | **Validação (GO, 8/10) → Status Draft→Ready.** Achado: `ae_instancia` já existe em código (não atribuído a nenhuma role) — task adicionada para renomear (não duplicar) e checar `sys_permissions` antes. Nenhuma referência residual a AuctaFlux/`ae_*` encontrada no texto. Dependência corretamente registrada como bloqueante de S-AE-03/04/06/09/13. |
| 2026-08-20 | @dev (Dex) | **Implementação parcial (Status Ready→InProgress).** Checagem `execute_sql` **corrigiu** a suposição do @po: existem 3 linhas em `sys_permissions` para `ae_instancia` (Developer/Super Admin Cuca = bypass esperado; Atendente Geral = negado). Rename **não executado**, aguarda decisão do Junior (ver Completion Notes). Migration placeholder de `meta_phone_numbers`/`meta_templates` criada e **não aplicada** (pendente do número real). Variáveis de ambiente da story conferidas contra `worker/.env.example`/`Dockerfile`, sem ajuste necessário. Passos de EasyPanel/Meta seguem pendentes de execução humana (fora do alcance de agente). |
| 2026-08-20 | @dev (Dex) | **Rename autorizado pelo Junior e concluído.** `apply_migration` renomeou as 3 linhas em `sys_permissions` (`ae_instancia`→`ae_infra_meta`); `constants.ts`/`perfis/page.tsx` atualizados. Confirmado, por leitura do SQL de `has_permission`, que não há regressão de acesso (bypass Developer ocorre antes de checar `module`; único outro perfil já estava negado). Achado adicional reportado: 6 arquivos de rotas/página do admin antigo de "Instâncias AuctaFlux" ainda referenciam a string antiga — código morto a apagar quando a implementação completa da S-AE-02 (serviço real) acontecer, não corrigido agora por estar fora do escopo desta rodada. Status permanece **InProgress** — falta a parte de infraestrutura (EasyPanel/Meta), que é ação exclusiva do Junior. |

## QA Results

**Revisor:** Quinn (@qa) · **Data:** 2026-08-20 · **Veredito do gate: PASS** (escopo desta rodada — rename RBAC + migration preparada; a parte de infraestrutura EasyPanel/Meta está fora do alcance de qualquer agente e não é avaliada aqui).

### Verificação independente (MCP, não me baseei só no relato do @dev)
1. **`sys_permissions`:** `execute_sql` confirma **0 linhas** com `module='ae_instancia'` e **3 linhas** com `module='ae_infra_meta'` — Developer e Super Admin Cuca com `can_read/create/update/delete=true`, Atendente Geral com tudo `false`. Bate exatamente com o relatado pelo @dev, sem divergência.
2. **`constants.ts`/`perfis/page.tsx`:** grep confirma **0 ocorrências residuais** de `ae_instancia` e presença de `ae_infra_meta` em ambos.
3. **Bypass Developer — verificado na fonte, não só citado:** puxei a definição de `is_developer()` diretamente do banco — checa `funcoes.nome='developer'` **e** e-mail numa lista fixa de 3 contas (`valmir@cucateste.com`, `dev.cucaatendemais@gmail.com`, `sec@cucateste.com`), **sem nenhuma referência a `module`/`sys_permissions`**. Confirma de forma independente que o bypass não depende da string do recurso — a claim do @dev de "sem regressão" está correta.
4. **6 arquivos com `ae_instancia` hardcoded:** grep confirma exatamente os mesmos 6 arquivos reportados (`instancias/route.ts`, `instancias/assumir/route.ts`, `instancias/liberar/route.ts`, `webhook/auctaflux/route.ts`, `mensagens/enviar/route.ts`, `instancias/page.tsx`). Nenhum a mais, nenhum a menos.
5. **Migration placeholder não aplicada:** `list_migrations` do projeto **não** lista `ae_meta_phone_numbers_templates_seed` — confirmado que ficou só como arquivo local, como pretendido. A migration do rename (`rename_ae_instancia_to_ae_infra_meta`, versão `20260820152433`) aparece aplicada, como esperado.

### 7 Quality Checks
1. **Code review** — ✅ Mudança mínima e cirúrgica (2 arquivos), sem acoplamento desnecessário.
2. **Testes** — N/A (rename de string de configuração; sem lógica nova a testar).
3. **Acceptance Criteria** — Os ACs da story (4-6, sobre `meta_phone_numbers`/`meta_templates`/curl) dependem da infraestrutura ainda não criada — corretamente não reivindicados como concluídos pelo @dev.
4. **Regressão** — ✅ Verificada na fonte (item 3 acima), não só por inspeção de código — o caminho de maior risco (perda de acesso do Developer) foi descartado com evidência do banco, não suposição.
5. **Performance** — N/A.
6. **Segurança** — ✅ Nenhum segredo/credencial exposto nos arquivos alterados ou na migration placeholder (usa `SUBSTITUIR_*`, não valores reais).
7. **Docs** — ✅ Completion Notes e File List completos, honestos sobre o que ficou pendente — inclusive o achado dos 6 arquivos, que o @dev **reportou em vez de silenciar** (correto: não era escopo autorizado consertar agora).

### Issues
| Sev | Cat | Descrição | Recomendação |
|-----|-----|-----------|--------------|
| Low | debt | 6 arquivos com `ae_instancia` hardcoded (código morto da UI antiga AuctaFlux) | Apagar junto da implementação completa da S-AE-02 (já anotado na própria story) — não bloqueia |
| Low | hygiene | Migration placeholder tem timestamp `20260820000000`, anterior ao rename já aplicado (`20260820152433`) | Ajustar o timestamp para depois do mais recente antes de aplicar de verdade — puramente cosmético, sem efeito funcional |

### Decisão de Gate
**PASS.** Todo o trabalho autorizado nesta rodada foi verificado de forma independente e bate com o relatado. Nenhuma regressão real. As duas issues são Low/não-bloqueantes. Os itens que restam (infraestrutura EasyPanel/Meta) são ação humana, fora do escopo de qualquer revisão de código.
