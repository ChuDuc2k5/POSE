-- Manual appointment management on the existing public.appointments table.
-- Apply after lead-management.sql and the shared appointment foundation.
-- Existing M05/M06 functions, enum labels, grants and RLS policies are preserved.
begin;
select pg_advisory_xact_lock(740009,1);
do $$ begin
  if to_regprocedure('pose_private.lead_staff()') is null
    or to_regclass('public.property_sales_owners') is null or to_regclass('public.appointments') is null then
    raise exception 'APPOINTMENT_PREREQUISITE: apply the shared appointment schema and lead-management.sql first';
  end if;
  if to_regclass('public.consultation_appointments') is not null then
    raise exception 'APPOINTMENT_OLD_STORAGE_FOUND: review the earlier separate-table migration before upgrading; no data has been removed';
  end if;
  if exists(select 1 from unnest(array['ends_at','source','version','idempotency_key']) required(name)
    where not exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name='appointments' and c.column_name=required.name)) then
    raise exception 'APPOINTMENT_PREREQUISITE: shared appointments must include ends_at, source, version and idempotency_key';
  end if;
end $$;

-- Nullable additions keep existing records and the original AI INSERT statements valid.
-- The M09 RPC validates required fields on manual operations, not on AI records.
alter table public.appointments
  add column if not exists title text,
  add column if not exists channel text,
  add column if not exists result text,
  add column if not exists cancel_reason text,
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists payload_fingerprint text,
  add column if not exists updated_at timestamptz;
create index if not exists appointments_schedule_lookup on public.appointments(sales_id,appointment_time,ends_at) where status in ('SCHEDULED','CONFIRMED');
create index if not exists appointments_manual_lead_time on public.appointments(lead_id,appointment_time,id) where source in ('Sales','Admin');

create table if not exists public.appointment_events (
  id uuid primary key default gen_random_uuid(),
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text not null check(actor_role in ('Admin','Sales')),
  action text not null check(action in ('create','edit','reschedule','complete','cancel','correct')),
  reason text not null default '',
  before_data jsonb,
  after_data jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists appointment_history on public.appointment_events(appointment_id,created_at,id);

-- A per-Sales serialization guard, not an assignment/review queue.
-- Updating it serializes schedule checks at READ COMMITTED, and forces a retry
-- instead of a stale overlap check at REPEATABLE READ / SERIALIZABLE.
create table if not exists pose_private.appointment_calendars (
  sales_id uuid primary key references public.users(id) on delete cascade,
  revision bigint not null default 0
);
alter table public.appointment_events enable row level security;
alter table pose_private.appointment_calendars enable row level security;
revoke all on public.appointment_events,pose_private.appointment_calendars from public,anon,authenticated;

-- All writers use the same calendar guard, including the unchanged M06 RPCs.
-- Null ends_at keeps the shared legacy convention of a one-hour busy interval.
-- This does not require AI rows to have M09 metadata or change any existing rows.
create or replace function pose_private.appointment_schedule_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.sales_id is null or new.status not in ('SCHEDULED','CONFIRMED') then return new; end if;
  if tg_op='UPDATE' and new.sales_id is not distinct from old.sales_id
    and new.appointment_time is not distinct from old.appointment_time
    and new.ends_at is not distinct from old.ends_at and new.status is not distinct from old.status then return new; end if;
  insert into pose_private.appointment_calendars(sales_id,revision) values(new.sales_id,1)
    on conflict(sales_id) do update set revision=pose_private.appointment_calendars.revision+1;
  if exists(select 1 from public.appointments busy where busy.sales_id=new.sales_id
    and busy.status in ('SCHEDULED','CONFIRMED') and busy.id is distinct from new.id
    and busy.appointment_time<coalesce(new.ends_at,new.appointment_time+interval '1 hour')
    and coalesce(busy.ends_at,busy.appointment_time+interval '1 hour')>new.appointment_time) then
    raise exception 'APPOINTMENT_OVERLAP' using errcode='23P01';
  end if;
  return new;
end $$;
revoke all on function pose_private.appointment_schedule_guard() from public,anon,authenticated;
drop trigger if exists appointment_schedule_guard on public.appointments;
create trigger appointment_schedule_guard before insert or update of sales_id,appointment_time,ends_at,status
  on public.appointments for each row execute function pose_private.appointment_schedule_guard();

create or replace function pose_private.appointment_ready(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce(char_length(btrim(ap.title)) between 3 and 200 and ap.channel in ('Phone','Online','InPerson')
    and ap.ends_at is not null and ap.ends_at>ap.appointment_time
    and (ap.channel='Phone' or char_length(btrim(ap.location)) between 3 and 1000)
    and (ap.channel<>'Online' or ap.location ~* '^https?://[^[:space:]]+$')
    and (ap.status not in ('COMPLETED','CANCELLED') or (ap.status='COMPLETED' and char_length(btrim(ap.result)) between 3 and 3000)
      or (ap.status='CANCELLED' and char_length(btrim(ap.cancel_reason)) between 3 and 1000)),false)
  from public.appointments ap where ap.id=p_id;
$$;

create or replace function pose_private.appointment_visible(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  -- Appointments booked through the AI chat (source AI/User) are managed here too, once they have a Lead and a Sales.
  select exists(select 1 from public.appointments ap where ap.id=p_id and ap.source in ('Sales','Admin','AI','User')
    and ap.lead_id is not null and ap.sales_id is not null and
    (pose_private.lead_staff()='Admin' or (ap.sales_id=pose_private.lead_directory() and exists(
      select 1 from public.lead_assignments a where a.lead_id=ap.lead_id and a.is_active and a.sales_id=ap.sales_id))));
$$;
create or replace function pose_private.appointment_item(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
  select to_jsonb(ap)-'created_by'-'idempotency_key'-'payload_fingerprint'-'appointment_time'||jsonb_build_object(
    'title',coalesce(nullif(btrim(ap.title),''),case when ap.source in ('AI','User') then left('Xem nhà: '||coalesce(p.name,'bất động sản khách chọn'),200) else 'Lịch hẹn chưa có tiêu đề' end),'starts_at',ap.appointment_time,
    'location',coalesce(ap.location,''),'notes',coalesce(ap.notes,''),'result',coalesce(ap.result,''),'cancel_reason',coalesce(ap.cancel_reason,''),
    'updated_at',coalesce(ap.updated_at,ap.created_at),'needs_details',not pose_private.appointment_ready(ap.id),
    'customer',jsonb_build_object('id',c.id,'name',c.full_name,'phone',c.phone,'email',c.email),
    'sales_name',u.full_name,'lead_status',l.status,'lead_archived',l.archived,
    'property',case when p.id is not null then jsonb_build_object('id',p.id,'code',p.code,'name',p.name,'location',p.location) end,
    -- An open appointment that still needs details (e.g. booked by AI chat) can be managed so Sales can complete it.
    'can_manage',pose_private.lead_staff()='Admin' or (ap.status in ('SCHEDULED','CONFIRMED') and not l.archived and l.status not in ('CONVERTED','LOST')
      and ap.sales_id=pose_private.lead_directory() and exists(select 1 from public.lead_assignments a where a.lead_id=l.id and a.is_active and a.sales_id=ap.sales_id)))
  from public.appointments ap join public.leads l on l.id=ap.lead_id
  join public.customers c on c.id=l.customer_id join public.users u on u.id=ap.sales_id
  left join public.property_products p on p.id=ap.property_id where ap.id=p_id;
$$;

create or replace function pose_private.appointment_filters(p_filters jsonb,p_page integer,p_size integer) returns void
language plpgsql stable security definer set search_path='' as $$
begin
  perform pose_private.lead_staff();
  if jsonb_typeof(p_filters) is distinct from 'object' then raise exception 'APPOINTMENT_INVALID_FILTER' using errcode='22023'; end if;
  if p_page is null or p_page not between 1 and 10000 or p_size is null or p_size not between 1 and 50
    or exists(select 1 from jsonb_each(p_filters) f where f.key not in ('q','status','sales_id','lead_id','date_from','date_to') or jsonb_typeof(f.value)<>'string')
    or char_length(coalesce(p_filters->>'q',''))>120
    or (p_filters ? 'status' and p_filters->>'status' not in ('SCHEDULED','COMPLETED','CANCELLED')) then
    raise exception 'APPOINTMENT_INVALID_FILTER' using errcode='22023';
  end if;
  if p_filters ? 'sales_id' then
    if pose_private.lead_staff()<>'Admin' then raise exception 'APPOINTMENT_FORBIDDEN' using errcode='42501'; end if;
    perform (p_filters->>'sales_id')::uuid;
  end if;
  if p_filters ? 'lead_id' then perform (p_filters->>'lead_id')::uuid; end if;
  if p_filters ? 'date_from' then
    if p_filters->>'date_from' !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$' then raise exception 'APPOINTMENT_INVALID_DATE' using errcode='22023'; end if;
    perform (p_filters->>'date_from')::date;
  end if;
  if p_filters ? 'date_to' then
    if p_filters->>'date_to' !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}$' then raise exception 'APPOINTMENT_INVALID_DATE' using errcode='22023'; end if;
    perform (p_filters->>'date_to')::date;
  end if;
  if p_filters->>'date_from'>p_filters->>'date_to' then raise exception 'APPOINTMENT_INVALID_RANGE' using errcode='22023'; end if;
end $$;

create or replace function pose_private.appointment_list(p_filters jsonb,p_page integer,p_size integer) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare staff_role text:=pose_private.lead_staff(); items jsonb; total integer;
begin
  perform pose_private.appointment_filters(p_filters,p_page,p_size);
  with filtered as materialized (
    select ap.* from public.appointments ap join public.leads l on l.id=ap.lead_id join public.customers c on c.id=l.customer_id
    where ap.source in ('Sales','Admin','AI','User') and ap.sales_id is not null
      and (staff_role='Admin' or (ap.sales_id=pose_private.lead_directory() and exists(select 1 from public.lead_assignments a where a.lead_id=l.id and a.is_active and a.sales_id=ap.sales_id)))
      and (not p_filters ? 'q' or position(pose_private.lead_fold(p_filters->>'q') in pose_private.lead_fold(c.full_name||' '||coalesce(c.phone,'')||' '||coalesce(c.email,'')||' '||coalesce(ap.title,'')))>0)
      and (not p_filters ? 'status' or ap.status::text=p_filters->>'status' or p_filters->>'status'='SCHEDULED' and ap.status='CONFIRMED')
      and (not p_filters ? 'sales_id' or ap.sales_id=(p_filters->>'sales_id')::uuid)
      and (not p_filters ? 'lead_id' or ap.lead_id=(p_filters->>'lead_id')::uuid)
      and (not p_filters ? 'date_from' or ap.appointment_time>=((p_filters->>'date_from')::date::timestamp at time zone 'Asia/Ho_Chi_Minh'))
      and (not p_filters ? 'date_to' or ap.appointment_time<(((p_filters->>'date_to')::date+1)::timestamp at time zone 'Asia/Ho_Chi_Minh'))
  )
  select (select count(*) from filtered),(select coalesce(jsonb_agg(pose_private.appointment_item(x.id) order by x.appointment_time,x.id),'[]')
    from (select * from filtered order by appointment_time,id limit p_size offset (p_page-1)*p_size) x) into total,items;
  return jsonb_build_object('items',items,'total',total,'page',p_page,'pageSize',p_size,'role',staff_role);
end $$;

-- Paginated lookups avoid loading the full customer/property directory into a form.
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
      join public.lead_assignments a on a.lead_id=l.id and a.is_active join public.users u on u.id=a.sales_id
      where pose_private.lead_sales_valid(a.sales_id) and (staff_role='Admin' or (a.sales_id=pose_private.lead_directory() and not l.archived and l.status not in ('CONVERTED','LOST')))
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

create or replace function pose_private.appointment_detail(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare staff_role text:=pose_private.lead_staff();
begin
  if not pose_private.appointment_visible(p_id) then raise exception 'APPOINTMENT_NOT_FOUND' using errcode='P0002'; end if;
  return jsonb_build_object('item',pose_private.appointment_item(p_id),'lead',pose_private.lead_item((select lead_id from public.appointments where id=p_id)),'role',staff_role,'history',coalesce((
    select jsonb_agg(to_jsonb(e)||jsonb_build_object('actor_name',coalesce(u.full_name,e.actor_role)) order by e.created_at desc,e.id)
    from public.appointment_events e left join public.users u on u.auth_user_id=e.actor_id where e.appointment_id=p_id),'[]'));
end $$;

create or replace function pose_private.appointment_validate(p_data jsonb,p_keys text[]) returns void
language plpgsql immutable set search_path='' as $$
begin
  if jsonb_typeof(p_data) is distinct from 'object' then raise exception 'APPOINTMENT_INVALID_INPUT' using errcode='22023'; end if;
  if exists(select 1 from jsonb_each(p_data) f where not f.key=any(p_keys) or (f.key<>'property_id' and jsonb_typeof(f.value)<>'string')) then
    raise exception 'APPOINTMENT_INVALID_INPUT' using errcode='22023';
  end if;
  if p_keys @> array['title'] and (coalesce(char_length(btrim(p_data->>'title')),0) not between 3 and 200
    or coalesce(p_data->>'channel','') not in ('Phone','Online','InPerson')
    or p_data->>'location' is null or char_length(p_data->>'location')>1000
    or (p_data->>'channel'<>'Phone' and char_length(btrim(p_data->>'location'))<3)
    or (p_data->>'channel'='Online' and p_data->>'location' !~* '^https?://[^[:space:]]+$')
    or p_data->>'notes' is null or char_length(p_data->>'notes')>3000
    or not p_data ? 'property_id' or (jsonb_typeof(p_data->'property_id') not in ('string','null'))) then
    raise exception 'APPOINTMENT_INVALID_INPUT' using errcode='22023';
  end if;
  if p_keys @> array['starts_at'] and (coalesce(p_data->>'starts_at','') !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}T.*(Z|[+-][0-9]{2}:[0-9]{2})$'
    or coalesce(p_data->>'ends_at','') !~ '^[1-9][0-9]{3}-[0-9]{2}-[0-9]{2}T.*(Z|[+-][0-9]{2}:[0-9]{2})$') then
    raise exception 'APPOINTMENT_INVALID_TIME' using errcode='22023';
  end if;
end $$;

create or replace function pose_private.appointment_mutate(p_id uuid,p_version integer,p_action text,p_data jsonb,p_reason text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  staff_role text:=pose_private.lead_staff(); actor uuid:=auth.uid(); directory uuid:=pose_private.lead_directory();
  ap public.appointments; previous jsonb; l public.leads; target_sales uuid; prop uuid;
  start_time timestamptz; end_time timestamptz; fingerprint text; request_id text; keys text[];
begin
  p_reason:=btrim(coalesce(p_reason,''));
  if p_action is null or p_action not in ('create','edit','reschedule','complete','cancel','correct')
    or char_length(p_reason)>1000 then raise exception 'APPOINTMENT_INVALID_INPUT' using errcode='22023'; end if;
  if (p_action in ('reschedule','cancel','correct') or (staff_role='Admin' and p_action<>'create')) and char_length(p_reason)<3 then
    raise exception 'APPOINTMENT_REASON_REQUIRED' using errcode='22023';
  end if;
  if p_action='correct' and staff_role<>'Admin' then raise exception 'APPOINTMENT_FORBIDDEN' using errcode='42501'; end if;
  keys:=case p_action
    when 'create' then array['lead_id','title','starts_at','ends_at','channel','location','property_id','notes','request_key']
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
    fingerprint:=md5((p_data-'request_key')::text||p_reason);
    request_id:='manual:'||actor::text||':'||(p_data->>'request_key');
    -- Serialize duplicate submissions even if both arrive before either INSERT.
    perform pg_advisory_xact_lock(hashtextextended(actor::text||(p_data->>'request_key'),740009));
    select * into ap from public.appointments where idempotency_key=request_id;
    if found then
      if ap.created_by is distinct from actor or ap.payload_fingerprint is distinct from fingerprint then raise exception 'APPOINTMENT_IDEMPOTENCY_CONFLICT' using errcode='40001'; end if;
      if not pose_private.appointment_visible(ap.id) then raise exception 'APPOINTMENT_FORBIDDEN' using errcode='42501'; end if;
      return jsonb_build_object('item',pose_private.appointment_item(ap.id));
    end if;
    select * into l from public.leads where id=(p_data->>'lead_id')::uuid for share;
    select a.sales_id into target_sales from public.lead_assignments a where a.lead_id=l.id and a.is_active for share;
    if target_sales is null or not pose_private.lead_sales_valid(target_sales) then raise exception 'APPOINTMENT_NO_SALES' using errcode='22023'; end if;
    if staff_role='Sales' and target_sales is distinct from directory then raise exception 'APPOINTMENT_FORBIDDEN' using errcode='42501'; end if;
    if (l.archived or l.status in ('CONVERTED','LOST')) then
      if staff_role='Sales' then raise exception 'APPOINTMENT_LEAD_LOCKED' using errcode='55000'; end if;
      if char_length(p_reason)<3 then raise exception 'APPOINTMENT_REASON_REQUIRED' using errcode='22023'; end if;
    end if;
    ap.lead_id:=l.id; ap.customer_id:=l.customer_id; ap.sales_id:=target_sales; ap.source:=staff_role;
    ap.status:='SCHEDULED'; ap.result:=''; ap.cancel_reason:='';
  else
    if p_id is null or p_version is null or p_version<0 then raise exception 'APPOINTMENT_INVALID_INPUT' using errcode='22023'; end if;
    if not pose_private.appointment_visible(p_id) then raise exception 'APPOINTMENT_NOT_FOUND' using errcode='P0002'; end if;
    select * into ap from public.appointments where id=p_id for update;
    if ap.source is null or ap.source not in ('Sales','Admin','AI','User') or ap.lead_id is null or ap.sales_id is null then raise exception 'APPOINTMENT_NOT_FOUND' using errcode='P0002'; end if;
    select * into l from public.leads where id=ap.lead_id for share;
    -- Recheck current ownership after locks; never trust a stale page/session.
    perform 1 from public.lead_assignments a where a.lead_id=l.id and a.is_active and a.sales_id=ap.sales_id for share;
    if staff_role='Sales' and (not found or ap.sales_id is distinct from directory) then raise exception 'APPOINTMENT_FORBIDDEN' using errcode='42501'; end if;
    if staff_role='Sales' and (l.archived or l.status in ('CONVERTED','LOST')) then raise exception 'APPOINTMENT_LEAD_LOCKED' using errcode='55000'; end if;
    if staff_role='Sales' and ap.status not in ('SCHEDULED','CONFIRMED') then raise exception 'APPOINTMENT_LOCKED' using errcode='55000'; end if;
    if ap.version<>p_version then raise exception 'APPOINTMENT_VERSION_CONFLICT' using errcode='40001'; end if;
    if ap.status not in ('SCHEDULED','CONFIRMED') and p_action<>'correct' then raise exception 'APPOINTMENT_LOCKED' using errcode='55000'; end if;
    -- Missing details are filled with "edit"; only completing or rescheduling needs a complete appointment.
    if not pose_private.appointment_ready(ap.id) and p_action not in ('edit','cancel','correct') then
      raise exception 'APPOINTMENT_INCOMPLETE' using errcode='55000';
    end if;
    previous:=to_jsonb(ap)-'payload_fingerprint'-'idempotency_key'||jsonb_build_object('starts_at',ap.appointment_time);
    ap.notes:=coalesce(ap.notes,''); ap.location:=coalesce(ap.location,''); ap.result:=coalesce(ap.result,''); ap.cancel_reason:=coalesce(ap.cancel_reason,'');
  end if;

  if p_action in ('create','edit','correct') then
    prop:=(p_data->>'property_id')::uuid;
    if prop is not null and (p_action='create' or prop is distinct from ap.property_id) then
      perform 1 from public.property_sales_owners o join public.property_products p on p.id=o.property_id
        where o.property_id=prop and o.sales_id=ap.sales_id for share of o,p;
      if not found then raise exception 'APPOINTMENT_PROPERTY_FORBIDDEN' using errcode='42501'; end if;
    end if;
    ap.title:=btrim(p_data->>'title'); ap.channel:=p_data->>'channel'; ap.location:=btrim(p_data->>'location');
    ap.notes:=btrim(p_data->>'notes'); ap.property_id:=prop;
  end if;
  if p_action in ('create','reschedule','correct') then
    start_time:=(p_data->>'starts_at')::timestamptz; end_time:=(p_data->>'ends_at')::timestamptz;
    if not isfinite(start_time) or not isfinite(end_time) or end_time<=start_time then raise exception 'APPOINTMENT_INVALID_TIME' using errcode='22023'; end if;
    if (p_action='create' or (p_action='reschedule' and staff_role='Sales')) and start_time<=now() then raise exception 'APPOINTMENT_FUTURE_REQUIRED' using errcode='22023'; end if;
    ap.appointment_time:=start_time; ap.ends_at:=end_time;
  end if;
  if p_action='complete' then
    if staff_role='Sales' and clock_timestamp()<ap.appointment_time then raise exception 'APPOINTMENT_NOT_STARTED' using errcode='55000'; end if;
    ap.status:='COMPLETED'; ap.result:=btrim(p_data->>'result'); ap.cancel_reason:='';
  elsif p_action='cancel' then ap.status:='CANCELLED'; ap.cancel_reason:=p_reason; ap.result:='';
  elsif p_action='correct' then
    ap.status:=p_data->>'status'; ap.result:=btrim(p_data->>'result'); ap.cancel_reason:=btrim(p_data->>'cancel_reason');
  end if;
  if ap.status is null or ap.status not in ('SCHEDULED','CONFIRMED','COMPLETED','CANCELLED') or ap.result is null or ap.cancel_reason is null
    or char_length(ap.result)>3000 or char_length(ap.cancel_reason)>1000
    or (ap.status='COMPLETED' and (char_length(ap.result)<3 or ap.cancel_reason<>''))
    or (ap.status='CANCELLED' and (char_length(ap.cancel_reason)<3 or ap.result<>''))
    or (ap.status in ('SCHEDULED','CONFIRMED') and (ap.result<>'' or ap.cancel_reason<>'')) then
    raise exception 'APPOINTMENT_INVALID_RESULT' using errcode='22023';
  end if;

  insert into pose_private.appointment_calendars(sales_id,revision) values(ap.sales_id,1)
    on conflict(sales_id) do update set revision=pose_private.appointment_calendars.revision+1;
  if (p_action='create' or (p_action='reschedule' and staff_role='Sales')) and ap.appointment_time<=clock_timestamp() then
    raise exception 'APPOINTMENT_FUTURE_REQUIRED' using errcode='22023';
  end if;
  -- The shared trigger performs the authoritative overlap check for every writer.
  if p_action='create' then
    insert into public.appointments(lead_id,customer_id,sales_id,property_id,title,appointment_time,ends_at,channel,location,notes,status,source,result,cancel_reason,created_by,idempotency_key,payload_fingerprint,updated_at)
      values(ap.lead_id,ap.customer_id,ap.sales_id,ap.property_id,ap.title,ap.appointment_time,ap.ends_at,ap.channel,ap.location,ap.notes,'SCHEDULED',staff_role,'','',actor,request_id,fingerprint,now()) returning * into ap;
  else
    update public.appointments set property_id=ap.property_id,title=ap.title,appointment_time=ap.appointment_time,ends_at=ap.ends_at,
      channel=ap.channel,location=ap.location,notes=ap.notes,status=ap.status,result=ap.result,cancel_reason=ap.cancel_reason,version=version+1,updated_at=now()
      where id=p_id returning * into ap;
  end if;
  insert into public.appointment_events(appointment_id,actor_id,actor_role,action,reason,before_data,after_data)
    values(ap.id,actor,staff_role,p_action,p_reason,previous,to_jsonb(ap)-'payload_fingerprint'-'idempotency_key'||jsonb_build_object('starts_at',ap.appointment_time));
  return jsonb_build_object('item',pose_private.appointment_item(ap.id));
end $$;

revoke all on function pose_private.appointment_ready(uuid),pose_private.appointment_visible(uuid),pose_private.appointment_item(uuid),pose_private.appointment_filters(jsonb,integer,integer),
  pose_private.appointment_list(jsonb,integer,integer),pose_private.appointment_options(text,text,uuid,integer),pose_private.appointment_detail(uuid),
  pose_private.appointment_validate(jsonb,text[]),pose_private.appointment_mutate(uuid,integer,text,jsonb,text) from public,anon,authenticated;
create or replace function public.pose_appointment_list(p_filters jsonb,p_page integer,p_size integer) returns jsonb
language sql stable security definer set search_path='' as $$ select pose_private.appointment_list(p_filters,p_page,p_size); $$;
create or replace function public.pose_appointment_options(p_kind text,p_query text,p_lead uuid,p_page integer) returns jsonb
language sql stable security definer set search_path='' as $$ select pose_private.appointment_options(p_kind,p_query,p_lead,p_page); $$;
create or replace function public.pose_appointment_detail(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$ select pose_private.appointment_detail(p_id); $$;
create or replace function public.pose_appointment_mutate(p_id uuid,p_version integer,p_action text,p_data jsonb,p_reason text) returns jsonb
language sql security definer set search_path='' as $$ select pose_private.appointment_mutate(p_id,p_version,p_action,p_data,p_reason); $$;
revoke all on function public.pose_appointment_list(jsonb,integer,integer),public.pose_appointment_options(text,text,uuid,integer),public.pose_appointment_detail(uuid),public.pose_appointment_mutate(uuid,integer,text,jsonb,text) from public,anon,authenticated;
grant execute on function public.pose_appointment_list(jsonb,integer,integer),public.pose_appointment_options(text,text,uuid,integer),public.pose_appointment_detail(uuid),public.pose_appointment_mutate(uuid,integer,text,jsonb,text) to authenticated;
notify pgrst,'reload schema';
commit;
