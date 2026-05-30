import { Request, Response } from 'express';

const mockFindAll = jest.fn();
const mockFindByOwner = jest.fn();
const mockFindById = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockFindUserByUsername = jest.fn();

jest.mock('../../src/dao/index.js', () => ({
  getBearerKeyDao: jest.fn(() => ({
    findAll: mockFindAll,
    findByOwner: mockFindByOwner,
    findById: mockFindById,
    create: mockCreate,
    update: mockUpdate,
    delete: mockDelete,
  })),
  getUserDao: jest.fn(() => ({
    findByUsername: mockFindUserByUsername,
  })),
}));

import {
  createBearerKey,
  deleteBearerKey,
  getBearerKeys,
  updateBearerKey,
} from '../../src/controllers/bearerKeyController.js';

const makeReq = (overrides: Record<string, unknown> = {}) =>
  ({
    body: {},
    params: {},
    user: { username: 'alice', isAdmin: false },
    ...overrides,
  }) as unknown as Request;

const makeRes = () => {
  const res = {
    json: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response;
};

describe('bearerKeyController', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists only the current user keys and masks tokens', async () => {
    mockFindByOwner.mockResolvedValue([
      {
        id: 'key-1',
        name: 'cursor',
        token: 'mcphub_abcdefghijklmnopqrstuvwxyz',
        enabled: true,
        kind: 'user',
        owner: 'alice',
        accessType: 'all',
      },
    ]);
    const res = makeRes();

    await getBearerKeys(makeReq(), res);

    expect(mockFindByOwner).toHaveBeenCalledWith('alice');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [
        expect.objectContaining({
          token: 'mcphub_a...wxyz',
          kind: 'user',
          owner: 'alice',
        }),
      ],
    });
  });

  it('forces non-admin creation to a user-level key owned by the caller', async () => {
    mockFindUserByUsername.mockResolvedValue({ username: 'alice', isAdmin: false });
    mockCreate.mockImplementation(async (data) => ({ id: 'key-1', ...data }));
    const res = makeRes();

    await createBearerKey(
      makeReq({
        body: {
          name: 'cursor',
          kind: 'system',
          owner: 'bob',
          accessType: 'groups',
          allowedGroups: ['admins'],
        },
      }),
      res,
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'cursor',
        kind: 'user',
        owner: 'alice',
        accessType: 'all',
        allowedGroups: [],
        allowedServers: [],
        token: expect.stringMatching(/^mcphub_[0-9a-f]{64}$/),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({ token: expect.stringMatching(/^mcphub_/) }),
      }),
    );
  });

  it('does not allow a user to update another user key', async () => {
    mockFindById.mockResolvedValue({
      id: 'key-2',
      name: 'bob-key',
      token: 'secret',
      enabled: true,
      kind: 'user',
      owner: 'bob',
      accessType: 'all',
    });
    const res = makeRes();

    await updateBearerKey(makeReq({ params: { id: 'key-2' }, body: { enabled: false } }), res);

    expect(mockUpdate).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('does not allow a user to delete another user key', async () => {
    mockFindById.mockResolvedValue({
      id: 'key-2',
      name: 'bob-key',
      token: 'secret',
      enabled: true,
      kind: 'user',
      owner: 'bob',
      accessType: 'all',
    });
    const res = makeRes();

    await deleteBearerKey(makeReq({ params: { id: 'key-2' } }), res);

    expect(mockDelete).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
  });
});
