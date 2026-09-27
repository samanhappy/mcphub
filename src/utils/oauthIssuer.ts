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
  /** Support advertised by the AS when this authorization flow started. */
  issRequired?: boolean;
  /** The authorization URL MCPHub originally redirected the user to. */
  authorizationUrl?: string;
  /** Discovered or explicitly configured issuer for this flow, if any. */
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
 * configured issuer, falling back to the authorization endpoint origin.
 */
export const expectedIssValues = (ctx: AuthorizationResponseIssContext): string[] => {
  const issuer = ctx.configuredIssuer || originOf(ctx.authorizationUrl);
  return issuer ? [issuer] : [];
};

/**
 * Validate the `iss` authorization-response parameter.
 *
 * Missing `iss` is allowed for servers known not to advertise RFC 9207 support.
 * Older pending flows without a support snapshot retain the strict policy.
 * A supplied issuer must match the complete expected issuer; the endpoint
 * origin is only a fallback when no issuer was discovered or configured.
 */
export const validateAuthorizationIss = (
  ctx: AuthorizationResponseIssContext,
): IssValidationResult => {
  const { iss } = ctx;

  if (iss === undefined) {
    const expected = expectedIssValues(ctx);
    if (ctx.issRequired === true || (ctx.issRequired === undefined && expected.length > 0)) {
      return {
        valid: false,
        checked: true,
        reason: 'iss parameter is missing from the authorization response',
      };
    }
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
