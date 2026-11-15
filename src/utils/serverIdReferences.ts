import { logger } from './logger.js';

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
export const remapServerIdReferences = async (oldId: string, newId: string): Promise<void> => {
  if (!oldId || !newId || oldId === newId) return;
  const { getSystemConfigDao } = await import('../dao/DaoFactory.js');
  const dao = getSystemConfigDao();
  const config = await dao.get();
  let policiesChanged = 0;
  let exceptionsChanged = 0;

  const policies = config.toolPolicies;
  if (Array.isArray(policies)) {
    for (const rule of policies) {
      if (rule.serverId === oldId) {
        rule.serverId = newId;
        policiesChanged += 1;
      }
    }
  }

  const network = config.network;
  if (Array.isArray(network?.fakeIpExceptions)) {
    for (const exception of network.fakeIpExceptions) {
      if (exception.serverId === oldId) {
        exception.serverId = newId;
        exceptionsChanged += 1;
      }
    }
  }

  if (policiesChanged === 0 && exceptionsChanged === 0) return;
  await dao.update({
    ...(policiesChanged > 0 ? { toolPolicies: policies } : {}),
    ...(exceptionsChanged > 0 ? { network } : {}),
  });
  logger.info(
    `[staging] remapped server id ${oldId} -> ${newId} (${policiesChanged} tool policies, ${exceptionsChanged} fake-IP exceptions)`,
  );
};
