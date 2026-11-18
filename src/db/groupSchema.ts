import type { DataSource, QueryRunner, ReplicationMode } from 'typeorm';

const wrappedDrivers = new WeakSet<object>();

// TypeORM's PostgresQueryRunner issues concurrent this.query() calls via Promise.all
// (e.g. in loadTables for array/enum columns) on a single pg.Client, triggering pg's
// deprecation warning (and future error in pg@9). Serialize queries per QueryRunner.
export const serializePostgresQueryRunnerQueries = (dataSource: DataSource): void => {
  const driver = (dataSource as { driver?: DataSource['driver'] }).driver;
  if (!driver || driver.options?.type !== 'postgres') return;
  if (typeof driver.createQueryRunner !== 'function') return;
  if (wrappedDrivers.has(driver)) return;
  wrappedDrivers.add(driver);

  const originalCreateQueryRunner = driver.createQueryRunner.bind(driver);
  driver.createQueryRunner = (mode: ReplicationMode): QueryRunner => {
    const queryRunner = originalCreateQueryRunner(mode);
    if (!queryRunner || typeof queryRunner.query !== 'function') return queryRunner;

    let queue: Promise<void> = Promise.resolve();
    const originalQuery = queryRunner.query.bind(queryRunner);

    queryRunner.query = ((...args: Parameters<QueryRunner['query']>) => {
      const next = queue.then(() => originalQuery(...args));
      queue = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    }) as QueryRunner['query'];

    return queryRunner;
  };
};

// Check before TypeORM applies the unique name constraint. Never rename/delete legacy data.
export const assertUniqueGroupNames = async (dataSource: DataSource): Promise<void> => {
  const [{ exists }] = await dataSource.query(
    `SELECT to_regclass('public.groups') IS NOT NULL AS exists`,
  );
  if (!exists) return;
  const duplicates: { name: string; count: string }[] = await dataSource.query(
    `SELECT name, count(*)::text AS count FROM "groups" GROUP BY name HAVING count(*) > 1 ORDER BY name`,
  );
  if (duplicates.length) {
    throw new Error(
      `Duplicate group names prevent schema upgrade. Resolve these groups before restarting: ${JSON.stringify(duplicates)}`,
    );
  }
};

export interface InitializeGroupNameCheckOptions {
  /**
   * Skip `dataSource.synchronize()` (DDL) after initialization. Used on the
   * reconnection path: re-running schema DDL in a transaction while serving
   * traffic risks blocking on locks and leaving a connection stuck in
   * `idle in transaction`, which can wedge pool teardown (see #1205).
   */
  skipSynchronize?: boolean;
}

export const initializeWithGroupNameCheck = async (
  dataSource: DataSource,
  options?: InitializeGroupNameCheckOptions,
): Promise<void> => {
  serializePostgresQueryRunnerQueries(dataSource);
  const synchronize = dataSource.options.synchronize;
  dataSource.setOptions({ synchronize: false });
  try {
    await dataSource.initialize();
    await assertUniqueGroupNames(dataSource);
    if (synchronize && !options?.skipSynchronize) await dataSource.synchronize();
  } catch (error) {
    if (dataSource.isInitialized) await dataSource.destroy();
    throw error;
  } finally {
    dataSource.setOptions({ synchronize });
  }
};
