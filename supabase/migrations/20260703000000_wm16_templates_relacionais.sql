-- S-WM-16 Task 2: CRUD relacional de templates Meta — índice único parcial + dados reais
-- Vínculo passa a ser sempre automação + phone_number_id (nunca nome hardcoded no worker).

-- Índice único parcial: permite soft-delete (ativo=false) e recriar com o mesmo nome
DROP INDEX IF EXISTS public.meta_templates_nome_unique;
CREATE UNIQUE INDEX IF NOT EXISTS meta_templates_nome_unique
    ON public.meta_templates(nome) WHERE ativo = true;

-- Remove os registros substituídos pelos nomes reais aprovados na Meta
DELETE FROM public.meta_templates
WHERE nome IN ('cuca_transbordo_colaborador', 'cuca_programacao_mensal', 'cuca_feedback_vaga');

-- 6 templates reais (nomes e corpos aprovados na Meta, confirmados por Junior).
-- Tags de automacoes seguem o padrão: 1 tag = uso "padrão" do canal; 2ª tag = variante
-- específica, necessária pra desambiguar templates que compartilham automação + número.
INSERT INTO public.meta_templates
    (nome, categoria, status, automacoes, phone_number_ids, waba_ids, corpo_texto, variaveis, observacoes, ativo)
VALUES
    (
        'institucional_programacao_mensal_v1',
        'MARKETING', 'aprovado',
        ARRAY['Institucional'],
        ARRAY['1233832826470497'],
        ARRAY['27334860332820469'],
        'Olá, {{1}}! Esta mensagem atualiza a sua inscrição para receber as programações da Rede Cuca. A programação de {{2}} já está disponível. Em caso de dúvidas, responda por este canal.',
        '[{"posicao":1,"descricao":"nome"},{"posicao":2,"descricao":"mes"}]'::jsonb,
        'Disparo global mensal de programação cultural (campanhas_engine.processar_disparos_divulgacao). 2 parâmetros confirmados por Junior no template real aprovado na Meta.',
        true
    ),
    (
        'institucional_programacao_pontual_v1',
        'UTILITY', 'aprovado',
        ARRAY['Institucional', 'Pontual'],
        ARRAY['1233832826470497'],
        ARRAY['27334860332820469'],
        'Olá, {{1}}! 👋 {{2}} {{3}} 📅 Data: {{4}} 🕐 Horário: {{5}} 📍 Local: {{6}} Dúvidas? Pergunte aqui nesse canal',
        '[{"posicao":1,"descricao":"nome"},{"posicao":2,"descricao":"titulo_evento"},{"posicao":3,"descricao":"descricao_evento"},{"posicao":4,"descricao":"data_evento"},{"posicao":5,"descricao":"horario_evento"},{"posicao":6,"descricao":"local_evento"}]'::jsonb,
        'Catálogo — aprovado na Meta, sem wiring de código de envio nesta story (S-WM-16 Task 2). Migração futura.',
        true
    ),
    (
        'institucional_transbordo_v1',
        'UTILITY', 'aprovado',
        ARRAY['Institucional', 'Transbordo'],
        ARRAY['1233832826470497'],
        ARRAY['27334860332820469'],
        'Olá {{1}}, o cidadão {{2}} solicitou atendimento humano no canal {{3}}. Acesse o portal para assumir a conversa.',
        '[{"posicao":1,"descricao":"colaborador"},{"posicao":2,"descricao":"lead"},{"posicao":3,"descricao":"canal"}]'::jsonb,
        'Notificação de transbordo — canal Institucional. Usado por _notificar_transbordo (worker/meta_adapter_inbound.py).',
        true
    ),
    (
        'empregabilidade_convite_entrevista_v1',
        'UTILITY', 'aprovado',
        ARRAY['Empregabilidade', 'Convite'],
        ARRAY['1245704551949387'],
        ARRAY['27334860332820469'],
        'Olá, {{1}}. Esta é uma atualização do seu processo seletivo para a vaga {{2}}. Sua participação na próxima etapa está disponível conforme as informações abaixo. Data: {{3}} Horário: {{4}} Local: {{5}} Confirme sua presença respondendo a esta mensagem.',
        '[{"posicao":1,"descricao":"primeiro_nome"},{"posicao":2,"descricao":"titulo_vaga"},{"posicao":3,"descricao":"data_entrevista"},{"posicao":4,"descricao":"horario_entrevista"},{"posicao":5,"descricao":"local_entrevista"}]'::jsonb,
        'Catálogo — migração do D-5 pendente. Aprovado na Meta, sem wiring de código de envio nesta story (S-WM-16 Task 2).',
        true
    ),
    (
        'empregabilidade_feedback_empresa_v1',
        'UTILITY', 'aprovado',
        ARRAY['Empregabilidade'],
        ARRAY['1245704551949387'],
        ARRAY['27334860332820469'],
        'Olá, equipe de RH da {{1}}. Esta é uma atualização referente ao processo seletivo da vaga {{2}}. Os candidatos encaminhados aguardam a conclusão da etapa de avaliação. Para registrar o feedback, acesse: {{3}} O link permanecerá disponível por 48 horas.',
        '[{"posicao":1,"descricao":"nome_empresa"},{"posicao":2,"descricao":"titulo_vaga"},{"posicao":3,"descricao":"link_feedback"}]'::jsonb,
        'Usado por feedback-submit/route.ts (lookup relacional). ATENÇÃO: esse endpoint hoje envia 3 parâmetros diferentes (título/empresa/contagem, sem link) — corpo_texto documenta o template real aprovado, mas o envio atual ainda não usa exatamente esses valores/ordem. Divergência aceita por Junior (S-WM-16), a corrigir em story futura.',
        true
    ),
    (
        'empregabilidade_transbordo_v1',
        'UTILITY', 'aprovado',
        ARRAY['Empregabilidade', 'Transbordo'],
        ARRAY['1245704551949387'],
        ARRAY['27334860332820469'],
        'Olá {{1}}, o cidadão {{2}} solicitou atendimento humano no canal {{3}}. Acesse o portal para assumir a conversa.',
        '[{"posicao":1,"descricao":"colaborador"},{"posicao":2,"descricao":"lead"},{"posicao":3,"descricao":"canal"}]'::jsonb,
        'Notificação de transbordo — canal Empregabilidade. Usado por _notificar_transbordo (worker) e empregabilidade_engine.py.',
        true
    )
ON CONFLICT (nome) WHERE ativo = true DO NOTHING;
