import { validateReplicaEnvironment } from '../../src/utils/replicaMode.js';

describe('replica environment', () => {
  const original = { ...process.env };
  beforeEach(() => {
    Object.assign(process.env, {
      MCPHUB_REPLICA_MODE: 'true',
      USE_DB: 'true',
      DB_URL: 'postgres://localhost/test',
      DB_SYNCHRONIZE: 'false',
      JWT_SECRET: 'x'.repeat(32),
      MCPHUB_CREDENTIAL_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
    });
    delete process.env.MCPHUB_SETTINGS_SYNC;
  });
  afterEach(() => {
    process.env = { ...original };
  });
  test('accepts an explicitly configured PostgreSQL replica', () => {
    expect(() => validateReplicaEnvironment()).not.toThrow();
  });
  test.each(['DB_URL', 'JWT_SECRET', 'MCPHUB_CREDENTIAL_ENCRYPTION_KEY'])(
    'rejects missing %s',
    (name) => {
      delete process.env[name];
      expect(() => validateReplicaEnvironment()).toThrow();
    },
  );
  test('rejects file mode, serving-node DDL and startup reconciliation', () => {
    process.env.USE_DB = 'false';
    expect(() => validateReplicaEnvironment()).toThrow('PostgreSQL');
    process.env.USE_DB = 'true';
    process.env.DB_SYNCHRONIZE = 'true';
    expect(() => validateReplicaEnvironment()).toThrow('db:setup');
    process.env.DB_SYNCHRONIZE = 'false';
    process.env.MCPHUB_SETTINGS_SYNC = 'prune';
    expect(() => validateReplicaEnvironment()).toThrow('setup job');
  });
  test('leaves single-instance deployments unchanged', () => {
    process.env.MCPHUB_REPLICA_MODE = 'false';
    delete process.env.JWT_SECRET;
    expect(() => validateReplicaEnvironment()).not.toThrow();
  });
});
