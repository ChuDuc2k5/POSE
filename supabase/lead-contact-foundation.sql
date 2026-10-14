-- Shared Lead/contact layer for M06-M08 on top of the legacy ERD tables
-- (customers, leads, lead_assignments, appointments). Apply after
-- property-discovery.sql. Only additive changes: legacy columns, enums and
-- data stay as they are so M04/M05/M09 can extend the same tables.
begin;
do $$ begin
  if to_regclass('public.customers') is null or to_regclass('public.leads') is null
    or to_regclass('public.lead_assignments') is null or to_regclass('public.appointments') is null then
    raise exception 'LEGACY_TABLES_MISSING: apply the base ERD and M01-M03 scripts first';
  end if;
end $$;

create function pose_private.staff_role() returns text
language sql stable security invoker set search_path='' as $$
  select case when (c->>'active')::boolean and (c->>'session_valid')::boolean and c->>'role' in ('Sales','Admin')
    then c->>'role' end
  from (select pose_private.pose_access_context() c) ctx;
$$;
-- Legacy assignments point at public.users(id); map the signed-in Auth user.
create function pose_private.current_directory_id() returns uuid
language sql stable security definer set search_path='' as $$
  select u.id from public.users u where u.auth_user_id=(select auth.uid());
$$;
create function pose_private.lead_assigned_to_me(p_lead uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.lead_assignments a join public.users u on u.id=a.sales_id
    where a.lead_id=p_lead and a.is_active and u.auth_user_id=(select auth.uid()));
$$;
revoke all on function pose_private.staff_role(),pose_private.current_directory_id(),pose_private.lead_assigned_to_me(uuid) from public,anon;
grant execute on function pose_private.staff_role(),pose_private.current_directory_id(),pose_private.lead_assigned_to_me(uuid) to authenticated;

-- BR-04: lead_score/temperature already exist; temperature null means Unrated.
alter table public.leads
  add column needs jsonb not null default '{}'::jsonb check (jsonb_typeof(needs)='object'),
  add column score_rule_version text,
  add column score_evidence jsonb,
  add column archived boolean not null default false,
  add column source text not null default 'Inquiry' check (source in ('Inquiry','WebChat','Call','Manual','Import')),
  add column version integer not null default 0;
alter table public.leads add constraint leads_score_range check (lead_score is null or lead_score between 0 and 100);

-- BR-06: independent, evidenced choices per purpose. Latest row per
-- (phone, purpose) is effective; rows are append-only.
create table public.contact_consents (
  id uuid primary key default gen_random_uuid(),
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  customer_id uuid references public.customers(id) on delete restrict,
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

-- Sales work queue. Legacy follow_ups requires a named Sales, so unassigned
-- hand-offs wait here until M05 assigns them.
create table public.lead_tasks (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete restrict,
  kind text not null check (kind in ('Handoff','Callback','Review')),
  priority text not null default 'Normal' check (priority in ('Low','Normal','High','Urgent')),
  assignee_id uuid references public.users(id) on delete restrict,
  status text not null default 'Open' check (status in ('Open','Done','Cancelled')),
  summary text not null check (char_length(btrim(summary)) between 3 and 2000),
  source text not null check (source in ('AI','System','Sales','Admin')),
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index lead_tasks_queue_idx on public.lead_tasks(status,assignee_id,created_at);

-- Legacy SCHEDULED is the SRS "Pending" proposal state.
alter table public.appointments
  add column ends_at timestamptz,
  add column source text check (source in ('AI','User','Sales','Admin')),
  add column idempotency_key text unique,
  add column version integer not null default 0;
alter table public.appointments add constraint appointments_end_after_start check (ends_at is null or ends_at > appointment_time);

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

-- Legacy tables are only reachable through RLS from here on.
do $$ declare t text; begin
  foreach t in array array['customers','leads','lead_assignments','appointments'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
alter table public.contact_consents enable row level security;
alter table public.contact_suppressions enable row level security;
alter table public.lead_tasks enable row level security;
alter table public.lead_events enable row level security;
revoke all on public.contact_consents,public.contact_suppressions,public.lead_tasks,public.lead_events from public,anon,authenticated;
grant select on public.contact_consents,public.contact_suppressions,public.lead_tasks,public.lead_events to authenticated;

create policy customers_admin on public.customers for select to authenticated using ((select pose_private.staff_role())='Admin');
create policy customers_sales on public.customers for select to authenticated using ((select pose_private.staff_role())='Sales'
  and exists(select 1 from public.leads l where l.customer_id=customers.id and pose_private.lead_assigned_to_me(l.id)));
create policy leads_admin on public.leads for select to authenticated using ((select pose_private.staff_role())='Admin');
create policy leads_sales on public.leads for select to authenticated using ((select pose_private.staff_role())='Sales' and pose_private.lead_assigned_to_me(id));
create policy lead_assignments_admin on public.lead_assignments for select to authenticated using ((select pose_private.staff_role())='Admin');
create policy lead_assignments_sales on public.lead_assignments for select to authenticated using ((select pose_private.staff_role())='Sales' and sales_id=(select pose_private.current_directory_id()));
create policy appointments_admin on public.appointments for select to authenticated using ((select pose_private.staff_role())='Admin');
create policy appointments_sales on public.appointments for select to authenticated using ((select pose_private.staff_role())='Sales' and sales_id=(select pose_private.current_directory_id()));
create policy consents_admin on public.contact_consents for select to authenticated using ((select pose_private.staff_role())='Admin');
create policy consents_sales on public.contact_consents for select to authenticated using ((select pose_private.staff_role())='Sales' and pose_private.lead_assigned_to_me(lead_id));
create policy suppressions_admin on public.contact_suppressions for select to authenticated using ((select pose_private.staff_role())='Admin');
create policy tasks_admin on public.lead_tasks for select to authenticated using ((select pose_private.staff_role())='Admin');
create policy tasks_sales on public.lead_tasks for select to authenticated using ((select pose_private.staff_role())='Sales'
  and (assignee_id=(select pose_private.current_directory_id()) or assignee_id is null));
create policy lead_events_admin on public.lead_events for select to authenticated using ((select pose_private.staff_role())='Admin');
create policy lead_events_sales on public.lead_events for select to authenticated using ((select pose_private.staff_role())='Sales' and pose_private.lead_assigned_to_me(lead_id));

-- Staff record what the customer said; never pre-checked or inferred (BR-06).
-- Withdrawing Call/AIVoice suppresses the number immediately; only an Admin
-- may lift a suppression, and only together with a new Call grant.
create function pose_private.record_consent(p_phone text,p_lead uuid,p_purpose text,p_status text,p_channel text,p_source text,p_evidence text,p_policy text,p_lift_suppression boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid; role text; c public.contact_consents; cust uuid;
begin
  actor:=pose_private.require_account(); role:=pose_private.staff_role();
  if role is null then raise exception 'STAFF_REQUIRED' using errcode='42501'; end if;
  if role='Sales' and (p_lead is null or not pose_private.lead_assigned_to_me(p_lead)) then
    raise exception 'LEAD_NOT_ASSIGNED' using errcode='42501'; end if;
  if p_lead is not null then select customer_id into cust from public.leads where id=p_lead; end if;
  insert into public.contact_consents(phone_e164,customer_id,lead_id,purpose,status,channel,source,evidence,policy_version,recorded_by)
  values(p_phone,cust,p_lead,p_purpose,p_status,p_channel,p_source,p_evidence,p_policy,actor) returning * into c;
  if p_status='Withdrawn' and p_purpose in ('Call','AIVoice') then
    insert into public.contact_suppressions(phone_e164,reason,source,actor_id)
    values(p_phone,'Khách hàng rút đồng ý '||p_purpose,role,actor) on conflict do nothing;
  elsif p_lift_suppression and p_status='Granted' and p_purpose='Call' then
    if role<>'Admin' then raise exception 'ADMIN_REQUIRED' using errcode='42501'; end if;
    update public.contact_suppressions set lifted_at=now(),lifted_by=actor,lift_consent_id=c.id where phone_e164=p_phone and lifted_at is null;
  end if;
  if p_lead is not null then
    insert into public.lead_events(lead_id,actor_id,actor_kind,action,after_data) values(p_lead,actor,role,'consent_recorded',to_jsonb(c));
  end if;
  return to_jsonb(c);
end $$;
create function public.pose_record_consent(p_phone text,p_lead uuid,p_purpose text,p_status text,p_channel text,p_source text,p_evidence text,p_policy text,p_lift_suppression boolean default false)
returns jsonb language sql security invoker set search_path='' as $$
  select pose_private.record_consent(p_phone,p_lead,p_purpose,p_status,p_channel,p_source,p_evidence,p_policy,p_lift_suppression); $$;
revoke all on function pose_private.record_consent(text,uuid,text,text,text,text,text,text,boolean),public.pose_record_consent(text,uuid,text,text,text,text,text,text,boolean) from public,anon;
grant execute on function pose_private.record_consent(text,uuid,text,text,text,text,text,text,boolean),public.pose_record_consent(text,uuid,text,text,text,text,text,text,boolean) to authenticated;
commit;
