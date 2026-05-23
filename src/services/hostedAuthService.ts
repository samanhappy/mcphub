import { randomUUID, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import {
  getHostedUserState,
  HostedControlPlaneError,
  reserveHostedCredit,
  settleHostedCredit,
  validateHostedApiKey,
} from './hostedControlPlaneClient.js';
import type { HubWebhookEvent, UserStateResponse } from './hostedControlPlaneClient.js';
import { isHostedModeEnabled } from './hostedMode.js';

const KEY_PREFIX = 'mcphub-sk';
const API_KEY_PREFIX_CHARS = 12;
const DEFAULT_CACHE_TTL_SECONDS = 30;
const DEFAULT_STALE_TTL_MS = 60 * 60 * 1000;
const scrypt = promisify(scryptCb);

export interface HostedSubscriptionProjection {
  serverSlug: string;
  tools: 'all' | string[];
  byokCredentialId: string | null;
}

export interface HostedAuthContext {
  userId: string;
  apiKeyId: string;
  apiKeyPrefix: string;
  scopeSlugs: string[] | null;
  contentRecordingEnabled: boolean;
  subscriptions: HostedSubscriptionProjection[];
}

interface HostedCacheEntry extends HostedAuthContext {
  hash: string | null;
  expiresAt: number;
  staleUntil: number;
}

export interface HostedCreditReservation {
  reservationId: string;
  hubRequestId: string;
  userId: string;
  apiKeyId: string;
  serverSlug: string;
  toolName: string;
  estimatedCostMillicents: number;
  contentRecordingEnabled: boolean;
}

export class HostedAuthorizationError extends Error {
  constructor(
    message: string,
    readonly code = 'hosted_forbidden',
  ) {
    super(message);
    this.name = 'HostedAuthorizationError';
  }
}

export class HostedAuthUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostedAuthUnavailableError';
  }
}

const keyCache = new Map<string, HostedCacheEntry>();

export function isHostedApiKey(value?: string | null): boolean {
  return Boolean(value?.startsWith(`${KEY_PREFIX}-`));
}

function extractApiKeyPrefix(key: string): string | null {
  const prefix = `${KEY_PREFIX}-`;
  if (!key.startsWith(prefix)) return null;
  const token = key.slice(prefix.length);
  if (token.length < API_KEY_PREFIX_CHARS) return null;
  return token.slice(0, API_KEY_PREFIX_CHARS);
}

async function verifyScryptApiKey(key: string, hash: string | null): Promise<boolean> {
  if (!hash) return false;
  const [, params, salt, encoded] = hash.split('$');
  if (params !== 'N16384r8p1' || !salt || !encoded) return false;
  const expected = Buffer.from(encoded, 'base64url');
  const actual = (await scrypt(key, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function projectState(
  validation: {
    userId: string;
    apiKeyId: string;
    prefix: string;
    scopeSlugs: string[] | null;
    contentRecordingEnabled: boolean;
    cacheTtlSeconds: number;
  },
  state: UserStateResponse,
): HostedCacheEntry {
  const matchingKey = state.apiKeys.find((key) => key.id === validation.apiKeyId);
  const ttlSeconds = Math.max(
    1,
    state.cacheTtlSeconds || validation.cacheTtlSeconds || DEFAULT_CACHE_TTL_SECONDS,
  );
  const now = Date.now();
  return {
    userId: validation.userId,
    apiKeyId: validation.apiKeyId,
    apiKeyPrefix: validation.prefix,
    hash: matchingKey?.hash ?? null,
    scopeSlugs: matchingKey?.scopeSlugs ?? validation.scopeSlugs,
    contentRecordingEnabled: state.contentRecordingEnabled || validation.contentRecordingEnabled,
    subscriptions: state.subscriptions.map((subscription) => ({
      serverSlug: subscription.serverSlug,
      tools: subscription.tools ?? 'all',
      byokCredentialId: subscription.byokCredentialId,
    })),
    expiresAt: now + ttlSeconds * 1000,
    staleUntil: now + DEFAULT_STALE_TTL_MS,
  };
}

async function loadFreshContext(apiKey: string, prefix: string): Promise<HostedCacheEntry | null> {
  const validation = await validateHostedApiKey(apiKey);
  if (!validation.valid || !validation.userId || !validation.apiKeyId || !validation.prefix) {
    keyCache.delete(prefix);
    return null;
  }

  const state = await getHostedUserState(validation.userId);
  const entry = projectState(
    {
      userId: validation.userId,
      apiKeyId: validation.apiKeyId,
      prefix: validation.prefix,
      scopeSlugs: validation.scopeSlugs,
      contentRecordingEnabled: validation.contentRecordingEnabled,
      cacheTtlSeconds: validation.cacheTtlSeconds,
    },
    state,
  );
  keyCache.set(prefix, entry);
  return entry;
}

function publicContext(entry: HostedCacheEntry): HostedAuthContext {
  return {
    userId: entry.userId,
    apiKeyId: entry.apiKeyId,
    apiKeyPrefix: entry.apiKeyPrefix,
    scopeSlugs: entry.scopeSlugs,
    contentRecordingEnabled: entry.contentRecordingEnabled,
    subscriptions: entry.subscriptions,
  };
}

export async function validateHostedBearer(apiKey: string): Promise<HostedAuthContext | null> {
  if (!isHostedModeEnabled() || !isHostedApiKey(apiKey)) {
    return null;
  }

  const prefix = extractApiKeyPrefix(apiKey);
  if (!prefix) return null;

  const cached = keyCache.get(prefix);
  if (cached && Date.now() < cached.expiresAt && (await verifyScryptApiKey(apiKey, cached.hash))) {
    return publicContext(cached);
  }

  try {
    const fresh = await loadFreshContext(apiKey, prefix);
    return fresh ? publicContext(fresh) : null;
  } catch (error) {
    if (
      cached &&
      Date.now() < cached.staleUntil &&
      (await verifyScryptApiKey(apiKey, cached.hash))
    ) {
      console.warn('[hosted] control plane unavailable, serving stale cached auth state', {
        prefix,
        error: String(error),
      });
      return publicContext(cached);
    }

    if (error instanceof HostedControlPlaneError) {
      throw new HostedAuthUnavailableError(error.message);
    }
    throw error;
  }
}

function findSubscription(
  context: HostedAuthContext,
  serverSlug: string,
): HostedSubscriptionProjection | null {
  return (
    context.subscriptions.find((subscription) => subscription.serverSlug === serverSlug) ?? null
  );
}

export function assertHostedToolAllowed(
  context: HostedAuthContext | undefined,
  serverSlug: string,
  toolName: string,
): void {
  if (!context) return;

  if (context.scopeSlugs && !context.scopeSlugs.includes(serverSlug)) {
    throw new HostedAuthorizationError('API key is not scoped for this hosted server');
  }

  const subscription = findSubscription(context, serverSlug);
  if (!subscription) {
    throw new HostedAuthorizationError('User is not subscribed to this hosted server');
  }

  if (subscription.tools !== 'all' && !subscription.tools.includes(toolName)) {
    throw new HostedAuthorizationError('Tool is not enabled in this hosted toolset');
  }
}

export function filterHostedTools<T extends { name: string }>(
  context: HostedAuthContext | undefined,
  serverSlug: string,
  tools: T[],
  nameSeparator: string,
): T[] {
  if (!context) return tools;
  if (context.scopeSlugs && !context.scopeSlugs.includes(serverSlug)) return [];

  const subscription = findSubscription(context, serverSlug);
  if (!subscription) return [];
  if (subscription.tools === 'all') return tools;

  const prefix = `${serverSlug}${nameSeparator}`;
  return tools.filter((tool) => {
    const cleanName = tool.name.startsWith(prefix) ? tool.name.slice(prefix.length) : tool.name;
    return subscription.tools !== 'all' && subscription.tools.includes(cleanName);
  });
}

export async function reserveHostedToolCall(
  context: HostedAuthContext | undefined,
  serverSlug: string,
  toolName: string,
): Promise<HostedCreditReservation | null> {
  if (!context) return null;
  assertHostedToolAllowed(context, serverSlug, toolName);
  const hubRequestId = randomUUID();
  const reservation = await reserveHostedCredit({
    userId: context.userId,
    apiKeyId: context.apiKeyId,
    serverSlug,
    toolName,
    hubRequestId,
  });

  return {
    reservationId: reservation.reservationId,
    hubRequestId,
    userId: context.userId,
    apiKeyId: context.apiKeyId,
    serverSlug,
    toolName,
    estimatedCostMillicents: reservation.estimatedCostMillicents,
    contentRecordingEnabled: context.contentRecordingEnabled,
  };
}

export async function settleHostedToolCall(
  reservation: HostedCreditReservation | null,
  input: {
    success: boolean;
    latencyMs: number;
    requestContent?: unknown;
    responseContent?: unknown;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (!reservation) return;

  try {
    await settleHostedCredit({
      reservationId: reservation.reservationId,
      hubEventId: randomUUID(),
      success: input.success,
      latencyMs: input.latencyMs,
      occurredAt: new Date().toISOString(),
      costMillicents: input.success ? reservation.estimatedCostMillicents : 0,
      metadata: {
        hubRequestId: reservation.hubRequestId,
        serverSlug: reservation.serverSlug,
        toolName: reservation.toolName,
        ...(input.metadata ?? {}),
      },
      requestContent: reservation.contentRecordingEnabled ? input.requestContent : undefined,
      responseContent: reservation.contentRecordingEnabled ? input.responseContent : undefined,
    });
  } catch (error) {
    console.warn('[hosted] failed to settle hosted tool call', {
      reservationId: reservation.reservationId,
      error: String(error),
    });
  }
}

export function applyHostedWebhookEvent(event: HubWebhookEvent): void {
  if (event.type === 'api_key.created' && event.prefix) {
    keyCache.delete(event.prefix);
    return;
  }

  if (event.type === 'api_key.revoked' && event.keyId) {
    for (const [prefix, entry] of keyCache.entries()) {
      if (entry.apiKeyId === event.keyId) keyCache.delete(prefix);
    }
    return;
  }

  for (const [prefix, entry] of keyCache.entries()) {
    if (entry.userId === event.userId) keyCache.delete(prefix);
  }
}
