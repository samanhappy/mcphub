import type { Request, RequestHandler, Response } from 'express';
import multer from 'multer';
import { getGroupDao } from '../dao/DaoFactory.js';
import {
  listSkillSnapshots,
  MAX_SKILL_BYTES,
  removeSkill,
  saveSkillSnapshot,
  SkillInputError,
  SkillNameConflict,
  skillsAvailable,
  updateSkillPublication,
} from '../services/hostedSkillCatalog.js';
import {
  importRemoteSkill,
  importSkillDirectory,
  searchSkillsCatalog,
  SkillSearchError,
} from '../services/hostedSkillImport.js';
import { logger } from '../utils/logger.js';

const failure = (res: Response, status: number, message: string) =>
  res.status(status).json({ success: false, message });

export const withSkillsApi =
  (handle: (req: Request, res: Response) => Promise<void> | void): RequestHandler =>
  async (req, res) => {
    if (!skillsAvailable()) {
      failure(res, 503, 'The Skills catalog is available in single-instance mode');
      return;
    }
    try {
      await handle(req, res);
    } catch (error) {
      if (error instanceof SkillNameConflict) {
        failure(res, 409, error.message);
        return;
      }
      if (error instanceof SkillInputError) {
        failure(res, 400, error.message);
        return;
      }
      if (error instanceof SkillSearchError) {
        failure(res, 502, error.message);
        return;
      }
      logger.error('Skills catalog request failed', error);
      failure(res, 500, 'Skills catalog request failed');
    }
  };

const receiveDirectory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.ceil((MAX_SKILL_BYTES * 4) / 3) + 1024 * 1024, files: 1, fields: 0 },
}).single('directory');

export const uploadSkillDirectory: RequestHandler = (req, res, next) => {
  if (!skillsAvailable()) {
    failure(res, 503, 'The Skills catalog is available in single-instance mode');
    return;
  }
  receiveDirectory(req, res, (error) => {
    if (error) failure(res, 400, 'Invalid or oversized Skill directory upload');
    else next();
  });
};

export const listHostedSkills = withSkillsApi((_req, res) => {
  res.json({ success: true, data: listSkillSnapshots(({ skill }) => skill) });
});

export const discoverHostedSkills = withSkillsApi(async (req, res) => {
  res.json({ success: true, data: await searchSkillsCatalog(req.query.q) });
});

export const importHostedSkill = withSkillsApi(async (req, res) => {
  const id = req.params.id;
  const url: unknown = req.body?.url;
  const snapshot = req.file
    ? importSkillDirectory(req.file.buffer, id)
    : typeof url === 'string' && url.length <= 4096
      ? await importRemoteSkill(url, id)
      : undefined;
  if (!snapshot)
    throw new SkillInputError('Provide a directory, GitHub directory URL, or skills.sh Skill URL');
  const skill = saveSkillSnapshot(snapshot, id);
  if (!skill) {
    failure(res, 404, 'Skill not found');
    return;
  }
  res.status(id ? 200 : 201).json({ success: true, data: skill });
});

export const publishHostedSkill = withSkillsApi(async (req, res) => {
  const { enabled, global, groupIds } = req.body ?? {};
  if (
    typeof enabled !== 'boolean' ||
    typeof global !== 'boolean' ||
    !Array.isArray(groupIds) ||
    !groupIds.every((id: unknown) => typeof id === 'string')
  ) {
    throw new SkillInputError('Invalid Skill publication settings');
  }
  const validGroups = new Set((await getGroupDao().findAll()).map(({ id }) => id));
  if (groupIds.some((id: string) => !validGroups.has(id))) {
    throw new SkillInputError('Unknown publication group');
  }
  const skill = updateSkillPublication(req.params.id, {
    enabled,
    global,
    groupIds: [...new Set<string>(groupIds)],
  });
  if (!skill) {
    failure(res, 404, 'Skill not found');
    return;
  }
  res.json({ success: true, data: skill });
});

export const deleteHostedSkill = withSkillsApi((req, res) => {
  if (!removeSkill(req.params.id)) {
    failure(res, 404, 'Skill not found');
    return;
  }
  res.json({ success: true });
});
