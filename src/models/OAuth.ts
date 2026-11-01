import { resolveUserSession } from '../utils/userSession.js';
import crypto from 'crypto';
import { getOAuthClientDao, getOAuthTokenDao, getSystemConfigDao } from '../dao/index.js';
import { IOAuthClient, IOAuthAuthorizationCode, IOAuthToken } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { LessThanOrEqual, MoreThan } from 'typeorm';
import { getAppDataSource } from '../db/connection.js';
import { OAuthState } from '../db/entities/OAuthState.js';
import { isReplicaMode } from '../utils/replicaMode.js';

const stateRepository = () => getAppDataSource().getRepository<OAuthState>('oauth_state');
const tokenHash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

// In-memory storage for authorization codes (short-lived, no persistence needed)
const authorizationCodes = new Map<string, IOAuthAuthorizationCode>();

// In-memory registration access tokens (RFC 7591 §3.2). Expiry is enforced
// lazily on verification; cleanupExpired() sweeps entries that are never used
// again so expired tokens do not accumulate for the lifetime of the process.
const registrationTokens = new Map<string, { clientId: string; expiresAt: Date }>();

const REGISTRATION_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Default idle TTL for dynamically-registered clients (see oauthServerDefaults).
const DEFAULT_DYNAMIC_CLIENT_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 days

/**
 * Get all OAuth clients from configuration
 */
export const getOAuthClients = async (): Promise<IOAuthClient[]> => {
  const clientDao = getOAuthClientDao();
  return clientDao.findAll();
};

/**
 * Find OAuth client by client ID
 */
export const findOAuthClientById = async (clientId: string): Promise<IOAuthClient | undefined> => {
  const clientDao = getOAuthClientDao();
  const client = await clientDao.findByClientId(clientId);
  return client || undefined;
};

/**
 * Create a new OAuth client
 */
export const createOAuthClient = async (client: IOAuthClient): Promise<IOAuthClient> => {
  const clientDao = getOAuthClientDao();

  // Check if client already exists
  const existing = await clientDao.findByClientId(client.clientId);
  if (existing) {
    throw new Error(`OAuth client with ID ${client.clientId} already exists`);
  }

  return clientDao.create(client);
};

/**
 * Update an existing OAuth client
 */
export const updateOAuthClient = async (
  clientId: string,
  updates: Partial<IOAuthClient>,
): Promise<IOAuthClient | null> => {
  const clientDao = getOAuthClientDao();
  return clientDao.update(clientId, updates);
};

/**
 * Delete an OAuth client
 */
export const deleteOAuthClient = async (clientId: string): Promise<boolean> => {
  const clientDao = getOAuthClientDao();
  return clientDao.delete(clientId);
};

/**
 * Generate a registration access token for a dynamically-registered client
 * (RFC 7591 §3.2). The token is stored in memory and expires after `ttlMs`.
 */
export const createRegistrationToken = async (
  clientId: string,
  ttlMs: number = REGISTRATION_TOKEN_TTL_MS,
): Promise<string> => {
  const token = crypto.randomBytes(32).toString('hex');
  if (isReplicaMode()) {
    await stateRepository().insert({
      tokenHash: tokenHash(token), kind: 'registration', clientId, payload: {},
      expiresAt: new Date(Date.now() + ttlMs),
    });
    return token;
  }
  registrationTokens.set(token, {
    clientId,
    expiresAt: new Date(Date.now() + ttlMs),
  });
  return token;
};

/**
 * Verify a registration access token. Returns the client ID it was issued to,
 * or null if the token is unknown or expired (expired tokens are removed).
 */
export const verifyRegistrationToken = async (token: string): Promise<string | null> => {
  if (isReplicaMode()) {
    const row = await stateRepository().findOneBy({
      tokenHash: tokenHash(token), kind: 'registration', expiresAt: MoreThan(new Date()),
    });
    return row?.clientId ?? null;
  }
  const data = registrationTokens.get(token);
  if (!data) {
    return null;
  }

  if (new Date() > data.expiresAt) {
    registrationTokens.delete(token);
    return null;
  }

  return data.clientId;
};

/**
 * Delete a registration access token (e.g. when the client registration is deleted)
 */
export const deleteRegistrationToken = async (token: string): Promise<void> => {
  if (isReplicaMode()) {
    await stateRepository().delete({ tokenHash: tokenHash(token), kind: 'registration' });
    return;
  }
  registrationTokens.delete(token);
};

/**
 * Number of registration access tokens currently held in memory (for diagnostics/tests)
 */
export const countRegistrationTokens = (): number => registrationTokens.size;

/**
 * Generate a secure random token
 */
const generateToken = (length: number = 32): string => {
  return crypto.randomBytes(length).toString('hex');
};

/**
 * Save authorization code
 */
export const saveAuthorizationCode = async (
  code: Omit<IOAuthAuthorizationCode, 'code' | 'expiresAt'>,
  expiresIn: number = 300,
): Promise<string> => {
  const authCode = generateToken();
  const expiresAt = new Date(Date.now() + expiresIn * 1000);
  if (isReplicaMode()) {
    await stateRepository().insert({
      tokenHash: tokenHash(authCode), kind: 'authorization_code',
      clientId: code.clientId, username: code.username, payload: code, expiresAt,
    });
    return authCode;
  }

  authorizationCodes.set(authCode, {
    code: authCode,
    expiresAt,
    ...code,
  });

  return authCode;
};

/**
 * Get authorization code
 */
export const getAuthorizationCode = async (code: string): Promise<IOAuthAuthorizationCode | undefined> => {
  if (isReplicaMode()) {
    const row = await stateRepository().findOneBy({
      tokenHash: tokenHash(code), kind: 'authorization_code', expiresAt: MoreThan(new Date()),
    });
    return row ? { ...row.payload, code, expiresAt: row.expiresAt } as IOAuthAuthorizationCode : undefined;
  }
  const authCode = authorizationCodes.get(code);
  if (!authCode) {
    return undefined;
  }

  // Check if expired
  if (authCode.expiresAt < new Date()) {
    authorizationCodes.delete(code);
    return undefined;
  }

  return authCode;
};

/**
 * Revoke authorization code
 */
export const revokeAuthorizationCode = async (code: string): Promise<boolean> => {
  if (isReplicaMode()) {
    const result = await stateRepository().delete({
      tokenHash: tokenHash(code), kind: 'authorization_code', expiresAt: MoreThan(new Date()),
    });
    return result.affected === 1;
  }
  return authorizationCodes.delete(code);
};

/**
 * Save access token and optionally refresh token
 */
export const saveToken = async (
  tokenData: Omit<IOAuthToken, 'accessToken' | 'accessTokenExpiresAt'>,
  accessTokenLifetime: number = 3600,
  refreshTokenLifetime?: number,
): Promise<IOAuthToken> => {
  const accessToken = generateToken();
  const accessTokenExpiresAt = new Date(Date.now() + accessTokenLifetime * 1000);

  let refreshToken: string | undefined;
  let refreshTokenExpiresAt: Date | undefined;

  if (refreshTokenLifetime) {
    refreshToken = generateToken();
    refreshTokenExpiresAt = new Date(Date.now() + refreshTokenLifetime * 1000);
  }

  const token: IOAuthToken = {
    accessToken,
    accessTokenExpiresAt,
    refreshToken,
    refreshTokenExpiresAt,
    ...tokenData,
  };

  await getOAuthTokenDao().create(token);

  return token;
};

/**
 * Get token by access token or refresh token
 */
export const getToken = async (token: string): Promise<IOAuthToken | undefined> => {
  // Read through the DAO so revocation on another instance takes effect immediately.
  const tokenDao = getOAuthTokenDao();
  const tokenData =
    (await tokenDao.findByAccessToken(token)) || (await tokenDao.findByRefreshToken(token));

  if (!tokenData) {
    return undefined;
  }

  // Check if access token is expired
  if (tokenData.accessToken === token && tokenData.accessTokenExpiresAt < new Date()) {
    return undefined;
  }

  // Check if refresh token is expired
  if (
    tokenData.refreshToken === token &&
    tokenData.refreshTokenExpiresAt &&
    tokenData.refreshTokenExpiresAt < new Date()
  ) {
    return undefined;
  }

  return (await resolveUserSession(tokenData)) ? tokenData : undefined;
};

/**
 * Revoke token (both access and refresh tokens)
 */
export const revokeToken = async (token: string): Promise<void> => {
  await getOAuthTokenDao().revokeToken(token);
};

/** Revoke the user's persisted tokens and pending in-process authorization codes. */
export const revokeUserTokens = async (username: string): Promise<void> => {
  if (isReplicaMode()) await stateRepository().delete({ username });
  for (const [code, authorization] of authorizationCodes) {
    if (authorization.username === username) authorizationCodes.delete(code);
  }
  await getOAuthTokenDao().revokeUserTokens(username);
};

/**
 * Clean up expired codes and tokens (should be called periodically)
 */
export const cleanupExpired = async (): Promise<void> => {
  const now = new Date();
  if (isReplicaMode()) await stateRepository().delete({ expiresAt: LessThanOrEqual(now) });

  // Clean up expired authorization codes
  for (const [code, authCode] of authorizationCodes.entries()) {
    if (authCode.expiresAt < now) {
      authorizationCodes.delete(code);
    }
  }

  // Clean up expired tokens from DAO
  try {
    const tokenDao = getOAuthTokenDao();
    await tokenDao.cleanupExpired();
  } catch (error) {
    logger.error('Failed to cleanup persisted OAuth tokens:', error);
  }

  // Sweep expired registration access tokens that were never verified again
  for (const [token, data] of registrationTokens.entries()) {
    if (data.expiresAt < now) {
      registrationTokens.delete(token);
    }
  }

  await cleanupIdleDynamicClients(now);
};

/**
 * Reap dynamically-registered OAuth clients that are idle: older than the
 * configured `oauthServer.dynamicRegistration.clientTtl` with no live token and
 * no in-progress authorization flow. Reclaimed clients must register again.
 * Legacy records without `clientIdIssuedAt` are never treated as expired.
 * A `clientTtl` of 0 disables cleanup entirely.
 */
const cleanupIdleDynamicClients = async (now: Date): Promise<void> => {
  try {
    // Client IDs that are still in use: they have a live token or an unexpired
    // authorization code (an in-progress authorization flow).
    const liveClientIds = new Set<string>();
    if (isReplicaMode()) {
      const pending = await stateRepository().findBy({ kind: 'authorization_code', expiresAt: MoreThan(now) });
      for (const state of pending) liveClientIds.add(state.clientId);
    }

    for (const [, authCode] of authorizationCodes.entries()) {
      liveClientIds.add(authCode.clientId);
    }
    const persistedTokens = await getOAuthTokenDao().findAll();
    for (const token of persistedTokens) {
      liveClientIds.add(token.clientId);
    }

    // Read the configured idle-client TTL. 0 disables cleanup entirely.
    const systemConfig = await getSystemConfigDao().get();
    const clientTtl = systemConfig?.oauthServer?.dynamicRegistration?.clientTtl;
    if (clientTtl !== undefined && clientTtl <= 0) {
      return;
    }
    const ttlSeconds = clientTtl ?? DEFAULT_DYNAMIC_CLIENT_TTL_SECONDS;

    const clientDao = getOAuthClientDao();
    const dynamicClients = await clientDao.findByOwner('dynamic-registration');
    const cutoff = Math.floor(now.getTime() / 1000) - ttlSeconds;

    const stale = dynamicClients.filter(
      (client) =>
        typeof client.clientIdIssuedAt === 'number' &&
        client.clientIdIssuedAt < cutoff &&
        !liveClientIds.has(client.clientId),
    );

    for (const client of stale) {
      await clientDao.delete(client.clientId);
    }
    if (stale.length > 0) {
      logger.log(`Reaped ${stale.length} idle dynamically-registered OAuth client(s)`);
    }
  } catch (error) {
    logger.error('Failed to cleanup idle dynamically-registered OAuth clients:', error);
  }
};

// Run cleanup every 5 minutes in production
let cleanupIntervalId: NodeJS.Timeout | null = null;
if (process.env.NODE_ENV !== 'test') {
  cleanupIntervalId = setInterval(
    () => {
      cleanupExpired().catch(logger.error);
    },
    5 * 60 * 1000,
  );
  // Allow the interval to not keep the process alive
  cleanupIntervalId.unref();
}

/**
 * Stop the cleanup interval (for graceful shutdown)
 */
export const stopCleanup = (): void => {
  if (cleanupIntervalId) {
    clearInterval(cleanupIntervalId);
    cleanupIntervalId = null;
  }
};
