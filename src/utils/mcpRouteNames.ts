import { getNameSeparator } from '../config/index.js';
import type { IGroupServerConfig } from '../types/index.js';

export const normalizeToolNameForServer = (serverName: string, toolName: string): string => {
  const prefix = `${serverName}${getNameSeparator()}`;
  return toolName.startsWith(prefix) ? toolName.substring(prefix.length) : toolName;
};

export const getGroupLookupName = (group: string | undefined): string | undefined => {
  if (group === '$smart') {
    return undefined;
  }
  if (group?.startsWith('$smart/')) {
    return group.substring(7) || undefined;
  }
  return group;
};

export const getExposedServerName = (
  serverName: string,
  serverConfig?: IGroupServerConfig,
): string => {
  return serverConfig?.alias?.trim() || serverName;
};

const replacePrefixedServerName = (
  name: string,
  fromServerName: string,
  toServerName: string,
): string => {
  if (fromServerName === toServerName) {
    return name;
  }

  const separator = getNameSeparator();
  const prefix = `${fromServerName}${separator}`;
  return name.startsWith(prefix)
    ? `${toServerName}${separator}${name.substring(prefix.length)}`
    : name;
};

export const projectNameForGroup = (
  name: string,
  serverName: string,
  serverConfig?: IGroupServerConfig,
): string => {
  return replacePrefixedServerName(
    name,
    serverName,
    getExposedServerName(serverName, serverConfig),
  );
};

export const resolveNameFromGroup = (
  name: string,
  serverName: string,
  serverConfig?: IGroupServerConfig,
): string => {
  return replacePrefixedServerName(
    name,
    getExposedServerName(serverName, serverConfig),
    serverName,
  );
};
