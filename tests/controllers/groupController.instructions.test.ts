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
  updateGroup: jest.fn(async (id: string, data: object) => ({ id, name: id, ...data })),
  presentGroup: jest.fn(async (group: unknown) => group),
}));

import {
  batchCreateGroups,
  createNewGroup,
  updateExistingGroup,
} from '../../src/controllers/groupController.js';
import { createGroup, updateGroup } from '../../src/services/groupService.js';

const mockResponse = () => {
  const res = {} as Response;
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
};

const MESSAGE = 'Group instructions must be a string';

describe('groupController instructions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('passes instructions through on create', async () => {
    const res = mockResponse();
    await createNewGroup({ body: { name: 'g', instructions: 'Use fetch first.' } } as Request, res);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(createGroup).toHaveBeenCalledWith('g', undefined, [], 'admin', {
      visibility: undefined,
      sharedWithUsers: undefined,
      instructions: 'Use fetch first.',
    });
  });

  it('rejects non-string instructions on create', async () => {
    const res = mockResponse();
    await createNewGroup({ body: { name: 'g', instructions: ['a'] } } as Request, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: MESSAGE });
    expect(createGroup).not.toHaveBeenCalled();
  });

  it('passes instructions through and rejects non-strings in a batch create', async () => {
    const res = mockResponse();
    await batchCreateGroups(
      {
        body: {
          groups: [
            { name: 'ok', instructions: 'Search first.' },
            { name: 'bad', instructions: 42 },
          ],
        },
      } as Request,
      res,
    );

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.results).toEqual([
      { name: 'ok', success: true, message: 'Group created successfully' },
      { name: 'bad', success: false, message: MESSAGE },
    ]);
    expect(createGroup).toHaveBeenCalledTimes(1);
    expect((createGroup as jest.Mock).mock.calls[0][4]).toMatchObject({
      instructions: 'Search first.',
    });
  });

  it('updates instructions alone, including clearing them', async () => {
    for (const instructions of ['New text.', '']) {
      const res = mockResponse();
      await updateExistingGroup(
        { params: { id: 'g1' }, body: { instructions } } as unknown as Request,
        res,
      );

      expect(res.status).not.toHaveBeenCalledWith(400);
      expect(updateGroup).toHaveBeenLastCalledWith('g1', { instructions });
    }
  });

  it('rejects non-string instructions on update', async () => {
    const res = mockResponse();
    await updateExistingGroup(
      { params: { id: 'g1' }, body: { instructions: { text: 'x' } } } as unknown as Request,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, message: MESSAGE });
    expect(updateGroup).not.toHaveBeenCalled();
  });
});
