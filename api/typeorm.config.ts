import { DataSourceOptions } from 'typeorm';
import { AppDataSource, dataSourceOptions } from './src/database/data-source';

/**
 * Root-level TypeORM CLI config (used by `typeorm-ts-node-commonjs`).
 * It reuses the app's own options so the CLI and the API always agree.
 */
export default dataSourceOptions satisfies DataSourceOptions;

export { AppDataSource };
