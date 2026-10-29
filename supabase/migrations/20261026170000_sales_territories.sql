begin;

create table if not exists public.sales_territories (
  sales_id uuid not null references public.users(id) on delete cascade,
  district text not null check (char_length(btrim(district)) between 2 and 120),
  is_backup boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (sales_id, district)
);
alter table public.sales_territories enable row level security;
revoke all on public.sales_territories from public, anon, authenticated;
create index if not exists sales_territories_district_idx on public.sales_territories(district, is_backup, sales_id);

create or replace function pose_private.admin_sales_territories(p_sales uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform pose_private.m11_require_admin();
  if not exists(select 1 from public.users where id=p_sales and role='Sales') then
    raise exception 'SALES_NOT_FOUND' using errcode='P0002';
  end if;
  return jsonb_build_object(
    'sales_id',p_sales,
    'districts',coalesce((select jsonb_agg(district order by district) from public.sales_territories where sales_id=p_sales and not is_backup),'[]'::jsonb),
    'backup',coalesce((select jsonb_agg(district order by district) from public.sales_territories where sales_id=p_sales and is_backup),'[]'::jsonb)
  );
end $$;

create or replace function pose_private.admin_set_sales_territories(p_sales uuid,p_districts text[],p_backup text[]) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=pose_private.m11_require_admin(); districts text[]:=coalesce(p_districts,'{}'::text[]); backup text[]:=coalesce(p_backup,'{}'::text[]);
begin
  if not exists(select 1 from public.users where id=p_sales and role='Sales')
    or cardinality(districts)>100 or cardinality(backup)>100
    or exists(select 1 from unnest(districts||backup) d where d is null or char_length(btrim(d))<2 or char_length(d)>120)
    or exists(select 1 from unnest(districts) d group by d having count(*)>1)
    or exists(select 1 from unnest(backup) d group by d having count(*)>1) then
    raise exception 'SALES_TERRITORY_INVALID' using errcode='22023';
  end if;
  delete from public.sales_territories where sales_id=p_sales;
  insert into public.sales_territories(sales_id,district,is_backup)
    select p_sales,d,false from unnest(districts) d
    union all select p_sales,d,true from unnest(backup) d where not d=any(districts);
  insert into public.account_history(user_id,action,changed_fields)
    values(p_sales,'sales_territories_updated',jsonb_build_array('districts','backup'));
  return pose_private.admin_sales_territories(p_sales);
end $$;

create or replace function pose_private.admin_sales_suggestion_facts(p_lead uuid,p_property uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=pose_private.m11_require_admin(); property_location text; history_location text; preference_location text; keeper uuid; current_owner uuid;
begin
  if not exists(select 1 from public.leads where id=p_lead) then raise exception 'SALES_SUGGESTION_INVALID' using errcode='22023'; end if;
  select p.location into property_location from public.property_products p where p.id=p_property;
  select h.location into history_location from (
    select p.location, a.appointment_time as occurred_at
      from public.appointments a join public.property_products p on p.id=a.property_id
      where a.lead_id=p_lead and a.property_id is not null
    union all
    select p.location, i.created_at as occurred_at
      from public.property_inquiries i join public.property_products p on p.id=i.property_id
      where i.lead_id=p_lead and i.property_id is not null
  ) h order by h.occurred_at desc nulls last limit 1;
  select l.preferred_location into preference_location from public.leads l where l.id=p_lead;
  select o.sales_id into keeper from public.property_sales_owners o where o.property_id=p_property;
  select a.sales_id into current_owner from public.lead_assignments a where a.lead_id=p_lead and a.is_active;
  return jsonb_build_object(
    'property_location',property_location,
    'history_location',history_location,
    'preference_location',preference_location,
    'property_keeper_id',keeper,
    'current_owner_id',current_owner,
    'candidates',coalesce((select jsonb_agg(jsonb_build_object(
      'sales_id',u.id,
      'name',u.full_name,
      'territories',coalesce((select jsonb_agg(jsonb_build_object('district',t.district,'is_backup',t.is_backup) order by t.is_backup,t.district) from public.sales_territories t where t.sales_id=u.id),'[]'::jsonb),
      'upcoming_appointments',(select count(*) from public.appointments a where a.sales_id=u.id and a.status in ('SCHEDULED','CONFIRMED') and a.appointment_time>=now() and a.appointment_time<now()+interval '14 days'),
      'open_leads',(select count(*) from public.lead_assignments a join public.leads l on l.id=a.lead_id where a.sales_id=u.id and a.is_active and not l.archived and l.status not in ('CONVERTED','LOST')),
      'is_current_owner',u.id=current_owner
    ) order by u.full_name,u.id) from public.users u where u.role='Sales' and pose_private.lead_sales_valid(u.id)),'[]'::jsonb)
  );
end $$;

create or replace function public.pose_admin_sales_territories(p_sales uuid) returns jsonb
language sql security definer set search_path='' as $$ select pose_private.admin_sales_territories(p_sales); $$;
create or replace function public.pose_admin_set_sales_territories(p_sales uuid,p_districts text[],p_backup text[]) returns jsonb
language sql security definer set search_path='' as $$ select pose_private.admin_set_sales_territories(p_sales,p_districts,p_backup); $$;
create or replace function public.pose_admin_sales_suggestion_facts(p_lead uuid,p_property uuid default null) returns jsonb
language sql security definer set search_path='' as $$ select pose_private.admin_sales_suggestion_facts(p_lead,p_property); $$;

revoke all on function pose_private.admin_sales_territories(uuid),pose_private.admin_set_sales_territories(uuid,text[],text[]),pose_private.admin_sales_suggestion_facts(uuid,uuid) from public,anon,authenticated;
revoke all on function public.pose_admin_sales_territories(uuid),public.pose_admin_set_sales_territories(uuid,text[],text[]),public.pose_admin_sales_suggestion_facts(uuid,uuid) from public,anon,authenticated;
grant execute on function public.pose_admin_sales_territories(uuid),public.pose_admin_set_sales_territories(uuid,text[],text[]),public.pose_admin_sales_suggestion_facts(uuid,uuid) to authenticated;

-- Include territory chips in the existing M11 list/detail payloads without changing their public contract.
create or replace function public.pose_admin_sales_list(p_query text default '',p_status text default 'all',p_page integer default 1,p_size integer default 20) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  result:=pose_private.m11_sales_list(p_query,p_status,p_page,p_size);
  return jsonb_set(result,'{items}',coalesce((select jsonb_agg(item||jsonb_build_object('territories',coalesce((select jsonb_agg(t.district order by t.is_backup,t.district) from public.sales_territories t where t.sales_id=(item->>'id')::uuid),'[]'::jsonb)) order by item->>'name') from jsonb_array_elements(result->'items') item),'[]'::jsonb));
end $$;
create or replace function public.pose_admin_sales_detail(p_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  result:=pose_private.m11_sales_detail(p_id);
  return result||jsonb_build_object('territories',coalesce((select jsonb_agg(t.district order by t.is_backup,t.district) from public.sales_territories t where t.sales_id=p_id),'[]'::jsonb));
end $$;
revoke all on function public.pose_admin_sales_list(text,text,integer,integer),public.pose_admin_sales_detail(uuid) from public,anon,authenticated;
grant execute on function public.pose_admin_sales_list(text,text,integer,integer),public.pose_admin_sales_detail(uuid) to authenticated;

create or replace function pose_private.appointment_options(p_kind text,p_query text,p_lead uuid,p_page integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare staff_role text:=pose_private.lead_staff(); items jsonb; total integer; target_sales uuid;
begin
  if p_kind not in ('leads','properties','sales') or p_kind is null or p_query is null or char_length(p_query)>120 or p_page is null or p_page not between 1 and 10000 then
    raise exception 'APPOINTMENT_INVALID_FILTER' using errcode='22023';
  end if;
  if p_kind='sales' then
    if staff_role<>'Admin' then raise exception 'APPOINTMENT_FORBIDDEN' using errcode='42501'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.full_name) order by u.full_name,u.id),'[]') into items
      from public.users u where u.role='Sales' or exists(select 1 from public.appointments ap where ap.sales_id=u.id and ap.source in ('Sales','Admin'));
    return jsonb_build_object('items',items);
  elsif p_kind='leads' then
    with eligible as materialized (
      select l.id,c.full_name as name,c.phone,a.sales_id,u.full_name as sales_name,l.status,l.archived
      from public.leads l join public.customers c on c.id=l.customer_id
      left join public.lead_assignments a on a.lead_id=l.id and a.is_active left join public.users u on u.id=a.sales_id
      where (staff_role='Admin' and (a.id is null or pose_private.lead_sales_valid(a.sales_id)) or staff_role='Sales' and pose_private.lead_sales_valid(a.sales_id) and a.sales_id=pose_private.lead_directory() and not l.archived and l.status not in ('CONVERTED','LOST'))
        and position(pose_private.lead_fold(p_query) in pose_private.lead_fold(c.full_name||' '||coalesce(c.phone,'')))>0
    ) select (select count(*) from eligible),(select coalesce(jsonb_agg(to_jsonb(x) order by x.name,x.id),'[]') from
      (select * from eligible order by name,id limit 20 offset (p_page-1)*20) x) into total,items;
  else
    perform pose_private.lead_access(p_lead);
    select a.sales_id into target_sales from public.lead_assignments a where a.lead_id=p_lead and a.is_active;
    with eligible as materialized (
      select p.id,p.code,p.name,p.location from public.property_products p join public.property_sales_owners o on o.property_id=p.id
      where o.sales_id=target_sales and position(pose_private.lead_fold(p_query) in pose_private.lead_fold(p.code||' '||p.name||' '||p.location))>0
    ) select (select count(*) from eligible),(select coalesce(jsonb_agg(to_jsonb(x) order by x.code,x.id),'[]') from
      (select * from eligible order by code,id limit 20 offset (p_page-1)*20) x) into total,items;
  end if;
  return jsonb_build_object('items',items,'total',total,'page',p_page,'pageSize',20);
end $$;

create or replace function pose_private.appointment_mutate(p_id uuid,p_version integer,p_action text,p_data jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  staff_role text:=pose_private.lead_staff(); actor uuid:=auth.uid(); directory uuid:=pose_private.lead_directory();
  ap public.appointments; previous jsonb; l public.leads; target_sales uuid; chosen_sales uuid; prop uuid;
  start_time timestamptz; end_time timestamptz; fingerprint text; request_id text; keys text[];
begin
  p_reason:=btrim(coalesce(p_reason,''));
  if p_action is null or p_action not in ('create','edit','reschedule','complete','cancel','correct') or char_length(p_reason)>1000 then raise exception 'APPOINTMENT_INVALID_INPUT' using errcode='22023'; end if;
  if (p_action in ('reschedule','cancel','correct') or (staff_role='Admin' and p_action<>'create')) and char_length(p_reason)<3 then raise exception 'APPOINTMENT_REASON_REQUIRED' using errcode='22023'; end if;
  if p_action='correct' and staff_role<>'Admin' then raise exception 'APPOINTMENT_FORBIDDEN' using errcode='42501'; end if;
  if p_action='create' and staff_role<>'Admin' and p_data ? 'sales_id' then raise exception 'APPOINTMENT_FORBIDDEN' using errcode='42501'; end if;
  keys:=case p_action
    when 'create' then array['lead_id','title','starts_at','ends_at','channel','location','property_id','notes','request_key']||case when staff_role='Admin' then array['sales_id'] else array[]::text[] end
    when 'edit' then array['title','channel','location','property_id','notes']
    when 'reschedule' then array['starts_at','ends_at']
    when 'complete' then array['result']
    when 'cancel' then array[]::text[]
    else array['title','starts_at','ends_at','channel','location','property_id','notes','status','result','cancel_reason'] end;
  perform pose_private.appointment_validate(p_data,keys);
  if p_action='create' then
    if p_id is not null or p_version is not null or p_data->>'lead_id' is null or p_data->>'request_key' is null then raise exception 'APPOINTMENT_INVALID_INPUT' using errcode='22023'; end if;
    perform (p_data->>'request_key')::uuid;
    perform pose_private.lead_access((p_data->>'lead_id')::uuid);
    fingerprint:=md5((p_data-'request_key')::text||p_reason); request_id:='manual:'||actor::text||':'||(p_data->>'request_key');
    perform pg_advisory_xact_lock(hashtextextended(actor::text||(p_data->>'request_key'),740009));
    select * into ap from public.appointments where idempotency_key=request_id;
    if found then
      if ap.created_by is distinct from actor or ap.payload_fingerprint is distinct from fingerprint then raise exception 'APPOINTMENT_IDEMPOTENCY_CONFLICT' using errcode='40001'; end if;
      if not pose_private.appointment_visible(ap.id) then raise exception 'APPOINTMENT_FORBIDDEN' using errcode='42501'; end if;
      return jsonb_build_object('item',pose_private.appointment_item(ap.id));
    end if;
    select * into l from public.leads where id=(p_data->>'lead_id')::uuid for share;
    select a.sales_id into target_sales from public.lead_assignments a where a.lead_id=l.id and a.is_active for update;
    chosen_sales:=case when staff_role='Admin' and p_data ? 'sales_id' then nullif(p_data->>'sales_id','')::uuid end;
    if chosen_sales is not null and not pose_private.lead_sales_valid(chosen_sales) then raise exception 'APPOINTMENT_NO_SALES' using errcode='22023'; end if;
    if chosen_sales is not null and chosen_sales is distinct from target_sales then
      if char_length(p_reason)<3 then raise exception 'APPOINTMENT_REASON_REQUIRED' using errcode='22023'; end if;
      if target_sales is not null then
        update public.lead_assignments set is_active=false where lead_id=l.id and is_active;
        insert into public.lead_events(lead_id,actor_id,actor_kind,action,reason,before_data,after_data)
          values(l.id,actor,staff_role,'lead_unassigned',p_reason,jsonb_build_object('sales_id',target_sales),jsonb_build_object('sales_id',chosen_sales));
      end if;
      perform pose_private.lead_assign(l.id,chosen_sales,(p_data->>'property_id')::uuid,actor,staff_role,coalesce(nullif(p_reason,''),'Phân công khi tạo lịch hẹn'),false);
      target_sales:=chosen_sales;
    end if;
    if target_sales is null or not pose_private.lead_sales_valid(target_sales) then raise exception 'APPOINTMENT_NO_SALES' using errcode='22023'; end if;
    if staff_role='Sales' and target_sales is distinct from directory then raise exception 'APPOINTMENT_FORBIDDEN' using errcode='42501'; end if;
    if (l.archived or l.status in ('CONVERTED','LOST')) then
      if staff_role='Sales' then raise exception 'APPOINTMENT_LEAD_LOCKED' using errcode='55000'; end if;
      if char_length(p_reason)<3 then raise exception 'APPOINTMENT_REASON_REQUIRED' using errcode='22023'; end if;
    end if;
    ap.lead_id:=l.id; ap.customer_id:=l.customer_id; ap.sales_id:=target_sales; ap.source:=staff_role; ap.status:='SCHEDULED'; ap.result:=''; ap.cancel_reason:='';
  else
    if p_id is null or p_version is null or p_version<0 then raise exception 'APPOINTMENT_INVALID_INPUT' using errcode='22023'; end if;
    if not pose_private.appointment_visible(p_id) then raise exception 'APPOINTMENT_NOT_FOUND' using errcode='P0002'; end if;
    select * into ap from public.appointments where id=p_id for update;
    if ap.source is null or ap.source not in ('Sales','Admin','AI','User') or ap.lead_id is null or ap.sales_id is null then raise exception 'APPOINTMENT_NOT_FOUND' using errcode='P0002'; end if;
    select * into l from public.leads where id=ap.lead_id for share;
    perform 1 from public.lead_assignments a where a.lead_id=l.id and a.is_active and a.sales_id=ap.sales_id for share;
    if staff_role='Sales' and (not found or ap.sales_id is distinct from directory) then raise exception 'APPOINTMENT_FORBIDDEN' using errcode='42501'; end if;
    if staff_role='Sales' and (l.archived or l.status in ('CONVERTED','LOST')) then raise exception 'APPOINTMENT_LEAD_LOCKED' using errcode='55000'; end if;
    if staff_role='Sales' and ap.status not in ('SCHEDULED','CONFIRMED') then raise exception 'APPOINTMENT_LOCKED' using errcode='55000'; end if;
    if ap.version<>p_version then raise exception 'APPOINTMENT_VERSION_CONFLICT' using errcode='40001'; end if;
    if ap.status not in ('SCHEDULED','CONFIRMED') and p_action<>'correct' then raise exception 'APPOINTMENT_LOCKED' using errcode='55000'; end if;
    if not pose_private.appointment_ready(ap.id) and p_action not in ('edit','cancel','correct') then raise exception 'APPOINTMENT_INCOMPLETE' using errcode='55000'; end if;
    previous:=to_jsonb(ap)-'payload_fingerprint'-'idempotency_key'||jsonb_build_object('starts_at',ap.appointment_time);
    ap.notes:=coalesce(ap.notes,''); ap.location:=coalesce(ap.location,''); ap.result:=coalesce(ap.result,''); ap.cancel_reason:=coalesce(ap.cancel_reason,'');
  end if;
  if p_action in ('create','edit','correct') then
    prop:=(p_data->>'property_id')::uuid;
    if prop is not null and (p_action='create' or prop is distinct from ap.property_id) then
      perform 1 from public.property_sales_owners o join public.property_products p on p.id=o.property_id where o.property_id=prop and o.sales_id=ap.sales_id for share of o,p;
      if not found then raise exception 'APPOINTMENT_PROPERTY_FORBIDDEN' using errcode='42501'; end if;
    end if;
    ap.title:=btrim(p_data->>'title'); ap.channel:=p_data->>'channel'; ap.location:=btrim(p_data->>'location'); ap.notes:=btrim(p_data->>'notes'); ap.property_id:=prop;
  end if;
  if p_action in ('create','reschedule','correct') then
    start_time:=(p_data->>'starts_at')::timestamptz; end_time:=(p_data->>'ends_at')::timestamptz;
    if not isfinite(start_time) or not isfinite(end_time) or end_time<=start_time then raise exception 'APPOINTMENT_INVALID_TIME' using errcode='22023'; end if;
    if (p_action='create' or (p_action='reschedule' and staff_role='Sales')) and start_time<=now() then raise exception 'APPOINTMENT_FUTURE_REQUIRED' using errcode='22023'; end if;
    ap.appointment_time:=start_time; ap.ends_at:=end_time;
  end if;
  if p_action='complete' then if staff_role='Sales' and clock_timestamp()<ap.appointment_time then raise exception 'APPOINTMENT_NOT_STARTED' using errcode='55000'; end if; ap.status:='COMPLETED'; ap.result:=btrim(p_data->>'result'); ap.cancel_reason:='';
  elsif p_action='cancel' then ap.status:='CANCELLED'; ap.cancel_reason:=p_reason; ap.result:='';
  elsif p_action='correct' then ap.status:=p_data->>'status'; ap.result:=btrim(p_data->>'result'); ap.cancel_reason:=btrim(p_data->>'cancel_reason'); end if;
  if ap.status is null or ap.status not in ('SCHEDULED','CONFIRMED','COMPLETED','CANCELLED') or ap.result is null or ap.cancel_reason is null or char_length(ap.result)>3000 or char_length(ap.cancel_reason)>1000 or (ap.status='COMPLETED' and (char_length(ap.result)<3 or ap.cancel_reason<>'')) or (ap.status='CANCELLED' and (char_length(ap.cancel_reason)<3 or ap.result<>'')) or (ap.status in ('SCHEDULED','CONFIRMED') and (ap.result<>'' or ap.cancel_reason<>'')) then raise exception 'APPOINTMENT_INVALID_RESULT' using errcode='22023'; end if;
  insert into pose_private.appointment_calendars(sales_id,revision) values(ap.sales_id,1) on conflict(sales_id) do update set revision=pose_private.appointment_calendars.revision+1;
  if (p_action='create' or (p_action='reschedule' and staff_role='Sales')) and ap.appointment_time<=clock_timestamp() then raise exception 'APPOINTMENT_FUTURE_REQUIRED' using errcode='22023'; end if;
  if p_action='create' then
    insert into public.appointments(lead_id,customer_id,sales_id,property_id,title,appointment_time,ends_at,channel,location,notes,status,source,result,cancel_reason,created_by,idempotency_key,payload_fingerprint,updated_at) values(ap.lead_id,ap.customer_id,ap.sales_id,ap.property_id,ap.title,ap.appointment_time,ap.ends_at,ap.channel,ap.location,ap.notes,'SCHEDULED',staff_role,'','',actor,request_id,fingerprint,now()) returning * into ap;
  else
    update public.appointments set property_id=ap.property_id,title=ap.title,appointment_time=ap.appointment_time,ends_at=ap.ends_at,channel=ap.channel,location=ap.location,notes=ap.notes,status=ap.status,result=ap.result,cancel_reason=ap.cancel_reason,version=version+1,updated_at=now() where id=p_id returning * into ap;
  end if;
  insert into public.appointment_events(appointment_id,actor_id,actor_role,action,reason,before_data,after_data) values(ap.id,actor,staff_role,p_action,p_reason,previous,to_jsonb(ap)-'payload_fingerprint'-'idempotency_key'||jsonb_build_object('starts_at',ap.appointment_time));
  return jsonb_build_object('item',pose_private.appointment_item(ap.id));
end $$;

commit;
