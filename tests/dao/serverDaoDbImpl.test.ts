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

  it('should persist and map passthroughHeaders field', async () => {
    const dao = new ServerDaoDbImpl();
    const headers = ['Authorization', 'X-Custom-User-Id'];

    mockRepository.create.mockResolvedValue({
      name: 'sse-server',
      type: 'sse',
      url: 'http://localhost:8080/sse',
      enabled: true,
      passthroughHeaders: headers,
    });

    const result = await dao.create({
      name: 'sse-server',
      type: 'sse',
      url: 'http://localhost:8080/sse',
      passthroughHeaders: headers,
    });

    expect(mockRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'sse-server',
        passthroughHeaders: headers,
      }),
    );

    expect(result.passthroughHeaders).toEqual(headers);
  });

  it('should persist passthroughHeaders on update', async () => {
    const dao = new ServerDaoDbImpl();
    const headers = ['Authorization'];

    mockRepository.update.mockResolvedValue({
      name: 'sse-server',
      type: 'sse',
      url: 'http://localhost:8080/sse',
      enabled: true,
      passthroughHeaders: headers,
    });

    const result = await dao.update('sse-server', {
      passthroughHeaders: headers,
    });

    expect(mockRepository.update).toHaveBeenCalledWith(
      'sse-server',
      expect.objectContaining({
        passthroughHeaders: headers,
      }),
    );

    expect(result?.passthroughHeaders).toEqual(headers);
  });

  it('should persist and map explicit shared users', async () => {
    const dao = new ServerDaoDbImpl();
    const sharedWithUsers = ['alice', 'bob'];

    mockRepository.create.mockResolvedValue({
      name: 'shared-server',
      type: 'sse',
      url: 'https://example.com/sse',
      enabled: true,
      visibility: 'group',
      sharedWithUsers,
    });

    const result = await dao.create({
      name: 'shared-server',
      type: 'sse',
      url: 'https://example.com/sse',
      visibility: 'group',
      sharedWithUsers,
    });

    expect(mockRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ sharedWithUsers }),
    );
    expect(result.sharedWithUsers).toEqual(sharedWithUsers);
  });

  it('persists credential template and on-demand lifecycle metadata', async () => {
    const dao = new ServerDaoDbImpl();
    const credentialTemplate = { env: { PERSONAL_TOKEN: { label: 'Personal token' } } };
    mockRepository.create.mockResolvedValue({
      name: 'personal-server',
      type: 'stdio',
      command: 'node',
      enabled: true,
      credentialTemplate,
      startOnDemand: true,
      idleTimeoutMs: 120000,
    });

    const result = await dao.create({
      name: 'personal-server',
      type: 'stdio',
      command: 'node',
      credentialTemplate,
      startOnDemand: true,
      idleTimeoutMs: 120000,
    });

    expect(mockRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ credentialTemplate, startOnDemand: true, idleTimeoutMs: 120000 }),
    );
    expect(result).toMatchObject({ credentialTemplate, startOnDemand: true, idleTimeoutMs: 120000 });
  });

  it('should persist explicit shared-user updates', async () => {
    const dao = new ServerDaoDbImpl();

    mockRepository.update.mockResolvedValue({
      name: 'shared-server',
      enabled: true,
      visibility: 'group',
      sharedWithUsers: ['alice'],
    });

    await dao.update('shared-server', { sharedWithUsers: ['alice'] });

    expect(mockRepository.update).toHaveBeenCalledWith('shared-server', {
      sharedWithUsers: ['alice'],
    });
  });

  it('should convert explicit undefined updates into null for nullable DB fields', async () => {
    const dao = new ServerDaoDbImpl();

    mockRepository.update.mockResolvedValue({
      name: 'sse-server',
      type: 'sse',
      url: null,
      description: null,
      headers: {},
      env: {},
      keepAliveInterval: null,
      enabled: true,
    });

    await dao.update('sse-server', {
      description: undefined,
      url: undefined,
      headers: {},
      env: {},
      keepAliveInterval: undefined,
    });

    expect(mockRepository.update).toHaveBeenCalledWith('sse-server', {
      description: null,
      url: null,
      headers: {},
      env: {},
      keepAliveInterval: null,
    });
  });

  it('should not wipe unrelated fields during partial updates', async () => {
    const dao = new ServerDaoDbImpl();

    mockRepository.update.mockResolvedValue({
      name: 'sse-server',
      enabled: true,
      tools: {},
    });

    await dao.update('sse-server', {
      tools: {},
    });

    expect(mockRepository.update).toHaveBeenCalledWith('sse-server', {
      tools: {},
    });
  });
});
