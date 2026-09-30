const mockGroupDao = {
  findByName: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};

const mockServerDao = {
  findAll: jest.fn(),
  findById: jest.fn(),
};

jest.mock('../../src/dao/index.js', () => ({
  getGroupDao: jest.fn(() => mockGroupDao),
  getServerDao: jest.fn(() => mockServerDao),
  getSystemConfigDao: jest.fn(() => ({
    get: jest.fn(() => Promise.resolve({ routing: { enableGroupNameRoute: true } })),
  })),
}));

jest.mock('../../src/services/mcpService.js', () => ({
  notifyToolChanged: jest.fn(),
}));

jest.mock('../../src/services/userContextService.js', () => ({
  UserContextService: {
    getInstance: jest.fn(() => ({
      getCurrentUser: jest.fn(() => ({ username: 'admin', isAdmin: true })),
    })),
  },
}));

jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({
    filterData: (data: any) => data,
  })),
}));

import {
  createGroup,
  normalizeGroupServers,
  updateServerToolsInGroup,
} from '../../src/services/groupService.js';

describe('groupService capability selections', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGroupDao.findByName.mockResolvedValue(null);
    mockServerDao.findAll.mockResolvedValue([{ name: 'server1' }, { name: 'server2' }]);
    mockGroupDao.create.mockImplementation(async (group: any) => group);
  });

  it('should preserve prompt and resource selections when creating groups', async () => {
    const result = await createGroup(
      'Team A',
      'Capability-scoped group',
      [
        {
          name: 'server1',
          alias: 'fetch',
          tools: ['search'],
          prompts: ['draft_prompt'],
          resources: ['resource://docs/guide'],
          pinnedTools: ['search'],
        },
      ],
      'admin',
    );

    expect(result?.servers).toEqual([
      {
        name: 'server1',
        alias: 'fetch',
        tools: ['search'],
        prompts: ['draft_prompt'],
        resources: ['resource://docs/guide'],
        pinnedTools: ['search'],
      },
    ]);
  });

  it('should preserve empty capability selections and drop empty pins when creating groups', async () => {
    const result = await createGroup(
      'Team Empty',
      'No capabilities selected yet',
      [
        {
          name: 'server1',
          tools: [],
          prompts: [],
          resources: [],
          pinnedTools: [],
        },
      ],
      'admin',
    );

    expect(result?.servers).toEqual([
      {
        name: 'server1',
        tools: [],
        prompts: [],
        resources: [],
      },
    ]);
  });

  it('rejects duplicate exposed server names in a group', async () => {
    const result = await createGroup(
      'Duplicate aliases',
      'Ambiguous exposed names',
      [
        {
          name: 'server1',
          alias: 'fetch',
          tools: 'all',
          prompts: 'all',
          resources: 'all',
        },
        {
          name: 'server2',
          alias: 'fetch',
          tools: 'all',
          prompts: 'all',
          resources: 'all',
        },
      ],
      'admin',
    );

    expect(result).toBeNull();
    expect(mockGroupDao.create).not.toHaveBeenCalled();
  });
});

describe('groupService pinnedTools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockServerDao.findById.mockResolvedValue({ name: 'server1' });
    mockGroupDao.update.mockImplementation(async (_id: string, data: any) => data);
  });

  it('keeps only string pins from stored configs that bypassed validation', () => {
    const [fromString, fromMixed, fromObject] = normalizeGroupServers([
      { name: 'a', pinnedTools: 'search' as any },
      { name: 'b', pinnedTools: ['search', 1, null, 'fetch'] as any },
      { name: 'c', pinnedTools: { search: true } as any },
    ]);

    expect(fromString).not.toHaveProperty('pinnedTools');
    expect(fromMixed.pinnedTools).toEqual(['search', 'fetch']);
    expect(fromObject).not.toHaveProperty('pinnedTools');
  });

  it('drops the pins of tools deselected through the tools endpoint, like the editor', async () => {
    mockGroupDao.findById.mockResolvedValue({
      id: 'g1',
      name: 'g1',
      owner: 'admin',
      servers: [{ name: 'server1', tools: 'all', pinnedTools: ['search', 'fetch'] }],
    });

    const result = await updateServerToolsInGroup('g1', 'server1', ['search', 'list']);

    expect(result?.servers).toEqual([
      expect.objectContaining({
        name: 'server1',
        tools: ['search', 'list'],
        pinnedTools: ['search'],
      }),
    ]);
  });

  it('removes pinnedTools entirely when no pinned tool stays selected', async () => {
    mockGroupDao.findById.mockResolvedValue({
      id: 'g1',
      name: 'g1',
      owner: 'admin',
      servers: [{ name: 'server1', tools: 'all', pinnedTools: ['fetch'] }],
    });

    const result = await updateServerToolsInGroup('g1', 'server1', ['search']);

    expect(result?.servers[0]).not.toHaveProperty('pinnedTools');
  });

  it('keeps every pin when the selection becomes all tools', async () => {
    mockGroupDao.findById.mockResolvedValue({
      id: 'g1',
      name: 'g1',
      owner: 'admin',
      servers: [{ name: 'server1', tools: ['search'], pinnedTools: ['search'] }],
    });

    const result = await updateServerToolsInGroup('g1', 'server1', 'all');

    expect(result?.servers[0]).toEqual(expect.objectContaining({ pinnedTools: ['search'] }));
  });
});
