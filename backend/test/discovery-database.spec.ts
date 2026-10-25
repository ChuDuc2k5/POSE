import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const sql=(name:string)=>readFileSync(new URL(`../../supabase/${name}`,import.meta.url),'utf8');
const user='fe000000-0000-4000-8000-000000000001',other='fe000000-0000-4000-8000-000000000002',admin='fe000000-0000-4000-8000-000000000003';
const project='fe100000-0000-4000-8000-000000000001',property='fe200000-0000-4000-8000-000000000001';
const payload={property_id:property,name:'Minh Anh',phone:'+84912345678',country:'VN',channel:'Email',preferred_time:'Buổi chiều',message:'Tôi muốn được tư vấn căn hộ.',consent:{contact:true,call:false,ai:false,transcript:false,recording:false}};
const hash='a'.repeat(64),otherHash='b'.repeat(64);
let db:PGlite;
async function actor(id=user){await db.exec('reset role');await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id,session_id:id,role:'authenticated'})]);await db.exec('set role authenticated');}
async function call(name:string,args:unknown[]){const result=await db.query<{data:Record<string,unknown>}>(`select public.${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) data`,args);return result.rows[0].data;}
async function guest(data:object={...payload,email:'guest@example.test'},key=randomUUID(),sessionHash=hash){await db.exec('reset role;set role service_role');return call('pose_submit_browser_inquiry',[data,key,sessionHash]);}
beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
    create table auth.users(id uuid primary key,aud text,role text,email text,email_confirmed_at timestamptz,raw_app_meta_data jsonb default '{}',raw_user_meta_data jsonb default '{}',banned_until timestamptz,is_anonymous boolean default false,phone text,phone_confirmed_at timestamptz,created_at timestamptz,updated_at timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),created_at timestamptz,updated_at timestamptz,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    grant usage on schema auth,storage to anon,authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text,name text);alter table storage.objects enable row level security;grant select on storage.objects to anon;grant select,insert,delete on storage.objects to authenticated;
    create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
    create table public.customers(id uuid primary key default gen_random_uuid(),full_name text,phone text unique,email text,source text);
    create table public.leads(id uuid primary key default gen_random_uuid(),customer_id uuid references public.customers(id),status text default 'NEW',lead_score integer,temperature text,notes text);`);
  for(const name of ['auth-access.sql','account-profile.sql','property-management.sql','property-discovery.sql','property-listing-source.sql','property-search-transaction.sql','property-search-filter-bar.sql','migrations/20261025060128_catalog_ownership_trash.sql'])await db.exec(sql(name));
  await db.exec(sql('test-property-discovery.sql'));
  await db.query(`insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values($1,'one@example.test',now(),'{"role":"User"}'),($2,'two@example.test',now(),'{"role":"User"}'),($3,'admin@example.test',now(),'{"role":"Admin"}')`,[user,other,admin]);
  await db.exec('insert into auth.sessions(id,user_id,created_at) select id,id,now() from auth.users');
  await db.query("insert into public.property_projects(id,code,name,location) values($1,'DB-M03','Dự án kiểm thử','Hồ Chí Minh')",[project]);
  await db.query("insert into public.property_products(id,project_id,code,name,location,description,property_type,area,price,publication,availability) values($1,$2,'M03-P','Căn hộ kiểm thử','Hồ Chí Minh','Mô tả căn hộ dùng kiểm thử tiếp nhận.','Apartment',80,null,'Published','Available')",[property,project]);
  // Match the already deployed verified-email Guest ownership constraints.
  await db.exec(`create table pose_private.guest_inquiry_sessions(id uuid primary key default gen_random_uuid());
    alter table public.property_inquiries add column guest_session_id uuid references pose_private.guest_inquiry_sessions(id),add column source text not null default 'CustomerWeb',add column email_verified_at timestamptz;
    alter table public.property_inquiries alter column user_id drop not null;
    alter table public.property_inquiries add constraint legacy_guest_owner check((user_id is null)<>(guest_session_id is null)),add constraint legacy_guest_source check((source='GuestWeb')=(guest_session_id is not null));`);
  await db.exec(sql('migrations/20261025064448_m03_inquiry_intake.sql'));
},30000);
beforeEach(async()=>{await db.exec('begin');await actor();});
afterEach(async()=>{await db.exec('rollback;reset role;');});
afterAll(async()=>{await db?.close();});
describe('M03 actual PostgreSQL intake and privacy',()=>{
  it('accepts an unverified User immediately without inventing verification or linking a Lead',async()=>{
    const result=await call('pose_submit_inquiry',[payload,randomUUID()]);expect(result.status).toBe('Received');expect(result.phone_verified).toBe(false);
    await db.exec('reset role');expect((await db.query('select id from public.leads')).rows).toHaveLength(0);
    expect((await db.query('select inquiry_id from public.property_inquiry_notifications')).rows).toHaveLength(1);
  });
  it('keeps per-user idempotency, consent and ownership',async()=>{
    const key=randomUUID(),first=await call('pose_submit_inquiry',[payload,key]),second=await call('pose_submit_inquiry',[payload,key]);expect(second.id).toBe(first.id);expect(second.replayed).toBe(true);
    await actor(other);const rows=await call('pose_read_inquiries',[1,12]);expect(rows.total).toBe(0);
    await db.exec('reset role');const result=await db.query<{consent:typeof payload.consent}>('select consent from public.property_inquiries');expect(result.rows[0].consent.call).toBe(false);
  });
  it('accepts a Guest and isolates receipts by a hashed browser capability',async()=>{
    const result=await guest();expect(result.status).toBe('Received');expect(result.phone_verified).toBe(false);
    const mine=await call('pose_read_browser_inquiries',[hash,1,12]),someoneElse=await call('pose_read_browser_inquiries',[otherHash,1,12]);expect(mine.total).toBe(1);expect(someoneElse.total).toBe(0);
    expect(JSON.stringify(mine)).not.toContain('browser_session_hash');expect(JSON.stringify(mine)).not.toContain('request_payload');
  });
  it('replays Guest submissions exactly once and creates one notification',async()=>{
    const key=randomUUID(),first=await guest(undefined,key),second=await guest(undefined,key);expect(second.id).toBe(first.id);expect(second.replayed).toBe(true);
    await db.exec('reset role');expect((await db.query('select inquiry_id from public.property_inquiry_notifications')).rows).toHaveLength(1);
  });
  it('rejects a changed Guest payload with a reused key',async()=>{
    const key=randomUUID();await guest(undefined,key);await expect(guest({...payload,email:'guest@example.test',message:'Nội dung khác'},key)).rejects.toMatchObject({code:'40001'});
  });
  it.each(['anon','authenticated'])('blocks direct %s calls to the server-only guest gateway',async role=>{
    await db.exec(`set role ${role}`);await expect(call('pose_submit_browser_inquiry',[{...payload,email:'guest@example.test'},randomUUID(),hash])).rejects.toMatchObject({code:'42501'});
  });
  it('requires explicit consent even when phone OTP is skipped',async()=>{
    await expect(guest({...payload,email:'guest@example.test',consent:{...payload.consent,contact:false}})).rejects.toThrow('INVALID_CONSENT');
  });
  it('blocks inquiries for soft-deleted products through the privileged Guest function',async()=>{
    await actor(admin);await call('pose_catalog_lifecycle',[property,0,'delete','Ngừng công bố']);
    await expect(guest()).rejects.toMatchObject({code:'P0002'});
  });
  it('does not expose notifications or the Admin inbox to customers',async()=>{
    await guest();await actor();expect((await db.query('select * from public.property_inquiry_notifications')).rows).toHaveLength(0);
    await expect(call('pose_admin_inquiries',[1,false])).rejects.toMatchObject({code:'42501'});
  });
  it('persists Admin notifications and marks read idempotently',async()=>{
    const receipt=await guest();await actor(admin);expect((await call('pose_admin_inquiries',[1,true])).unread).toBe(1);
    await call('pose_read_admin_inquiry',[receipt.id]);await call('pose_read_admin_inquiry',[receipt.id]);
    const inbox=await call('pose_admin_inquiries',[1,false]);expect(inbox.total).toBe(1);expect(inbox.unread).toBe(0);
  });
  it('expires Guest tracking sessions without leaking old contact details',async()=>{
    await guest();await db.exec('reset role');await db.query("update pose_private.m03_browser_sessions set expires_at=now()-interval '1 minute' where token_hash=$1",[hash]);await db.exec('set role service_role');
    expect((await call('pose_read_browser_inquiries',[hash,1,12])).total).toBe(0);
  });
  it('limits new Guest requests at the database boundary',async()=>{
    for(let i=0;i<10;i++)await guest();
    await expect(guest()).rejects.toMatchObject({code:'53300'});
  });
  it('requires an Email-channel address even when bypassing HTTP validation',async()=>{
    await expect(guest({...payload,email:''})).rejects.toThrow('INVALID_INPUT');
  });
});
