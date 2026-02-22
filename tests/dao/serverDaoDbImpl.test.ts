const mockRepository = {
  findAll: jest.fn(),
  findAllPaginated: jest.fn(),
  findByOwnerPaginated: jest.fn(),
  findByName: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  exists: jest.fn(),
  count: jest.fn(),
  findByOwner: jest.fn(),
  findEnabled: jest.fn(),
  rename: jest.fn(),
};

jest.mock('../../src/db/repositories/ServerRepository.js', () => ({
  ServerRepository: jest.fn().mockImplementation(() => mockRepository),
}));

import { ServerDaoDbImpl } from '../../src/dao/ServerDaoDbImpl.js';

describe('ServerDaoDbImpl', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should persist and map server description field', async () => {
    const dao = new ServerDaoDbImpl();

    mockRepository.create.mockResolvedValue({
      name: 'serena',
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@test/serena'],
      enabled: true,
      description: 'my server note',
    });

    const result = await dao.create({
      name: 'serena',
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@test/serena'],
      description: 'my server note',
    });

    expect(mockRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'serena',
        description: 'my server note',
      }),
    );

    expect(result.description).toBe('my server note');
  });
});
