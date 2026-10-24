import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { TypeOrmModule } from '@nestjs/typeorm';
import Redis from 'ioredis';
import { configModuleOptions } from './config/configuration';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { loggerModule } from './common/logger.module';
import { HealthController } from './health/health.controller';
import { MediBookNamingStrategy } from './database/naming-strategy';
import { AuthModule } from './auth/auth.module';
import { DoctorsModule } from './doctors/doctors.module';
import { SlotsModule } from './slots/slots.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AdminModule } from './admin/admin.module';
import { REDIS_CLIENT, RedisModule } from './redis/redis.module';
import { RedisThrottlerStorage } from './common/redis-throttler-storage';

@Module({
  imports: [
    ConfigModule.forRoot(configModuleOptions),
    loggerModule,
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule, RedisModule],
      inject: [ConfigService, REDIS_CLIENT],
      useFactory: (configService: ConfigService, redis: Redis) => ({
        throttlers: [
          {
            name: 'default',
            ttl: configService.get<number>('THROTTLE_TTL', 60000),
            limit: configService.get<number>('THROTTLE_LIMIT', 100),
          },
        ],
        storage: new RedisThrottlerStorage(redis, configService),
      }),
    }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        type: 'mysql' as const,
        host: configService.get<string>('DB_HOST', 'localhost'),
        port: configService.get<number>('DB_PORT', 3306),
        username: configService.get<string>('DB_USERNAME', 'medibook'),
        password: configService.get<string>('DB_PASSWORD', ''),
        database: configService.get<string>('DB_DATABASE', 'medibook'),
        entities: [__dirname + '/**/*.entity{.ts,.js}'],
        migrations: [__dirname + '/database/migrations/*{.ts,.js}'],
        migrationsRun: false,
        synchronize: configService.get<boolean>('DB_SYNCHRONIZE', false),
        extra: {
          connectionLimit: configService.get<number>('DB_POOL_SIZE', 10),
          connectTimeout: configService.get<number>(
            'DB_CONNECTION_TIMEOUT_MS',
            10000,
          ),
          enableKeepAlive: true,
          keepAliveInitialDelay: 0,
        },
        namingStrategy: new MediBookNamingStrategy(),
        // All DATETIME values are stored in UTC; without this mysql2 silently
        // converts using the session timezone and shifts every timestamp.
        timezone: 'Z',
        charset: 'utf8mb4',
        ssl: configService.get<boolean>('DB_SSL', false)
          ? {
              rejectUnauthorized: true,
              ...(configService.get<string>('DB_SSL_CA', '')
                ? { ca: configService.get<string>('DB_SSL_CA') }
                : {}),
            }
          : undefined,
      }),
    }),
    RedisModule,
    AuthModule,
    DoctorsModule,
    SlotsModule,
    AppointmentsModule,
    NotificationsModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
