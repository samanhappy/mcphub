import { isDeepStrictEqual } from 'node:util';

import type { ServerConfig } from '../types/index.js';

/** A stored server row: the config plus its key. */
export type ServerRecord = ServerConfig & { name: string };
import { hasStagedTools } from '../services/fileStaging/adapter.js';
import { normalizeServerConfigForPersistence } from './serverConfigPersistence.js';

const stripUndefinedDeep = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, nestedValue]) => nestedValue !== undefined)
        .map(([key, nestedValue]) => [key, stripUndefinedDeep(nestedValue)]),
    );
  }

  return value;
};

// Fields baked into the live MCP client/transport at connect time. Editing any
// of these requires tearing down and re-establishing the runtime. Everything
// else in ServerConfig (description, owner, visibility, sharedWithUsers,
// `enabled`, and the tools/prompts/resources per-item overrides) is read-time
// or access metadata that can be applied without a reconnect.
export const CONNECTION_RELEVANT_CONFIG_FIELDS = [
  'type',
  'url',
  'command',
  'args',
  'env',
  'headers',
  'passthroughHeaders',
  'options',
  'oauth',
  'openapi',
  'perSessionClient',
  'credentialTemplate',
  'staging',
  'startOnDemand',
  'idleTimeoutMs',
  'enableKeepAlive',
  'protocolNegotiation',
  'keepAliveInterval',
  'proxy',
] as const;

export type ConnectionRelevantServerConfig = Pick<
  ServerConfig,
  (typeof CONNECTION_RELEVANT_CONFIG_FIELDS)[number]
>;

export const toConnectionRelevantConfig = (
  config: ServerConfig | ServerRecord,
): ConnectionRelevantServerConfig => {
  const normalized = normalizeServerConfigForPersistence(config) as Record<string, unknown>;
  const picked: Record<string, unknown> = {};
  for (const field of CONNECTION_RELEVANT_CONFIG_FIELDS) {
    // Database mode reads unset columns (e.g. `proxy`) back as null, while a
    // request leaves them out; both mean "not set".
    picked[field] = normalized[field] ?? undefined;
  }
  // Derived state: a staged tool needs the child to start in the principal's
  // staging root. Toggling `fileStaging.enabled` on one tool changes the
  // effective cwd, so it must count as a connection-relevant edit even though
  // `tools` itself is otherwise a read-time override (#1056).
  picked.stagedTools = hasStagedTools(normalized as ServerConfig);
  const comparable = stripUndefinedDeep(picked) as Record<string, unknown>;
  // Treat the default request timeout (60000, the dashboard form default) as
  // equivalent to "not set": an explicit 60000 stored via API/file import and an
  // absent timeout resolve to the same effective connect timeout. Without this, a
  // stored explicit 60000 (or the dashboard echoing 60000 back) would look like a
  // connection change on unrelated edits and reload the runtime for nothing.
  const options = comparable.options as { timeout?: number } | undefined;
  if (options && options.timeout === 60000) {
    delete options.timeout;
    if (Object.keys(options).length === 0) {
      delete comparable.options;
    }
  }
  return comparable as ConnectionRelevantServerConfig;
};

// True when an edit touches at least one field the live connection depends on,
// i.e. the runtime must be torn down and reconnected.
export const hasConnectionRelevantChange = (
  existingServer: ServerRecord,
  nextConfig: ServerConfig,
): boolean =>
  !isDeepStrictEqual(
    toConnectionRelevantConfig(existingServer),
    toConnectionRelevantConfig(nextConfig),
  );
