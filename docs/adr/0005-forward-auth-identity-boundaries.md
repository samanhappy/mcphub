# Forward auth verifies gateway JWTs and keeps external identities separate

Status: design agreed with the maintainer in #1207; JWKS mode implemented first.
Trusted-header mode may follow later.

## Decision

MCPHub can trust an identity asserted by an upstream gateway only as a JWT that
MCPHub verifies itself against the identity provider's JWKS
(`systemConfig.auth.forwardAuth`, `mode: "jwks"`). MCPHub stays the security
boundary; it never trusts an unverified header or claim. The same check guards
the dashboard API and the MCP transport routes.

## Boundaries

- **External identities are separate from Better Auth identities.** The identity
  is (`iss`, `sub`), stored in `ssoUserId` as `forward-auth:` plus a SHA-256 of
  the pair. Better Auth never produces that namespace, and the Better Auth
  resolver refuses to adopt a user that carries it.
- **Existing accounts are never linked by username or email.** An identity either
  matches a user already bound to it or gets a new non-admin user. If the
  username or email from the token already belongs to any account, including
  admin accounts, the request is rejected. Admin status comes only from the
  local user record.
- **No fallback for the configured issuer.** A token whose unverified `iss`
  equals the configured issuer is either authenticated by forward auth or
  rejected with 401. It is never retried as a bearer key, OAuth token, session or
  dashboard JWT. Tokens from other issuers, and non-JWT tokens, go through the
  existing methods unchanged.

## Verification rules

`iss`, `aud` and `exp` are always checked and `sub` is required. Only asymmetric
algorithms are accepted; listing `HS*` or `none` disables forward auth rather
than weakening it. The JWKS URI must be https (http only for localhost). Keys
are cached by `jose` and refetched on an unknown `kid`, which covers rotation.

## Consequences

Because accounts are never linked, `autoCreate: false` admits only identities
that were already bound, so it currently works as a stop switch for new users.
Binding an existing local account to an external identity would need an
explicit admin action, which is out of scope for the first version.
