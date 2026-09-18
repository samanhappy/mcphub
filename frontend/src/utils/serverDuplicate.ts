import type { Server, ServerConfig } from '../types';
import { SERVER_NAME_MAX_LENGTH } from './serverName';

/**
 * Helpers for the server-card "Duplicate" action (#1187): the add form is
 * opened pre-filled from an existing server and the copy is created through the
 * normal `POST /servers` path.
 */

export const DUPLICATE_NAME_SUFFIX = '-copy';

/**
 * Server names are unique, so the duplicate is pre-filled with `<source>-copy`.
 * The existing create validation rejects the copy when that name is taken, and
 * the field stays editable. Names are capped at the same length the name input
 * enforces, so the suffix can never be silently truncated by `maxLength`.
 */
export const buildDuplicateServerName = (sourceName: string): string => {
  const maxBaseLength = Math.max(SERVER_NAME_MAX_LENGTH - DUPLICATE_NAME_SUFFIX.length, 0);
  return `${sourceName.slice(0, maxBaseLength)}${DUPLICATE_NAME_SUFFIX}`;
};

/**
 * Build the `initialData` the add form is pre-filled with.
 *
 * Transport, credentials and capability overrides follow the copy; the source's
 * OAuth *authorization* does not. A duplicate has to connect - and therefore
 * authorize - on its own instead of silently reusing the source's upstream
 * identity, so the stored access/refresh tokens (and any half-finished
 * authorization) are dropped while the static client configuration
 * (`clientId`, `clientSecret`, `scopes`, endpoints) is kept.
 */
export const buildDuplicateSource = (server: Server): Server => {
  const { oauth, ...config } = server.config ?? {};
  const { accessToken, refreshToken, pendingAuthorization, ...oauthConfig } = oauth ?? {};

  return {
    name: buildDuplicateServerName(server.name),
    status: 'disconnected',
    config: {
      ...config,
      ...(Object.keys(oauthConfig).length > 0 ? { oauth: oauthConfig } : {}),
    },
  };
};

export interface CarryOverOptions {
  /**
   * Separator MCPHub uses to prefix runtime names (`<serverName><separator>
   * <name>`). The backend resolves it from the system configuration, so callers
   * pass the value the dashboard already holds instead of guessing it.
   */
  nameSeparator?: string;
}

const remapKeys = <T>(
  map: Record<string, T> | undefined,
  mapKey: (key: string) => string,
): Record<string, T> | undefined => {
  if (!map) {
    return undefined;
  }

  return Object.fromEntries(Object.entries(map).map(([key, value]) => [mapKey(key), value]));
};

/**
 * Carry the source's tool/prompt/resource overrides onto a create payload.
 *
 * `buildServerPayload` rebuilds the configuration from form fields, so the
 * per-capability state (enabled flag and edited descriptions) would otherwise
 * be dropped by the copy.
 *
 * Tool and prompt overrides are stored under the name the dashboard toggled,
 * which is the runtime server-prefixed name (`<serverName><separator><name>`).
 * The copy only swaps the server part of the key, so the separator is kept as
 * it is - but it has to be part of the match: a server called `db` can still
 * carry `dbx-greet` from a previous name (renaming a server rewrites its record
 * and leaves the override keys behind), and matching on the bare source name
 * would rewrite that stale key into a name nothing can resolve. Known runtime
 * tool names identify tool keys; prompts are matched with the configured
 * separator. `config.resources` is keyed by resource URI and needs no rewrite.
 *
 * Recognising prefixed tool keys needs the source's discovered tools, so a
 * source that is currently disconnected keeps its tool overrides verbatim; the
 * copy then has no matching tool and the override stays inert, which is the
 * same outcome as not carrying it. Prompt and resource overrides are keyed
 * unambiguously and always follow the copy.
 */
export const carryOverCapabilityOverrides = (
  payload: { name: string; config: Partial<ServerConfig> },
  source: Server,
  options: CarryOverOptions = {},
): { name: string; config: Partial<ServerConfig> } => {
  const sourceConfig = source.config;
  if (!sourceConfig) {
    return payload;
  }

  const nameSeparator = options.nameSeparator || '-';
  const runtimeToolNames = new Set((source.tools ?? []).map((tool) => tool.name));
  const rename = (key: string) => `${payload.name}${key.slice(source.name.length)}`;

  // A bare tool key is a documented shape (the execution-time lookup falls back
  // to it), so only keys that are known runtime names get renamed.
  const tools = remapKeys(sourceConfig.tools, (key) =>
    runtimeToolNames.has(key) ? rename(key) : key,
  );
  // Prompts are always stored prefixed - there is no bare-name fallback - so
  // the source name plus the configured separator identifies them.
  const promptPrefix = `${source.name}${nameSeparator}`;
  const prompts = remapKeys(sourceConfig.prompts, (key) =>
    key.startsWith(promptPrefix) ? rename(key) : key,
  );

  const overrides: Partial<ServerConfig> = {};
  if (tools && Object.keys(tools).length > 0) {
    overrides.tools = tools;
  }
  if (prompts && Object.keys(prompts).length > 0) {
    overrides.prompts = prompts;
  }
  if (sourceConfig.resources && Object.keys(sourceConfig.resources).length > 0) {
    overrides.resources = sourceConfig.resources;
  }

  return {
    ...payload,
    config: {
      ...payload.config,
      ...overrides,
    },
  };
};
