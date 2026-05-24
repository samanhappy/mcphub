import { createClient } from 'redis';
import { applyHostedWebhookEvent } from './hostedAuthService.js';
import type { HubClusterEvent } from './hostedControlPlaneClient.js';
import { isHostedModeEnabled } from './hostedMode.js';
import { getHostedNodeIdentity } from './hostedNodeIdentity.js';

const DEFAULT_EVENT_CHANNEL = 'mcphub:hosted-events';
const VALID_EVENT_TYPES = new Set([
  'api_key.created',
  'api_key.revoked',
  'subscription.added',
  'subscription.removed',
  'byok.upserted',
  'byok.deleted',
  'user.suspended',
]);

type RedisSubscriber = ReturnType<typeof createClient>;

let subscriber: RedisSubscriber | null = null;
let starting = false;
let retryTimer: NodeJS.Timeout | null = null;

function eventChannel(): string {
  return process.env.HUB_EVENT_CHANNEL || DEFAULT_EVENT_CHANNEL;
}

function redisUrl(): string | null {
  return process.env.HUB_EVENT_REDIS_URL || null;
}

function shouldSubscribeToRedisEvents(): boolean {
  if (!isHostedModeEnabled()) return false;
  if ((process.env.HUB_EVENT_TRANSPORT || '').toLowerCase() === 'webhook') return false;
  return Boolean(redisUrl());
}

function isHubClusterEvent(value: unknown): value is HubClusterEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<HubClusterEvent>;
  return (
    typeof event.type === 'string' &&
    VALID_EVENT_TYPES.has(event.type) &&
    typeof event.userId === 'string'
  );
}

function clearRetryTimer(): void {
  if (!retryTimer) return;
  clearTimeout(retryTimer);
  retryTimer = null;
}

function scheduleRetry(): void {
  clearRetryTimer();
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void startHostedEventSubscriber();
  }, 5000);
  retryTimer.unref?.();
}

export async function startHostedEventSubscriber(): Promise<void> {
  if (subscriber || starting || !shouldSubscribeToRedisEvents()) return;

  const url = redisUrl();
  if (!url) return;

  starting = true;
  const channel = eventChannel();
  const nodeIdentity = getHostedNodeIdentity();
  const client = createClient({ url });

  client.on('error', (error) => {
    console.warn('[hosted] Redis event subscriber error', {
      error: String(error),
      channel,
      hubClusterId: nodeIdentity.clusterId,
      hubNodeId: nodeIdentity.nodeId,
    });
  });

  client.on('ready', () => {
    console.info('[hosted] Redis event subscriber ready', {
      channel,
      hubClusterId: nodeIdentity.clusterId,
      hubNodeId: nodeIdentity.nodeId,
    });
  });

  client.on('end', () => {
    console.warn('[hosted] Redis event subscriber connection ended', {
      channel,
      hubClusterId: nodeIdentity.clusterId,
      hubNodeId: nodeIdentity.nodeId,
    });
  });

  try {
    await client.connect();
    await client.subscribe(channel, (message) => {
      try {
        const event = JSON.parse(message) as unknown;
        if (!isHubClusterEvent(event)) {
          console.warn('[hosted] Ignoring invalid cluster event', { channel });
          return;
        }

        applyHostedWebhookEvent(event);
        console.info('[hosted] Applied cluster event', {
          eventId: event.eventId,
          type: event.type,
          userId: event.userId,
          channel,
          hubClusterId: nodeIdentity.clusterId,
          hubNodeId: nodeIdentity.nodeId,
        });
      } catch (error) {
        console.warn('[hosted] Failed to process cluster event', {
          error: String(error),
          channel,
        });
      }
    });
    subscriber = client;
  } catch (error) {
    console.warn(
      '[hosted] Failed to start Redis event subscriber; local cache TTL remains authoritative',
      {
        error: String(error),
        channel,
        hubClusterId: nodeIdentity.clusterId,
        hubNodeId: nodeIdentity.nodeId,
      },
    );
    await client.quit().catch(() => undefined);
    scheduleRetry();
  } finally {
    starting = false;
  }
}

export async function stopHostedEventSubscriber(): Promise<void> {
  clearRetryTimer();
  const client = subscriber;
  subscriber = null;
  if (!client) return;

  try {
    await client.quit();
  } catch (error) {
    console.warn('[hosted] Failed to stop Redis event subscriber cleanly', {
      error: String(error),
    });
  }
}
