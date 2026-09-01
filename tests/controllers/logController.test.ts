import { Request, Response } from 'express';

const mockGetLogs = jest.fn();
const mockClearLogs = jest.fn();
const mockSubscribeToStream = jest.fn();

jest.mock('../../src/services/logService.js', () => ({
  default: {
    getLogs: mockGetLogs,
    clearLogs: mockClearLogs,
    subscribeToStream: mockSubscribeToStream,
  },
}));

import { clearLogs, getAllLogs, streamLogs } from '../../src/controllers/logController.js';

const makeRes = () =>
  ({
    json: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
    writeHead: jest.fn(),
    write: jest.fn(),
  }) as unknown as Response;

const makeReq = () =>
  ({
    user: { username: 'alice', isAdmin: false },
    on: jest.fn(),
  }) as unknown as Request;

describe('logController authorization', () => {
  it('rejects non-admin access to log read, clear, and stream endpoints', async () => {
    const handlers = [getAllLogs, clearLogs, streamLogs];

    for (const handler of handlers) {
      const res = makeRes();

      await handler(makeReq(), res);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Admin privileges required',
      });
    }

    expect(mockGetLogs).not.toHaveBeenCalled();
    expect(mockClearLogs).not.toHaveBeenCalled();
    expect(mockSubscribeToStream).not.toHaveBeenCalled();
  });
});
