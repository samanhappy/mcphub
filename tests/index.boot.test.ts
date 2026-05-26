const initializeMock = jest.fn(async () => undefined);
const startMock = jest.fn();
const shutdownMock = jest.fn(async () => undefined);
const getAppMock = jest.fn(() => ({}));
const AppServerMock = jest.fn(() => ({
  initialize: initializeMock,
  start: startMock,
  shutdown: shutdownMock,
  getApp: getAppMock,
}));

const initializeDatabaseModeMock = jest.fn(async () => true);
const createFetchWithProxyMock = jest.fn();
const getProxyConfigFromEnvMock = jest.fn(() => ({}));
const isRetryableDbErrorMock = jest.fn(() => false);
const hydrateSystemConfigCacheMock = jest.fn(async () => undefined);
const startHostedEventSubscriberMock = jest.fn();
const stopHostedEventSubscriberMock = jest.fn(async () => undefined);

jest.mock('../src/server.js', () => ({
  __esModule: true,
  default: AppServerMock,
}));

jest.mock('../src/utils/migration.js', () => ({
  initializeDatabaseMode: initializeDatabaseModeMock,
}));

jest.mock('../src/services/proxy.js', () => ({
  createFetchWithProxy: createFetchWithProxyMock,
  getProxyConfigFromEnv: getProxyConfigFromEnvMock,
}));

jest.mock('../src/utils/dbRetry.js', () => ({
  isRetryableDbError: isRetryableDbErrorMock,
}));

jest.mock('../src/utils/systemConfigCache.js', () => ({
  hydrateSystemConfigCache: hydrateSystemConfigCacheMock,
}));

jest.mock('../src/services/hostedEventSubscriber.js', () => ({
  startHostedEventSubscriber: startHostedEventSubscriberMock,
  stopHostedEventSubscriber: stopHostedEventSubscriberMock,
}));

describe('index boot', () => {
  beforeEach(() => {
    jest.resetModules();
    initializeMock.mockClear();
    startMock.mockClear();
    shutdownMock.mockClear();
    getAppMock.mockClear();
    AppServerMock.mockClear();
    initializeDatabaseModeMock.mockClear();
    createFetchWithProxyMock.mockClear();
    getProxyConfigFromEnvMock.mockClear();
    isRetryableDbErrorMock.mockClear();
    hydrateSystemConfigCacheMock.mockClear();
    startHostedEventSubscriberMock.mockReset();
    stopHostedEventSubscriberMock.mockClear();

    getProxyConfigFromEnvMock.mockReturnValue({});
    isRetryableDbErrorMock.mockReturnValue(false);
    hydrateSystemConfigCacheMock.mockResolvedValue(undefined);
    startHostedEventSubscriberMock.mockReturnValue(new Promise(() => undefined));

    delete process.env.USE_DB;
    delete process.env.DB_URL;
  });

  it('starts the app without waiting for the hosted Redis subscriber to connect', async () => {
    await import('../src/index.js');
    await Promise.resolve();
    await Promise.resolve();

    expect(hydrateSystemConfigCacheMock).toHaveBeenCalledTimes(1);
    expect(startHostedEventSubscriberMock).toHaveBeenCalledTimes(1);
    expect(initializeMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledTimes(1);
  });
});
