const mockUpdate = jest.fn();
const mockFindAll = jest.fn();
const mockUpdateMany = jest.fn();
jest.mock('../../src/db/repositories/BearerKeyRepository.js', () => ({
  BearerKeyRepository: jest
    .fn()
    .mockImplementation(() => ({
      update: mockUpdate,
      findAll: mockFindAll,
      updateMany: mockUpdateMany,
    })),
}));
import { BearerKeyDaoDbImpl } from '../../src/dao/BearerKeyDaoDbImpl.js';
import { toStoredToken } from '../../src/utils/bearerKeyToken.js';

it('persists rotated token hashes and clears legacy plaintext in database mode', async () => {
  const stored = toStoredToken('mcphub_new-secret');
  mockUpdate.mockResolvedValue({
    id: 'key',
    name: 'key',
    enabled: false,
    kind: 'user',
    owner: 'alice',
    accessType: 'all',
    ...stored,
    token: null,
  });
  const updated = await new BearerKeyDaoDbImpl().update('key', { ...stored, token: undefined });
  expect(mockUpdate).toHaveBeenCalledWith(
    'key',
    expect.objectContaining({ ...stored, token: null }),
  );
  const fields = Object.fromEntries(
    Object.entries(mockUpdate.mock.calls[0][1]).filter(([, value]) => value !== undefined),
  );
  expect(fields).toEqual({ ...stored, token: null });
  expect(updated).toMatchObject({
    enabled: false,
    kind: 'user',
    owner: 'alice',
    tokenHash: stored.tokenHash,
  });
  expect(updated?.token).toBeUndefined();
});

it('renames a group in allowedGroups in one atomic write in database mode', async () => {
  mockUpdate.mockReset();
  mockFindAll.mockResolvedValue([
    { id: 'scoped', allowedGroups: ['team-a', 'other'], allowedServers: [] },
    { id: 'also-scoped', allowedGroups: ['team-a'], allowedServers: [] },
    { id: 'by-id', allowedGroups: ['group-a-id'], allowedServers: [] },
    { id: 'server-only', allowedGroups: [], allowedServers: ['team-a'] },
  ]);
  await expect(
    new BearerKeyDaoDbImpl().updateGroupName('team-a', 'team-b', ['group-a-id']),
  ).resolves.toBe(2);
  expect(mockUpdate).not.toHaveBeenCalled();
  expect(mockUpdateMany).toHaveBeenCalledTimes(1);
  expect(mockUpdateMany).toHaveBeenCalledWith([
    { id: 'scoped', changes: { allowedGroups: ['team-b', 'other'] } },
    { id: 'also-scoped', changes: { allowedGroups: ['team-b'] } },
  ]);
});

it('keeps allowedGroups entries that are group IDs in database mode', async () => {
  mockUpdateMany.mockReset();
  mockFindAll.mockResolvedValue([
    { id: 'by-id', allowedGroups: ['group-a-id'], allowedServers: [] },
  ]);
  await expect(
    new BearerKeyDaoDbImpl().updateGroupName('group-a-id', 'renamed', ['group-a-id']),
  ).resolves.toBe(0);
  expect(mockUpdateMany).not.toHaveBeenCalled();
});

it('rejects when the atomic write fails in database mode', async () => {
  mockUpdateMany.mockReset();
  mockUpdateMany.mockRejectedValueOnce(new Error('db down'));
  mockFindAll.mockResolvedValue([{ id: 'scoped', allowedGroups: ['team-a'], allowedServers: [] }]);
  await expect(new BearerKeyDaoDbImpl().updateGroupName('team-a', 'team-b')).rejects.toThrow(
    'db down',
  );
});
