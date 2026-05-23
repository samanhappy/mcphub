import { signInternalRequest, SIGNATURE_HEADER, TIMESTAMP_HEADER } from './hostedInternalAuth.js';

export interface HubWebhookEvent {
  type:
    | 'api_key.created'
    | 'api_key.revoked'
    | 'subscription.added'
    | 'subscription.removed'
    | 'byok.upserted'
    | 'byok.deleted'
    | 'user.suspended';
  userId: string;
  keyId?: string;
  prefix?: string;
  scopeSlugs?: string[] | null;
  serverSlug?: string;
  credentialId?: string;
  reason?: string;
}

export interface ValidateApiKeyResponse {
  valid: boolean;
  userId: string | null;
  apiKeyId: string | null;
  prefix: string | null;
  scopeSlugs: string[] | null;
  contentRecordingEnabled: boolean;
  cacheTtlSeconds: number;
}

export interface UserStateResponse {
  userId: string;
  apiKeys: Array<{
    id: string;
    prefix: string;
    hash: string;
    scopeSlugs: string[] | null;
    monthlySpendCapMillicents: number | null;
    revoked: boolean;
  }>;
  subscriptions: Array<{
    serverSlug: string;
    tools?: 'all' | string[];
    byokCredentialId: string | null;
  }>;
  balanceMillicents: number;
  freeQuotaRemainingMillicents: number;
  cacheTtlSeconds: number;
  contentRecordingEnabled: boolean;
}

export interface CreditReserveResponse {
  reservationId: string;
  estimatedCostMillicents: number;
  balanceMillicents: number;
}

export interface CreditSettleResponse {
  chargedMillicents: number;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  message?: string;
  code?: string;
}

export class HostedControlPlaneError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'HostedControlPlaneError';
  }
}

function controlPlaneBaseUrl(): string {
  const raw = process.env.HOSTED_CONTROL_PLANE_URL || process.env.MCPHUB_APP_URL;
  if (!raw) {
    throw new HostedControlPlaneError('HOSTED_CONTROL_PLANE_URL is not configured');
  }
  return raw.replace(/\/+$/, '');
}

async function requestControlPlane<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const bodyText = body === undefined ? '' : JSON.stringify(body);
  const { timestamp, signature } = signInternalRequest(method, path, bodyText);
  const response = await fetch(`${controlPlaneBaseUrl()}${path}`, {
    method,
    headers: {
      [TIMESTAMP_HEADER]: timestamp,
      [SIGNATURE_HEADER]: signature,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : bodyText,
    signal: AbortSignal.timeout(Number(process.env.HOSTED_CONTROL_PLANE_TIMEOUT_MS || 5000)),
  });

  const envelope = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;
  if (!response.ok || !envelope?.success) {
    throw new HostedControlPlaneError(
      envelope?.message || `Control plane request failed: ${method} ${path}`,
      response.status,
      envelope?.code,
    );
  }

  return envelope.data as T;
}

export async function validateHostedApiKey(apiKey: string): Promise<ValidateApiKeyResponse> {
  return requestControlPlane<ValidateApiKeyResponse>('POST', '/api/internal/v1/keys/validate', {
    apiKey,
  });
}

export async function getHostedUserState(userId: string): Promise<UserStateResponse> {
  return requestControlPlane<UserStateResponse>(
    'GET',
    `/api/internal/v1/users/${encodeURIComponent(userId)}/state`,
  );
}

export async function reserveHostedCredit(input: {
  userId: string;
  apiKeyId: string | null;
  serverSlug: string;
  toolName: string;
  hubRequestId: string;
}): Promise<CreditReserveResponse> {
  return requestControlPlane<CreditReserveResponse>(
    'POST',
    '/api/internal/v1/credits/reserve',
    input,
  );
}

export async function settleHostedCredit(input: {
  reservationId: string;
  hubEventId: string;
  success: boolean;
  latencyMs?: number | null;
  occurredAt: string;
  costMillicents?: number | null;
  metadata?: Record<string, unknown>;
  requestContent?: unknown;
  responseContent?: unknown;
}): Promise<CreditSettleResponse> {
  return requestControlPlane<CreditSettleResponse>(
    'POST',
    '/api/internal/v1/credits/settle',
    input,
  );
}
