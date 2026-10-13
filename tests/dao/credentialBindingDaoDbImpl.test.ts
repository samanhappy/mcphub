const mockRepository = {
  find: jest.fn(),
};

jest.mock('../../src/db/connection.js', () => ({
  getAppDataSource: () => ({
    getRepository: () => mockRepository,
  }),
}));

import { CredentialBindingDaoDbImpl } from '../../src/dao/CredentialBindingDaoDbImpl.js';

describe('CredentialBindingDaoDbImpl.listUsernames', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('selects only the usernames bound to the requested server', async () => {
    mockRepository.find.mockResolvedValue([{ username: 'alice' }, { username: 'bob' }]);

    await expect(
      new CredentialBindingDaoDbImpl().listUsernames('private-api'),
    ).resolves.toEqual(['alice', 'bob']);

    expect(mockRepository.find).toHaveBeenCalledWith({
      where: { serverName: 'private-api' },
      select: { username: true },
    });
  });

  it('returns an empty list when no user bound the server', async () => {
    mockRepository.find.mockResolvedValue([]);

    await expect(
      new CredentialBindingDaoDbImpl().listUsernames('private-api'),
    ).resolves.toEqual([]);
  });
});

test('conditional database writes reject a stale OAuth binding revision', async () => {
  const update = jest.fn().mockResolvedValueOnce({ affected: 0 }).mockResolvedValueOnce({ affected: 1 });
  Object.assign(mockRepository, { update });
  const dao = new CredentialBindingDaoDbImpl();
  const binding = { serverName: 'gitlab', username: 'alice', encryptedValues: 'new', updatedAt: new Date().toISOString() };
  expect(await dao.compareAndSave(binding, 'stale')).toBe(false);
  expect(await dao.compareAndSave(binding, 'current')).toBe(true);
  expect(update).toHaveBeenLastCalledWith({ serverName: 'gitlab', username: 'alice', encryptedValues: 'current' }, binding);
});
