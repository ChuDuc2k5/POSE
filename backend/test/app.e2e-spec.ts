import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Server } from 'node:http';
import { configureApp } from '../src/bootstrap.js';
import { AppModule } from './../src/app.module.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<Server>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    configureApp(app);
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer()).get('/api').expect(200).expect('Hello World!');
  });

  it('protects auth endpoints and applies role metadata through HTTP', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://provider.example');
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'fixture-public');
    let role = 'User';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify(
              url.endsWith('/user')
                ? { id: 'fixture-id', email: 'fixture@example.test', email_confirmed_at: '2026-10-05' }
                : { user_id: 'fixture-id', role, active: true, session_valid: true },
            ),
            { status: 200 },
          ),
      ),
    );
    try {
      await request(app.getHttpServer()).get('/api/auth/principal').expect(401);
      await request(app.getHttpServer())
        .get('/api/auth/principal')
        .set('Authorization', 'Bearer fixture-token')
        .expect(200);
      await request(app.getHttpServer())
        .get('/api/auth/admin')
        .set('Authorization', 'Bearer fixture-token')
        .expect(403);
      role = 'Sales';
      await request(app.getHttpServer())
        .get('/api/auth/sales')
        .set('Authorization', 'Bearer fixture-token')
        .expect(200);
      await request(app.getHttpServer())
        .get('/api/auth/admin')
        .set('Authorization', 'Bearer fixture-token')
        .expect(403);
      role = 'Admin';
      await request(app.getHttpServer())
        .get('/api/auth/admin')
        .set('Authorization', 'Bearer fixture-token')
        .expect(200);
    } finally {
      vi.unstubAllGlobals();
      vi.unstubAllEnvs();
    }
  });

  afterEach(async () => {
    await app.close();
  });
});
