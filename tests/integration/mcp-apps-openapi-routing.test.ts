jest.mock('openid-client', () => ({}));
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Server as HttpServer } from 'node:http';
import express from 'express';
import request from 'supertest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Server as McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { clearSettingsCache, getNameSeparator } from '../../src/config/index.js';
import { JsonFileDaoFactory, setDaoFactory } from '../../src/dao/DaoFactory.js';
import { updateMyCredential } from '../../src/controllers/credentialBindingController.js';
import { auth } from '../../src/middlewares/auth.js';
import {
  sseUserContextMiddleware,
  userContextMiddleware,
} from '../../src/middlewares/userContext.js';
import {
  cleanupAllServers,
  getServerByName,
  initializeClientsFromSettings,
} from '../../src/services/mcpService.js';
import { PrincipalRuntimeService } from '../../src/services/principalRuntimeService.js';
import {
  handleMcpOtherRequest,
  handleMcpPostRequest,
  transports,
} from '../../src/services/sseService.js';
import type { McpSettings } from '../../src/types/index.js';
import { MCP_APPS_CAPABILITIES } from '../../src/utils/mcpApps.js';
import { createUserToken } from '../utils/testHelpers.js';

jest.mock('../../src/services/oauthService.js', () => ({ initializeAllOAuthClients: jest.fn() }));
jest.mock('../../src/services/mcpOAuthProvider.js', () => ({ createOAuthProvider: jest.fn() }));
jest.mock('../../src/services/vectorSearchService.js', () => ({
  removeServerToolEmbeddings: jest.fn(),
  removeToolEmbeddings: jest.fn(),
  saveToolsAsVectorEmbeddings: jest.fn(),
  syncAllServerToolsEmbeddings: jest.fn(),
}));
jest.mock('../../src/services/activityLoggingService.js', () => ({
  getActivityLoggingService: () => ({ logToolCall: jest.fn() }),
}));
jest.mock('../../src/services/toolResultCompressionService.js', () => ({
  maybeCompressToolResult: (result: unknown) => result,
}));
jest.mock('../../src/services/betterAuthConfig.js', () => ({
  getBetterAuthRuntimeConfig: jest.fn(async () => ({ enabled: false })),
}));

const alice = 'alice@example.com';
const bob = 'bob@example.com';
const clients: Client[] = [];
const restCalls: string[] = [];
let app: express.Express;
let server: HttpServer;
let baseUrl: string;
let directory: string;
const originalEnv = {
  MCPHUB_SETTING_PATH: process.env.MCPHUB_SETTING_PATH,
  MCPHUB_CREDENTIAL_ENCRYPTION_KEY: process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY,
  USE_DB: process.env.USE_DB,
};

beforeAll(async () => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-apps-openapi-e2e-'));
  process.env.MCPHUB_SETTING_PATH = path.join(directory, 'settings.json');
  process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.USE_DB = 'false';
  app = express();
  app.use(express.json());
  app.use('/api', auth, userContextMiddleware);
  app.put('/api/credentials/:name', updateMyCredential);
  const routes = ['/mcp', '/mcp/:group'];
  app.post(routes, sseUserContextMiddleware, handleMcpPostRequest);
  app.get(routes, sseUserContextMiddleware, handleMcpOtherRequest);
  app.delete(routes, sseUserContextMiddleware, handleMcpOtherRequest);
  app.post('/upstream-mcp', async (req, res) => {
    const upstream = new McpServer(
      { name: 'private-mcp-fixture', version: '1' },
      { capabilities: { tools: {} } },
    );
    upstream.setRequestHandler('tools/list', async () => ({
      tools: [{ name: 'identity', inputSchema: { type: 'object' } }],
    }));
    upstream.setRequestHandler('tools/call', async () => ({
      content: [
        { type: 'text', text: JSON.stringify({ credential: req.headers['x-personal-key'] }) },
      ],
    }));
    const transport = new NodeStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      void transport.close();
      void upstream.close();
    });
    await upstream.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });
  app.get('/upstream-rest', (req, res) => {
    const credential = req.headers['x-personal-key'] as string;
    restCalls.push(credential);
    res.json({ credential, upstream: 'rest' });
  });
  server = await new Promise<HttpServer>((resolve) => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const credentialTemplate = [{ target: 'headers' as const, name: 'X-Personal-Key' }];
  const settings: McpSettings = {
    mcpServers: {
      shared: {
        type: 'streamable-http',
        url: `${baseUrl}/upstream-mcp`,
        owner: 'admin',
        visibility: 'public',
      },
      regular: {
        type: 'streamable-http',
        url: `${baseUrl}/upstream-mcp`,
        owner: alice,
        visibility: 'private',
        credentialTemplate,
      },
      rest: {
        type: 'openapi',
        owner: alice,
        visibility: 'private',
        credentialTemplate,
        openapi: {
          schema: {
            openapi: '3.0.0',
            info: { title: 'Private REST fixture', version: '1' },
            servers: [{ url: baseUrl }],
            paths: {
              '/upstream-rest': {
                get: {
                  operationId: 'identity',
                  parameters: [
                    { name: 'x-personal-key', in: 'header', schema: { type: 'string' } },
                  ],
                  responses: { '200': { description: 'ok' } },
                },
              },
            },
          },
          passthroughHeaders: ['x-personal-key'],
        },
      },
    },
    users: [alice, bob, 'admin'].map((username) => ({
      username,
      password: 'unused',
      isAdmin: username === 'admin',
    })),
    groups: [
      {
        id: 'mixed-group',
        name: 'mixed',
        owner: alice,
        visibility: 'private',
        servers: ['shared', 'regular', 'rest'],
      },
    ],
    bearerKeys: [alice, bob].map((username, index) => ({
      id: `apps-personal-${index}`,
      name: username,
      token: `${username}-bearer`,
      kind: 'user',
      owner: username,
      enabled: true,
      accessType: 'all',
      createdAt: new Date().toISOString(),
    })),
    systemConfig: {
      network: { allowedCidrs: ['127.0.0.1/32'] },
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
  for (const name of ['regular', 'rest']) {
    const result = await request(app)
      .put(`/api/credentials/${name}`)
      .set('x-auth-token', createUserToken(alice, false))
      .send({ values: { 'headers.X-Personal-Key': `alice-${name}-credential` } });
    expect(result.status).toBe(200);
  }
  const deadline = Date.now() + 5000;
  while (getServerByName('shared')?.status === 'connecting' && Date.now() < deadline) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  expect(getServerByName('shared')?.status).toBe('connected');
});

afterAll(async () => {
  for (const client of clients) await client.close();
  for (const entry of Object.values(transports)) await entry.transport.close();
  cleanupAllServers();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (directory) fs.rmSync(directory, { recursive: true, force: true });
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  clearSettingsCache();
  JsonFileDaoFactory.getInstance().resetInstances();
});

const connect = async (username: string, route = '') => {
  const client = new Client(
    { name: 'apps-openapi-e2e', version: '1' },
    { capabilities: MCP_APPS_CAPABILITIES },
  );
  clients.push(client);
  await client.connect(
    new StreamableHTTPClientTransport(new URL(`${baseUrl}/mcp${route}`), {
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

test.each(['', '/mixed'])(
  'Apps clients can call a qualified private OpenAPI tool after listing mixed personal children (%s)',
  async (route) => {
    const client = await connect(alice, route);
    const acquire = jest.spyOn(PrincipalRuntimeService.prototype, 'acquire');
    try {
      const qualifiedName = `rest${getNameSeparator()}identity`;
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).toEqual([
        `shared${getNameSeparator()}identity`,
        `regular${getNameSeparator()}identity`,
        qualifiedName,
      ]);
      expect(acquire.mock.calls.map(([name]) => name).sort()).toEqual(['regular', 'rest']);

      // A target-only call has just the OpenAPI child in its request scope. The
      // route must retain the qualified name advertised by the preceding list.
      acquire.mockClear();
      const result = await client.callTool({
        name: qualifiedName,
        arguments: { 'x-personal-key': 'parameter-must-not-win' },
      });
      expect(result.isError).not.toBe(true);
      expect(result.content).toEqual([
        {
          type: 'text',
          text: expect.stringContaining('alice-rest-credential'),
        },
      ]);
      expect(acquire.mock.calls.map(([name]) => name)).toEqual(['rest']);
      expect(restCalls.at(-1)).toBe('alice-rest-credential');
    } finally {
      acquire.mockRestore();
    }
  },
);

test("Apps capability does not expose or invoke another user's private OpenAPI child", async () => {
  const client = await connect(bob);
  const callsBefore = restCalls.length;
  const acquire = jest.spyOn(PrincipalRuntimeService.prototype, 'acquire');
  try {
    expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(['identity']);
    const result = await client.callTool({ name: `rest${getNameSeparator()}identity` });
    expect(result.isError).toBe(true);
    expect(restCalls).toHaveLength(callsBefore);
    expect(acquire).not.toHaveBeenCalled();
  } finally {
    acquire.mockRestore();
  }
});
