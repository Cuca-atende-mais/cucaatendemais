-- S-WM-19 Task 1: RLS de disparos_divulgacao permitia INSERT/UPDATE irrestrito para
-- qualquer authenticated (achado de segurança do @qa em S-WM-18). Todo write real hoje
-- passa por service_role (worker + api/divulgacao/disparar), então este ajuste só fecha
-- o bypass de escrita direta via client autenticado; SELECT permanece USING(true), fora
-- de escopo desta correção (divulgacao/page.tsx lê via client autenticado).

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
