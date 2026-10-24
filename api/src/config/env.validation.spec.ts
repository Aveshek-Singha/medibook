import { validateDatabaseEnv, validateEnv } from './configuration';

const baseEnv = {
  NODE_ENV: 'development',
  DB_HOST: 'localhost',
  DB_PORT: '13306',
  DB_USERNAME: 'medibook',
  DB_PASSWORD: 'medibook',
  DB_DATABASE: 'medibook',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
  REDIS_PASSWORD: '',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
};

const productionEnv = {
  ...baseEnv,
  NODE_ENV: 'production',
  DB_PASSWORD: 'a-long-production-password',
  DB_SSL: 'true',
  REDIS_TLS: 'true',
  REDIS_PASSWORD: 'a-long-production-redis-password',
  WEB_URL: 'https://app.example.com',
  JWT_ACCESS_SECRET: 'a'.repeat(40),
  JWT_REFRESH_SECRET: 'b'.repeat(40),
  DB_SYNCHRONIZE: 'false',
  QUEUE_ENABLED: 'true',
  SMS_PROVIDER: 'twilio',
  TWILIO_ACCOUNT_SID: 'AC12345678901234567890123456789012',
  TWILIO_AUTH_TOKEN: 'a'.repeat(32),
  TWILIO_FROM_NUMBER: '+15005550006',
};

describe('environment validation', () => {
  it('coerces local service and throttle settings', () => {
    const validated = validateEnv(baseEnv);
    expect(validated.DB_PORT).toBe(13306);
    expect(validated.REDIS_PORT).toBe(6379);
    expect(validated.DB_SYNCHRONIZE).toBe(false);
    expect(validated.WEB_URL).toBe('http://localhost:3001');
    expect(validated.SWAGGER_ENABLED).toBe(true);
    expect(validated.TRUST_PROXY).toBe(false);
  });

  it('requires an explicit runtime environment instead of silently using development', () => {
    const missingNodeEnvironment = { ...baseEnv, NODE_ENV: undefined };
    expect(() => validateEnv(missingNodeEnvironment)).toThrow(
      'Config validation error',
    );
  });

  it('accepts a bounded trusted-proxy hop count', () => {
    expect(validateEnv({ ...baseEnv, TRUST_PROXY: '2' }).TRUST_PROXY).toBe(2);
  });

  it('accepts a production config with isolated secrets and required SMS settings', () => {
    expect(validateEnv(productionEnv)).toMatchObject({
      NODE_ENV: 'production',
      DB_SYNCHRONIZE: false,
      QUEUE_ENABLED: true,
      SMS_PROVIDER: 'twilio',
      DB_SSL: true,
      REDIS_TLS: true,
      SWAGGER_ENABLED: false,
    });
  });

  it('validates a production migration job with database-only credentials', () => {
    expect(
      validateDatabaseEnv({
        NODE_ENV: 'production',
        DB_HOST: 'mysql.example.com',
        DB_PORT: '3306',
        DB_USERNAME: 'medibook_migrator',
        DB_PASSWORD: 'strong-migration-password',
        DB_DATABASE: 'medibook',
        DB_SSL: 'true',
      }),
    ).toMatchObject({
      NODE_ENV: 'production',
      DB_PORT: 3306,
      DB_SSL: true,
      DB_POOL_SIZE: 10,
    });
  });

  it('rejects production migrations without database TLS', () => {
    expect(() =>
      validateDatabaseEnv({
        NODE_ENV: 'production',
        DB_HOST: 'mysql.example.com',
        DB_USERNAME: 'medibook_migrator',
        DB_PASSWORD: 'strong-migration-password',
        DB_DATABASE: 'medibook',
        DB_SSL: 'false',
      }),
    ).toThrow('Database configuration validation error');
  });

  it.each([
    ['schema synchronization', { DB_SYNCHRONIZE: 'true' }],
    ['queue processing', { QUEUE_ENABLED: 'false' }],
    [
      'placeholder signing secrets',
      {
        JWT_ACCESS_SECRET:
          'change-me-access-secret-at-least-32-characters-long',
      },
    ],
    ['reused signing secrets', { JWT_REFRESH_SECRET: 'a'.repeat(40) }],
    ['local SMS provider', { SMS_PROVIDER: 'console' }],
    ['database TLS', { DB_SSL: 'false' }],
    ['Redis TLS', { REDIS_TLS: 'false' }],
    ['weak Redis password', { REDIS_PASSWORD: 'short' }],
    ['non-HTTPS frontend origin', { WEB_URL: 'http://app.example.com' }],
    ['localhost frontend origin', { WEB_URL: 'https://localhost:3001' }],
    ['IPv6 loopback frontend origin', { WEB_URL: 'https://[::1]:3001' }],
    ['invalid JWT lifetime', { JWT_ACCESS_TTL: 'forever' }],
    ['invalid application timezone', { APP_TIMEZONE: 'Nowhere/Invalid' }],
    ['invalid API prefix', { API_PREFIX: '/api/v1' }],
    ['production Swagger UI', { SWAGGER_ENABLED: 'true' }],
    ['unbounded trusted proxy setting', { TRUST_PROXY: 'true' }],
    ['verbose production logging', { LOG_LEVEL: 'debug' }],
  ])(
    'rejects production config with unsafe %s settings',
    (_label, overrides) => {
      expect(() => validateEnv({ ...productionEnv, ...overrides })).toThrow(
        'Config validation error',
      );
    },
  );
});
