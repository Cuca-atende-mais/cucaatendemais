-- S-AE-16: isolamento total de conversas/mensagens da Academia Enem — reativação de
-- ae_conversas/ae_mensagens (S-AE-02) via desvio na entrada do webhook Meta.

-- increment_nao_lidas(uuid) é hardcoded para `conversas` — não serve para ae_conversas.
-- RPC própria, mesma semântica.
create or replace function public.ae_increment_nao_lidas(conv_id uuid) returns void
    language plpgsql
    as $$
begin
  update public.ae_conversas set nao_lidas = nao_lidas + 1 where id = conv_id;
end;
$$;

-- ae_instancias tem um único registro, herdado da era AuctaFlux (workspace pending_signup,
-- phone_number_id nulo) — órfão desde a migração para Meta direta (2026-08-20), quando a config
-- real do canal passou a viver em meta_phone_numbers (fonte de verdade pós-migração). O desvio
-- da entrada precisa resolver ae_instancia_id a partir do phone_number_id real (ae_conversas.
-- ae_instancia_id é NOT NULL). Em vez de mudar o schema, preenche o registro existente com o
-- dado real — idempotente: só atua enquanto phone_number_id ainda estiver nulo, nunca sobrescreve
-- um valor já preenchido.
update public.ae_instancias
set phone_number_id = mpn.phone_number_id,
    status = 'connected',
    updated_at = now()
from public.meta_phone_numbers mpn
where mpn.agente_tipo = 'academia_enem'
  and mpn.ativo = true
  and public.ae_instancias.phone_number_id is null;

create index if not exists idx_ae_instancias_phone_number_id on public.ae_instancias (phone_number_id);
