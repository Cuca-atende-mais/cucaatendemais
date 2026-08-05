# Exposição pública de dados pessoais via chave anon — currículos, auditoria e tokens de feedback

**Data:** 2026-08-05
**Autor:** @dev (Dex)
**Severidade:** CRÍTICA (dados pessoais de candidatos expostos a qualquer pessoa na internet — implicação LGPD)
**Status:** **Corrigido no banco em 2026-08-05** (migrations aplicadas em produção). Metade de código
(middleware) aguardando deploy. Pronto para @qa.

**Origem:** achado incidental durante a investigação do travamento em "Salvar e Imprimir"
(`DIAGNOSTICO-travamento-salvar-imprimir-curriculo-2026-08-05.md`). Ao inspecionar as policies de RLS da
tabela `curriculos` para entender o comportamento da página de impressão, encontrei a policy aberta.
Decisão de tratar como urgente e o direcionamento de fechar por RBAC vieram do Junior.

---

## 1. O problema

A tabela `public.curriculos` tinha uma única policy:

```
curriculos_all | FOR ALL | roles: PUBLIC | USING (true)
```

Sem restrição de role e sem nenhuma condição. Combinada com a rota `/empregabilidade/print` estar na
whitelist de rotas públicas do middleware (`cuca-portal/src/lib/supabase/middleware.ts`), o resultado era:
**qualquer pessoa na internet, usando apenas a chave anon** — que está embutida no bundle JavaScript
público do portal e é trivial de extrair — **conseguia listar todos os currículos**, sem filtro e sem
autenticação: nome, telefone, e-mail, endereço, histórico profissional.

**Confirmado empiricamente** contra produção, de fora, sem sessão: uma requisição simples retornou nomes
e telefones reais de candidatos em ~0,3s. Não era teórico.

### Por que estava assim

A rota de impressão foi colocada na whitelist pública com o comentário "impressão pública de currículo",
e a policy foi aberta para acomodar isso. Mas o levantamento mostrou que **essa premissa estava errada**:

- `curriculos` é lido/escrito **apenas** por páginas dentro de `(dashboard)` (autenticadas) e pela página
  de impressão. Nenhum worker, nenhuma Edge Function.
- A rota de impressão só é alcançada de dentro do dashboard: `router.push` na lista
  (`criar-curriculo/page.tsx:370`) e `printWindow.location.href` no editor
  (`criar-curriculo/[id]/page.tsx:273`). **Zero consumidores externos.**
- O mecanismo de link assinado (`EMPREGABILIDADE_LINK_SECRET`), que existe justamente para acesso externo
  legítimo, cobre **vagas, candidatura e seleção** — nunca impressão.

Ou seja: a rota nunca precisou ser pública. A policy aberta acomodava um engano.

---

## 2. Decisão (Junior, 2026-08-05)

> "somente os logados e com permissão em RBAC para isso, nem todo mundo vai poder criar curriculo, mesmo
> logado, só se tiver permissão."

- Fechar por **RBAC granular**, não apenas "estar logado".
- **Não conceder permissão nova a ninguém** — quem não tem o módulo cadastrado perde o acesso, e o
  caminho correto para reverter é conceder pela tela de RBAC, não reabrir a policy.
- Fechar **leitura e escrita na mesma rodada**.

---

## 3. Análise de impacto, item por item (regra `impact-analysis-mandatory.md`)

### 3.1 — Policy de `curriculos` → RBAC `empreg_curriculos`

1. **Toca:** as policies de RLS da tabela `curriculos`.
2. **Quem consome hoje:** as 7 chamadas listadas na seção 1 (todas em páginas do dashboard + página de
   impressão). Nenhum consumidor server-side com service_role depende da policy (service_role ignora RLS).
3. **Impacto real medido — simulado colaborador a colaborador ANTES de aplicar** (16 ativos):

   | Papel | Qtd | `empreg_curriculos` | Resultado |
   |---|---|---|---|
   | Admin Empregabilidade | 8 | CRUD completo | ✅ mantém |
   | Developer | 2 | CRUD + bypass | ✅ mantém |
   | Super Admin Cuca | 1 | CRUD + bypass | ✅ mantém |
   | **Gerente** | **4** | módulo não cadastrado | ❌ **perde** |
   | **Institucional** | **1** | módulo não cadastrado (e demais `empreg_*` já `false`) | ❌ perde |

   A perda dos 4 Gerentes é **intencional**, conforme a decisão acima. Registro o contexto para revisão
   futura: Gerente tem CRUD completo em `empreg_banco_cv` e `empreg_vagas`, ou seja, gerencia o banco de
   talentos por inteiro mas não poderá abrir/imprimir o currículo dos mesmos candidatos. Se isso se mostrar
   um problema operacional, a correção é conceder `empreg_curriculos` ao papel Gerente pela tela de RBAC.
   Institucional já tinha todas as permissões de empregabilidade em `false` — negar é coerente, não é
   regressão.
4. **De-risk concreto:** antes de aplicar, verifiquei que os 8 Admin Empregabilidade têm
   `can_read/can_create/can_update/can_delete = true` em `empreg_curriculos` — sem isso, fechar a leitura
   teria quebrado o salvamento dos usuários principais. Depois de aplicar, confirmei de fora que a
   enumeração anônima retorna vazio.

**Armadilha encontrada e evitada:** o RBAC tem dois sistemas com nomes diferentes — o antigo
(`permissoes`) usa recurso `empregabilidade`; o novo (`sys_permissions`) usa módulo `empreg_curriculos`.
`has_permission` casa o sistema novo via `module LIKE p_recurso || '%'`, então **`empregabilidade` não casa
`empreg_curriculos`**. Verifiquei que **zero** colaboradores passam pelo sistema antigo hoje — usar o nome
errado teria trancado todo mundo fora, deixando apenas os 3 bypass de admin.

### 3.2 — RPC `salvar_curriculo_estruturado` (escrita)

1. **Toca:** o gate de autorização da RPC.
2. **Quem consome:** o editor de currículo (`onSubmit`) e o encaminhamento para vaga (`handleVincular`).
3. **Impacto real:** a RPC é `SECURITY DEFINER` — **ignora RLS**. Fechar apenas a policy da tabela
   deixaria a escrita aberta a qualquer colaborador logado, mesmo sem permissão de currículos. Trocado o
   gate "é colaborador" por checagem de `has_permission('empreg_curriculos', ...)`, com `create` e
   `update` verificados separadamente no ramo correspondente. Toda a demais lógica (validações, upsert
   transacional, sincronização com `talent_bank`) permanece **idêntica** à original.
4. **De-risk:** confirmado que os papéis que usam a ferramenta têm `create` e `update`; confirmado de fora
   que a chamada anônima à RPC agora retorna `42501`.

### 3.3 — Middleware: remoção de `/empregabilidade/print` da whitelist

1. **Toca:** `publicEmpregabilidadePrefixes` em `cuca-portal/src/lib/supabase/middleware.ts`.
2. **Quem consome:** ninguém externo (seção 1). Usuários logados continuam acessando normalmente.
3. **Impacto real:** acesso anônimo à URL de impressão passa a redirecionar para `/login`. Para o usuário
   legítimo, nada muda. A página continua **fora** do route group `(dashboard)` — ou seja, segue sem o
   layout do dashboard, preservando a correção de impressão do commit `2d39696`.
4. **De-risk:** `eslint` e `tsc --noEmit` limpos. **Pendente de validação real após deploy** — ver seção 6.

---

## 4. Achados adicionais da mesma classe (encontrados na varredura)

Após fechar `curriculos`, varri o schema por outras policies `USING (true)` alcançáveis por anon:

| Tabela | Situação | Ação |
|---|---|---|
| **`audit_logs`** | Policy chamada *"Leitura de audit logs para super_admins"* mas com expressão `true` para PUBLIC — **o nome prometia uma restrição que a policy não aplicava**. Anon lia a trilha de auditoria inteira, incluindo snapshots completos de linhas (`dados_antigos`/`dados_novos`) e `usuario_id`. Hoje cobre `espacos_cuca` (27) e `ouvidoria_eventos` (3 — potencialmente sensível). | **Fechada.** Passa a fazer o que o nome sempre prometeu (developer/super admin). Verificado: **nenhum** código do portal lê `audit_logs`, então zero risco de quebra. |
| **`vagas_feedback_tokens`** | Anon podia **listar todos os tokens válidos** — permitindo enviar feedback se passando por qualquer empresa (bypass de autenticação do fluxo). | **Fechada.** Os 4 consumidores reais são API routes com `createAdminClient` (service_role), que ignora RLS — nenhum dependia desta policy. |
| `unidades_cuca` | Leitura pública de nome/endereço/telefone de equipamentos públicos. | **Mantida** — informação genuinamente pública, exposição intencional e sem dado pessoal. |

---

## 5. O que foi aplicado

**Banco (produção `svzkrkfzpiqcesloukgb`, aplicado via MCP conforme `cuca-deploy-environments.md` §3):**
- `20260805120000_curriculos_rls_rbac_fecha_exposicao_anon` — 4 policies granulares por ação em
  `curriculos`, restritas a `TO authenticated` (defesa em profundidade: `anon` deixa de ter qualquer policy
  aplicável), + RPC com checagem RBAC. Arquivo em `cuca-portal/supabase/migrations/`.
- `fecha_exposicao_anon_audit_logs_e_feedback_tokens` — `audit_logs` restrita a super admin;
  policy anon de `vagas_feedback_tokens` removida.

Ambas idempotentes (`DROP ... IF EXISTS` / `CREATE OR REPLACE`) e retrocompatíveis (as policies novas são
criadas **antes** de a permissiva ser removida).

**Código (aguardando deploy):**
- `cuca-portal/src/lib/supabase/middleware.ts` — `/empregabilidade/print` fora da whitelist pública.

### Verificação pós-aplicação (de fora, sem autenticação)

| Teste | Antes | Depois |
|---|---|---|
| Enumerar currículos | nomes e telefones reais | `[]` |
| Buscar currículo por id | dados completos | `[]` |
| Gravar via RPC | (não testado antes) | `401` — `42501 sem permissao` |
| Ler `audit_logs` | trilha completa | `[]` |
| Ler `vagas_feedback_tokens` | todos os tokens | `[]` |

---

## 6. Limites do que foi validado — leia antes de dar como encerrado

- **A correção do banco está verificada de fora e é objetiva** (tabela acima).
- **NÃO validei o caminho do usuário logado após a mudança.** Não tenho como autenticar como
  colaborador para exercer as policies novas. O risco concreto e específico: se `has_permission` se
  comportar de forma diferente do que a simulação SQL previu quando chamada de dentro do contexto RLS,
  usuários legítimos podem ver lista vazia ou erro ao salvar. A simulação replicou a lógica da função
  fielmente, e os 3 papéis com acesso têm CRUD completo — mas **isso é inferência, não observação**.
- **Teste obrigatório antes de considerar concluído** (@qa / Junior, após o deploy do middleware):
  1. Com um usuário **Admin Empregabilidade** (não Developer — o Developer tem bypass total e mascara
     qualquer erro de permissão): abrir a lista de Criar Currículo, abrir um currículo, salvar, e imprimir.
  2. Confirmar que a URL de impressão, aberta em janela anônima, redireciona para `/login`.
  3. Confirmar com um usuário **Gerente** que o acesso a currículos foi de fato negado (comportamento
     esperado pela decisão) — e avaliar se isso atrapalha a operação real da unidade.

---

## 7. Pendências registradas (não incluídas nesta correção)

- **Varredura ampla de RLS:** esta correção olhou policies `USING (true)` alcançáveis por anon. Não cobriu
  policies com condições fracas (ex.: que autorizam qualquer colaborador a ver dado de qualquer unidade).
  Vale um levantamento dedicado.
- **`talent_bank`:** guarda os mesmos dados pessoais dos candidatos e está protegida apenas no nível
  "é colaborador" (`EXISTS (SELECT 1 FROM colaboradores ...)`), sem RBAC. Não foi alterada aqui — mudar
  exigiria a mesma análise de impacto que foi feita para `curriculos`. **É a próxima peça lógica desta
  mesma correção.**
- **Erro React #418** (hydration mismatch) na página de criar currículo, visto no console do Junior — real,
  não relacionado a esta correção nem ao travamento.
- **Embed morto:** a página de impressão faz join em `talent_bank(nome)` que nunca é usado (por ordem de
  spread, `dados.nome` sempre sobrescreve; verificado: 0 de 35 currículos dependem do join). Limpeza
  pequena, deixada fora para manter esta mudança de segurança focada.
