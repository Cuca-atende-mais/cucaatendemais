-- S-EMP-AUD-027: registra o template `transbordo_vaga_00` — notifica o contato de transbordo
-- (transbordo_humano, modulo='Empregabilidade') quando uma vaga ou seleção é criada e fica em
-- rascunho/pré-cadastro. Corpo/variáveis e status confirmados diretamente pelo Junior em
-- 2026-08-27 (template já "Ativo" no WhatsApp Manager — "Qualidade pendente" não bloqueia uso).
--
-- WABA/phone_number_id: mesmo número que a Empregabilidade já usa hoje para todo o resto
-- (convite de entrevista, feedback de empresa, transbordo por pedido de atendente humano) —
-- confirmado via meta_phone_numbers antes desta migration, sem risco de template no WABA errado.

INSERT INTO public.meta_templates
  (nome, categoria, status, automacoes, waba_ids, phone_number_ids, corpo_texto, variaveis, observacoes)
VALUES
  (
    'transbordo_vaga_00',
    'UTILITY',
    'aprovado',
    ARRAY['Empregabilidade','VagaCriada'],
    ARRAY['1524581392742603'],
    ARRAY['1222392144295329'],
    '⚠️ *Ação necessária*

Há um cadastro de vaga aguardando análise da equipe.

🏢 *Empresa:* {{1}}
💼 *Vaga:* {{2}}

Acesse o sistema para realizar a análise do cadastro.',
    '[{"posicao":1,"descricao":"nome_empresa"},{"posicao":2,"descricao":"titulo_vaga"}]'::jsonb,
    'Notifica o contato de transbordo da Empregabilidade quando uma vaga/seleção é criada (rascunho/pré-cadastro) — reaproveita _notificar_transbordo (worker/meta_adapter_inbound.py) via tag de automação "VagaCriada", distinta de "Transbordo" (pedido de atendente humano), que usa o mesmo phone_number_id (S-EMP-AUD-027).'
  )
ON CONFLICT (nome) WHERE ativo = true DO NOTHING;
