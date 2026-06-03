const mockGetServerCosts = jest.fn();
const mockGetGroupCosts = jest.fn();

jest.mock('../../src/services/contextCostService.js', () => ({
  getServerCosts: mockGetServerCosts,
  getGroupCosts: mockGetGroupCosts,
}));

import type { Request, Response } from 'express';
import { getServerCostsHandler, getGroupCostsHandler } from '../../src/controllers/contextCostController.js';

const mockRes = () => {
  const res: Partial<Response> = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res as Response;
};

describe('getServerCostsHandler', () => {
  afterEach(() => jest.clearAllMocks());

  it('responds with success and the server costs', async () => {
    mockGetServerCosts.mockResolvedValue([
      { name: 's1', connected: true, exposed: 100, gross: 150, items: [] },
    ]);
    const res = mockRes();
    await getServerCostsHandler({} as Request, res);
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [{ name: 's1', connected: true, exposed: 100, gross: 150, items: [] }],
    });
  });

  it('responds 500 on service error', async () => {
    mockGetServerCosts.mockRejectedValue(new Error('boom'));
    const res = mockRes();
    await getServerCostsHandler({} as Request, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe('getGroupCostsHandler', () => {
  afterEach(() => jest.clearAllMocks());

  it('responds with success and the group costs', async () => {
    mockGetGroupCosts.mockResolvedValue([]);
    const res = mockRes();
    await getGroupCostsHandler({} as Request, res);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: [] });
  });

  it('responds 500 on service error', async () => {
    mockGetGroupCosts.mockRejectedValue(new Error('boom'));
    const res = mockRes();
    await getGroupCostsHandler({} as Request, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
