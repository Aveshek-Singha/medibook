import { DataSource } from 'typeorm';
import { config as loadEnv } from 'dotenv';
import { MediBookNamingStrategy } from './naming-strategy';
import { validateDatabaseEnv } from '../config/configuration';

/**
 * TypeORM CLI entrypoint.
 *
 * The CLI runs outside Nest, so it loads the env file and rebuilds the same
 * connection options the app uses. Keeping both in one place stops the CLI
 * from silently writing to a different database than the app.
 */
loadEnv({ path: process.env.NODE_ENV === 'test' ? '.env.test' : '.env' });

const config = validateDatabaseEnv(process.env);
const isSsl = config.DB_SSL === true;
const sslCa = String(config.DB_SSL_CA ?? '');

export const dataSourceOptions = {
  type: 'mysql' as const,
  host: String(config.DB_HOST),
  port: Number(config.DB_PORT),
  username: String(config.DB_USERNAME),
  password: String(config.DB_PASSWORD),
  database: String(config.DB_DATABASE),
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  migrationsTableName: 'migrations',
  synchronize: false,
  timezone: 'Z',
  charset: 'utf8mb4',
  extra: {
    connectionLimit: Number(config.DB_POOL_SIZE),
    connectTimeout: Number(config.DB_CONNECTION_TIMEOUT_MS),
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  },
  namingStrategy: new MediBookNamingStrategy(),
  ssl: isSsl
    ? {
        rejectUnauthorized: true,
        ...(sslCa ? { ca: sslCa } : {}),
      }
    : undefined,
};

export const AppDataSource = new DataSource(dataSourceOptions);

export default AppDataSource;
