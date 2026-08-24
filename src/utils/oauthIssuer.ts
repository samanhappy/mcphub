/**
 * RFC 9207 (OAuth 2.0 Authorization Server Issuer Identification) helpers.
 *
 * When MCPHub acts as an OAuth *client* toward upstream MCP servers, the
 * authorization response redirect may carry an `iss` parameter. Per RFC 9207 /
 * SEP-2468 the client must validate it against the issuer it sent the
 * authorization request to before redeeming the code — this closes the
 * authorization-server mix-up attack where a malicious AS's code is replayed
 * at another AS's token endpoint under the same redirect URI.
 */

export interface AuthorizationResponseIssContext {
  /** `iss` query parameter from the authorization response (absent on legacy servers). */
  iss?: string;
  /** The authorization URL MCPHub originally redirected the user to. */
  authorizationUrl?: string;
  /** Explicitly configured issuer for the upstream server, if any. */
  configuredIssuer?: string;
}

export type IssValidationResult =
  | { valid: true; checked: false }
  | { valid: true; checked: true }
  | { valid: false; checked: true; reason: string };

const originOf = (url: string | undefined): string | undefined => {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
};

/**
 * Expected `iss` values for an upstream authorization flow: the explicitly
 * configured issuer plus the origin of the authorization endpoint actually used.
 */
export const expectedIssValues = (ctx: AuthorizationResponseIssContext): string[] => {
  const candidates = [ctx.configuredIssuer, originOf(ctx.authorizationUrl)];
  return [...new Set(candidates.filter((c): c is string => Boolean(c)))];
};

/**
 * Validate the `iss` authorization-response parameter.
 *
 * - Absent `iss` → valid but unchecked (older servers do not send it).
 * - Present `iss` with nothing to compare against → unchecked fail-safe pass,
 *   since we cannot establish what the client expected (no mix-up possible
 *   when only one AS is involved in a flow keyed by our own state parameter).
 * - Present `iss` → must exactly match one of the expected values.
 */
export const validateAuthorizationIss = (
  ctx: AuthorizationResponseIssContext,
): IssValidationResult => {
  const { iss } = ctx;

  if (!iss) {
    return { valid: true, checked: false };
  }

  const expected = expectedIssValues(ctx);
  if (expected.length === 0) {
    return { valid: true, checked: false };
  }

  if (expected.includes(iss)) {
    return { valid: true, checked: true };
  }

  return {
    valid: false,
    checked: true,
    reason: 'iss parameter does not match the expected authorization server issuer',
  };
};
