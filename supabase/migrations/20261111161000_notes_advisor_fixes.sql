-- 应用 advisor 建议：RLS initplan 优化 + 固定函数 search_path。
drop policy if exists "notes_select_own" on public.notes;
drop policy if exists "notes_insert_own" on public.notes;
drop policy if exists "notes_update_own" on public.notes;
drop policy if exists "notes_delete_own" on public.notes;

create policy "notes_select_own" on public.notes
  for select using ((select auth.uid()) = user_id);

create policy "notes_insert_own" on public.notes
  for insert with check ((select auth.uid()) = user_id);

create policy "notes_update_own" on public.notes
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "notes_delete_own" on public.notes
  for delete using ((select auth.uid()) = user_id);

create or replace function public.set_notes_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;