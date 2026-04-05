const mockGroupDao = {
  findByName: jest.fn(),
  create: jest.fn(),
};

const mockServerDao = {
  findAll: jest.fn(),
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

jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({
    filterData: (data: any) => data,
  })),
}));

import { createGroup } from '../../src/services/groupService.js';

describe('groupService capability selections', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGroupDao.findByName.mockResolvedValue(null);
    mockServerDao.findAll.mockResolvedValue([{ name: 'server1' }]);
    mockGroupDao.create.mockImplementation(async (group: any) => group);
  });

  it('should preserve prompt and resource selections when creating groups', async () => {
    const result = await createGroup(
      'Team A',
      'Capability-scoped group',
      [
        {
          name: 'server1',
          tools: ['search'],
          prompts: ['draft_prompt'],
          resources: ['resource://docs/guide'],
        },
      ],
      'admin',
    );

    expect(result?.servers).toEqual([
      {
        name: 'server1',
        tools: ['search'],
        prompts: ['draft_prompt'],
        resources: ['resource://docs/guide'],
      },
    ]);
  });

  it('should preserve empty capability selections when creating groups', async () => {
    const result = await createGroup(
      'Team Empty',
      'No capabilities selected yet',
      [
        {
          name: 'server1',
          tools: [],
          prompts: [],
          resources: [],
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
});