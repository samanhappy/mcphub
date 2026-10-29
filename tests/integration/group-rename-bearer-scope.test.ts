jest.mock('openid-client', () => ({}));
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { JsonFileDaoFactory, setDaoFactory } from '../../src/dao/DaoFactory.js';
import { createNewGroup, updateExistingGroup } from '../../src/controllers/groupController.js';
import { createBearerKey } from '../../src/controllers/bearerKeyController.js';
import { auth } from '../../src/middlewares/auth.js';
import {
  sseUserContextMiddleware,
  userContextMiddleware,
} from '../../src/middlewares/userContext.js';
import { authenticatedRouteRateLimiter } from '../../src/utils/rateLimit.js';
import { handleMcpPostRequest, transports } from '../../src/services/sseService.js';
import { cleanupAllServers, initializeClientsFromSettings } from '../../src/services/mcpService.js';
import { clearSettingsCache } from '../../src/config/index.js';
import { createUserToken } from '../utils/testHelpers.js';
import type { McpSettings } from '../../src/types/index.js';

jest.mock('../../src/services/oauthService.js', () => ({ initializeAllOAuthClients: jest.fn() }));
jest.mock('../../src/services/vectorSearchService.js', () => ({
  removeServerToolEmbeddings: jest.fn(),
  removeToolEmbeddings: jest.fn(),
  saveToolsAsVectorEmbeddings: jest.fn(),
  syncAllServerToolsEmbeddings: jest.fn(),
}));
jest.mock('../../src/services/betterAuthConfig.js', () => ({
  getBetterAuthRuntimeConfig: jest.fn(async () => ({ enabled: false })),
}));

const adminToken = createUserToken('admin', true);
let directory: string;
let app: express.Express;
const originalEnv = {
  MCPHUB_SETTING_PATH: process.env.MCPHUB_SETTING_PATH,
  USE_DB: process.env.USE_DB,
};

const admin = (method: 'post' | 'put', url: string, body: object) =>
  request(app)[method](url).set('x-auth-token', adminToken).send(body);
const initialize = (group: string, token: string) =>
  request(app)
    .post(`/mcp/${group}`)
    .set('Authorization', `Bearer ${token}`)
    .set('Accept', 'application/json, text/event-stream')
    .send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'group-rename-e2e', version: '1' },
      },
    });

beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-group-rename-'));
  process.env.MCPHUB_SETTING_PATH = path.join(directory, 'settings.json');
  process.env.USE_DB = 'false';
  const settings: McpSettings = {
    mcpServers: {},
    users: [{ username: 'admin', password: 'unused', isAdmin: true }],
    groups: [],
    bearerKeys: [],
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
  await initializeClientsFromSettings(true);

  app = express();
  app.use(express.json());
  app.use('/api', authenticatedRouteRateLimiter, auth, userContextMiddleware);
  app.post('/api/groups', createNewGroup);
  app.put('/api/groups/:id', updateExistingGroup);
  app.post('/api/auth/keys', createBearerKey);
  app.post('/mcp/:group', sseUserContextMiddleware, handleMcpPostRequest);
});

afterAll(async () => {
  for (const entry of Object.values(transports)) await entry.transport.close();
  cleanupAllServers();
  fs.rmSync(directory, { recursive: true, force: true });
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  clearSettingsCache();
  JsonFileDaoFactory.getInstance().resetInstances();
});

it('keeps a group-scoped bearer key on the renamed group, not on a new group reusing the old name', async () => {
  const group = await admin('post', '/api/groups', { name: 'team-a' }).expect(201);
  const groupId: string = group.body.data.id;
  const key = await admin('post', '/api/auth/keys', {
    name: 'team-a-key',
    accessType: 'groups',
    allowedGroups: ['team-a'],
  }).expect(201);
  const token: string = key.body.data.token;

  expect((await initialize('team-a', token)).status).toBe(200);

  await admin('put', `/api/groups/${groupId}`, { name: 'team-b' }).expect(200);
  expect((await initialize('team-b', token)).status).toBe(200);
  expect((await initialize(groupId, token)).status).toBe(200);

  await admin('post', '/api/groups', { name: 'team-a' }).expect(201);
  expect((await initialize('team-a', token)).status).toBe(401);
});

it('leaves a key scoped by group ID alone when another group named after that ID is renamed', async () => {
  const groupA = await admin('post', '/api/groups', { name: 'id-scope-a' }).expect(201);
  const groupAId: string = groupA.body.data.id;
  const key = await admin('post', '/api/auth/keys', {
    name: 'id-scope-key',
    accessType: 'groups',
    allowedGroups: [groupAId],
  }).expect(201);
  const token: string = key.body.data.token;
  const groupB = await admin('post', '/api/groups', { name: groupAId }).expect(201);

  await admin('put', `/api/groups/${groupB.body.data.id}`, { name: 'id-scope-b' }).expect(200);
  expect((await initialize('id-scope-a', token)).status).toBe(200);
  expect((await initialize('id-scope-b', token)).status).toBe(401);
});

it('rejects renaming a group to another group ID, which would hand its key scope to that group', async () => {
  const groupA = await admin('post', '/api/groups', { name: 'collide-a' }).expect(201);
  const groupB = await admin('post', '/api/groups', { name: 'collide-b' }).expect(201);
  const groupBId: string = groupB.body.data.id;
  const key = await admin('post', '/api/auth/keys', {
    name: 'collide-key',
    accessType: 'groups',
    allowedGroups: ['collide-a'],
  }).expect(201);
  const token: string = key.body.data.token;

  const response = await admin('put', `/api/groups/${groupA.body.data.id}`, { name: groupBId });
  expect(response.status).not.toBe(200);
  expect((await initialize('collide-a', token)).status).toBe(200);
  expect((await initialize(groupBId, token)).status).toBe(401);
  expect((await initialize('collide-b', token)).status).toBe(401);
});

it('does not let a group created during a rename under the old name inherit the key', async () => {
  const group = await admin('post', '/api/groups', { name: 'race-a' }).expect(201);
  const key = await admin('post', '/api/auth/keys', {
    name: 'race-key',
    accessType: 'groups',
    allowedGroups: ['race-a'],
  }).expect(201);
  const token: string = key.body.data.token;

  const [renamed, created] = await Promise.all([
    admin('put', `/api/groups/${group.body.data.id}`, { name: 'race-b' }),
    admin('post', '/api/groups', { name: 'race-a' }),
  ]);
  expect(renamed.status).toBe(200);
  // If the create ran first it lost on the name; retry now that the name is free.
  if (created.status !== 201) await admin('post', '/api/groups', { name: 'race-a' }).expect(201);

  expect((await initialize('race-b', token)).status).toBe(200);
  expect((await initialize('race-a', token)).status).toBe(401);
});

it('writes the renamed group and the moved key scopes in one settings write', async () => {
  const group = await admin('post', '/api/groups', { name: 'one-write-a' }).expect(201);
  await admin('post', '/api/auth/keys', {
    name: 'one-write-key',
    accessType: 'groups',
    allowedGroups: ['one-write-a'],
  }).expect(201);
  const settingsPath = process.env.MCPHUB_SETTING_PATH!;
  const writeSpy = jest.spyOn(fs, 'writeFileSync');

  try {
    await admin('put', `/api/groups/${group.body.data.id}`, { name: 'one-write-b' }).expect(200);
    const writes = writeSpy.mock.calls.filter(([file]) => file === settingsPath);
    expect(writes).toHaveLength(1);
    const written = JSON.parse(String(writes[0][1])) as McpSettings;
    expect(written.groups?.find((g) => g.id === group.body.data.id)?.name).toBe('one-write-b');
    expect(written.bearerKeys?.find((k) => k.name === 'one-write-key')?.allowedGroups).toEqual([
      'one-write-b',
    ]);
  } finally {
    writeSpy.mockRestore();
  }
});

it('changes neither the group nor the key scopes when the write fails', async () => {
  const group = await admin('post', '/api/groups', { name: 'rollback-a' }).expect(201);
  const key = await admin('post', '/api/auth/keys', {
    name: 'rollback-key',
    accessType: 'groups',
    allowedGroups: ['rollback-a'],
  }).expect(201);
  const token: string = key.body.data.token;
  const spy = jest.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
    throw new Error('disk full');
  });

  try {
    const response = await admin('put', `/api/groups/${group.body.data.id}`, {
      name: 'rollback-b',
    });
    expect(response.status).not.toBe(200);
  } finally {
    spy.mockRestore();
  }
  expect((await initialize('rollback-a', token)).status).toBe(200);
  expect((await initialize('rollback-b', token)).status).not.toBe(200);
  const stored = JSON.parse(
    fs.readFileSync(process.env.MCPHUB_SETTING_PATH!, 'utf8'),
  ) as McpSettings;
  expect(stored.groups?.find((g) => g.id === group.body.data.id)?.name).toBe('rollback-a');
  expect(stored.bearerKeys?.find((k) => k.name === 'rollback-key')?.allowedGroups).toEqual([
    'rollback-a',
  ]);
});
