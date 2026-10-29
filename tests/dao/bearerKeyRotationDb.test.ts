const mockUpdate = jest.fn();
const mockFindAll = jest.fn();
jest.mock('../../src/db/repositories/BearerKeyRepository.js', () => ({
  BearerKeyRepository: jest
    .fn()
    .mockImplementation(() => ({ update: mockUpdate, findAll: mockFindAll })),
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

it('renames a group in allowedGroups in database mode', async () => {
  mockUpdate.mockReset();
  mockFindAll.mockResolvedValue([
    { id: 'scoped', allowedGroups: ['team-a', 'other'], allowedServers: [] },
    { id: 'server-only', allowedGroups: [], allowedServers: ['team-a'] },
  ]);
  await expect(new BearerKeyDaoDbImpl().updateGroupName('team-a', 'team-b')).resolves.toBe(1);
  expect(mockUpdate).toHaveBeenCalledTimes(1);
  expect(mockUpdate).toHaveBeenCalledWith('scoped', { allowedGroups: ['team-b', 'other'] });
});
