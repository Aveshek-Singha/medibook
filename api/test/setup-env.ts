import { config as loadEnv } from 'dotenv';

/**
 * e2e always runs against the test database and the disabled queue.
 * NODE_ENV=test makes ConfigModule prefer `.env.test` over `.env`.
 */
process.env.NODE_ENV = 'test';
loadEnv({ path: '.env.test' });
loadEnv({ path: '.env', override: false });
