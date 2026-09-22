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
