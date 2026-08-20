# S-AE-01 — Padrão RBAC Transversal + Catálogo de Recursos (Academia Enem)

## Status
Ready (Padrão transversal — não é story de implementação isolada)

## Natureza desta story
⚠️ **Reformulada** (decisão @po, 2026-06-11): RBAC **não** é mais uma feature "big-bang" criada antes do módulo existir — isso geraria menus quebrados (404) e permissões fantasma. Aqui ela vira o **padrão transversal** e o **catálogo canônico de recursos** que [[S-AE-00]] inicia e **cada story de feature aplica à sua própria página** (fatia vertical: página + recurso RBAC juntos).

## Story
**Como** administrador do portal CUCA,
**quero** que cada funcionalidade do módulo Academia Enem seja autorizável individualmente (ver / criar / editar / apagar),
**para que** eu tenha GRANULARIDADE TOTAL — concretizada feature a feature, não num passo único.

## Modelo RBAC real (não inventar)
- Tabelas: `sys_roles` e `sys_permissions` (`module`, `can_read`, `can_create`, `can_update`, `can_delete`).
- Matriz dirigida por `MODULE_GROUPS` em `configuracoes/perfis/page.tsx`.
- Verificação: RPC `has_permission(p_recurso, p_acao)` (server-side) + hook `useUser().hasPermission(recurso, acao)` (UI).
- Menu: `lib/constants.ts` (`permission: { recurso, acao }`) + `components/layout/app-sidebar.tsx`.

## Catálogo canônico de recursos do módulo
| `module` (recurso) | Rótulo | Ações | Registrado em |
|---|---|---|---|
| `ae_painel` | Academia Enem: Painel Geral | read | **S-AE-00** |
| `ae_infra_meta` | Academia Enem: Infraestrutura Meta (serviço, número, templates) | read | S-AE-02 |
| `ae_rag` | Academia Enem: Base de Conhecimento (RAG) | read, create, update, delete | S-AE-05 |
| `ae_presenca` | Academia Enem: Importação de Presença | read, create, delete | S-AE-07 |
| `ae_kpis` | Academia Enem: KPIs / Dashboard de Presença | read | S-AE-11 |
| `atendimentos_academia_enem` | Academia Enem: Atendimento (Chat WhatsApp) | read, update | S-AE-03 |
| `ae_transbordo_config` | Academia Enem: Config. de Transbordo | read, update | S-AE-06 |
| `ae_leads_filtro` | Academia Enem: Filtro de Leads / Tag de Matrícula | read, update | S-AE-08 |
| `ae_disparo` | Academia Enem: Disparo de Avisos (módulo próprio) | read, create, update | S-AE-09 |
| `ae_leads_upload` | Academia Enem: Upload de Planilha de Leads | read, create | S-AE-13 |

> **Atualizado em 2026-08-20** (decisão do Junior, cascata da migração Meta direta): `ae_instancia` foi renomeado para `ae_infra_meta` (a S-AE-02 deixou de ser "instanciamento via AuctaFlux" e virou a story de infraestrutura Meta direta — serviço `cuca-academia-enem`, credenciais, número e templates). Novo recurso `ae_leads_upload` para a S-AE-13 (nova). Total: **10 recursos.**
>
> **Achado da validação @po (2026-08-20):** confirmado por leitura do código (`cuca-portal/src/app/(dashboard)/configuracoes/perfis/page.tsx:91`) que `ae_instancia` **já existe hoje** no catálogo real do portal (rotulado "AuctaFlux"), mas **nunca foi atribuído** a nenhuma role em `sys_permissions` (a S-AE-02 antiga nunca chegou a implementar a fatia de UI que o consumiria). O @dev, ao implementar a S-AE-02 reescrita, deve **renomear** essa entrada em `constants.ts`/`perfis/page.tsx` (não criar uma segunda entrada duplicada) — de-risk: `execute_sql` (read-only) confirmando 0 linhas em `sys_permissions` com `module='ae_instancia'` antes de renomear (evita quebrar permissão já concedida a alguém). Também confirmado por leitura de `EXECUCAO-PRODUCAO-PASSO-A-PASSO.md` que o cadastro de `meta_phone_numbers`/`meta_templates` para os outros canais **nunca teve tela própria no portal** — foi sempre feito via SQL direto. Por isso `ae_infra_meta` foi rebaixado para **somente leitura** (não `create/update/delete`): a menos que uma tela de gestão seja pedida explicitamente depois, o cadastro do número/templates da Academia Enem também é feito via SQL/migration (S-AE-02), e o recurso RBAC serve só para eventualmente **visualizar** o status da infraestrutura no portal — sem inventar uma tela de CRUD que ninguém pediu.

## Regra de acesso "Developer" (bypass) — confirmação, não mecanismo novo
O sistema já tem esse comportamento hoje: o papel **`Super Admin Cuca`** ("Developer", atribuído hoje só ao Junior e ao sócio) recebe, via seed, **todas** as permissões de **todos** os módulos automaticamente — incluindo os 10 recursos acima (`ae_painel` já está no seed; os demais precisam ser adicionados ao mesmo seed conforme cada story os registra). **Nenhum outro perfil recebe acesso a nenhum recurso `ae_*` até que um administrador conceda explicitamente** na tela de Perfis. Isso já é o comportamento padrão do RBAC do projeto (RPC `has_permission`) — a exigência do Junior de "só Developer acessa direto, resto precisa de aprovação" é satisfeita simplesmente **não** atribuindo nenhum outro perfil a esses 10 recursos por padrão, e cada story de feature deve confirmar isso como parte do seu QA gate (nenhum perfil não-Developer com acesso não concedido).

## Critério transversal (Definition of Done aplicável a TODA story de feature)
> **Toda** story do módulo que entrega uma página/API DEVE, na mesma entrega:
> 1. Registrar seu `module` no grupo "Academia Enem" de `MODULE_GROUPS`;
> 2. Proteger a rota/menu com `permission: { recurso, acao: 'read' }`;
> 3. Validar **server-side** cada ação com `has_permission(recurso, acao)` (nunca confiar só na UI);
> 4. Ocultar na UI os controles cujo `hasPermission` é falso;
> 5. **Confirmar no seed do papel `Super Admin Cuca`** que o recurso novo está incluído (bypass Developer) e que nenhum outro perfil recebeu a permissão por padrão.

## Critérios de Aceite (verificáveis no fim do módulo)
1. **Given** o catálogo acima, **then** todos os 10 recursos existem na matriz de Perfis sob "Academia Enem".
2. **Given** qualquer API do módulo, **when** chamada sem permissão, **then** retorna 403 (server-side).
3. **Given** a observação de segurança, **then** nenhuma autorização é delegada a uma chave de provedor externo (AuctaFlux não existe mais nesse desenho) — a autenticação de acesso ao portal é sempre via `has_permission`.
4. **Given** cada feature entregue, **then** ela trouxe seu recurso RBAC junto (sem menu apontando para rota inexistente).
5. **Given** um usuário com papel diferente de `Super Admin Cuca`, **when** ele nunca recebeu permissão em nenhum recurso `ae_*`, **then** todo o ramo de menu "Academia Enem" fica invisível/bloqueado para ele.
6. **Given** o Junior ou o sócio (papel `Super Admin Cuca`), **then** todo o ramo "Academia Enem" já aparece acessível sem qualquer concessão manual adicional.

## Dependências
Inicia em [[S-AE-00]]. Aplicada por: S-AE-02, S-AE-03, S-AE-05, S-AE-06, S-AE-07, S-AE-08, S-AE-09, S-AE-11, S-AE-13.

## Quality Gate
- Tipo: padrão de governança. Agentes: @qa (auditoria final de cobertura RBAC). CodeRabbit: foco em qualquer rota sem `has_permission`.

## File List
_Sem arquivos próprios — verificado nas stories de feature._

## Change Log
| Data | Autor | Mudança |
|------|-------|---------|
| 2026-06-11 | @sm (River) | Criação como story RBAC (Draft) |
| 2026-06-11 | @sm (River) | Reformulada para padrão transversal + catálogo (decisão @po); fundação movida para S-AE-00 |
| 2026-08-20 | @sm (River) | **Redesenho (decisão do Junior, migração Meta direta):** `ae_instancia`→`ae_infra_meta` (S-AE-02 vira story de infraestrutura Meta); novo recurso `ae_leads_upload` (S-AE-13). Explicitado o comportamento de bypass do papel `Super Admin Cuca` ("Developer" — só Junior e sócio) vs. os demais perfis, que exigem concessão explícita. Status permanece Draft (padrão transversal, revalidado a cada feature). |
| 2026-08-20 | @po (Pax) | **Validação (GO, 9/10) → Status Draft→Ready.** Achado corrigido: `ae_infra_meta` rebaixado para `read`-only (não `create/update/delete`) — confirmado por leitura de código que nenhum canal existente tem tela própria para gerir `meta_phone_numbers`/`meta_templates` (sempre via SQL direto); e confirmado que `ae_instancia` já existe hoje em `constants.ts`/`perfis/page.tsx` sem nenhuma role atribuída — renomear, não duplicar (task adicionada na S-AE-02). |
