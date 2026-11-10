import { Request, Response } from 'express';

const mockFindAll = jest.fn();
const mockFindByOwner = jest.fn();
const mockFindById = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockFindUserByUsername = jest.fn();
const mockFindGroupById = jest.fn();
const mockFindGroupByName = jest.fn();

jest.mock('../../src/dao/index.js', () => ({
  getBearerKeyDao: jest.fn(() => ({
    findAll: mockFindAll,
    findByOwner: mockFindByOwner,
    findById: mockFindById,
    create: mockCreate,
    update: mockUpdate,
    delete: mockDelete,
  })),
  getGroupDao: jest.fn(() => ({ findById: mockFindGroupById, findByName: mockFindGroupByName })),
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
    mockFindGroupById.mockResolvedValue(null);
    mockFindGroupByName.mockResolvedValue({ id: 'group-id', name: 'admins' });
  });

  it('lists only the current user keys and masks tokens', async () => {
    mockFindByOwner.mockResolvedValue([
      {
        id: 'key-1',
        name: 'cursor',
        tokenHash: 'deadbeef',
        tokenPrefix: 'mcphub_a',
        enabled: true,
        kind: 'user',
        owner: 'alice',
        accessType: 'all',
      },
    ]);
    const res = makeRes();

    await getBearerKeys(makeReq(), res);

    expect(mockFindByOwner).toHaveBeenCalledWith('alice');
    expect(JSON.stringify((res.json as jest.Mock).mock.calls[0][0])).not.toContain('deadbeef');
    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: [
        expect.objectContaining({
          token: 'mcphub_a...',
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
        accessType: 'groups',
        allowedGroups: ['group-id'],
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
    expect(res.json.mock.calls[0][0].data).not.toHaveProperty('tokenHash');
  });

  it('preserves unrestricted personal keys when scope is omitted', async () => {
    mockFindUserByUsername.mockResolvedValue({ username: 'alice' });
    mockCreate.mockImplementation(async (data) => ({ id: 'key-1', ...data }));
    await createBearerKey(makeReq({ body: { name: 'legacy' } }), makeRes());
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ accessType: 'all', allowedGroups: [] }),
    );
  });

  it.each([
    { accessType: 'servers', allowedServers: ['private'] },
    { accessType: null },
    { accessType: 'groups', allowedGroups: null },
    { accessType: 'groups', allowedGroups: [] },
    { accessType: 'groups', allowedGroups: [42] },
    { accessType: 'groups', allowedGroups: 'admins' },
    { accessType: 'groups', allowedGroups: [''] },
  ])('rejects invalid personal scope %j', async (scope) => {
    mockFindUserByUsername.mockResolvedValue({ username: 'alice' });
    const res = makeRes();
    await createBearerKey(makeReq({ body: { name: 'agent', ...scope } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('rejects unknown group references', async () => {
    mockFindUserByUsername.mockResolvedValue({ username: 'alice' });
    mockFindGroupByName.mockResolvedValue(null);
    const res = makeRes();
    await createBearerKey(
      makeReq({ body: { name: 'agent', accessType: 'groups', allowedGroups: ['missing'] } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('updates the scope of an owned personal key without changing its identity', async () => {
    mockFindById.mockResolvedValue({
      id: 'key-1',
      kind: 'user',
      owner: 'alice',
      accessType: 'all',
    });
    mockUpdate.mockImplementation(async (id, data) => ({ id, ...data }));
    await updateBearerKey(
      makeReq({
        params: { id: 'key-1' },
        body: {
          accessType: 'groups',
          allowedGroups: ['admins'],
          kind: 'system',
          owner: 'bob',
          allowedServers: ['secret'],
        },
      }),
      makeRes(),
    );
    expect(mockUpdate).toHaveBeenCalledWith('key-1', {
      accessType: 'groups',
      allowedGroups: ['group-id'],
      allowedServers: [],
      excludedGroups: [],
      excludedServers: [],
    });
  });

  it('accepts and deduplicates group IDs on administrator-created personal keys', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    mockFindUserByUsername.mockResolvedValue({ username: 'alice' });
    mockFindGroupByName.mockResolvedValue({ id: 'unrelated-id', name: id });
    mockFindGroupById.mockResolvedValue({ id, name: 'admins' });
    mockCreate.mockImplementation(async (data) => ({ id: 'key-1', ...data }));
    await createBearerKey(
      makeReq({
        user: { username: 'admin', isAdmin: true },
        body: {
          name: 'agent',
          kind: 'user',
          owner: 'alice',
          accessType: 'groups',
          allowedGroups: [id, id],
        },
      }),
      makeRes(),
    );
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ owner: 'alice', accessType: 'groups', allowedGroups: [id] }),
    );
  });

  it('can remove the restriction from an owned key', async () => {
    mockFindById.mockResolvedValue({
      id: 'key-1',
      kind: 'user',
      owner: 'alice',
      accessType: 'groups',
      allowedGroups: ['stale'],
    });
    mockUpdate.mockImplementation(async (id, data) => ({ id, ...data }));
    await updateBearerKey(
      makeReq({ params: { id: 'key-1' }, body: { accessType: 'all' } }),
      makeRes(),
    );
    expect(mockUpdate).toHaveBeenCalledWith(
      'key-1',
      expect.objectContaining({ accessType: 'all', allowedGroups: [] }),
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
