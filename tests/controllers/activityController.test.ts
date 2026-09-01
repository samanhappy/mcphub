import { Request, Response } from 'express';

const mockFindPaginated = jest.fn();
const mockFindById = jest.fn();
const mockGetStats = jest.fn();
const mockDeleteOlderThan = jest.fn();
const mockGetDistinctServers = jest.fn();
const mockGetDistinctTools = jest.fn();
const mockGetDistinctGroups = jest.fn();
const mockGetDistinctKeyNames = jest.fn();
const mockGetDistinctUsernames = jest.fn();

const mockActivityDao = {
  findPaginated: mockFindPaginated,
  findById: mockFindById,
  getStats: mockGetStats,
  deleteOlderThan: mockDeleteOlderThan,
  getDistinctServers: mockGetDistinctServers,
  getDistinctTools: mockGetDistinctTools,
  getDistinctGroups: mockGetDistinctGroups,
  getDistinctKeyNames: mockGetDistinctKeyNames,
  getDistinctUsernames: mockGetDistinctUsernames,
};

jest.mock('../../src/dao/DaoFactory.js', () => ({
  getActivityDao: jest.fn(() => mockActivityDao),
  isActivityLoggingEnabled: jest.fn(() => true),
}));

import {
  getActivities,
  getActivityById,
  getActivityFilterOptions,
  getActivityStats,
  deleteOldActivities,
} from '../../src/controllers/activityController.js';

const makeRes = () =>
  ({
    json: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
  }) as unknown as Response;

const makeReq = (overrides: Record<string, any> = {}) =>
  ({
    query: {},
    params: {},
    user: { username: 'admin', isAdmin: true },
    ...overrides,
  }) as unknown as Request;

describe('activityController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindPaginated.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });
    mockGetDistinctServers.mockResolvedValue(['server-a']);
    mockGetDistinctTools.mockResolvedValue(['tool-a']);
    mockGetDistinctGroups.mockResolvedValue(['group-a']);
    mockGetDistinctKeyNames.mockResolvedValue(['key-a']);
    mockGetDistinctUsernames.mockResolvedValue(['alice']);
    mockFindById.mockResolvedValue(null);
    mockGetStats.mockResolvedValue({ total: 0 });
    mockDeleteOlderThan.mockResolvedValue(0);
  });

  it('passes username filters through to the activity DAO', async () => {
    const req = makeReq({
      query: {
        page: '1',
        limit: '20',
        username: 'alice',
      },
    });
    const res = makeRes();

    await getActivities(req, res);

    expect(mockFindPaginated).toHaveBeenCalledWith(
      1,
      20,
      expect.objectContaining({
        username: 'alice',
      }),
    );
  });

  it('includes usernames in filter options', async () => {
    const req = makeReq();
    const res = makeRes();

    await getActivityFilterOptions(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        servers: ['server-a'],
        tools: ['tool-a'],
        groups: ['group-a'],
        keyNames: ['key-a'],
        usernames: ['alice'],
      },
    });
  });

  it('rejects non-admin access to every sensitive activity endpoint', async () => {
    const handlers = [
      [getActivities, { query: {}, params: {} }],
      [getActivityById, { query: {}, params: { id: 'activity-1' } }],
      [getActivityStats, { query: {}, params: {} }],
      [getActivityFilterOptions, { query: {}, params: {} }],
      [deleteOldActivities, { query: {}, params: {} }],
    ] as const;

    for (const [handler, overrides] of handlers) {
      const req = makeReq({
        ...overrides,
        user: { username: 'alice', isAdmin: false },
      });
      const res = makeRes();

      await handler(req, res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Admin privileges required',
      });
    }

    expect(mockFindPaginated).not.toHaveBeenCalled();
    expect(mockFindById).not.toHaveBeenCalled();
    expect(mockGetStats).not.toHaveBeenCalled();
    expect(mockDeleteOlderThan).not.toHaveBeenCalled();
    expect(mockGetDistinctServers).not.toHaveBeenCalled();
  });
});
