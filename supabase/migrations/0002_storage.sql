-- Step 7: storage bucket for user PDF uploads. (Voice bucket lands in Step 8.)
--
-- We don't make the bucket public; access goes through signed URLs created
-- by `app/api/capture/upload-signed-url`. Path convention:
--     uploads/{user_id}/{atom_id}.pdf

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'uploads',
  'uploads',
  false,
  10 * 1024 * 1024,                                -- 10 MB
  array['application/pdf']
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- RLS: authenticated users can read/write under their own user_id subfolder.
-- Service role bypasses these as usual and writes from process-atom.
drop policy if exists "uploads_owner_select" on storage.objects;
drop policy if exists "uploads_owner_insert" on storage.objects;
drop policy if exists "uploads_owner_update" on storage.objects;
drop policy if exists "uploads_owner_delete" on storage.objects;

create policy "uploads_owner_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "uploads_owner_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "uploads_owner_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "uploads_owner_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
