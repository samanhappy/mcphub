const createClientMock = jest.fn();

jest.mock('redis', () => ({
  createClient: createClientMock,
}));

jest.mock('../../src/services/hostedAuthService.js', () => ({
  applyHostedWebhookEvent: jest.fn(),
}));

jest.mock('../../src/services/hostedMode.js', () => ({
  isHostedModeEnabled: jest.fn(() => true),
}));

jest.mock('../../src/services/hostedNodeIdentity.js', () => ({
  getHostedNodeIdentity: jest.fn(() => ({
    clusterId: 'prod-us-east-1',
    nodeId: 'hub-1',
  })),
}));

import { isHostedModeEnabled } from '../../src/services/hostedMode.js';
import {
  startHostedEventSubscriber,
  stopHostedEventSubscriber,
} from '../../src/services/hostedEventSubscriber.js';

type RedisEventName = 'error' | 'ready' | 'end';
type RedisEventHandler = (...args: unknown[]) => void;

interface MockRedisClient {
  on: jest.Mock;
  connect: jest.Mock<Promise<void>, []>;
  subscribe: jest.Mock<Promise<void>, [string, (message: string) => void]>;
  quit: jest.Mock<Promise<void>, []>;
  emit: (event: RedisEventName, ...args: unknown[]) => void;
}

const isHostedModeEnabledMock = isHostedModeEnabled as jest.MockedFunction<
  typeof isHostedModeEnabled
>;

const buildRedisClient = (): MockRedisClient => {
  const handlers = new Map<RedisEventName, RedisEventHandler[]>();
  const connect: MockRedisClient['connect'] = jest.fn(async () => undefined);
  const subscribe: MockRedisClient['subscribe'] = jest.fn(
    async (_channel: string, _handler: (message: string) => void) => undefined,
  );
  const quit: MockRedisClient['quit'] = jest.fn(async () => undefined);

  const client: MockRedisClient = {
    on: jest.fn((event: RedisEventName, handler: RedisEventHandler) => {
      const listeners = handlers.get(event) ?? [];
      listeners.push(handler);
      handlers.set(event, listeners);
      return client;
    }),
    connect,
    subscribe,
    quit,
    emit: (event: RedisEventName, ...args: unknown[]) => {
      for (const handler of handlers.get(event) ?? []) {
        handler(...args);
      }
    },
  };

  return client;
};

describe('hostedEventSubscriber', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    isHostedModeEnabledMock.mockReturnValue(true);
    process.env.HUB_MODE = 'hosted';
    process.env.HUB_EVENT_REDIS_URL = 'redis://hosted-events.test:6379';
    delete process.env.HUB_EVENT_TRANSPORT;
  });

  afterEach(async () => {
    await stopHostedEventSubscriber();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
    delete process.env.HUB_MODE;
    delete process.env.HUB_EVENT_REDIS_URL;
    delete process.env.HUB_EVENT_TRANSPORT;
  });

  it('collapses repeated initial socket-close errors into a single startup warning', async () => {
    const client = buildRedisClient();
    const socketClosedError = new Error('Socket closed unexpectedly');

    client.connect.mockImplementation(async () => {
      client.emit('error', socketClosedError);
      client.emit('error', socketClosedError);
      throw socketClosedError;
    });

    createClientMock.mockReturnValue(client);

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await startHostedEventSubscriber();

    const warningMessages = warnSpy.mock.calls.map((call) => call[0]);

    expect(warningMessages).toEqual([
      '[hosted] Failed to start Redis event subscriber; local cache TTL remains authoritative',
    ]);
    expect(client.subscribe).not.toHaveBeenCalled();
    expect(client.quit).toHaveBeenCalledTimes(1);
  });

  it('suppresses identical startup warnings across retry attempts until a connection succeeds', async () => {
    const socketClosedError = new Error('Socket closed unexpectedly');
    const firstClient = buildRedisClient();
    const secondClient = buildRedisClient();

    firstClient.connect.mockImplementation(async () => {
      throw socketClosedError;
    });

    secondClient.connect.mockImplementation(async () => {
      throw socketClosedError;
    });

    createClientMock.mockReturnValueOnce(firstClient).mockReturnValueOnce(secondClient);

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await startHostedEventSubscriber();
    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    await Promise.resolve();

    const warningMessages = warnSpy.mock.calls.map((call) => call[0]);

    expect(warningMessages).toEqual([
      '[hosted] Failed to start Redis event subscriber; local cache TTL remains authoritative',
    ]);
  });

  it('stops an in-flight connection attempt before it can subscribe', async () => {
    const client = buildRedisClient();
    let resolveConnect: (() => void) | undefined;

    client.connect.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveConnect = resolve;
        }),
    );

    createClientMock.mockReturnValue(client);

    const startPromise = startHostedEventSubscriber();

    await stopHostedEventSubscriber();
    resolveConnect?.();
    await startPromise;

    expect(client.quit).toHaveBeenCalled();
    expect(client.subscribe).not.toHaveBeenCalled();

    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    await Promise.resolve();

    expect(createClientMock).toHaveBeenCalledTimes(1);
  });

  it('does not schedule a retry when startup fails after the subscriber was stopped', async () => {
    const client = buildRedisClient();
    let rejectConnect: ((error: Error) => void) | undefined;
    const socketClosedError = new Error('Socket closed unexpectedly');

    client.connect.mockImplementation(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectConnect = reject;
        }),
    );

    createClientMock.mockReturnValue(client);

    const startPromise = startHostedEventSubscriber();

    await stopHostedEventSubscriber();
    rejectConnect?.(socketClosedError);
    await startPromise;

    expect(client.quit).toHaveBeenCalled();
    expect(client.subscribe).not.toHaveBeenCalled();

    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    await Promise.resolve();

    expect(createClientMock).toHaveBeenCalledTimes(1);
  });
});
