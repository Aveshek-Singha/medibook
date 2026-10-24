import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import Redis from 'ioredis';
import { RedisThrottlerStorage } from './redis-throttler-storage';

describe('RedisThrottlerStorage', () => {
  const createStorage = (
    environment: string,
    redis: { status?: string; eval?: jest.Mock; connect?: jest.Mock },
  ): RedisThrottlerStorage => {
    const config = { get: () => environment } as unknown as ConfigService;
    return new RedisThrottlerStorage(redis as unknown as Redis, config);
  };

  it('uses the shared Redis counter when available', async () => {
    const redis = {
      status: 'ready',
      eval: jest.fn().mockResolvedValue([2, 12, 0, 0]),
    };
    const storage = createStorage('development', redis);

    await expect(
      storage.increment('login', 60000, 5, 60000, 'login'),
    ).resolves.toEqual({
      totalHits: 2,
      timeToExpire: 12,
      isBlocked: false,
      timeToBlockExpire: 0,
    });
    expect(redis.eval).toHaveBeenCalledWith(
      expect.any(String),
      2,
      'medibook:throttle:login:login',
      'medibook:throttle:login:login:blocked',
      60000,
      5,
      60000,
    );
  });

  it('uses a local fallback while Redis is unavailable outside production', async () => {
    const storage = createStorage('test', {
      status: 'ready',
      eval: jest.fn().mockRejectedValue(new Error('redis unavailable')),
    });

    await expect(
      storage.increment('login', 60000, 5, 60000, 'login'),
    ).resolves.toMatchObject({
      totalHits: 1,
      isBlocked: false,
    });
  });

  it('fails closed in production when the shared rate-limit store fails', async () => {
    const storage = createStorage('production', {
      status: 'ready',
      eval: jest.fn().mockRejectedValue(new Error('redis unavailable')),
    });

    await expect(
      storage.increment('login', 60000, 5, 60000, 'login'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
