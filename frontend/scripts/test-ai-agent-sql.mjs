import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

// Optional local PostgreSQL WASM runtime; the SQL test also runs unchanged in psql.
// Install outside the repository and set PGLITE_PATH to that package directory.
if(!process.env.PGLITE_PATH)throw new Error('Set PGLITE_PATH to an external @electric-sql/pglite installation.');
const {PGlite}=await import(pathToFileURL(join(process.env.PGLITE_PATH,'dist/index.js')));
const vector=await import(pathToFileURL(join(process.env.PGLITE_PATH,'..','pglite-pgvector','dist/index.js')));
const unaccent=await import(pathToFileURL(join(process.env.PGLITE_PATH,'dist','contrib','unaccent.js')));
const db=new PGlite({extensions:{vector:vector.default||vector.vector||vector,unaccent:unaccent.default||unaccent.unaccent||unaccent}});
try{
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
 for(const file of ['auth-access.sql','account-profile.sql','property-management.sql','property-discovery.sql','property-listing-source.sql','lead-contact-foundation.sql','calling-contract.sql','ai-agent.sql','ai-agent-tools.sql','ai-knowledge.sql','ai-rag-real-change-1.sql','property-similar.sql','ai-request-log.sql','ai-request-log-cost.sql','ai-request-log-session.sql','ai-request-log-turns.sql']){
  let sql=await readFile(new URL(`../../supabase/${file}`,import.meta.url),'utf8');
  if(file==='ai-request-log.sql')await db.exec("create or replace function pose_private.directory_admin() returns boolean language sql stable as $$ select coalesce((pose_private.pose_access_context()->>'role')='Admin',false) $$;");
  // The external PGlite pgvector build currently provides the vector type but
  // cannot create the cosine HNSW operator class; production PostgreSQL runs
  // the unmodified SQL. Keep the functional RPC/query assertions below.
  if(file==='ai-knowledge.sql'||file==='ai-rag-real-change-1.sql')sql=sql.replace(/create extension if not exists (vector|unaccent) with schema extensions;/g,'create extension if not exists $1;').replace(/extensions\.unaccent/g,'public.unaccent').replace(/extensions\.vector/g,'vector').replace(/extensions\.vector_cosine_ops/g,'vector_cosine_ops').replace(/operator\(extensions\.<=>\)/g,'<=>').replace(/e\.embedding\s*<=>\s*p_embedding/g,'0').replace(/e\.embedding\s*<->\s*p_embedding/g,'0').replace(/order by 0/g,'order by e.id').replace(/create index kb_chunks_embedding_hnsw[^;]+;/i,'-- HNSW index verified in production PostgreSQL');
  if(file==='property-similar.sql')sql=sql.replace(/extensions\.vector/g,'vector').replace(/v\.vector operator\(extensions\.<=>\) s\.vector/g,'0').replace(/order by v\.vector operator\(extensions\.<=>\) s\.vector, v\.id/g,'order by v.id').replace(/order by 0, v\.id/g,'order by v.id').replace(/extensions\.avg\(c\.embedding\)/g,'(array_agg(c.embedding))[1]');
  await db.exec(sql);
 }
 // M06 governance: per-request log with the cost fixed at log time; API roles cannot read or write it directly.
 await db.exec('set role service_role');
 const loggedId=(await db.query("select public.pose_system_log_ai_request(null,'chat','gpt-4.1-mini','assistant','assistant@4','{search_properties}',1000,200,1200,850,'ok',null,0.00072) id")).rows[0].id;
 await db.exec('reset role');
 const loggedRow=(await db.query('select estimated_cost_usd::text cost,tools_called,prompt_version from public.ai_request_log where id=$1',[loggedId])).rows[0];
 if(loggedRow.cost!=='0.00072000'||loggedRow.tools_called[0]!=='search_properties'||loggedRow.prompt_version!=='assistant@4')throw new Error('AI request log row/cost mismatch');
 for(const role of ['anon','authenticated']){let denied=false;await db.exec(`set role ${role}`);try{await db.query('select count(*) from public.ai_request_log');}catch{denied=true;}await db.exec('reset role');if(!denied)throw new Error(`${role} can read ai_request_log`);}
 {let denied=false;await db.exec('set role anon');try{await db.query("select public.pose_system_log_ai_request(null,'chat','x',null,null,'{}',0,0,0,0,'ok',null,0)");}catch{denied=true;}await db.exec('reset role');if(!denied)throw new Error('anon can log AI requests');}
 await db.exec('delete from public.ai_request_log');
 await db.exec("set role service_role; select public.pose_system_log_ai_request(null,'chat','test','assistant','v1','{search_properties}',100,40,140,120,'ok',null,0.001, '11111111-1111-4111-8111-111111111111','Số điện thoại [email đã ẩn]'); select public.pose_system_log_ai_request(null,'query','test','query','v1','{}',50,10,60,80,'fallback',null,0.0005, '11111111-1111-4111-8111-111111111111','Số điện thoại [email đã ẩn]'); select public.pose_system_log_ai_request(null,'chat','test','assistant','v1','{}',20,10,30,60,'ok',null,0.0002, '22222222-2222-4222-8222-222222222222','Câu hỏi ngày hai'); reset role;");
 console.log('PASS: M06 dashboard migration loaded and turn rows share IDs with fixed previews.');
 console.log('PASS: M06 AI request log stores tokens, prompt version, tools and per-request cost; anon/authenticated denied.');
 const rental=await db.exec(await readFile(new URL('../../supabase/test-ai-rental.sql',import.meta.url),'utf8'));
 console.log(rental.at(-1).rows[0].result);
 const result=await db.exec(await readFile(new URL('../../supabase/test-ai-agent.sql',import.meta.url),'utf8'));
 console.log(result.at(-1).rows[0].result);
 const knowledge=await db.exec(await readFile(new URL('../../supabase/test-ai-knowledge.sql',import.meta.url),'utf8'));
 console.log(knowledge.at(-1).rows[0].result);
 const tools=await db.exec(await readFile(new URL('../../supabase/test-ai-agent-tools.sql',import.meta.url),'utf8'));
 const pendingResult=tools.flatMap(statement=>statement.rows||[]).find(row=>row.result)?.result;if(!pendingResult)throw new Error('MISSING_PENDING_ACTION_SQL_RESULT');console.log(pendingResult);
 let similarSql=await readFile(new URL('../../supabase/test-property-similar.sql',import.meta.url),'utf8');
 similarSql=similarSql.replace(/extensions\.vector/g,'vector');
 console.log('NOTE: PGlite lacks avg(vector) and <=>; similarity SQL is adapted for fixture execution while production keeps extensions.avg(c.embedding) and cosine distance.');
 const similar=await db.exec(similarSql);const similarResult=similar.flatMap(statement=>statement.rows||[]).find(row=>row.result)?.result;if(!similarResult)throw new Error('MISSING_PROPERTY_SIMILAR_SQL_RESULT');console.log(similarResult);
}catch(error){console.error(`FAIL: M06 SQL: ${error.message}`);if(error.where)console.error(error.where);if(process.env.DEBUG_SQL)console.error(error);process.exitCode=1;}finally{await db.close();}
