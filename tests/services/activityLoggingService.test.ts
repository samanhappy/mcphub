import { getActivityLoggingService } from '../../src/services/activityLoggingService.js';

const mockCreate = jest.fn();
const mockGetActivityDao = jest.fn(() => ({
  create: mockCreate,
}));
const mockIsActivityLoggingEnabled = jest.fn(() => true);
const mockGetCachedSystemConfig = jest.fn(() => null as any);

jest.mock('../../src/dao/DaoFactory.js', () => ({
  getActivityDao: jest.fn(() => mockGetActivityDao()),
  isActivityLoggingEnabled: jest.fn(() => mockIsActivityLoggingEnabled()),
}));

jest.mock('../../src/utils/systemConfigCache.js', () => ({
  getCachedSystemConfig: jest.fn(() => mockGetCachedSystemConfig()),
}));

describe('ActivityLoggingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue(undefined);
    mockIsActivityLoggingEnabled.mockReturnValue(true);
    mockGetActivityDao.mockReturnValue({ create: mockCreate });
    mockGetCachedSystemConfig.mockReturnValue(null);
  });

  it('persists sourceIp when logging tool calls', async () => {
    const activityLoggingService = getActivityLoggingService();

    await activityLoggingService.logToolCall({
      server: 'demo-server',
      tool: 'demo-tool',
      duration: 42,
      status: 'success',
      input: { hello: 'world' },
      output: { ok: true },
      sourceIp: '203.0.113.10',
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        server: 'demo-server',
        tool: 'demo-tool',
        duration: 42,
        status: 'success',
        sourceIp: '203.0.113.10',
      }),
    );
  });

  it('persists username when logging tool calls', async () => {
    const activityLoggingService = getActivityLoggingService();

    await activityLoggingService.logToolCall({
      server: 'demo-server',
      tool: 'demo-tool',
      duration: 42,
      status: 'success',
      username: 'alice',
    } as any);

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        username: 'alice',
      }),
    );
  });

  it('stores tool input/output verbatim without redacting field values', async () => {
    const activityLoggingService = getActivityLoggingService();

    await activityLoggingService.logToolCall({
      server: 'demo-server',
      tool: 'demo-tool',
      duration: 1,
      status: 'success',
      input: { authorization: 'Bearer real-token', apiKey: 'sk-live-123' },
      output: { result: 'access_token=stays' },
    });

    const persisted = mockCreate.mock.calls[0][0];
    expect(persisted.input).toContain('Bearer real-token');
    expect(persisted.input).toContain('sk-live-123');
    expect(persisted.input).not.toContain('[REDACTED]');
    expect(persisted.output).toContain('access_token=stays');
  });

  it('omits tool payloads when storeToolPayload is disabled', async () => {
    mockGetCachedSystemConfig.mockReturnValue({ activityLog: { storeToolPayload: false } });
    const activityLoggingService = getActivityLoggingService();

    await activityLoggingService.logToolCall({
      server: 'demo-server',
      tool: 'demo-tool',
      duration: 1,
      status: 'success',
      input: { secret: 'do-not-store' },
      output: { ok: true },
    });

    const persisted = mockCreate.mock.calls[0][0];
    expect(persisted.input).not.toContain('do-not-store');
    expect(persisted.input).toContain('_omitted');
    expect(persisted.output).toContain('_omitted');
  });

  it('stores tool payloads by default when no config is set', async () => {
    const activityLoggingService = getActivityLoggingService();

    await activityLoggingService.logToolCall({
      server: 'demo-server',
      tool: 'demo-tool',
      duration: 1,
      status: 'success',
      input: { value: 'kept' },
    });

    const persisted = mockCreate.mock.calls[0][0];
    expect(persisted.input).toContain('kept');
    expect(persisted.input).not.toContain('_omitted');
  });
});