import {
  getGroups,
  getGroup,
  createNewGroup,
  updateExistingGroup,
  getGroupShareCandidates,
} from '../../src/controllers/groupController.js';
jest.mock('openid-client', () => ({}));
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import express from 'express';
import request from 'supertest';
import { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  getServerDao,
  getGroupDao,
  getBearerKeyDao,
  getBuiltinPromptDao,
  getBuiltinResourceDao,
} from '../../src/dao/DaoFactory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { auth } from '../../src/middlewares/auth.js';
import {
  sseUserContextMiddleware,
  userContextMiddleware,
} from '../../src/middlewares/userContext.js';
import {
  listMyCredentials,
  updateMyCredential,
} from '../../src/controllers/credentialBindingController.js';
import { getServerConfig } from '../../src/controllers/serverController.js';
import {
  handleMcpPostRequest,
  handleSseConnection,
  handleMcpOtherRequest,
  transports,
} from '../../src/services/sseService.js';
import {
  initializeClientsFromSettings,
  cleanupAllServers,
  getServersInfo,
  getServerConnectionStats,
  handleCallToolRequest,
  handleGetPromptRequest,
  handleReadResourceRequest,
} from '../../src/services/mcpService.js';
import { UserContextService } from '../../src/services/userContextService.js';
import { createOAuthProvider } from '../../src/services/mcpOAuthProvider.js';
import { JsonFileDaoFactory, setDaoFactory } from '../../src/dao/DaoFactory.js';
import { clearSettingsCache, getNameSeparator } from '../../src/config/index.js';
import { createUserToken } from '../utils/testHelpers.js';
import {
  authenticatedRouteRateLimiter,
  mcpConnectionRateLimiter,
} from '../../src/utils/rateLimit.js';
import type { McpSettings } from '../../src/types/index.js';

jest.mock('../../src/services/oauthService.js', () => ({ initializeAllOAuthClients: jest.fn() }));
jest.mock('../../src/services/vectorSearchService.js', () => ({
  removeServerToolEmbeddings: jest.fn(),
  saveToolsAsVectorEmbeddings: jest.fn(),
  syncAllServerToolsEmbeddings: jest.fn(),
}));
jest.mock('../../src/services/mcpOAuthProvider.js', () => ({ createOAuthProvider: jest.fn() }));
const mockActivityLogToolCall = jest.fn();
jest.mock('../../src/services/activityLoggingService.js', () => ({
  getActivityLoggingService: () => ({ logToolCall: mockActivityLogToolCall }),
}));
jest.mock('../../src/services/toolResultCompressionService.js', () => ({
  maybeCompressToolResult: (result: unknown) => result,
}));
jest.mock('../../src/services/betterAuthConfig.js', () => ({
  getBetterAuthRuntimeConfig: jest.fn(async () => ({ enabled: false })),
}));

const alice = 'alice@example.com';
const bob = 'bob@example.com';
let directory: string;
let server: HttpServer;
let baseUrl: string;
let app: express.Express;
const clients: Client[] = [];
const originalEnv = {
  path: process.env.MCPHUB_SETTING_PATH,
  key: process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY,
  useDb: process.env.USE_DB,
};
const fixture = path.resolve('tests/fixtures/credential-server.mjs');
const parseIdentity = (result: any) => JSON.parse(result.content[0].text);
const apiToken = (username: string) => createUserToken(username, username === 'admin');
const bind = (username: string, value: string) =>
  request(app)
    .put('/api/credentials/shared')
    .set('x-auth-token', apiToken(username))
    .send({ username: bob, values: { 'env.PERSONAL_KEY': value } });

beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-personal-e2e-'));
  process.env.MCPHUB_SETTING_PATH = path.join(directory, 'settings.json');
  process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.USE_DB = 'false';
  const settings: McpSettings = {
    mcpServers: {
      shared: {
        type: 'stdio',
        command: process.execPath,
        args: [fixture],
        owner: 'admin',
        visibility: 'public',
        startOnDemand: true,
        idleTimeoutMs: 200,
        env: { PERSONAL_KEY: 'org-must-never-be-used' },
        credentialTemplate: [{ target: 'env', name: 'PERSONAL_KEY' }],
      },
    },
    users: [alice, bob, 'admin'].map((username) => ({
      username,
      password: 'unused',
      isAdmin: username === 'admin',
    })),
    groups: [],
    bearerKeys: [alice, bob].map((username, index) => ({
      id: `personal-${index}`,
      name: username,
      token: `${username}-bearer`,
      kind: 'user',
      owner: username,
      enabled: true,
      accessType: 'all',
      createdAt: new Date().toISOString(),
    })),
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
  app.get('/api/credentials', listMyCredentials);
  app.put('/api/credentials/:name', updateMyCredential);
  app.delete('/api/credentials/:name', updateMyCredential);
  app.get('/api/servers/:name', getServerConfig);
  app.get('/api/groups', getGroups);
  app.get('/api/groups/:id', getGroup);
  app.post('/api/groups', createNewGroup);
  app.put('/api/groups/:id', updateExistingGroup);
  app.get('/api/groups/:id/share-candidates', getGroupShareCandidates);
  app.get('/sse/:group', sseUserContextMiddleware, handleSseConnection);
  app.post('/mcp/:group', mcpConnectionRateLimiter, sseUserContextMiddleware, handleMcpPostRequest);
  app.get('/mcp/:group', mcpConnectionRateLimiter, sseUserContextMiddleware, handleMcpOtherRequest);
  app.delete(
    '/mcp/:group',
    mcpConnectionRateLimiter,
    sseUserContextMiddleware,
    handleMcpOtherRequest,
  );
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
  for (const [name, value] of Object.entries({
    MCPHUB_SETTING_PATH: originalEnv.path,
    MCPHUB_CREDENTIAL_ENCRYPTION_KEY: originalEnv.key,
    USE_DB: originalEnv.useDb,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  clearSettingsCache();
  JsonFileDaoFactory.getInstance().resetInstances();
});

const connect = async (username: string, serverName = 'shared') => {
  const client = new Client({ name: 'credential-e2e', version: '1' });
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp/${serverName}`), {
      requestInit: {
        headers: {
          Authorization: `Bearer ${username}-bearer`,
          'x-personal-key': 'passthrough-must-not-win',
        },
      },
    }),
  );
  return client;
};

test('dashboard bindings are write-only, self-scoped, and preserve the shared safe view', async () => {
  expect(getServerConnectionStats()).toEqual({ total: 0, connected: 0, disconnected: 0 });
  expect((await request(app).get('/api/credentials')).status).toBe(401);
  expect((await bind(alice, 'alice-sentinel')).status).toBe(200);
  const aliceStatus = await request(app)
    .get('/api/credentials')
    .set('x-auth-token', apiToken(alice));
  expect(aliceStatus.body.data[0].configured).toBe(true);
  expect(JSON.stringify(aliceStatus.body)).not.toContain('alice-sentinel');
  const bobStatus = await request(app).get('/api/credentials').set('x-auth-token', apiToken(bob));
  expect(bobStatus.body.data[0].configured).toBe(false);
  const config = await request(app).get('/api/servers/shared').set('x-auth-token', apiToken(alice));
  expect(config.body.data.config.configRestricted).toBe(true);
  expect(config.body.data.config.credentialTemplate).toEqual([
    { target: 'env', name: 'PERSONAL_KEY' },
  ]);
  expect(JSON.stringify(config.body)).not.toContain('org-must-never-be-used');
  expect(
    (
      await request(app)
        .put('/api/credentials/shared')
        .set('Authorization', `Bearer ${alice}-bearer`)
        .send({ values: { 'env.PERSONAL_KEY': 'bad' } })
    ).status,
  ).not.toBe(200);
});

test('real stdio calls resolve bearer owners, isolate simultaneous users, and reuse a principal across sessions', async () => {
  mockActivityLogToolCall.mockClear();
  await bind(bob, 'bob-sentinel');
  const [aliceClient, bobClient, anotherAliceClient] = await Promise.all([
    connect(alice),
    connect(bob),
    connect(alice),
  ]);
  const toolLists = await Promise.all([aliceClient.listTools(), bobClient.listTools()]);
  const toolName = toolLists[0].tools[0].name;
  expect(toolLists[0].tools.map((tool) => tool.name)).toEqual([toolName]);
  const results = await Promise.all(
    [aliceClient, bobClient, anotherAliceClient].map((client) =>
      client.callTool({ name: toolName, arguments: { delay: 30 } }),
    ),
  );
  const [a, b, a2] = results.map(parseIdentity);
  expect(a.credential).toBe('alice-sentinel');
  expect(b.credential).toBe('bob-sentinel');
  expect(a2.pid).toBe(a.pid);
  expect(b.pid).not.toBe(a.pid);
  expect(a.masterKeyInherited).toBe(false);

  const activity = mockActivityLogToolCall.mock.calls
    .map(([entry]) => entry)
    .find(
      (entry) =>
        entry.server === 'shared' &&
        entry.tool === 'identity' &&
        JSON.stringify(entry.output).includes('alice-sentinel'),
    );
  expect(activity).toEqual(
    expect.objectContaining({
      hasCredentialTemplate: true,
      output: expect.objectContaining({ content: expect.any(Array) }),
    }),
  );
  expect(JSON.stringify(activity?.output)).toContain('alice-sentinel');
  const promptName = (await aliceClient.listPrompts()).prompts[0].name;
  const prompt = await aliceClient.getPrompt({ name: promptName });
  expect(JSON.parse((prompt.messages[0].content as { text: string }).text).credential).toBe(
    'alice-sentinel',
  );
  expect(
    JSON.parse(
      (await bobClient.readResource({ uri: 'personal://identity' })).contents[0].text as string,
    ).credential,
  ).toBe('bob-sentinel');
  expect((await getServersInfo()).map((info) => info.name)).toEqual(['shared']);
  expect(JSON.stringify(await getServersInfo())).not.toContain('sentinel');

  await bind(alice, 'alice-rotated');
  const rotated = parseIdentity(await aliceClient.callTool({ name: toolName }));
  expect(rotated.credential).toBe('alice-rotated');
  expect(rotated.pid).not.toBe(a.pid);
  const bobAfter = parseIdentity(await bobClient.callTool({ name: toolName }));
  expect(bobAfter.credential).toBe('bob-sentinel');
  await request(app).delete('/api/credentials/shared').set('x-auth-token', apiToken(alice));
  const missing = await aliceClient.callTool({ name: toolName });
  expect(missing.isError).toBe(true);
  expect(JSON.stringify(missing)).toContain('Credentials');
  expect(JSON.stringify(missing)).not.toContain('org-must-never-be-used');

  await getBuiltinPromptDao().create({ name: 'builtin-example', template: 'Hello' });
  await getBuiltinResourceDao().create({
    name: 'Example',
    uri: 'builtin://example',
    content: 'Hello',
  });
  const builtinResults = await UserContextService.getInstance().runWithContext(
    () =>
      Promise.all([
        handleGetPromptRequest({ params: { name: 'builtin-example' } }, { group: 'shared' }),
        handleReadResourceRequest({ params: { uri: 'builtin://example' } }, { group: 'shared' }),
      ]),
    { username: alice, password: '', isAdmin: false },
  );
  expect(builtinResults[0].messages[0].content.text).toBe('Hello');
  expect(builtinResults[1].contents[0].text).toBe('Hello');

  // Activity, including a call longer than the idle timeout, keeps a child alive.
  const slow = parseIdentity(
    await bobClient.callTool({ name: toolName, arguments: { delay: 350 } }),
  );
  const beforeIdle = parseIdentity(await bobClient.callTool({ name: toolName }));
  expect(slow.pid).toBe(beforeIdle.pid);
  await new Promise((resolve) => setTimeout(resolve, 350));
  const afterIdle = parseIdentity(await bobClient.callTool({ name: toolName }));
  expect(afterIdle.pid).not.toBe(beforeIdle.pid);
});

test('a session/JWT principal can invoke directly, while an absent principal cannot borrow a binding', async () => {
  await bind(alice, 'literal-${PERSONAL_KEY}');
  const result = await UserContextService.getInstance().runWithContext(
    () =>
      handleCallToolRequest(
        {
          params: {
            name: 'call_tool',
            arguments: { toolName: `shared${getNameSeparator()}identity` },
          },
        },
        { server: 'shared' },
      ),
    { username: alice, password: '', isAdmin: false },
  );
  expect(result.isError).not.toBe(true);
  expect(parseIdentity(result).credential).toBe('literal-${PERSONAL_KEY}');
  const dashboard = await UserContextService.getInstance().runWithContext(
    async () => ({
      servers: await getServersInfo(),
      result: await handleCallToolRequest(
        { params: { name: 'call_tool', arguments: { toolName: 'identity' } } },
        { server: 'shared' },
      ),
    }),
    { username: alice, password: '', isAdmin: false },
  );
  expect(dashboard.servers).toHaveLength(1);
  expect(dashboard.servers[0].tools).toHaveLength(1);
  expect(dashboard.servers[0].config?.credentialTemplate).toEqual([
    { target: 'env', name: 'PERSONAL_KEY' },
  ]);
  expect(JSON.stringify(dashboard.servers)).not.toContain('literal-${PERSONAL_KEY}');
  expect(parseIdentity(dashboard.result).credential).toBe('literal-${PERSONAL_KEY}');
  const anonymous = await UserContextService.getInstance().runWithContext(() =>
    handleCallToolRequest(
      { params: { name: 'call_tool', arguments: { toolName: 'identity' } } },
      { server: 'shared', group: 'shared' },
    ),
  );
  expect(anonymous.isError).toBe(true);
  expect(JSON.stringify(anonymous)).toContain('Credentials');
});

test('HTTP and OpenAPI resolve the latest personal headers without passthrough or parameter overrides', async () => {
  app.post('/upstream', async (req, res) => {
    const upstream = new McpServer(
      { name: 'http-fixture', version: '1' },
      { capabilities: { tools: {} } },
    );
    upstream.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [{ name: 'identity', inputSchema: { type: 'object' } }],
    }));
    upstream.setRequestHandler(CallToolRequestSchema, async () => ({
      content: [
        { type: 'text', text: JSON.stringify({ credential: req.headers['x-personal-key'] }) },
      ],
    }));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void upstream.close();
    });
    await upstream.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.get('/api-upstream', (req, res) => {
    res.json({ credential: req.headers['x-personal-key'] });
  });
  const credentialTemplate = [{ target: 'headers' as const, name: 'X-Personal-Key' }];
  await getServerDao().create({
    name: 'httpShared',
    type: 'streamable-http',
    oauth: {},
    url: `${baseUrl}/upstream`,
    owner: 'admin',
    visibility: 'public',
    credentialTemplate,
    passthroughHeaders: ['x-personal-key'],
  });
  await getServerDao().create({
    name: 'apiShared',
    type: 'openapi',
    owner: 'admin',
    visibility: 'public',
    credentialTemplate,
    openapi: {
      schema: {
        openapi: '3.0.0',
        info: { title: 'Personal fixture', version: '1' },
        servers: [{ url: baseUrl }],
        paths: {
          '/api-upstream': {
            get: {
              operationId: 'identity',
              parameters: [{ name: 'x-personal-key', in: 'header', schema: { type: 'string' } }],
              responses: { '200': { description: 'ok' } },
            },
          },
        },
      },
      passthroughHeaders: ['x-personal-key'],
    },
  });
  await initializeClientsFromSettings(false);
  for (const serverName of ['httpShared', 'apiShared']) {
    for (const username of [alice, bob]) {
      const saved = await request(app)
        .put(`/api/credentials/${serverName}`)
        .set('x-auth-token', apiToken(username))
        .send({ values: { 'headers.X-Personal-Key': `${username}-http` } });
      expect(saved.status).toBe(200);
    }
    const [a, b] = await Promise.all([connect(alice, serverName), connect(bob, serverName)]);
    const toolName = (await a.listTools()).tools[0].name;
    const results = await Promise.all(
      [a, b].map((client) =>
        client.callTool({
          name: toolName,
          arguments: { 'x-personal-key': 'parameter-must-not-win' },
        }),
      ),
    );
    expect(results.map(parseIdentity).map((item) => item.credential)).toEqual([
      `${alice}-http`,
      `${bob}-http`,
    ]);
    await request(app)
      .put(`/api/credentials/${serverName}`)
      .set('x-auth-token', apiToken(alice))
      .send({ values: { 'headers.X-Personal-Key': 'alice-latest' } });
    expect(parseIdentity(await a.callTool({ name: toolName })).credential).toBe('alice-latest');
  }
  expect(createOAuthProvider).not.toHaveBeenCalled();
});

test('group visibility composes with personal credentials and revokes existing MCP sessions', async () => {
  const groupDao = getGroupDao();
  const group = await groupDao.create({
    name: 'shared-team',
    owner: 'admin',
    visibility: 'group',
    sharedWithUsers: [alice],
    servers: ['shared'],
  });
  const legacy = await groupDao.create({
    name: 'legacy-team',
    owner: 'admin',
    servers: ['shared'],
  });
  await bind(alice, 'alice-group-sentinel');
  const client = await connect(alice, group.name);
  const toolName = (await client.listTools()).tools[0].name;
  expect(parseIdentity(await client.callTool({ name: toolName, arguments: {} })).credential).toBe(
    'alice-group-sentinel',
  );
  const legacyClient = await connect(bob, legacy.name);
  expect((await legacyClient.listTools()).tools).toHaveLength(1);
  const initialize = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'group-test', version: '1' },
    },
  };
  const denied = await request(app)
    .post('/mcp/shared-team')
    .set('Authorization', `Bearer ${bob}-bearer`)
    .set('Accept', 'application/json, text/event-stream')
    .send(initialize);
  expect(denied.status).toBe(403);
  for (const route of ['/mcp/$smart%2Fshared-team', `/mcp/${group.id}`]) {
    const response = await request(app)
      .post(route)
      .set('Authorization', `Bearer ${bob}-bearer`)
      .set('Accept', 'application/json, text/event-stream')
      .send(initialize);
    expect(response.status).toBe(403);
  }
  const sseDenied = await request(app)
    .get('/sse/shared-team')
    .set('Authorization', `Bearer ${bob}-bearer`);
  expect(sseDenied.status).toBe(403);
  await getBearerKeyDao().create({
    name: 'unrelated-scope',
    token: 'unrelated-scope-token',
    kind: 'system',
    enabled: true,
    accessType: 'groups',
    allowedGroups: ['other-team'],
    createdAt: new Date().toISOString(),
  });
  const scoped = await request(app)
    .post('/mcp/shared-team')
    .set('Authorization', 'Bearer unrelated-scope-token')
    .set('Accept', 'application/json, text/event-stream')
    .send(initialize);
  expect(scoped.status).toBe(401);
  await groupDao.update(group.id, { sharedWithUsers: [] });
  await expect(client.listTools()).rejects.toThrow(/Group access denied/);
  // Restore for SDK session cleanup.
  await groupDao.update(group.id, { sharedWithUsers: [alice] });
});

test('group APIs validate visibility, sanitize nested metadata, and keep sharing read-only', async () => {
  const created = await request(app)
    .post('/api/groups')
    .set('x-auth-token', apiToken(alice))
    .send({ name: 'new-private', servers: ['shared'] });
  expect(created.status).toBe(201);
  expect(created.body.data.visibility).toBe('private');
  const invalid = await request(app)
    .put(`/api/groups/${created.body.data.id}`)
    .set('x-auth-token', apiToken(alice))
    .send({ visibility: 'shared' });
  expect(invalid.status).toBe(400);
  await getServerDao().create({
    name: 'hidden-server',
    owner: 'admin',
    visibility: 'private',
    type: 'stdio',
    command: 'unused',
  });
  const group = await getGroupDao().create({
    name: 'metadata-team',
    owner: 'admin',
    visibility: 'public',
    servers: [
      { name: 'hidden-server', alias: 'secret-alias', tools: ['secret-tool'] },
      { name: 'shared', tools: 'all' },
    ],
  });
  const detail = await request(app)
    .get(`/api/groups/${group.id}`)
    .set('x-auth-token', apiToken(alice));
  expect(detail.body.data.servers.map((s: any) => s.name)).toEqual(['shared']);
  expect(JSON.stringify(detail.body)).not.toContain('secret');
  const listing = await request(app).get('/api/groups').set('x-auth-token', apiToken(alice));
  expect(listing.body.data.some((g: any) => g.name === 'legacy-team')).toBe(false);
  expect(JSON.stringify(listing.body)).not.toContain('secret');
  const edit = await request(app)
    .put(`/api/groups/${group.id}`)
    .set('x-auth-token', apiToken(alice))
    .send({ visibility: 'private' });
  expect(edit.status).toBe(404);
  const candidates = await request(app)
    .get(`/api/groups/${group.id}/share-candidates`)
    .set('x-auth-token', apiToken(alice));
  expect(candidates.status).toBe(404);
});
