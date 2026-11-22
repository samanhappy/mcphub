// Dashboard-side detection of newly discovered tools (#1496).
//
// The dashboard keeps, per user, the tool names it last acknowledged for each
// server. A tool that is in the current list but not in that baseline is new.

export type KnownTools = Record<string, string[]>;

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

export interface ToolListSource {
  name: string;
  enabled?: boolean;
  tools?: Array<{ name: string }>;
}

const STORAGE_PREFIX = 'mcphub_known_tools:';

export const knownToolsStorageKey = (username?: string): string =>
  `${STORAGE_PREFIX}${username ?? ''}`;

const isKnownTools = (value: unknown): value is KnownTools =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  Object.values(value).every(
    (names) => Array.isArray(names) && names.every((name) => typeof name === 'string'),
  );

export const readKnownTools = (store: KeyValueStore, key: string): KnownTools => {
  try {
    const parsed: unknown = JSON.parse(store.getItem(key) ?? '{}');
    return isKnownTools(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export const writeKnownTools = (store: KeyValueStore, key: string, known: KnownTools): void => {
  try {
    store.setItem(key, JSON.stringify(known));
  } catch {
    // Storage can be full or blocked. The indicator is best effort.
  }
};

// Compare upstream names, so a change of the name separator does not mark
// every tool as new.
export const upstreamToolName = (
  serverName: string,
  toolName: string,
  nameSeparator: string,
): string => {
  const prefix = `${serverName}${nameSeparator}`;
  return toolName.startsWith(prefix) ? toolName.slice(prefix.length) : toolName;
};

export const getToolNames = (server: ToolListSource, nameSeparator: string): string[] =>
  (server.tools ?? []).map((tool) => upstreamToolName(server.name, tool.name, nameSeparator));

/**
 * Returns the baseline to store and the tools that are not in it.
 *
 * A disabled server, or a server that has not reported any tools yet, keeps its
 * baseline unchanged. The first tool list of a server becomes its baseline
 * without any new tools, so adding a server does not flag all of its tools.
 */
export const reconcileKnownTools = (
  known: string[] | undefined,
  server: ToolListSource,
  nameSeparator: string,
): { known: string[] | undefined; newTools: string[] } => {
  const current = getToolNames(server, nameSeparator);
  if (server.enabled === false || current.length === 0) return { known, newTools: [] };
  if (!known) return { known: current, newTools: [] };
  const seen = new Set(known);
  return { known, newTools: current.filter((name) => !seen.has(name)) };
};
