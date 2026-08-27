-- S-WM-68: bucket privado para anexos (imagem/PDF) recebidos via WhatsApp em
-- conversas do Institucional/Empregabilidade/Academia Enem. Privado (diferente
-- de curriculos/programacao, que são públicos) porque é conteúdo enviado pelo
-- lead sem curadoria nossa — acesso só via signed URL gerada sob demanda pelo
-- portal, nunca URL pública crua. Expira em 15 dias via job agendado separado
-- (ver Edge Function `expirar-anexos-conversas`).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'anexos-conversas',
  'anexos-conversas',
  false,
  10485760, -- 10MB, mesmo limite usado no /api/upload-cv do portal
  array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
on conflict (id) do nothing;

-- Política de acesso: mesmo padrão já usado no bucket privado `rag-documentos`
-- (sem restrição de role nas policies — o acesso de fato é controlado por quem
-- detém a service role key, que é quem chama estas rotas: worker Python no
-- upload, rota server-side do portal na geração de signed URL/expiração).
drop policy if exists "anexos_conversas_insert" on storage.objects;
create policy "anexos_conversas_insert"
on storage.objects for insert
with check (bucket_id = 'anexos-conversas');

drop policy if exists "anexos_conversas_select" on storage.objects;
create policy "anexos_conversas_select"
on storage.objects for select
using (bucket_id = 'anexos-conversas');

drop policy if exists "anexos_conversas_delete" on storage.objects;
create policy "anexos_conversas_delete"
on storage.objects for delete
using (bucket_id = 'anexos-conversas');
