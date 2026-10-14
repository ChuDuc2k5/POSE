import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const modulePath=process.env.PGLITE_PATH || 'C:/Users/Admin/AppData/Local/Temp/pose-m06-pg/node_modules/@electric-sql/pglite';
const {PGlite}=await import(pathToFileURL(`${modulePath}/dist/index.js`).href);
const db=new PGlite();
const sql=name=>readFile(new URL(`../../supabase/${name}.sql`,import.meta.url),'utf8');
try{
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key); create schema storage;
    create table storage.buckets(id text,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(bucket_id text,name text); create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/'); $$;
    create schema pose_private; create function pose_private.pose_access_context() returns jsonb language sql as $$ select '{"role":"User","active":true,"session_valid":true}'::jsonb; $$;
    create function pose_private.require_account() returns uuid language sql as $$ select null::uuid; $$;`);
  await db.exec(await sql('property-management'));
  const discovery=await sql('property-discovery');
  await db.exec(discovery.slice(0,discovery.indexOf('create function pose_private.require_customer'))+'commit;');
  await db.exec(await sql('property-listing-source'));
  await db.exec(await sql('property-search-transaction'));
  await db.exec(await sql('property-search-filter-bar'));
  const result=await db.exec(await sql('test-property-search-transaction'));
  assert.ok(result.at(-1).rows[0].result.startsWith('PASS:'));
  console.log(result.at(-1).rows[0].result);
}finally{await db.close();}
