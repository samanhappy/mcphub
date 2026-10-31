import 'reflect-metadata';
import { initializeDatabaseMode } from '../utils/migration.js';
import { closeDatabase, getAppDataSource } from './connection.js';
import { installReplicaSchema } from './replicaSchema.js';
import { logger } from '../utils/logger.js';
import { initializeDefaultUser } from '../models/User.js';

try {
  if (!process.env.DB_URL?.startsWith('postgres') || process.env.USE_DB === 'false')
    throw new Error('db:setup requires a PostgreSQL DB_URL');
  if (process.env.MCPHUB_REPLICA_MODE === 'true' || process.env.DB_SYNCHRONIZE === 'false')
    throw new Error('Run db:setup without replica mode and with DB_SYNCHRONIZE=true');
  if (!(await initializeDatabaseMode())) throw new Error('Database setup failed');
  await initializeDefaultUser();
  await installReplicaSchema(getAppDataSource());
  logger.info('Database schema and replica revision tracking are ready');
} catch (error) {
  logger.error('Database setup failed', error);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
