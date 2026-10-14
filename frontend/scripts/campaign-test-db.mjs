import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
export async function createCampaignDatabase() {
 if(!process.env.PGLITE_PATH)throw Error('Set PGLITE_PATH to an external @electric-sql/pglite installation.');
 const {PGlite}=await import(pathToFileURL(join(process.env.PGLITE_PATH,'dist/index.js')));
 const db=new PGlite();
 await db.exec(`
 create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create schema storage;
 grant usage on schema auth,storage,public to anon,authenticated,service_role;
 alter default privileges in schema public grant all on tables to service_role;
 create table auth.users(id uuid primary key,aud text,role text,email text,email_confirmed_at timestamptz,raw_app_meta_data jsonb default '{}',raw_user_meta_data jsonb default '{}',created_at timestamptz,updated_at timestamptz,banned_until timestamptz,is_anonymous boolean default false,phone text,phone_confirmed_at timestamptz);
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),created_at timestamptz,updated_at timestamptz,not_after timestamptz);
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
 create function auth.role() returns text language sql stable as $$select auth.jwt()->>'role'$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 grant select,insert,delete on storage.objects to authenticated;
 create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
 create type public.user_status as enum('ACTIVE','INACTIVE','BLOCKED');
 create type public.lead_status as enum('NEW','CONTACTED','QUALIFIED','FOLLOW_UP','CONVERTED','LOST');
 create type public.lead_temperature as enum('HOT','WARM','COLD');
 create type public.appointment_status as enum('SCHEDULED','CONFIRMED','COMPLETED','CANCELLED','NO_SHOW');
 create type public.campaign_status as enum('DRAFT','RUNNING','PAUSED','STOPPED','COMPLETED');
 create type public.call_type as enum('AI_AUTO_CALL','MOCK_CALL','SALES_CALL');
 create type public.call_status as enum('WAITING','CALLING','ANSWERED','COMPLETED','FAILED','RETRY');
 create table public.users(id uuid primary key default gen_random_uuid(),full_name varchar not null,email varchar not null,phone varchar,avatar_url text,status public.user_status not null default 'ACTIVE',created_at timestamptz not null default now(),updated_at timestamptz not null default now(),auth_user_id uuid unique references auth.users(id),role text,account_status text,email_verified boolean not null default false,last_sign_in_at timestamptz,contact_phone text not null default '',avatar_path text,banned_until timestamptz,role_label text);
 create table public.customers(id uuid primary key default gen_random_uuid(),full_name varchar not null,phone varchar not null,email varchar,gender varchar,date_of_birth date,address text,source varchar,notes text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
 create table public.leads(id uuid primary key default gen_random_uuid(),customer_id uuid not null references public.customers(id),status public.lead_status not null default 'NEW',temperature public.lead_temperature,lead_score integer,budget_min numeric,budget_max numeric,preferred_location text,preferred_property_type varchar,buying_purpose varchar,expected_timeline varchar,interest_level varchar,notes text,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
 create table public.lead_assignments(id uuid primary key default gen_random_uuid(),lead_id uuid not null references public.leads(id),sales_id uuid not null references public.users(id),assigned_at timestamptz not null default now(),unassigned_at timestamptz,is_active boolean not null default true);
 create table public.properties(id uuid primary key default gen_random_uuid());
 create table public.appointments(id uuid primary key default gen_random_uuid(),lead_id uuid references public.leads(id),customer_id uuid references public.customers(id),sales_id uuid references public.users(id),property_id uuid references public.properties(id),appointment_time timestamptz not null,location text,status public.appointment_status not null default 'SCHEDULED',notes text,created_at timestamptz not null default now());
 create table public.campaigns(id uuid primary key default gen_random_uuid(),name varchar not null,description text,created_by uuid references public.users(id),status public.campaign_status not null default 'DRAFT',start_time timestamptz,end_time timestamptz,max_concurrent_calls integer not null default 1,ai_config jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
 create table public.campaign_customers(campaign_id uuid references public.campaigns(id),customer_id uuid references public.customers(id),status varchar not null default 'PENDING',retry_count integer not null default 0,added_at timestamptz not null default now(),primary key(campaign_id,customer_id));
 create table public.calls(id uuid primary key default gen_random_uuid(),customer_id uuid references public.customers(id),lead_id uuid references public.leads(id),campaign_id uuid references public.campaigns(id),sales_id uuid references public.users(id),call_type public.call_type not null,status public.call_status not null default 'WAITING',started_at timestamptz,ended_at timestamptz,duration_seconds integer,created_at timestamptz not null default now());
 create table public.call_transcripts(id uuid primary key default gen_random_uuid(),call_id uuid not null references public.calls(id),transcript text not null,language varchar,created_at timestamptz not null default now());
 create table public.call_recordings(id uuid primary key default gen_random_uuid(),call_id uuid not null references public.calls(id),recording_url text not null,duration_seconds integer,created_at timestamptz not null default now());
 create table public.ai_extracted_preferences(id uuid primary key default gen_random_uuid(),lead_id uuid not null references public.leads(id),field_name varchar not null,field_value text,confidence numeric,source_call_id uuid references public.calls(id),created_at timestamptz not null default now());
 create table public.ai_analyses(id uuid primary key default gen_random_uuid(),call_id uuid not null references public.calls(id),lead_id uuid references public.leads(id),needs text,budget numeric,interested_property text,preferred_location text,expected_timeline varchar,interest_level varchar,purchase_intent varchar,rejection_reason text,lead_score integer,temperature public.lead_temperature,summary text,raw_analysis jsonb,created_at timestamptz not null default now());
 `);
 for(const file of ['auth-access.sql','account-profile.sql','property-management.sql','property-discovery.sql','lead-contact-foundation.sql','calling-contract.sql','ai-agent.sql','campaign-management.sql']){
  await db.exec(await readFile(new URL(`../../supabase/${file}`,import.meta.url),'utf8'));
 }
 return db;
}
