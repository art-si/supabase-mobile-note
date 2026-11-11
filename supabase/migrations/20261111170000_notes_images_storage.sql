-- 时光记事：图片附件。notes.images 存 Storage 对象路径；note-images 为私有桶，
-- 仅本人文件夹可读写，客户端通过签名 URL 展示，避免公开链接泄露隐私。
alter table public.notes
  add column if not exists images text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notes_images_count') then
    alter table public.notes
      add constraint notes_images_count check (coalesce(array_length(images, 1), 0) <= 9);
  end if;
end
$$;

insert into storage.buckets (id, name, public, file_size_limit)
values ('note-images', 'note-images', false, 10485760)
on conflict (id) do nothing;

drop policy if exists "note_images_select_own" on storage.objects;
create policy "note_images_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'note-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "note_images_insert_own" on storage.objects;
create policy "note_images_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'note-images' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "note_images_delete_own" on storage.objects;
create policy "note_images_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'note-images' and (storage.foldername(name))[1] = (select auth.uid())::text);