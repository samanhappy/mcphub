jest.mock('openid-client', () => ({}));
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Server as HttpServer } from 'node:http';
import express from 'express';
import request from 'supertest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { JsonFileDaoFactory, setDaoFactory } from '../../src/dao/DaoFactory.js';
import {
  sseUserContextMiddleware,
} from '../../src/middlewares/userContext.js';
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
import { clearSettingsCache } from '../../src/config/index.js';
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

const fixture = path.resolve('tests/fixtures/credential-server.mjs');
const token = 'exclude-scope-token';
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
        visibility: 'public',
      },
    },
    groups: [],
    bearerKeys: [
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
