import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockGroupDao = {
  findById: jest.fn(),
  findByName: jest.fn(),
  update: jest.fn(),
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
}));

jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({
    filterData: (data: any) => data,
  })),
}));

jest.mock('../../src/services/userContextService.js', () => ({
  UserContextService: {
    getInstance: jest.fn(() => mockUserContextService),
  },
}));

import {
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

    mockGroupDao.findById.mockResolvedValue(adminOwnedGroup);
    mockGroupDao.findByName.mockResolvedValue(null);
    mockGroupDao.update.mockImplementation(async (_id: string, updates: any) => ({
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
    await expect(updateServerToolsInGroup('group-1', 'server-1', ['dangerous-tool'])).resolves.toBeNull();
    expect(mockGroupDao.update).not.toHaveBeenCalled();
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
    expect(mockGroupDao.update).toHaveBeenCalledWith('group-1', { name: 'admin-approved' });
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