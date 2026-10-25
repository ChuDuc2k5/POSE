-- Sales workspace. Apply after lead-management.sql and the existing property schema.
-- Adds consultation storage and Sales-only RPCs; existing module functions are unchanged.
begin;
select pg_advisory_xact_lock(740004,1);

do $$ begin
  if to_regprocedure('pose_private.lead_mutate(uuid,integer,text,jsonb,text)') is null
    or to_regclass('public.property_sales_owners') is null then
    raise exception 'SALES_PREREQUISITE: apply lead-management.sql first';
  end if;
end $$;

create table if not exists public.consultation_activities (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete restrict,
  assignment_id uuid not null references public.lead_assignments(id) on delete restrict,
  sales_id uuid not null references public.users(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  occurred_at timestamptz not null,
  channel text not null check(channel in ('Phone','Message','InPerson','Online')),
  content text not null check(char_length(btrim(content)) between 3 and 5000),
  feedback text not null default '' check(char_length(feedback)<=3000),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete restrict,
  cancel_reason text,
  version integer not null default 0 check(version>=0),
  request_key uuid not null,
  payload_fingerprint text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(created_by,request_key),
  check((cancelled_at is null and cancelled_by is null and cancel_reason is null)
    or (cancelled_at is not null and cancelled_by is not null and char_length(btrim(cancel_reason)) between 3 and 1000))
);
create index if not exists consultation_activities_lead_time on public.consultation_activities(lead_id,occurred_at desc,id);
create index if not exists consultation_activities_sales_time on public.consultation_activities(sales_id,occurred_at desc,id);

create table if not exists public.consultation_activity_properties (
  activity_id uuid not null references public.consultation_activities(id) on delete restrict,
  property_id uuid not null references public.property_products(id) on delete restrict,
  property_snapshot jsonb not null check(jsonb_typeof(property_snapshot)='object'),
  primary key(activity_id,property_id)
);
alter table public.consultation_activities enable row level security;
alter table public.consultation_activity_properties enable row level security;
revoke all on public.consultation_activities,public.consultation_activity_properties from public,anon,authenticated;

create or replace function pose_private.sales_filters(p_filters jsonb,p_page integer,p_size integer) returns void
language plpgsql stable security definer set search_path='' as $$
begin
  if jsonb_typeof(p_filters) is distinct from 'object' or p_page is null or p_page not between 1 and 10000
    or p_size is null or p_size not between 1 and 50
    or exists(select 1 from jsonb_object_keys(p_filters) k where k not in
      ('q','status','temperature','archived','sales_id','property_type','location','publication','availability','channel','lead_id','cancelled'))
    or char_length(coalesce(p_filters->>'q',''))>120 or char_length(coalesce(p_filters->>'location',''))>200
    or (p_filters ? 'status' and p_filters->>'status' not in ('NEW','CONTACTED','QUALIFIED','FOLLOW_UP','CONVERTED','LOST'))
    or (p_filters ? 'temperature' and p_filters->>'temperature' not in ('HOT','WARM','COLD','UNRATED'))
    or (p_filters ? 'property_type' and p_filters->>'property_type' not in ('Apartment','House','Land','Villa','Office','Shop'))
    or (p_filters ? 'publication' and p_filters->>'publication' not in ('Draft','Published','Hidden','Archived'))
    or (p_filters ? 'availability' and p_filters->>'availability' not in ('Available','Reserved','Sold','Unavailable'))
    or (p_filters ? 'channel' and p_filters->>'channel' not in ('Phone','Message','InPerson','Online'))
    or (p_filters ? 'cancelled' and p_filters->>'cancelled' not in ('true','false'))
    or (p_filters ? 'archived' and p_filters->>'archived' not in ('true','false')) then
    raise exception 'SALES_INVALID_FILTER' using errcode='22023';
  end if;
  if p_filters ? 'sales_id' then
    if pose_private.lead_staff()<>'Admin' then raise exception 'SALES_FORBIDDEN' using errcode='42501'; end if;
    perform (p_filters->>'sales_id')::uuid;
  end if;
  if p_filters ? 'lead_id' then perform (p_filters->>'lead_id')::uuid; end if;
end $$;

create or replace function pose_private.sales_options() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform pose_private.lead_staff();
  return jsonb_build_object('directory_id',pose_private.lead_directory(),
    'sales',coalesce((select jsonb_agg(jsonb_build_object('id',u.id,'name',u.full_name,
      'active',pose_private.lead_sales_valid(u.id)) order by u.full_name,u.id)
      from public.users u where u.role='Sales' or exists(select 1 from public.lead_assignments a where a.sales_id=u.id)
        or exists(select 1 from public.property_sales_owners o where o.sales_id=u.id)),'[]'));
end $$;

create or replace function pose_private.sales_leads(p_filters jsonb,p_page integer,p_size integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r text:=pose_private.lead_staff(); result jsonb; stats jsonb; n integer;
begin
  perform pose_private.sales_filters(p_filters,p_page,p_size);
  with visible as materialized (
    select l.* from public.leads l join public.lead_assignments a on a.lead_id=l.id and a.is_active
    where (r='Admin' or a.sales_id=pose_private.lead_directory())
      and (not p_filters ? 'sales_id' or a.sales_id=(p_filters->>'sales_id')::uuid)
      and l.archived=coalesce((p_filters->>'archived')::boolean,false)
  ), filtered as materialized (
    select l.* from visible l join public.customers c on c.id=l.customer_id
    where (not p_filters ? 'q' or position(pose_private.lead_fold(p_filters->>'q') in pose_private.lead_fold(c.full_name||' '||c.phone||' '||coalesce(c.email,'')))>0)
      and (not p_filters ? 'status' or l.status::text=p_filters->>'status')
      and (not p_filters ? 'temperature' or coalesce(l.temperature::text,'UNRATED')=p_filters->>'temperature')
  )
  select (select count(*) from filtered),
    (select coalesce(jsonb_agg(pose_private.lead_item(x.id)||jsonb_build_object(
      'activity_count',(select count(*) from public.consultation_activities ca where ca.lead_id=x.id and ca.cancelled_at is null),
      'last_activity_at',(select max(occurred_at) from public.consultation_activities ca where ca.lead_id=x.id and ca.cancelled_at is null))
      order by x.updated_at desc,x.id),'[]') from (select * from filtered order by updated_at desc,id limit p_size offset (p_page-1)*p_size) x),
    (select jsonb_build_object('total',count(*),'open',count(*) filter(where status not in ('CONVERTED','LOST')),
      'closed',count(*) filter(where status in ('CONVERTED','LOST')),
      'unaccepted',count(*) filter(where not exists(select 1 from public.lead_assignments a where a.lead_id=visible.id and a.is_active and pose_private.lead_is_accepted(a.id)))) from visible)
    into n,result,stats;
  return jsonb_build_object('items',result,'total',n,'page',p_page,'pageSize',p_size,'stats',stats);
end $$;

create or replace function pose_private.sales_property_access(p_property uuid) returns void
language plpgsql stable security definer set search_path='' as $$
declare r text:=pose_private.lead_staff();
begin
  if not exists(select 1 from public.property_sales_owners o where o.property_id=p_property and o.sales_id is not null
    and (r='Admin' or o.sales_id=pose_private.lead_directory())) then
    raise exception 'SALES_PROPERTY_FORBIDDEN' using errcode='42501';
  end if;
end $$;

create or replace function pose_private.sales_properties(p_filters jsonb,p_page integer,p_size integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r text:=pose_private.lead_staff(); result jsonb; n integer;
begin
  perform pose_private.sales_filters(p_filters,p_page,p_size);
  with filtered as materialized (
    select p.*,j.name as project_name,s.name as subdivision_name,o.sales_id,u.full_name as sales_name,
      (select m.id from public.property_media m where m.property_id=p.id and not m.removed and m.visible and m.visibility='Public' and m.media_type='Image' order by m.sort_order,m.id limit 1) as cover_id
    from public.property_products p join public.property_sales_owners o on o.property_id=p.id
    join public.users u on u.id=o.sales_id join public.property_projects j on j.id=p.project_id
    left join public.property_subdivisions s on s.id=p.subdivision_id
    where (r='Admin' or o.sales_id=pose_private.lead_directory())
      and (not p_filters ? 'sales_id' or o.sales_id=(p_filters->>'sales_id')::uuid)
      and (not p_filters ? 'q' or position(pose_private.lead_fold(p_filters->>'q') in pose_private.lead_fold(p.code||' '||p.name||' '||p.location))>0)
      and (not p_filters ? 'location' or pose_private.lead_location(p.location,p_filters->>'location'))
      and (not p_filters ? 'property_type' or p.property_type=p_filters->>'property_type')
      and (not p_filters ? 'publication' or p.publication=p_filters->>'publication')
      and (not p_filters ? 'availability' or p.availability=p_filters->>'availability')
  )
  select (select count(*) from filtered),(select coalesce(jsonb_agg(to_jsonb(x) order by x.code,x.id),'[]')
    from (select * from filtered order by code,id limit p_size offset (p_page-1)*p_size) x) into n,result;
  return jsonb_build_object('items',result,'total',n,'page',p_page,'pageSize',p_size);
end $$;

create or replace function pose_private.sales_property(p_property uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform pose_private.sales_property_access(p_property);
  return (select jsonb_build_object('item',to_jsonb(p)||jsonb_build_object('project_name',j.name,
    'subdivision_name',s.name,'sales_name',u.full_name,'sales_id',o.sales_id),
    'media',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'name',m.name,'media_type',m.media_type) order by m.sort_order,m.id),'[]')
      from public.property_media m where m.property_id=p.id and not m.removed and m.visible and m.visibility='Public'))
    from public.property_products p join public.property_projects j on j.id=p.project_id
    left join public.property_subdivisions s on s.id=p.subdivision_id
    join public.property_sales_owners o on o.property_id=p.id join public.users u on u.id=o.sales_id where p.id=p_property);
end $$;

create or replace function pose_private.sales_media(p_media uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare m public.property_media;
begin
  select * into m from public.property_media where id=p_media and not removed and visible and visibility='Public';
  if m.id is null then raise exception 'SALES_MEDIA_NOT_FOUND' using errcode='P0002'; end if;
  perform pose_private.sales_property_access(m.property_id);
  return jsonb_build_object('object_key',m.object_key,'name',m.name,'mime_type',m.mime_type);
end $$;

create or replace function pose_private.sales_activity_item(p_activity uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select to_jsonb(a)-'request_key'-'payload_fingerprint'||jsonb_build_object('sales_name',u.full_name,
    'customer_name',c.full_name,'lead_status',l.status,'lead_archived',l.archived,
    'can_edit',pose_private.lead_staff()='Sales' and a.created_by=auth.uid() and a.sales_id=pose_private.lead_directory()
      and a.cancelled_at is null and not l.archived and l.status not in ('CONVERTED','LOST')
      and exists(select 1 from public.lead_assignments x where x.lead_id=l.id and x.is_active and x.sales_id=pose_private.lead_directory()),
    'properties',(select coalesce(jsonb_agg(jsonb_build_object('property_id',ap.property_id,'snapshot',ap.property_snapshot) order by ap.property_id),'[]')
      from public.consultation_activity_properties ap where ap.activity_id=a.id))
  from public.consultation_activities a join public.users u on u.id=a.sales_id join public.leads l on l.id=a.lead_id
    join public.customers c on c.id=l.customer_id where a.id=p_activity;
$$;

create or replace function pose_private.sales_activities(p_filters jsonb,p_page integer,p_size integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r text:=pose_private.lead_staff(); n integer; result jsonb;
begin
  perform pose_private.sales_filters(p_filters,p_page,p_size);
  if p_filters ? 'lead_id' then perform pose_private.lead_access((p_filters->>'lead_id')::uuid); end if;
  with filtered as materialized (
    select a.id,a.occurred_at from public.consultation_activities a join public.leads l on l.id=a.lead_id
      join public.customers c on c.id=l.customer_id
    where (r='Admin' or exists(select 1 from public.lead_assignments x where x.lead_id=a.lead_id and x.is_active and x.sales_id=pose_private.lead_directory()))
      and (not p_filters ? 'sales_id' or a.sales_id=(p_filters->>'sales_id')::uuid)
      and (not p_filters ? 'lead_id' or a.lead_id=(p_filters->>'lead_id')::uuid)
      and (not p_filters ? 'channel' or a.channel=p_filters->>'channel')
      and (not p_filters ? 'cancelled' or (a.cancelled_at is not null)=(p_filters->>'cancelled')::boolean)
      and (not p_filters ? 'q' or position(pose_private.lead_fold(p_filters->>'q') in pose_private.lead_fold(c.full_name||' '||a.content||' '||a.feedback))>0)
  )
  select (select count(*) from filtered),(select coalesce(jsonb_agg(pose_private.sales_activity_item(x.id) order by x.occurred_at desc,x.id),'[]')
    from (select * from filtered order by occurred_at desc,id limit p_size offset (p_page-1)*p_size) x) into n,result;
  return jsonb_build_object('items',result,'total',n,'page',p_page,'pageSize',p_size);
end $$;

create or replace function pose_private.sales_detail(p_lead uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r text:=pose_private.lead_access(p_lead); l public.leads;
begin
  select * into l from public.leads where id=p_lead;
  return (pose_private.lead_detail(p_lead)-'matches')||jsonb_build_object('can_write',r='Sales'
    and not l.archived and l.status not in ('CONVERTED','LOST'),
    'confirmation',(select jsonb_build_object('at',e.created_at,'by',u.full_name,'reason',e.reason)
      from public.lead_events e left join public.users u on u.auth_user_id=e.actor_id
      where e.lead_id=p_lead and e.action='sales_needs_confirmed' order by e.created_at desc,e.id desc limit 1),
    'appointments',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'appointment_time',a.appointment_time,'ends_at',a.ends_at,'property_name',p.name,'property_code',p.code,'customer_name',c.full_name,'phone',c.phone,'note',a.notes,'status',a.status) order by a.appointment_time),'[]'::jsonb)
      from public.appointments a join public.customers c on c.id=a.customer_id left join public.property_products p on p.id=a.property_id
      where a.lead_id=p_lead and (r='Admin' or a.sales_id=pose_private.lead_directory())));
end $$;

create or replace function pose_private.sales_appointments(p_sales uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare r text:=pose_private.lead_staff(); directory uuid:=pose_private.lead_directory(); result jsonb;
begin
  if p_sales is not null and r<>'Admin' then raise exception 'SALES_FORBIDDEN' using errcode='42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'appointment_time',a.appointment_time,'ends_at',a.ends_at,
    'property_name',p.name,'property_code',p.code,'customer_name',c.full_name,'phone',c.phone,'note',a.notes,'status',a.status,'sales_name',u.full_name)
    order by a.appointment_time,a.id),'[]'::jsonb) into result
  from public.appointments a join public.customers c on c.id=a.customer_id left join public.property_products p on p.id=a.property_id
    left join public.users u on u.id=a.sales_id
  where a.appointment_time>=now() and a.status in ('SCHEDULED','CONFIRMED')
    and (r='Admin' and (p_sales is null or a.sales_id=p_sales) or r='Sales' and a.sales_id=directory);
  return result;
end $$;

-- Writes always serialize with M04, lock the Lead first and validate current ownership.
create or replace function pose_private.sales_mutate(p_lead uuid,p_version integer,p_action text,p_data jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid; directory uuid; l public.leads; assignment public.lead_assignments;
  activity public.consultation_activities; previous jsonb; current_needs jsonb; value jsonb; fields jsonb;
  prop uuid; ids uuid[]; happened timestamptz; fingerprint text; saved_activity_id uuid; k text; result jsonb;
begin
  perform pg_advisory_xact_lock(740004,1);
  if pose_private.lead_access(p_lead)<>'Sales' then raise exception 'SALES_READ_ONLY' using errcode='42501'; end if;
  actor:=pose_private.require_account(); directory:=pose_private.lead_directory();
  select * into l from public.leads where id=p_lead for update;
  select * into assignment from public.lead_assignments where lead_id=p_lead and is_active and sales_id=directory for update;
  if assignment.id is null then raise exception 'SALES_FORBIDDEN' using errcode='42501'; end if;
  if l.archived or l.status in ('CONVERTED','LOST') then raise exception 'SALES_LEAD_LOCKED' using errcode='22023'; end if;
  if jsonb_typeof(p_data) is distinct from 'object' or p_action is null then raise exception 'SALES_INVALID_INPUT' using errcode='22023'; end if;
  if p_action<>'activity_create' and (p_reason is null or char_length(btrim(p_reason)) not between 3 and 1000) then
    raise exception 'SALES_REASON_REQUIRED' using errcode='22023';
  end if;
  if p_action in ('activity_create','activity_edit') then
    if exists(select 1 from jsonb_object_keys(p_data) x where x not in
      ('request_key','activity_id','activity_version','occurred_at','channel','content','feedback','property_ids'))
      or p_data->>'channel' is null or p_data->>'channel' not in ('Phone','Message','InPerson','Online')
      or jsonb_typeof(p_data->'content') is distinct from 'string' or char_length(btrim(p_data->>'content')) not between 3 and 5000
      or jsonb_typeof(p_data->'feedback') is distinct from 'string' or char_length(p_data->>'feedback')>3000
      or jsonb_typeof(p_data->'property_ids') is distinct from 'array' or jsonb_array_length(p_data->'property_ids')>20 then
      raise exception 'SALES_INVALID_ACTIVITY' using errcode='22023';
    end if;
    happened:=(p_data->>'occurred_at')::timestamptz;
    if happened is null or not isfinite(happened) or happened>now()+interval '1 minute' then
      raise exception 'SALES_INVALID_DATE' using errcode='22023';
    end if;
    select coalesce(array_agg(distinct x::uuid order by x::uuid),'{}') into ids from jsonb_array_elements_text(p_data->'property_ids') x;
    if cardinality(ids)<>jsonb_array_length(p_data->'property_ids') or array_position(ids,null) is not null then
      raise exception 'SALES_INVALID_PROPERTIES' using errcode='22023';
    end if;
    if p_action='activity_create' then
      if p_data->>'request_key' is null or p_data ? 'activity_id' or p_data ? 'activity_version' then raise exception 'SALES_INVALID_ACTIVITY' using errcode='22023'; end if;
      fingerprint:=md5(jsonb_build_object('lead',p_lead,'time',happened,'channel',p_data->>'channel',
        'content',btrim(p_data->>'content'),'feedback',p_data->>'feedback','properties',ids)::text);
      select * into activity from public.consultation_activities where created_by=actor and request_key=(p_data->>'request_key')::uuid;
      if activity.id is not null then
        if activity.payload_fingerprint<>fingerprint then raise exception 'SALES_REQUEST_REUSED' using errcode='40001'; end if;
        return jsonb_build_object('item',pose_private.lead_item(p_lead),'activity_id',activity.id,'replayed',true);
      end if;
    end if;
  end if;
  if p_version is null or l.version<>p_version then raise exception 'SALES_VERSION_CONFLICT' using errcode='40001'; end if;

  if p_action in ('activity_edit','activity_cancel') then
    select * into activity from public.consultation_activities where id=(p_data->>'activity_id')::uuid and lead_id=p_lead for update;
    if activity.id is null then raise exception 'SALES_ACTIVITY_NOT_FOUND' using errcode='P0002'; end if;
    if activity.created_by<>actor or activity.sales_id<>directory then raise exception 'SALES_ACTIVITY_AUTHOR' using errcode='42501'; end if;
    if activity.version is distinct from (p_data->>'activity_version')::integer or activity.cancelled_at is not null then
      raise exception 'SALES_ACTIVITY_CHANGED' using errcode='40001';
    end if;
    previous:=pose_private.sales_activity_item(activity.id); saved_activity_id:=activity.id;
  end if;
  if p_action in ('activity_create','activity_edit') then
    if p_action='activity_edit' and p_data ? 'request_key' then raise exception 'SALES_INVALID_ACTIVITY' using errcode='22023'; end if;
    foreach prop in array ids loop
      if not exists(select 1 from public.property_sales_owners where property_id=prop and sales_id=directory)
        and not(p_action='activity_edit' and exists(select 1 from public.consultation_activity_properties ap where ap.activity_id=activity.id and ap.property_id=prop)) then
        raise exception 'SALES_PROPERTY_FORBIDDEN' using errcode='42501';
      end if;
    end loop;
    if p_action='activity_create' then
      insert into public.consultation_activities(lead_id,assignment_id,sales_id,created_by,occurred_at,channel,content,feedback,request_key,payload_fingerprint)
        values(p_lead,assignment.id,directory,actor,happened,p_data->>'channel',btrim(p_data->>'content'),p_data->>'feedback',(p_data->>'request_key')::uuid,fingerprint) returning id into saved_activity_id;
      if not pose_private.lead_is_accepted(assignment.id) then
        insert into public.lead_events(lead_id,actor_id,actor_kind,action,after_data)
          values(p_lead,actor,'Sales','lead_accepted',jsonb_build_object('assignment_id',assignment.id,'sales_id',directory,'source','consultation','activity_id',saved_activity_id));
      end if;
    else
      update public.consultation_activities set occurred_at=happened,channel=p_data->>'channel',content=btrim(p_data->>'content'),feedback=p_data->>'feedback',version=version+1,updated_at=now() where id=saved_activity_id;
      delete from public.consultation_activity_properties ap where ap.activity_id=saved_activity_id and not(ap.property_id=any(ids));
    end if;
    insert into public.consultation_activity_properties(activity_id,property_id,property_snapshot)
      select saved_activity_id,p.id,jsonb_build_object('id',p.id,'code',p.code,'name',p.name,'location',p.location,'price',p.price,'transaction_type',p.transaction_type)
      from public.property_products p where p.id=any(ids) on conflict do nothing;
  elsif p_action='activity_cancel' then
    if exists(select 1 from jsonb_object_keys(p_data) x where x not in ('activity_id','activity_version')) then raise exception 'SALES_INVALID_ACTIVITY' using errcode='22023'; end if;
    update public.consultation_activities set cancelled_at=now(),cancelled_by=actor,cancel_reason=p_reason,version=version+1,updated_at=now() where id=activity.id;
  elsif p_action='confirm_needs' then
    prop:=nullif(p_data->'management'->>'selected_property_id','')::uuid;
    if prop is not null and prop is distinct from pose_private.lead_selected(p_lead)
      and not exists(select 1 from public.property_sales_owners where property_id=prop and sales_id=directory) then
      raise exception 'SALES_PROPERTY_FORBIDDEN' using errcode='42501';
    end if;
    -- Reuse M04 validation/synchronization, then explicitly confirm unchanged values too.
    perform pose_private.lead_mutate(p_lead,p_version,'profile',p_data,p_reason);
    select needs into current_needs from public.leads where id=p_lead;
    fields:=jsonb_build_object('locations',p_data->'locations','property_types',p_data->'property_types',
      'budget_min_vnd',p_data->'budget_min','budget_max_vnd',p_data->'budget_max','timeline',p_data->'expected_timeline');
    for k,value in select * from jsonb_each(fields) loop
      if value<>'null'::jsonb and value<>'[]'::jsonb then
        current_needs:=current_needs||jsonb_build_object(k,coalesce(current_needs->k,'{}')||jsonb_build_object('value',value,
          'confirmed_by',actor,'confirmed_at',now(),'evidence',p_reason,'source',jsonb_build_object('kind','Sales')));
        update public.ai_extracted_preferences set status='Superseded' where lead_id=p_lead and field_name=k and status='Conflict';
      end if;
    end loop;
    current_needs:=jsonb_set(current_needs,'{review_required}',to_jsonb(exists(select 1 from public.ai_extracted_preferences where lead_id=p_lead and status='Conflict')));
    update public.leads set needs=current_needs where id=p_lead;
    insert into public.lead_events(lead_id,actor_id,actor_kind,action,reason,before_data,after_data)
      values(p_lead,actor,'Sales','sales_needs_confirmed',p_reason,l.needs,current_needs);
    return jsonb_build_object('item',pose_private.lead_item(p_lead));
  elsif p_action='result' then
    if p_data->>'status'='CONVERTED' and not exists(select 1 from public.property_sales_owners where property_id=(p_data->>'property_id')::uuid and sales_id=directory) then
      raise exception 'SALES_PROPERTY_FORBIDDEN' using errcode='42501';
    end if;
    result:=pose_private.lead_mutate(p_lead,p_version,'status',p_data,p_reason);
    -- Preserve the Sales result as an audit snapshot; catalog changes do not rewrite it.
    insert into public.lead_events(lead_id,actor_id,actor_kind,action,reason,before_data,after_data)
      values(p_lead,actor,'Sales','sales_result_confirmed',p_reason,jsonb_build_object('status',l.status),
        jsonb_build_object('status',p_data->>'status','purchased_at',case when p_data->>'status'='CONVERTED' then p_data->>'purchased_at' end,
          'property',case when p_data->>'status'='CONVERTED' then (select jsonb_build_object('id',p.id,'code',p.code,'name',p.name)
            from public.property_products p where p.id=(p_data->>'property_id')::uuid) end));
    return jsonb_build_object('item',result);
  else raise exception 'SALES_INVALID_ACTION' using errcode='22023';
  end if;
  update public.leads set version=version+1,updated_at=now() where id=p_lead;
  insert into public.lead_events(lead_id,actor_id,actor_kind,action,reason,before_data,after_data)
    values(p_lead,actor,'Sales','sales_'||p_action,coalesce(p_reason,''),previous,pose_private.sales_activity_item(saved_activity_id));
  return jsonb_build_object('item',pose_private.lead_item(p_lead),'activity_id',saved_activity_id);
end $$;

revoke all on function pose_private.sales_filters(jsonb,integer,integer),pose_private.sales_options(),
  pose_private.sales_leads(jsonb,integer,integer),pose_private.sales_property_access(uuid),pose_private.sales_properties(jsonb,integer,integer),
  pose_private.sales_property(uuid),pose_private.sales_media(uuid),pose_private.sales_activity_item(uuid),
  pose_private.sales_activities(jsonb,integer,integer),pose_private.sales_detail(uuid),pose_private.sales_appointments(uuid),pose_private.sales_mutate(uuid,integer,text,jsonb,text)
  from public,anon,authenticated;

create or replace function public.pose_sales_options() returns jsonb language sql security definer set search_path='' as $$ select pose_private.sales_options(); $$;
create or replace function public.pose_sales_leads(p_filters jsonb,p_page integer,p_size integer) returns jsonb language sql security definer set search_path='' as $$ select pose_private.sales_leads(p_filters,p_page,p_size); $$;
create or replace function public.pose_sales_properties(p_filters jsonb,p_page integer,p_size integer) returns jsonb language sql security definer set search_path='' as $$ select pose_private.sales_properties(p_filters,p_page,p_size); $$;
create or replace function public.pose_sales_property(p_property uuid) returns jsonb language sql security definer set search_path='' as $$ select pose_private.sales_property(p_property); $$;
create or replace function public.pose_sales_media(p_media uuid) returns jsonb language sql security definer set search_path='' as $$ select pose_private.sales_media(p_media); $$;
create or replace function public.pose_sales_activities(p_filters jsonb,p_page integer,p_size integer) returns jsonb language sql security definer set search_path='' as $$ select pose_private.sales_activities(p_filters,p_page,p_size); $$;
create or replace function public.pose_sales_detail(p_lead uuid) returns jsonb language sql security definer set search_path='' as $$ select pose_private.sales_detail(p_lead); $$;
create or replace function public.pose_sales_appointments(p_sales uuid default null) returns jsonb language sql security definer set search_path='' as $$ select pose_private.sales_appointments(p_sales); $$;
create or replace function public.pose_sales_mutate(p_lead uuid,p_version integer,p_action text,p_data jsonb,p_reason text) returns jsonb language sql security definer set search_path='' as $$ select pose_private.sales_mutate(p_lead,p_version,p_action,p_data,p_reason); $$;

revoke all on function public.pose_sales_options(),public.pose_sales_leads(jsonb,integer,integer),
  public.pose_sales_properties(jsonb,integer,integer),public.pose_sales_property(uuid),public.pose_sales_media(uuid),
  public.pose_sales_activities(jsonb,integer,integer),public.pose_sales_detail(uuid),public.pose_sales_appointments(uuid),public.pose_sales_mutate(uuid,integer,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.pose_sales_options(),public.pose_sales_leads(jsonb,integer,integer),
  public.pose_sales_properties(jsonb,integer,integer),public.pose_sales_property(uuid),public.pose_sales_media(uuid),
  public.pose_sales_activities(jsonb,integer,integer),public.pose_sales_detail(uuid),public.pose_sales_appointments(uuid),public.pose_sales_mutate(uuid,integer, text,jsonb,text) to authenticated;
commit;
