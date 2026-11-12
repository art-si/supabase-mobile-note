-- 时光记事：给笔记增加轻量标签，用于时间轴筛选和编辑页维护。
alter table public.notes
  add column if not exists tags text[] not null default '{}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'notes_tags_count') then
    alter table public.notes
      add constraint notes_tags_count check (coalesce(array_length(tags, 1), 0) <= 8);
  end if;
end;
$$;
