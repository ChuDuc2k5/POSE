begin;
-- Authorization and recovery state cannot be edited through the Data API.
create table if not exists pose_private.account_security (
  user_id uuid primary key references auth.users(id) on delete cascade,
  revoked_before timestamptz not null
);
create table if not exists pose_private.recovery_tickets (
  session_id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '10 minutes',
  state text not null default 'Pending' check (state in ('Pending','Processing','Completed'))
);
create table if not exists public.account_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 80),
  contact_phone text not null default '' check (contact_phone = '' or contact_phone ~ '^\+[1-9][0-9]{7,14}$'),
  notifications_enabled boolean not null default true,
  avatar_path text,
  version integer not null default 0,
  updated_at timestamptz not null default now()
);
create table if not exists public.account_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null,
  changed_fields jsonb not null default '[]',
  created_at timestamptz not null default now()
);
alter table public.account_profiles enable row level security;
alter table public.account_history enable row level security;
revoke all on public.account_profiles, public.account_history from anon, authenticated;
grant select on public.account_profiles, public.account_history to authenticated;
revoke all on pose_private.account_security, pose_private.recovery_tickets from public, anon, authenticated;

create or replace function pose_private.pose_access_context()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'user_id', u.id, 'role', coalesce(u.raw_app_meta_data->>'role', 'User'),
    'active', coalesce(u.raw_app_meta_data->>'account_status', 'active') = 'active'
      and (u.banned_until is null or u.banned_until <= now())
      and coalesce(u.raw_app_meta_data->>'role', 'User') in ('User','Sales','Admin')
      and not coalesce(u.is_anonymous, false),
    'session_valid', exists (
      select 1 from auth.sessions s where s.user_id = u.id
        and s.id::text = (select auth.jwt()->>'session_id')
        and (s.not_after is null or s.not_after > now())
        and not exists (select 1 from pose_private.account_security a
          where a.user_id = u.id and s.created_at <= a.revoked_before)
    )
  ) from auth.users u where u.id = (select auth.uid()) and u.email_confirmed_at is not null;
$$;

create or replace function pose_private.require_account()
returns uuid language plpgsql stable security definer set search_path = '' as $$
declare ctx jsonb;
begin
  ctx := pose_private.pose_access_context();
  if ctx is null or not (ctx->>'active')::boolean or not (ctx->>'session_valid')::boolean then
    raise exception 'ACCOUNT_UNAUTHORIZED' using errcode = '42501';
  end if;
  return (ctx->>'user_id')::uuid;
end $$;

drop policy if exists account_profiles_self_read on public.account_profiles;
create policy account_profiles_self_read on public.account_profiles for select to authenticated
  using (user_id = (select pose_private.require_account()));
drop policy if exists account_history_self_read on public.account_history;
create policy account_history_self_read on public.account_history for select to authenticated
  using (user_id = (select pose_private.require_account()));

create or replace function pose_private.read_profile()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := pose_private.require_account(); result jsonb;
begin
  select jsonb_build_object(
    'name', coalesce(p.display_name, case when char_length(u.raw_user_meta_data->>'display_name') between 2 and 80 then u.raw_user_meta_data->>'display_name' else 'Khách hàng' end),
    'phone', coalesce(p.contact_phone, ''),
    'phoneVerified', coalesce(p.contact_phone <> '' and ltrim(p.contact_phone, '+') = ltrim(u.phone, '+') and u.phone_confirmed_at is not null, false),
    'notificationsEnabled', coalesce(p.notifications_enabled, true),
    'avatarPath', p.avatar_path, 'version', coalesce(p.version, 0),
    'updatedAt', p.updated_at
  ) into result from auth.users u left join public.account_profiles p on p.user_id = u.id where u.id = uid;
  return result;
end $$;

create or replace function pose_private.update_profile(p_changes jsonb, p_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := pose_private.require_account(); old public.account_profiles; fields jsonb := '[]'; new_name text; new_phone text; new_avatar text; new_notifications boolean;
begin
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' or p_version is null or p_version < 0
    or exists (select 1 from jsonb_object_keys(p_changes) k where k not in ('name','phone','notificationsEnabled','avatarPath')) then
    raise exception 'PROFILE_INVALID' using errcode = '22023';
  end if;
  insert into public.account_profiles(user_id, display_name)
    select uid, case when char_length(u.raw_user_meta_data->>'display_name') between 2 and 80 then u.raw_user_meta_data->>'display_name' else 'Khách hàng' end
    from auth.users u where u.id = uid on conflict (user_id) do nothing;
  select * into old from public.account_profiles where user_id = uid for update;
  if old.version <> p_version then raise exception 'PROFILE_CONFLICT' using errcode = '40001'; end if;
  new_name := case when p_changes ? 'name' then btrim(p_changes->>'name') else old.display_name end;
  new_phone := case when p_changes ? 'phone' then p_changes->>'phone' else old.contact_phone end;
  new_avatar := case when p_changes ? 'avatarPath' then p_changes->>'avatarPath' else old.avatar_path end;
  new_notifications := case when p_changes ? 'notificationsEnabled' then (p_changes->>'notificationsEnabled')::boolean else old.notifications_enabled end;
  if new_name is null or char_length(new_name) not between 2 and 80 or new_phone is null
    or (new_phone <> '' and new_phone !~ '^\+[1-9][0-9]{7,14}$') or new_notifications is null then
    raise exception 'PROFILE_INVALID' using errcode = '22023';
  end if;
  if new_avatar is not null and (split_part(new_avatar, '/', 1) <> uid::text
    or not exists (select 1 from storage.objects where bucket_id = 'account-avatars' and name = new_avatar)) then
    raise exception 'AVATAR_INVALID' using errcode = '22023';
  end if;
  if new_name is distinct from old.display_name then fields := fields || '"name"'::jsonb; end if;
  if new_phone is distinct from old.contact_phone then fields := fields || '"phone"'::jsonb; end if;
  if new_avatar is distinct from old.avatar_path then fields := fields || '"avatar"'::jsonb; end if;
  if new_notifications is distinct from old.notifications_enabled then fields := fields || '"notifications"'::jsonb; end if;
  if fields <> '[]'::jsonb then
    update public.account_profiles set display_name = new_name, contact_phone = new_phone,
      avatar_path = new_avatar, notifications_enabled = new_notifications, version = version + 1, updated_at = now() where user_id = uid;
    insert into public.account_history(user_id, action, changed_fields) values(uid, 'profile_updated', fields);
  end if;
  return pose_private.read_profile();
end $$;

create or replace function pose_private.recovery_ticket(p_action text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare uid uuid := pose_private.require_account(); sid uuid := (auth.jwt()->>'session_id')::uuid; affected integer;
begin
  if p_action = 'begin' then
    insert into pose_private.recovery_tickets(session_id, user_id) values(sid, uid) on conflict do nothing;
  elsif p_action = 'claim' then
    update pose_private.recovery_tickets set state = 'Processing'
      where session_id = sid and user_id = uid and state = 'Pending' and expires_at > now();
    get diagnostics affected = row_count;
    return affected = 1;
  elsif p_action = 'finish' then
    update pose_private.recovery_tickets set state = 'Completed'
      where session_id = sid and user_id = uid and state = 'Processing';
    get diagnostics affected = row_count;
    if affected <> 1 then return false; end if;
    insert into public.account_history(user_id, action) values(uid, 'password_recovered');
    insert into pose_private.account_security(user_id, revoked_before) values(uid, now())
      on conflict(user_id) do update set revoked_before = excluded.revoked_before;
    return true;
  elsif p_action <> 'check' then
    raise exception 'RECOVERY_INVALID' using errcode = '22023';
  end if;
  return exists(select 1 from pose_private.recovery_tickets where session_id = sid and user_id = uid and state = 'Pending' and expires_at > now());
end $$;

create or replace function public.pose_read_profile() returns jsonb language sql security invoker set search_path = '' as $$ select pose_private.read_profile(); $$;
create or replace function pose_private.record_phone_verification(p_phone text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare uid uuid := pose_private.require_account(); profile public.account_profiles;
begin
  select * into profile from public.account_profiles where user_id = uid for update;
  if profile.contact_phone is distinct from p_phone or not exists (
    select 1 from auth.users u where u.id = uid and ltrim(u.phone, '+') = ltrim(p_phone, '+') and u.phone_confirmed_at is not null
  ) then raise exception 'PHONE_UNVERIFIED' using errcode = '22023'; end if;
  if not exists (select 1 from public.account_history h where h.user_id = uid and h.action = 'phone_verified' and h.created_at >= profile.updated_at) then
    update public.account_profiles set version = version + 1, updated_at = now() where user_id = uid;
    insert into public.account_history(user_id, action, changed_fields) values(uid, 'phone_verified', '["phone"]');
  end if;
  return pose_private.read_profile();
end $$;
create or replace function public.pose_record_phone_verification(p_phone text) returns jsonb language sql security invoker set search_path = '' as $$ select pose_private.record_phone_verification(p_phone); $$;
create or replace function public.pose_update_profile(p_changes jsonb, p_version integer) returns jsonb language sql security invoker set search_path = '' as $$ select pose_private.update_profile(p_changes, p_version); $$;
create or replace function public.pose_recovery_ticket(p_action text) returns boolean language sql security invoker set search_path = '' as $$ select pose_private.recovery_ticket(p_action); $$;
revoke all on function pose_private.require_account(), pose_private.read_profile(), pose_private.update_profile(jsonb, integer), pose_private.recovery_ticket(text), public.pose_read_profile(), public.pose_update_profile(jsonb, integer), public.pose_recovery_ticket(text) from public, anon;
revoke all on function pose_private.record_phone_verification(text), public.pose_record_phone_verification(text) from public, anon;
grant execute on function pose_private.require_account(), pose_private.read_profile(), pose_private.update_profile(jsonb, integer), pose_private.recovery_ticket(text), public.pose_read_profile(), public.pose_update_profile(jsonb, integer), public.pose_recovery_ticket(text) to authenticated;
grant execute on function pose_private.record_phone_verification(text), public.pose_record_phone_verification(text) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
  values('account-avatars', 'account-avatars', false, 2097152, array['image/png']) on conflict(id) do nothing;
drop policy if exists account_avatar_read on storage.objects;
create policy account_avatar_read on storage.objects for select to authenticated
  using(bucket_id = 'account-avatars' and (storage.foldername(name))[1] = (select pose_private.require_account())::text);
drop policy if exists account_avatar_insert on storage.objects;
create policy account_avatar_insert on storage.objects for insert to authenticated
  with check(bucket_id = 'account-avatars' and (storage.foldername(name))[1] = (select pose_private.require_account())::text);
drop policy if exists account_avatar_delete on storage.objects;
create policy account_avatar_delete on storage.objects for delete to authenticated
  using(bucket_id = 'account-avatars' and (storage.foldername(name))[1] = (select pose_private.require_account())::text);
commit;
