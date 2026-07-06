# Execução em Produção — Pacote Passo-a-Passo (cuca, ref `svzkrkfzpiqcesloukgb`)

> **Natureza:** este documento é o roteiro para **você (Junior) executar pessoalmente** — nenhum agente aplica nada em produção (regra NON-NEGOTIABLE do projeto). Cada bloco é para copiar/colar no SQL Editor de produção, na ordem exata.
>
> **Protocolo:** para cada passo 🟡, rode a verificação, cole o resultado no chat, aguarde eu confirmar antes de aplicar a migration. Para os passos 🟢, pode aplicar direto — mas ainda assim me avise (mesmo que só "passo 9 ok") para eu manter o registro com timestamp.
>
> **Backup confirmado:** `cuca-PRODUCAO-backup-20260705-201702.dump` (2,3MB, 1496 TOC entries, íntegro). **CLI confirmado apontando para `svzkrkfzpiqcesloukgb`.**

---

## Pré-voo (antes do passo 1)

☐ Tag de restauração de código já criada? (`git tag restore/pre-wm-meta-producao-<data> <SHA de main atual>`, conforme Relatório 3)
☐ Backup confirmado — ✅ já feito (`cuca-PRODUCAO-backup-20260705-201702.dump`)
☐ Confirme que vai aplicar os passos **nesta ordem exata**, não pasta por pasta

Quando estiver pronto, comece pelo Passo 1.

---

## Passo 1 — 🟡 `seed_sys_roles_super_admin`

**1a. Rode esta verificação (V1) e cole o resultado aqui:**
```sql
SELECT id, name, description FROM sys_roles WHERE name = 'Super Admin Cuca';
```
```sql
SELECT id, email, role_id FROM colaboradores WHERE email = 'admin@cucadev.com.br';
```
**Esperado:** ambas 0 linhas. Se a 1ª retornar 1 linha, ok (idempotente, só confirme que quer esse role em prod). **Se a 2ª retornar 1 linha, PARE — não aplique — me avise antes de continuar** (e-mail de dev não deveria existir em produção).

**1b. Só depois da minha confirmação, aplique:**
```sql
DO $$
DECLARE
  v_role_id uuid;
BEGIN
  SELECT id INTO v_role_id FROM sys_roles WHERE name = 'Super Admin Cuca';
  IF v_role_id IS NULL THEN
    INSERT INTO sys_roles (name, description)
    VALUES ('Super Admin Cuca', 'Acesso total ao sistema — todos os módulos')
    RETURNING id INTO v_role_id;
  END IF;

  INSERT INTO sys_permissions (role_id, module, can_read, can_create, can_update, can_delete)
  VALUES
    (v_role_id, 'dashboard',                    true, true, true, true),
    (v_role_id, 'leads_overview',               true, true, true, true),
    (v_role_id, 'atendimentos_institucional',   true, true, true, true),
    (v_role_id, 'programacao_mensal',           true, true, true, true),
    (v_role_id, 'atendimentos_programacao',     true, true, true, true),
    (v_role_id, 'empreg_painel',                true, true, true, true),
    (v_role_id, 'atendimentos_empregabilidade', true, true, true, true),
    (v_role_id, 'empreg_empresas',              true, true, true, true),
    (v_role_id, 'empreg_vagas',                 true, true, true, true),
    (v_role_id, 'empreg_selecao',               true, true, true, true),
    (v_role_id, 'empreg_candidatos',            true, true, true, true),
    (v_role_id, 'empreg_banco_cv',              true, true, true, true),
    (v_role_id, 'empreg_curriculos',            true, true, true, true),
    (v_role_id, 'ae_painel',                    true, true, true, true),
    (v_role_id, 'atendimentos_academia_enem',   true, true, true, true),
    (v_role_id, 'ae_instancia',                 true, true, true, true),
    (v_role_id, 'ae_rag',                       true, true, true, true),
    (v_role_id, 'ae_presenca',                  true, true, true, true),
    (v_role_id, 'ae_kpis',                      true, true, true, true),
    (v_role_id, 'ae_leads_filtro',              true, true, true, true),
    (v_role_id, 'acesso_solicitacoes_n1',       true, true, true, true),
    (v_role_id, 'acesso_solicitacoes_n2',       true, true, true, true),
    (v_role_id, 'acesso_espacos',               true, true, true, true),
    (v_role_id, 'ouvidoria_painel',             true, true, true, true),
    (v_role_id, 'ouvidoria_eventos',            true, true, true, true),
    (v_role_id, 'divulgacao',                   true, true, true, true),
    (v_role_id, 'config_whatsapp',              true, true, true, true),
    (v_role_id, 'config_colaboradores',         true, true, true, true),
    (v_role_id, 'config_perfis',               true, true, true, true),
    (v_role_id, 'config_unidades',              true, true, true, true),
    (v_role_id, 'config_categorias',            true, true, true, true),
    (v_role_id, 'programacao_rag_global',       true, true, true, true)
  ON CONFLICT (role_id, module) DO NOTHING;

  UPDATE colaboradores
  SET role_id = v_role_id
  WHERE email = 'admin@cucadev.com.br'
    AND role_id IS NULL;
END $$;
```

---

## Passo 2 — 🟡 `seed_categoria_academia_enem_e_limpa_eventos_teste`

**2a. Rode esta verificação (V2) e cole o resultado aqui:**
```sql
SELECT id, titulo, data_inicio, categorias_alvo, created_at
FROM eventos_pontuais
WHERE data_inicio IS NULL
ORDER BY created_at;
```
**Critério:** se **todas** as linhas tiverem `(Teste)` no título (ou forem claramente placeholder), pode aplicar o `DELETE`. **Se qualquer linha parecer evento real, PARE — não aplique o DELETE — me avise.**

**2b. Só depois da minha confirmação, aplique:**
```sql
INSERT INTO categorias_interesse (nome)
SELECT 'Academia Enem'
WHERE NOT EXISTS (
    SELECT 1 FROM categorias_interesse WHERE nome = 'Academia Enem'
);

DELETE FROM eventos_pontuais
WHERE data_inicio IS NULL;
```
> Se a verificação 2a encontrar linha real: rode só o `INSERT` acima (categoria), e trate o `DELETE` manualmente depois, linha a linha.

---

## Passo 3 — 🟡 `fix_unidade_cuca_admin_e_role_developer`

**3a. Rode esta verificação (V3) e cole o resultado aqui:**
```sql
SELECT user_id, email, unidade_cuca FROM colaboradores WHERE user_id = '06d8d6fc-e287-40a1-aa4b-1cf3c6c7c3ab';
```
```sql
SELECT name, unidade_cuca FROM sys_roles WHERE name = 'Developer';
```
**Esperado:** query 1 com 0 linhas (UUID é de cuca-dev) — se vier 1 linha, confirme antes que é o admin de produção mesmo. Query 2: se 0 linhas, a 2ª parte é no-op.

**3b. Só depois da minha confirmação, aplique:**
```sql
DO $$
BEGIN
  UPDATE colaboradores
  SET unidade_cuca = NULL
  WHERE user_id = '06d8d6fc-e287-40a1-aa4b-1cf3c6c7c3ab'
    AND unidade_cuca IS DISTINCT FROM NULL;

  UPDATE sys_roles
  SET unidade_cuca = NULL
  WHERE name = 'Developer'
    AND unidade_cuca IS DISTINCT FROM NULL;
END $$;
```

---

## ~~Passo — `seed_dev01_developer_console`~~ — 🔴 PULAR, NÃO APLICAR

Não existe bloco aqui de propósito. Este arquivo cria `dev01@cucadev.com.br` com senha fixa — nunca deve rodar em produção.

---

## Passo 4 — 🟢 `wm01_placeholder`

Vazia (só comentário, sem DDL). Nada a rodar — só avise "passo 4 ok" para o registro.

---

## Passo 5 — 🟢 `create_meta_phone_numbers` (versão parcial — SEM o seed de teste)

**⚠️ NÃO é o arquivo original.** Rode exatamente este bloco (sem o `INSERT` final):
```sql
CREATE TABLE IF NOT EXISTS meta_phone_numbers (
    phone_number_id  varchar        NOT NULL,
    waba_id          varchar        NOT NULL,
    agente_tipo      varchar        NOT NULL,
    canal_tipo       varchar        NOT NULL,
    unidade_cuca     varchar,
    display_name     varchar,
    ativo            boolean        NOT NULL DEFAULT true,
    created_at       timestamptz    NOT NULL DEFAULT now(),
    updated_at       timestamptz    NOT NULL DEFAULT now(),
    CONSTRAINT meta_phone_numbers_pkey PRIMARY KEY (phone_number_id)
);

ALTER TABLE meta_phone_numbers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role full access" ON meta_phone_numbers;
CREATE POLICY "service_role full access" ON meta_phone_numbers
    FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated read" ON meta_phone_numbers;
CREATE POLICY "authenticated read" ON meta_phone_numbers
    FOR SELECT TO authenticated USING (true);
```

---

## Passo 6 — 🟢 `add_canal_ativo_conversas`

```sql
ALTER TABLE conversas
    ADD COLUMN IF NOT EXISTS canal_ativo varchar NOT NULL DEFAULT 'uazapi';
```

---

## Passo 7 — 🟢 `rename_instancia_uazapi_origem_id`

```sql
ALTER TABLE conversas ADD COLUMN IF NOT EXISTS origem_id varchar;

UPDATE conversas SET origem_id = instancia_uazapi WHERE origem_id IS NULL;

ALTER TABLE conversas ALTER COLUMN origem_id SET NOT NULL;

ALTER TABLE conversas DROP CONSTRAINT IF EXISTS conversas_lead_instancia_unique;
ALTER TABLE conversas ADD CONSTRAINT conversas_lead_id_origem_id_key UNIQUE (lead_id, origem_id);

ALTER TABLE conversas DROP COLUMN IF EXISTS instancia_uazapi;
```

---

## Passo 8 — 🟡 `wm04_insert_meta_phone_numbers`

**8a. Rode esta verificação (V4) e cole o resultado aqui:**
```sql
SELECT phone_number_id, display_name, ativo FROM meta_phone_numbers;
```
**Esperado:** 0 linhas (tabela recém-criada no passo 5).

**8b. Confirmação adicional (não é SQL) — confirme no Meta Business Manager, antes de aplicar:** que `1233832826470497` (Institucional) e `1245704551949387` (Empregabilidade) são os `phone_number_id` reais e ativos de produção.

**8c. Só depois de confirmar 8a e 8b, aplique:**
```sql
INSERT INTO public.meta_phone_numbers
  (phone_number_id, waba_id, agente_tipo, canal_tipo, unidade_cuca, display_name, ativo)
VALUES
  ('1233832826470497', '27334860332820469', 'Institucional',   'Institucional',   NULL, 'CUCA Institucional',   true),
  ('1245704551949387', '27334860332820469', 'Empregabilidade', 'Empregabilidade', NULL, 'CUCA Empregabilidade', true)
ON CONFLICT (phone_number_id) DO NOTHING;
```

---

## Passo 9 — 🟢 `wm12_replica_identity_full_conversas_mensagens`

```sql
ALTER TABLE public.conversas REPLICA IDENTITY FULL;
ALTER TABLE public.mensagens REPLICA IDENTITY FULL;
```

---

## Passo 10 — 🟢 `wm13_meta_templates`

```sql
CREATE TABLE IF NOT EXISTS public.meta_templates (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    nome text NOT NULL,
    categoria text CHECK (categoria IN ('UTILITY', 'MARKETING', 'AUTHENTICATION')),
    status text DEFAULT 'pendente' CHECK (status IN ('pendente', 'aprovado', 'rejeitado', 'pausado')),
    variaveis jsonb DEFAULT '[]'::jsonb,
    automacoes text[] DEFAULT '{}',
    waba_ids text[] DEFAULT '{}',
    phone_number_ids text[] DEFAULT '{}',
    observacoes text,
    ativo boolean DEFAULT true,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS meta_templates_automacoes_gin
    ON public.meta_templates USING gin(automacoes);

CREATE UNIQUE INDEX IF NOT EXISTS meta_templates_nome_unique
    ON public.meta_templates(nome);

ALTER TABLE public.meta_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "developer_admin_full_access" ON public.meta_templates;

CREATE POLICY "developer_admin_full_access" ON public.meta_templates
    USING (has_permission('meta_templates', 'read'))
    WITH CHECK (has_permission('meta_templates', 'write'));

INSERT INTO public.meta_templates (nome, categoria, automacoes, observacoes)
VALUES
    ('cuca_transbordo_colaborador', 'UTILITY',
     ARRAY['Empregabilidade','Institucional','Programação','Ouvidoria'],
     'Notifica colaborador ao assumir atendimento via transbordo (usado por _notificar_transbordo)'),
    ('cuca_programacao_mensal', 'MARKETING',
     ARRAY['Institucional'],
     'Disparo global mensal de programação cultural (processar_disparos_divulgacao)'),
    ('cuca_evento_pontual', 'UTILITY',
     ARRAY['Institucional'],
     'Disparo de evento pontual aprovado (campanhas_engine._processar_item_disparo)'),
    ('cuca_convite_entrevista', 'UTILITY',
     ARRAY['Empregabilidade'],
     'Convite de entrevista enviado ao candidato após seleção'),
    ('cuca_feedback_empresa', 'UTILITY',
     ARRAY['Empregabilidade'],
     'Feedback consolidado enviado à empresa após processo seletivo'),
    ('cuca_pesquisa_ouvidoria', 'UTILITY',
     ARRAY['Ouvidoria'],
     'Pesquisa de satisfação enviada pelo canal Ouvidoria'),
    ('cuca_alerta_evento_pontual', 'UTILITY',
     ARRAY['Institucional'],
     'Alerta para super_admin: novo evento pontual aguardando aprovação'),
    ('cuca_alerta_handover', 'UTILITY',
     ARRAY['Empregabilidade','Institucional','Programação','Ouvidoria'],
     'Alerta de handover para operador da unidade (awaiting_human)'),
    ('cuca_alerta_acesso_n1', 'UTILITY',
     ARRAY['ana'],
     'Alerta N1 para coordenador: solicitação de acesso aguardando aprovação técnica'),
    ('cuca_alerta_acesso_n2', 'UTILITY',
     ARRAY['ana'],
     'Alerta N2 para secretaria: solicitação de acesso aguardando aprovação secretaria'),
    ('cuca_feedback_vaga', 'UTILITY',
     ARRAY['Empregabilidade'],
     'Confirmação de feedback de vaga enviada à empresa (feedback-submit route)'),
    ('cuca_alteracao_vaga', 'UTILITY',
     ARRAY['Empregabilidade'],
     'Notifica lead responsável quando empresa altera dados da vaga (vagas/[id] PATCH)')
ON CONFLICT (nome) DO NOTHING;
```
> Nota: estes 12 templates "cuca_*" são placeholders — os passos 11 e 12 os substituem pelos 6 templates reais aprovados na Meta. Isso é esperado, faz parte da mesma sequência.

---

## Passo 11 — 🟢 `wm14_corpo_texto_meta_templates`

```sql
ALTER TABLE public.meta_templates
  ADD COLUMN IF NOT EXISTS corpo_texto text,
  ADD COLUMN IF NOT EXISTS corpo_texto_aprovado text;

DELETE FROM public.meta_templates
WHERE nome IN (
  'cuca_transbordo_colaborador','cuca_programacao_mensal','cuca_evento_pontual',
  'cuca_convite_entrevista','cuca_feedback_empresa','cuca_pesquisa_ouvidoria',
  'cuca_alerta_evento_pontual','cuca_alerta_handover','cuca_alerta_acesso_n1',
  'cuca_alerta_acesso_n2','cuca_feedback_vaga','cuca_alteracao_vaga'
);

INSERT INTO public.meta_templates
  (nome, categoria, status, automacoes, corpo_texto, variaveis, observacoes)
VALUES
  ('cuca_transbordo_colaborador', 'UTILITY', 'aprovado',
   ARRAY['Empregabilidade','Institucional','Ouvidoria','Acesso CUCA'],
   'Olá {{1}}! Um novo atendimento foi transferido para você no canal {{3}}.

Lead: {{2}}

Acesse o portal para assumir a conversa.',
   '[{"posicao":1,"descricao":"nome do colaborador"},{"posicao":2,"descricao":"nome do lead"},{"posicao":3,"descricao":"canal de origem"}]'::jsonb,
   'Template unificado de transbordo. Usado por _notificar_transbordo (worker) e alertas-institucionais (edge fn).'),
  ('cuca_feedback_vaga', 'UTILITY', 'aprovado',
   ARRAY['Empregabilidade'],
   'Olá! Temos uma atualização sobre a vaga *{{1}}* na empresa *{{2}}*.

Aprovados nesta etapa: {{3}} candidato(s).

Acesse o portal para ver os detalhes.',
   '[{"posicao":1,"descricao":"título da vaga"},{"posicao":2,"descricao":"nome da empresa"},{"posicao":3,"descricao":"quantidade de aprovados"}]'::jsonb,
   'Feedback consolidado enviado à empresa após processo seletivo.'),
  ('cuca_evento_pontual', 'UTILITY', 'aprovado',
   ARRAY['Programação Pontual','Divulgação'],
   'Olá! Temos um evento especial para você:

*{{1}}*
{{2}}

📅 Data: {{3}}
🕒 Horário: {{4}}
📍 Local: {{5}}
🏢 Unidade: {{6}}

Confirme sua presença!',
   '[{"posicao":1,"descricao":"título do evento"},{"posicao":2,"descricao":"descrição"},{"posicao":3,"descricao":"data"},{"posicao":4,"descricao":"horário"},{"posicao":5,"descricao":"local"},{"posicao":6,"descricao":"unidade CUCA"}]'::jsonb,
   'Disparo pontual para leads (campanhas_engine._processar_item_disparo).'),
  ('cuca_evento_pontual_admin', 'UTILITY', 'aprovado',
   ARRAY['Institucional'],
   'Novo evento aguardando aprovação:

*{{1}}*
Unidade: {{2}}
Data: {{3}}

Acesse o portal para aprovar ou rejeitar.',
   '[{"posicao":1,"descricao":"título do evento"},{"posicao":2,"descricao":"unidade CUCA"},{"posicao":3,"descricao":"data do evento"}]'::jsonb,
   'Alerta para super_admin: novo evento aguardando aprovação (alertas-institucionais).'),
  ('cuca_programacao_mensal', 'MARKETING', 'aprovado',
   ARRAY['Divulgação'],
   'Olá, {{1}}! 🎉

A programação de *{{2}}* do CUCA chegou!

{{3}}

Contamos com sua presença!',
   '[{"posicao":1,"descricao":"nome do lead"},{"posicao":2,"descricao":"mês e ano"},{"posicao":3,"descricao":"link ou mensagem da programação"}]'::jsonb,
   'Disparo global mensal de programação cultural (campanhas_engine.processar_disparos_divulgacao).'),
  ('cuca_pesquisa_ouvidoria', 'UTILITY', 'aprovado',
   ARRAY['Ouvidoria'],
   'Olá, {{1}}!

Sua opinião é muito importante para nós. Responda nossa pesquisa de satisfação:

{{2}}',
   '[{"posicao":1,"descricao":"nome do lead"},{"posicao":2,"descricao":"texto da pesquisa"}]'::jsonb,
   'Pesquisa de satisfação enviada pelo canal Ouvidoria (campanhas_engine).')
ON CONFLICT (nome) DO NOTHING;
```

---

## Passo 12 — 🟢 `wm16_templates_relacionais`

```sql
DROP INDEX IF EXISTS public.meta_templates_nome_unique;
CREATE UNIQUE INDEX IF NOT EXISTS meta_templates_nome_unique
    ON public.meta_templates(nome) WHERE ativo = true;

DELETE FROM public.meta_templates
WHERE nome IN ('cuca_transbordo_colaborador', 'cuca_programacao_mensal', 'cuca_feedback_vaga');

INSERT INTO public.meta_templates
    (nome, categoria, status, automacoes, phone_number_ids, waba_ids, corpo_texto, variaveis, observacoes, ativo)
VALUES
    ('institucional_programacao_mensal_v1', 'MARKETING', 'aprovado',
     ARRAY['Institucional'], ARRAY['1233832826470497'], ARRAY['27334860332820469'],
     'Olá, {{1}}! Esta mensagem atualiza a sua inscrição para receber as programações da Rede Cuca. A programação de {{2}} já está disponível. Em caso de dúvidas, responda por este canal.',
     '[{"posicao":1,"descricao":"nome"},{"posicao":2,"descricao":"mes"}]'::jsonb,
     'Disparo global mensal de programação cultural (campanhas_engine.processar_disparos_divulgacao). 2 parâmetros confirmados por Junior no template real aprovado na Meta.', true),
    ('institucional_programacao_pontual_v1', 'UTILITY', 'aprovado',
     ARRAY['Institucional', 'Pontual'], ARRAY['1233832826470497'], ARRAY['27334860332820469'],
     'Olá, {{1}}! 👋 {{2}} {{3}} 📅 Data: {{4}} 🕐 Horário: {{5}} 📍 Local: {{6}} Dúvidas? Pergunte aqui nesse canal',
     '[{"posicao":1,"descricao":"nome"},{"posicao":2,"descricao":"titulo_evento"},{"posicao":3,"descricao":"descricao_evento"},{"posicao":4,"descricao":"data_evento"},{"posicao":5,"descricao":"horario_evento"},{"posicao":6,"descricao":"local_evento"}]'::jsonb,
     'Catálogo — aprovado na Meta, sem wiring de código de envio nesta story (S-WM-16 Task 2). Migração futura.', true),
    ('institucional_transbordo_v1', 'UTILITY', 'aprovado',
     ARRAY['Institucional', 'Transbordo'], ARRAY['1233832826470497'], ARRAY['27334860332820469'],
     'Olá {{1}}, o cidadão {{2}} solicitou atendimento humano no canal {{3}}. Acesse o portal para assumir a conversa.',
     '[{"posicao":1,"descricao":"colaborador"},{"posicao":2,"descricao":"lead"},{"posicao":3,"descricao":"canal"}]'::jsonb,
     'Notificação de transbordo — canal Institucional. Usado por _notificar_transbordo (worker/meta_adapter_inbound.py).', true),
    ('empregabilidade_convite_entrevista_v1', 'UTILITY', 'aprovado',
     ARRAY['Empregabilidade', 'Convite'], ARRAY['1245704551949387'], ARRAY['27334860332820469'],
     'Olá, {{1}}. Esta é uma atualização do seu processo seletivo para a vaga {{2}}. Sua participação na próxima etapa está disponível conforme as informações abaixo. Data: {{3}} Horário: {{4}} Local: {{5}} Confirme sua presença respondendo a esta mensagem.',
     '[{"posicao":1,"descricao":"primeiro_nome"},{"posicao":2,"descricao":"titulo_vaga"},{"posicao":3,"descricao":"data_entrevista"},{"posicao":4,"descricao":"horario_entrevista"},{"posicao":5,"descricao":"local_entrevista"}]'::jsonb,
     'Catálogo — migração do D-5 pendente. Aprovado na Meta, sem wiring de código de envio nesta story (S-WM-16 Task 2).', true),
    ('empregabilidade_feedback_empresa_v1', 'UTILITY', 'aprovado',
     ARRAY['Empregabilidade'], ARRAY['1245704551949387'], ARRAY['27334860332820469'],
     'Olá, equipe de RH da {{1}}. Esta é uma atualização referente ao processo seletivo da vaga {{2}}. Os candidatos encaminhados aguardam a conclusão da etapa de avaliação. Para registrar o feedback, acesse: {{3}} O link permanecerá disponível por 48 horas.',
     '[{"posicao":1,"descricao":"nome_empresa"},{"posicao":2,"descricao":"titulo_vaga"},{"posicao":3,"descricao":"link_feedback"}]'::jsonb,
     'Usado por feedback-submit/route.ts (lookup relacional). ATENÇÃO: esse endpoint hoje envia 3 parâmetros diferentes (título/empresa/contagem, sem link) — corpo_texto documenta o template real aprovado, mas o envio atual ainda não usa exatamente esses valores/ordem. Divergência aceita por Junior (S-WM-16), a corrigir em story futura.', true),
    ('empregabilidade_transbordo_v1', 'UTILITY', 'aprovado',
     ARRAY['Empregabilidade', 'Transbordo'], ARRAY['1245704551949387'], ARRAY['27334860332820469'],
     'Olá {{1}}, o cidadão {{2}} solicitou atendimento humano no canal {{3}}. Acesse o portal para assumir a conversa.',
     '[{"posicao":1,"descricao":"colaborador"},{"posicao":2,"descricao":"lead"},{"posicao":3,"descricao":"canal"}]'::jsonb,
     'Notificação de transbordo — canal Empregabilidade. Usado por _notificar_transbordo (worker) e empregabilidade_engine.py.', true)
ON CONFLICT (nome) WHERE ativo = true DO NOTHING;
```

---

## Passo 13 — 🟢 `wm16_remover_templates_cuca_legado`

```sql
DELETE FROM public.meta_templates
WHERE nome IN ('cuca_evento_pontual', 'cuca_evento_pontual_admin', 'cuca_pesquisa_ouvidoria');
```

---

## Passo 14 — 🟡 `wm16_desativar_numero_teste_institucional`

**14a. Rode esta verificação (V5) e cole o resultado aqui:**
```sql
SELECT phone_number_id, ativo FROM meta_phone_numbers WHERE phone_number_id = '1215172285010519';
```
**Esperado:** 0 linhas → o passo abaixo aplica como no-op seguro (não há número de teste em produção, já que o passo 5 foi aplicado sem o seed).

**14b. Aplique (seguro em qualquer resultado da 14a):**
```sql
UPDATE public.meta_phone_numbers
SET ativo = false
WHERE phone_number_id = '1215172285010519' AND ativo = true;
```

---

## Passo 15 — 🟢 `debug_wamid_capture_temporario`

```sql
CREATE TABLE IF NOT EXISTS public._debug_wamid_capture (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    wamid text,
    phone_number_id text,
    recebido_em timestamptz DEFAULT now()
);
```

---

## Passo 16 — 🟢 `wm17_remover_debug_wamid_capture`

```sql
DROP TABLE IF EXISTS public._debug_wamid_capture;
DROP TABLE IF EXISTS public._debug_wamid_capture_rota;
```

---

## Passo 17 — 🟢 `debug_wamid_capture_rota_temporario`

```sql
CREATE TABLE IF NOT EXISTS public._debug_wamid_capture_rota (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    wamid text,
    phone_number_id text,
    recebido_em timestamptz DEFAULT now()
);
```
> Sim, isto recria a tabela que o passo 16 acabou de dropar — é a ordem real dos arquivos (`040000 → 043531 → 050000`). O passo 22 remove ela de vez no final.

---

## Passo 18 — 🟢 `wm20_wamid_dedupe_mensagens`

```sql
ALTER TABLE public.mensagens ADD COLUMN IF NOT EXISTS wamid text;

CREATE UNIQUE INDEX IF NOT EXISTS mensagens_wamid_unique
    ON public.mensagens (wamid)
    WHERE wamid IS NOT NULL;
```

---

## Passo 19 — 🟢 `wm19_rls_disparos_divulgacao_insert_update`

```sql
drop policy if exists "auth_insert_disparos_divulgacao" on public.disparos_divulgacao;
create policy "auth_insert_disparos_divulgacao"
on public.disparos_divulgacao for insert
to authenticated
with check (public.has_permission('divulgacao', 'create'));

drop policy if exists "auth_update_disparos_divulgacao" on public.disparos_divulgacao;
create policy "auth_update_disparos_divulgacao"
on public.disparos_divulgacao for update
to authenticated
using (public.has_permission('divulgacao', 'update'))
with check (public.has_permission('divulgacao', 'update'));
```

---

## Passo 20 — 🟢 `wm19_meta_templates_parameter_format`

```sql
alter table public.meta_templates
  add column if not exists parameter_format text not null default 'NAMED'
  check (parameter_format in ('NAMED', 'NUMBERED'));
```

---

## Passo 21 — 🟢 `wm19_leads_soft_delete`

```sql
alter table public.leads
  add column if not exists excluido boolean not null default false;

create index if not exists idx_leads_excluido on public.leads (excluido);
```

---

## Passo 22 — 🟢 `cleanup_remove_debug_wamid_capture_rota` (NOVA — resolve o achado do Relatório 4)

```sql
DROP TABLE IF EXISTS public._debug_wamid_capture_rota;
```

---

## Pós-cutover

☐ Rodar Fase 5 do Relatório 3: healthcheck worker + portal, 1 fluxo E2E no canal principal, confirmar contagens de tabela-chave.
☐ Checklist de env vars do worker (`CHECKLIST-VARS-PRODUCAO-CUCA-WORKER.md`): confirmar `META_SYSTEM_USER_TOKEN`, `META_APP_SECRET`, `META_VERIFY_TOKEN` criadas no EasyPanel de produção.
☐ Redeploy `cuca-worker` e `portal` (produção) com o código de `main` pós-merge.

---

## Referências

- `PLANO-EXECUCAO-CUTOVER-MIGRATIONS.md` — plano original que este pacote executa
- `RELATORIO-3-plano-de-rollback.md` — procedimento de rollback se algo der errado
- `RELATORIO-4-auditoria-seguranca-migrations.md` — origem da análise de risco
- `ENSAIO-ROLLBACK-STAGING-20260705.md` — mesma sequência já validada em staging
- `AUDITORIA-GO-NOGO-MIGRACAO-META.md` — veredito GO que autoriza este cutover
