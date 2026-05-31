import { getActivityLoggingService } from '../../src/services/activityLoggingService.js';

const mockCreate = jest.fn();
const mockGetActivityDao = jest.fn(() => ({
  create: mockCreate,
}));
const mockIsActivityLoggingEnabled = jest.fn(() => true);

jest.mock('../../src/dao/DaoFactory.js', () => ({
  getActivityDao: jest.fn(() => mockGetActivityDao()),
  isActivityLoggingEnabled: jest.fn(() => mockIsActivityLoggingEnabled()),
}));

describe('ActivityLoggingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue(undefined);
    mockIsActivityLoggingEnabled.mockReturnValue(true);
    mockGetActivityDao.mockReturnValue({ create: mockCreate });
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
});