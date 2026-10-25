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
 for(const file of ['auth-access.sql','account-profile.sql','property-management.sql','property-discovery.sql','property-listing-source.sql','lead-contact-foundation.sql','calling-contract.sql','ai-agent.sql','ai-chat-history.sql','ai-appointment-booking.sql','ai-agent-tools.sql','ai-knowledge.sql','ai-rag-real-change-1.sql','property-similar.sql','ai-request-log.sql','ai-request-log-cost.sql','ai-request-log-session.sql','ai-request-log-turns.sql']){
  let sql=await readFile(new URL(`../../supabase/${file}`,import.meta.url),'utf8');
  if(file==='ai-request-log.sql')await db.exec("create or replace function pose_private.directory_admin() returns boolean language sql stable as $$ select coalesce((pose_private.pose_access_context()->>'role')='Admin',false) $$;");
  // The external PGlite pgvector build currently provides the vector type but
  // cannot create the cosine HNSW operator class; production PostgreSQL runs
  // the unmodified SQL. Keep the functional RPC/query assertions below.
  if(file==='ai-knowledge.sql'||file==='ai-rag-real-change-1.sql')sql=sql.replace(/create extension if not exists (vector|unaccent) with schema extensions;/g,'create extension if not exists $1;').replace(/extensions\.unaccent/g,'public.unaccent').replace(/extensions\.vector/g,'vector').replace(/extensions\.vector_cosine_ops/g,'vector_cosine_ops').replace(/operator\(extensions\.<=>\)/g,'<=>').replace(/e\.embedding\s*<=>\s*p_embedding/g,'0').replace(/e\.embedding\s*<->\s*p_embedding/g,'0').replace(/order by 0/g,'order by e.id').replace(/create index kb_chunks_embedding_hnsw[^;]+;/i,'-- HNSW index verified in production PostgreSQL');
  if(file==='property-similar.sql')sql=sql.replace(/extensions\.vector/g,'vector').replace(/v\.vector operator\(extensions\.<=>\) s\.vector/g,'0').replace(/order by v\.vector operator\(extensions\.<=>\) s\.vector, v\.id/g,'order by v.id').replace(/order by 0, v\.id/g,'order by v.id').replace(/extensions\.avg\(c\.embedding\)/g,'(array_agg(c.embedding))[1]');
 await db.exec(sql);
 }
 const bookingFns=(await db.query("select count(*)::int n from pg_proc where proname in ('ai_appointment_options','ai_create_appointment','ai_delete_session')")).rows[0].n;
 if(bookingFns!==3)throw new Error('AI appointment booking SQL delta was not loaded');
 // Behaviour fixtures for the M06 booking RPCs. The ownership table is an
 // application fixture here because this suite loads the additive SQL deltas
 // into a deliberately small database.
 await db.exec(`
 create table public.property_sales_owners(property_id uuid not null references public.property_products(id),sales_id uuid not null references public.users(id),primary key(property_id,sales_id));
 insert into auth.users(id,aud,role,email,email_confirmed_at,raw_app_meta_data,phone,phone_confirmed_at) values
 ('a0000000-0000-4000-8000-000000000001','authenticated','authenticated','verified@example.test',now(),'{"role":"User","account_status":"active"}','+84901234567',now()),
 ('a0000000-0000-4000-8000-000000000002','authenticated','authenticated','unverified@example.test',now(),'{"role":"User","account_status":"active"}',null,null),
 ('a0000000-0000-4000-8000-000000000003','authenticated','authenticated','sales-one@example.test',now(),'{"role":"User","account_status":"active"}',null,null),
 ('a0000000-0000-4000-8000-000000000004','authenticated','authenticated','sales-two@example.test',now(),'{"role":"User","account_status":"active"}',null,null);
 insert into auth.sessions(id,user_id,created_at,updated_at) values
 ('a1000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001',now(),now()),
 ('a1000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000002',now(),now());
 insert into public.users(id,full_name,email,auth_user_id,role,account_status) values
 ('b0000000-0000-4000-8000-000000000001','Sales Owner','sales-one@example.test','a0000000-0000-4000-8000-000000000003','Sales','active'),
 ('b0000000-0000-4000-8000-000000000002','Sales Ward','sales-two@example.test','a0000000-0000-4000-8000-000000000004','Sales','active');
 insert into public.account_profiles(user_id,display_name,contact_phone) values
 ('a0000000-0000-4000-8000-000000000001','Verified Customer','+84901234567'),
 ('a0000000-0000-4000-8000-000000000002','Unverified Customer','');
 insert into public.property_projects(id,code,name,location,description) values
 ('c0000000-0000-4000-8000-000000000001','M06-P','M06 Project','Phường Long Bình, Thành phố Hồ Chí Minh','M06 booking fixture project');
 insert into public.property_products(id,project_id,code,name,location,description,property_type,area,bedrooms,price,publication,availability)
 values('c1000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000001','M06-A1','M06 Booking Home','Phường Long Bình, Thành phố Hồ Chí Minh','M06 published booking fixture listing','Apartment',80,2,3000000000,'Published','Available');
 insert into public.property_products(id,project_id,code,name,location,description,property_type,area,bedrooms,price,publication,availability)
 values('c1000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000001','M06-A2','M06 Ranking Home','Phường Long Bình, Thành phố Hồ Chí Minh','M06 published ranking fixture listing','Apartment',80,2,3000000000,'Published','Available');
 insert into public.properties(id) values('c1000000-0000-4000-8000-000000000001');
 insert into public.properties(id) values('c1000000-0000-4000-8000-000000000002');
 insert into public.property_sales_owners values('c1000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001');
 `);
 const propertyId='c1000000-0000-4000-8000-000000000001',rankingPropertyId='c1000000-0000-4000-8000-000000000002',ownerSales='b0000000-0000-4000-8000-000000000001',wardSales='b0000000-0000-4000-8000-000000000002',verifiedUser='a0000000-0000-4000-8000-000000000001',verifiedSession='a1000000-0000-4000-8000-000000000001';
 const future='2026-10-26 10:00:00+07',later='2026-10-27 10:00:00+07';
 const options=async(start=null,property=propertyId)=>{await db.exec(`set role authenticated; set request.jwt.claims='{"sub":"${verifiedUser}","role":"authenticated","session_id":"${verifiedSession}"}'`);const result=(await db.query('select public.pose_ai_appointment_options($1,$2) data',[property,start])).rows[0].data;await db.exec('reset role');return result;};
 const initialOptions=await options();if(initialOptions.sales[0].id!==ownerSales||initialOptions.sales[0].reason!=='Phụ trách căn này')throw new Error('booking options owner ranking/reason mismatch');
 await db.query("insert into public.appointments(sales_id,property_id,appointment_time,ends_at,location,status,source,idempotency_key) values($1,$2,$3,$4,'Phường Long Bình, Thành phố Hồ Chí Minh','COMPLETED','AI','m06-area-history')",[wardSales,propertyId,'2026-10-20 10:00:00+07','2026-10-20 11:00:00+07']);
 const areaOptions=await options(null,rankingPropertyId);if(areaOptions.sales.findIndex(x=>x.id===wardSales)!==0)throw new Error('booking options same-ward history ranking mismatch');
 await db.query("insert into public.appointments(sales_id,property_id,appointment_time,ends_at,location,status,source,idempotency_key) values($1,$2,$3,$4,'Phường Long Bình, Thành phố Hồ Chí Minh','SCHEDULED','AI','m06-busy')",[wardSales,propertyId,'2026-10-26 10:00:00+07','2026-10-26 11:00:00+07']);
 const filtered=await options(future,rankingPropertyId);if(filtered.sales.some(x=>x.id===wardSales))throw new Error('booking options did not exclude overlapping sales');
 await db.query("delete from public.appointments where idempotency_key='m06-busy'");
 const create=async(user,start=future,sales=ownerSales,key='m06-booking-key')=>{const session=user===verifiedUser?verifiedSession:'a1000000-0000-4000-8000-000000000002';await db.exec(`set role authenticated; set request.jwt.claims='{"sub":"${user}","role":"authenticated","session_id":"${session}"}'`);try{return {ok:true,data:(await db.query('select public.pose_ai_create_appointment($1,$2,null,$3,null,null,$4) data',[propertyId,start,sales,key])).rows[0].data};}catch(error){return {ok:false,error};}finally{await db.exec('reset role');}};
 const firstBooking=await create(verifiedUser);if(!firstBooking.ok||!firstBooking.data.appointment_id)throw new Error('booking create did not return an id');
 const countAfterFirst=(await db.query("select count(*)::int n from public.appointments where idempotency_key='m06-booking-key'")).rows[0].n;
 const replay=await create(verifiedUser,future,ownerSales,'m06-booking-key');const countAfterReplay=(await db.query("select count(*)::int n from public.appointments where idempotency_key='m06-booking-key'")).rows[0].n;
 if(replay.data.appointment_id!==firstBooking.data.appointment_id||countAfterFirst!==1||countAfterReplay!==1)throw new Error('booking idempotency mismatch');
 const expectError=async(result,code)=>{if(result.ok||!String(result.error?.message||result.error).includes(code))throw new Error(`expected ${code}`);};
 await expectError(await create(verifiedUser,'2026-10-25 10:00:00+07',ownerSales,'m06-past-key'),'TIME_WINDOW_INVALID');
 await expectError(await create(verifiedUser,'2026-10-26 21:00:00+07',ownerSales,'m06-late-key'),'TIME_WINDOW_INVALID');
 await db.query("insert into public.appointments(sales_id,property_id,appointment_time,ends_at,location,status,source,idempotency_key) values($1,$2,$3,$4,'Phường Long Bình, Thành phố Hồ Chí Minh','SCHEDULED','AI','m06-overlap')",[ownerSales,propertyId,'2026-10-27 10:00:00+07','2026-10-27 11:00:00+07']);
 await expectError(await create(verifiedUser,later,ownerSales,'m06-overlap-key'),'APPOINTMENT_OVERLAP');
 await expectError(await create(verifiedUser,future,'a0000000-0000-4000-8000-000000000003','m06-not-sales-key'),'SALES_NOT_AVAILABLE');
 await expectError(await create('a0000000-0000-4000-8000-000000000002',later,ownerSales,'m06-unverified-key'),'PHONE_VERIFICATION_REQUIRED');
 if((await db.query('select count(*)::int n from public.customers where auth_user_id=$1',[verifiedUser])).rows[0].n!==1||(await db.query('select count(*)::int n from public.leads l join public.customers c on c.id=l.customer_id where c.auth_user_id=$1',[verifiedUser])).rows[0].n!==1)throw new Error('verified booking did not create customer and lead');
 const deleteUser='a0000000-0000-4000-8000-000000000002',deleteSession='d0000000-0000-4000-8000-000000000001';await db.query("insert into public.ai_chat_sessions(id,user_id,store_transcript,status) values($1,$2,true,'Active')",[deleteSession,verifiedUser]);await db.query("insert into public.ai_chat_messages(session_id,role,content) values($1,'user','delete me')",[deleteSession]);await db.query("insert into public.ai_action_log(session_id,tool,args_hash,decision,reason,rule_version) values($1,'save_favorite',repeat('a',64),'allowed','fixture','m06')",[deleteSession]);await db.query("insert into public.ai_pending_actions(session_id,user_id,tool,args,summary_vi,idempotency_key) values($1,$2,'save_favorite','{}','Delete fixture','m06-delete-key')",[deleteSession,verifiedUser]);
 await db.exec(`set role authenticated; set request.jwt.claims='{"sub":"${deleteUser}","role":"authenticated","session_id":"a1000000-0000-4000-8000-000000000002"}'`);let wrongDelete=false;try{await db.query('select public.pose_ai_delete_session($1)',[deleteSession]);}catch(error){wrongDelete=String(error.message).includes('SESSION_NOT_FOUND');}await db.exec('reset role');if(!wrongDelete)throw new Error('wrong user session delete was not rejected');
 await db.exec(`set role authenticated; set request.jwt.claims='{"sub":"${verifiedUser}","role":"authenticated","session_id":"${verifiedSession}"}'`);await db.query('select public.pose_ai_delete_session($1)',[deleteSession]);await db.exec('reset role');if((await db.query('select count(*)::int n from public.ai_chat_sessions where id=$1',[deleteSession])).rows[0].n!==0||(await db.query('select count(*)::int n from public.ai_chat_messages where session_id=$1',[deleteSession])).rows[0].n!==0||(await db.query('select count(*)::int n from public.ai_pending_actions where session_id=$1',[deleteSession])).rows[0].n!==0)throw new Error('session delete did not cascade messages and pending actions');
 console.log('PASS: M06 AI appointment booking assertions: owner and ward ranking, overlap filtering, idempotent create, time/sales/phone guards, customer+lead creation, and owner-scoped session deletion.');
 // M06 governance: per-request log with the cost fixed at log time; API roles cannot read or write it directly.
 await db.exec('set role service_role');
 const loggedId=(await db.query("select public.pose_system_log_ai_request(null,'chat','gpt-4.1-mini','assistant','assistant@4','{search_properties}',1000,200,1200,850,'ok',null,0.00072) id")).rows[0].id;
 await db.exec('reset role');
 const loggedRow=(await db.query('select estimated_cost_usd::text cost,tools_called,prompt_version from public.ai_request_log where id=$1',[loggedId])).rows[0];
 if(loggedRow.cost!=='0.00072000'||loggedRow.tools_called[0]!=='search_properties'||loggedRow.prompt_version!=='assistant@4')throw new Error('AI request log row/cost mismatch');
 for(const role of ['anon','authenticated']){let denied=false;await db.exec(`set role ${role}`);try{await db.query('select count(*) from public.ai_request_log');}catch{denied=true;}await db.exec('reset role');if(!denied)throw new Error(`${role} can read ai_request_log`);}
 {let denied=false;await db.exec('set role anon');try{await db.query("select public.pose_system_log_ai_request(null,'chat','x',null,null,'{}',0,0,0,0,'ok',null,0)");}catch{denied=true;}await db.exec('reset role');if(!denied)throw new Error('anon can log AI requests');}
 await db.exec('delete from public.ai_request_log');
 // M06 AI Platform Dashboard: exact aggregates over fixed rows (Asia/Ho_Chi_Minh days, Monday weeks).
 await db.exec("create or replace function pose_private.directory_admin() returns boolean language sql stable as $$ select coalesce(current_setting('test.ai_admin',true),'')='1' $$");
 await db.exec('set role service_role');
 await db.query("select public.pose_system_log_ai_request(null,'chat','gpt-4.1-mini','assistant','assistant@5','{}',1,1,2,1,'ok',null,0,'11111111-1111-4111-8111-111111111111','Hỏi thử')");
 await db.exec('reset role');
 if((await db.query("select turn_id::text t from public.ai_request_log")).rows[0].t!=='11111111-1111-4111-8111-111111111111')throw new Error('service_role cannot log turn ids');
 await db.exec('delete from public.ai_request_log');
 const turnIdA='aaaaaaaa-0000-4000-8000-000000000001',turnIdB='bbbbbbbb-0000-4000-8000-000000000002',turnIdC='cccccccc-0000-4000-8000-000000000003',turnIdD='dddddddd-0000-4000-8000-000000000004';
 // A: Wed 2026-10-21 06:30 VN (still Tue 20th in UTC); B: Tue 2026-10-20 23:30 VN; C: Sun 2026-10-18 19:00 VN (previous ISO week; Mon 2026-10-19 starts the next); D: now.
 await db.query(`insert into public.ai_request_log(turn_id,question_preview,kind,model,prompt_version,tools_called,prompt_tokens,completion_tokens,total_tokens,latency_ms,status,estimated_cost_usd,created_at) values
  ($1,'Tìm căn hộ Quận 7','query','gpt-4.1-mini','query@3','{}',40,10,50,80,'ok',0.0005,'2026-10-20 23:30:00+00'),
  ($1,'Tìm căn hộ Quận 7','rerank','gpt-4.1-mini','rerank.user@3','{}',50,10,60,40,'ok',0.0002,'2026-10-20 23:30:01+00'),
  ($1,'Tìm căn hộ Quận 7','chat','gpt-4.1-mini','assistant@5','{search_properties,save_favorite}',100,40,140,120,'ok',0.001,'2026-10-20 23:30:03+00'),
  ($2,'Cảm ơn','chat','gpt-4.1-mini','assistant@5','{}',20,10,30,60,'fallback',0.0002,'2026-10-20 16:30:00+00'),
  ($3,'Xin chào','embed','text-embedding-3-small',null,'{}',10,0,10,5,'ok',0,'2026-10-18 12:00:00+00'),
  ($4,'Hôm nay','chat','gpt-4.1-mini','assistant@5','{}',15,5,20,50,'ok',0.00002,now())`,[turnIdA,turnIdB,turnIdC,turnIdD]);
 await db.exec("set test.ai_admin='1'");await db.exec('set role authenticated');
 const turns=(await db.query("select turn_id::text id,calls::int,total_tokens::int tok,cost_usd::text cost,tools,worst_status,turn_latency_ms::int lat,total_count::int total from public.pose_system_admin_ai_turns('2026-10-01','2026-11-01')")).rows;
 const turnA=turns.find(t=>t.id===turnIdA),turnB=turns.find(t=>t.id===turnIdB);
 if(turns.length!==4||turns[0].total!==4||turnA.calls!==3||turnA.tok!==250||Number(turnA.cost)!==0.0017||turnA.tools.join(',')!=='save_favorite,search_properties'||turnA.lat!==3080||turnB.worst_status!=='fallback')throw new Error('admin_ai_turns mismatch: '+JSON.stringify(turns));
 const searched=(await db.query("select turn_id::text id from public.pose_system_admin_ai_turns('2026-10-01','2026-11-01','quận 7')")).rows;
 if(searched.length!==1||searched[0].id!==turnIdA)throw new Error('admin_ai_turns search mismatch');
 const day=(await db.query("select to_char(bucket_start at time zone 'Asia/Ho_Chi_Minh','YYYY-MM-DD') d,questions::int q,calls::int c,total_tokens::int tok from public.pose_system_admin_ai_series('day','2026-10-17','2026-10-23')")).rows;
 if(JSON.stringify(day)!==JSON.stringify([{d:'2026-10-18',q:1,c:1,tok:10},{d:'2026-10-20',q:1,c:1,tok:30},{d:'2026-10-21',q:1,c:3,tok:250}]))throw new Error('day series (VN time) mismatch: '+JSON.stringify(day));
 const week=(await db.query("select to_char(bucket_start at time zone 'Asia/Ho_Chi_Minh','YYYY-MM-DD') d,questions::int q,total_tokens::int tok from public.pose_system_admin_ai_series('week','2026-10-01','2026-10-23')")).rows;
 if(JSON.stringify(week)!==JSON.stringify([{d:'2026-10-12',q:1,tok:10},{d:'2026-10-19',q:2,tok:280}]))throw new Error('week series (Monday) mismatch: '+JSON.stringify(week));
 const kinds=(await db.query("select kind,calls::int c,total_tokens::int tok from public.pose_system_admin_ai_by_kind('2026-10-01','2026-10-23') where kind='chat'")).rows;
 if(kinds[0]?.c!==2||kinds[0]?.tok!==170)throw new Error('by_kind mismatch: '+JSON.stringify(kinds));
 const turnCalls=(await db.query('select kind from public.pose_system_admin_ai_turn_calls($1)',[turnIdA])).rows.map(r=>r.kind).join(',');
 if(turnCalls!=='query,rerank,chat')throw new Error('turn_calls order mismatch: '+turnCalls);
 const overview=(await db.query('select period,questions::int q,calls::int c,total_tokens::int tok from public.pose_system_admin_ai_overview()')).rows;
 if(overview.map(r=>r.period).join(',')!=='today,week,month'||overview[0].q!==1||overview[0].c!==1||overview[0].tok!==20)throw new Error('overview mismatch: '+JSON.stringify(overview));
 await db.exec('reset role');await db.exec("set test.ai_admin='0'");await db.exec('set role authenticated');
 const hidden=(await db.query("select count(*)::int n from public.pose_system_admin_ai_turns('2026-10-01','2026-11-01')")).rows[0].n+(await db.query('select count(*)::int n from public.pose_system_admin_ai_overview()')).rows[0].n;
 await db.exec('reset role');if(hidden!==0)throw new Error('non-admin can read AI dashboard rows');
 {let denied=false;await db.exec('set role anon');try{await db.query('select * from public.pose_system_admin_ai_overview()');}catch{denied=true;}await db.exec('reset role');if(!denied)throw new Error('anon can call AI dashboard RPC');}
 await db.exec('delete from public.ai_request_log');
 console.log('PASS: M06 AI dashboard SQL: turns (3 calls, 250 tokens, tools, latency, search), VN-day and Monday-week series, by kind, turn calls, overview today; non-admin 0 rows, anon denied.');
 console.log('PASS: M06 AI request log stores tokens, prompt version, tools and per-request cost; anon/authenticated denied.');
 const rental=await db.exec(await readFile(new URL('../../supabase/test-ai-rental.sql',import.meta.url),'utf8'));
 console.log(rental.at(-1).rows[0].result);
 const result=await db.exec(await readFile(new URL('../../supabase/test-ai-agent.sql',import.meta.url),'utf8'));
 console.log(result.at(-1).rows[0].result);
 const history=await db.exec(await readFile(new URL('../../supabase/test-ai-chat-history.sql',import.meta.url),'utf8'));
 console.log(history.at(-1).rows[0].result);
 const knowledge=await db.exec(await readFile(new URL('../../supabase/test-ai-knowledge.sql',import.meta.url),'utf8'));
 console.log(knowledge.at(-1).rows[0].result);
 const tools=await db.exec(await readFile(new URL('../../supabase/test-ai-agent-tools.sql',import.meta.url),'utf8'));
 const pendingResult=tools.flatMap(statement=>statement.rows||[]).find(row=>row.result)?.result;if(!pendingResult)throw new Error('MISSING_PENDING_ACTION_SQL_RESULT');console.log(pendingResult);
 let similarSql=await readFile(new URL('../../supabase/test-property-similar.sql',import.meta.url),'utf8');
 similarSql=similarSql.replace(/extensions\.vector/g,'vector');
 console.log('NOTE: PGlite lacks avg(vector) and <=>; similarity SQL is adapted for fixture execution while production keeps extensions.avg(c.embedding) and cosine distance.');
 const similar=await db.exec(similarSql);const similarResult=similar.flatMap(statement=>statement.rows||[]).find(row=>row.result)?.result;if(!similarResult)throw new Error('MISSING_PROPERTY_SIMILAR_SQL_RESULT');console.log(similarResult);
}catch(error){console.error(`FAIL: M06 SQL: ${error.message}`);if(error.where)console.error(error.where);if(process.env.DEBUG_SQL)console.error(error);process.exitCode=1;}finally{await db.close();}
