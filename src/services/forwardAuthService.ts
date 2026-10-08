import crypto from 'crypto';
import { createRemoteJWKSet, decodeJwt, errors as joseErrors, jwtVerify } from 'jose';
import type { JWTPayload, JWTVerifyGetKey } from 'jose';
import {
  createUser,
  findUserByEmail,
  findUserBySsoUserId,
  findUserByUsername,
} from '../models/User.js';
import { ForwardAuthConfig, ForwardAuthMode, IUser, SystemConfig } from '../types/index.js';
import {
  normalizeOptionalString,
  normalizeStringArray,
  resolveBooleanSetting,
  resolveStringArraySetting,
  resolveStringSetting,
} from '../utils/settingResolvers.js';
import { logger } from '../utils/logger.js';

/**
 * Forward auth trusts an identity asserted by an upstream gateway as a JWT and
 * verifies it against the identity provider's JWKS.
 *
 * Boundaries (agreed in issue #1207):
 * - External identities are kept separate from Better Auth identities: they are
 *   stored in `ssoUserId` under the `forward-auth:` namespace, which Better Auth
 *   never produces.
 * - Existing accounts are never linked by username or email. An identity is
 *   either already bound to a forward-auth user or gets a new non-admin user.
 * - A token from the configured issuer that fails verification is rejected and
 *   never falls back to another authentication method.
 */

export const FORWARD_AUTH_SSO_PREFIX = 'forward-auth:';

const SUPPORTED_MODES: ForwardAuthMode[] = ['jwks'];
const DEFAULT_ALGORITHMS = ['RS256', 'ES256'];
const DEFAULT_USERNAME_CLAIM = 'preferred_username';
const DEFAULT_EMAIL_CLAIM = 'email';
const CLOCK_TOLERANCE_SECONDS = 30;
const MAX_USERNAME_LENGTH = 255;

// Only asymmetric algorithms are meaningful with a remote JWKS. HS* and `none`
// are never accepted, whatever the configuration says.
const ASYMMETRIC_ALGORITHMS = new Set([
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
]);

export interface ForwardAuthRuntimeConfig {
  enabled: boolean;
  mode: ForwardAuthMode;
  jwksUri?: string;
  issuer?: string;
  audience: string[];
  algorithms: string[];
  usernameClaim: string;
  emailClaim: string;
  autoCreate: boolean;
}

export type ForwardAuthResult =
  | { status: 'skipped' }
  | { status: 'rejected'; reason: string }
  | { status: 'authenticated'; user: IUser };

const reportedConfigErrors = new Set<string>();

const reportConfigError = (message: string): void => {
  if (reportedConfigErrors.has(message)) {
    return;
  }
  reportedConfigErrors.add(message);
  logger.error(`Forward auth disabled: ${message}`);
};

const isAllowedJwksUri = (uri: string): boolean => {
  try {
    const url = new URL(uri);
    if (url.protocol === 'https:') {
      return true;
    }
    return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
};

// Audience names may contain spaces (e.g. "My API"), so a plain string is split
// on commas only. Arrays and JSON-array strings use the shared parser.
const parseAudience = (value: unknown): string[] => {
  const text = normalizeOptionalString(value);
  if (text && !text.startsWith('[')) {
    return text
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  return normalizeStringArray(value);
};

const resolveAudienceSetting = (envValue: string | undefined, settingsValue: unknown): string[] => {
  const envAudience = parseAudience(envValue);
  return envAudience.length > 0 ? envAudience : parseAudience(settingsValue);
};

export const resolveForwardAuthRuntimeConfig = (
  systemConfig?: SystemConfig | null,
): ForwardAuthRuntimeConfig => {
  const settings: ForwardAuthConfig = systemConfig?.auth?.forwardAuth || {};
  const jwksSettings = settings.jwks || {};

  const enabledSetting = resolveBooleanSetting(
    process.env.FORWARD_AUTH_ENABLED,
    settings.enabled,
    false,
  );
  const mode = resolveStringSetting(process.env.FORWARD_AUTH_MODE, settings.mode, 'jwks');
  const jwksUri = resolveStringSetting(process.env.FORWARD_AUTH_JWKS_URI, jwksSettings.uri);
  const issuer = resolveStringSetting(process.env.FORWARD_AUTH_ISSUER, jwksSettings.issuer);
  const audience = resolveAudienceSetting(process.env.FORWARD_AUTH_AUDIENCE, jwksSettings.audience);
  const configuredAlgorithms = resolveStringArraySetting(
    process.env.FORWARD_AUTH_ALGORITHMS,
    jwksSettings.algorithms,
    DEFAULT_ALGORITHMS,
  );
  const algorithms = configuredAlgorithms.filter((alg) => ASYMMETRIC_ALGORITHMS.has(alg));
  const usernameClaim =
    resolveStringSetting(
      process.env.FORWARD_AUTH_USERNAME_CLAIM,
      settings.usernameClaim,
      DEFAULT_USERNAME_CLAIM,
    ) || DEFAULT_USERNAME_CLAIM;
  const emailClaim =
    resolveStringSetting(
      process.env.FORWARD_AUTH_EMAIL_CLAIM,
      settings.emailClaim,
      DEFAULT_EMAIL_CLAIM,
    ) || DEFAULT_EMAIL_CLAIM;
  const autoCreate = resolveBooleanSetting(
    process.env.FORWARD_AUTH_AUTO_CREATE,
    settings.autoCreate,
    true,
  );

  let enabled = enabledSetting;
  if (enabled) {
    const rejectedAlgorithms = configuredAlgorithms.filter(
      (alg) => !ASYMMETRIC_ALGORITHMS.has(alg),
    );
    if (!SUPPORTED_MODES.includes(mode as ForwardAuthMode)) {
      reportConfigError(`unsupported mode "${mode}"; only "jwks" is supported`);
      enabled = false;
    } else if (!jwksUri || !isAllowedJwksUri(jwksUri)) {
      reportConfigError('jwks.uri must be an https URL (http is allowed only for localhost)');
      enabled = false;
    } else if (!issuer) {
      reportConfigError('jwks.issuer is required');
      enabled = false;
    } else if (audience.length === 0) {
      reportConfigError('jwks.audience is required');
      enabled = false;
    } else if (rejectedAlgorithms.length > 0 || algorithms.length === 0) {
      reportConfigError(
        `jwks.algorithms must list only asymmetric algorithms (${[...ASYMMETRIC_ALGORITHMS].join(', ')})`,
      );
      enabled = false;
    }
  }

  return {
    enabled,
    mode: 'jwks',
    jwksUri,
    issuer,
    audience,
    algorithms,
    usernameClaim,
    emailClaim,
    autoCreate,
  };
};

const jwksCache = new Map<string, JWTVerifyGetKey>();

// createRemoteJWKSet caches keys and refetches on an unknown `kid`, which is
// what handles key rotation at the identity provider.
const getRemoteJwks = (uri: string): JWTVerifyGetKey => {
  let jwks = jwksCache.get(uri);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(uri));
    jwksCache.set(uri, jwks);
  }
  return jwks;
};

/** Test hook: drop cached JWKS clients and once-only config error reports. */
export const resetForwardAuthStateForTests = (): void => {
  jwksCache.clear();
  reportedConfigErrors.clear();
};

// Claims are used exactly as issued and never normalized. A missing, non-string
// or whitespace-only claim counts as absent.
const readStringClaim = (payload: JWTPayload, claim: string): string | undefined => {
  const value = payload[claim];
  return typeof value === 'string' && value.trim() ? value : undefined;
};

export const buildForwardAuthSsoUserId = (issuer: string, subject: string): string =>
  `${FORWARD_AUTH_SSO_PREFIX}${crypto
    .createHash('sha256')
    .update(`${issuer}\n${subject}`)
    .digest('hex')}`;

export const isForwardAuthUser = (user?: Pick<IUser, 'ssoUserId'> | null): boolean =>
  Boolean(user?.ssoUserId?.startsWith(FORWARD_AUTH_SSO_PREFIX));

const resolveForwardAuthUser = async (
  payload: JWTPayload,
  config: ForwardAuthRuntimeConfig,
): Promise<ForwardAuthResult> => {
  // `sub` is the identity key; normalizing it could merge distinct identities.
  const subject = readStringClaim(payload, 'sub');
  if (!subject || !config.issuer) {
    return { status: 'rejected', reason: 'token has no usable sub claim' };
  }

  const ssoUserId = buildForwardAuthSsoUserId(config.issuer, subject);
  const boundUser = await findUserBySsoUserId(ssoUserId);
  if (boundUser) {
    return { status: 'authenticated', user: boundUser };
  }

  if (!config.autoCreate) {
    return {
      status: 'rejected',
      reason: 'identity is not bound to a local user and autoCreate is disabled',
    };
  }

  const email = readStringClaim(payload, config.emailClaim);
  const username = readStringClaim(payload, config.usernameClaim) || email || subject;
  if (username.length > MAX_USERNAME_LENGTH) {
    return { status: 'rejected', reason: 'username claim is too long' };
  }

  // Never link an existing account by username or email, so a gateway identity
  // cannot take over a local, Better Auth or admin account.
  if (await findUserByUsername(username)) {
    return {
      status: 'rejected',
      reason: `username "${username}" already belongs to another account`,
    };
  }
  if (email && (await findUserByEmail(email))) {
    return { status: 'rejected', reason: 'email already belongs to another account' };
  }

  const createdUser = await createUser({
    username,
    password: crypto.randomUUID(),
    isAdmin: false,
    email,
    ssoUserId,
  });
  if (createdUser) {
    logger.info(`Forward auth created local user "${username}"`);
    return { status: 'authenticated', user: createdUser };
  }

  // A concurrent request for the same identity may have created the user first.
  const racedUser = await findUserBySsoUserId(ssoUserId);
  if (racedUser) {
    return { status: 'authenticated', user: racedUser };
  }
  return { status: 'rejected', reason: `could not create local user "${username}"` };
};

const describeVerificationError = (error: unknown): string => {
  if (error instanceof joseErrors.JWTExpired) return 'token expired';
  if (error instanceof joseErrors.JWTClaimValidationFailed) {
    return `claim "${error.claim}" ${error.reason}`;
  }
  if (error instanceof joseErrors.JOSEAlgNotAllowed) return 'algorithm not allowed';
  if (error instanceof joseErrors.JWKSNoMatchingKey) return 'no matching key in JWKS';
  if (error instanceof joseErrors.JWSSignatureVerificationFailed) return 'invalid signature';
  if (error instanceof joseErrors.JWKSTimeout) return 'JWKS request timed out';
  return error instanceof Error ? error.message : 'verification failed';
};

/**
 * Authenticate a bearer token as a forward-auth JWT.
 *
 * Returns `skipped` when forward auth is disabled or the token is not a JWT from
 * the configured issuer, so callers continue with their other methods. Returns
 * `rejected` for a token from the configured issuer that fails verification or
 * cannot be mapped to a user; callers must not fall back in that case.
 */
export const authenticateForwardAuthToken = async (
  token: string | null | undefined,
  systemConfig?: SystemConfig | null,
): Promise<ForwardAuthResult> => {
  if (!token) {
    return { status: 'skipped' };
  }

  const config = resolveForwardAuthRuntimeConfig(systemConfig);
  if (!config.enabled || !config.jwksUri || !config.issuer) {
    return { status: 'skipped' };
  }

  let unverifiedIssuer: string | undefined;
  try {
    unverifiedIssuer = decodeJwt(token).iss;
  } catch {
    return { status: 'skipped' };
  }
  if (unverifiedIssuer !== config.issuer) {
    return { status: 'skipped' };
  }

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, getRemoteJwks(config.jwksUri), {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: config.algorithms,
      requiredClaims: ['exp', 'sub'],
      clockTolerance: CLOCK_TOLERANCE_SECONDS,
    }));
  } catch (error) {
    const reason = describeVerificationError(error);
    logger.warn(`Forward auth rejected token: ${reason}`);
    return { status: 'rejected', reason };
  }

  try {
    const result = await resolveForwardAuthUser(payload, config);
    if (result.status === 'rejected') {
      logger.warn(`Forward auth rejected token: ${result.reason}`);
    }
    return result;
  } catch (error) {
    logger.error('Forward auth user resolution failed:', error);
    return { status: 'rejected', reason: 'user resolution failed' };
  }
};
