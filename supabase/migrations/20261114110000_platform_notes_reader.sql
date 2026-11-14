-- Apply with direct SQL to the linked project; do not run db push from this repository.
create policy notes_owner_required on public.notes
as restrictive for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create or replace function public.list_platform_notes()
returns setof public.notes
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select app_private.is_platform_super())
     or not (select app_private.has_permission('System:Notes:View')) then
    raise exception 'permission denied' using errcode = '42501';
  end if;

  return query
    select n.*
    from public.notes n
    where (select app_private.current_read_tenant_id()) is null
      or app_private.note_owner_in_tenant(
        n.user_id::text, (select app_private.current_read_tenant_id())
      );
end
$$;

revoke all on function public.list_platform_notes() from public, anon;
grant execute on function public.list_platform_notes() to authenticated;
