-- 时光记事：content 升级为富文本 HTML（uni editor / web Tiptap 同族输出）。
-- 长度上限放宽以容纳标记；搜索走剥离标签的生成列 content_text。
alter table public.notes drop constraint if exists notes_content_check;
alter table public.notes
  add constraint notes_content_check check (char_length(content) between 1 and 20000);

alter table public.notes
  add column if not exists content_text text
  generated always as (regexp_replace(content, '<[^>]+>', '', 'g')) stored;