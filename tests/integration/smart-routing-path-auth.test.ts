import {
  createNewGroup,
  updateExistingGroup,
  batchCreateGroups,
} from '../../src/controllers/groupController.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { clearSettingsCache, saveSettings } from '../../src/config/index.js';
import {
  getGroupDao,
  getServerDao,
  JsonFileDaoFactory,
  setDaoFactory,
} from '../../src/dao/DaoFactory.js';
import { smartRoutingPathMiddleware } from '../../src/utils/smartRoutingPath.js';
import { sseUserContextMiddleware } from '../../src/middlewares/userContext.js';
import { handleMcpOtherRequest } from '../../src/services/sseService.js';
import type { McpSettings } from '../../src/types/index.js';

jest.mock('openid-client', () => ({}));
jest.mock('../../src/services/mcpService.js', () => ({
  deleteMcpServer: jest.fn(),
  getMcpServer: jest.fn(),
}));

const originalEnv = {
  MCPHUB_SETTING_PATH: process.env.MCPHUB_SETTING_PATH,
  USE_DB: process.env.USE_DB,
  SMART_ROUTING_PATH: process.env.SMART_ROUTING_PATH,
};
let directory: string;
let app: express.Express;
let settings: McpSettings;

beforeAll(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-smart-path-'));
  process.env.MCPHUB_SETTING_PATH = path.join(directory, 'settings.json');
  process.env.USE_DB = 'false';
  process.env.SMART_ROUTING_PATH = 'my_smart';
  settings = {
    mcpServers: { existing: { url: 'http://example.test/mcp' } },
    groups: ['team', 'other'].map((name) => ({
      id: `${name}-id`,
      name,
      servers: [],
      visibility: 'public',
    })),
    users: [],
    bearerKeys: [
      {
        id: 'key',
        name: 'team-key',
        token: 'team-token',
        enabled: true,
        kind: 'system',
        accessType: 'groups',
        allowedGroups: ['team-id'],
      },
    ],
    systemConfig: {
      routing: {
        enableGlobalRoute: true,
        enableGroupNameRoute: true,
        enableBearerAuth: true,
        skipAuth: false,
      },
      oauthServer: { enabled: false },
    },
  };
  fs.writeFileSync(process.env.MCPHUB_SETTING_PATH, JSON.stringify(settings));
  clearSettingsCache();
  JsonFileDaoFactory.getInstance().resetInstances();
  setDaoFactory(JsonFileDaoFactory.getInstance());
  app = express();
  app.use(express.json());
  app.post('/api/groups', createNewGroup);
  app.put('/api/groups/:id', updateExistingGroup);
  app.post('/api/groups/batch', batchCreateGroups);
  app.get(
    '/hub/mcp/:group(.*)',
    smartRoutingPathMiddleware,
    sseUserContextMiddleware,
    handleMcpOtherRequest,
  );
});

afterAll(() => {
  fs.rmSync(directory, { recursive: true, force: true });
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  clearSettingsCache();
  JsonFileDaoFactory.getInstance().resetInstances();
});

it.each(['my_smart', '$smart'])(
  'preserves group-scoped bearer permissions on %s',
  async (segment) => {
    // A permitted request reaches session validation; other scopes are rejected first.
    await request(app)
      .get(`/hub/mcp/${segment}/team`)
      .set('Authorization', 'Bearer team-token')
      .expect(400, 'Invalid or missing session ID');
    await request(app)
      .get(`/hub/mcp/${segment}/other`)
      .set('Authorization', 'Bearer team-token')
      .expect(401);
    await request(app)
      .get(`/hub/mcp/${segment}`)
      .set('Authorization', 'Bearer team-token')
      .expect(401);
    await request(app).get(`/hub/mcp/${segment}/team`).expect(401);
  },
);

it('rejects JSON creates, renames and settings imports without changing persisted data', async () => {
  const before = fs.readFileSync(process.env.MCPHUB_SETTING_PATH!, 'utf8');
  const servers = getServerDao();
  const groups = getGroupDao();
  await expect(servers.create({ name: 'my_smart' })).rejects.toThrow('reserved');
  await expect(servers.rename('existing', 'my_smart')).rejects.toThrow('reserved');
  await expect(groups.create({ name: 'my_smart', servers: [] })).rejects.toThrow('reserved');
  await expect(groups.update('team-id', { name: 'my_smart' })).rejects.toThrow('reserved');
  expect(saveSettings({ ...settings, mcpServers: { my_smart: {} } })).toBe(false);
  expect(fs.readFileSync(process.env.MCPHUB_SETTING_PATH!, 'utf8')).toBe(before);
  expect(await servers.findById('existing')).not.toBeNull();
});

it('returns actionable errors for reserved group creates, renames and batch imports', async () => {
  const created = await request(app).post('/api/groups').send({ name: 'my_smart' }).expect(400);
  expect(created.body.message).toContain('SMART_ROUTING_PATH');
  const renamed = await request(app)
    .put('/api/groups/team-id')
    .send({ name: 'my_smart' })
    .expect(400);
  expect(renamed.body.message).toContain('SMART_ROUTING_PATH');
  const batch = await request(app)
    .post('/api/groups/batch')
    .send({ groups: [{ name: 'my_smart' }] })
    .expect(400);
  expect(JSON.stringify(batch.body)).toContain('SMART_ROUTING_PATH');
});
