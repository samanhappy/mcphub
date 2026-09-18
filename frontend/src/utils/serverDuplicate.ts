import type { Server, ServerConfig } from '../types';
import { SERVER_NAME_MAX_LENGTH } from './serverName';

/**
 * Helpers for the server-card "Duplicate" action (#1187): the add form is
 * opened pre-filled from an existing server and the copy is created through the
 * normal `POST /servers` path.
 */

// Internal suffix for the duplicate name; not part of the module's public API.
const DUPLICATE_NAME_SUFFIX = '-copy';

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
 * tool names identify tool keys that belong to the source. A tool key that
 * carries the `<source.name><separator>` prefix can be one of three things:
 * a known runtime name (renamed onto the copy), the bare upstream name of a
 * known runtime tool that itself starts with the source prefix (e.g.
 * `db-query` for runtime name `db-db-query`; kept verbatim, because renaming
 * it would produce a key none of the copy's lookups can reach), or genuinely
 * stale (dropped, because the copy's tools resolve under the copy's own
 * prefix and the key can never match). Prompts are matched with the
 * configured separator.
 * `config.resources` is keyed by resource URI and needs no rewrite.
 *
 * Bare keys - the ones without the `<source.name><separator>` prefix - are
 * always kept verbatim: the execution-time lookup falls back to the bare
 * upstream name, so the override still takes effect on the copy. A
 * disconnected source has no discovered tools, so its prefixed tool keys are
 * all attributable by prefix alone and the stale ones are dropped. Prompt and
 * resource overrides are keyed unambiguously and always follow the copy.
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

  // A bare tool key is a documented shape (the execution-time lookup falls
  // back to it), so it is kept verbatim. Known runtime names are renamed onto
  // the copy. A key that itself carries the source prefix can also be the
  // bare upstream name of a known runtime tool (e.g. `db-query` for runtime
  // name `db-db-query`); it is kept verbatim too - the copy's lookups consult
  // `<copy><separator><upstream>` and the bare upstream name, and renaming
  // would produce a key neither can reach. A key that carries the source
  // prefix but matches neither a runtime name nor a runtime tool's bare name
  // is stale (e.g. left behind by a rename) and is dropped, since it can never
  // resolve on the copy.
  const sourcePrefix = `${source.name}${nameSeparator}`;
  const tools = sourceConfig.tools
    ? Object.fromEntries(
        Object.entries(sourceConfig.tools).flatMap(([key, value]) => {
          if (runtimeToolNames.has(key)) {
            return [[rename(key), value]];
          }
          if (key.startsWith(sourcePrefix) && runtimeToolNames.has(`${sourcePrefix}${key}`)) {
            // The bare upstream name of a known runtime tool, itself carrying
            // the source prefix: keep it verbatim. The copy's execution-time
            // lookups consult `<copy><separator><upstream>` and the bare
            // upstream name, so renaming would produce a key neither can reach.
            return [[key, value]];
          }
          if (key.startsWith(sourcePrefix)) {
            return [];
          }
          return [[key, value]];
        }),
      )
    : undefined;
  // Prompts are always stored prefixed - there is no bare-name fallback - so
  // the source name plus the configured separator identifies them.
  const prompts = remapKeys(sourceConfig.prompts, (key) =>
    key.startsWith(sourcePrefix) ? rename(key) : key,
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

/**
 * B1 guard decision for the Duplicate interleave race on the servers page.
 *
 * Clicking Duplicate on a server fires a `GET /servers/<name>`; the add modal
 * opens from the response. A slow request can still be in flight when the user
 * clicks Duplicate on another server, so two responses can race. Without a
 * guard the stale response could overwrite the prefill after the modal already
 * opened, silently mounting one server's capability overrides onto another's
 * payload.
 *
 * Each accepted click tags its request with a monotonically increasing id; the
 * caller keeps the *latest* id in a counter that is never reset. A response is
 * 'commit'-able only while its id is still the latest (`requestId ===
 * latestRequestId`); otherwise it is 'stale' and is dropped. Because the latest
 * id is monotonic and never reset, the winning request satisfies the equality
 * in *both* the commit check and the busy-clear `finally`, so the busy
 * indicator is always cleared on the winning path (and never cleared early by
 * a superseded request's late return).
 */
export const resolveDuplicateResponse = (
  requestId: number,
  latestRequestId: number,
): 'commit' | 'stale' => (requestId === latestRequestId ? 'commit' : 'stale');
