// Regression tests for GHSA-p589-v5cm-35qg: template export must apply the
// same ownership/visibility filtering as every other read path.

const mockServerDao = { findAll: jest.fn(), findById: jest.fn() };
const mockGroupDao = { findAll: jest.fn(), findById: jest.fn() };

jest.mock('../../src/dao/index.js', () => ({
  getServerDao: () => mockServerDao,
  getGroupDao: () => mockGroupDao,
}));

jest.mock('../../src/services/groupService.js', () => ({
  createGroup: jest.fn(),
}));

jest.mock('../../src/services/mcpService.js', () => ({
  addServer: jest.fn(),
}));

import {
  exportTemplate,
  exportGroupTemplate,
} from '../../src/services/templateService.js';

const alice = { username: 'alice', isAdmin: false };
const admin = { username: 'admin', isAdmin: true };

const servers = [
  { name: 'alice-private', owner: 'alice', visibility: 'private', enabled: true, url: 'http://a' },
  { name: 'bob-private', owner: 'bob', visibility: 'private', enabled: true, url: 'http://b' },
  {
    name: 'bob-public',
    owner: 'bob',
    visibility: 'public',
    enabled: true,
    url: 'http://c',
  },
];

const groups = [
  {
    id: 'g-alice',
    name: 'AliceG',
    description: '',
    owner: 'alice',
    visibility: 'private',
    servers: [{ name: 'alice-private', tools: 'all', prompts: 'all', resources: 'all' }],
  },
  {
    id: 'g-bob',
    name: 'BobG',
    description: '',
    owner: 'bob',
    visibility: 'private',
    servers: [{ name: 'bob-private', tools: 'all', prompts: 'all', resources: 'all' }],
  },
  {
    id: 'g-mixed',
    name: 'MixedG',
    description: '',
    owner: 'alice',
    visibility: 'private',
    servers: [
      { name: 'bob-public', tools: 'all', prompts: 'all', resources: 'all' },
      { name: 'bob-private', tools: 'all', prompts: 'all', resources: 'all' },
    ],
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockServerDao.findAll.mockResolvedValue(servers);
  mockGroupDao.findAll.mockResolvedValue(groups);
});

describe('template export ownership filtering (GHSA-p589)', () => {
  it('non-admin full export excludes other users’ private servers and groups', async () => {
    const tpl = await exportTemplate({ name: 't', requestingUser: alice });
    expect(tpl.groups.map((g) => g.name).sort()).toEqual(['AliceG', 'MixedG']);
    expect(Object.keys(tpl.servers).sort()).toEqual(['alice-private', 'bob-public']);
  });

  it('admin full export still sees everything', async () => {
    const tpl = await exportTemplate({ name: 't', requestingUser: admin });
    expect(tpl.groups.map((g) => g.name).sort()).toEqual(['AliceG', 'BobG', 'MixedG']);
    expect(Object.keys(tpl.servers).sort()).toEqual([
      'alice-private',
      'bob-private',
      'bob-public',
    ]);
  });

  it('no requestingUser keeps the legacy unfiltered behavior (system callers)', async () => {
    const tpl = await exportTemplate({ name: 't' });
    expect(Object.keys(tpl.servers)).toHaveLength(3);
  });

  it('non-admin cannot export another user’s private group by ID', async () => {
    mockGroupDao.findById.mockResolvedValue(groups[1]);
    await expect(exportGroupTemplate('g-bob', undefined, alice)).resolves.toBeNull();
  });

  it('non-admin exporting own group drops invisible servers from it', async () => {
    mockGroupDao.findById.mockResolvedValue(groups[2]);
    const tpl = await exportGroupTemplate('g-mixed', undefined, alice);
    expect(tpl).not.toBeNull();
    expect(Object.keys(tpl!.servers)).toEqual(['bob-public']);
    expect(tpl!.groups[0].servers.map((s) => s.name)).toEqual(['bob-public']);
  });

  it('non-admin exporting own group keeps its own servers', async () => {
    mockGroupDao.findById.mockResolvedValue(groups[0]);
    const tpl = await exportGroupTemplate('g-alice', undefined, alice);
    expect(tpl).not.toBeNull();
    expect(tpl!.groups[0].name).toBe('AliceG');
  });

  it('admin can export any group by ID', async () => {
    mockGroupDao.findById.mockResolvedValue(groups[1]);
    const tpl = await exportGroupTemplate('g-bob', undefined, admin);
    expect(tpl).not.toBeNull();
    expect(tpl!.groups[0].name).toBe('BobG');
  });
});
