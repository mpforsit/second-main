-- Step 8: storage bucket for user voice memos.
--
-- Path convention: voice/{user_id}/{uuid}.{webm|mp4|m4a}
-- 25 MB cap mirrors Whisper's 25 MB API limit. Whisper accepts a wide range
-- of audio MIME types; we list the common ones browsers produce.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'voice',
  'voice',
  false,
  25 * 1024 * 1024,
  array[
    'audio/webm',
    'audio/ogg',
    'audio/mp4',
    'audio/mpeg',
    'audio/m4a',
    'audio/x-m4a',
    'audio/wav'
  ]
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Same per-user folder RLS as the uploads bucket from migration 0002.
drop policy if exists "voice_owner_select" on storage.objects;
drop policy if exists "voice_owner_insert" on storage.objects;
drop policy if exists "voice_owner_update" on storage.objects;
drop policy if exists "voice_owner_delete" on storage.objects;

create policy "voice_owner_select" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'voice'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "voice_owner_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'voice'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "voice_owner_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'voice'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "voice_owner_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'voice'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
