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

  it('should unpack startOnDemand/idleTimeoutMs mirrored inside the options JSON blob back to top-level fields on read', async () => {
    // The `servers` table has no dedicated startOnDemand/idleTimeoutMs columns, so
    // normalizeServerConfigForPersistence() piggybacks them onto the schema-less
    // `options` column. mapToServerConfig() must unpack them back out so the rest
    // of the app (which reads config.startOnDemand / config.idleTimeoutMs at the
    // top level) sees them after a DB round-trip.
    const dao = new ServerDaoDbImpl();

    mockRepository.findByName.mockResolvedValue({
      name: 'on-demand-server',
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'demo-server'],
      enabled: true,
      options: {
        timeout: 5000,
        startOnDemand: true,
        idleTimeoutMs: 120000,
      },
    });

    const result = await dao.findById('on-demand-server');

    expect(result?.startOnDemand).toBe(true);
    expect(result?.idleTimeoutMs).toBe(120000);
    // The mirrored keys must not leak into the plain request-options object.
    expect(result?.options).toEqual({ timeout: 5000 });
  });

  it('should leave startOnDemand/idleTimeoutMs undefined when not present in stored options', async () => {
    const dao = new ServerDaoDbImpl();

    mockRepository.findByName.mockResolvedValue({
      name: 'always-on-server',
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'demo-server'],
      enabled: true,
      options: { timeout: 5000 },
    });

    const result = await dao.findById('always-on-server');

    expect(result?.startOnDemand).toBeUndefined();
    expect(result?.idleTimeoutMs).toBeUndefined();
    expect(result?.options).toEqual({ timeout: 5000 });
  });

  it('should mirror startOnDemand/idleTimeoutMs into options on create() even when the caller bypassed normalizeServerConfigForPersistence', async () => {
    // templateService.importTemplate() calls mcpService.addServer(), which calls
    // ServerDao.create() directly with a raw ServerConfig - it never runs through
    // normalizeServerConfigForPersistence(). The DAO must mirror the fields itself
    // so a template import still persists startOnDemand/idleTimeoutMs in database
    // mode. See PR #1095 review discussion.
    const dao = new ServerDaoDbImpl();

    mockRepository.create.mockResolvedValue({
      name: 'templated-server',
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'demo-server'],
      enabled: true,
      options: { startOnDemand: true, idleTimeoutMs: 120000 },
    });

    await dao.create({
      name: 'templated-server',
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'demo-server'],
      startOnDemand: true,
      idleTimeoutMs: 120000,
    });

    expect(mockRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        options: { startOnDemand: true, idleTimeoutMs: 120000 },
      }),
    );
  });

  it('should not mirror startOnDemand into options on create() when not set', async () => {
    const dao = new ServerDaoDbImpl();

    mockRepository.create.mockResolvedValue({
      name: 'always-on-server',
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'demo-server'],
      enabled: true,
    });

    await dao.create({
      name: 'always-on-server',
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'demo-server'],
    });

    expect(mockRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        options: undefined,
      }),
    );
  });

  it('should mirror startOnDemand/idleTimeoutMs into options on update() even when only those top-level fields are provided', async () => {
    // Simulates a direct DAO update() call that only touches startOnDemand,
    // without going through normalizeServerConfigForPersistence and without an
    // `options` key at all. The DAO must read the current row and merge, rather
    // than dropping the change or wiping unrelated stored options.
    const dao = new ServerDaoDbImpl();

    mockRepository.findByName.mockResolvedValue({
      name: 'templated-server',
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'demo-server'],
      enabled: true,
      options: { timeout: 5000 },
    });

    mockRepository.update.mockResolvedValue({
      name: 'templated-server',
      type: 'stdio',
      enabled: true,
      options: { timeout: 5000, startOnDemand: true, idleTimeoutMs: 120000 },
    });

    await dao.update('templated-server', {
      startOnDemand: true,
      idleTimeoutMs: 120000,
    });

    expect(mockRepository.findByName).toHaveBeenCalledWith('templated-server');
    expect(mockRepository.update).toHaveBeenCalledWith('templated-server', {
      options: { timeout: 5000, startOnDemand: true, idleTimeoutMs: 120000 },
    });
  });

  it('should not read the current row on update() when options is explicitly provided', async () => {
    const dao = new ServerDaoDbImpl();

    mockRepository.update.mockResolvedValue({
      name: 'normalized-server',
      type: 'stdio',
      enabled: true,
      options: { startOnDemand: true },
    });

    await dao.update('normalized-server', {
      options: { startOnDemand: true } as any,
      startOnDemand: true,
    });

    expect(mockRepository.findByName).not.toHaveBeenCalled();
    expect(mockRepository.update).toHaveBeenCalledWith('normalized-server', {
      options: { startOnDemand: true },
    });
  });
});


test('credential templates survive database create, partial update and explicit removal', async () => {
  const dao = new ServerDaoDbImpl();
  const credentialTemplate = [{ target: 'env' as const, name: 'PERSONAL_KEY' }];
  mockRepository.create.mockResolvedValue({ name: 'shared', enabled: true, credentialTemplate });
  expect((await dao.create({ name: 'shared', credentialTemplate })).credentialTemplate).toEqual(credentialTemplate);
  expect(mockRepository.create).toHaveBeenCalledWith(expect.objectContaining({ credentialTemplate }));
  mockRepository.update.mockResolvedValue({ name: 'shared', enabled: true, credentialTemplate });
  expect((await dao.update('shared', { credentialTemplate }))?.credentialTemplate).toEqual(credentialTemplate);
  expect(mockRepository.update).toHaveBeenCalledWith('shared', { credentialTemplate });
  await dao.update('shared', { credentialTemplate: undefined });
  expect(mockRepository.update).toHaveBeenLastCalledWith('shared', { credentialTemplate: null });
});
