/**
 * Resolve the CORS origin policy for incoming requests.
 *
 * By default only same-host origins (and origins listed in the
 * `ALLOWED_ORIGINS` environment variable) are reflected. Non-browser
 * requests without an `Origin` header receive no CORS headers, which keeps
 * MCP clients and server-to-server traffic working unchanged.
 */

const parseAllowedOrigins = (raw: string | undefined): string[] =>
  (raw || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

const extractHostFromOrigin = (origin: string): string | null => {
  try {
    return new URL(origin).host;
  } catch {
    return null;
  }
};

/**
 * Returns the value to pass back to the `cors` middleware callback:
 * - a string: reflect this exact origin (allowed)
 * - `false`: do not emit CORS headers (denied or not applicable)
 */
export const resolveCorsOrigin = (
  requestOrigin: string | undefined,
  requestHost: string | undefined,
  allowedOriginsEnv: string | undefined,
): string | false => {
  if (!requestOrigin) {
    return false;
  }

  const allowed = parseAllowedOrigins(allowedOriginsEnv);
  if (allowed.includes(requestOrigin)) {
    return requestOrigin;
  }

  // Allow same-host requests regardless of scheme/port mismatch behind
  // reverse proxies, as long as the effective host matches.
  const originHost = extractHostFromOrigin(requestOrigin);
  if (originHost && requestHost && originHost === requestHost) {
    return requestOrigin;
  }

  return false;
};
