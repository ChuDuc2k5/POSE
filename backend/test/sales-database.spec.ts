import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const sql = (name: string) => readFileSync(new URL(`../../supabase/${name}`, import.meta.url), 'utf8');
const admin = 'fa110000-0000-4000-8000-000000000001',
  sales = 'fa110000-0000-4000-8000-000000000002',
  customer = 'fa110000-0000-4000-8000-000000000003';
let db: PGlite;
async function actor(id = admin, session = id) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,false)", [
    JSON.stringify({ sub: id, session_id: session, role: 'authenticated', app_metadata: { role: 'Admin' } }),
  ]);
  await db.exec('set role authenticated');
}
async function call(name: string, args: unknown[] = []) {
  return (
    await db.query<{ data: Record<string, unknown> }>(
      `select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) data`,
      args,
    )
  ).rows[0].data;
}
async function createPending(overrides: Record<string, unknown> = {}) {
  const id = randomUUID();
  await db.exec('reset role');
  const metadata = {
    role: 'Sales',
    account_status: 'suspended',
    m11_pending: true,
    m11_created_by: admin,
    m11_request_key: id,
    m11_fingerprint: 'a'.repeat(64),
    m11_profile: { name: 'Sales mới', phone: '+84912345678' },
    ...overrides,
  };
  await db.query(
    'insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values($1,$2,now(),$3,\'{"display_name":"Sales mới"}\',now(),now())',
    [id, `${id}@example.test`, metadata],
  );
  await actor();
  return id;
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;
 create table auth.users(id uuid primary key,aud text,role text,email text,email_confirmed_at timestamptz,raw_app_meta_data jsonb default '{}',raw_user_meta_data jsonb default '{}',banned_until timestamptz,is_anonymous boolean default false,phone text,phone_confirmed_at timestamptz,last_sign_in_at timestamptz,created_at timestamptz,updated_at timestamptz);
 create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id),created_at timestamptz,updated_at timestamptz,not_after timestamptz);
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
 grant usage on schema auth,storage to anon,authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid default gen_random_uuid() primary key,bucket_id text,name text);alter table storage.objects enable row level security;
 create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
 create type public.user_status as enum('ACTIVE','INACTIVE','BLOCKED');
 create table public.users(id uuid primary key,full_name varchar(255),email varchar(255) unique,phone varchar(30) unique,avatar_url text,status public.user_status,created_at timestamptz,updated_at timestamptz);
 create table public.user_roles(id uuid);create table public.auth_users(id uuid);`);
  for (const name of ['auth-access.sql', 'account-profile.sql', 'user-directory.sql']) await db.exec(sql(name));
  for (const [id, email, role, name] of [
    [admin, 'admin@example.test', 'Admin', 'Admin thử nghiệm'],
    [sales, 'sales@example.test', 'Sales', 'Nguyễn Sales'],
    [customer, 'user@example.test', 'User', 'Khách hàng'],
  ]) {
    await db.query(
      "insert into auth.users(id,email,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at) values($1,$2,now(),$3,$4,now()-interval '1 day',now())",
      [id, email, { role, account_status: 'active', keep: 'unchanged' }, { display_name: name, role: 'Admin' }],
    );
    await db.query('insert into public.account_profiles(user_id,display_name) values($1,$2)', [id, name]);
  }
  await db.exec(
    "insert into auth.sessions(id,user_id,created_at) select id,id,now()-interval '1 hour' from auth.users",
  );
  await db.exec(
    'create function public.pose_sales_detail(p_lead uuid) returns jsonb language sql as $$select \'{"module":"existing-sales-leads"}\'::jsonb$$',
  );
  await db.exec(sql('migrations/20261025113735_m11_sales_management.sql'));
}, 30000);
beforeEach(async () => {
  await db.exec('begin');
  await actor();
});
afterEach(async () => {
  await db.exec('rollback;reset role');
});
afterAll(async () => {
  await db?.close();
});
describe('M11 actual PostgreSQL staff management', () => {
  it('preserves the existing Sales lead detail function', async () => {
    expect((await call('pose_sales_detail', [sales])).module).toBe('existing-sales-leads');
  });
  it('lists only Sales and searches literal names/email with pagination and status filters', async () => {
    const list = await call('pose_admin_sales_list', ['sales@example', 'all', 1, 20]);
    expect(list.total).toBe(1);
    expect(JSON.stringify(list)).not.toContain('admin@example');
    expect((await call('pose_admin_sales_list', ['%', 'all', 1, 20])).total).toBe(0);
    expect((await call('pose_admin_sales_list', ['', 'suspended', 1, 20])).total).toBe(0);
    expect((await call('pose_admin_sales_list', ['', 'all', 2, 20])).items).toEqual([]);
  });
  it.each([customer, sales])('denies every management operation to non-Admin %s', async (id) => {
    await actor(id);
    for (const [name, args] of [
      ['pose_admin_sales_list', []],
      ['pose_admin_sales_detail', [sales]],
      ['pose_admin_sales_history', [sales, 1]],
      ['pose_admin_sales_update', [sales, { name: 'Other', phone: '' }, 0, 0, 'Thay đổi']],
      ['pose_admin_sales_status', [sales, 'suspended', 0, 'Tạm khóa']],
      ['pose_admin_sales_finish_create', [sales, sales]],
    ] as [string, unknown[]][]) {
      await db.exec('savepoint denied');
      await expect(call(name, args)).rejects.toMatchObject({ code: '42501' });
      await db.exec('rollback to savepoint denied');
    }
  });
  it('denies stale Admin claims after current trusted role changes', async () => {
    await db.exec('reset role');
    await db.query('update auth.users set raw_app_meta_data=raw_app_meta_data||\'{"role":"User"}\' where id=$1', [
      admin,
    ]);
    await actor();
    await expect(call('pose_admin_sales_list')).rejects.toMatchObject({ code: '42501' });
  });
  it.each(['anon', 'authenticated'])('does not expose private history or state to direct %s access', async (role) => {
    for (const table of ['m11_sales_history', 'm11_sales_state', 'm11_sales_directory']) {
      await db.exec(`savepoint denied;set role ${role}`);
      await expect(db.query(`select * from pose_private.${table}`)).rejects.toMatchObject({ code: '42501' });
      await db.exec('rollback to savepoint denied');
    }
  });
  it('denies anonymous RPC access', async () => {
    await db.exec('set role anon');
    await expect(call('pose_admin_sales_list')).rejects.toMatchObject({ code: '42501' });
  });
  it.each([admin, customer])('never edits or suspends non-Sales identity %s', async (id) => {
    await expect(call('pose_admin_sales_status', [id, 'suspended', 0, 'Tạm khóa'])).rejects.toMatchObject({
      code: 'P0002',
    });
  });
  it('updates profile atomically and keeps the existing user-directory synchronization', async () => {
    const row = await call('pose_admin_sales_update', [
      sales,
      { name: 'Sales đổi tên', phone: '+84987654321' },
      0,
      0,
      'Cập nhật hồ sơ',
    ]);
    expect(row.name).toBe('Sales đổi tên');
    expect(row.version).toBe(1);
    expect(row.profile_version).toBe(1);
    await db.exec('reset role');
    expect(
      (await db.query<{ full_name: string }>('select full_name from public.users where auth_user_id=$1', [sales]))
        .rows[0].full_name,
    ).toBe('Sales đổi tên');
    await actor();
    const history = await call('pose_admin_sales_history', [sales, 1]);
    expect(history.total).toBe(1);
    expect(JSON.stringify(history)).toContain('Admin thử nghiệm');
    expect(JSON.stringify(history)).toContain('Cập nhật hồ sơ');
  });
  it('rejects stale management versions without an extra audit row', async () => {
    await call('pose_admin_sales_update', [sales, { name: 'Sales mới', phone: '' }, 0, 0, 'Cập nhật hồ sơ']);
    await db.exec('savepoint stale');
    await expect(call('pose_admin_sales_status', [sales, 'suspended', 0, 'Tạm khóa'])).rejects.toMatchObject({
      code: '40001',
    });
    await db.exec('rollback to savepoint stale');
    expect((await call('pose_admin_sales_history', [sales, 1])).total).toBe(1);
  });
  it('detects a concurrent Sales self-profile edit using the profile version', async () => {
    await actor(sales);
    await call('pose_update_profile', [{ name: 'Sales tự cập nhật' }, 0]);
    await actor();
    await expect(
      call('pose_admin_sales_update', [sales, { name: 'Ghi đè cũ', phone: '' }, 0, 0, 'Cập nhật hồ sơ']),
    ).rejects.toMatchObject({ code: '40001' });
  });
  it('suspends immediately and retains old session revocation after reactivation', async () => {
    const suspended = await call('pose_admin_sales_status', [sales, 'suspended', 0, 'Tạm khóa nhân viên']);
    expect(suspended.status).toBe('suspended');
    await actor(sales);
    const blocked = await call('pose_access_context');
    expect(blocked.active).toBe(false);
    expect(blocked.session_valid).toBe(false);
    await actor();
    const active = await call('pose_admin_sales_status', [sales, 'active', 1, 'Mở lại nhân viên']);
    expect(active.status).toBe('active');
    await actor(sales);
    const oldSession = await call('pose_access_context');
    expect(oldSession.active).toBe(true);
    expect(oldSession.session_valid).toBe(false);
    const newSession = randomUUID();
    await db.exec('reset role');
    await db.query('insert into auth.sessions(id,user_id,created_at) values($1,$2,clock_timestamp())', [
      newSession,
      sales,
    ]);
    await actor(sales, newSession);
    expect((await call('pose_access_context')).session_valid).toBe(true);
    await db.exec('reset role');
    expect(
      (
        await db.query<{ raw_app_meta_data: { keep: string } }>(
          'select raw_app_meta_data from auth.users where id=$1',
          [sales],
        )
      ).rows[0].raw_app_meta_data.keep,
    ).toBe('unchanged');
  });
  it('requires a reason even for direct authenticated RPC calls', async () => {
    await expect(call('pose_admin_sales_status', [sales, 'suspended', 0, ''])).rejects.toMatchObject({ code: '22023' });
  });
  it('rejects forbidden role fields at the database boundary', async () => {
    await expect(
      call('pose_admin_sales_update', [sales, { name: 'Sales mới', phone: '', role: 'Admin' }, 0, 0, 'Đổi dữ liệu']),
    ).rejects.toMatchObject({ code: '22023' });
  });
  it('creates inactive staff and writes profile plus actor audit in the Auth transaction', async () => {
    const id = await createPending();
    const row = await call('pose_admin_sales_detail', [id]);
    expect(row.status).toBe('suspended');
    expect(row.requires_activation).toBe(true);
    expect(row.name).toBe('Sales mới');
    expect(row.phone).toBe('+84912345678');
    const history = await call('pose_admin_sales_history', [id, 1]);
    expect(history.total).toBe(1);
    expect(JSON.stringify(history)).toContain('Created');
    expect(JSON.stringify(history)).not.toContain('m11_fingerprint');
  });
  it('rejects provisioning an already active identity or a forged creator', async () => {
    await db.exec('savepoint bad');
    await expect(createPending({ account_status: 'active' })).rejects.toMatchObject({ code: '22023' });
    await db.exec('rollback to savepoint bad');
    await expect(createPending({ m11_created_by: customer })).rejects.toMatchObject({ code: '42501' });
  });
  it('finishes create once and never reactivates an account on a later retry', async () => {
    const id = await createPending();
    const first = await call('pose_admin_sales_finish_create', [id, id]);
    expect(first.replayed).toBe(false);
    expect((first.item as Record<string, unknown>).status).toBe('active');
    expect((await call('pose_admin_sales_finish_create', [id, id])).replayed).toBe(true);
    await call('pose_admin_sales_status', [id, 'suspended', 2, 'Tạm khóa sau tạo']);
    const retry = await call('pose_admin_sales_finish_create', [id, id]);
    expect(retry.replayed).toBe(true);
    expect((retry.item as Record<string, unknown>).status).toBe('suspended');
    expect((await call('pose_admin_sales_history', [id, 1])).total).toBe(3);
  });
  it('allows another Admin to activate an interrupted creation through normal status management', async () => {
    const id = await createPending();
    expect((await call('pose_admin_sales_status', [id, 'active', 1, 'Hoàn tất kích hoạt'])).requires_activation).toBe(
      false,
    );
  });
  it('paginates history and avoids no-op change events', async () => {
    expect(
      (await call('pose_admin_sales_update', [sales, { name: 'Nguyễn Sales', phone: '' }, 0, 0, 'Giữ nguyên hồ sơ']))
        .version,
    ).toBe(0);
    for (let i = 0; i < 21; i++)
      await call('pose_admin_sales_update', [sales, { name: `Sales lần ${i}`, phone: '' }, i, i, 'Cập nhật tên']);
    const first = await call('pose_admin_sales_history', [sales, 1]),
      second = await call('pose_admin_sales_history', [sales, 2]);
    expect(first.total).toBe(21);
    expect(first.items).toHaveLength(20);
    expect(second.items).toHaveLength(1);
  });
});
