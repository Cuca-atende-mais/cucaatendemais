-- S-AE-08: categoria de interesse dedicada à tag de matrícula Academia Enem.
-- Leads "matriculados" recebem uma linha em lead_interesses(lead_id, categoria_id) apontando para esta categoria,
-- reusando o mesmo mecanismo de público dos disparos (worker/_query_leads_sync).
-- Ponto de extensão (AC4): a futura API do portal da juventude só precisa inserir lead_interesses para esta categoria.
insert into public.categorias_interesse (nome, ativo)
select 'Academia Enem', true
where not exists (select 1 from public.categorias_interesse where nome = 'Academia Enem');
