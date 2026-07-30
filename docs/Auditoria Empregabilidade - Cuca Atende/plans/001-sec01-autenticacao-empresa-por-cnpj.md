# Plan 001: Empresa deixa de ser "autenticada" só pelo CNPJ — lista de WhatsApps autorizados + transbordo

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md`.
>
> **v2 (2026-07-29)**: substitui o desenho anterior (coluna única
> `whatsapp_verificado`, bloqueio com mensagem estática). Desenho novo definido
> pelo Junior: lista de números autorizados por empresa + transbordo humano de
> verdade quando um número não-autorizado tenta agir. Se este plano já foi
> parcialmente implementado com o desenho v1, trate como STOP condition e
> reporte antes de prosseguir — não misture os dois desenhos.
>
> **Decisão de produto embutida neste plano, não sua para mudar sozinho**: o
> desenho abaixo (1º WhatsApp que tocar o CNPJ se vincula automaticamente;
> qualquer outro precisa passar por verificação humana via transbordo antes de
> ser adicionado à lista) foi escolhido explicitamente pelo Junior. Ele sabe e
> aceita a janela residual descrita em "Why this matters" — não invente uma
> verificação fora de banda (e-mail/SMS) antes do 1º vínculo sem essa decisão
> ser tomada separadamente.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED — muda o fluxo de retomada usado por toda empresa recorrente (não só cadastro novo); precisa de rollout cuidadoso pra não trancar usuário legítimo fora. Mitigado pelo desenho de "backfill no primeiro toque" (ver Step 2) — nenhuma empresa já cadastrada perde acesso no dia em que este plano for implementado.
- **Depends on**: none
- **Category**: security (broken authentication / identity takeover)
- **Planned at**: commit `bc6284d`, 2026-07-29 (v2 — substitui o planejamento original de commit `7b0b326`)

## Why this matters

Qualquer conversa que informe os 14 dígitos de um CNPJ já cadastrado recebe, sem mais nenhuma verificação, a identidade completa daquela empresa (`empresa_id`) pelo resto da sessão — inclusive acesso aos fluxos de **edição** e **cancelamento** de vaga (irreversível, pelo próprio texto do bot: "*não pode ser reativada*"). CNPJ não é segredo: está em nota fiscal, contrato, site de busca pública — e o próprio bot ecoa razão social/endereço/telefone da empresa via `_formatar_dados_cnpj` (dados puxados de `https://publica.cnpj.ws`), então nem precisa ser procurado, o bot mesmo confirma que aquele CNPJ existe e é válido. Qualquer pessoa que souber (ou pesquisar) o CNPJ de uma empresa concorrente pode registrar um número de WhatsApp qualquer como aquela empresa e cancelar/editar vagas reais dela, ou ver quantas candidaturas ela recebeu.

**O desenho deste plano fecha o caso mais comum e mais barato de atacar** (alguém que descobre o CNPJ de uma empresa que já está ativamente usando o canal) **mas tem uma janela residual, documentada com honestidade e aceita pelo Junior**: se um CNPJ está cadastrado no sistema mas **nunca foi tocado por nenhum WhatsApp ainda** (ex.: empresa cadastrada por um processo administrativo, ou uma migração de dados, sem nunca ter mandado mensagem), o **primeiro** número que mencionar aquele CNPJ é quem se vincula automaticamente — inclusive um atacante, se ele for o primeiro a tentar. Isso é uma janela bem mais estreita que o problema de hoje (hoje, *qualquer* número pode reivindicar *qualquer* CNPJ *a qualquer momento*, mesmo de uma empresa já ativa há meses) — mas não é zero. Fechar essa janela residual exigiria verificação fora de banda antes até do primeiro vínculo, decisão de produto separada, fora do escopo deste plano.

## Desenho (v2 — definido pelo Junior em 2026-07-29)

1. **1º contato com aquele CNPJ** (nenhum número autorizado ainda pra essa empresa): vincula automaticamente esse número como autorizado — igual ao v1, é o caminho de menor esforço/risco.
2. **Número já autorizado**: acesso normal, sem fricção nova.
3. **Número novo tentando mexer numa empresa que já tem 1+ número(s) autorizado(s)**: em vez de só recusar com uma mensagem estática (v1), **aciona transbordo humano de verdade**, reaproveitando o mecanismo já existente e usado hoje em `_processar_empregabilidade` (SQS-40 "Handover por Dúvida" e "Detecção por expressão natural", `worker/empregabilidade_engine.py:2164-2221`): marca `conversas.status = "awaiting_human"` e chama `_notificar_transbordo` (`worker/meta_adapter_inbound.py:371`), que avisa os colaboradores configurados em `human_handover_contacts` via template Meta.
4. **Colaborador verifica a legitimidade por fora** (ligação, e-mail, o que for já usado hoje pra isso) **e autoriza o número** através de uma tela mínima no portal — endpoint novo, ver Step 3.

Diferença chave do v1: a tabela deixa de ser `empresas.whatsapp_verificado` (1 valor) e passa a ser uma tabela própria `empresa_whatsapp_autorizados` (N valores por empresa, com quem autorizou e quando).

## Current state

`worker/empregabilidade_engine.py:753-768` (dentro de `_processar_empresa`, etapa `aguardando_cnpj`, confirmado ao vivo em 2026-07-29 — mesmos números de linha do planejamento original, código não sofreu drift):
```python
        # Verificar no banco
        emp_res = supabase.table("empresas").select("id, nome, nome_fantasia").eq("cnpj", cnpj_limpo).execute()
        if emp_res.data:
            empresa = emp_res.data[0]
            nome_exibicao = empresa.get("nome_fantasia") or empresa["nome"]
            await e(
                f"✅ Empresa *{nome_exibicao}* já está cadastrada!\n\n"
                "Deseja divulgar uma vaga agora? Responda *sim* ou *não*."
            )
            _set_fluxo(conversa_id, {
                "etapa": "aguardando_criar_vaga",
                "cnpj": cnpj_limpo,
                "empresa_id": empresa["id"],
                "empresa_nome": empresa["nome"],
                "empresa_nome_exibicao": nome_exibicao,
            })
            return
```
Nenhuma checagem de quem está mandando a mensagem (`phone`, já disponível como parâmetro de `_processar_empresa`) acontece aqui — o `empresa_id` é concedido de forma incondicional a quem souber o CNPJ.

`_processar_empresa` tem esta assinatura (confirme antes de editar — `instance_name`, `token`, `unidade_cuca` já estão disponíveis neste escopo, sem precisar passar nada novo):
```python
async def _processar_empresa(texto: str, phone: str, instance_name: str, token: str, lead_id: str, conversa_id: str, unidade_cuca: str | None) -> None:
```

**Padrão de transbordo já usado 2x nesta mesma função** (`worker/empregabilidade_engine.py:2164-2221`, SQS-40) — reaproveitar exatamente esse padrão, não inventar um novo:
```python
await e("Sua solicitação foi registrada. Em breve você será atendido por nossa equipe.")
supabase.table("conversas").update({"status": "awaiting_human", "updated_at": "now()"}).eq("id", conversa_id).execute()
from meta_adapter_inbound import _notificar_transbordo  # noqa: PLC0415
await _notificar_transbordo(conversa_id, "empregabilidade", unidade_cuca or None, instance_name, phone)
```
`_notificar_transbordo(conversa_id, modulo, unidade_cuca, phone_number_id_origem, lead_identificacao)` (assinatura real, `worker/meta_adapter_inbound.py:371`) só **notifica** os contatos em `human_handover_contacts` via template Meta (tag `Transbordo` + módulo, lookup relacional já existente em `meta_templates`) — não move nada de estado sozinho além do que o chamador já faz.

**Tela existente pra apoiar a autorização manual**: `cuca-portal/src/app/(dashboard)/empregabilidade/empresas/page.tsx` — lista de empresas já existe, é o lugar natural pra adicionar a ação "autorizar número". Usa o padrão de permissão `hasPermission`/`profile` via `useUser()` (`@/lib/auth/user-provider`), **não** o whitelist fixo de e-mails (`DEVELOPER_EMAILS`) usado pelas rotas `/developer/*` — confirmar qual permissão específica faz sentido (provavelmente a mesma já exigida pra editar/gerenciar empresas nesta tela, não inventar uma nova categoria de permissão sem necessidade).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Worker test suite | `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` | all pass, including new tests |
| Sanity import | `cd worker && python -c "import empregabilidade_engine"` | exits 0 |
| Portal typecheck | `cd cuca-portal && npx tsc --noEmit` | sem novos erros (comparar contra baseline antes de editar) |

## Scope

**In scope**:
- Nova migration criando a tabela `empresa_whatsapp_autorizados`.
- `worker/empregabilidade_engine.py`: o branch de "empresa já cadastrada" (`:753-768`) e o ponto de inserção de empresa nova (`confirmando_cadastro`/`confirmando_cadastro_com_correcao` — leia a função completa antes de editar, não assuma os números de linha sem reconferir).
- Endpoint novo no portal pra autorizar um número (`POST /api/admin/empregabilidade/empresas/[id]/autorizar-whatsapp` ou caminho equivalente — confirmar convenção de rotas já usada em `empregabilidade` antes de nomear).
- Ação mínima de UI em `empregabilidade/empresas/page.tsx` (ou um modal/expansão simples) pra listar números autorizados de uma empresa e adicionar um novo — não precisa ser uma tela nova dedicada, só uma ação a mais na tela existente.
- **Reversão automática de `awaiting_human` + aviso ao lead, no mesmo endpoint de autorização** (decisão do sócio, 2026-07-29 — ver Step 5, novo). Fecha o gap operacional confirmado em `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md` (seção "Ciclo completo de autenticação"): sem isso, autorizar um número exige 2 ações manuais desconectadas e o lead nunca é avisado que pode continuar.
- Novos testes em `worker/tests/test_empregabilidade_engine.py`.

**Out of scope**:
- Qualquer verificação fora de banda (e-mail, SMS) antes do 1º vínculo — ver nota de decisão de produto no topo.
- Remover/revogar um número já autorizado — este plano só cobre adicionar; revogação é decisão de produto separada (o que fazer com vagas já criadas por um número revogado, etc.).
- Os fluxos de edição/cancelamento em si (`selecionando_vaga_edicao`, `confirmando_cancelamento`) — eles já filtram corretamente por `empresa_id`; o problema é só como `empresa_id` é concedido, não o que é feito com ele depois.
- SEC-02, BUG-01 e qualquer outro achado da auditoria consolidada — planos separados.
- Login/senha completo pro portal de empresas — fora de escopo, decisão de produto maior (mencionado e descartado explicitamente pelo Junior como "ideal, mas não agora").

## Git workflow

- Branch: `fix/sec01-lista-numeros-autorizados`
- Commits separados: migration, depois lógica do worker, depois endpoint+UI do portal.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Migration

Nova migration (nome sugerido: `swm61_empresa_whatsapp_autorizados.sql`):
```sql
-- SEC-01 v2 (Junior, 2026-07-29): substitui a ideia original de 1 coluna
-- whatsapp_verificado por uma lista de números autorizados por empresa —
-- suporta múltiplos números legítimos (ex.: dono + RH) e guarda quem
-- autorizou cada um (NULL = vínculo automático no 1º contato; e-mail/nome
-- do colaborador = autorizado manualmente após transbordo).
CREATE TABLE public.empresa_whatsapp_autorizados (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    empresa_id uuid NOT NULL REFERENCES public.empresas(id) ON DELETE CASCADE,
    telefone character varying NOT NULL,
    autorizado_em timestamptz NOT NULL DEFAULT now(),
    autorizado_por character varying,
    UNIQUE (empresa_id, telefone)
);

CREATE INDEX empresa_whatsapp_autorizados_empresa_id_idx
    ON public.empresa_whatsapp_autorizados (empresa_id);
```
Confirmar RLS: seguir o mesmo padrão já usado em `empresas`/`candidaturas` (provavelmente service-role only, sem policy pública) — checar `information_schema` antes de assumir.

**Verify**: revisão visual (sem Postgres ao vivo nesta sessão de planejamento) + `information_schema.columns`/`information_schema.table_constraints` depois de aplicar, confirmando a UNIQUE constraint.

### Step 2: Checar/vincular no branch de empresa existente + vincular no cadastro novo

No branch de empresa já cadastrada (`:753-768`), substitua a concessão incondicional por uma checagem contra a lista:

```python
        emp_res = supabase.table("empresas").select("id, nome, nome_fantasia").eq("cnpj", cnpj_limpo).execute()
        if emp_res.data:
            empresa = emp_res.data[0]
            nome_exibicao = empresa.get("nome_fantasia") or empresa["nome"]

            autorizados_res = supabase.table("empresa_whatsapp_autorizados") \
                .select("telefone").eq("empresa_id", empresa["id"]).execute()
            telefones_autorizados = {row["telefone"] for row in (autorizados_res.data or [])}

            if not telefones_autorizados:
                # 1º toque nesse CNPJ (nunca autorizado antes) — vincula este número
                # automaticamente. Janela residual documentada em "Why this matters".
                supabase.table("empresa_whatsapp_autorizados").insert({
                    "empresa_id": empresa["id"], "telefone": phone, "autorizado_por": None,
                }).execute()
            elif phone not in telefones_autorizados:
                # Número diferente dos já autorizados — aciona transbordo humano real
                # em vez de só bloquear (mesmo padrão de SQS-40, :2164-2221).
                logger.warning(
                    f"[SEC-01] Tentativa de acessar empresa {empresa['id']} (CNPJ {cnpj_limpo}) "
                    f"de um WhatsApp não autorizado. phone={phone[:6]}****"
                )
                await e(
                    "Esse CNPJ já está cadastrado com outro número de WhatsApp autorizado. 🔒\n\n"
                    "Encaminhamos seu contato para verificação da nossa equipe — em breve alguém "
                    "vai confirmar e liberar o acesso, se for o caso."
                )
                supabase.table("conversas").update(
                    {"status": "awaiting_human", "updated_at": "now()"}
                ).eq("id", conversa_id).execute()
                from meta_adapter_inbound import _notificar_transbordo  # noqa: PLC0415
                await _notificar_transbordo(conversa_id, "empregabilidade", unidade_cuca or None, instance_name, phone)
                _set_fluxo(conversa_id, {})
                return

            await e(
                f"✅ Empresa *{nome_exibicao}* já está cadastrada!\n\n"
                "Deseja divulgar uma vaga agora? Responda *sim* ou *não*."
            )
            _set_fluxo(conversa_id, {
                "etapa": "aguardando_criar_vaga",
                "cnpj": cnpj_limpo,
                "empresa_id": empresa["id"],
                "empresa_nome": empresa["nome"],
                "empresa_nome_exibicao": nome_exibicao,
            })
            return
```

No ponto de inserção de empresa nova (`confirmando_cadastro`/`confirmando_cadastro_com_correcao` — leia a função completa antes de editar, os números de linha não foram reconferidos nesta v2), adicione, logo após o `.insert()` em `empresas` retornar o novo `id`:
```python
supabase.table("empresa_whatsapp_autorizados").insert({
    "empresa_id": <id_da_empresa_recem_criada>, "telefone": phone, "autorizado_por": None,
}).execute()
```

**Verify**: `cd worker && python -c "import empregabilidade_engine"` → exits 0.

### Step 3: Endpoint de autorização no portal

Rota nova (confirmar convenção de path já usada em `empregabilidade` antes de fixar — não necessariamente `/api/admin/...`, pode já existir um prefixo próprio pra rotas desse módulo):
- `POST` recebendo `{ telefone: string }`, autentica com o mesmo padrão de permissão já usado por `empregabilidade/empresas/page.tsx` (via `hasPermission`/`profile`, não `DEVELOPER_EMAILS`).
- Insere em `empresa_whatsapp_autorizados` com `autorizado_por` = e-mail do colaborador autenticado (não `null` — só o vínculo automático do Step 2 usa `null`).
- Trata conflito de UNIQUE (número já autorizado pra essa empresa) com 409, não 500.

**Verify**: `cd cuca-portal && npx tsc --noEmit` sem novos erros.

### Step 4: Ação mínima de UI

Em `empregabilidade/empresas/page.tsx` (ou um modal aberto a partir dela): mostrar, por empresa, a lista de `telefone`/`autorizado_em`/`autorizado_por` de `empresa_whatsapp_autorizados`, com um campo simples pra adicionar um número novo (chama o endpoint do Step 3). Não precisa de tela dedicada nem fluxo de revogação — é fora de escopo (ver "Out of scope").

**Verify**: `cd cuca-portal && npx tsc --noEmit` sem novos erros; teste manual visual (abrir a tela, ver a lista, adicionar um número de teste).

### Step 5 (novo, decisão do sócio 2026-07-29): reverter `awaiting_human` + avisar o lead, no mesmo endpoint de autorização

Fecha o gap confirmado em `docs/qa/PROPOSTA-implementacao-auditoria-empregabilidade.md` (seção "Ciclo completo de autenticação — confirmado ponto a ponto"): sem isso, autorizar o número (Step 3) não devolve a conversa pro controle da IA sozinho, e ninguém avisa o lead automaticamente.

No mesmo endpoint do Step 3 (`POST .../autorizar-whatsapp`), depois de inserir em `empresa_whatsapp_autorizados`:

1. **Buscar a conversa pelo telefone, nunca por `empresa_id`.** O `_set_fluxo(conversa_id, {})` do transbordo (Step 2, `:182`) já zera o `empreg_fluxo` no momento do handoff — uma busca por `metadata->empreg_fluxo->>empresa_id` (o padrão usado em `selecao/route.ts:84-90`) **não encontra nada**, porque esse campo já foi apagado. O caminho correto é: `telefone` recebido no próprio endpoint → `leads` (`.eq("telefone", telefone_normalizado)`) → `leads.id` → `conversas` (`.eq("lead_id", lead_id).eq("status", "awaiting_human")`, mais recente por `updated_at`). Confirmar o formato de `telefone` recebido vs. `leads.telefone` (ambos devem estar em dígito puro, mesma normalização usada no Plano 002) antes de comparar.
2. **Reverter o status**: `conversas.update({"status": "ativa", "updated_at": "now()"}).eq("id", conversa_id)` — mesma operação que hoje só existe via clique manual em "Retornar para IA" (`cuca-portal/src/components/chat/chat-window.tsx:236-248`).
3. **Avisar o lead**: enviar uma mensagem automática (reaproveitar `_meta_enviar`/o mesmo mecanismo usado pelo worker, não duplicar lógica de envio no portal se já existir uma rota server-side pra isso — confirmar antes de escrever uma nova) avisando que o acesso foi liberado e que pode reenviar o CNPJ para continuar.
4. Se nenhuma conversa em `awaiting_human` for encontrada para aquele telefone (ex.: autorização feita preventivamente, sem transbordo em andamento), pular os passos 2-3 sem erro — a autorização em si (Step 3) já foi concluída.

**Verify**: `cd cuca-portal && npx tsc --noEmit` sem novos erros; teste manual (simular transbordo, autorizar o número, confirmar que `conversas.status` volta pra `"ativa"` e que uma mensagem chega no número de teste).

## Test plan

Modelar em `TestEscapeHatchAguardandoCnpj` (`worker/tests/test_empregabilidade_engine.py:459+`) — mesmo padrão de `_fluxo_mock`, `monkeypatch.setattr(emp, "supabase", mock_sb)`, chamando `emp._processar_empresa(texto, phone, instance_name, token, lead_id, conversa_id, unidade_cuca)`.

1. `test_cnpj_novo_grava_autorizacao_automatica_no_cadastro` — fluxo de cadastro novo completo; assert que um `.insert()` em `empresa_whatsapp_autorizados` é chamado com `telefone` == o `phone` do teste e `autorizado_por` == `None`.
2. `test_cnpj_existente_numero_ja_autorizado_concede_acesso_normal` — mock `empresa_whatsapp_autorizados` retornando uma linha com `telefone` == o mesmo `phone` do teste; assert que `_set_fluxo` grava `etapa: "aguardando_criar_vaga"` normalmente, sem transbordo.
3. `test_cnpj_existente_lista_vazia_faz_backfill_e_concede_acesso` — mock `empresa_whatsapp_autorizados` retornando lista vazia; assert que um `.insert()` é chamado gravando o `phone` do teste (`autorizado_por: None`), **e** que o acesso é concedido normalmente nesta primeira vez (sem transbordo).
4. `test_cnpj_existente_numero_diferente_aciona_transbordo` — mock `empresa_whatsapp_autorizados` retornando uma linha com um `telefone` **diferente** do `phone` do teste; assert que: (a) a mensagem de encaminhamento é enviada, (b) `conversas.status` é atualizado pra `"awaiting_human"`, (c) `_notificar_transbordo` é chamado (mock/monkeypatch) com os argumentos corretos, (d) `_set_fluxo` é chamado com `{}` (reset), (e) o `empresa_id` **não** aparece em nenhum estado gravado.

**Verify**: `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` → all pass, incluindo os 4 novos.

## Done criteria

- [ ] Migration criada, com a tabela `empresa_whatsapp_autorizados` e a UNIQUE constraint
- [ ] `grep -n "empresa_whatsapp_autorizados" worker/empregabilidade_engine.py` mostra os pontos de leitura, backfill automático e transbordo
- [ ] `cd worker && python -m pytest tests/test_empregabilidade_engine.py -v` exits 0, incluindo os 4 novos testes
- [ ] Endpoint de autorização criado, com checagem de permissão e tratamento de conflito (409)
- [ ] Endpoint de autorização reverte `conversas.status` de `awaiting_human` para `ativa` (busca por telefone → lead → conversa, nunca por `empresa_id`) e envia mensagem automática ao lead
- [ ] Ação de UI mínima funcionando em `empregabilidade/empresas`
- [ ] Nenhum arquivo fora do escopo modificado (`git status`)
- [ ] `plans/README.md` desta pasta atualizado

## STOP conditions

- Este plano já ter sido parcialmente implementado com o desenho v1 (coluna `whatsapp_verificado` em vez da tabela nova) — não misturar os dois desenhos, parar e reportar.
- Os números de linha de `confirmando_cadastro`/`confirmando_cadastro_com_correcao` citados aqui não baterem com o código ao vivo — leia a função completa antes de assumir onde o `.insert()` de empresa nova acontece.
- Você se pegar implementando verificação por e-mail/SMS antes do 1º vínculo sem essa decisão ter sido tomada explicitamente — não é sua decisão, ver nota no topo.
- O teste 3 (backfill) revelar que existem múltiplas empresas com o mesmo CNPJ já cadastradas de formas conflitantes — isso seria um problema de dado pré-existente, pare e reporte em vez de decidir sozinho qual registro é o "certo".
- Não existir nenhuma permissão adequada já estabelecida pra proteger o endpoint do Step 3 (ex.: só existir `DEVELOPER_EMAILS` ou acesso público) — não inventar uma categoria de permissão nova sozinho; parar e perguntar qual perfil deve ter essa ação.

## Maintenance notes

- A janela residual (1º toque de um CNPJ nunca antes usado) está documentada em "Why this matters" — não é um bug deste plano, é uma limitação conhecida e aceita pelo Junior do desenho de menor esforço escolhido.
- Revogação de número autorizado (ex.: funcionário que saiu da empresa) não está coberta — se isso virar necessidade real, é um plano novo, não uma extensão silenciosa deste.
- `_notificar_transbordo` só **notifica**; não existe hoje nenhuma fila/painel de "empresas aguardando verificação" além da conversa individual no WhatsApp do colaborador — se o volume de transbordos desse tipo crescer, vale considerar uma view dedicada (fora de escopo agora).
