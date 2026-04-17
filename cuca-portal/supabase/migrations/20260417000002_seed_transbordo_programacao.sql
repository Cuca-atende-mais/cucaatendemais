-- SQS-45: Copiar contato de transbordo de transbordo_humano para human_handover_contacts
-- Patricia (5585986938307) estava em transbordo_humano[modulo=Institucional]
-- Worker institucional_engine busca em human_handover_contacts[modulo=programacao]
INSERT INTO public.human_handover_contacts (modulo, unidade_cuca, telefone_destino, nome_responsavel, ativo)
SELECT
    'programacao'      AS modulo,
    unidade_cuca,
    telefone           AS telefone_destino,
    responsavel        AS nome_responsavel,
    ativo
FROM public.transbordo_humano
WHERE modulo = 'Institucional'
ON CONFLICT DO NOTHING;
