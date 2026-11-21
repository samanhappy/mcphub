jest.mock('openid-client', () => ({}));
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server as HttpServer } from 'node:http';
import express from 'express';
import request from 'supertest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { JsonFileDaoFactory, setDaoFactory } from '../../src/dao/DaoFactory.js';
import { getGroupDao } from '../../src/dao/index.js';
import { sseUserContextMiddleware } from '../../src/middlewares/userContext.js';
import {
  handleMcpOtherRequest,
  handleMcpPostRequest,
  transports,
} from '../../src/services/sseService.js';
import {
  cleanupAllServers,
  getServerByName,
  initializeClientsFromSettings,
} from '../../src/services/mcpService.js';
import config, { clearSettingsCache } from '../../src/config/index.js';
import { PrincipalRuntimeService } from '../../src/services/principalRuntimeService.js';
import { initRoutes } from '../../src/routes/index.js';
import { initMiddlewares } from '../../src/middlewares/index.js';
import type { McpSettings } from '../../src/types/index.js';

jest.mock('../../src/services/oauthService.js', () => ({ initializeAllOAuthClients: jest.fn() }));
jest.mock('../../src/services/vectorSearchService.js', () => ({
  removeServerToolEmbeddings: jest.fn(),
  removeToolEmbeddings: jest.fn(),
  saveToolsAsVectorEmbeddings: jest.fn(),
  syncAllServerToolsEmbeddings: jest.fn(),
}));
jest.mock('../../src/services/betterAuthConfig.js', () => ({
  ...jest.requireActual('../../src/services/betterAuthConfig.js'),
  getBetterAuthRuntimeConfig: jest.fn(async () => ({ enabled: false, basePath: '/better-auth' })),
}));

const fixture = path.resolve('tests/fixtures/credential-server.mjs');
const token = 'exclude-scope-token';
const personalGroupId = '11111111-1111-4111-8111-111111111111';
let directory: string;
let app: express.Express;
let server: HttpServer;
let baseUrl: string;
const clients: Client[] = [];
const originalEnv = {
  MCPHUB_SETTING_PATH: process.env.MCPHUB_SETTING_PATH,
  USE_DB: process.env.USE_DB,
};

beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-exclude-scope-'));
  process.env.MCPHUB_SETTING_PATH = path.join(directory, 'settings.json');
  process.env.USE_DB = 'false';
  const settings: McpSettings = {
    users: [{ username: 'alice', password: 'unused' }],
    mcpServers: {
      visible: {
        type: 'stdio',
        command: process.execPath,
        args: [fixture],
        owner: 'admin',
        visibility: 'public',
      },
      secret: {
        type: 'stdio',
        command: process.execPath,
        args: [fixture],
        owner: 'admin',
        visibility: 'private',
      },
    },
    groups: [
      { id: 'team', name: 'team', servers: ['visible'] },
      { id: 'restricted', name: 'restricted', servers: [{ name: 'visible', tools: [] }] },
      {
        id: personalGroupId,
        name: 'shared',
        owner: 'admin',
        visibility: 'group',
        sharedWithUsers: ['alice'],
        servers: ['visible', 'secret'],
      },
    ],
    bearerKeys: [
      {
        id: 'group-key',
        name: 'group-key',
        token: 'group-token',
        kind: 'system',
        enabled: true,
        accessType: 'groups',
        allowedGroups: ['team', 'restricted'],
      },
      {
        id: 'personal-key',
        name: 'personal-key',
        token: 'personal-token',
        kind: 'user',
        owner: 'alice',
        enabled: true,
        accessType: 'groups',
        allowedGroups: [personalGroupId],
      },
      {
        id: 'server-key',
        name: 'server-key',
        token: 'server-token',
        kind: 'system',
        enabled: true,
        accessType: 'servers',
        allowedServers: ['visible'],
      },
      {
        id: 'all-key',
        name: 'all-key',
        token: 'all-token',
        kind: 'system',
        enabled: true,
        accessType: 'all',
      },
      {
        id: 'exclude-key',
        name: 'exclude-key',
        token,
        kind: 'system',
        enabled: true,
        accessType: 'exclude',
        excludedGroups: [],
        excludedServers: ['secret'],
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
      toolPolicies: [
        {
          id: 'team-identity',
          effect: 'allow',
          keyId: 'group-key',
          groupId: 'team',
          tool: 'identity',
        },
      ],
    },
  };
  fs.writeFileSync(process.env.MCPHUB_SETTING_PATH, JSON.stringify(settings));
  clearSettingsCache();
  JsonFileDaoFactory.getInstance().resetInstances();
  setDaoFactory(JsonFileDaoFactory.getInstance());
  await initializeClientsFromSettings(true);
  for (let attempt = 0; attempt < 200; attempt++) {
    if (
      getServerByName('visible')?.status === 'connected' &&
      getServerByName('secret')?.status === 'connected'
    ) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  expect(getServerByName('visible')?.status).toBe('connected');
  expect(getServerByName('secret')?.status).toBe('connected');

  app = express();
  app.use(express.json());
  app.post('/mcp', sseUserContextMiddleware, handleMcpPostRequest);
  app.get('/mcp', sseUserContextMiddleware, handleMcpOtherRequest);
  app.delete('/mcp', sseUserContextMiddleware, handleMcpOtherRequest);
  app.post('/mcp/:group', sseUserContextMiddleware, handleMcpPostRequest);

  initMiddlewares(app);
  await initRoutes(app);

  server = await new Promise<HttpServer>((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const address = server.address() as { port: number };
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  for (const client of clients) await client.close();
  for (const entry of Object.values(transports)) await entry.transport.close();
  cleanupAllServers();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  clearSettingsCache();
  JsonFileDaoFactory.getInstance().resetInstances();
});

const connectGlobal = async (): Promise<Client> => {
  const client = new Client({ name: 'exclude-scope-e2e', version: '1' });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
};

const initializeGroup = (group: string) =>
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
        clientInfo: { name: 'exclude-scope-e2e', version: '1' },
      },
    });

it('omits excluded servers from the global tools listing', async () => {
  const client = await connectGlobal();
  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name);

  expect(names).toContain('visible-identity');
  expect(names).not.toContain('secret-identity');
});

it('rejects a direct call to an excluded server tool on the global route', async () => {
  const client = await connectGlobal();

  const denied = await client.callTool({ name: 'secret-identity', arguments: {} });
  expect(denied.isError).toBe(true);
  expect(JSON.stringify(denied)).toContain('Tool not available');

  const allowed = await client.callTool({ name: 'visible-identity', arguments: {} });
  expect(allowed.isError).not.toBe(true);
  expect(JSON.stringify(allowed)).toContain('masterKeyInherited');
});

it('rejects a direct route to an excluded server', async () => {
  expect((await initializeGroup('visible')).status).toBe(200);
  expect((await initializeGroup('secret')).status).toBe(401);
});

it('uses the scoped OpenAPI document to call an authorized tool', async () => {
  const auth = 'Bearer group-token';
  const spec = await request(app).get('/openapi/team/openapi.json').set('Authorization', auth);
  expect(spec.status).toBe(200);
  const advertisedUrl = new URL(
    spec.body.servers[0].url,
    'https://hub.example/openapi/team/openapi.json',
  );
  expect(advertisedUrl.href).toBe('https://hub.example/openapi/team');
  const route = advertisedUrl.pathname;
  const tool = '/tools/visible/identity';
  expect(spec.body.paths[tool]).toBeDefined();
  const call = await request(app)
    .get(route + tool)
    .set('Authorization', auth);
  expect(call.status).toBe(200);
  expect(call.body.isError).not.toBe(true);
  expect(JSON.stringify(call.body)).toContain('masterKeyInherited');

  expect((await request(app).get('/api/team/openapi.json').set('Authorization', auth)).status).toBe(
    401,
  );
  expect(
    (await request(app).get('/openapi/tools/visible/identity').set('Authorization', auth)).status,
  ).toBe(401);
  expect(
    (
      await request(app)
        .get(route + '/tools/secret/identity')
        .set('Authorization', auth)
    ).status,
  ).toBe(404);
  expect(
    (
      await request(app)
        .get('/openapi/restricted' + tool)
        .set('Authorization', auth)
    ).status,
  ).toBe(404);
});

it('omits POST tools from the scoped spec in read-only mode', async () => {
  const tool = getServerByName('visible')!.tools[0];
  const originalSchema = tool.inputSchema;
  const originalReadonly = config.readonly;
  const specPath = '/openapi/team/openapi.json';
  const toolPath = '/tools/visible/identity';
  const auth = 'Bearer group-token';
  try {
    tool.inputSchema = { type: 'object', properties: { text: { type: 'string' } } };
    const writable = await request(app).get(specPath).set('Authorization', auth);
    expect(writable.body.paths[toolPath].post).toBeDefined();

    config.readonly = true;
    const readonly = await request(app).get(specPath).set('Authorization', auth);
    expect(readonly.status).toBe(200);
    expect(readonly.body.paths[toolPath]).toBeUndefined();
    const call = await request(app)
      .post('/openapi/team' + toolPath)
      .set('Authorization', auth);
    expect(call.status).toBe(403);
  } finally {
    tool.inputSchema = originalSchema;
    config.readonly = originalReadonly;
  }
});

it('applies global exclusions to the OpenAPI document and execution', async () => {
  const auth = `Bearer ${token}`;
  const spec = await request(app).get('/openapi/openapi.json').set('Authorization', auth);
  expect(spec.status).toBe(200);
  expect(spec.body.paths['/tools/visible/identity']).toBeDefined();
  expect(spec.body.paths['/tools/secret/identity']).toBeUndefined();
  expect(
    (await request(app).get('/openapi/tools/secret/identity').set('Authorization', auth)).status,
  ).toBe(404);
});

it('serves YAML on a direct server route and preserves legacy access for all-access keys', async () => {
  const auth = 'Bearer server-token';
  const spec = await request(app).get('/openapi/visible/openapi.yaml').set('Authorization', auth);
  expect(spec.status).toBe(200);
  expect(spec.headers['content-type']).toContain('application/yaml');
  expect(spec.text).toContain('/openapi/visible');
  expect(spec.text).toContain('/tools/visible/identity');
  expect(spec.text).not.toContain('/tools/secret/identity');
  expect(
    (await request(app).get('/openapi/visible/tools/secret/identity').set('Authorization', auth))
      .status,
  ).toBe(404);
  const legacy = await request(app)
    .get('/api/team/openapi.json')
    .set('Authorization', 'Bearer all-token');
  expect(legacy.status).toBe(200);
  expect(new URL(legacy.body.servers[0].url).pathname).toBe('/api');
});

it('does not prepare an out-of-scope personal server for a spec or tool call', async () => {
  const unrelated = getServerByName('secret')!.config!;
  const originalTemplate = unrelated.credentialTemplate;
  const acquire = jest.spyOn(PrincipalRuntimeService.prototype, 'acquire');
  const auth = 'Bearer personal-token';
  try {
    unrelated.credentialTemplate = [{ target: 'env', name: 'PERSONAL_KEY' }];
    const spec = await request(app).get('/openapi/shared/openapi.json').set('Authorization', auth);
    expect(spec.status).toBe(200);
    expect(spec.body.paths['/tools/visible/identity']).toBeDefined();

    const call = await request(app)
      .get('/openapi/shared/tools/visible/identity')
      .set('Authorization', auth);
    expect(call.status).toBe(200);
    expect(call.body.isError).not.toBe(true);
    expect(acquire).not.toHaveBeenCalled();
  } finally {
    unrelated.credentialTemplate = originalTemplate;
    acquire.mockRestore();
  }
});

it('enforces the personal key owner’s live server visibility and group access', async () => {
  const auth = 'Bearer personal-token';
  const route = '/openapi/shared';
  const spec = await request(app)
    .get(route + '/openapi.json')
    .set('Authorization', auth);
  expect(spec.status).toBe(200);
  expect(spec.body.paths['/tools/visible/identity']).toBeDefined();
  expect(spec.body.paths['/tools/secret/identity']).toBeUndefined();
  expect(
    (
      await request(app)
        .get(route + '/tools/secret/identity')
        .set('Authorization', auth)
    ).status,
  ).toBe(404);
  const call = await request(app)
    .post(route + '/tools/visible/identity')
    .set('Authorization', auth)
    .send({});
  expect(call.status).toBe(200);
  expect(call.body.isError).not.toBe(true);

  await getGroupDao().update(personalGroupId, { sharedWithUsers: [] });
  try {
    expect(
      (
        await request(app)
          .get(route + '/openapi.json')
          .set('Authorization', auth)
      ).status,
    ).toBe(403);
    expect(
      (
        await request(app)
          .post(route + '/tools/visible/identity')
          .set('Authorization', auth)
          .send({})
      ).status,
    ).toBe(403);
  } finally {
    await getGroupDao().update(personalGroupId, { sharedWithUsers: ['alice'] });
  }
});
