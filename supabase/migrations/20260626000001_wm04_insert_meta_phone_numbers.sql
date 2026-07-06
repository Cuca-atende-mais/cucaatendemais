-- S-WM-04: registrar phone_number_ids dos dois números Meta já conectados.
-- waba_id 27334860332820469 é o WABA de staging/produção confirmado nos dados existentes.
-- ON CONFLICT DO NOTHING garante idempotência (PK = phone_number_id).

INSERT INTO public.meta_phone_numbers
  (phone_number_id, waba_id, agente_tipo, canal_tipo, unidade_cuca, display_name, ativo)
VALUES
  ('1233832826470497', '27334860332820469', 'Institucional',   'Institucional',   NULL, 'CUCA Institucional',   true),
  ('1245704551949387', '27334860332820469', 'Empregabilidade', 'Empregabilidade', NULL, 'CUCA Empregabilidade', true)
ON CONFLICT (phone_number_id) DO NOTHING;
