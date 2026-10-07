-- Apply after auth-access.sql and account-profile.sql. Preserve legacy users/FKs.
begin;
do $$ begin
  if exists(select 1 from auth.users a join public.users u on lower(a.email)=lower(u.email) where a.id<>u.id) then
    raise exception 'USER_EMAIL_COLLISION: resolve legacy email duplicates before linking Auth accounts';
  end if;
end $$;
alter table public.users
  add column auth_user_id uuid unique references auth.users(id) on delete restrict,
  add column role text check(role in ('User','Sales','Admin')),
  add column account_status text check(account_status in ('active','suspended')),
  add column email_verified boolean not null default false,
  add column last_sign_in_at timestamptz,
  add column contact_phone text not null default '',
  add column avatar_path text,
  add column banned_until timestamptz,
  add column role_label text generated always as
    (case when auth_user_id is null then 'Chưa liên kết' when role='Admin' then 'Quản trị viên' when role='Sales' then 'Nhân viên tư vấn' when role='User' then 'Khách hàng' else 'Chưa cấu hình' end) stored;
comment on table public.users is 'Account directory: Auth-linked rows mirror auth.users and account_profiles. Edit role/account_status in Table Editor to update trusted Auth app_metadata. Unlinked legacy rows grant no application access.';
comment on column public.users.auth_user_id is 'Supabase Authentication UUID. Managed automatically; never relink identities by editing this field.';
comment on column public.users.role is 'Editable by project administrators only: User (customer), Sales, Admin. Synced transactionally to Auth app_metadata; never sourced from user_metadata.';
comment on column public.users.account_status is 'Editable by project administrators: active / suspended. Auth bans and email verification still apply.';
comment on column public.users.phone is 'Legacy unique phone. Auth account contact numbers use contact_phone, which permits shared contact numbers.';
comment on table public.user_roles is 'Legacy role assignments. Current Auth-linked application authorization uses auth.users.app_metadata mirrored in users.role.';
comment on table public.auth_users is 'Legacy authentication table. Supabase Authentication is authoritative; do not copy passwords/tokens into this table.';

create function pose_private.directory_admin() returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce(c->>'role'='Admin' and (c->>'active')::boolean and (c->>'session_valid')::boolean,false)
 from (select pose_private.pose_access_context() c) ctx;
$$;
revoke all on function pose_private.directory_admin() from public,anon;
grant execute on function pose_private.directory_admin() to authenticated;
alter table public.users enable row level security;
revoke all on public.users from public,anon,authenticated;
grant select on public.users to authenticated;
create policy users_self_read on public.users for select to authenticated
  using(auth_user_id=(select pose_private.require_account()));
create policy users_admin_read on public.users for select to authenticated
  using((select pose_private.directory_admin()));

create table public.user_access_history (
 id uuid primary key default gen_random_uuid(),
 auth_user_id uuid not null references auth.users(id) on delete restrict,
 actor_id uuid,
 previous_role text, new_role text, previous_status text, new_status text,
 source text not null check(source in ('TableEditor','Authentication')),
 created_at timestamptz not null default now()
);
create index user_access_history_user_idx on public.user_access_history(auth_user_id,created_at desc);
alter table public.user_access_history enable row level security;
revoke all on public.user_access_history from public,anon,authenticated;
grant select on public.user_access_history to authenticated;
create policy user_access_history_admin_read on public.user_access_history for select to authenticated
 using((select pose_private.directory_admin()));

create function pose_private.sync_user_directory(p_auth_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare a auth.users; p public.account_profiles; mapped_role text; mapped_status text; label text;
begin
 select * into a from auth.users where id=p_auth_id;
 if not found then return; end if;
 select * into p from public.account_profiles where user_id=p_auth_id;
 mapped_role:=coalesce(a.raw_app_meta_data->>'role','User');
 if mapped_role not in ('User','Sales','Admin') then mapped_role:=null; end if;
 mapped_status:=case when coalesce(a.raw_app_meta_data->>'account_status','active')='active' and mapped_role is not null then 'active' else 'suspended' end;
 label:=coalesce(p.display_name,nullif(left(btrim(a.raw_user_meta_data->>'display_name'),255),''),'Khách hàng');
 insert into public.users as current_user_row(id,auth_user_id,full_name,email,role,account_status,email_verified,last_sign_in_at,contact_phone,avatar_path,banned_until,status,created_at,updated_at)
 values(a.id,a.id,label,coalesce(nullif(a.email,''),a.id::text||'@auth.invalid'),mapped_role,mapped_status,a.email_confirmed_at is not null,a.last_sign_in_at,coalesce(p.contact_phone,''),p.avatar_path,a.banned_until,
   case when a.banned_until>now() then 'BLOCKED'::public.user_status when mapped_status='active' then 'ACTIVE'::public.user_status else 'INACTIVE'::public.user_status end,coalesce(a.created_at,now()),coalesce(a.updated_at,a.created_at,now()))
 on conflict(id) do update set auth_user_id=excluded.auth_user_id,full_name=excluded.full_name,email=excluded.email,
   role=excluded.role,account_status=excluded.account_status,email_verified=excluded.email_verified,last_sign_in_at=excluded.last_sign_in_at,
   contact_phone=excluded.contact_phone,avatar_path=excluded.avatar_path,banned_until=excluded.banned_until,status=excluded.status,updated_at=now()
 where row(current_user_row.auth_user_id,current_user_row.full_name,current_user_row.email,current_user_row.role,current_user_row.account_status,current_user_row.email_verified,current_user_row.last_sign_in_at,current_user_row.contact_phone,current_user_row.avatar_path,current_user_row.banned_until,current_user_row.status)
 is distinct from row(excluded.auth_user_id,excluded.full_name,excluded.email,excluded.role,excluded.account_status,excluded.email_verified,excluded.last_sign_in_at,excluded.contact_phone,excluded.avatar_path,excluded.banned_until,excluded.status);
end $$;
revoke all on function pose_private.sync_user_directory(uuid) from public,anon,authenticated;

create function pose_private.auth_to_user_directory() returns trigger
language plpgsql security definer set search_path='' as $$
begin perform pose_private.sync_user_directory(new.id); return new; end $$;
revoke all on function pose_private.auth_to_user_directory() from public,anon,authenticated;
create trigger auth_user_directory_sync after insert or update on auth.users
 for each row execute function pose_private.auth_to_user_directory();

create function pose_private.profile_to_user_directory() returns trigger
language plpgsql security definer set search_path='' as $$
begin perform pose_private.sync_user_directory(new.user_id); return new; end $$;
revoke all on function pose_private.profile_to_user_directory() from public,anon,authenticated;
create trigger profile_user_directory_sync after insert or update on public.account_profiles
 for each row execute function pose_private.profile_to_user_directory();

create function pose_private.user_directory_to_auth() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.auth_user_id is null or (new.role is not distinct from old.role and new.account_status is not distinct from old.account_status) then return new; end if;
 -- Nested Auth/profile synchronization is already authoritative. Direct Table
 -- Editor changes write only the two trusted authorization metadata fields.
 if pg_trigger_depth()=1 then
   if new.role is null or new.account_status is null then raise exception 'ROLE_AND_STATUS_REQUIRED' using errcode='22023'; end if;
   update auth.users set raw_app_meta_data=coalesce(raw_app_meta_data,'{}'::jsonb)||jsonb_build_object('role',new.role,'account_status',new.account_status),updated_at=now()
   where id=new.auth_user_id;
 end if;
 insert into public.user_access_history(auth_user_id,actor_id,previous_role,new_role,previous_status,new_status,source)
 values(new.auth_user_id,auth.uid(),old.role,new.role,old.account_status,new.account_status,case when pg_trigger_depth()=1 then 'TableEditor' else 'Authentication' end);
 return new;
end $$;
revoke all on function pose_private.user_directory_to_auth() from public,anon,authenticated;
create trigger user_directory_authorization_sync after update of role,account_status on public.users
 for each row execute function pose_private.user_directory_to_auth();

-- Dashboard edits to identity/profile-derived columns would otherwise drift.
create function pose_private.guard_user_directory() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if old.auth_user_id is not null and pg_trigger_depth()=1 then
   if row(new.id,new.auth_user_id,new.email,new.full_name,new.email_verified,new.last_sign_in_at,new.contact_phone,new.avatar_path,new.banned_until,new.status,new.created_at)
      is distinct from row(old.id,old.auth_user_id,old.email,old.full_name,old.email_verified,old.last_sign_in_at,old.contact_phone,old.avatar_path,old.banned_until,old.status,old.created_at) then
     raise exception 'AUTH_MANAGED_FIELDS: edit only role/account_status here; use Authentication or the profile page for other fields' using errcode='22023';
   end if;
   new.updated_at:=now();
 end if;
 return new;
end $$;
revoke all on function pose_private.guard_user_directory() from public,anon,authenticated;
create trigger user_directory_identity_guard before update on public.users
 for each row execute function pose_private.guard_user_directory();

-- Backfill current accounts; legacy rows and their foreign keys remain intact.
do $$ declare a record; begin
 for a in select id from auth.users loop perform pose_private.sync_user_directory(a.id); end loop;
end $$;
create view public.user_directory with(security_invoker=true) as
select auth_user_id,full_name,email,role,role_label,account_status,
 case when auth_user_id is null then 'Chưa liên kết Authentication'
      when account_status='suspended' or banned_until>now() then 'Đã khóa'
      when not email_verified then 'Chờ xác minh email' else 'Hoạt động' end as access_state,
 email_verified,last_sign_in_at,contact_phone,created_at,updated_at,id as directory_id
from public.users where auth_user_id is not null;
revoke all on public.user_directory from public,anon,authenticated;
grant select on public.user_directory to authenticated,service_role;
comment on view public.user_directory is 'Read-only, RLS-respecting user list. Manage role/account_status in public.users using the Supabase Table Editor.';
commit;
