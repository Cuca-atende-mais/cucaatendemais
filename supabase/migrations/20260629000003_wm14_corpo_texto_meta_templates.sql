-- S-WM-14: corpo_texto editável — adicionar colunas + substituir seed

ALTER TABLE public.meta_templates
  ADD COLUMN IF NOT EXISTS corpo_texto text,
  ADD COLUMN IF NOT EXISTS corpo_texto_aprovado text;

-- Remover os 12 seeds fabricados da WM-13
DELETE FROM public.meta_templates
WHERE nome IN (
  'cuca_transbordo_colaborador',
  'cuca_programacao_mensal',
  'cuca_evento_pontual',
  'cuca_convite_entrevista',
  'cuca_feedback_empresa',
  'cuca_pesquisa_ouvidoria',
  'cuca_alerta_evento_pontual',
  'cuca_alerta_handover',
  'cuca_alerta_acesso_n1',
  'cuca_alerta_acesso_n2',
  'cuca_feedback_vaga',
  'cuca_alteracao_vaga'
);

-- 6 templates canônicos com corpo_texto
INSERT INTO public.meta_templates
  (nome, categoria, status, automacoes, corpo_texto, variaveis, observacoes)
VALUES
  (
    'cuca_transbordo_colaborador',
    'UTILITY',
    'aprovado',
    ARRAY['Empregabilidade','Institucional','Ouvidoria','Acesso CUCA'],
    'Olá {{1}}! Um novo atendimento foi transferido para você no canal {{3}}.

Lead: {{2}}

Acesse o portal para assumir a conversa.',
    '[{"posicao":1,"descricao":"nome do colaborador"},{"posicao":2,"descricao":"nome do lead"},{"posicao":3,"descricao":"canal de origem"}]'::jsonb,
    'Template unificado de transbordo. Usado por _notificar_transbordo (worker) e alertas-institucionais (edge fn).'
  ),
  (
    'cuca_feedback_vaga',
    'UTILITY',
    'aprovado',
    ARRAY['Empregabilidade'],
    'Olá! Temos uma atualização sobre a vaga *{{1}}* na empresa *{{2}}*.

Aprovados nesta etapa: {{3}} candidato(s).

Acesse o portal para ver os detalhes.',
    '[{"posicao":1,"descricao":"título da vaga"},{"posicao":2,"descricao":"nome da empresa"},{"posicao":3,"descricao":"quantidade de aprovados"}]'::jsonb,
    'Feedback consolidado enviado à empresa após processo seletivo.'
  ),
  (
    'cuca_evento_pontual',
    'UTILITY',
    'aprovado',
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
    'Disparo pontual para leads (campanhas_engine._processar_item_disparo).'
  ),
  (
    'cuca_evento_pontual_admin',
    'UTILITY',
    'aprovado',
    ARRAY['Institucional'],
    'Novo evento aguardando aprovação:

*{{1}}*
Unidade: {{2}}
Data: {{3}}

Acesse o portal para aprovar ou rejeitar.',
    '[{"posicao":1,"descricao":"título do evento"},{"posicao":2,"descricao":"unidade CUCA"},{"posicao":3,"descricao":"data do evento"}]'::jsonb,
    'Alerta para super_admin: novo evento aguardando aprovação (alertas-institucionais).'
  ),
  (
    'cuca_programacao_mensal',
    'MARKETING',
    'aprovado',
    ARRAY['Divulgação'],
    'Olá, {{1}}! 🎉

A programação de *{{2}}* do CUCA chegou!

{{3}}

Contamos com sua presença!',
    '[{"posicao":1,"descricao":"nome do lead"},{"posicao":2,"descricao":"mês e ano"},{"posicao":3,"descricao":"link ou mensagem da programação"}]'::jsonb,
    'Disparo global mensal de programação cultural (campanhas_engine.processar_disparos_divulgacao).'
  ),
  (
    'cuca_pesquisa_ouvidoria',
    'UTILITY',
    'aprovado',
    ARRAY['Ouvidoria'],
    'Olá, {{1}}!

Sua opinião é muito importante para nós. Responda nossa pesquisa de satisfação:

{{2}}',
    '[{"posicao":1,"descricao":"nome do lead"},{"posicao":2,"descricao":"texto da pesquisa"}]'::jsonb,
    'Pesquisa de satisfação enviada pelo canal Ouvidoria (campanhas_engine).'
  )

ON CONFLICT (nome) DO NOTHING;
