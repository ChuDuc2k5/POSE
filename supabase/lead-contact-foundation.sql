-- Interim shared contract for M06/M07/M08. Apply after auth-access.sql,
-- account-profile.sql and property-management.sql.
-- M04 (Lead), M05 (Sales task) and M09 (Appointment) own these entities; when
-- those modules land they extend these tables instead of creating parallel ones.
begin;

create function pose_private.staff_role() returns text
language sql stable security invoker set search_path='' as $$
  select case when (c->>'active')::boolean and (c->>'session_valid')::boolean and c->>'role' in ('Sales','Admin')
    then c->>'role' end
  from (select pose_private.pose_access_context() c) ctx;
$$;
revoke all on function pose_private.staff_role() from public,anon;
grant execute on function pose_private.staff_role() to authenticated;

-- BR-03 stages; score/classification are separate from stage (BR-04).
create table public.leads (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references auth.users(id) on delete restrict,
  full_name text not null check (char_length(btrim(full_name)) between 1 and 160),
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  phone_verified boolean not null default false,
  stage text not null default 'NEW' check (stage in ('NEW','ASSIGNED','CONTACTED','QUALIFIED','APPOINTMENT','WON','LOST')),
  owner_id uuid references auth.users(id) on delete restrict,
  archived boolean not null default false,
  timezone text not null default 'Asia/Ho_Chi_Minh',
  source text not null default 'Manual' check (source in ('Manual','WebChat','Inquiry','Call','Import')),
  needs jsonb not null default '{}'::jsonb check (jsonb_typeof(needs)='object'),
  score integer check (score between 0 and 100),
  classification text not null default 'Unrated' check (classification in ('Hot','Warm','Cold','Unrated')),
  score_rule_version text,
  score_evidence jsonb,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (stage <> 'ASSIGNED' or owner_id is not null),
  check (phone_e164 is not null or not phone_verified)
);
-- BR-02: at most one open Lead per customer.
create unique index leads_one_open_per_customer on public.leads(customer_id)
  where customer_id is not null and stage not in ('WON','LOST') and not archived;
create index leads_owner_idx on public.leads(owner_id,updated_at desc);
create index leads_phone_idx on public.leads(phone_e164);

-- BR-06: each purpose is an independent choice. The latest row per
-- (phone, purpose) is effective; rows are append-only evidence.
create table public.contact_consents (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  lead_id uuid references public.leads(id) on delete restrict,
  purpose text not null check (purpose in ('Call','AIVoice','Transcript','Recording')),
  status text not null check (status in ('Granted','Withdrawn')),
  channel text not null check (channel in ('Web','Call','Sales','Import')),
  source text not null check (char_length(btrim(source)) between 2 and 120),
  evidence text not null check (char_length(btrim(evidence)) between 3 and 2000),
  policy_version text not null check (char_length(btrim(policy_version)) between 1 and 40),
  recorded_by uuid references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now()
);
create index contact_consents_phone_idx on public.contact_consents(phone_e164,purpose,recorded_at desc);

create table public.contact_suppressions (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  source text not null check (source in ('Customer','Sales','Admin','Call','System')),
  actor_id uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  lifted_by uuid references auth.users(id) on delete restrict,
  lift_consent_id uuid references public.contact_consents(id) on delete restrict,
  check ((lifted_at is null) = (lifted_by is null))
);
create unique index contact_suppressions_active on public.contact_suppressions(phone_e164) where lifted_at is null;

-- Sales work queue (M05) and appointment proposals (M09), minimal fields only.
create table public.lead_tasks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete restrict,
  kind text not null check (kind in ('Handoff','Callback','FollowUp','Review')),
  priority text not null default 'Normal' check (priority in ('Low','Normal','High','Urgent')),
  assignee_id uuid references auth.users(id) on delete restrict,
  status text not null default 'Open' check (status in ('Open','Done','Cancelled')),
  summary text not null check (char_length(btrim(summary)) between 3 and 2000),
  source text not null check (source in ('AI','System','Sales','Admin')),
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lead_tasks_queue_idx on public.lead_tasks(status,assignee_id,created_at);

create table public.appointments (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete restrict,
  sales_id uuid references auth.users(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'Pending' check (status in ('Pending','Confirmed','Completed','Cancelled','NoShow')),
  source text not null check (source in ('AI','User','Sales','Admin')),
  note text not null default '' check (char_length(note) <= 2000),
  idempotency_key text unique,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index appointments_lead_idx on public.appointments(lead_id,starts_at);

-- Immutable audit trail for Lead-affecting actions from any actor.
create table public.lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete restrict,
  actor_kind text not null check (actor_kind in ('User','Sales','Admin','AI','System')),
  action text not null check (char_length(action) between 2 and 80),
  reason text not null default '',
  before_data jsonb,
  after_data jsonb,
  created_at timestamptz not null default now()
);
create index lead_events_lead_idx on public.lead_events(lead_id,created_at desc);

-- Effective consent and suppression checks used by M06/M07/M08 (BR-05/BR-06).
create function pose_private.consent_granted(p_phone text,p_purpose text) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce((select c.status='Granted' from public.contact_consents c
    where c.phone_e164=p_phone and c.purpose=p_purpose order by c.recorded_at desc, c.id desc limit 1),false);
$$;
create function pose_private.phone_suppressed(p_phone text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.contact_suppressions s where s.phone_e164=p_phone and s.lifted_at is null);
$$;
revoke all on function pose_private.consent_granted(text,text),pose_private.phone_suppressed(text) from public,anon,authenticated;

alter table public.leads enable row level security;
alter table public.contact_consents enable row level security;
alter table public.contact_suppressions enable row level security;
alter table public.lead_tasks enable row level security;
alter table public.appointments enable row level security;
alter table public.lead_events enable row level security;
revoke all on public.leads,public.contact_consents,public.contact_suppressions,public.lead_tasks,public.appointments,public.lead_events from public,anon,authenticated;
grant select on public.leads,public.contact_consents,public.contact_suppressions,public.lead_tasks,public.appointments,public.lead_events to authenticated;
-- Writes go through module RPCs only (security definer, role-checked).
create policy leads_admin on public.leads for select to authenticated using ((select pose_private.staff_role())='Admin');
create policy leads_sales on public.leads for select to authenticated using ((select pose_private.staff_role())='Sales' and owner_id=(select auth.uid()));
create policy consents_admin on public.contact_consents for select to authenticated using ((select pose_private.staff_role())='Admin');
create policy consents_sales on public.contact_consents for select to authenticated using ((select pose_private.staff_role())='Sales'
  and exists(select 1 from public.leads l where l.id=lead_id and l.owner_id=(select auth.uid())));
create policy suppressions_admin on public.contact_suppressions for select to authenticated using ((select pose_private.staff_role())='Admin');
create policy tasks_admin on public.lead_tasks for select to authenticated using ((select pose_private.staff_role())='Admin');
create policy tasks_sales on public.lead_tasks for select to authenticated using ((select pose_private.staff_role())='Sales'
  and (assignee_id=(select auth.uid()) or assignee_id is null));
create policy appointments_admin on public.appointments for select to authenticated using ((select pose_private.staff_role())='Admin');
create policy appointments_sales on public.appointments for select to authenticated using ((select pose_private.staff_role())='Sales' and sales_id=(select auth.uid()));
create policy lead_events_admin on public.lead_events for select to authenticated using ((select pose_private.staff_role())='Admin');
create policy lead_events_sales on public.lead_events for select to authenticated using ((select pose_private.staff_role())='Sales'
  and exists(select 1 from public.leads l where l.id=lead_id and l.owner_id=(select auth.uid())));

-- Interim Admin entry point until M04 ships its Lead editor. Version-checked;
-- AI/System never call this (they use module RPCs that cannot set WON/LOST).
create function pose_private.save_lead(p_id uuid,p_version integer,p_data jsonb,p_reason text default '')
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; old public.leads; l public.leads; result jsonb;
begin
  actor:=pose_private.require_account();
  if pose_private.staff_role() is distinct from 'Admin' then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
  if p_data is null or jsonb_typeof(p_data)<>'object' or p_version is null then raise exception 'INVALID_INPUT' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(p_data) k where not k=any(array['customer_id','full_name','phone_e164','phone_verified','stage','owner_id','archived','timezone','source'])) then
    raise exception 'INVALID_FIELD' using errcode='22023'; end if;
  if p_id is null then
    if p_version<>0 then raise exception 'INVALID_VERSION' using errcode='22023'; end if;
    l:=jsonb_populate_record(null::public.leads,p_data);
    insert into public.leads(customer_id,full_name,phone_e164,phone_verified,stage,owner_id,archived,timezone,source)
    values(l.customer_id,btrim(l.full_name),l.phone_e164,coalesce(l.phone_verified,false),coalesce(l.stage,'NEW'),l.owner_id,coalesce(l.archived,false),coalesce(l.timezone,'Asia/Ho_Chi_Minh'),coalesce(l.source,'Manual'))
    returning * into l;
  else
    select * into old from public.leads where id=p_id for update;
    if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
    if old.version<>p_version then raise exception 'VERSION_CONFLICT' using errcode='40001'; end if;
    l:=jsonb_populate_record(old,p_data);
    if l.stage in ('WON','LOST') and l.stage is distinct from old.stage and char_length(btrim(coalesce(p_reason,'')))<3 then
      raise exception 'REASON_REQUIRED' using errcode='22023'; end if;
    update public.leads set customer_id=l.customer_id,full_name=btrim(l.full_name),phone_e164=l.phone_e164,phone_verified=l.phone_verified,
      stage=l.stage,owner_id=l.owner_id,archived=l.archived,timezone=l.timezone,source=l.source,version=version+1,updated_at=now()
    where id=p_id returning * into l;
  end if;
  result:=to_jsonb(l);
  insert into public.lead_events(lead_id,actor_id,actor_kind,action,reason,before_data,after_data)
  values(l.id,actor,'Admin',case when p_id is null then 'lead_created' else 'lead_updated' end,coalesce(p_reason,''),to_jsonb(old),result);
  return result;
end $$;
create function public.pose_save_lead(p_id uuid,p_version integer,p_data jsonb,p_reason text default '')
returns jsonb language sql security invoker set search_path='' as $$ select pose_private.save_lead(p_id,p_version,p_data,p_reason); $$;
revoke all on function pose_private.save_lead(uuid,integer,jsonb,text),public.pose_save_lead(uuid,integer,jsonb,text) from public,anon;
grant execute on function pose_private.save_lead(uuid,integer,jsonb,text),public.pose_save_lead(uuid,integer,jsonb,text) to authenticated;

-- Consent capture with evidence (BR-06). Staff record what the customer said;
-- never pre-checked, never inferred. A new verified Call grant may lift suppression.
create function pose_private.record_consent(p_phone text,p_lead uuid,p_purpose text,p_status text,p_channel text,p_source text,p_evidence text,p_policy text,p_lift_suppression boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; role text; c public.contact_consents;
begin
  actor:=pose_private.require_account(); role:=pose_private.staff_role();
  if role is null then raise exception 'STAFF_REQUIRED' using errcode='42501'; end if;
  if role='Sales' and (p_lead is null or not exists(select 1 from public.leads where id=p_lead and owner_id=actor)) then
    raise exception 'LEAD_NOT_ASSIGNED' using errcode='42501'; end if;
  insert into public.contact_consents(phone_e164,lead_id,purpose,status,channel,source,evidence,policy_version,recorded_by)
  values(p_phone,p_lead,p_purpose,p_status,p_channel,p_source,p_evidence,p_policy,actor) returning * into c;
  if p_status='Withdrawn' and p_purpose in ('Call','AIVoice') then
    insert into public.contact_suppressions(phone_e164,reason,source,actor_id)
    values(p_phone,'Khách hàng rút đồng ý '||p_purpose,role,actor) on conflict do nothing;
  elsif p_lift_suppression and p_status='Granted' and p_purpose='Call' then
    if role<>'Admin' then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
    update public.contact_suppressions set lifted_at=now(),lifted_by=actor,lift_consent_id=c.id where phone_e164=p_phone and lifted_at is null;
  end if;
  if p_lead is not null then
    insert into public.lead_events(lead_id,actor_id,actor_kind,action,after_data)
    values(p_lead,actor,role,'consent_recorded',to_jsonb(c));
  end if;
  return to_jsonb(c);
end $$;
create function public.pose_record_consent(p_phone text,p_lead uuid,p_purpose text,p_status text,p_channel text,p_source text,p_evidence text,p_policy text,p_lift_suppression boolean default false)
returns jsonb language sql security invoker set search_path='' as $$
  select pose_private.record_consent(p_phone,p_lead,p_purpose,p_status,p_channel,p_source,p_evidence,p_policy,p_lift_suppression); $$;
revoke all on function pose_private.record_consent(text,uuid,text,text,text,text,text,text,boolean),public.pose_record_consent(text,uuid,text,text,text,text,text,text,boolean) from public,anon;
grant execute on function pose_private.record_consent(text,uuid,text,text,text,text,text,text,boolean),public.pose_record_consent(text,uuid,text,text,text,text,text,text,boolean) to authenticated;
commit;
