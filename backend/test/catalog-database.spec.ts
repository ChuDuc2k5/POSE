import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const sql = (name: string) => readFileSync(new URL(`../../supabase/${name}`, import.meta.url), 'utf8');
const admin = 'fc000000-0000-4000-8000-000000000001',
  other = 'fc000000-0000-4000-8000-000000000002';
const session = 'fc000000-0000-4000-8000-000000000003',
  otherSession = 'fc000000-0000-4000-8000-000000000004';
let db: PGlite, projectId: string, legacyId: string;
const product = {
  code: 'DB-P',
  name: 'Căn hộ kiểm thử',
  location: 'Hồ Chí Minh',
  description: 'Mô tả căn hộ dùng kiểm thử công bố.',
  property_type: 'Apartment',
  area: 80,
  bedrooms: 2,
  price: null,
  publication: 'Published',
  availability: 'Available',
};
async function actor(id = admin, sid = session) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: id, session_id: sid, role: 'authenticated' }),
  ]);
  await db.exec('set role authenticated');
}
async function save(kind: string, data: object, id: string | null = null, version = 0) {
  const result = await db.query<{ item: Record<string, unknown> }>(
    'select public.pose_save_catalog($1,$2,$3,$4::jsonb,$5) as item',
    [kind, id, version, JSON.stringify(data), 'Kiểm thử dữ liệu'],
  );
  return result.rows[0].item;
}
async function lifecycle(id: string, version: number, action: string, reason = 'Kiểm thử vòng đời') {
  const result = await db.query<{ item: Record<string, unknown> }>(
    'select public.pose_catalog_lifecycle($1,$2,$3,$4) as item',
    [id, version, action, reason],
  );
  return result.rows[0].item;
}
async function makeProduct(code = 'DB-P') {
  return save('properties', { ...product, code, project_id: projectId });
}

beforeAll(async () => {
  db = new PGlite();
  // Supabase platform schemas only. All application authorization, validation,
  // triggers, policies and lifecycle functions below come from repository SQL.
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key,aud text,role text,email text,email_confirmed_at timestamptz,
      raw_app_meta_data jsonb default '{}',raw_user_meta_data jsonb default '{}',banned_until timestamptz,
      is_anonymous boolean default false,phone text,phone_confirmed_at timestamptz,created_at timestamptz,updated_at timestamptz);
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),created_at timestamptz,updated_at timestamptz,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    grant usage on schema auth,storage to anon,authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text,name text);
    alter table storage.objects enable row level security;
    grant select on storage.objects to anon;
    grant select,insert,delete on storage.objects to authenticated;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
  `);
  await db.exec(sql('auth-access.sql'));
  await db.exec(sql('account-profile.sql'));
  await db.exec(sql('property-management.sql'));
  await db.exec(
    sql('property-discovery.sql').split('create table pose_private.property_search_snapshots')[0] + 'commit;',
  );
  await db.exec(sql('property-listing-source.sql'));
  await db.query(
    `insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data) values($1,'admin@example.test',now(),' {"role":"Admin"}'),($2,'other@example.test',now(),'{"role":"Admin"}')`,
    [admin, other],
  );
  await db.query('insert into auth.sessions(id,user_id,created_at) values($1,$2,now()),($3,$4,now())', [
    session,
    admin,
    otherSession,
    other,
  ]);
  await actor();
  projectId = String((await save('projects', { code: 'DB-PRJ', name: 'Dự án kiểm thử', location: 'Hồ Chí Minh' })).id);
  legacyId = String((await makeProduct('LEGACY-P')).id);
  await db.exec('reset role');
  await db.exec(sql('migrations/20261025060128_catalog_ownership_trash.sql'));
}, 30000);
afterAll(async () => {
  await db?.close();
});
beforeEach(async () => {
  await db.exec('begin');
  await actor();
});
afterEach(async () => {
  await db.exec('rollback; reset role;');
});

describe('M02 actual PostgreSQL schema and RLS in an isolated database', () => {
  it('passes the existing full M02 database acceptance script', async () => {
    await db.exec('rollback; reset role;');
    await db.exec(sql('test-property-management.sql'));
  });
  it('backfills proven legacy ownership without exposing creator metadata in the public view', async () => {
    const result = await db.query<{ created_by: string }>(
      'select created_by from public.property_products where id=$1',
      [legacyId],
    );
    expect(result.rows[0].created_by).toBe(admin);
    const columns = await db.query<{ column_name: string }>(
      "select column_name from information_schema.columns where table_name='property_public_catalog'",
    );
    expect(columns.rows.some((row) => ['created_by', 'deleted_at', 'deleted_by'].includes(row.column_name))).toBe(
      false,
    );
    expect(columns.rows.some((row) => row.column_name === 'transaction_type')).toBe(true);
  });
  it('records the creator on the server and preserves it when another Admin edits', async () => {
    const p = await makeProduct();
    expect(p.created_by).toBe(admin);
    await actor(other, otherSession);
    const edited = await save('properties', { name: 'Đổi tên sản phẩm' }, String(p.id), Number(p.version));
    expect(edited.created_by).toBe(admin);
    const mine = await db.query('select id from public.property_products where created_by=auth.uid()');
    expect(mine.rows).toHaveLength(0);
  });
  it('does not invent a creator for an imported legacy record without creation evidence', async () => {
    await db.exec('reset role');
    await db.query("select set_config('request.jwt.claims','{}',false)");
    await db.query(
      `insert into public.property_products(project_id,code,name,location,property_type,area) values($1,'IMPORT-P','Nhà nhập dữ liệu','Hồ Chí Minh','House',50)`,
      [projectId],
    );
    const result = await db.query<{ created_by: null }>(
      "select created_by from public.property_products where code='IMPORT-P'",
    );
    expect(result.rows[0].created_by).toBeNull();
  });
  it('soft deletes, preserves references/history, hides even privileged search data, and restores as Draft', async () => {
    const p = await makeProduct();
    const deleted = await lifecycle(String(p.id), 0, 'delete');
    expect(deleted.deleted_by).toBe(admin);
    expect(deleted.deleted_at).toBeTruthy();
    expect(deleted.version).toBe(1);
    expect((await db.query('select id from public.property_products where id=$1', [p.id])).rows).toHaveLength(1);
    await db.exec('reset role');
    expect((await db.query('select id from public.property_public_catalog where id=$1', [p.id])).rows).toHaveLength(0);
    await db.exec('set role anon');
    expect((await db.query('select id from public.property_products where id=$1', [p.id])).rows).toHaveLength(0);
    await actor();
    const restored = await lifecycle(String(p.id), 1, 'restore');
    expect(restored.publication).toBe('Draft');
    expect(restored.availability).toBe('Available');
    expect(restored.created_by).toBe(admin);
    expect(restored.deleted_at).toBeNull();
    expect(restored.version).toBe(2);
    const events = await db.query<{ action: string }>(
      "select action from public.property_history where entity_id=$1 and action in ('properties_deleted','properties_restored')",
      [p.id],
    );
    expect(events.rows).toHaveLength(2);
  });
  it('rejects a stale delete without adding a second audit event', async () => {
    const p = await makeProduct();
    await lifecycle(String(p.id), 0, 'delete');
    await expect(lifecycle(String(p.id), 0, 'delete')).rejects.toMatchObject({ code: '40001' });
  });
  it('retains media objects while revoking public and Admin media access for trashed products', async () => {
    const p = await makeProduct();
    const path = `${String(p.id)}/fc000000-0000-4000-8000-000000000005.webp`;
    await db.query("insert into storage.objects(bucket_id,name) values('property-files',$1)", [path]);
    const media = await save(
      'media',
      {
        property_id: p.id,
        object_key: path,
        name: 'Ảnh công khai',
        media_type: 'Image',
        mime_type: 'image/webp',
        size_bytes: 100,
        checksum: 'a'.repeat(64),
        visibility: 'Public',
        visible: true,
        sort_order: 0,
      },
      null,
      0,
    );
    await lifecycle(String(p.id), 1, 'delete');
    expect((await db.query('select id from public.property_media where id=$1', [media.id])).rows).toHaveLength(0);
    await db.exec('set role anon');
    expect((await db.query('select id from public.property_media where id=$1', [media.id])).rows).toHaveLength(0);
    await db.exec('reset role');
    expect((await db.query('select id from public.property_media where id=$1', [media.id])).rows).toHaveLength(1);
    expect((await db.query('select id from storage.objects where name=$1', [path])).rows).toHaveLength(1);
    await actor();
    await expect(save('media', { name: 'Thử sửa ảnh' }, String(media.id), 0)).rejects.toThrow('PRODUCT_TRASHED');
  });
  it('never physically deletes a referenced product or changes its creator on restore by another Admin', async () => {
    const p = await makeProduct();
    await db.exec('reset role');
    await db.exec(
      'create table public.fixture_product_reference(product_id uuid references public.property_products(id))',
    );
    await db.query('insert into public.fixture_product_reference values($1)', [p.id]);
    await actor();
    await lifecycle(String(p.id), 0, 'delete');
    await actor(other, otherSession);
    const restored = await lifecycle(String(p.id), 1, 'restore');
    expect(restored.created_by).toBe(admin);
    expect(restored.publication).toBe('Draft');
    await db.exec('reset role');
    expect(
      (await db.query('select product_id from public.fixture_product_reference where product_id=$1', [p.id])).rows,
    ).toHaveLength(1);
  });
  it('rejects updates through the existing save RPC while a product is trashed', async () => {
    const p = await makeProduct();
    await lifecycle(String(p.id), 0, 'delete');
    await expect(save('properties', { name: 'Ghi đè' }, String(p.id), 1)).rejects.toThrow('PRODUCT_TRASHED');
  });
  it('rejects insufficient lifecycle reasons at the database boundary', async () => {
    const p = await makeProduct();
    await expect(lifecycle(String(p.id), 0, 'delete', ' ')).rejects.toThrow('REASON_REQUIRED');
  });
  it('refuses forged creator fields through the public save RPC', async () => {
    await expect(save('properties', { ...product, project_id: projectId, created_by: other })).rejects.toThrow(
      'INVALID_FIELD',
    );
  });
  it('denies lifecycle actions after a current role downgrade', async () => {
    const p = await makeProduct();
    await db.exec('reset role');
    await db.query('update auth.users set raw_app_meta_data=\' {"role":"Sales"}\' where id=$1', [admin]);
    await actor();
    await expect(lifecycle(String(p.id), 0, 'delete')).rejects.toMatchObject({ code: '42501' });
  });
});
