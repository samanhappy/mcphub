import {
  getBearerKeyDao,
  getGroupDao,
  getServerDao,
  getSystemConfigDao,
} from '../dao/DaoFactory.js';
import { findMissingToolPolicyReferences, validateToolPolicies } from '../utils/toolPolicy.js';
import { logger } from '../utils/logger.js';

export async function warnMissingToolPolicyReferences(): Promise<void> {
  try {
    const rules = (await getSystemConfigDao().get({ failClosed: true })).toolPolicies ?? [];
    validateToolPolicies(rules);
    if (!rules.length) return;
    const [servers, keys, groups] = await Promise.all([
      getServerDao().findAll(),
      getBearerKeyDao().findAll(),
      getGroupDao().findAll(),
    ]);
    for (const reference of findMissingToolPolicyReferences(rules, {
      serverId: servers.flatMap(({ id }) => (id ? [id] : [])),
      keyId: keys.map(({ id }) => id),
      groupId: groups.map(({ id }) => id),
    })) {
      logger.warn(
        'Tool policy references a missing ID; review this rule before relying on it',
        reference,
      );
    }
  } catch (error) {
    logger.warn('Could not check tool policy references', error);
  }
}
