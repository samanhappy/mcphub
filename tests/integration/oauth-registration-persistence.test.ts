const mockDynamicClientRegistration = jest.fn();
const mockFindById = jest.fn();
const mockUpdate = jest.fn();

jest.mock('openid-client', () => ({
  customFetch: Symbol('customFetch'),
  dynamicClientRegistration: mockDynamicClientRegistration,
  None: jest.fn(),
}));

jest.mock('../../src/dao/index.js', () => ({
  getServerDao: () => ({ findById: mockFindById, update: mockUpdate }),
  getSystemConfigDao: () => ({ get: async () => ({}) }),
  getUserDao: () => ({ findByUsername: async () => undefined }),
}));

import {
  getRegisteredClient,
  registerClient,
  removeRegisteredClient,
} from '../../src/services/oauthClientRegistration.js';
import { ServerConfig } from '../../src/types/index.js';

describe('OAuth registration persistence', () => {
  const serverName = 'registration-persistence';
  const makeConfig = (): ServerConfig => ({
    url: 'https://mcp.example.com/mcp',
    oauth: { dynamicRegistration: { enabled: true, issuer: 'https://issuer.example.com' } },
  });

  beforeEach(() => {
    jest.resetAllMocks();
    removeRegisteredClient(serverName);
    mockFindById.mockImplementation(async () => ({ name: serverName, ...makeConfig() }));
    mockUpdate.mockImplementation(async (_name, updates) => ({ name: serverName, ...updates }));
    mockDynamicClientRegistration.mockImplementation(async () => ({
      client_id: `client-${mockDynamicClientRegistration.mock.calls.length}`,
      client_secret: 'secret',
      serverMetadata: () => ({ token_endpoint: 'https://issuer.example.com/token' }),
    }));
  });

  afterEach(() => removeRegisteredClient(serverName));

  it.each(['missing record', 'write rejection', 'empty update result'])(
    'leaves registration retryable after %s',
    async (failure) => {
      if (failure === 'missing record') mockFindById.mockResolvedValueOnce(undefined);
      if (failure === 'write rejection')
        mockUpdate.mockRejectedValueOnce(new Error('write failed'));
      if (failure === 'empty update result') mockUpdate.mockResolvedValueOnce(null);
      const config = makeConfig();

      await expect(registerClient(serverName, config)).rejects.toThrow();
      expect(getRegisteredClient(serverName)).toBeUndefined();
      expect(config.oauth?.clientId).toBeUndefined();

      const registered = await registerClient(serverName, config);
      expect(registered.clientId).toBe('client-2');
      expect(mockUpdate).toHaveBeenLastCalledWith(serverName, {
        oauth: expect.objectContaining({ clientId: 'client-2', clientSecret: 'secret' }),
      });
      expect(config.oauth?.clientId).toBe('client-2');
      expect(getRegisteredClient(serverName)).toBe(registered);
      expect(await registerClient(serverName, config)).toBe(registered);
      expect(mockDynamicClientRegistration).toHaveBeenCalledTimes(2);
    },
  );

  it('keeps the client invisible until the write completes', async () => {
    let finishWrite!: () => void;
    let writeStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      writeStarted = resolve;
    });
    mockUpdate.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishWrite = () => resolve({ name: serverName });
          writeStarted();
        }),
    );
    const registration = registerClient(serverName, makeConfig());
    await started;
    const cachedDuringWrite = getRegisteredClient(serverName);
    finishWrite();
    const registered = await registration;
    expect(cachedDuringWrite).toBeUndefined();
    expect(getRegisteredClient(serverName)).toBe(registered);
  });
});
