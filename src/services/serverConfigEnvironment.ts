import { replaceEnvVars } from '../config/index.js';
import { getUserDao } from '../dao/index.js';
import { hasCredentialTemplate } from '../utils/credentialTemplate.js';
import type { ServerConfig } from '../types/index.js';

/** Ownerless operator configuration is trusted; missing owners fail closed. */
export const getServerEnvironment = async (
  config: ServerConfig,
): Promise<Record<string, string>> => {
  const trusted =
    !config.owner || (await getUserDao().findByUsername(config.owner))?.isAdmin === true;
  const source = trusted ? process.env : {};
  return {
    ...(source as Record<string, string>),
    ...(hasCredentialTemplate(config) ? config.env : replaceEnvVars(config.env || {}, source)),
  };
};

export const expandServerConfig = async <T extends ServerConfig>(config: T): Promise<T> => {
  const { owner, visibility, sharedWithUsers, ...transportConfig } = config;
  // Authorization metadata is literal and must never be controlled by expansion values.
  return {
    ...replaceEnvVars(transportConfig, await getServerEnvironment(config)),
    owner,
    visibility,
    sharedWithUsers,
  } as T;
};
