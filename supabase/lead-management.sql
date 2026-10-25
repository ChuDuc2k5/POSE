-- Lead Management only. Apply AFTER the existing account, catalog and AI schema.
-- Does not replace any M06 scoring, extraction, handoff or campaign function.
-- Review preflight failures; never silently discard existing assignments.
begin;
select pg_advisory_xact_lock(740004,1);

do $$
begin
  if to_regclass('public.leads') is null or to_regclass('public.lead_events') is null
     or to_regclass('public.lead_tasks') is null or to_regclass('public.ai_extracted_preferences') is null then
    raise exception 'LEAD_PREREQUISITE: apply the shared Lead/M06 schema first';
  end if;
  if exists(select 1 from public.lead_assignments where is_active group by lead_id having count(*)>1) then
    raise exception 'LEAD_PREFLIGHT: multiple active assignments; review them before applying this migration';
  end if;
end $$;

-- Upgrade the previously applied names inside this same transaction.
-- Tables and audit records are retained. RESTRICT stops on unexpected dependencies.
do $$
declare old_trigger record; old_function record;
begin
  for old_trigger in
    select t.tgname,n.nspname,c.relname from pg_trigger t
      join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
      join (values
        ('m04_route_lead','leads'),
        ('m04_route_owner','property_sales_owners'),
        ('m04_route_property','property_products'),
        ('m04_route_project','property_projects'),
        ('m04_route_subdivision','property_subdivisions'),
        ('m04_route_sales','users')
      ) expected(trigger_name,table_name) on expected.trigger_name=t.tgname and expected.table_name=c.relname
    where n.nspname='public' and not t.tgisinternal
  loop execute format('drop trigger %I on %I.%I restrict',old_trigger.tgname,old_trigger.nspname,old_trigger.relname); end loop;
  for old_function in
    select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname='public' and p.proname=any(array['pose_m04_list','pose_m04_detail','pose_m04_options','pose_m04_mutate','pose_m04_owners','pose_m04_set_owner','pose_m04_recheck','pose_m04_route_batch','pose_m04_select_property']))
       or (n.nspname='pose_private' and p.proname=any(array['m04_staff','m04_directory','m04_sales_valid','m04_access','m04_enqueue','m04_fold','m04_location','m04_selected','m04_ready','m04_matches','m04_is_accepted','m04_item','m04_list','m04_detail','m04_options','m04_assign','m04_route','m04_mutate','m04_owners','m04_set_owner','m04_recheck','m04_route_batch','m04_select_property','m04_lead_changed','m04_catalog_changed']))
    order by case when n.nspname='public' then 0 else 1 end
  loop execute format('drop function %s restrict',old_function.signature); end loop;
end $$;

create unique index if not exists lead_one_active_assignment
  on public.lead_assignments(lead_id) where is_active;
create index if not exists lead_acceptance_lookup on public.lead_events((after_data->>'assignment_id'))
  where action in ('lead_accepted','m04_lead_accepted');
-- New indexes are in place before retiring the legacy equivalents.
drop index if exists public.m04_one_active_assignment;
drop index if exists public.m04_acceptance_lookup;

create table if not exists public.property_sales_owners (
  property_id uuid primary key references public.property_products(id) on delete restrict,
  sales_id uuid references public.users(id) on delete restrict,
  assigned_by uuid not null references auth.users(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  version integer not null default 1 check(version>0)
);
alter table public.property_sales_owners enable row level security;
revoke all on public.property_sales_owners from public,anon,authenticated;

-- A durable work queue, not a cache of property matches. No Redis dependency.
create table if not exists pose_private.lead_routing_queue (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  requested_at timestamptz not null default now(),
  not_before timestamptz not null default now(),
  attempts integer not null default 0,
  last_error text
);
alter table pose_private.lead_routing_queue enable row level security;
revoke all on pose_private.lead_routing_queue from public,anon,authenticated;

create or replace function pose_private.lead_staff() returns text
language plpgsql stable security definer set search_path='' as $$
declare ctx jsonb;
begin
  perform pose_private.require_account();
  ctx:=pose_private.pose_access_context();
  if ctx->>'role' not in ('Admin','Sales') or ctx->>'role' is null then
    raise exception 'LEAD_FORBIDDEN' using errcode='42501';
  end if;
  return ctx->>'role';
end $$;

create or replace function pose_private.lead_directory() returns uuid
language sql stable security definer set search_path='' as $$
  select id from public.users where auth_user_id=auth.uid();
$$;

create or replace function pose_private.lead_sales_valid(p_sales uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.users u join auth.users a on a.id=u.auth_user_id
    where u.id=p_sales and a.email_confirmed_at is not null
      and a.raw_app_meta_data->>'role'='Sales'
      and coalesce(a.raw_app_meta_data->>'account_status','active')='active'
      and (a.banned_until is null or a.banned_until<=now())
  );
$$;

create or replace function pose_private.lead_access(p_lead uuid) returns text
language plpgsql stable security definer set search_path='' as $$
declare r text:=pose_private.lead_staff();
begin
  if not exists(select 1 from public.leads where id=p_lead) then
    raise exception 'LEAD_NOT_FOUND' using errcode='P0002';
  end if;
  if r='Sales' and not exists(select 1 from public.lead_assignments
    where lead_id=p_lead and is_active and sales_id=pose_private.lead_directory()) then
    raise exception 'LEAD_FORBIDDEN' using errcode='42501';
  end if;
  return r;
end $$;

create or replace function pose_private.lead_enqueue(p_lead uuid) returns void
language sql security definer set search_path='' as $$
  insert into pose_private.lead_routing_queue(lead_id)
    select l.id from public.leads l where l.id=p_lead and not l.archived and l.status not in ('CONVERTED','LOST')
      and not exists(select 1 from public.lead_assignments a where a.lead_id=l.id and a.is_active)
  on conflict(lead_id) do update
    set requested_at=now(),not_before=now(),attempts=0,last_error=null;
$$;

create or replace function pose_private.lead_fold(p_text text) returns text
language sql immutable set search_path='' as $$
  select btrim(regexp_replace(translate(lower(coalesce(p_text,'')),
    'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ',
    'aaaaaaaaaaaaaaaaaeeeeeeeeeeeiiiiiooooooooooooooooouuuuuuuuuuuyyyyyd'),
    '[^a-z0-9]+',' ','g'));
$$;

-- Literal, accent-insensitive token matching; never treats "quận 1" as "quận 10".
-- This is named-area matching, not a geographic radius or AI-invented proximity.
create or replace function pose_private.lead_location(p_location text,p_requested text) returns boolean
language plpgsql immutable set search_path='' as $$
declare actual text; wanted text; token text;
begin
  actual:=pose_private.lead_fold(p_location); wanted:=pose_private.lead_fold(p_requested);
  actual:=regexp_replace(actual,'\m(tphcm|hcm|sai gon)\M','ho chi minh','g');
  wanted:=regexp_replace(wanted,'\m(tphcm|hcm|sai gon)\M','ho chi minh','g');
  actual:=regexp_replace(actual,'\m(thanh pho|tp)\M','','g');
  wanted:=regexp_replace(wanted,'\m(thanh pho|tp)\M','','g');
  actual:=regexp_replace(actual,'\mq\s*([0-9]+)\M','quan \1','g');
  wanted:=regexp_replace(wanted,'\mq\s*([0-9]+)\M','quan \1','g');
  if btrim(wanted)='' then return false; end if;
  foreach token in array regexp_split_to_array(btrim(wanted),'\s+') loop
    if position(' '||token||' ' in ' '||actual||' ')=0 then return false; end if;
  end loop;
  return true;
end $$;

create or replace function pose_private.lead_selected(p_lead uuid) returns uuid
language sql stable security definer set search_path='' as $$
  -- Bot citations (ai_chat_sessions.property_ids) are deliberately not selections.
  select nullif(needs->'management'->>'selected_property_id','')::uuid
  from public.leads where id=p_lead;
$$;

create or replace function pose_private.lead_ready(p_lead uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce(pose_private.lead_selected(l.id) is not null or (
    (nullif(btrim(l.preferred_property_type),'') is not null
      or jsonb_array_length(coalesce(l.needs->'property_types'->'value','[]'))>0)
    and (nullif(btrim(l.preferred_location),'') is not null
      or jsonb_array_length(coalesce(l.needs->'locations'->'value','[]'))>0)
    and l.budget_max>0
  ),false) from public.leads l where l.id=p_lead;
$$;

create or replace function pose_private.lead_matches(p_lead uuid)
returns table(property_id uuid,code text,name text,location text,price numeric,
  property_type text,area numeric,bedrooms integer,property_version integer,
  sales_id uuid,sales_name text,owner_valid boolean,selected boolean,preference_score integer)
language sql stable security definer set search_path='' as $$
  with context as (
    select l.*,pose_private.lead_selected(l.id) as selected_id,
      coalesce(l.needs->'management','{}') as m
    from public.leads l where l.id=p_lead
  )
  select p.id,p.code,p.name,p.location,p.price,p.property_type,p.area,p.bedrooms,p.version,
    o.sales_id,u.full_name,pose_private.lead_sales_valid(o.sales_id),p.id=c.selected_id,
    (case when c.m->>'bedrooms' is not null and p.bedrooms=(c.m->>'bedrooms')::integer then 1 else 0 end
     +case when c.m->>'area_min' is not null and p.area>=(c.m->>'area_min')::numeric then 1 else 0 end
     +case when c.m->>'area_max' is not null and p.area<=(c.m->>'area_max')::numeric then 1 else 0 end)::integer
  from context c join public.property_products p on true
  join public.property_projects j on j.id=p.project_id
  left join public.property_subdivisions s on s.id=p.subdivision_id
  left join public.property_sales_owners o on o.property_id=p.id
  left join public.users u on u.id=o.sales_id
  where pose_private.lead_ready(c.id) and not c.archived
    and p.publication='Published' and p.availability='Available'
    and not j.archived and (p.subdivision_id is null or not s.archived)
    and (c.selected_id is null or p.id=c.selected_id)
    and (c.selected_id is not null or p.transaction_type=coalesce(c.m->>'transaction_type','Sale'))
    and (c.selected_id is not null or
      case when jsonb_array_length(coalesce(c.needs->'property_types'->'value','[]'))>0
        then exists(select 1 from jsonb_array_elements_text(c.needs->'property_types'->'value') v where v=p.property_type)
        else p.property_type=c.preferred_property_type end)
    and (c.selected_id is not null or
      case when jsonb_array_length(coalesce(c.needs->'locations'->'value','[]'))>0
        then exists(select 1 from jsonb_array_elements_text(c.needs->'locations'->'value') v where pose_private.lead_location(p.location,v))
        else pose_private.lead_location(p.location,c.preferred_location) end)
    and (c.selected_id is not null or p.price between coalesce(c.budget_min,0) and c.budget_max)
    and (coalesce((c.m->>'bedrooms_required')::boolean,false)=false
      or p.bedrooms=(c.m->>'bedrooms')::integer)
    and (coalesce((c.m->>'area_required')::boolean,false)=false
      or ((c.m->>'area_min' is null or p.area>=(c.m->>'area_min')::numeric)
      and (c.m->>'area_max' is null or p.area<=(c.m->>'area_max')::numeric)));
$$;

create or replace function pose_private.lead_is_accepted(p_assignment uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.lead_events
    where action in ('lead_accepted','m04_lead_accepted') and after_data->>'assignment_id'=p_assignment::text);
$$;

create or replace function pose_private.lead_item(p_lead uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select to_jsonb(l)||jsonb_build_object(
    'customer',jsonb_build_object('id',c.id,'full_name',c.full_name,'phone',c.phone,
      'email',c.email,'phone_verified_at',c.phone_verified_at),
    'assignment',(select to_jsonb(a)||jsonb_build_object('sales_name',u.full_name,
      'accepted',pose_private.lead_is_accepted(a.id),
      'sales_valid',pose_private.lead_sales_valid(a.sales_id))
      from public.lead_assignments a join public.users u on u.id=a.sales_id
      where a.lead_id=l.id and a.is_active limit 1),
    'routing',(select after_data from public.lead_events where lead_id=l.id
      and action in ('lead_route_evaluated','m04_route_evaluated') order by created_at desc,id desc limit 1)
  ) from public.leads l join public.customers c on c.id=l.customer_id where l.id=p_lead;
$$;

create or replace function pose_private.lead_list(p_filters jsonb,p_page integer,p_size integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r text:=pose_private.lead_staff(); result jsonb; stats jsonb; n integer;
begin
  if p_page is null or p_page not between 1 and 10000 or p_size is null or p_size not between 1 and 50
    or jsonb_typeof(p_filters) is distinct from 'object'
    or exists(select 1 from jsonb_object_keys(p_filters) k where k not in ('q','status','temperature','assignment','archived','sales_id','source'))
    or char_length(coalesce(p_filters->>'q',''))>120
    or (p_filters ? 'status' and p_filters->>'status' not in ('NEW','CONTACTED','QUALIFIED','FOLLOW_UP','CONVERTED','LOST'))
    or (p_filters ? 'temperature' and p_filters->>'temperature' not in ('HOT','WARM','COLD','UNRATED'))
    or (p_filters ? 'assignment' and p_filters->>'assignment' not in ('assigned','unassigned'))
    or (p_filters ? 'archived' and p_filters->>'archived' not in ('true','false')) then
    raise exception 'LEAD_INVALID_FILTER' using errcode='22023';
  end if;
  if r<>'Admin' and (coalesce((p_filters->>'archived')::boolean,false) or p_filters ? 'sales_id') then
    raise exception 'LEAD_FORBIDDEN' using errcode='42501';
  end if;
  with visible as materialized (
    select l.* from public.leads l where
      (r='Admin' or exists(select 1 from public.lead_assignments a where a.lead_id=l.id and a.is_active and a.sales_id=pose_private.lead_directory()))
      and l.archived=coalesce((p_filters->>'archived')::boolean,false)
  ), filtered as materialized (
    select l.id,l.created_at from visible l join public.customers c on c.id=l.customer_id
    where (not p_filters ? 'q' or position(lower(p_filters->>'q') in lower(c.full_name||' '||c.phone||' '||coalesce(c.email,'')))>0)
      and (not p_filters ? 'status' or l.status::text=p_filters->>'status')
      and (not p_filters ? 'source' or l.source=p_filters->>'source')
      and (not p_filters ? 'temperature' or coalesce(l.temperature::text,'UNRATED')=p_filters->>'temperature')
      and (not p_filters ? 'assignment' or exists(select 1 from public.lead_assignments a where a.lead_id=l.id and a.is_active)=(p_filters->>'assignment'='assigned'))
      and (not p_filters ? 'sales_id' or exists(select 1 from public.lead_assignments a where a.lead_id=l.id and a.is_active and a.sales_id=(p_filters->>'sales_id')::uuid))
  )
  select (select count(*) from filtered),
    (select coalesce(jsonb_agg(pose_private.lead_item(x.id) order by x.created_at desc,x.id),'[]')
      from (select * from filtered order by created_at desc,id limit p_size offset (p_page-1)*p_size) x),
    (select jsonb_build_object('total',count(*),'hot',count(*) filter(where temperature='HOT'),
      'warm',count(*) filter(where temperature='WARM'),'cold',count(*) filter(where temperature='COLD'),
      'unrated',count(*) filter(where temperature is null),
      'unassigned',count(*) filter(where not exists(select 1 from public.lead_assignments a where a.lead_id=visible.id and a.is_active))) from visible)
  into n,result,stats;
  return jsonb_build_object('items',result,'total',n,'page',p_page,'pageSize',p_size,'stats',stats);
end $$;

create or replace function pose_private.lead_detail(p_lead uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform pose_private.lead_access(p_lead);
  return jsonb_build_object('item',pose_private.lead_item(p_lead),
    'history',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id desc),'[]')
      from (select e.*,u.full_name as actor_name from public.lead_events e left join public.users u on u.auth_user_id=e.actor_id
        where e.lead_id=p_lead order by e.created_at desc,e.id desc limit 100) x),
    'extractions',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]') from
      (select * from public.ai_extracted_preferences where lead_id=p_lead and status='Conflict' order by created_at desc limit 50) x),
    'matches',(select coalesce(jsonb_agg(to_jsonb(x) order by x.selected desc nulls last,x.preference_score desc,x.property_id),'[]')
      from (select * from pose_private.lead_matches(p_lead) order by selected desc nulls last,preference_score desc,property_id limit 30) x),
    'summary',(select summary from public.lead_tasks where lead_id=p_lead and kind='Handoff' and source='AI' order by created_at desc limit 1));
end $$;

create or replace function pose_private.lead_options() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform pose_private.lead_staff();
  return jsonb_build_object('sales',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',full_name) order by full_name,id)
    from public.users where pose_private.lead_sales_valid(id)),'[]'));
end $$;

create or replace function pose_private.lead_assign(p_lead uuid,p_sales uuid,p_property uuid,
  p_actor uuid,p_kind text,p_reason text,p_automatic boolean default false) returns uuid
language plpgsql security definer set search_path='' as $$
declare previous public.lead_assignments; assignment_id uuid;
begin
  select * into previous from public.lead_assignments where lead_id=p_lead and is_active for update;
  if previous.id is not null then
    raise exception 'LEAD_ALREADY_ASSIGNED' using errcode='22023';
  end if;
  if p_sales is null or not pose_private.lead_sales_valid(p_sales) then
    raise exception 'LEAD_SALES_INACTIVE' using errcode='22023';
  end if;
  insert into public.lead_assignments(lead_id,sales_id) values(p_lead,p_sales) returning id into assignment_id;
  update public.leads set version=version+1,updated_at=now() where id=p_lead;
  insert into public.lead_events(lead_id,actor_id,actor_kind,action,reason,before_data,after_data)
    values(p_lead,p_actor,p_kind,case when p_automatic then 'lead_auto_assigned' else 'lead_assigned' end,p_reason,
      to_jsonb(previous),jsonb_build_object('assignment_id',assignment_id,'sales_id',p_sales,'property_id',p_property));
  return assignment_id;
end $$;

create or replace function pose_private.lead_route(p_lead uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare l public.leads; a public.lead_assignments; target_sales uuid; target_property uuid;
  fingerprint text; previous_fingerprint text; reason text; result jsonb; match_count integer; valid_count integer; best integer;
begin
  -- All Lead assignment writers acquire this lock before lead/queue locks.
  perform pg_advisory_xact_lock(740004,1);
  select * into l from public.leads where id=p_lead for update;
  if not found or l.archived or l.status in ('CONVERTED','LOST') then return jsonb_build_object('reason','closed'); end if;
  select * into a from public.lead_assignments where lead_id=p_lead and is_active for update;
  -- Assignment is final in Lead Management. Inventory, needs or owner changes never
  -- transfer an existing Lead or create an approval request.
  if a.id is not null then
    return jsonb_build_object('reason','assigned','unchanged',true,'sales_id',a.sales_id);
  end if;
  select count(*),max(preference_score) into match_count,best from pose_private.lead_matches(p_lead);
  select count(*) into valid_count from pose_private.lead_matches(p_lead) where owner_valid and preference_score=best;
  -- Group by seller first: owning more matching units must not increase their chance.
  with sellers as (
    select sales_id,min(property_id::text)::uuid as property_id
    from pose_private.lead_matches(p_lead) where owner_valid and preference_score=best group by sales_id
  )
  select s.sales_id,s.property_id into target_sales,target_property from sellers s
  order by (select count(*) from public.lead_assignments x join public.leads y on y.id=x.lead_id
      where x.is_active and x.sales_id=s.sales_id and not y.archived and y.status not in ('CONVERTED','LOST')),
    (select max(created_at) from public.lead_events where action in ('lead_auto_assigned','m04_auto_assigned') and after_data->>'sales_id'=s.sales_id::text) asc nulls first,
    s.sales_id limit 1;
  reason:=case
    when exists(select 1 from public.ai_extracted_preferences where lead_id=p_lead and status='Conflict') then 'needs_review'
    when not pose_private.lead_ready(p_lead) then 'missing_information'
    when match_count=0 then 'no_matching_property'
    when valid_count=0 then 'no_valid_owner'
    else 'matched' end;
  -- Exclude load-dependent choice from fingerprint: repeated scans must not shuffle
  -- an otherwise unchanged evaluation or flood history.
  select md5(jsonb_build_object('needs',l.needs,'min',l.budget_min,'max',l.budget_max,
      'type',l.preferred_property_type,'location',l.preferred_location,'status',l.status,
      'assignment_id',a.id,'accepted',pose_private.lead_is_accepted(a.id),'reason',reason,
      'matches',(select coalesce(jsonb_agg(to_jsonb(m) order by property_id),'[]') from pose_private.lead_matches(p_lead) m))::text)
    into fingerprint;
  select after_data->>'fingerprint' into previous_fingerprint from public.lead_events
    where lead_id=p_lead and action in ('lead_route_evaluated','m04_route_evaluated') order by created_at desc,id desc limit 1;
  if fingerprint=previous_fingerprint then return jsonb_build_object('reason',reason,'unchanged',true); end if;
  if reason='matched' then
    perform pose_private.lead_assign(p_lead,target_sales,target_property,null,'System','Phân công theo BĐS phù hợp',true);
  end if;
  result:=jsonb_build_object('reason',reason,'fingerprint',fingerprint,'property_id',target_property,
    'sales_id',target_sales,'matches',match_count,'evaluated_at',now());
  insert into public.lead_events(lead_id,actor_kind,action,after_data)
    values(p_lead,'System','lead_route_evaluated',result);
  return result;
end $$;

create or replace function pose_private.lead_mutate(p_lead uuid,p_version integer,p_action text,p_data jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r text; actor uuid; l public.leads; a public.lead_assignments; merged jsonb;
  k text; v jsonb; fields jsonb; m jsonb; old_m jsonb; selected_id uuid; sales uuid; prop uuid;
  extraction public.ai_extracted_preferences; previous jsonb; new_state public.lead_status; purchased date;
begin
  perform pg_advisory_xact_lock(740004,1);
  r:=pose_private.lead_access(p_lead); actor:=pose_private.require_account();
  select * into l from public.leads where id=p_lead for update;
  if p_version is null or p_version<>l.version then raise exception 'LEAD_VERSION_CONFLICT' using errcode='40001'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' or p_action is null then raise exception 'LEAD_INVALID_INPUT' using errcode='22023'; end if;
  select * into a from public.lead_assignments where lead_id=p_lead and is_active for update;
  if p_action<>'accept' and (p_reason is null or char_length(btrim(p_reason)) not between 3 and 1000) then
    raise exception 'LEAD_REASON_REQUIRED' using errcode='22023';
  end if;
  if l.archived and p_action<>'archive' then raise exception 'LEAD_ARCHIVED' using errcode='22023'; end if;

  if p_action='accept' then
    if p_data<>'{}'::jsonb or r<>'Sales' or a.sales_id is distinct from pose_private.lead_directory()
      or l.status in ('CONVERTED','LOST') then raise exception 'LEAD_FORBIDDEN' using errcode='42501'; end if;
    if not pose_private.lead_is_accepted(a.id) then
      insert into public.lead_events(lead_id,actor_id,actor_kind,action,after_data)
        values(p_lead,actor,r,'lead_accepted',jsonb_build_object('assignment_id',a.id,'sales_id',a.sales_id));
    else return pose_private.lead_item(p_lead);
    end if;
  elsif p_action='profile' then
    if exists(select 1 from jsonb_object_keys(p_data) x where x not in ('locations','property_types','budget_min','budget_max','buying_purpose','expected_timeline','notes','management'))
      or not(p_data ?& array['locations','property_types','budget_min','budget_max','buying_purpose','expected_timeline','notes','management'])
      or jsonb_typeof(p_data->'locations') is distinct from 'array' or jsonb_array_length(p_data->'locations')>10
      or jsonb_typeof(p_data->'property_types') is distinct from 'array' or jsonb_array_length(p_data->'property_types')>10
      or exists(select 1 from jsonb_array_elements(p_data->'locations') x where jsonb_typeof(x)<>'string' or char_length(btrim(x#>>'{}')) not between 1 and 200)
      or exists(select 1 from jsonb_array_elements_text(p_data->'property_types') x where x not in ('Apartment','House','Land','Villa','Office','Shop'))
      or jsonb_typeof(p_data->'buying_purpose') is distinct from 'string' or char_length(p_data->>'buying_purpose')>100
      or jsonb_typeof(p_data->'notes') is distinct from 'string' or char_length(p_data->>'notes')>5000
      or (p_data->>'expected_timeline' is not null and p_data->>'expected_timeline' not in ('lt3m','3to6m','gt6m','none')) then
      raise exception 'LEAD_INVALID_PROFILE' using errcode='22023';
    end if;
    foreach k in array array['budget_min','budget_max'] loop
      if p_data->>k is not null and (jsonb_typeof(p_data->k)<>'number' or (p_data->>k)::numeric<=0 or (p_data->>k)::numeric>1e15) then
        raise exception 'LEAD_INVALID_BUDGET' using errcode='22023';
      end if;
    end loop;
    if (p_data->>'budget_min')::numeric>(p_data->>'budget_max')::numeric then raise exception 'LEAD_INVALID_BUDGET' using errcode='22023'; end if;
    m:=p_data->'management'; old_m:=coalesce(l.needs->'management','{}');
    if jsonb_typeof(m) is distinct from 'object'
      or exists(select 1 from jsonb_object_keys(m) x where x not in ('transaction_type','bedrooms','bedrooms_required','area_min','area_max','area_required','selected_property_id'))
      or coalesce(m->>'transaction_type','Sale') not in ('Sale','Rent') then raise exception 'LEAD_INVALID_CRITERIA' using errcode='22023'; end if;
    foreach k in array array['bedrooms_required','area_required'] loop
      if m ? k and jsonb_typeof(m->k)<>'boolean' then raise exception 'LEAD_INVALID_CRITERIA' using errcode='22023'; end if;
    end loop;
    foreach k in array array['bedrooms','area_min','area_max'] loop
      if m->>k is not null and (jsonb_typeof(m->k)<>'number' or (m->>k)::numeric<0 or (m->>k)::numeric>1e9
        or k='bedrooms' and ((m->>k)::numeric>100 or (m->>k)::numeric<>trunc((m->>k)::numeric))) then
        raise exception 'LEAD_INVALID_CRITERIA' using errcode='22023';
      end if;
    end loop;
    if (m->>'area_min')::numeric>(m->>'area_max')::numeric
      or coalesce((m->>'bedrooms_required')::boolean,false) and m->>'bedrooms' is null
      or coalesce((m->>'area_required')::boolean,false) and m->>'area_min' is null and m->>'area_max' is null then
      raise exception 'LEAD_INVALID_CRITERIA' using errcode='22023';
    end if;
    selected_id:=nullif(m->>'selected_property_id','')::uuid;
    if selected_id is not null and not exists(select 1 from public.property_products where id=selected_id) then raise exception 'LEAD_PROPERTY_NOT_FOUND' using errcode='22023'; end if;
    merged:=l.needs;
    fields:=jsonb_build_object('locations',p_data->'locations','property_types',p_data->'property_types',
      'budget_min_vnd',p_data->'budget_min','budget_max_vnd',p_data->'budget_max','timeline',p_data->'expected_timeline');
    for k,v in select * from jsonb_each(fields) loop
      if merged->k->'value' is distinct from v then
        if v='null'::jsonb or v='[]'::jsonb then merged:=merged-k;
        else merged:=merged||jsonb_build_object(k,jsonb_build_object('value',v,'confirmed_by',actor,
          'confirmed_at',now(),'evidence',p_reason,'source',jsonb_build_object('kind',r))); end if;
        -- The human has explicitly chosen this value; old suggestions no longer
        -- remain outstanding, but their evidence is retained in the history table.
        update public.ai_extracted_preferences set status='Superseded'
          where lead_id=p_lead and field_name=k and status='Conflict';
      end if;
    end loop;
    merged:=merged||jsonb_build_object('management',m||jsonb_build_object('confirmed_by',actor,'confirmed_at',now()));
    merged:=jsonb_set(merged,'{review_required}',to_jsonb(exists(select 1 from public.ai_extracted_preferences where lead_id=p_lead and status='Conflict')));
    update public.leads set needs=merged,budget_min=(p_data->>'budget_min')::numeric,budget_max=(p_data->>'budget_max')::numeric,
      preferred_location=case when jsonb_array_length(p_data->'locations')=1 then p_data->'locations'->>0 end,
      preferred_property_type=case when jsonb_array_length(p_data->'property_types')=1 then p_data->'property_types'->>0 end,
      buying_purpose=p_data->>'buying_purpose',expected_timeline=p_data->>'expected_timeline',notes=p_data->>'notes'
      where id=p_lead;
  elsif p_action='status' then
    if exists(select 1 from jsonb_object_keys(p_data) x where x not in ('status','property_id','purchased_at'))
      or p_data->>'status' is null or p_data->>'status' not in ('NEW','CONTACTED','QUALIFIED','FOLLOW_UP','CONVERTED','LOST') then
      raise exception 'LEAD_INVALID_STATUS' using errcode='22023';
    end if;
    new_state:=(p_data->>'status')::public.lead_status;
    if l.status in ('CONVERTED','LOST') and new_state not in ('CONVERTED','LOST') and r<>'Admin' then
      raise exception 'LEAD_REOPEN_ADMIN_REQUIRED' using errcode='42501';
    end if;
    if new_state='CONVERTED' then
      prop:=(p_data->>'property_id')::uuid; purchased:=(p_data->>'purchased_at')::date;
      if prop is null or purchased is null or purchased>(now() at time zone 'Asia/Ho_Chi_Minh')::date
        or not exists(select 1 from public.property_products where id=prop) then raise exception 'LEAD_PURCHASE_REQUIRED' using errcode='22023'; end if;
    end if;
    update public.leads set status=new_state where id=p_lead;
  elsif p_action='archive' then
    if r<>'Admin' then raise exception 'LEAD_FORBIDDEN' using errcode='42501'; end if;
    if exists(select 1 from jsonb_object_keys(p_data) x where x<>'archived') or jsonb_typeof(p_data->'archived') is distinct from 'boolean'
      or l.status not in ('CONVERTED','LOST') then raise exception 'LEAD_ARCHIVE_CLOSED_ONLY' using errcode='22023'; end if;
    update public.leads set archived=(p_data->>'archived')::boolean where id=p_lead;
  elsif p_action='assign' then
    if r<>'Admin' then raise exception 'LEAD_FORBIDDEN' using errcode='42501'; end if;
    if a.id is not null then raise exception 'LEAD_ALREADY_ASSIGNED' using errcode='22023'; end if;
    if l.status in ('CONVERTED','LOST') or exists(select 1 from jsonb_object_keys(p_data) x where x not in ('sales_id','property_id')) then
      raise exception 'LEAD_INVALID_ASSIGNMENT' using errcode='22023';
    end if;
    sales:=(p_data->>'sales_id')::uuid; prop:=(p_data->>'property_id')::uuid;
    if sales is null or not pose_private.lead_sales_valid(sales) then raise exception 'LEAD_SALES_INACTIVE' using errcode='22023'; end if;
    if prop is not null and not exists(select 1 from pose_private.lead_matches(p_lead) where property_id=prop and sales_id=sales and owner_valid) then
      raise exception 'LEAD_MATCH_CHANGED' using errcode='40001';
    end if;
    perform pose_private.lead_assign(p_lead,sales,prop,actor,r,p_reason);
  elsif p_action='resolve_extraction' then
    if exists(select 1 from jsonb_object_keys(p_data) x where x not in ('extraction_id','accept'))
      or jsonb_typeof(p_data->'accept') is distinct from 'boolean' then raise exception 'LEAD_INVALID_INPUT' using errcode='22023'; end if;
    select * into extraction from public.ai_extracted_preferences
      where id=(p_data->>'extraction_id')::uuid and lead_id=p_lead and status='Conflict' for update;
    if extraction.id is null then raise exception 'LEAD_EXTRACTION_CHANGED' using errcode='40001'; end if;
    k:=extraction.field_name;
    if k not in ('locations','property_types','budget_min_vnd','budget_max_vnd','timeline','purchase_intent','contact_ready','next_step') then
      raise exception 'LEAD_INVALID_FIELD' using errcode='22023'; end if;
    if (p_data->>'accept')::boolean then
      v:=extraction.field_value::jsonb;
      previous:=jsonb_build_object('value',v,'confirmed_by',actor,'confirmed_at',now(),'evidence',extraction.evidence,
        'source',jsonb_build_object('kind',extraction.source_kind,'id',coalesce(extraction.source_session_id,extraction.source_call_id)));
      update public.ai_extracted_preferences set status=case when id=extraction.id then 'Accepted' else 'Superseded' end
        where lead_id=p_lead and field_name=k and status in ('Conflict','Accepted');
    else
      previous:=l.needs->k;
      -- Unconfirmed M06 conflicts can already have changed needs. Recover the
      -- previous snapshot when rejecting that exact suggestion.
      if not(coalesce(previous,'{}') ? 'confirmed_by') and previous->'value'=extraction.field_value::jsonb then
        select before_data->k into previous from public.lead_events
          where lead_id=p_lead and action='needs_extracted' and created_at>=extraction.created_at
            and after_data->k->'value'=extraction.field_value::jsonb
          order by created_at,id limit 1;
      end if;
      update public.ai_extracted_preferences set status='Superseded' where id=extraction.id;
      if previous is not null then previous:=previous||jsonb_build_object('confirmed_by',actor,'confirmed_at',now()); end if;
    end if;
    merged:=case when previous is null then l.needs-k else l.needs||jsonb_build_object(k,previous) end;
    merged:=jsonb_set(merged,'{review_required}',to_jsonb(exists(select 1 from public.ai_extracted_preferences where lead_id=p_lead and status='Conflict')));
    v:=previous->'value';
    update public.leads set needs=merged,
      budget_min=case when k='budget_min_vnd' then (v#>>'{}')::numeric else budget_min end,
      budget_max=case when k='budget_max_vnd' then (v#>>'{}')::numeric else budget_max end,
      preferred_location=case when k='locations' then case when jsonb_array_length(v)=1 then v->>0 end else preferred_location end,
      preferred_property_type=case when k='property_types' then case when jsonb_array_length(v)=1 then v->>0 end else preferred_property_type end,
      expected_timeline=case when k='timeline' then v#>>'{}' else expected_timeline end where id=p_lead;
  else raise exception 'LEAD_INVALID_ACTION' using errcode='22023';
  end if;
  update public.leads set version=version+1,updated_at=now() where id=p_lead;
  insert into public.lead_events(lead_id,actor_id,actor_kind,action,reason,before_data,after_data)
    values(p_lead,actor,r,'lead_'||p_action,p_reason,to_jsonb(l),
      jsonb_build_object('request',p_data,'lead',(select to_jsonb(x) from public.leads x where id=p_lead)));
  return pose_private.lead_item(p_lead);
end $$;

create or replace function pose_private.lead_owners(p_search text,p_page integer,p_size integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; n integer;
begin
  if pose_private.lead_staff()<>'Admin' then raise exception 'LEAD_FORBIDDEN' using errcode='42501'; end if;
  if char_length(coalesce(p_search,''))>120 or p_page is null or p_page not between 1 and 10000
    or p_size is null or p_size not between 1 and 50 then raise exception 'LEAD_INVALID_FILTER' using errcode='22023'; end if;
  with filtered as materialized (
    select p.id,p.code,p.name,p.location,p.publication,p.availability,p.property_type,
      j.name as project_name,o.sales_id,u.full_name as sales_name,coalesce(o.version,0) as owner_version,
      pose_private.lead_sales_valid(o.sales_id) as owner_valid
    from public.property_products p join public.property_projects j on j.id=p.project_id
    left join public.property_sales_owners o on o.property_id=p.id
    left join public.users u on u.id=o.sales_id
    where position(pose_private.lead_fold(p_search) in pose_private.lead_fold(p.code||' '||p.name||' '||p.location))>0
  )
  select (select count(*) from filtered),(select coalesce(jsonb_agg(to_jsonb(x) order by x.code,x.id),'[]')
    from (select * from filtered order by code,id limit p_size offset (p_page-1)*p_size) x) into n,result;
  return jsonb_build_object('items',result,'total',n,'page',p_page,'pageSize',p_size);
end $$;

create or replace function pose_private.lead_set_owner(p_property uuid,p_sales uuid,p_version integer,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; previous public.property_sales_owners; result public.property_sales_owners;
begin
  if pose_private.lead_staff()<>'Admin' then raise exception 'LEAD_FORBIDDEN' using errcode='42501'; end if;
  actor:=pose_private.require_account();
  perform pg_advisory_xact_lock(740004,1);
  perform 1 from public.property_products where id=p_property for update;
  if not found then raise exception 'LEAD_PROPERTY_NOT_FOUND' using errcode='P0002'; end if;
  select * into previous from public.property_sales_owners where property_id=p_property for update;
  if p_version is null or p_version<>coalesce(previous.version,0) then raise exception 'LEAD_VERSION_CONFLICT' using errcode='40001'; end if;
  if p_reason is null or char_length(btrim(p_reason)) not between 3 and 1000 then raise exception 'LEAD_REASON_REQUIRED' using errcode='22023'; end if;
  if p_sales is not null and not pose_private.lead_sales_valid(p_sales) then raise exception 'LEAD_SALES_INACTIVE' using errcode='22023'; end if;
  insert into public.property_sales_owners(property_id,sales_id,assigned_by,assigned_at,version)
    values(p_property,p_sales,actor,now(),coalesce(previous.version,0)+1)
    on conflict(property_id) do update set sales_id=excluded.sales_id,assigned_by=excluded.assigned_by,assigned_at=now(),version=excluded.version
    returning * into result;
  -- Use the existing property audit table; entity_kind/action are text in M02.
  insert into public.property_history(entity_kind,entity_id,actor_id,action,reason,before_data,after_data,source)
    values('properties',p_property,actor,'lead_owner_changed',p_reason,to_jsonb(previous),to_jsonb(result),'LeadManagement');
  return to_jsonb(result);
end $$;

create or replace function pose_private.lead_recheck(p_lead uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n integer;
begin
  if pose_private.lead_staff()<>'Admin' then raise exception 'LEAD_FORBIDDEN' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(740004,1);
  if p_lead is not null then
    perform pose_private.lead_access(p_lead);
    return pose_private.lead_route(p_lead);
  end if;
  insert into pose_private.lead_routing_queue(lead_id)
    select l.id from public.leads l where not l.archived and l.status not in ('CONVERTED','LOST')
      and not exists(select 1 from public.lead_assignments a where a.lead_id=l.id and a.is_active)
    on conflict(lead_id) do update set requested_at=now(),not_before=now(),attempts=0,last_error=null;
  get diagnostics n=row_count;
  return jsonb_build_object('queued',n);
end $$;

create or replace function pose_private.lead_route_batch(p_limit integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job record; result jsonb; processed integer:=0; failed integer:=0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'LEAD_SYSTEM_REQUIRED' using errcode='42501'; end if;
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'LEAD_INVALID_LIMIT' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(740004,1);
  for job in select * from pose_private.lead_routing_queue where not_before<=now()
    order by requested_at,lead_id limit p_limit for update skip locked loop
    begin
      result:=pose_private.lead_route(job.lead_id);
      delete from pose_private.lead_routing_queue where lead_id=job.lead_id;
      processed:=processed+1;
    exception when others then
      update pose_private.lead_routing_queue set attempts=attempts+1,last_error=sqlstate,
        not_before=now()+least(interval '1 hour',interval '30 seconds'*power(2,least(attempts,7)))
        where lead_id=job.lead_id;
      failed:=failed+1;
    end;
  end loop;
  return jsonb_build_object('processed',processed,'failed',failed);
end $$;

-- Optional M06 integration: record an EXPLICIT customer selection after handoff.
-- Citations alone do not call this function. Does not change M06 implementation.
create or replace function pose_private.lead_select_property(p_session uuid,p_property uuid,p_version integer,p_evidence text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare session_row public.ai_chat_sessions; l public.leads; m jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'LEAD_SYSTEM_REQUIRED' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(740004,1);
  select * into session_row from public.ai_chat_sessions where id=p_session;
  if session_row.lead_id is null or session_row.user_id is null or session_row.status='Closed'
    or p_property is null or not(p_property=any(session_row.property_ids))
    or p_evidence is null or char_length(btrim(p_evidence)) not between 3 and 2000 then
    raise exception 'LEAD_INVALID_SELECTION' using errcode='22023';
  end if;
  select * into l from public.leads where id=session_row.lead_id for update;
  if l.archived or l.status in ('CONVERTED','LOST')
    or not exists(select 1 from public.customers where id=l.customer_id and auth_user_id=session_row.user_id) then
    raise exception 'LEAD_INVALID_SELECTION' using errcode='22023';
  end if;
  if l.version is distinct from p_version then raise exception 'LEAD_VERSION_CONFLICT' using errcode='40001'; end if;
  m:=coalesce(l.needs->'management','{}');
  if m ? 'confirmed_by' and m->>'confirmed_by'<>session_row.user_id::text then
    raise exception 'LEAD_MANAGEMENT_CONFIRMATION_REQUIRED' using errcode='40001';
  end if;
  if not exists(select 1 from public.property_products where id=p_property) then raise exception 'LEAD_PROPERTY_NOT_FOUND' using errcode='22023'; end if;
  update public.leads set needs=jsonb_set(needs,'{management}',m||jsonb_build_object(
    'selected_property_id',p_property,'confirmed_by',session_row.user_id,'confirmed_at',now())),
    version=version+1,updated_at=now() where id=l.id;
  insert into public.lead_events(lead_id,actor_id,actor_kind,action,reason,before_data,after_data)
    values(l.id,session_row.user_id,'User','lead_property_selected',p_evidence,l.needs->'management',
      jsonb_build_object('property_id',p_property,'session_id',p_session));
  return jsonb_build_object('lead_id',l.id,'version',l.version+1,'property_id',p_property);
end $$;

create or replace function pose_private.lead_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.archived or new.status in ('CONVERTED','LOST') then
    delete from pose_private.lead_routing_queue where lead_id=new.id;
  else perform pose_private.lead_enqueue(new.id);
  end if;
  return new;
end $$;

create or replace function pose_private.lead_catalog_changed() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- Only Leads without an assignee need automatic assignment.
  insert into pose_private.lead_routing_queue(lead_id)
    select l.id from public.leads l
    where not l.archived and l.status not in ('CONVERTED','LOST')
      and not exists(select 1 from public.lead_assignments a where a.lead_id=l.id and a.is_active)
    on conflict(lead_id) do update set requested_at=now(),not_before=now(),attempts=0,last_error=null;
  return new;
end $$;

drop trigger if exists lead_route_lead on public.leads;
create trigger lead_route_lead after insert or update of needs,budget_min,budget_max,preferred_location,
  preferred_property_type,status,archived on public.leads for each row execute function pose_private.lead_changed();
drop trigger if exists lead_route_owner on public.property_sales_owners;
create trigger lead_route_owner after insert or update on public.property_sales_owners for each row execute function pose_private.lead_catalog_changed();
drop trigger if exists lead_route_property on public.property_products;
create trigger lead_route_property after insert or update of publication,availability,price,location,property_type,
  area,bedrooms,transaction_type,project_id,subdivision_id on public.property_products for each row execute function pose_private.lead_catalog_changed();
drop trigger if exists lead_route_project on public.property_projects;
create trigger lead_route_project after update of archived on public.property_projects for each row execute function pose_private.lead_catalog_changed();
drop trigger if exists lead_route_subdivision on public.property_subdivisions;
create trigger lead_route_subdivision after update of archived on public.property_subdivisions for each row execute function pose_private.lead_catalog_changed();
drop trigger if exists lead_route_sales on public.users;
create trigger lead_route_sales after update of role,account_status,banned_until,email_verified on public.users
  for each row execute function pose_private.lead_catalog_changed();

-- Private helpers have no client grants, including helpers returning customer data.
do $$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='pose_private' and p.proname=any(array['lead_staff','lead_directory','lead_sales_valid','lead_access','lead_enqueue','lead_fold','lead_location','lead_selected','lead_ready','lead_matches','lead_is_accepted','lead_item','lead_list','lead_detail','lead_options','lead_assign','lead_route','lead_mutate','lead_owners','lead_set_owner','lead_recheck','lead_route_batch','lead_select_property','lead_changed','lead_catalog_changed'])
  loop execute format('revoke all on function %s from public,anon,authenticated',f.signature); end loop;
end $$;

create or replace function public.pose_lead_list(p_filters jsonb,p_page integer,p_size integer) returns jsonb
language sql security definer set search_path='' as $$ select pose_private.lead_list(p_filters,p_page,p_size); $$;
create or replace function public.pose_lead_detail(p_lead uuid) returns jsonb
language sql security definer set search_path='' as $$ select pose_private.lead_detail(p_lead); $$;
create or replace function public.pose_lead_options() returns jsonb
language sql security definer set search_path='' as $$ select pose_private.lead_options(); $$;
create or replace function public.pose_lead_mutate(p_lead uuid,p_version integer,p_action text,p_data jsonb,p_reason text) returns jsonb
language sql security definer set search_path='' as $$ select pose_private.lead_mutate(p_lead,p_version,p_action,p_data,p_reason); $$;
create or replace function public.pose_lead_owners(p_search text,p_page integer,p_size integer) returns jsonb
language sql security definer set search_path='' as $$ select pose_private.lead_owners(p_search,p_page,p_size); $$;
create or replace function public.pose_lead_set_owner(p_property uuid,p_sales uuid,p_version integer,p_reason text) returns jsonb
language sql security definer set search_path='' as $$ select pose_private.lead_set_owner(p_property,p_sales,p_version,p_reason); $$;
create or replace function public.pose_lead_recheck(p_lead uuid default null) returns jsonb
language sql security definer set search_path='' as $$ select pose_private.lead_recheck(p_lead); $$;
create or replace function public.pose_lead_route_batch(p_limit integer default 25) returns jsonb
language sql security definer set search_path='' as $$ select pose_private.lead_route_batch(p_limit); $$;
create or replace function public.pose_lead_select_property(p_session uuid,p_property uuid,p_version integer,p_evidence text) returns jsonb
language sql security definer set search_path='' as $$ select pose_private.lead_select_property(p_session,p_property,p_version,p_evidence); $$;

revoke all on function public.pose_lead_list(jsonb,integer,integer),public.pose_lead_detail(uuid),
  public.pose_lead_options(),public.pose_lead_mutate(uuid,integer,text,jsonb,text),
  public.pose_lead_owners(text,integer,integer),public.pose_lead_set_owner(uuid,uuid,integer,text),
  public.pose_lead_recheck(uuid),public.pose_lead_route_batch(integer),
  public.pose_lead_select_property(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.pose_lead_list(jsonb,integer,integer),public.pose_lead_detail(uuid),
  public.pose_lead_options(),public.pose_lead_mutate(uuid,integer,text,jsonb,text),
  public.pose_lead_owners(text,integer,integer),public.pose_lead_set_owner(uuid,uuid,integer,text),
  public.pose_lead_recheck(uuid) to authenticated;
grant execute on function public.pose_lead_route_batch(integer),public.pose_lead_select_property(uuid,uuid,integer,text) to service_role;

insert into pose_private.lead_routing_queue(lead_id)
  select l.id from public.leads l where not l.archived and l.status not in ('CONVERTED','LOST')
      and not exists(select 1 from public.lead_assignments a where a.lead_id=l.id and a.is_active)
  on conflict(lead_id) do nothing;
commit;
