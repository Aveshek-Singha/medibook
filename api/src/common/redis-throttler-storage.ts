import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.module';

interface ThrottlerStorageRecord {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
}

const INCREMENT_SCRIPT = `
  local ttl = redis.call('PTTL', KEYS[1])
  if ttl < 0 then ttl = tonumber(ARGV[1]) end

  local blockTtl = redis.call('PTTL', KEYS[2])
  if blockTtl > 0 then
    local total = tonumber(redis.call('GET', KEYS[1]) or '0')
    return { total, math.ceil(ttl / 1000), 1, math.ceil(blockTtl / 1000) }
  end

  local previousTotal = tonumber(redis.call('GET', KEYS[1]) or '0')
  if previousTotal > tonumber(ARGV[2]) and tonumber(ARGV[3]) <= 0 then
    return {
      previousTotal + 1,
      math.max(0, math.ceil(ttl / 1000)),
      1,
      math.max(0, math.ceil(ttl / 1000))
    }
  end

  local total = redis.call('INCR', KEYS[1])
  if total == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end

  local blocked = 0
  local blockTime = 0
  if total > tonumber(ARGV[2]) then
    blocked = 1
    if tonumber(ARGV[3]) > 0 then
      redis.call('PSETEX', KEYS[2], ARGV[3], '1')
      blockTime = math.ceil(tonumber(ARGV[3]) / 1000)
    else
      blockTime = math.max(0, math.ceil(ttl / 1000))
    end
  end

  ttl = redis.call('PTTL', KEYS[1])
  return { total, math.max(0, math.ceil(ttl / 1000)), blocked, blockTime }
`;

@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly memory = new ThrottlerStorageService();

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly config: ConfigService,
  ) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ): Promise<ThrottlerStorageRecord> {
    try {
      if (this.redis.status !== 'ready') await this.redis.connect();
      const result = (await this.redis.eval(
        INCREMENT_SCRIPT,
        2,
        `medibook:throttle:${throttlerName}:${key}`,
        `medibook:throttle:${throttlerName}:${key}:blocked`,
        ttl,
        limit,
        blockDuration,
      )) as [
        number | string,
        number | string,
        number | string,
        number | string,
      ];
      return {
        totalHits: Number(result[0]),
        timeToExpire: Number(result[1]),
        isBlocked: Number(result[2]) === 1,
        timeToBlockExpire: Number(result[3]),
      };
    } catch {
      if (this.config.get<string>('NODE_ENV') === 'production') {
        throw new ServiceUnavailableException(
          'Request protection is temporarily unavailable',
        );
      }

      // Keep the API available if Redis is restarting; the in-memory window
      // limits requests locally until the shared store returns.
      return this.memory.increment(
        key,
        ttl,
        limit,
        blockDuration,
        throttlerName,
      );
    }
  }
}
