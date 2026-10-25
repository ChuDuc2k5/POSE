begin;

create table pose_private.m11_sales_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  version integer not null default 0 check(version>=0),
  updated_at timestamptz not null default now()
);
create table pose_private.m11_sales_history (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete restrict,
  actor_name text not null,
  action text not null check(action in ('Created','Updated','Activated','Suspended')),
  before_data jsonb,
  after_data jsonb not null,
  reason text not null check(char_length(reason) between 3 and 1000),
  created_at timestamptz not null default now()
);
create index m11_sales_history_user_created_idx on pose_private.m11_sales_history(user_id,created_at desc,id);
create index m11_sales_history_actor_idx on pose_private.m11_sales_history(actor_id);
alter table pose_private.m11_sales_state enable row level security;
alter table pose_private.m11_sales_history enable row level security;
revoke all on pose_private.m11_sales_state,pose_private.m11_sales_history from public,anon,authenticated;
insert into pose_private.m11_sales_state(user_id) select id from auth.users where raw_app_meta_data->>'role'='Sales';

create view pose_private.m11_sales_directory with(security_invoker=true) as
select u.id,coalesce(u.email,'') as email,
  coalesce(p.display_name,case when char_length(btrim(u.raw_user_meta_data->>'display_name')) between 2 and 80 then btrim(u.raw_user_meta_data->>'display_name') else 'Nhân viên Sales' end) as name,
  coalesce(p.contact_phone,'') as phone,
  case when coalesce(u.raw_app_meta_data->>'account_status','active')='active' and (u.banned_until is null or u.banned_until<=now()) then 'active' else 'suspended' end as status,
  coalesce(s.version,0) as version,coalesce(p.version,0) as profile_version,
  coalesce(u.raw_app_meta_data->>'m11_pending','false')='true' as requires_activation,
  u.email_confirmed_at is not null as email_verified,u.last_sign_in_at,u.created_at,
  greatest(u.updated_at,p.updated_at,s.updated_at) as updated_at
from auth.users u left join public.account_profiles p on p.user_id=u.id
left join pose_private.m11_sales_state s on s.user_id=u.id
where u.raw_app_meta_data->>'role'='Sales';
revoke all on pose_private.m11_sales_directory from public,anon,authenticated;

create function pose_private.m11_require_admin() returns uuid
language plpgsql security definer set search_path='' as $$
declare actor uuid:=pose_private.require_account();
begin
  perform 1 from auth.users where id=actor and raw_app_meta_data->>'role'='Admin' for share;
  if not found then raise exception 'SALES_FORBIDDEN' using errcode='42501'; end if;
  return actor;
end $$;
create function pose_private.m11_sales_snapshot(p_id uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
  select to_jsonb(r) from pose_private.m11_sales_directory r where id=p_id;
$$;
create function pose_private.m11_sales_actor_name(p_id uuid) returns text
language sql stable security definer set search_path='' as $$
  select coalesce(p.display_name,nullif(u.raw_user_meta_data->>'display_name',''),'Quản trị viên') from auth.users u left join public.account_profiles p on p.user_id=u.id where u.id=p_id;
$$;

-- Auth creates staff accounts as suspended. Profile and creation audit are part
-- of the same Auth transaction; a failed final activation leaves a recoverable,
-- visible inactive account, never a partially authorized Sales identity.
create function pose_private.m11_sales_auth_created() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor uuid; label text; phone text;
begin
  if coalesce(new.raw_app_meta_data->>'m11_pending','false')<>'true' then return new; end if;
  actor:=(new.raw_app_meta_data->>'m11_created_by')::uuid;
  perform 1 from auth.users where id=actor and raw_app_meta_data->>'role'='Admin'
    and coalesce(raw_app_meta_data->>'account_status','active')='active'
    and (banned_until is null or banned_until<=now()) and email_confirmed_at is not null for share;
  if not found then raise exception 'SALES_FORBIDDEN' using errcode='42501'; end if;
  label:=btrim(new.raw_app_meta_data->'m11_profile'->>'name');
  phone:=new.raw_app_meta_data->'m11_profile'->>'phone';
  if new.raw_app_meta_data->>'role' is distinct from 'Sales' or new.raw_app_meta_data->>'account_status' is distinct from 'suspended'
    or new.raw_app_meta_data->>'m11_request_key' is distinct from new.id::text
    or label is null or char_length(label) not between 2 and 80
    or phone is null or (phone<>'' and phone!~'^\+[1-9][0-9]{7,14}$')
    or coalesce(new.raw_app_meta_data->>'m11_fingerprint','')!~'^[0-9a-f]{64}$' then
    raise exception 'SALES_INVALID' using errcode='22023';
  end if;
  insert into public.account_profiles(user_id,display_name,contact_phone) values(new.id,label,phone);
  insert into pose_private.m11_sales_state(user_id,version) values(new.id,1);
  insert into pose_private.m11_sales_history(user_id,actor_id,actor_name,action,after_data,reason)
    values(new.id,actor,pose_private.m11_sales_actor_name(actor),'Created',pose_private.m11_sales_snapshot(new.id),'Tạo tài khoản Sales nội bộ');
  return new;
end $$;
create trigger pose_m11_sales_created after insert on auth.users for each row execute function pose_private.m11_sales_auth_created();

create function pose_private.m11_sales_list(p_query text default '',p_status text default 'all',p_page integer default 1,p_size integer default 20) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=pose_private.m11_require_admin(); result jsonb;
begin
  if p_query is null or char_length(p_query)>120 or p_status is null or p_status not in ('all','active','suspended')
    or p_page is null or p_page not between 1 and 10000 or p_size is null or p_size not between 1 and 50 then raise exception 'SALES_INVALID' using errcode='22023'; end if;
  with all_sales as materialized(select * from pose_private.m11_sales_directory), filtered as materialized(
    select * from all_sales where (p_status='all' or status=p_status)
      and (btrim(p_query)='' or strpos(lower(name||' '||email||' '||phone),lower(btrim(p_query)))>0)
  ), page_rows as(select * from filtered order by created_at desc nulls last,id limit p_size offset (p_page-1)*p_size)
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc nulls last,r.id) from page_rows r),'[]'::jsonb),
    'total',(select count(*) from filtered),'page',p_page,'pageSize',p_size,
    'stats',(select jsonb_build_object('total',count(*),'active',count(*) filter(where status='active'),'suspended',count(*) filter(where status='suspended')) from all_sales)) into result;
  return result;
end $$;
create function pose_private.m11_sales_detail(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=pose_private.m11_require_admin(); result jsonb;
begin
  result:=pose_private.m11_sales_snapshot(p_id);
  if result is null then raise exception 'SALES_NOT_FOUND' using errcode='P0002'; end if;
  return result;
end $$;
create function pose_private.m11_sales_history(p_id uuid,p_page integer default 1) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=pose_private.m11_require_admin(); result jsonb;
begin
  if p_page is null or p_page not between 1 and 10000 then raise exception 'SALES_INVALID' using errcode='22023'; end if;
  if pose_private.m11_sales_snapshot(p_id) is null then raise exception 'SALES_NOT_FOUND' using errcode='P0002'; end if;
  select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id) from (
    select id,actor_id,actor_name,action,before_data,after_data,reason,created_at from pose_private.m11_sales_history where user_id=p_id order by created_at desc,id limit 20 offset (p_page-1)*20
  ) r),'[]'::jsonb),'total',(select count(*) from pose_private.m11_sales_history where user_id=p_id),'page',p_page,'pageSize',20) into result;
  return result;
end $$;
create function pose_private.m11_sales_update(p_id uuid,p_data jsonb,p_version integer,p_profile_version integer,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=pose_private.m11_require_admin(); before_row jsonb; after_row jsonb; old_profile public.account_profiles; state_version integer; label text; phone text;
begin
  if p_data is null or jsonb_typeof(p_data)<>'object' or (select count(*) from jsonb_object_keys(p_data))<>2
    or not(p_data ? 'name' and p_data ? 'phone') or jsonb_typeof(p_data->'name')<>'string' or jsonb_typeof(p_data->'phone')<>'string'
    or p_version is null or p_version<0 or p_profile_version is null or p_profile_version<0
    or p_reason is null or char_length(btrim(p_reason)) not between 3 and 1000 then raise exception 'SALES_INVALID' using errcode='22023'; end if;
  label:=btrim(p_data->>'name');phone:=p_data->>'phone';
  if char_length(label) not between 2 and 80 or (phone<>'' and phone!~'^\+[1-9][0-9]{7,14}$') then raise exception 'SALES_INVALID' using errcode='22023'; end if;
  perform 1 from auth.users where id=p_id and raw_app_meta_data->>'role'='Sales' for update;
  if not found then raise exception 'SALES_NOT_FOUND' using errcode='P0002'; end if;
  insert into pose_private.m11_sales_state(user_id) values(p_id) on conflict do nothing;
  select version into state_version from pose_private.m11_sales_state where user_id=p_id for update;
  before_row:=pose_private.m11_sales_snapshot(p_id);
  insert into public.account_profiles(user_id,display_name) values(p_id,before_row->>'name') on conflict do nothing;
  select * into old_profile from public.account_profiles where user_id=p_id for update;
  if state_version<>p_version or old_profile.version<>p_profile_version then raise exception 'SALES_CONFLICT' using errcode='40001'; end if;
  if old_profile.display_name=label and old_profile.contact_phone=phone then return before_row; end if;
  update public.account_profiles set display_name=label,contact_phone=phone,version=version+1,updated_at=now() where user_id=p_id;
  update pose_private.m11_sales_state set version=version+1,updated_at=now() where user_id=p_id;
  insert into public.account_history(user_id,action,changed_fields) values(p_id,'profile_updated_by_admin',jsonb_build_array('name','phone'));
  after_row:=pose_private.m11_sales_snapshot(p_id);
  insert into pose_private.m11_sales_history(user_id,actor_id,actor_name,action,before_data,after_data,reason)
    values(p_id,actor,pose_private.m11_sales_actor_name(actor),'Updated',before_row,after_row,btrim(p_reason));
  return after_row;
end $$;
create function pose_private.m11_sales_status(p_id uuid,p_status text,p_version integer,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=pose_private.m11_require_admin(); before_row jsonb; after_row jsonb; state_version integer;
begin
  if p_status is null or p_status not in ('active','suspended') or p_version is null or p_version<0
    or p_reason is null or char_length(btrim(p_reason)) not between 3 and 1000 then raise exception 'SALES_INVALID' using errcode='22023'; end if;
  perform 1 from auth.users where id=p_id and raw_app_meta_data->>'role'='Sales' for update;
  if not found then raise exception 'SALES_NOT_FOUND' using errcode='P0002'; end if;
  insert into pose_private.m11_sales_state(user_id) values(p_id) on conflict do nothing;
  select version into state_version from pose_private.m11_sales_state where user_id=p_id for update;
  if state_version<>p_version then raise exception 'SALES_CONFLICT' using errcode='40001'; end if;
  before_row:=pose_private.m11_sales_snapshot(p_id);
  if before_row->>'status'=p_status and not (before_row->>'requires_activation')::boolean then return before_row; end if;
  update auth.users set raw_app_meta_data=raw_app_meta_data||jsonb_build_object('account_status',p_status,'m11_pending',false),
    banned_until=case when p_status='active' then null else banned_until end,updated_at=now() where id=p_id;
  if p_status='suspended' then
    insert into pose_private.account_security(user_id,revoked_before) values(p_id,clock_timestamp()) on conflict(user_id) do update set revoked_before=greatest(pose_private.account_security.revoked_before,excluded.revoked_before);
  end if;
  update pose_private.m11_sales_state set version=version+1,updated_at=now() where user_id=p_id;
  after_row:=pose_private.m11_sales_snapshot(p_id);
  insert into pose_private.m11_sales_history(user_id,actor_id,actor_name,action,before_data,after_data,reason)
    values(p_id,actor,pose_private.m11_sales_actor_name(actor),case when p_status='active' then 'Activated' else 'Suspended' end,before_row,after_row,btrim(p_reason));
  return after_row;
end $$;
create function pose_private.m11_sales_finish_create(p_id uuid,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=pose_private.m11_require_admin(); target auth.users; result jsonb;
begin
  select * into target from auth.users where id=p_id and raw_app_meta_data->>'role'='Sales' for update;
  if not found then raise exception 'SALES_NOT_FOUND' using errcode='P0002'; end if;
  if target.raw_app_meta_data->>'m11_created_by' is distinct from actor::text or target.raw_app_meta_data->>'m11_request_key' is distinct from p_key::text then raise exception 'SALES_FORBIDDEN' using errcode='42501'; end if;
  if coalesce(target.raw_app_meta_data->>'m11_pending','false')='true' then
    result:=pose_private.m11_sales_status(p_id,'active',(pose_private.m11_sales_snapshot(p_id)->>'version')::integer,'Kích hoạt tài khoản Sales vừa tạo');
    return jsonb_build_object('item',result,'replayed',false);
  end if;
  return jsonb_build_object('item',pose_private.m11_sales_snapshot(p_id),'replayed',true);
end $$;

create function public.pose_admin_sales_list(p_query text default '',p_status text default 'all',p_page integer default 1,p_size integer default 20) returns jsonb language sql security invoker set search_path='' as $$select pose_private.m11_sales_list(p_query,p_status,p_page,p_size);$$;
create function public.pose_admin_sales_detail(p_id uuid) returns jsonb language sql security invoker set search_path='' as $$select pose_private.m11_sales_detail(p_id);$$;
create function public.pose_admin_sales_history(p_id uuid,p_page integer default 1) returns jsonb language sql security invoker set search_path='' as $$select pose_private.m11_sales_history(p_id,p_page);$$;
create function public.pose_admin_sales_update(p_id uuid,p_data jsonb,p_version integer,p_profile_version integer,p_reason text) returns jsonb language sql security invoker set search_path='' as $$select pose_private.m11_sales_update(p_id,p_data,p_version,p_profile_version,p_reason);$$;
create function public.pose_admin_sales_status(p_id uuid,p_status text,p_version integer,p_reason text) returns jsonb language sql security invoker set search_path='' as $$select pose_private.m11_sales_status(p_id,p_status,p_version,p_reason);$$;
create function public.pose_admin_sales_finish_create(p_id uuid,p_key uuid) returns jsonb language sql security invoker set search_path='' as $$select pose_private.m11_sales_finish_create(p_id,p_key);$$;

revoke all on function pose_private.m11_require_admin(),pose_private.m11_sales_snapshot(uuid),pose_private.m11_sales_actor_name(uuid),pose_private.m11_sales_auth_created(),pose_private.m11_sales_list(text,text,integer,integer),pose_private.m11_sales_detail(uuid),pose_private.m11_sales_history(uuid,integer),pose_private.m11_sales_update(uuid,jsonb,integer,integer,text),pose_private.m11_sales_status(uuid,text,integer,text),pose_private.m11_sales_finish_create(uuid,uuid) from public,anon,authenticated;
revoke all on function public.pose_admin_sales_list(text,text,integer,integer),public.pose_admin_sales_detail(uuid),public.pose_admin_sales_history(uuid,integer),public.pose_admin_sales_update(uuid,jsonb,integer,integer,text),public.pose_admin_sales_status(uuid,text,integer,text),public.pose_admin_sales_finish_create(uuid,uuid) from public,anon,authenticated;
grant execute on function pose_private.m11_sales_list(text,text,integer,integer),pose_private.m11_sales_detail(uuid),pose_private.m11_sales_history(uuid,integer),pose_private.m11_sales_update(uuid,jsonb,integer,integer,text),pose_private.m11_sales_status(uuid,text,integer,text),pose_private.m11_sales_finish_create(uuid,uuid) to authenticated;
grant execute on function public.pose_admin_sales_list(text,text,integer,integer),public.pose_admin_sales_detail(uuid),public.pose_admin_sales_history(uuid,integer),public.pose_admin_sales_update(uuid,jsonb,integer,integer,text),public.pose_admin_sales_status(uuid,text,integer,text),public.pose_admin_sales_finish_create(uuid,uuid) to authenticated;
commit;
