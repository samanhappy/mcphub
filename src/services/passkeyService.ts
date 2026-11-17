import crypto from 'node:crypto';
import type { Request } from 'express';
import jwt from 'jsonwebtoken';
import { LessThanOrEqual } from 'typeorm';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import { JWT_SECRET } from '../config/jwt.js';
import { getPasskeyDao } from '../dao/index.js';
import { getAppDataSource } from '../db/connection.js';
import type { OAuthState } from '../db/entities/OAuthState.js';
import { findUserByUsername } from '../models/User.js';
import type { IUser, UserPasskey } from '../types/index.js';
import { isReplicaMode } from '../utils/replicaMode.js';
import { safeCompare } from '../utils/safeCompare.js';
import { getUserSessionVersion } from '../utils/userSession.js';
import { isForwardAuthUser } from './forwardAuthService.js';
import { logger } from '../utils/logger.js';

export const PASSKEY_RP_NAME = 'MCPHub';
export const MAX_PASSKEYS_PER_USER = 20;
export const MAX_PASSKEY_NAME_LENGTH = 64;
const CHALLENGE_TTL_SECONDS = 5 * 60;
const CHALLENGE_AUDIENCE = 'mcphub:passkey';

export type PasskeyCeremony = 'registration' | 'authentication';

/** The WebAuthn relying party a ceremony runs against. */
export interface PasskeyRelyingParty {
  rpId: string;
  origin: string;
}

interface ChallengeClaims extends PasskeyRelyingParty {
  ceremony: PasskeyCeremony;
  challenge: string;
  username?: string;
  userHandle?: string;
}

/**
 * Derives the relying party from the browser origin of the request.
 *
 * The browser only lets a page use credentials scoped to its own host, and every
 * stored passkey records the RP ID it was registered under, so a credential can
 * never be asserted for a different host than the one that created it.
 */
export const resolveRelyingParty = (req: Request): PasskeyRelyingParty | null => {
  const originHeader = req.get('origin');
  const candidate =
    originHeader && originHeader !== 'null'
      ? originHeader
      : req.get('host')
        ? `${req.protocol}://${req.get('host')}`
        : undefined;
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !url.hostname) return null;
    return { rpId: url.hostname, origin: url.origin };
  } catch {
    return null;
  }
};

// Separate key so a challenge token can never be confused with a dashboard session token.
const challengeKey = (): Buffer =>
  crypto.createHmac('sha256', JWT_SECRET).update('mcphub:passkey-challenge').digest();

// Challenges already spent in this process, kept until their token would expire.
const consumedChallenges = new Map<string, number>();

const markConsumedLocally = (challenge: string, expiresAtMs: number): boolean => {
  const now = Date.now();
  for (const [key, expiry] of consumedChallenges) {
    if (expiry <= now) consumedChallenges.delete(key);
  }
  if (consumedChallenges.has(challenge)) return false;
  consumedChallenges.set(challenge, expiresAtMs);
  return true;
};

// Replicas share the spent-challenge record through the OAuth state table, whose
// primary key makes the first insert win, so a response is accepted once overall.
const markConsumedForReplicas = async (
  challenge: string,
  expiresAtMs: number,
): Promise<boolean> => {
  const states = getAppDataSource().getRepository<OAuthState>('oauth_state');
  await states.delete({ kind: 'passkey_challenge', expiresAt: LessThanOrEqual(new Date()) });
  try {
    await states.insert({
      tokenHash: crypto.createHash('sha256').update(`passkey:${challenge}`).digest('hex'),
      kind: 'passkey_challenge',
      clientId: 'mcphub-passkey',
      payload: {},
      expiresAt: new Date(expiresAtMs),
    });
    return true;
  } catch (error) {
    logger.warn('Refused a passkey challenge that was already used', error);
    return false;
  }
};

const issueChallengeToken = (claims: ChallengeClaims): string =>
  jwt.sign(claims, challengeKey(), {
    algorithm: 'HS256',
    audience: CHALLENGE_AUDIENCE,
    expiresIn: CHALLENGE_TTL_SECONDS,
  });

/**
 * Verifies a challenge token and spends it. A token is accepted once, for the
 * ceremony it was issued for, within five minutes.
 */
export const consumeChallengeToken = async (
  token: unknown,
  ceremony: PasskeyCeremony,
): Promise<ChallengeClaims | null> => {
  if (typeof token !== 'string' || !token) return null;
  let payload: string | jwt.JwtPayload;
  try {
    payload = jwt.verify(token, challengeKey(), {
      algorithms: ['HS256'],
      audience: CHALLENGE_AUDIENCE,
    });
  } catch {
    return null;
  }
  if (typeof payload !== 'object' || payload.ceremony !== ceremony) return null;
  const { challenge, rpId, origin, exp } = payload;
  if (typeof challenge !== 'string' || typeof rpId !== 'string' || typeof origin !== 'string') {
    return null;
  }
  const expiresAtMs = (exp ?? 0) * 1000;
  const fresh = isReplicaMode()
    ? await markConsumedForReplicas(challenge, expiresAtMs)
    : markConsumedLocally(challenge, expiresAtMs);
  return fresh ? (payload as unknown as ChallengeClaims) : null;
};

/** Trims a user-supplied label and removes control characters. */
export const normalizePasskeyName = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  return Array.from(value.replace(/\p{Cc}/gu, '').trim())
    .slice(0, MAX_PASSKEY_NAME_LENGTH)
    .join('');
};

export const toPasskeySummary = (passkey: UserPasskey) => ({
  id: passkey.id,
  name: passkey.name,
  rpId: passkey.rpId,
  createdAt: passkey.createdAt,
  lastUsedAt: passkey.lastUsedAt ?? null,
  deviceType: passkey.deviceType,
  backedUp: passkey.backedUp,
});

/** True while the passkey's account still has the password it was registered under. */
const isPasskeyCurrent = (passkey: UserPasskey, user: IUser): boolean =>
  Boolean(passkey.sessionVersion) &&
  safeCompare(passkey.sessionVersion, getUserSessionVersion(user));

/**
 * The user's usable passkeys. Passkeys registered before the latest password
 * change, or by an earlier account with the same username, are removed.
 */
export const listActivePasskeys = async (user: IUser): Promise<UserPasskey[]> => {
  const dao = getPasskeyDao();
  const passkeys = await dao.findByUsername(user.username);
  const active: UserPasskey[] = [];
  for (const passkey of passkeys) {
    if (isPasskeyCurrent(passkey, user)) active.push(passkey);
    else await dao.delete(passkey.id);
  }
  return active;
};

export const startPasskeyRegistration = async (
  user: IUser,
  rp: PasskeyRelyingParty,
): Promise<
  | { status: 'ok'; options: PublicKeyCredentialCreationOptionsJSON; challengeToken: string }
  | { status: 'limit' }
> => {
  const existing = await listActivePasskeys(user);
  if (existing.length >= MAX_PASSKEYS_PER_USER) return { status: 'limit' };
  // One stable user handle per account lets an authenticator replace its own
  // credential for this account instead of keeping a duplicate.
  const userHandle =
    existing[0]?.userHandle ?? isoBase64URL.fromBuffer(new Uint8Array(crypto.randomBytes(32)));
  const options = await generateRegistrationOptions({
    rpName: PASSKEY_RP_NAME,
    rpID: rp.rpId,
    userName: user.username,
    userDisplayName: user.username,
    userID: isoBase64URL.toBuffer(userHandle),
    attestationType: 'none',
    excludeCredentials: existing
      .filter((passkey) => passkey.rpId === rp.rpId)
      .map((passkey) => ({
        id: passkey.credentialId,
        transports: passkey.transports ?? undefined,
      })),
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
  });
  const challengeToken = issueChallengeToken({
    ceremony: 'registration',
    challenge: options.challenge,
    rpId: rp.rpId,
    origin: rp.origin,
    username: user.username,
    userHandle,
  });
  return { status: 'ok', options, challengeToken };
};

export const finishPasskeyRegistration = async (
  user: IUser,
  challengeToken: unknown,
  response: RegistrationResponseJSON,
  name: string,
): Promise<
  | { status: 'ok'; passkey: UserPasskey }
  | { status: 'invalid_challenge' | 'failed' | 'duplicate' | 'limit' }
> => {
  const claims = await consumeChallengeToken(challengeToken, 'registration');
  if (!claims || claims.username !== user.username || !claims.userHandle) {
    return { status: 'invalid_challenge' };
  }

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: claims.challenge,
      expectedOrigin: claims.origin,
      expectedRPID: claims.rpId,
      requireUserVerification: true,
    });
  } catch {
    return { status: 'failed' };
  }
  if (!verification.verified) return { status: 'failed' };

  const dao = getPasskeyDao();
  const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
  if (await dao.findByCredentialId(credential.id)) return { status: 'duplicate' };
  if ((await listActivePasskeys(user)).length >= MAX_PASSKEYS_PER_USER) {
    return { status: 'limit' };
  }

  const passkey: UserPasskey = {
    id: crypto.randomUUID(),
    username: user.username,
    credentialId: credential.id,
    publicKey: isoBase64URL.fromBuffer(credential.publicKey),
    counter: credential.counter,
    transports: credential.transports ?? null,
    userHandle: claims.userHandle,
    rpId: claims.rpId,
    sessionVersion: getUserSessionVersion(user),
    name: name || 'Passkey',
    deviceType: credentialDeviceType,
    backedUp: credentialBackedUp,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
  };
  try {
    await dao.save(passkey);
  } catch (error) {
    // A concurrent registration of the same credential won the unique index
    if (await dao.findByCredentialId(credential.id)) return { status: 'duplicate' };
    throw error;
  }
  return { status: 'ok', passkey };
};

export const startPasskeyAuthentication = async (
  rp: PasskeyRelyingParty,
): Promise<{ options: PublicKeyCredentialRequestOptionsJSON; challengeToken: string }> => {
  // No allowCredentials: the browser offers the discoverable credentials it holds
  // for this RP, so the user does not type a username first.
  const options = await generateAuthenticationOptions({
    rpID: rp.rpId,
    userVerification: 'required',
  });
  const challengeToken = issueChallengeToken({
    ceremony: 'authentication',
    challenge: options.challenge,
    rpId: rp.rpId,
    origin: rp.origin,
  });
  return { options, challengeToken };
};

/**
 * Verifies a sign-in assertion and returns the account it signs in to, or null
 * for any failure: an unknown, removed or outdated passkey, an account that no
 * longer exists or belongs to a forward-auth identity, or an invalid assertion.
 */
export const finishPasskeyAuthentication = async (
  challengeToken: unknown,
  response: AuthenticationResponseJSON,
): Promise<IUser | null> => {
  const claims = await consumeChallengeToken(challengeToken, 'authentication');
  if (!claims || typeof response?.id !== 'string') return null;

  const dao = getPasskeyDao();
  const passkey = await dao.findByCredentialId(response.id);
  if (!passkey || passkey.rpId !== claims.rpId) return null;
  const userHandle = response.response?.userHandle;
  if (userHandle && userHandle !== passkey.userHandle) return null;
  const user = await findUserByUsername(passkey.username);
  if (!user || isForwardAuthUser(user) || !isPasskeyCurrent(passkey, user)) return null;

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: claims.challenge,
      expectedOrigin: claims.origin,
      expectedRPID: claims.rpId,
      credential: {
        id: passkey.credentialId,
        publicKey: isoBase64URL.toBuffer(passkey.publicKey),
        counter: passkey.counter,
        transports: passkey.transports ?? undefined,
      },
      requireUserVerification: true,
    });
  } catch {
    return null;
  }
  if (!verification.verified) return null;

  // Update-only and counter-checked in the store: a passkey removed while this
  // sign-in ran stays removed, and a concurrent sign-in that already stored a
  // higher counter wins, so the counter never moves backwards.
  const recorded = await dao.recordUse(passkey.id, {
    counter: verification.authenticationInfo.newCounter,
    backedUp: verification.authenticationInfo.credentialBackedUp,
    lastUsedAt: new Date().toISOString(),
  });
  if (!recorded) {
    logger.warn(
      `Passkey sign-in refused for user "${user.username}": the passkey was removed or its signature counter did not advance`,
    );
    return null;
  }
  return user;
};
