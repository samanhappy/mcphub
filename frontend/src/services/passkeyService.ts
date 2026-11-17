import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import type { AuthResponse, Passkey } from '../types';
import { apiDelete, apiGet, apiPost, type ApiResponse } from '../utils/fetchInterceptor';
import { setToken } from '../utils/interceptors';

/** Why a browser passkey ceremony did not complete. */
export type PasskeyCeremonyError = 'cancelled' | 'alreadyRegistered' | 'insecureContext' | 'failed';

interface CeremonyStart<T> {
  success: boolean;
  options?: T;
  challengeToken?: string;
  message?: string;
}

export const passkeysSupported = (): boolean => browserSupportsWebAuthn();

const classifyCeremonyError = (error: unknown): PasskeyCeremonyError => {
  const { name, code } = (error ?? {}) as { name?: string; code?: string };
  // Browsers report both a dismissed prompt and a timeout as NotAllowedError.
  if (name === 'NotAllowedError' || name === 'AbortError') return 'cancelled';
  if (code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED' || name === 'InvalidStateError') {
    return 'alreadyRegistered';
  }
  if (name === 'SecurityError') return 'insecureContext';
  return 'failed';
};

export type PasskeySignInResult =
  | (AuthResponse & { success: true })
  | { success: false; error?: PasskeyCeremonyError; code?: string; message?: string };

export const signInWithPasskey = async (): Promise<PasskeySignInResult> => {
  const start =
    await apiPost<CeremonyStart<PublicKeyCredentialRequestOptionsJSON>>('/auth/passkey/options');
  if (!start.success || !start.options || !start.challengeToken) {
    return { success: false, message: start.message };
  }

  let response;
  try {
    response = await startAuthentication({ optionsJSON: start.options });
  } catch (error) {
    return { success: false, error: classifyCeremonyError(error) };
  }

  const result = await apiPost<AuthResponse & { code?: string }>('/auth/passkey/login', {
    challengeToken: start.challengeToken,
    response,
  });
  if (result.success && result.token) {
    setToken(result.token);
    return { ...result, success: true };
  }
  return { success: false, code: result.code, message: result.message };
};

export const listPasskeys = () =>
  apiGet<ApiResponse<Passkey[]> & { registrationAvailable?: boolean }>('/auth/passkeys');

export type PasskeyRegistrationResult =
  | { success: true; passkey: Passkey }
  | { success: false; error?: PasskeyCeremonyError; message?: string };

export const registerPasskey = async (
  name: string,
  currentPassword: string,
): Promise<PasskeyRegistrationResult> => {
  const start = await apiPost<CeremonyStart<PublicKeyCredentialCreationOptionsJSON>>(
    '/auth/passkeys/registration/options',
    { currentPassword },
  );
  if (!start.success || !start.options || !start.challengeToken) {
    return { success: false, message: start.message };
  }

  let response;
  try {
    response = await startRegistration({ optionsJSON: start.options });
  } catch (error) {
    return { success: false, error: classifyCeremonyError(error) };
  }

  const result = await apiPost<ApiResponse<Passkey>>('/auth/passkeys', {
    challengeToken: start.challengeToken,
    response,
    name,
  });
  return result.success && result.data
    ? { success: true, passkey: result.data }
    : { success: false, message: result.message };
};

export const deletePasskey = (id: string) =>
  apiDelete<ApiResponse>(`/auth/passkeys/${encodeURIComponent(id)}`);
