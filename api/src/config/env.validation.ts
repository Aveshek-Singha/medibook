import Joi from 'joi';

/**
 * Single env contract for the whole API.
 *
 * Rules:
 * - One source of truth: Joi, TypeORM, docker-compose and CI all read these names.
 * - `TWILIO_*` are required ONLY when SMS_PROVIDER=twilio (Joi `when`).
 * - Numeric env values are coerced, so ConfigService returns numbers, not strings.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').required(),
  PORT: Joi.number().port().default(3000),
  API_PREFIX: Joi.string()
    .pattern(/^[A-Za-z0-9][A-Za-z0-9_-]*$/)
    .default('api'),
  APP_TIMEZONE: Joi.string()
    .default('Asia/Dhaka')
    .custom((value: string, helpers) => {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: value });
        return value;
      } catch {
        return helpers.error('any.invalid');
      }
    })
    .messages({ 'any.invalid': 'APP_TIMEZONE must be a valid IANA timezone' }),
  WEB_URL: Joi.string()
    .default('http://localhost:3001')
    .custom((value: string, helpers) => {
      const origins = value.split(',').map((origin) => origin.trim());
      const invalid = origins.find((origin) => {
        try {
          const url = new URL(origin);
          return (
            !['http:', 'https:'].includes(url.protocol) ||
            url.origin !== origin ||
            Boolean(url.username || url.password || url.search || url.hash)
          );
        } catch {
          return true;
        }
      });
      return invalid ? helpers.error('string.uri') : value;
    }),
  SWAGGER_ENABLED: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.boolean().truthy('true').falsy('false').default(false),
    otherwise: Joi.boolean().truthy('true').falsy('false').default(true),
  }),

  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().default(3306),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().allow('').required(),
  DB_DATABASE: Joi.string().required(),
  DB_SYNCHRONIZE: Joi.boolean().truthy('true').falsy('false').default(false),
  DB_SSL: Joi.boolean().truthy('true').falsy('false').default(false),
  DB_SSL_CA: Joi.string().allow('').default(''),
  DB_POOL_SIZE: Joi.number().integer().min(1).max(100).default(10),
  DB_CONNECTION_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .max(60000)
    .default(10000),

  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().port().default(6379),
  REDIS_USERNAME: Joi.string().allow('').default(''),
  REDIS_PASSWORD: Joi.string().allow('').default(''),
  REDIS_DB: Joi.number().integer().min(0).default(0),
  REDIS_TLS: Joi.boolean().truthy('true').falsy('false').default(false),
  REDIS_TLS_CA: Joi.string().allow('').default(''),
  REDIS_CONNECTION_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .max(60000)
    .default(10000),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL: Joi.string()
    .pattern(/^[1-9][0-9]*(s|m|h|d)$/)
    .default('15m'),
  JWT_REFRESH_TTL: Joi.string()
    .pattern(/^[1-9][0-9]*(s|m|h|d)$/)
    .default('7d'),

  THROTTLE_TTL: Joi.number().integer().min(1000).default(60000),
  THROTTLE_LIMIT: Joi.number().integer().min(1).default(100),
  LOGIN_THROTTLE_LIMIT: Joi.number().integer().min(1).default(5),

  MIN_BOOKING_LEAD_MINUTES: Joi.number().integer().min(0).default(30),
  MAX_SLOTS_PER_REQUEST: Joi.number().integer().min(1).max(200).default(200),

  SMS_PROVIDER: Joi.string().valid('console', 'twilio').default('console'),
  TWILIO_ACCOUNT_SID: Joi.string().allow('').default(''),
  TWILIO_AUTH_TOKEN: Joi.string().allow('').default(''),
  TWILIO_FROM_NUMBER: Joi.string().allow('').default(''),

  QUEUE_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),
  // Express accepts a bounded proxy hop count. `true` remains supported for
  // compatibility, but production deployments should provide the actual count.
  TRUST_PROXY: Joi.alternatives()
    .try(
      Joi.boolean().truthy('true').falsy('false'),
      Joi.number().integer().min(1).max(10),
    )
    .default(false),
  COOKIE_SAME_SITE: Joi.string().valid('lax', 'strict', 'none').default('lax'),
}).unknown(true);

/**
 * The migration CLI needs database-only access. Keep its contract narrow so a
 * release migration job does not need Redis, SMS-provider or signing secrets.
 */
export const databaseEnvValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').required(),
  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().default(3306),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().min(16).required(),
    otherwise: Joi.string().allow('').required(),
  }),
  DB_DATABASE: Joi.string().required(),
  DB_SSL: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.boolean().truthy('true').falsy('false').valid(true).required(),
    otherwise: Joi.boolean().truthy('true').falsy('false').default(false),
  }),
  DB_SSL_CA: Joi.string().allow('').default(''),
  DB_POOL_SIZE: Joi.number().integer().min(1).max(100).default(10),
  DB_CONNECTION_TIMEOUT_MS: Joi.number()
    .integer()
    .min(1000)
    .max(60000)
    .default(10000),
}).unknown(true);

/**
 * Joi's `when` rules cannot be expressed on the same object without duplicating
 * the base keys, so the conditional requirements live in a dedicated schema that
 * is validated after the base schema passes.
 */
export const conditionalEnvSchema = Joi.object({
  SMS_PROVIDER: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.valid('twilio').required(),
    otherwise: Joi.valid('console', 'twilio').default('console'),
  }),
  DB_PASSWORD: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().min(16).required(),
    otherwise: Joi.string().allow('').required(),
  }),
  WEB_URL: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .required()
      .custom((value: string, helpers) => {
        const origins = value.split(',').map((origin) => origin.trim());
        const invalid = origins.find((origin) => {
          try {
            const url = new URL(origin);
            return (
              url.protocol !== 'https:' ||
              url.origin !== origin ||
              Boolean(url.username || url.password || url.search || url.hash) ||
              ['localhost', '::1', '[::1]', '0.0.0.0'].includes(url.hostname) ||
              url.hostname.startsWith('127.') ||
              url.hostname.endsWith('.localhost')
            );
          } catch {
            return true;
          }
        });
        return invalid ? helpers.error('string.uri') : value;
      }),
    otherwise: Joi.string().default('http://localhost:3001'),
  }),
  DB_SYNCHRONIZE: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.boolean().valid(false).required(),
    otherwise: Joi.boolean().default(false),
  }),
  DB_SSL: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.boolean().valid(true).required(),
    otherwise: Joi.boolean().default(false),
  }),
  REDIS_TLS: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.boolean().valid(true).required(),
    otherwise: Joi.boolean().default(false),
  }),
  REDIS_PASSWORD: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().min(16).required(),
    otherwise: Joi.string().allow('').default(''),
  }),
  SWAGGER_ENABLED: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.boolean().valid(false).default(false),
    otherwise: Joi.boolean().default(true),
  }),
  LOG_LEVEL: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string().valid('fatal', 'error', 'warn', 'info').default('info'),
    otherwise: Joi.string()
      .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
      .default('info'),
  }),
  TRUST_PROXY: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.alternatives()
      .try(Joi.boolean().valid(false), Joi.number().integer().min(1).max(10))
      .required(),
    otherwise: Joi.alternatives()
      .try(
        Joi.boolean().truthy('true').falsy('false'),
        Joi.number().integer().min(1).max(10),
      )
      .default(false),
  }),
  QUEUE_ENABLED: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.boolean().valid(true).required(),
    otherwise: Joi.boolean().default(true),
  }),
  JWT_ACCESS_SECRET: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .min(32)
      .invalid('change-me-access-secret-at-least-32-characters-long')
      .required(),
    otherwise: Joi.string().min(32).required(),
  }),
  JWT_REFRESH_SECRET: Joi.when('NODE_ENV', {
    is: 'production',
    then: Joi.string()
      .min(32)
      .invalid('change-me-refresh-secret-at-least-32-characters-long')
      .required(),
    otherwise: Joi.string().min(32).required(),
  }),
  TWILIO_ACCOUNT_SID: Joi.when('SMS_PROVIDER', {
    is: 'twilio',
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').default(''),
  }),
  TWILIO_AUTH_TOKEN: Joi.when('SMS_PROVIDER', {
    is: 'twilio',
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').default(''),
  }),
  TWILIO_FROM_NUMBER: Joi.when('SMS_PROVIDER', {
    is: 'twilio',
    then: Joi.string().required(),
    otherwise: Joi.string().allow('').default(''),
  }),
})
  .unknown(true)
  .custom((value, helpers) => {
    if (
      value.NODE_ENV === 'production' &&
      value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET
    ) {
      return helpers.error('any.custom');
    }
    return value;
  })
  .messages({
    'any.custom':
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different in production',
  });
