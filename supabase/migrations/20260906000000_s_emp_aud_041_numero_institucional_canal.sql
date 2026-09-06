-- S-EMP-AUD-041: adiciona a chave "institucional" (Cuca Atende+) em
-- configuracoes.numeros_canais_cuca, sem sobrescrever as chaves existentes.
-- Idempotente: INSERT ON CONFLICT faz merge via `||`, nunca substitui o objeto inteiro
-- (motor-agente lê esse mesmo JSON para os 4 canais de encaminhamento do Institucional).
insert into configuracoes (chave, valor)
values ('numeros_canais_cuca', jsonb_build_object('institucional', '5585999401027'))
on conflict (chave) do update
set valor = coalesce(configuracoes.valor, '{}'::jsonb) || jsonb_build_object('institucional', '5585999401027'),
    updated_at = now();
