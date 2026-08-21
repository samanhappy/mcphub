/**
 * Human-readable description of an RFC 8707 `resource` URI for the OAuth
 * consent screen. The resource tells the user which MCPHub target the client
 * is asking to access (e.g. the aggregated `/mcp` endpoint or a single server
 * behind `/mcp/{name}`).
 */
export type ResourceTargetKind = 'all' | 'smart' | 'target' | 'server' | 'group' | 'unknown';

export interface ResourceTarget {
  /** The raw `resource` URI as sent by the client. */
  raw: string;
  /** URL pathname (trailing slashes stripped), or the raw string when unparseable. */
  path: string;
  kind: ResourceTargetKind;
  /** Target name for `/mcp/{name}` resources (e.g. a server or group name). */
  name?: string;
}

/**
 * Parse a `resource` URI into a ResourceTarget. Best-effort: an unparseable
 * URI is surfaced as `unknown` rather than failing the authorization request,
 * so a malformed-but-harmless parameter can never block consent.
 *
 * Mapping follows the routing surface (see AGENTS.md):
 * - `/` or `/mcp` (the aggregate endpoint) -> `all`
 * - `/mcp/$smart` (smart routing) -> `smart`
 * - `/mcp/{name}` -> `target` (caller may resolve to `server`/`group`)
 * - anything else -> `unknown`
 */
export function parseResourceTarget(raw: string): ResourceTarget {
  let pathname = '';
  try {
    pathname = new URL(raw).pathname;
  } catch {
    pathname = raw;
  }

  // Strip trailing slashes without a regex: `/\/+$/` is quadratic on a long
  // run of slashes followed by a non-slash (user-controlled `resource`), i.e.
  // an unauthenticated ReDoS on GET /oauth/authorize (CWE-1333).
  let clean = pathname;
  while (clean.endsWith('/')) clean = clean.slice(0, -1);

  if (!clean || clean === '/mcp') {
    return { raw, path: clean, kind: 'all' };
  }

  if (clean === '/mcp/$smart') {
    return { raw, path: clean, kind: 'smart' };
  }

  const mcpMatch = clean.match(/^\/mcp\/([^/]+)$/);
  if (mcpMatch) {
    let name = mcpMatch[1];
    try {
      name = decodeURIComponent(name);
    } catch {
      // Leave the raw name as-is if it is not valid percent-encoding.
    }
    return { raw, path: clean, kind: 'target', name };
  }

  return { raw, path: clean, kind: 'unknown' };
}
