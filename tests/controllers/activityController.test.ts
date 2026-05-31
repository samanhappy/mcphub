import { Request, Response } from 'express';

const mockFindPaginated = jest.fn();
const mockGetDistinctServers = jest.fn();
const mockGetDistinctTools = jest.fn();
const mockGetDistinctGroups = jest.fn();
const mockGetDistinctKeyNames = jest.fn();
const mockGetDistinctUsernames = jest.fn();

const mockActivityDao = {
  findPaginated: mockFindPaginated,
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
  getActivityFilterOptions,
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
});
