import type { DataSource } from 'typeorm';

// Capture every persistence path, including imports and direct SQL, in the writer's transaction.
export const installReplicaSchema = async (source: DataSource): Promise<void> => {
  await source.transaction(async (manager) => {
    await manager.query(`
      CREATE TABLE IF NOT EXISTS mcphub_revision (
        id integer PRIMARY KEY CHECK (id = 1), version bigint NOT NULL DEFAULT 0
      );
      INSERT INTO mcphub_revision (id) VALUES (1) ON CONFLICT DO NOTHING;
      CREATE OR REPLACE FUNCTION mcphub_bump_revision() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        UPDATE mcphub_revision SET version = version + 1 WHERE id = 1;
        RETURN NULL;
      END $$;
    `);
    for (const table of [
      'servers',
      'groups',
      'system_config',
      'users',
      'user_configs',
      'bearer_keys',
      'builtin_prompts',
      'builtin_resources',
      'credential_bindings',
    ]) {
      const [{ exists }] = await manager.query('SELECT to_regclass($1) IS NOT NULL AS exists', [
        table,
      ]);
      if (!exists) continue;
      await manager.query(`
        DROP TRIGGER IF EXISTS mcphub_revision_changed ON "${table}";
        CREATE TRIGGER mcphub_revision_changed AFTER INSERT OR UPDATE OR DELETE OR TRUNCATE
        ON "${table}" FOR EACH STATEMENT EXECUTE FUNCTION mcphub_bump_revision();
      `);
    }
  });
};
