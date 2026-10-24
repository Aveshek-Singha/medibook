import { Global, Inject, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

/**
 * A single shared ioredis connection.
 *
 * `lazyConnect: true` keeps the app bootable when Redis is down; the health
 * endpoint reports `degraded` instead of the process crashing.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (configService: ConfigService): Redis =>
        new Redis({
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: configService.get<number>('REDIS_PORT', 6379),
          username:
            configService.get<string>('REDIS_USERNAME', '') || undefined,
          password:
            configService.get<string>('REDIS_PASSWORD', '') || undefined,
          db: configService.get<number>('REDIS_DB', 0),
          ...(configService.get<boolean>('REDIS_TLS', false)
            ? {
                tls: {
                  rejectUnauthorized: true,
                  ...(configService.get<string>('REDIS_TLS_CA', '')
                    ? { ca: configService.get<string>('REDIS_TLS_CA') }
                    : {}),
                },
              }
            : {}),
          lazyConnect: true,
          maxRetriesPerRequest: 2,
          enableOfflineQueue: false,
          connectTimeout: configService.get<number>(
            'REDIS_CONNECTION_TIMEOUT_MS',
            10000,
          ),
          retryStrategy: (attempt: number) => Math.min(attempt * 100, 1000),
        }),
    },
  ],
  exports: [REDIS_CLIENT],
})
export class RedisModule implements OnModuleDestroy {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  /**
   * Without this, the Redis socket keeps the Node event loop alive and Jest
   * never exits after the e2e suite closes the app.
   */
  async onModuleDestroy(): Promise<void> {
    try {
      if (this.redis.status === 'wait') {
        // Lazy client that never connected — nothing to close gracefully.
        this.redis.disconnect();
        return;
      }
      if (this.redis.status !== 'end') {
        await this.redis.quit();
      }
    } catch {
      this.redis.disconnect();
    }
  }
}
