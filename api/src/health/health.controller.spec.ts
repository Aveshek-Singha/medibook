import type { Response } from 'express';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const createController = (overrides?: {
    databaseUp?: boolean;
    redisUp?: boolean;
    queueUp?: boolean;
  }) => {
    const databaseUp = overrides?.databaseUp ?? true;
    const redisUp = overrides?.redisUp ?? true;
    const queueUp = overrides?.queueUp ?? true;
    const dataSource = {
      query: jest.fn(() =>
        databaseUp ? Promise.resolve([{ 1: 1 }]) : Promise.reject(new Error()),
      ),
    };
    const redis = {
      status: 'ready',
      ping: jest.fn(() =>
        redisUp ? Promise.resolve('PONG') : Promise.reject(new Error()),
      ),
    };
    const queue = { isReady: jest.fn().mockResolvedValue(queueUp) };
    const controller = new HealthController(
      dataSource as never,
      redis as never,
      queue as never,
    );
    const response = { status: jest.fn() } as unknown as Response;

    return { controller, dataSource, redis, queue, response };
  };

  it('returns ready only when all dependencies are available', async () => {
    const { controller, response } = createController();

    await expect(controller.check(response)).resolves.toMatchObject({
      status: 'ok',
      checks: { database: 'up', redis: 'up', smsQueue: 'up' },
    });
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it('returns HTTP 503 when any critical dependency is unavailable', async () => {
    const { controller, response } = createController({
      databaseUp: false,
      redisUp: false,
      queueUp: false,
    });

    await expect(controller.check(response)).resolves.toMatchObject({
      status: 'degraded',
      checks: { database: 'down', redis: 'down', smsQueue: 'down' },
    });
    expect(response.status).toHaveBeenCalledWith(503);
  });

  it('keeps liveness independent from database, Redis and worker health', () => {
    const { controller, dataSource, redis, queue } = createController({
      databaseUp: false,
      redisUp: false,
      queueUp: false,
    });

    expect(controller.live()).toMatchObject({ status: 'ok' });
    expect(dataSource.query).not.toHaveBeenCalled();
    expect(redis.ping).not.toHaveBeenCalled();
    expect(queue.isReady).not.toHaveBeenCalled();
  });
});
