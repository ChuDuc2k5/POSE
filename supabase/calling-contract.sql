-- Shared campaign/call tables used by M07 (campaign orchestration) and M08
-- (call execution). Apply after lead-contact-foundation.sql. Behaviour (RPCs,
-- extra columns, policies beyond read access) lives in each module's own file.
begin;

create table public.call_scripts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 160),
  created_by uuid not null references auth.users(id) on delete restrict,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- Published versions are immutable; calls keep the version they used (BR-12).
create table public.call_script_versions (
  id uuid primary key default gen_random_uuid(),
  script_id uuid not null references public.call_scripts(id) on delete restrict,
  version_no integer not null check (version_no > 0),
  status text not null default 'Draft' check (status in ('Draft','Published','Retired')),
  content jsonb not null check (jsonb_typeof(content)='object'),
  checksum text not null check (checksum ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique(script_id,version_no),
  check ((status='Draft') = (published_at is null))
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 160),
  objective text not null default '' check (char_length(objective) <= 2000),
  owner_id uuid not null references auth.users(id) on delete restrict,
  property_ids uuid[] not null default '{}',
  script_version_id uuid references public.call_script_versions(id) on delete restrict,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text not null default 'Asia/Ho_Chi_Minh',
  window_start time not null default '09:00',
  window_end time not null default '17:00',
  weekdays smallint[] not null default '{1,2,3,4,5}',
  -- BR-05/FR-M08-07 defaults; Admin may only configure stricter values.
  max_concurrency integer not null default 2 check (max_concurrency between 1 and 2),
  max_call_seconds integer not null default 300 check (max_call_seconds between 30 and 300),
  max_attempts integer not null default 3 check (max_attempts between 1 and 3),
  retry_after_hours integer not null default 24 check (retry_after_hours >= 24),
  daily_call_limit integer check (daily_call_limit > 0),
  budget_limit_vnd numeric(18,2) check (budget_limit_vnd > 0),
  cost_reserve_per_call_vnd numeric(18,2) check (cost_reserve_per_call_vnd > 0),
  budget_reserved_vnd numeric(18,2) not null default 0 check (budget_reserved_vnd >= 0),
  budget_spent_vnd numeric(18,2) not null default 0 check (budget_spent_vnd >= 0),
  status text not null default 'Draft' check (status in ('Draft','Scheduled','Running','Paused','Completed','Cancelled','Failed')),
  status_reason text not null default '',
  config_version integer not null default 0,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (window_end > window_start)
);

-- BR-07: one membership per (campaign, lead).
create table public.campaign_leads (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  lead_id uuid not null references public.leads(id) on delete restrict,
  phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  status text not null default 'Pending' check (status in ('Pending','Queued','InProgress','Retrying','Completed','Skipped','OptedOut','Failed','Exhausted','Cancelled')),
  skip_reason text,
  attempts_count integer not null default 0 check (attempts_count between 0 and 3),
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  snapshot jsonb not null default '{}'::jsonb,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_id,lead_id)
);
create index campaign_leads_status_idx on public.campaign_leads(campaign_id,status);
create index campaign_leads_phone_idx on public.campaign_leads(phone_e164);

-- M07 creates jobs; M08 claims them with a lease and dispatches.
create table public.call_jobs (
  id uuid primary key default gen_random_uuid(),
  campaign_lead_id uuid not null references public.campaign_leads(id) on delete restrict,
  attempt_no integer not null check (attempt_no between 1 and 3),
  scheduled_at timestamptz not null,
  status text not null default 'Pending' check (status in ('Pending','Claimed','Dispatched','Done','Cancelled','Failed')),
  lease_owner text,
  lease_until timestamptz,
  idempotency_key text not null unique,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(campaign_lead_id,attempt_no)
);
create index call_jobs_due_idx on public.call_jobs(status,scheduled_at);

create table public.call_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid unique references public.call_jobs(id) on delete restrict,
  campaign_id uuid references public.campaigns(id) on delete restrict,
  campaign_lead_id uuid references public.campaign_leads(id) on delete restrict,
  lead_id uuid references public.leads(id) on delete restrict,
  phone_e164 text not null check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  script_version_id uuid references public.call_script_versions(id) on delete restrict,
  is_test boolean not null default false,
  provider text not null,
  provider_call_id text,
  status text not null default 'Queued' check (status in ('Queued','Dispatching','Unknown','Ringing','InProgress','Ending','Completed','Busy','NoAnswer','Failed','Canceled')),
  end_reason text,
  error_code text,
  started_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  duration_seconds integer check (duration_seconds >= 0),
  cost_estimated_vnd numeric(18,2),
  cost_actual numeric(18,4),
  cost_currency text,
  fx_rate numeric(18,6),
  fx_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider,provider_call_id)
);
create index call_attempts_phone_idx on public.call_attempts(phone_e164,created_at desc);
create index call_attempts_campaign_idx on public.call_attempts(campaign_id,status);

alter table public.call_scripts enable row level security;
alter table public.call_script_versions enable row level security;
alter table public.campaigns enable row level security;
alter table public.campaign_leads enable row level security;
alter table public.call_jobs enable row level security;
alter table public.call_attempts enable row level security;
revoke all on public.call_scripts,public.call_script_versions,public.campaigns,public.campaign_leads,public.call_jobs,public.call_attempts from public,anon,authenticated;
grant select on public.call_scripts,public.call_script_versions,public.campaigns,public.campaign_leads,public.call_jobs,public.call_attempts to authenticated;
create policy call_scripts_admin on public.call_scripts for select to authenticated using ((select pose_private.staff_role())='Admin');
create policy call_script_versions_admin on public.call_script_versions for select to authenticated using ((select pose_private.staff_role())='Admin');
create policy campaigns_admin on public.campaigns for select to authenticated using ((select pose_private.staff_role())='Admin');
create policy campaign_leads_admin on public.campaign_leads for select to authenticated using ((select pose_private.staff_role())='Admin');
create policy call_jobs_admin on public.call_jobs for select to authenticated using ((select pose_private.staff_role())='Admin');
create policy call_attempts_admin on public.call_attempts for select to authenticated using ((select pose_private.staff_role())='Admin');
create policy call_attempts_sales on public.call_attempts for select to authenticated using ((select pose_private.staff_role())='Sales'
  and exists(select 1 from public.leads l where l.id=lead_id and l.owner_id=(select auth.uid())));
commit;
