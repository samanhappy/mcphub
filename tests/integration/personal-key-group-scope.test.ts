jest.mock('openid-client', () => ({}));
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server as HttpServer } from 'node:http';
import express from 'express';
import request from 'supertest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { JsonFileDaoFactory, setDaoFactory } from '../../src/dao/DaoFactory.js';
import { getBearerKeyDao, getGroupDao, getSystemConfigDao } from '../../src/dao/index.js';
import { sseUserContextMiddleware } from '../../src/middlewares/userContext.js';
import { mcpConnectionRateLimiter } from '../../src/utils/rateLimit.js';
import {
  handleMcpOtherRequest,
  handleMcpPostRequest,
  handleSseMessage,
  transports,
} from '../../src/services/sseService.js';
import {
  cleanupAllServers,
  getServerByName,
  initializeClientsFromSettings,
  initUpstreamServers,
} from '../../src/services/mcpService.js';
import { clearSettingsCache } from '../../src/config/index.js';
import { searchToolsByVector } from '../../src/services/vectorSearchService.js';
import type { McpSettings } from '../../src/types/index.js';

jest.mock('../../src/services/oauthService.js', () => ({ initializeAllOAuthClients: jest.fn() }));
jest.mock('../../src/services/vectorSearchService.js', () => ({
  removeServerToolEmbeddings: jest.fn(),
  removeToolEmbeddings: jest.fn(),
  saveToolsAsVectorEmbeddings: jest.fn(),
  syncAllServerToolsEmbeddings: jest.fn(),
  searchToolsByVector: jest.fn(async () => []),
}));
jest.mock('../../src/services/betterAuthConfig.js', () => ({
  getBetterAuthRuntimeConfig: jest.fn(async () => ({ enabled: false })),
}));

const teamId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
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
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-personal-scope-'));
  process.env.MCPHUB_SETTING_PATH = path.join(directory, 'settings.json');
  process.env.USE_DB = 'false';
  const fixture = path.resolve('tests/fixtures/credential-server.mjs');
  const upstream = {
    type: 'stdio' as const,
    command: process.execPath,
    args: [fixture],
    owner: 'admin',
  };
  const settings: McpSettings = {
    users: [
      { username: 'alice', password: 'unused' },
      { username: 'admin', password: 'unused', isAdmin: true },
    ],
    mcpServers: {
      visible: { ...upstream, visibility: 'public', env: { PERSONAL_KEY: 'full-visible' } },
      hidden: { ...upstream, visibility: 'private' },
      outside: { ...upstream, visibility: 'public' },
    },
    groups: [
      {
        id: teamId,
        name: 'team',
        owner: 'admin',
        visibility: 'public',
        servers: [
          { name: 'visible', tools: ['identity'], prompts: [], resources: [] },
          { name: 'hidden' },
        ],
      },
      { id: otherId, name: 'other', owner: 'admin', visibility: 'public', servers: ['outside'] },
    ],
    bearerKeys: [
      {
        id: 'scoped',
        name: 'scoped',
        token: 'scoped',
        kind: 'user',
        owner: 'alice',
        enabled: true,
        accessType: 'groups',
        allowedGroups: [teamId],
      },
      {
        id: 'legacy',
        name: 'legacy',
        token: 'legacy',
        kind: 'user',
        owner: 'alice',
        enabled: true,
        accessType: 'all',
      },
      {
        id: 'admin-key',
        name: 'admin-key',
        token: 'admin-key',
        kind: 'user',
        owner: 'admin',
        enabled: true,
        accessType: 'groups',
        allowedGroups: [teamId],
      },
    ],
    systemConfig: {
      smartRouting: { enabled: true },
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
  for (let attempt = 0; attempt < 200; attempt++) {
    if (
      ['visible', 'hidden', 'outside'].every(
        (name) => getServerByName(name)?.status === 'connected',
      )
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  for (const name of ['visible', 'hidden', 'outside'])
    expect(getServerByName(name)?.status).toBe('connected');
  await initUpstreamServers();
  app = express();
  app.use(express.json());
  for (const route of ['/mcp', '/mcp/:group(*)', '/:user/mcp/:group(*)']) {
    app.post(route, mcpConnectionRateLimiter, sseUserContextMiddleware, handleMcpPostRequest);
    app.get(route, mcpConnectionRateLimiter, sseUserContextMiddleware, handleMcpOtherRequest);
    app.delete(route, mcpConnectionRateLimiter, sseUserContextMiddleware, handleMcpOtherRequest);
  }
  app.post('/messages', mcpConnectionRateLimiter, sseUserContextMiddleware, handleSseMessage);
  server = await new Promise<HttpServer>((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
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

const connect = async (route: string, token = 'scoped') => {
  const client = new Client({ name: 'personal-scope-e2e', version: '1' });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${baseUrl}${route}`), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    }),
  );
  return client;
};
const initialize = (route: string, token = 'scoped') =>
  request(app)
    .post(route)
    .set('Authorization', `Bearer ${token}`)
    .set('Accept', 'application/json, text/event-stream')
    .send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'scope-test', version: '1' },
      },
    });

it('intersects group scope, owner visibility and capability selections for discovery and execution', async () => {
  const client = await connect('/mcp/team');
  expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['visible-identity']);
  expect((await client.listPrompts()).prompts).toEqual([]);
  expect((await client.listResources()).resources).toEqual([]);
  expect((await client.callTool({ name: 'visible-identity', arguments: {} })).isError).not.toBe(
    true,
  );
  for (const name of ['outside-identity', 'hidden-identity', 'visible-rotate_identity']) {
    expect((await client.callTool({ name, arguments: {} })).isError).toBe(true);
  }
  await expect(client.getPrompt({ name: 'visible-identity' })).rejects.toThrow();
  expect(JSON.stringify(await client.readResource({ uri: 'personal://identity' }))).toContain(
    'Resource not found',
  );
});

it.each([
  '/mcp',
  '/mcp/$smart',
  '/mcp/other',
  '/mcp/visible',
  '/mcp/outside',
  '/mcp/$smart/other',
  '/alice/mcp/other',
])('denies out-of-scope route %s', async (route) =>
  expect((await initialize(route)).status).toBe(401),
);

it('allows IDs and matching user routes while rejecting a different username', async () => {
  expect((await initialize(`/mcp/${teamId}`)).status).toBe(200);
  expect((await initialize('/alice/mcp/team')).status).toBe(200);
  expect((await initialize('/admin/mcp/team')).status).toBe(403);
});

it('enforces scope for modern stateless requests', async () => {
  for (const [route, status] of [
    ['/mcp/team', 200],
    ['/mcp/outside', 401],
    ['/mcp/$smart', 401],
  ] as const) {
    const response = await request(app)
      .post(route)
      .set('Authorization', 'Bearer scoped')
      .set('Accept', 'application/json, text/event-stream')
      .set('MCP-Protocol-Version', '2026-07-28')
      .set('Mcp-Method', 'tools/list')
      .send({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/list',
        params: {
          _meta: {
            'io.modelcontextprotocol/protocolVersion': '2026-07-28',
            'io.modelcontextprotocol/clientCapabilities': {},
          },
        },
      });
    expect(response.status).toBe(status);
    if (status === 200)
      expect(response.body.result.tools.map((tool: { name: string }) => tool.name)).toEqual([
        'visible-identity',
      ]);
  }
});

it('limits smart search, describe and invocation to the permitted group capabilities', async () => {
  const client = await connect('/mcp/$smart/team');
  const searched = await client.callTool({
    name: 'search_tools',
    arguments: { query: 'identity' },
  });
  expect(searched).not.toHaveProperty('isError', true);
  expect(searchToolsByVector).toHaveBeenLastCalledWith('identity', 10, expect.any(Number), [
    'visible',
  ]);
  for (const toolName of ['outside-identity', 'hidden-identity', 'visible-rotate_identity']) {
    expect(
      (await client.callTool({ name: 'describe_tool', arguments: { toolName } })).isError,
    ).toBe(true);
    expect(
      (await client.callTool({ name: 'call_tool', arguments: { toolName, arguments: {} } }))
        .isError,
    ).toBe(true);
  }
  expect(
    (
      await client.callTool({
        name: 'call_tool',
        arguments: { toolName: 'visible-identity', arguments: {} },
      })
    ).isError,
  ).not.toBe(true);
});

it('preserves unrestricted personal key behavior and restricts administrator-owned personal keys', async () => {
  const legacy = await connect('/mcp', 'legacy');
  expect((await legacy.listTools()).tools.map((tool) => tool.name)).toContain('outside-identity');
  expect((await initialize('/mcp/other', 'admin-key')).status).toBe(401);
});

it('rechecks scope changes for existing sessions and permits multiple selected groups', async () => {
  const client = await connect('/mcp/team');
  await getBearerKeyDao().update('scoped', { allowedGroups: [otherId] });
  await expect(client.listTools()).rejects.toThrow();
  await getBearerKeyDao().update('scoped', { allowedGroups: [teamId, otherId] });
  expect((await initialize('/mcp/other')).status).toBe(200);
  await getBearerKeyDao().update('scoped', { allowedGroups: [teamId] });
});

it('checks live group visibility on an existing session', async () => {
  const client = await connect('/mcp/team');
  await getGroupDao().update(teamId, { visibility: 'private' });
  await expect(client.listTools()).rejects.toThrow();
  await getGroupDao().update(teamId, { visibility: 'public' });
});

it('fails closed for empty or stale scopes and a deleted/recreated group', async () => {
  await getBearerKeyDao().update('scoped', { allowedGroups: [] });
  expect((await initialize('/mcp/team')).status).toBe(401);
  await getBearerKeyDao().update('scoped', { allowedGroups: [teamId] });
  const group = await getGroupDao().findById(teamId);
  await getGroupDao().delete(teamId);
  const { id: _id, ...replacementConfig } = group!;
  const replacement = await getGroupDao().create(replacementConfig);
  expect((await initialize('/mcp/team')).status).toBe(401);
  await getGroupDao().delete(replacement.id);
  // Restore the fixture ID without relying on create() to accept caller IDs.
  const settings = JSON.parse(fs.readFileSync(process.env.MCPHUB_SETTING_PATH!, 'utf8'));
  settings.groups.push(group);
  fs.writeFileSync(process.env.MCPHUB_SETTING_PATH!, JSON.stringify(settings));
  clearSettingsCache();
});

it('does not confuse another group name with a persisted group ID', async () => {
  const collision = await getGroupDao().create({
    name: teamId,
    servers: ['outside'],
    owner: 'admin',
    visibility: 'public',
  });
  try {
    expect((await initialize(`/mcp/${collision.id}`)).status).toBe(401);
    expect((await initialize(`/mcp/${teamId}`)).status).toBe(401);
    expect((await initialize('/mcp/team')).status).toBe(200);
  } finally {
    await getGroupDao().delete(collision.id);
  }
});

it('keeps personal-key restrictions when bearer authentication is disabled', async () => {
  const dao = getSystemConfigDao();
  const config = await dao.get();
  await dao.update({ ...config, routing: { ...config?.routing, enableBearerAuth: false } });
  expect((await initialize('/mcp/other')).status).toBe(401);
  expect((await initialize('/mcp/team')).status).toBe(200);
  await dao.update(config!);
});

it('checks SSE message scope before dispatch using the stored session group', async () => {
  const handlePostMessage = jest.fn(async (_req, res) => {
    res.status(202).end();
  });
  const sessionId = 'scope-sse-session';
  transports[sessionId] = { group: 'team', transport: { handlePostMessage } as never };
  const send = () =>
    request(app)
      .post(`/messages?sessionId=${sessionId}`)
      .set('Authorization', 'Bearer scoped')
      .send({});
  expect((await send()).status).toBe(202);
  await getBearerKeyDao().update('scoped', { allowedGroups: [otherId] });
  expect((await send()).status).toBe(401);
  expect(handlePostMessage).toHaveBeenCalledTimes(1);
  delete transports[sessionId];
  await getBearerKeyDao().update('scoped', { allowedGroups: [teamId] });
});
