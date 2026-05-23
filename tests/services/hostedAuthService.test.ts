import { scryptSync } from 'node:crypto';
import { jest } from '@jest/globals';

jest.mock('../../src/services/hostedControlPlaneClient.js', () => {
  class MockHostedControlPlaneError extends Error {
    constructor(
      message: string,
      readonly status?: number,
      readonly code?: string,
    ) {
      super(message);
      this.name = 'HostedControlPlaneError';
    }
  }

  return {
    getHostedUserState: jest.fn(),
    HostedControlPlaneError: MockHostedControlPlaneError,
    reserveHostedCredit: jest.fn(),
    settleHostedCredit: jest.fn(),
    validateHostedApiKey: jest.fn(),
  };
});

import {
  getHostedUserState,
  HostedControlPlaneError,
  validateHostedApiKey,
} from '../../src/services/hostedControlPlaneClient.js';
import {
  applyHostedWebhookEvent,
  validateHostedBearer,
} from '../../src/services/hostedAuthService.js';

const validateHostedApiKeyMock = validateHostedApiKey as jest.MockedFunction<
  typeof validateHostedApiKey
>;
const getHostedUserStateMock = getHostedUserState as jest.MockedFunction<typeof getHostedUserState>;

const apiKey = 'mcphub-sk-abcdefghijklmnopqrstuv';
const apiKeyPrefix = 'abcdefghijkl';

const buildUserState = (input: {
  userId: string;
  apiKeyId: string;
  hash: string;
  cacheTtlSeconds: number;
}) => ({
  userId: input.userId,
  apiKeys: [
    {
      id: input.apiKeyId,
      prefix: apiKeyPrefix,
      hash: input.hash,
      scopeSlugs: null,
      monthlySpendCapMillicents: null,
      revoked: false,
    },
  ],
  subscriptions: [{ serverSlug: 'server-a', tools: 'all' as const, byokCredentialId: null }],
  balanceMillicents: 0,
  freeQuotaRemainingMillicents: 0,
  cacheTtlSeconds: input.cacheTtlSeconds,
  contentRecordingEnabled: false,
});

const buildValidateResponse = (input: { userId: string; apiKeyId: string }) => ({
  valid: true,
  userId: input.userId,
  apiKeyId: input.apiKeyId,
  prefix: apiKeyPrefix,
  scopeSlugs: null,
  contentRecordingEnabled: false,
  cacheTtlSeconds: 30,
});

const buildScryptHash = (value: string, salt = 'hosted-salt') => {
  const encoded = scryptSync(value, salt, 32).toString('base64url');
  return `$N16384r8p1$${salt}$${encoded}`;
};

describe('hostedAuthService cache handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    process.env.HUB_MODE = 'hosted';
  });

  afterEach(() => {
    applyHostedWebhookEvent({ type: 'user.suspended', userId: 'user-1' });
    applyHostedWebhookEvent({ type: 'user.suspended', userId: 'user-2' });
    delete process.env.HUB_MODE;
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('reuses cached auth context even when the control plane does not provide a local scrypt hash', async () => {
    validateHostedApiKeyMock.mockResolvedValue(buildValidateResponse({ userId: 'user-1', apiKeyId: 'key-1' }));
    getHostedUserStateMock.mockResolvedValue(
      buildUserState({
        userId: 'user-1',
        apiKeyId: 'key-1',
        hash: '',
        cacheTtlSeconds: 30,
      }),
    );

    const first = await validateHostedBearer(apiKey);

    expect(first).toMatchObject({
      userId: 'user-1',
      apiKeyId: 'key-1',
      apiKeyPrefix,
    });
    expect(validateHostedApiKeyMock).toHaveBeenCalledTimes(1);
    expect(getHostedUserStateMock).toHaveBeenCalledTimes(1);

    validateHostedApiKeyMock.mockRejectedValue(new Error('control plane should not be hit for cache hits'));
    getHostedUserStateMock.mockRejectedValue(new Error('control plane should not be hit for cache hits'));

    const second = await validateHostedBearer(apiKey);

    expect(second).toEqual(first);
    expect(validateHostedApiKeyMock).toHaveBeenCalledTimes(1);
    expect(getHostedUserStateMock).toHaveBeenCalledTimes(1);
  });

  it('does not log api key prefixes when serving stale cached auth state', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-23T00:00:00.000Z'));

    validateHostedApiKeyMock
      .mockResolvedValueOnce(buildValidateResponse({ userId: 'user-2', apiKeyId: 'key-2' }))
      .mockRejectedValueOnce(new HostedControlPlaneError('control plane unavailable'));

    getHostedUserStateMock.mockResolvedValueOnce(
      buildUserState({
        userId: 'user-2',
        apiKeyId: 'key-2',
        hash: buildScryptHash(apiKey),
        cacheTtlSeconds: 1,
      }),
    );

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await validateHostedBearer(apiKey);

    jest.setSystemTime(new Date('2026-05-23T00:00:02.000Z'));

    const stale = await validateHostedBearer(apiKey);

    expect(stale).toMatchObject({ userId: 'user-2', apiKeyId: 'key-2' });
    expect(warnSpy).toHaveBeenCalled();

    const lastWarning = warnSpy.mock.calls.at(-1);
    expect(lastWarning?.[0]).toBe(
      '[hosted] control plane unavailable, serving stale cached auth state',
    );
    expect(lastWarning?.[1]).not.toHaveProperty('prefix');
  });
});
