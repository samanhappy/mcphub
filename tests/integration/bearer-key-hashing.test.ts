import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { clearSettingsCache, saveSettings } from '../../src/config/index.js';
import { getBearerKeyDao, JsonFileDaoFactory, setDaoFactory } from '../../src/dao/DaoFactory.js';
import {
  createBearerKey,
  getBearerKeys,
  resetBearerKey,
} from '../../src/controllers/bearerKeyController.js';
import { auth } from '../../src/middlewares/auth.js';
import { authenticatedRouteRateLimiter } from '../../src/utils/rateLimit.js';
import type { McpSettings } from '../../src/types/index.js';

jest.mock('openid-client', () => ({}));

const originalEnv = {
  MCPHUB_SETTING_PATH: process.env.MCPHUB_SETTING_PATH,
  USE_DB: process.env.USE_DB,
};
let settingsPath: string;
let app: express.Express;

const writeSettings = (settings: McpSettings) => {
  fs.writeFileSync(settingsPath, JSON.stringify(settings));
  clearSettingsCache();
};
const onDisk = () => fs.readFileSync(settingsPath, 'utf8');
const get = (token?: string) => {
  const req = request(app).get('/api/protected');
  return token ? req.set('Authorization', `Bearer ${token}`) : req;
};
const baseSettings: McpSettings = {
  mcpServers: {},
  users: [{ username: 'admin', password: 'x', isAdmin: true }],
  systemConfig: { routing: { enableBearerAuth: true, skipAuth: false } },
};

beforeAll(() => {
  settingsPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-bearer-')),
    'settings.json',
  );
  process.env.MCPHUB_SETTING_PATH = settingsPath;
  process.env.USE_DB = 'false';
  JsonFileDaoFactory.getInstance().resetInstances();
  setDaoFactory(JsonFileDaoFactory.getInstance());
  app = express();
  app.use(express.json());
  app.get(
    '/api/protected',
    authenticatedRouteRateLimiter,
    (req, _res, next) => {
      (req as any).t = (value: string) => value;
      next();
    },
    auth,
    (_req, res) => {
      res.json({ ok: true });
    },
  );
});

afterAll(() => {
  fs.rmSync(path.dirname(settingsPath), { recursive: true, force: true });
  JsonFileDaoFactory.getInstance().resetInstances();
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key as keyof typeof originalEnv];
    else process.env[key as keyof typeof originalEnv] = value;
  }
  clearSettingsCache();
});

const fakeRes = () => {
  const res: any = { statusCode: 200, body: undefined, setHeader: jest.fn() };
  res.status = (code: number) => ((res.statusCode = code), res);
  res.json = (body: unknown) => ((res.body = body), res);
  return res;
};
const adminReq = (body: object = {}) =>
  ({ user: { username: 'admin', isAdmin: true }, body }) as any;

describe('bearer keys are stored hashed', () => {
  beforeEach(() => writeSettings({ ...baseSettings, bearerKeys: [] }));

  it('creates a key, shows the token once, authenticates with it and rejects a wrong one', async () => {
    const created = fakeRes();
    await createBearerKey(adminReq({ name: 'ci', accessType: 'all' }), created);
    expect(created.statusCode).toBe(201);
    const token: string = created.body.data.token;
    expect(token).toMatch(/^mcphub_[0-9a-f]{64}$/);

    expect(onDisk()).not.toContain(token);
    expect(JSON.parse(onDisk()).bearerKeys[0].tokenHash).toMatch(/^[0-9a-f]{64}$/);

    expect((await get(token)).status).toBe(200);
    expect((await get(`${token.slice(0, -1)}${token.endsWith('0') ? '1' : '0'}`)).status).toBe(401);
    expect((await get('mcphub_not-a-real-token')).status).toBe(401);
    expect((await get()).status).toBe(401);

    const listed = fakeRes();
    await getBearerKeys(adminReq(), listed);
    const serialized = JSON.stringify(listed.body);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain('tokenHash');
  });

  it.each([true, false])(
    'rotates the secret without changing scope or enabled=%s',
    async (enabled) => {
      const oldToken = 'old-bearer-token';
      const metadata = {
        id: 'rotate',
        name: 'scoped',
        enabled,
        kind: 'system' as const,
        accessType: 'custom' as const,
        allowedGroups: ['team'],
        allowedServers: ['docs'],
      };
      writeSettings({ ...baseSettings, bearerKeys: [{ ...metadata, token: oldToken }] });
      const result = fakeRes();
      await resetBearerKey(
        { ...adminReq({ enabled: !enabled, accessType: 'all' }), params: { id: 'rotate' } },
        result,
      );
      expect(result.statusCode).toBe(200);
      const token = result.body.data.token;
      expect(token).toMatch(/^mcphub_[0-9a-f]{64}$/);
      expect(result.body.data).toMatchObject(metadata);
      expect(result.body.data.tokenHash).toBeUndefined();
      expect(result.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(onDisk()).not.toContain(token);
      expect(onDisk()).not.toContain(oldToken);
      expect(await getBearerKeyDao().findByToken(oldToken)).toBeUndefined();
      expect(await getBearerKeyDao().findByToken(token)).toMatchObject(metadata);
      expect((await get(oldToken)).status).toBe(401);
      // Scoped system keys remain ineligible for dashboard authentication.
      expect((await get(token)).status).toBe(401);
      const listed = fakeRes();
      await getBearerKeys(adminReq(), listed);
      expect(JSON.stringify(listed.body)).not.toContain(token);
    },
  );

  it('authenticates with a rotated all-access key and rejects the previous token', async () => {
    const created = fakeRes();
    await createBearerKey(adminReq({ name: 'all', accessType: 'all' }), created);
    const oldToken = created.body.data.token;
    const result = fakeRes();
    await resetBearerKey({ ...adminReq(), params: { id: created.body.data.id } }, result);
    expect((await get(oldToken)).status).toBe(401);
    expect((await get(result.body.data.token)).status).toBe(200);
  });

  it('allows the owner to reset a user key but rejects other users and system keys', async () => {
    const key = {
      id: 'owned',
      name: 'personal',
      enabled: true,
      kind: 'user' as const,
      owner: 'alice',
      accessType: 'all' as const,
      token: 'old-personal-token',
    };
    writeSettings({
      ...baseSettings,
      bearerKeys: [
        key,
        { ...key, id: 'system', kind: 'system', owner: undefined, token: 'other-system-token' },
      ],
    });
    for (const [username, id] of [
      ['bob', 'owned'],
      ['alice', 'system'],
    ]) {
      const result = fakeRes();
      await resetBearerKey({ user: { username, isAdmin: false }, params: { id } } as any, result);
      expect(result.statusCode).toBe(403);
    }
    expect(await getBearerKeyDao().findByToken(key.token)).toMatchObject({ id: 'owned' });
    const result = fakeRes();
    await resetBearerKey(
      { user: { username: 'alice', isAdmin: false }, params: { id: 'owned' } } as any,
      result,
    );
    expect(result.statusCode).toBe(200);
    expect(result.body.data).toMatchObject({ owner: 'alice', kind: 'user', enabled: true });
    expect(await getBearerKeyDao().findByToken(key.token)).toBeUndefined();
  });

  it('keeps accepting a legacy plaintext key before and after the startup migration', async () => {
    writeSettings({
      ...baseSettings,
      bearerKeys: [
        {
          id: 'old',
          name: 'old',
          token: 'legacy-plain-token',
          enabled: true,
          kind: 'system',
          accessType: 'all',
        },
      ],
    });
    expect((await get('legacy-plain-token')).status).toBe(200);

    expect(await getBearerKeyDao().hashLegacyTokens()).toBe(1);

    expect(onDisk()).not.toContain('legacy-plain-token');
    expect((await get('legacy-plain-token')).status).toBe(200);
    expect((await get('legacy-plain-tokeX')).status).toBe(401);
  });
});
