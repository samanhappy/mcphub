import type { IGroupServerConfig } from '../types/index.js';

export const projectGroupToolName = (
  name: string,
  serverName: string,
  config: IGroupServerConfig | undefined,
  separator: string,
): string => {
  const prefix = `${serverName}${separator}`;
  if (!name.startsWith(prefix)) return name;
  const rawName = name.slice(prefix.length);
  return config?.preserveToolNames
    ? rawName
    : `${config?.alias?.trim() || serverName}${separator}${rawName}`;
};

export const assertValidGroupToolNames = (tools: ReadonlyArray<{ name: string }>): void => {
  const names = new Set<string>();
  for (const { name } of tools) {
    if (['search_tools', 'describe_tool', 'call_tool'].includes(name)) {
      throw new Error('Original tool names must not collide with Smart Routing meta-tools');
    }
    if (names.has(name))
      throw new Error(`Ambiguous group tool name '${name}'; use a server prefix to disambiguate`);
    names.add(name);
  }
};
