import { Request, Response } from 'express';

// ── Mock DAO layer ───────────────────────────────────────────────
const mockPromptDao = {
  findAll: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};
const mockResourceDao = {
  findAll: jest.fn(),
  findById: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};

jest.mock('../../src/dao/index.js', () => ({
  getBuiltinPromptDao: () => mockPromptDao,
  getBuiltinResourceDao: () => mockResourceDao,
}));

jest.mock('../../src/services/mcpService.js', () => ({
  handleReadResourceRequest: jest.fn(),
}));

import {
  createBuiltinPrompt,
  updateBuiltinPrompt,
  deleteBuiltinPrompt,
  listBuiltinPrompts,
} from '../../src/controllers/builtinPromptController.js';
import {
  createBuiltinResource,
  updateBuiltinResource,
  deleteBuiltinResource,
} from '../../src/controllers/builtinResourceController.js';

const makeRes = () => {
  const res = {
    json: jest.fn().mockReturnThis(),
    status: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response;
};

const makeReq = (overrides: Record<string, any> = {}) =>
  ({
    body: {},
    params: {},
    user: { username: 'alice', isAdmin: false },
    ...overrides,
  }) as unknown as Request;

describe('built-in prompt/resource write authorization (GHSA-6cvf)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('builtinPromptController writes', () => {
    it('rejects create for a non-admin without touching the DAO', async () => {
      const res = makeRes();
      await createBuiltinPrompt(
        makeReq({ body: { name: 'p', template: 't' } }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockPromptDao.create).not.toHaveBeenCalled();
    });

    it('rejects update for a non-admin', async () => {
      const res = makeRes();
      await updateBuiltinPrompt(makeReq({ params: { id: '1' }, body: { title: 'x' } }), res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockPromptDao.update).not.toHaveBeenCalled();
    });

    it('rejects delete for a non-admin', async () => {
      const res = makeRes();
      await deleteBuiltinPrompt(makeReq({ params: { id: '1' } }), res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockPromptDao.delete).not.toHaveBeenCalled();
    });

    it('allows create/update/delete for an admin', async () => {
      mockPromptDao.create.mockResolvedValue({ id: '1' });
      mockPromptDao.update.mockResolvedValue({ id: '1' });
      mockPromptDao.delete.mockResolvedValue(true);

      const resCreate = makeRes();
      await createBuiltinPrompt(
        makeReq({
          user: { username: 'admin', isAdmin: true },
          body: { name: 'p', template: 't' },
        }),
        resCreate,
      );
      expect(resCreate.status).toHaveBeenCalledWith(201);

      const resUpdate = makeRes();
      await updateBuiltinPrompt(
        makeReq({
          user: { username: 'admin', isAdmin: true },
          params: { id: '1' },
          body: { title: 'x' },
        }),
        resUpdate,
      );
      expect(resUpdate.json).toHaveBeenCalled();

      const resDelete = makeRes();
      await deleteBuiltinPrompt(
        makeReq({ user: { username: 'admin', isAdmin: true }, params: { id: '1' } }),
        resDelete,
      );
      expect(resDelete.json).toHaveBeenCalled();
    });

    it('keeps reads open to non-admins', async () => {
      mockPromptDao.findAll.mockResolvedValue([]);
      const res = makeRes();
      await listBuiltinPrompts(makeReq(), res);
      expect(res.json).toHaveBeenCalled();
    });
  });

  describe('builtinResourceController writes', () => {
    it('rejects create for a non-admin without touching the DAO', async () => {
      const res = makeRes();
      await createBuiltinResource(
        makeReq({ body: { uri: 'file:///a', content: 'c' } }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockResourceDao.create).not.toHaveBeenCalled();
    });

    it('rejects update for a non-admin', async () => {
      const res = makeRes();
      await updateBuiltinResource(makeReq({ params: { id: '1' }, body: { content: 'x' } }), res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockResourceDao.update).not.toHaveBeenCalled();
    });

    it('rejects delete for a non-admin', async () => {
      const res = makeRes();
      await deleteBuiltinResource(makeReq({ params: { id: '1' } }), res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(mockResourceDao.delete).not.toHaveBeenCalled();
    });

    it('allows create for an admin', async () => {
      mockResourceDao.create.mockResolvedValue({ id: '1' });
      const res = makeRes();
      await createBuiltinResource(
        makeReq({
          user: { username: 'admin', isAdmin: true },
          body: { uri: 'file:///a', content: 'c' },
        }),
        res,
      );
      expect(res.status).toHaveBeenCalledWith(201);
    });
  });
});
