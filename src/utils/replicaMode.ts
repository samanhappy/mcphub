export const isReplicaMode = (): boolean => process.env.MCPHUB_REPLICA_MODE === 'true';

export const validateReplicaEnvironment = (): void => {
  if (!isReplicaMode()) return;
  if (process.env.USE_DB === 'false' || !process.env.DB_URL?.startsWith('postgres'))
    throw new Error('Replica mode requires PostgreSQL DB_URL and database storage');
  if (process.env.DB_SYNCHRONIZE !== 'false')
    throw new Error('Replica mode requires DB_SYNCHRONIZE=false; run db:setup separately');
  if (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET) < 32)
    throw new Error('Replica mode requires a persistent JWT_SECRET of at least 32 bytes');
  const key = process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY;
  if (!key || !/^[A-Za-z0-9+/]{43}=$/.test(key) || Buffer.from(key, 'base64').length !== 32)
    throw new Error('Replica mode requires MCPHUB_CREDENTIAL_ENCRYPTION_KEY (32 bytes, base64)');
  if (process.env.MCPHUB_SETTINGS_SYNC)
    throw new Error('Apply MCPHUB_SETTINGS_SYNC in the setup job, not on serving replicas');
};
