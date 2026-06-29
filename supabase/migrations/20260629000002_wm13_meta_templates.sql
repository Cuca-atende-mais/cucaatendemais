-- S-WM-13: Gestão Dinâmica de Templates Meta
-- Cria tabela meta_templates + índice GIN + RLS + seed 12 templates

-- ─── Tabela ───────────────────────────────────────────────────────────────────

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

-- Índice GIN para lookup eficiente por automação
CREATE INDEX IF NOT EXISTS meta_templates_automacoes_gin
    ON public.meta_templates USING gin(automacoes);

-- Unique no nome para evitar duplicatas
CREATE UNIQUE INDEX IF NOT EXISTS meta_templates_nome_unique
    ON public.meta_templates(nome);

-- ─── RLS ──────────────────────────────────────────────────────────────────────

ALTER TABLE public.meta_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "developer_admin_full_access" ON public.meta_templates;

CREATE POLICY "developer_admin_full_access" ON public.meta_templates
    USING (has_permission('meta_templates', 'read'))
    WITH CHECK (has_permission('meta_templates', 'write'));

-- ─── Seed: 12 templates iniciais (status pendente) ────────────────────────────

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
