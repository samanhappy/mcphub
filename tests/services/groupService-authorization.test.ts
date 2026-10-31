import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockGroupDao = {
  findAll: jest.fn(),
  create: jest.fn(),
  findById: jest.fn(),
  findByName: jest.fn(),
  update: jest.fn(),
  updateWithKeyScopes: jest.fn(),
  delete: jest.fn(),
};

const mockServerDao = {
  findAll: jest.fn(),
  findById: jest.fn(),
};

const mockUserContextService = {
  getCurrentUser: jest.fn(),
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
  broadcastToolListChanged: jest.fn(),
  broadcastPromptListChanged: jest.fn(),
  broadcastResourceListChanged: jest.fn(),
}));

jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({
    filterData: (data: any[]) =>
      new (jest.requireActual('../../src/services/dataService.js').DataService)().filterData(data),
  })),
}));

jest.mock('../../src/services/userContextService.js', () => ({
  UserContextService: {
    getInstance: jest.fn(() => mockUserContextService),
  },
}));

import {
  notifyToolChanged,
  broadcastToolListChanged,
  broadcastPromptListChanged,
  broadcastResourceListChanged,
} from '../../src/services/mcpService.js';
import {
  createGroup,
  getAllGroups,
  addServerToGroup,
  deleteGroup,
  removeServerFromGroup,
  updateGroup,
  updateGroupServers,
  updateServerToolsInGroup,
} from '../../src/services/groupService.js';

describe('groupService authorization', () => {
  const adminOwnedGroup = {
    id: 'group-1',
    name: 'admin-group',
    description: 'owned by admin',
    owner: 'admin',
    servers: [{ name: 'server-1', tools: 'all', prompts: 'all', resources: 'all' }],
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockUserContextService.getCurrentUser.mockReturnValue({
      username: 'bob',
      isAdmin: false,
    });

    mockGroupDao.findAll.mockResolvedValue([adminOwnedGroup]);
    mockGroupDao.create.mockImplementation(async (group: any) => group);
    mockGroupDao.findById.mockResolvedValue(adminOwnedGroup);
    mockGroupDao.findByName.mockResolvedValue(null);
    mockGroupDao.update.mockImplementation(async (_id: string, updates: any) => ({
      ...adminOwnedGroup,
      ...updates,
    }));
    mockGroupDao.updateWithKeyScopes.mockImplementation(async (_id: string, updates: any) => ({
      ...adminOwnedGroup,
      ...updates,
    }));
    mockGroupDao.delete.mockResolvedValue(true);

    mockServerDao.findAll.mockResolvedValue([{ name: 'server-1' }, { name: 'server-2' }]);
    mockServerDao.findById.mockResolvedValue({ name: 'server-1' });
  });

  it('rejects updateGroup for non-owner non-admin users', async () => {
    await expect(updateGroup('group-1', { name: 'pwned' })).resolves.toBeNull();
    expect(mockGroupDao.update).not.toHaveBeenCalled();
  });

  it('rejects updateGroupServers for non-owner non-admin users', async () => {
    await expect(updateGroupServers('group-1', ['server-2'])).resolves.toBeNull();
    expect(mockGroupDao.update).not.toHaveBeenCalled();
  });

  it('rejects deleteGroup for non-owner non-admin users', async () => {
    await expect(deleteGroup('group-1')).resolves.toBe(false);
    expect(mockGroupDao.delete).not.toHaveBeenCalled();
  });

  it('rejects addServerToGroup for non-owner non-admin users', async () => {
    mockServerDao.findById.mockResolvedValue({ name: 'server-2' });

    await expect(addServerToGroup('group-1', 'server-2')).resolves.toBeNull();
    expect(mockGroupDao.update).not.toHaveBeenCalled();
  });

  it('rejects removeServerFromGroup for non-owner non-admin users', async () => {
    await expect(removeServerFromGroup('group-1', 'server-1')).resolves.toBeNull();
    expect(mockGroupDao.update).not.toHaveBeenCalled();
  });

  it('rejects updateServerToolsInGroup for non-owner non-admin users', async () => {
    await expect(
      updateServerToolsInGroup('group-1', 'server-1', ['dangerous-tool']),
    ).resolves.toBeNull();
    expect(mockGroupDao.update).not.toHaveBeenCalled();
  });

  it('notifies tool list listeners when a server is removed from a group, like every other group mutation', async () => {
    mockUserContextService.getCurrentUser.mockReturnValue({
      username: 'superadmin',
      isAdmin: true,
    });

    await expect(removeServerFromGroup('group-1', 'server-1')).resolves.toEqual(
      expect.objectContaining({ servers: [] }),
    );
    expect(broadcastToolListChanged).toHaveBeenCalledTimes(1);
    expect(broadcastPromptListChanged).toHaveBeenCalledTimes(1);
    expect(broadcastResourceListChanged).toHaveBeenCalledTimes(1);
    expect(notifyToolChanged).not.toHaveBeenCalled();
  });

  it.each([
    ['metadata', () => updateGroup('group-1', { description: 'updated' })],
    ['membership replacement', () => updateGroupServers('group-1', ['server-2'])],
    ['membership addition', () => addServerToGroup('group-1', 'server-2')],
  ])(
    'broadcasts all capability lists without reconnecting on %s changes',
    async (_name, mutate) => {
      mockUserContextService.getCurrentUser.mockReturnValue({ username: 'admin', isAdmin: true });
      await expect(mutate()).resolves.not.toBeNull();
      expect(notifyToolChanged).not.toHaveBeenCalled();
      expect(broadcastToolListChanged).toHaveBeenCalledTimes(1);
      expect(broadcastPromptListChanged).toHaveBeenCalledTimes(1);
      expect(broadcastResourceListChanged).toHaveBeenCalledTimes(1);
    },
  );

  it('broadcasts only tools when the tool selection changes', async () => {
    mockUserContextService.getCurrentUser.mockReturnValue({ username: 'admin', isAdmin: true });
    await expect(updateServerToolsInGroup('group-1', 'server-1', [])).resolves.not.toBeNull();
    expect(notifyToolChanged).not.toHaveBeenCalled();
    expect(broadcastToolListChanged).toHaveBeenCalledTimes(1);
    expect(broadcastPromptListChanged).not.toHaveBeenCalled();
    expect(broadcastResourceListChanged).not.toHaveBeenCalled();
  });

  it('does not write or notify when adding an existing member', async () => {
    mockUserContextService.getCurrentUser.mockReturnValue({ username: 'admin', isAdmin: true });
    await expect(addServerToGroup('group-1', 'server-1')).resolves.toEqual(adminOwnedGroup);
    expect(mockGroupDao.update).not.toHaveBeenCalled();
    expect(notifyToolChanged).not.toHaveBeenCalled();
    expect(broadcastToolListChanged).not.toHaveBeenCalled();
    expect(broadcastPromptListChanged).not.toHaveBeenCalled();
    expect(broadcastResourceListChanged).not.toHaveBeenCalled();
  });

  it('allows admins to mutate groups they do not own', async () => {
    mockUserContextService.getCurrentUser.mockReturnValue({
      username: 'superadmin',
      isAdmin: true,
    });

    await expect(updateGroup('group-1', { name: 'admin-approved' })).resolves.toEqual(
      expect.objectContaining({
        id: 'group-1',
        name: 'admin-approved',
      }),
    );
    expect(mockGroupDao.updateWithKeyScopes).toHaveBeenCalledWith('group-1', {
      name: 'admin-approved',
    });
  });

  it('moves bearer key scopes only when the group is renamed', async () => {
    mockUserContextService.getCurrentUser.mockReturnValue({
      username: 'superadmin',
      isAdmin: true,
    });

    await updateGroup('group-1', { description: 'same name' });
    await updateGroup('group-1', { name: 'admin-group', description: 'still same name' });
    expect(mockGroupDao.updateWithKeyScopes).not.toHaveBeenCalled();
    expect(mockGroupDao.update).toHaveBeenCalledTimes(2);
  });

  it('fails the rename when the atomic group and key update fails', async () => {
    mockUserContextService.getCurrentUser.mockReturnValue({
      username: 'superadmin',
      isAdmin: true,
    });
    mockGroupDao.updateWithKeyScopes.mockRejectedValueOnce(new Error('write failed'));

    await expect(updateGroup('group-1', { name: 'renamed-group' })).resolves.toBeNull();
    expect(mockGroupDao.update).not.toHaveBeenCalled();
    expect(notifyToolChanged).not.toHaveBeenCalled();
  });

  it('allows non-admin owners to mutate their own groups', async () => {
    mockGroupDao.findById.mockResolvedValue({
      ...adminOwnedGroup,
      owner: 'bob',
    });

    await expect(deleteGroup('group-1')).resolves.toBe(true);
    expect(mockGroupDao.delete).toHaveBeenCalledWith('group-1');
  });
});
describe('group visibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUserContextService.getCurrentUser.mockReturnValue({ username: 'alice', isAdmin: false });
    mockGroupDao.findByName.mockResolvedValue(null);
    mockGroupDao.create.mockImplementation(async (group: any) => group);
    mockServerDao.findAll.mockResolvedValue([
      { name: 'visible', visibility: 'public', owner: 'admin' },
      { name: 'secret', visibility: 'private', owner: 'admin' },
    ]);
  });

  it('creates private groups by default', async () => {
    await expect(createGroup('team', undefined, [], 'alice')).resolves.toMatchObject({
      visibility: 'private',
    });
  });

  it('lists shared/public groups without exposing private nested server configuration', async () => {
    const groups = [
      {
        id: 'shared',
        name: 'shared',
        owner: 'admin',
        visibility: 'group',
        sharedWithUsers: ['alice'],
        servers: [{ name: 'secret', alias: 'secret-alias', tools: ['secret-tool'] }, 'visible'],
      },
      { id: 'public', name: 'public', owner: 'admin', visibility: 'public', servers: ['visible'] },
      {
        id: 'private',
        name: 'private',
        owner: 'admin',
        visibility: 'private',
        servers: ['visible'],
      },
      { id: 'legacy', name: 'legacy', owner: 'admin', servers: ['visible'] },
    ];
    mockGroupDao.findAll.mockResolvedValue(groups);
    const result = await getAllGroups();
    expect(result.map((g) => g.id)).toEqual(['shared', 'public']);
    expect(result[0].servers).toEqual(['visible']);
    expect(groups[0].servers).toHaveLength(2);
    expect(mockServerDao.findAll).toHaveBeenCalledTimes(1);
  });

  it('preserves hidden server entries when an owner saves the visible selection', async () => {
    const group = { id: 'own', name: 'own', owner: 'alice', servers: ['secret', 'visible'] };
    mockGroupDao.findById.mockResolvedValue(group);
    mockGroupDao.update.mockImplementation(async (_id: string, data: any) => ({
      ...group,
      ...data,
    }));
    await updateGroup('own', { servers: [] });
    expect(mockGroupDao.update).toHaveBeenCalledWith(
      'own',
      expect.objectContaining({ servers: [expect.objectContaining({ name: 'secret' })] }),
    );
  });
});
