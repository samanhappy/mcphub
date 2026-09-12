import type { DataSource } from 'typeorm';

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

export const initializeWithGroupNameCheck = async (dataSource: DataSource): Promise<void> => {
  const synchronize = dataSource.options.synchronize;
  dataSource.setOptions({ synchronize: false });
  try {
    await dataSource.initialize();
    await assertUniqueGroupNames(dataSource);
    if (synchronize) await dataSource.synchronize();
  } catch (error) {
    if (dataSource.isInitialized) await dataSource.destroy();
    throw error;
  } finally {
    dataSource.setOptions({ synchronize });
  }
};
