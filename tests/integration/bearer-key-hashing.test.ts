import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { clearSettingsCache, saveSettings } from '../../src/config/index.js';
import { getBearerKeyDao, JsonFileDaoFactory, setDaoFactory } from '../../src/dao/DaoFactory.js';
import { createBearerKey, getBearerKeys } from '../../src/controllers/bearerKeyController.js';
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
  const res: any = { statusCode: 200, body: undefined };
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
    expect((await get(`${token.slice(0, -1)}0`)).status).toBe(401);
    expect((await get('mcphub_not-a-real-token')).status).toBe(401);
    expect((await get()).status).toBe(401);

    const listed = fakeRes();
    await getBearerKeys(adminReq(), listed);
    const serialized = JSON.stringify(listed.body);
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain('tokenHash');
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
