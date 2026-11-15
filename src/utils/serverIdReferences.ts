import type { EntityManager } from 'typeorm';
import { logger } from './logger.js';
import { SystemConfig } from '../db/entities/SystemConfig.js';
import type { SystemConfig as SystemConfigShape } from '../types/index.js';

/**
 * Rewrite persisted references to a server id (#1056).
 *
 * `ServerDao` replaces a name-derived placeholder id with a random UUID on the
 * first write and on rename. Tool policies and fake-IP exceptions store the id
 * they were written against, so an id change without this rewrite silently
 * turns a server-scoped deny rule into a rule that matches nothing (the
 * maintainer reproduced `deny` -> `allow` by editing only a description).
 *
 * The DAO is imported dynamically: `DaoFactory` constructs `ServerDao`, so a
 * static import would close the module cycle.
 */
/** The singleton `system_config` row. */
const SYSTEM_CONFIG_ID = 'default';

export const remapServerIdReferences = async (
  oldId: string,
  newId: string,
  manager?: EntityManager,
): Promise<void> => {
  if (!oldId || !newId || oldId === newId) return;
  // Inside a caller's transaction the config row is read and written through
  // that transaction, so an id rotation and its references move together.
  const dao = manager ? undefined : (await import('../dao/DaoFactory.js')).getSystemConfigDao();
  // The table is a singleton keyed by a fixed primary key; read that row by id
  // rather than "the first row", and write it back by the same key (`update({})`
  // is rejected by TypeORM as empty criteria).
  const configRow = manager
    ? await manager.getRepository(SystemConfig).findOne({ where: { id: SYSTEM_CONFIG_ID } })
    : undefined;
  const config = (configRow ?? (manager ? null : await dao!.get())) as SystemConfigShape | null;
  let policiesChanged = 0;
  let exceptionsChanged = 0;

  const policies = config?.toolPolicies;
  if (Array.isArray(policies)) {
    for (const rule of policies) {
      if (rule.serverId === oldId) {
        rule.serverId = newId;
        policiesChanged += 1;
      }
    }
  }

  const network = config?.network;
  if (Array.isArray(network?.fakeIpExceptions)) {
    for (const exception of network.fakeIpExceptions) {
      if (exception.serverId === oldId) {
        exception.serverId = newId;
        exceptionsChanged += 1;
      }
    }
  }

  if (policiesChanged === 0 && exceptionsChanged === 0) return;
  const patch = {
    ...(policiesChanged > 0 ? { toolPolicies: policies } : {}),
    ...(exceptionsChanged > 0 ? { network } : {}),
  };
  if (manager)
    await manager
      .getRepository(SystemConfig)
      .update({ id: configRow?.id ?? SYSTEM_CONFIG_ID }, patch as never);
  else await dao!.update(patch);
  logger.info(
    `[staging] remapped server id ${oldId} -> ${newId} (${policiesChanged} tool policies, ${exceptionsChanged} fake-IP exceptions)`,
  );
};
