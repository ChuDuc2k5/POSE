-- Shared campaign/call layer for M07 (orchestration) and M08 (execution) on
-- top of the legacy campaigns, campaign_customers, calls, call_transcripts and
-- call_recordings tables. Apply after lead-contact-foundation.sql.

-- New enum labels must be committed before use, so they run outside the
-- transaction below. Legacy labels keep their meaning:
--   campaign_status DRAFT/RUNNING/PAUSED/STOPPED/COMPLETED (+SCHEDULED/CANCELLED/FAILED)
--   call_status WAITING=queued, CALLING=dispatching, ANSWERED=in progress,
--   COMPLETED, FAILED, RETRY (+UNKNOWN/RINGING/BUSY/NO_ANSWER/ENDING/CANCELED)
alter type public.campaign_status add value if not exists 'SCHEDULED';
alter type public.campaign_status add value if not exists 'CANCELLED';
alter type public.campaign_status add value if not exists 'FAILED';
alter type public.call_status add value if not exists 'UNKNOWN';
alter type public.call_status add value if not exists 'RINGING';
alter type public.call_status add value if not exists 'BUSY';
alter type public.call_status add value if not exists 'NO_ANSWER';
alter type public.call_status add value if not exists 'ENDING';
alter type public.call_status add value if not exists 'CANCELED';

begin;
create table public.call_scripts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 160),
  created_by uuid not null references auth.users(id) on delete restrict,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);

-- Published versions are immutable; each call keeps the version it used (BR-12).
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

-- BR-05/FR-M08-07 defaults; Admin may only configure stricter values.
alter table public.campaigns
  add column objective text not null default '' check (char_length(objective) <= 2000),
  add column property_ids uuid[] not null default '{}',
  add column script_version_id uuid references public.call_script_versions(id) on delete restrict,
  add column timezone text not null default 'Asia/Ho_Chi_Minh',
  add column window_start time not null default '09:00',
  add column window_end time not null default '17:00',
  add column weekdays smallint[] not null default '{1,2,3,4,5}',
  add column max_call_seconds integer not null default 300 check (max_call_seconds between 30 and 300),
  add column max_attempts integer not null default 3 check (max_attempts between 1 and 3),
  add column retry_after_hours integer not null default 24 check (retry_after_hours >= 24),
  add column daily_call_limit integer check (daily_call_limit > 0),
  add column budget_limit_vnd numeric(18,2) check (budget_limit_vnd > 0),
  add column cost_reserve_per_call_vnd numeric(18,2) check (cost_reserve_per_call_vnd > 0),
  add column budget_reserved_vnd numeric(18,2) not null default 0 check (budget_reserved_vnd >= 0),
  add column budget_spent_vnd numeric(18,2) not null default 0 check (budget_spent_vnd >= 0),
  add column status_reason text not null default '',
  add column config_version integer not null default 0,
  add column version integer not null default 0;
alter table public.campaigns add constraint campaigns_concurrency_limit check (max_concurrent_calls between 1 and 2);
alter table public.campaigns add constraint campaigns_window_order check (window_end > window_start);
alter table public.campaigns add constraint campaigns_time_order check (end_time is null or start_time is null or end_time > start_time);

-- Membership stays keyed by (campaign, customer); one open Lead per customer
-- makes it equivalent to the SRS (campaign, lead) uniqueness.
alter table public.campaign_customers
  add column id uuid not null default gen_random_uuid() unique,
  add column lead_id uuid references public.leads(id) on delete restrict,
  add column phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  add column skip_reason text,
  add column last_attempt_at timestamptz,
  add column next_attempt_at timestamptz,
  add column snapshot jsonb not null default '{}'::jsonb,
  add column version integer not null default 0,
  add column updated_at timestamptz not null default now();
alter table public.campaign_customers add constraint campaign_customers_status_values
  check (status in ('PENDING','QUEUED','IN_PROGRESS','RETRYING','COMPLETED','SKIPPED','OPTED_OUT','FAILED','EXHAUSTED','CANCELLED'));
alter table public.campaign_customers add constraint campaign_customers_retry_limit check (retry_count between 0 and 3);
create unique index campaign_customers_lead_idx on public.campaign_customers(campaign_id,lead_id) where lead_id is not null;
create index campaign_customers_status_idx on public.campaign_customers(campaign_id,status);
create index campaign_customers_phone_idx on public.campaign_customers(phone_e164);

-- M07 creates jobs; M08 claims them with a lease and dispatches.
create table public.call_jobs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete restrict,
  membership_id uuid not null references public.campaign_customers(id) on delete restrict,
  attempt_no integer not null check (attempt_no between 1 and 3),
  scheduled_at timestamptz not null,
  status text not null default 'Pending' check (status in ('Pending','Claimed','Dispatched','Done','Cancelled','Failed')),
  lease_owner text,
  lease_until timestamptz,
  idempotency_key text not null unique,
  cancel_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(membership_id,attempt_no)
);
create index call_jobs_due_idx on public.call_jobs(status,scheduled_at);

-- One legacy calls row per attempt (AI_AUTO_CALL) or Admin test call (MOCK_CALL).
alter table public.calls
  add column job_id uuid unique references public.call_jobs(id) on delete restrict,
  add column membership_id uuid references public.campaign_customers(id) on delete restrict,
  add column phone_e164 text check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  add column script_version_id uuid references public.call_script_versions(id) on delete restrict,
  add column provider text,
  add column provider_call_id text,
  add column end_reason text,
  add column error_code text,
  add column answered_at timestamptz,
  add column recording_status text not null default 'NotConsented' check (recording_status in ('NotConsented','Processing','Available','Failed')),
  add column transcript_status text not null default 'NotConsented' check (transcript_status in ('NotConsented','Processing','Available','Failed')),
  add column cost_estimated_vnd numeric(18,2),
  add column cost_actual numeric(18,4),
  add column cost_currency text,
  add column fx_rate numeric(18,6),
  add column fx_source text,
  add column updated_at timestamptz not null default now();
alter table public.calls add constraint calls_provider_call_unique unique(provider,provider_call_id);
create index calls_phone_idx on public.calls(phone_e164,created_at desc);
create index calls_campaign_status_idx on public.calls(campaign_id,status);

-- recording_url holds the private Storage object key, never a public URL.
alter table public.call_recordings
  add column checksum text check (checksum ~ '^[a-f0-9]{64}$'),
  add column size_bytes bigint check (size_bytes > 0),
  add column mime_type text;

do $$ declare t text; begin
  foreach t in array array['campaigns','campaign_customers','calls','call_transcripts','call_recordings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
alter table public.call_scripts enable row level security;
alter table public.call_script_versions enable row level security;
alter table public.call_jobs enable row level security;
revoke all on public.call_scripts,public.call_script_versions,public.call_jobs from public,anon,authenticated;
grant select on public.call_scripts,public.call_script_versions,public.call_jobs to authenticated;
create policy call_scripts_admin on public.call_scripts for select to authenticated using ((select pose_private.staff_role())='Admin');
create policy call_script_versions_admin on public.call_script_versions for select to authenticated using ((select pose_private.staff_role())='Admin');
create policy campaigns_admin on public.campaigns for select to authenticated using ((select pose_private.staff_role())='Admin');
create policy campaign_customers_admin on public.campaign_customers for select to authenticated using ((select pose_private.staff_role())='Admin');
create policy call_jobs_admin on public.call_jobs for select to authenticated using ((select pose_private.staff_role())='Admin');
create policy calls_admin on public.calls for select to authenticated using ((select pose_private.staff_role())='Admin');
create policy calls_sales on public.calls for select to authenticated using ((select pose_private.staff_role())='Sales' and pose_private.lead_assigned_to_me(lead_id));
-- Transcripts/recordings are read through short-lived gateway links only.
create policy call_transcripts_admin on public.call_transcripts for select to authenticated using ((select pose_private.staff_role())='Admin');
create policy call_recordings_admin on public.call_recordings for select to authenticated using ((select pose_private.staff_role())='Admin');
commit;
