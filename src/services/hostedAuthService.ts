import { randomUUID } from 'node:crypto';
import {
  getHostedUserState,
  HostedControlPlaneError,
  reserveHostedCredit,
  settleHostedCredit,
  validateHostedApiKey,
} from './hostedControlPlaneClient.js';
import type { HubWebhookEvent, UserStateResponse } from './hostedControlPlaneClient.js';
import { isHostedModeEnabled } from './hostedMode.js';
import { getHostedNodeIdentity } from './hostedNodeIdentity.js';
import { safeCompare } from '../utils/safeCompare.js';

const KEY_PREFIX = 'mcphub-sk';
const API_KEY_PREFIX_CHARS = 12;
const DEFAULT_CACHE_TTL_SECONDS = 30;
const DEFAULT_STALE_TTL_MS = 60 * 60 * 1000;
const MAX_CACHE_ENTRIES = 1000;
const CACHE_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

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

export interface HostedCacheEntry extends HostedAuthContext {
  verificationToken: string;
  expiresAt: number;
  staleUntil: number;
}

export interface HostedAuthStateCache {
  get(prefix: string): HostedCacheEntry | undefined;
  set(prefix: string, entry: HostedCacheEntry): void;
  touch(prefix: string, entry: HostedCacheEntry): void;
  remove(prefix: string): void;
  invalidateUser(userId: string): void;
  invalidateApiKeyId(apiKeyId: string): void;
  prune(now?: number): void;
  size(): number;
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

function createVerificationToken(apiKey: string): string {
  return apiKey;
}

function matchesVerificationToken(apiKey: string, verificationToken: string): boolean {
  return safeCompare(apiKey, verificationToken);
}

class MemoryHostedAuthStateCache implements HostedAuthStateCache {
  private readonly keyCache = new Map<string, HostedCacheEntry>();
  private readonly userCacheIndex = new Map<string, Set<string>>();
  private readonly apiKeyIdCacheIndex = new Map<string, Set<string>>();

  get(prefix: string): HostedCacheEntry | undefined {
    return this.keyCache.get(prefix);
  }

  set(prefix: string, entry: HostedCacheEntry): void {
    this.remove(prefix);
    this.keyCache.set(prefix, entry);
    this.addIndexedPrefix(this.userCacheIndex, entry.userId, prefix);
    this.addIndexedPrefix(this.apiKeyIdCacheIndex, entry.apiKeyId, prefix);
    this.prune();
  }

  touch(prefix: string, entry: HostedCacheEntry): void {
    this.keyCache.delete(prefix);
    this.keyCache.set(prefix, entry);
  }

  remove(prefix: string): void {
    const existing = this.keyCache.get(prefix);
    if (!existing) return;

    this.keyCache.delete(prefix);
    this.removeIndexedPrefix(this.userCacheIndex, existing.userId, prefix);
    this.removeIndexedPrefix(this.apiKeyIdCacheIndex, existing.apiKeyId, prefix);
  }

  invalidateUser(userId: string): void {
    const prefixes = this.userCacheIndex.get(userId);
    if (!prefixes) return;

    for (const prefix of [...prefixes]) {
      this.remove(prefix);
    }
  }

  invalidateApiKeyId(apiKeyId: string): void {
    const prefixes = this.apiKeyIdCacheIndex.get(apiKeyId);
    if (!prefixes) return;

    for (const prefix of [...prefixes]) {
      this.remove(prefix);
    }
  }

  prune(now = Date.now()): void {
    for (const [prefix, entry] of this.keyCache.entries()) {
      if (entry.staleUntil <= now) {
        this.remove(prefix);
      }
    }

    while (this.keyCache.size > MAX_CACHE_ENTRIES) {
      const oldestPrefix = this.keyCache.keys().next().value as string | undefined;
      if (!oldestPrefix) break;
      this.remove(oldestPrefix);
    }
  }

  size(): number {
    return this.keyCache.size;
  }

  private addIndexedPrefix(index: Map<string, Set<string>>, key: string, prefix: string): void {
    const prefixes = index.get(key);
    if (prefixes) {
      prefixes.add(prefix);
      return;
    }

    index.set(key, new Set([prefix]));
  }

  private removeIndexedPrefix(index: Map<string, Set<string>>, key: string, prefix: string): void {
    const prefixes = index.get(key);
    if (!prefixes) return;

    prefixes.delete(prefix);
    if (prefixes.size === 0) {
      index.delete(key);
    }
  }
}

const authStateCache: HostedAuthStateCache = new MemoryHostedAuthStateCache();

const cacheCleanupTimer = setInterval(() => {
  authStateCache.prune();
}, CACHE_CLEANUP_INTERVAL_MS);

cacheCleanupTimer.unref?.();

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
  apiKey: string,
): HostedCacheEntry {
  const matchingKey = state.apiKeys.find((key) => key.id === validation.apiKeyId);
  const ttlSeconds = Math.max(
    1,
    state.cacheTtlSeconds || validation.cacheTtlSeconds || DEFAULT_CACHE_TTL_SECONDS,
  );
  const now = Date.now();
  const entry: HostedCacheEntry = {
    userId: validation.userId,
    apiKeyId: validation.apiKeyId,
    apiKeyPrefix: validation.prefix,
    verificationToken: createVerificationToken(apiKey),
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

  Object.defineProperty(entry, 'verificationToken', {
    value: entry.verificationToken,
    enumerable: false,
    writable: true,
    configurable: true,
  });

  return entry;
}

async function loadFreshContext(apiKey: string, prefix: string): Promise<HostedCacheEntry | null> {
  const validation = await validateHostedApiKey(apiKey);
  if (!validation.valid || !validation.userId || !validation.apiKeyId || !validation.prefix) {
    authStateCache.remove(prefix);
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
    apiKey,
  );
  authStateCache.set(prefix, entry);
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

  authStateCache.prune();

  const cached = authStateCache.get(prefix);
  if (
    cached &&
    Date.now() < cached.expiresAt &&
    matchesVerificationToken(apiKey, cached.verificationToken)
  ) {
    authStateCache.touch(prefix, cached);
    return publicContext(cached);
  }

  try {
    const fresh = await loadFreshContext(apiKey, prefix);
    return fresh ? publicContext(fresh) : null;
  } catch (error) {
    if (
      cached &&
      Date.now() < cached.staleUntil &&
      matchesVerificationToken(apiKey, cached.verificationToken)
    ) {
      console.warn('[hosted] control plane unavailable, serving stale cached auth state', {
        error: String(error),
      });
      authStateCache.touch(prefix, cached);
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
    const nodeIdentity = getHostedNodeIdentity();
    await settleHostedCredit({
      reservationId: reservation.reservationId,
      hubEventId: randomUUID(),
      success: input.success,
      latencyMs: input.latencyMs,
      occurredAt: new Date().toISOString(),
      costMillicents: input.success ? reservation.estimatedCostMillicents : 0,
      metadata: {
        ...(input.metadata ?? {}),
        hubRequestId: reservation.hubRequestId,
        hubClusterId: nodeIdentity.clusterId,
        hubNodeId: nodeIdentity.nodeId,
        serverSlug: reservation.serverSlug,
        toolName: reservation.toolName,
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
    authStateCache.remove(event.prefix);
    return;
  }

  if (event.type === 'api_key.revoked' && event.keyId) {
    authStateCache.invalidateApiKeyId(event.keyId);
    return;
  }

  authStateCache.invalidateUser(event.userId);
}
