import { Controller, Get, Inject, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Response } from 'express';
import { DataSource } from 'typeorm';
import { REDIS_CLIENT } from '../redis/redis.module';
import Redis from 'ioredis';
import { NotificationQueueService } from '../notifications/notification-queue.service';

export type HealthStatus = 'ok' | 'degraded';

export interface HealthResponse {
  status: HealthStatus;
  uptime: number;
  timestamp: string;
  checks: {
    database: 'up' | 'down';
    redis: 'up' | 'down';
    smsQueue: 'up' | 'down';
  };
}

@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly notificationQueue: NotificationQueueService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Readiness and dependency health check' })
  async check(
    @Res({ passthrough: true }) response: Response,
  ): Promise<HealthResponse> {
    return this.readiness(response);
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness and dependency health check' })
  async ready(
    @Res({ passthrough: true }) response: Response,
  ): Promise<HealthResponse> {
    return this.readiness(response);
  }

  private async readiness(response: Response): Promise<HealthResponse> {
    const [database, redis, smsQueue] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkSmsQueue(),
    ]);

    const health: HealthResponse = {
      status:
        database === 'up' && redis === 'up' && smsQueue === 'up'
          ? 'ok'
          : 'degraded',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
      checks: { database, redis, smsQueue },
    };

    response.status(health.status === 'ok' ? 200 : 503);
    return health;
  }

  @Get('live')
  @ApiOperation({ summary: 'Process liveness check' })
  live(): Pick<HealthResponse, 'status' | 'uptime' | 'timestamp'> {
    return {
      status: 'ok',
      uptime: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDatabase(): Promise<'up' | 'down'> {
    try {
      await this.withTimeout(this.dataSource.query('SELECT 1'));
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkRedis(): Promise<'up' | 'down'> {
    try {
      if (this.redis.status === 'end') return 'down';
      if (this.redis.status === 'wait') {
        await this.withTimeout(this.redis.connect());
      }
      await this.withTimeout(this.redis.ping());
      return 'up';
    } catch {
      return 'down';
    }
  }

  private async checkSmsQueue(): Promise<'up' | 'down'> {
    try {
      return (await this.withTimeout(this.notificationQueue.isReady()))
        ? 'up'
        : 'down';
    } catch {
      return 'down';
    }
  }

  private withTimeout<T>(operation: Promise<T>, timeoutMs = 1500): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    return Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('Health check timed out')),
          timeoutMs,
        );
      }),
    ]).finally(() => {
      if (timeout) clearTimeout(timeout);
    });
  }
}
