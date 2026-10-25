import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHmac } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/bootstrap.js';
import { callConcurrency } from '../src/modules/calling/calling.scheduler.js';

describe('calling guards, validation and byte-exact webhook', () => {
 let app: INestApplication, role = 'Admin', writes = 0;
 const id = 'f7800000-0000-4000-8000-000000000001';
 beforeEach(async () => {
  role = 'Admin'; writes = 0;
  for (const [key,value] of Object.entries({ SUPABASE_URL:'https://provider.example', SUPABASE_PUBLISHABLE_KEY:'public', SUPABASE_SECRET_KEY:'secret', TELEPHONY_PROVIDER:'simulator', TELEPHONY_API_URL:'https://simulator.example', TELEPHONY_API_KEY:'key', TELEPHONY_CALLER_ID:'simulator', TELEPHONY_WEBHOOK_SECRET:'byte-exact-secret' })) vi.stubEnv(key,value);
  vi.stubGlobal('fetch', vi.fn(async (url:string) => {
   if (url.endsWith('/user')) return Response.json({ id, email_confirmed_at:'2026-10-01' });
   if (url.endsWith('/pose_access_context')) return Response.json({ user_id:id, role, active:true, session_valid:true });
   if (url.endsWith('/pose_system_apply_call_event')) { writes++; return Response.json({ ignored:true, call_id:id }); }
   return Response.json([]);
  }));
  const module = await Test.createTestingModule({ imports:[AppModule] }).compile();
  app = module.createNestApplication({ bodyParser:false }); configureApp(app); await app.init();
 });
 afterEach(async () => { await app.close(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
 const admin = (path:string) => request(app.getHttpServer()).get(path).set('Authorization','Bearer admin-token');
 it('denies Guest/User and limits worker/test/playground to Admin', async () => {
  await request(app.getHttpServer()).get('/api/calls').expect(401);
  role='User'; await admin('/api/calls').expect(403);
  role='Sales'; await admin('/api/calls').expect(200); await admin('/api/admin/calls/worker').expect(403);
  await request(app.getHttpServer()).post('/api/admin/calls/test').set('Authorization','Bearer sales').set('Origin','http://localhost:3000').send({}).expect(403);
  role='Admin'; const status = await admin('/api/admin/calls/worker').expect(200);
  expect(status.body).toEqual({ redis:false, dispatcherEvery:10000, reconcileEvery:60000, lastRunAt:null, lastResult:null, lastError:null });
  expect(status.headers['cache-control']).toBe('no-store');
 });
 it('validates mutation origins, ids, filters and JSON without database writes', async () => {
  await request(app.getHttpServer()).post('/api/contacts/opt-out').set('Authorization','Bearer admin').set('Origin','https://other.example').send({}).expect(403);
  await admin('/api/calls?campaign_id=invalid').expect(400);
  await admin('/api/calls/invalid').expect(404);
  await request(app.getHttpServer()).post('/api/calls/'+id+'/stop').set('Authorization','Bearer admin').set('Origin','http://localhost:3000').send({reason:1}).expect(400);
  await request(app.getHttpServer()).post('/api/admin/calls/playground').set('Authorization','Bearer admin').set('Origin','http://localhost:3000').set('Content-Type','application/json').send('{').expect(400);
  expect(writes).toBe(0);
 });
 it('verifies the exact incoming bytes including whitespace and Vietnamese text', async () => {
  const raw = '{\n "event_id" : "byte-proof", "provider_call_id":"'+id+'", "type":"completed", "occurred_at":"2026-10-14T12:00:00Z", "note":"Tiếng Việt — đồng ý"\n}';
  const stamp=String(Math.floor(Date.now()/1000));
  const signature=createHmac('sha256','byte-exact-secret').update(stamp+'.').update(Buffer.from(raw)).digest('hex');
  const post=(body:string, sig=signature, timestamp=stamp)=>request(app.getHttpServer()).post('/api/webhooks/telephony').set('Content-Type','application/json').set('x-terava-timestamp',timestamp).set('x-terava-signature',sig).send(body);
  await post(raw).expect(200); expect(writes).toBe(1);
  await post(JSON.stringify(JSON.parse(raw))).expect(401);
  await post(raw,'0'.repeat(64)).expect(401);
  const stale=String(Number(stamp)-301), staleSig=createHmac('sha256','byte-exact-secret').update(stale+'.'+raw).digest('hex');
  await post(raw,staleSig,stale).expect(401); expect(writes).toBe(1);
  const bytes=Buffer.concat([Buffer.from(raw.slice(0,-2)+', "byte":"'),Buffer.from([255]),Buffer.from('"}')]);
  const byteSignature=createHmac('sha256','byte-exact-secret').update(stamp+'.').update(bytes).digest('hex');
  await request(app.getHttpServer()).post('/api/webhooks/telephony').set('Content-Type','application/octet-stream').set('x-terava-timestamp',stamp).set('x-terava-signature',byteSignature).send(bytes).expect(200);
  expect(writes).toBe(2);
  const decodedSignature=createHmac('sha256','byte-exact-secret').update(stamp+'.'+bytes.toString('utf8')).digest('hex');
  await request(app.getHttpServer()).post('/api/webhooks/telephony').set('Content-Type','application/octet-stream').set('x-terava-timestamp',stamp).set('x-terava-signature',decodedSignature).send(bytes).expect(401);
  expect(writes).toBe(2);
 });
 it('clamps configured concurrency to the global two-call limit', () => {
  for(const [value,expected] of [['',2],['9',2],['1',1],['1.9',1],['-1',1],['invalid',2]] as const){vi.stubEnv('TELEPHONY_MAX_CONCURRENCY',value);expect(callConcurrency()).toBe(expected);}
 });
});
