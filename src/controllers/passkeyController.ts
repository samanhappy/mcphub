import type { Request, Response } from 'express';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { getPasskeyDao } from '../dao/index.js';
import { findUserByUsername, verifyPassword } from '../models/User.js';
import { getBetterAuthRuntimeConfig } from '../services/betterAuthConfig.js';
import { isForwardAuthUser } from '../services/forwardAuthService.js';
import {
  finishPasskeyAuthentication,
  finishPasskeyRegistration,
  listActivePasskeys,
  normalizePasskeyName,
  resolveRelyingParty,
  startPasskeyAuthentication,
  startPasskeyRegistration,
  toPasskeySummary,
} from '../services/passkeyService.js';
import { getDataService } from '../services/services.js';
import type { IUser } from '../types/index.js';
import { logger } from '../utils/logger.js';
import { signDashboardToken } from '../utils/userSession.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const translate = (req: Request, key: string): string => {
  const t = (req as Request & { t?: (key: string) => string }).t;
  return t ? t(key) : key;
};

// `code` lets the dashboard tell a rejected passkey from other failures.
const fail = (req: Request, res: Response, status: number, key: string): void => {
  res.status(status).json({
    success: false,
    code: key.replace(/^api\.errors\./, ''),
    message: translate(req, key),
  });
};

const isCredentialResponse = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { id?: unknown; rawId?: unknown; response?: unknown; type?: unknown };
  return (
    typeof candidate.id === 'string' &&
    typeof candidate.rawId === 'string' &&
    candidate.type === 'public-key' &&
    Boolean(candidate.response) &&
    typeof candidate.response === 'object'
  );
};

/**
 * The stored local account behind a dashboard session, or null when the request
 * is not a personal session: bearer keys, forward-auth identities and the
 * skip-auth guest cannot own passkeys.
 */
const resolveSessionAccount = async (req: Request): Promise<IUser | null> => {
  const request = req as Request & {
    user?: { username?: string; credentialEligible?: boolean };
    bearerKey?: unknown;
    forwardAuthUser?: unknown;
  };
  const sessionUser = request.user;
  if (
    !sessionUser?.username ||
    request.bearerKey ||
    request.forwardAuthUser ||
    sessionUser.credentialEligible === false
  ) {
    return null;
  }
  const user = await findUserByUsername(sessionUser.username);
  return user && !isForwardAuthUser(user) ? user : null;
};

// Passkeys are a local-account credential, so the SSO-only policy that refuses
// password sign-in refuses them too.
const passkeysDisabled = async (): Promise<boolean> =>
  (await getBetterAuthRuntimeConfig()).disablePasswordLogin;

export const listMyPasskeys = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await resolveSessionAccount(req);
    if (!user) {
      fail(req, res, 403, 'api.errors.passkey_unavailable');
      return;
    }
    const passkeys = await listActivePasskeys(user);
    res.json({
      success: true,
      data: passkeys.map(toPasskeySummary),
      registrationAvailable: !(await passkeysDisabled()),
    });
  } catch (error) {
    logger.error('Failed to list passkeys:', error);
    fail(req, res, 500, 'api.errors.internalServerError');
  }
};

export const createPasskeyRegistrationOptions = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    if (await passkeysDisabled()) {
      fail(req, res, 403, 'api.errors.password_login_disabled');
      return;
    }
    const user = await resolveSessionAccount(req);
    if (!user) {
      fail(req, res, 403, 'api.errors.passkey_unavailable');
      return;
    }
    // Re-authenticate before adding a long-lived credential, as for a password change.
    // Answered with 400, not 401: the dashboard drops its session on any 401.
    const currentPassword = req.body?.currentPassword;
    if (
      typeof currentPassword !== 'string' ||
      !currentPassword ||
      !user.password ||
      !(await verifyPassword(currentPassword, user.password))
    ) {
      fail(req, res, 400, 'api.errors.passkey_password_invalid');
      return;
    }
    const rp = resolveRelyingParty(req);
    if (!rp) {
      fail(req, res, 400, 'api.errors.passkey_origin_invalid');
      return;
    }
    const result = await startPasskeyRegistration(user, rp);
    if (result.status === 'limit') {
      fail(req, res, 400, 'api.errors.passkey_limit_reached');
      return;
    }
    res.json({ success: true, options: result.options, challengeToken: result.challengeToken });
  } catch (error) {
    logger.error('Failed to start passkey registration:', error);
    fail(req, res, 500, 'api.errors.internalServerError');
  }
};

export const registerMyPasskey = async (req: Request, res: Response): Promise<void> => {
  try {
    if (await passkeysDisabled()) {
      fail(req, res, 403, 'api.errors.password_login_disabled');
      return;
    }
    const user = await resolveSessionAccount(req);
    if (!user) {
      fail(req, res, 403, 'api.errors.passkey_unavailable');
      return;
    }
    const { challengeToken, response, name } = req.body ?? {};
    if (!isCredentialResponse(response)) {
      fail(req, res, 400, 'api.errors.passkey_invalid_request');
      return;
    }
    const result = await finishPasskeyRegistration(
      user,
      challengeToken,
      response as RegistrationResponseJSON,
      normalizePasskeyName(name),
    );
    switch (result.status) {
      case 'ok':
        logger.info(`Passkey registered for user "${user.username}"`);
        res.status(201).json({ success: true, data: toPasskeySummary(result.passkey) });
        return;
      case 'invalid_challenge':
        fail(req, res, 400, 'api.errors.passkey_challenge_invalid');
        return;
      case 'duplicate':
        fail(req, res, 409, 'api.errors.passkey_already_registered');
        return;
      case 'limit':
        fail(req, res, 400, 'api.errors.passkey_limit_reached');
        return;
      default:
        fail(req, res, 400, 'api.errors.passkey_verification_failed');
    }
  } catch (error) {
    logger.error('Failed to register passkey:', error);
    fail(req, res, 500, 'api.errors.internalServerError');
  }
};

export const deleteMyPasskey = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await resolveSessionAccount(req);
    if (!user) {
      fail(req, res, 403, 'api.errors.passkey_unavailable');
      return;
    }
    const dao = getPasskeyDao();
    const passkey = UUID_PATTERN.test(req.params.id) ? await dao.findById(req.params.id) : null;
    if (!passkey || passkey.username !== user.username) {
      fail(req, res, 404, 'api.errors.passkey_not_found');
      return;
    }
    await dao.delete(passkey.id);
    logger.info(`Passkey removed for user "${user.username}"`);
    res.json({ success: true });
  } catch (error) {
    logger.error('Failed to delete passkey:', error);
    fail(req, res, 500, 'api.errors.internalServerError');
  }
};

export const createPasskeyLoginOptions = async (req: Request, res: Response): Promise<void> => {
  try {
    if (await passkeysDisabled()) {
      fail(req, res, 403, 'api.errors.password_login_disabled');
      return;
    }
    const rp = resolveRelyingParty(req);
    if (!rp) {
      fail(req, res, 400, 'api.errors.passkey_origin_invalid');
      return;
    }
    const { options, challengeToken } = await startPasskeyAuthentication(rp);
    res.json({ success: true, options, challengeToken });
  } catch (error) {
    logger.error('Failed to start passkey sign-in:', error);
    fail(req, res, 500, 'api.errors.internalServerError');
  }
};

export const loginWithPasskey = async (req: Request, res: Response): Promise<void> => {
  try {
    if (await passkeysDisabled()) {
      fail(req, res, 403, 'api.errors.password_login_disabled');
      return;
    }
    const { challengeToken, response } = req.body ?? {};
    if (!isCredentialResponse(response)) {
      fail(req, res, 400, 'api.errors.passkey_invalid_request');
      return;
    }
    const user = await finishPasskeyAuthentication(
      challengeToken,
      response as AuthenticationResponseJSON,
    );
    if (!user) {
      fail(req, res, 401, 'api.errors.passkey_login_failed');
      return;
    }
    res.json({
      success: true,
      token: signDashboardToken(user),
      user: {
        username: user.username,
        isAdmin: user.isAdmin,
        permissions: getDataService().getPermissions(user),
      },
    });
  } catch (error) {
    logger.error('Passkey sign-in error:', error);
    fail(req, res, 500, 'api.errors.internalServerError');
  }
};
