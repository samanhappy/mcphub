import { Request, Response } from 'express';

jest.mock('../../src/dao/index.js', () => ({
  getGroupDao: jest.fn(),
  getUserDao: jest.fn(),
}));

jest.mock('../../src/services/groupService.js', () => ({
  createGroup: jest.fn(async (name: string, description: string, servers: unknown) => ({
    id: 'g1',
    name,
    description,
    servers,
  })),
  updateGroupServers: jest.fn(async (id: string, servers: unknown) => ({ id, name: id, servers })),
  updateGroup: jest.fn(async (id: string, data: object) => ({ id, name: id, ...data })),
  presentGroup: jest.fn(async (group: unknown) => group),
}));

import {
  batchCreateGroups,
  createNewGroup,
  updateExistingGroup,
  updateGroupServersBatch,
} from '../../src/controllers/groupController.js';
import { createGroup, updateGroup, updateGroupServers } from '../../src/services/groupService.js';

const mockResponse = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const MESSAGE = 'Server pinnedTools must be an array of tool names';

describe('groupController pinnedTools validation', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects a non-array pinnedTools on create', async () => {
    const res = mockResponse();
    await createNewGroup(
      { body: { name: 'g', servers: [{ name: 's', pinnedTools: 'get_time' }] } } as Request,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: MESSAGE });
    expect(createGroup).not.toHaveBeenCalled();
  });

  it('accepts an array of tool names on create', async () => {
    const res = mockResponse();
    const servers = [{ name: 's', tools: 'all', pinnedTools: ['get_time'] }];
    await createNewGroup({ body: { name: 'g', servers } } as Request, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(createGroup).toHaveBeenCalledWith('g', undefined, servers, 'admin', expect.anything());
  });

  it('rejects non-string pin entries in a batch create', async () => {
    const res = mockResponse();
    await batchCreateGroups(
      { body: { groups: [{ name: 'g', servers: [{ name: 's', pinnedTools: [1] }] }] } } as Request,
      res,
    );

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.results).toEqual([{ name: 'g', success: false, message: MESSAGE }]);
    expect(createGroup).not.toHaveBeenCalled();
  });

  it('rejects a non-array pinnedTools on a servers update', async () => {
    const res = mockResponse();
    await updateGroupServersBatch(
      {
        params: { id: 'g1' },
        body: { servers: [{ name: 's', pinnedTools: { get_time: true } }] },
      } as unknown as Request,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: MESSAGE });
    expect(updateGroupServers).not.toHaveBeenCalled();
  });

  it('rejects a non-array pinnedTools on a group update', async () => {
    const res = mockResponse();
    await updateExistingGroup(
      {
        params: { id: 'g1' },
        body: { servers: [{ name: 's', pinnedTools: 'get_time' }] },
      } as unknown as Request,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: MESSAGE });
    expect(updateGroup).not.toHaveBeenCalled();
  });
});
