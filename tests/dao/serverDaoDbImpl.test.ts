const mockRepository = {
  findAll: jest.fn(),
  findAllPaginated: jest.fn(),
  findByOwnerPaginated: jest.fn(),
  findByName: jest.fn(),
  findById: jest.fn(),
  findAllByName: jest.fn(),
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
    mockRepository.findById.mockImplementation(async (id: string) => ({ id, name: id }));
    mockRepository.findAllByName.mockResolvedValue([]);
  });

  it('should persist and map server description field', async () => {
    const dao = new ServerDaoDbImpl();

    mockRepository.create.mockResolvedValue({
      id: 'server-id',
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
    expect(result.id).toBe('server-id');
  });

  it('finds a server by stable id instead of treating id as a name', async () => {
    const dao = new ServerDaoDbImpl();
    mockRepository.findById.mockResolvedValue({
      id: 'server-b',
      name: 'notion',
      url: 'https://team-b.example/mcp',
      enabled: true,
    });

    const result = await dao.findById('server-b');

    expect(mockRepository.findById).toHaveBeenCalledWith('server-b');
    expect(result).toMatchObject({ id: 'server-b', name: 'notion' });
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
