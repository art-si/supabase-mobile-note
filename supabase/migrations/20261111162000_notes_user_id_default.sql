-- 笔记归属由服务端从 JWT 注入：user_id 默认 auth.uid()。
-- 客户端创建时无需（也无法伪造）他人 user_id，INSERT 的 RLS with check 自然通过。
alter table public.notes alter column user_id set default auth.uid();