-- 时光记事：时间轴笔记表。仅本人可读写（RLS），与 TMS 业务表完全隔离。
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  content text not null check (char_length(content) between 1 and 5000),
  mood text not null default 'calm' check (mood in ('calm', 'happy', 'focused', 'tired', 'inspired', 'memorial')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.notes is '时光记事用户笔记，按 created_at 形成时间轴';

create index if not exists notes_user_created_idx on public.notes (user_id, created_at desc, id desc);

alter table public.notes enable row level security;

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

create trigger notes_set_updated_at
  before update on public.notes
  for each row execute function public.set_notes_updated_at();