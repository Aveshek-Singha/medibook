import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createE2eApp } from './setup-e2e';

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('reports dependency status', async () => {
    const response = await request(app.getHttpServer()).get('/api/health');

    expect(response.status).toBe(response.body.status === 'ok' ? 200 : 503);
    expect(response.body).toMatchObject({
      status: expect.stringMatching(/ok|degraded/),
      checks: {
        database: expect.stringMatching(/up|down/),
        redis: expect.stringMatching(/up|down/),
        smsQueue: expect.stringMatching(/up|down/),
      },
    });
    expect(typeof response.body.uptime).toBe('number');
    expect(response.body.timestamp).toBeDefined();
  });

  it('sets the X-Request-Id header on every response', async () => {
    const response = await request(app.getHttpServer()).get('/api/health');

    expect(response.headers['x-request-id']).toBeDefined();
  });

  it('exposes a dependency-independent liveness route', async () => {
    const response = await request(app.getHttpServer()).get('/api/health/live');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok' });
    expect(response.body.checks).toBeUndefined();
  });

  it('uses the readiness route as an alias for the dependency check', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/health/ready',
    );

    expect(response.status).toBe(response.body.status === 'ok' ? 200 : 503);
    expect(response.body.checks).toHaveProperty('smsQueue');
  });
});
