-- Apply to the Supabase project configured in frontend/.env.local.
-- Authorization reads current server-managed metadata, not editable user metadata
-- or potentially stale JWT role claims. No access to auth tables is granted.
begin;
create schema if not exists pose_private;
revoke all on schema pose_private from public, anon;
grant usage on schema pose_private to authenticated;

create or replace function pose_private.pose_access_context()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'user_id', u.id,
    'role', coalesce(u.raw_app_meta_data->>'role', 'User'),
    'active', coalesce(u.raw_app_meta_data->>'account_status', 'active') = 'active'
      and (u.banned_until is null or u.banned_until <= now())
      and coalesce(u.raw_app_meta_data->>'role', 'User') in ('User', 'Sales', 'Admin')
      and not coalesce(u.is_anonymous, false),
    'session_valid', exists (
      select 1 from auth.sessions s
      where s.user_id = u.id and s.id::text = (select auth.jwt()->>'session_id')
        and (s.not_after is null or s.not_after > now())
    )
  )
  from auth.users u where u.id = (select auth.uid()) and u.email_confirmed_at is not null;
$$;
revoke all on function pose_private.pose_access_context() from public, anon;
grant execute on function pose_private.pose_access_context() to authenticated;

create or replace function public.pose_access_context()
returns jsonb language sql stable security invoker
set search_path = ''
as $$ select pose_private.pose_access_context(); $$;
revoke all on function public.pose_access_context() from public, anon;
grant execute on function public.pose_access_context() to authenticated;
commit;
