import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createE2eApp } from './setup-e2e';

describe('Error contract (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the standard error body with a matching requestId', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/v1/does-not-exist',
    );

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      statusCode: 404,
      error: expect.any(String),
      message: expect.anything(),
      requestId: expect.any(String),
      path: expect.any(String),
      timestamp: expect.any(String),
    });
    expect(response.body.requestId).toBe(response.headers['x-request-id']);
  });

  it('never leaks a stack trace in the error body', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/v1/does-not-exist',
    );

    expect(JSON.stringify(response.body)).not.toContain('at Object.');
    expect(response.body).not.toHaveProperty('stack');
  });

  it('keeps the health route version-neutral', async () => {
    const neutral = await request(app.getHttpServer()).get('/api/health');
    expect(neutral.status).toBe(neutral.body.status === 'ok' ? 200 : 503);

    const versioned = await request(app.getHttpServer()).get('/api/v1/health');
    expect(versioned.status).toBe(404);
  });
});
