import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createMcpHandler, Server } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { LegacyMcpClient } from '../../src/clients/legacyMcpClient.js';
import { TestServerHelper } from '../utils/testServerHelper.js';
import {
  cleanupAllServers,
  getServerByName,
  reconnectServer,
} from '../../src/services/mcpService.js';
import { transports } from '../../src/services/sseService.js';

jest.mock('../../src/services/mcpOAuthProvider.js', () => ({
  createOAuthProvider: jest.fn(async () => undefined),
}));

jest.mock('openid-client', () => ({
  discovery: jest.fn(),
  dynamicClientRegistration: jest.fn(),
  ClientSecretPost: jest.fn(),
  ClientSecretBasic: jest.fn(),
  None: jest.fn(),
}));

describe('Hub default auto upstream over real HTTP', () => {
  let upstream: HttpServer;
  let helper: TestServerHelper;
  let client: LegacyMcpClient;
  let revision = 1;
  let ttlMs: number | undefined = 0;
  const requests: Array<{ method: string; session?: string; version?: string }> = [];
  const counts = { tools: 0, prompts: 0, resources: 0 };

  const waitForUpstream = async () => {
    for (let i = 0; i < 200; i++) {
      if (getServerByName('upstream')?.status === 'connected') return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Upstream did not finish connecting');
  };

  beforeAll(async () => {
    const handler = createMcpHandler(
      () => {
        const server = new Server(
          { name: 'modern-upstream', version: '1' },
          {
            capabilities: { tools: {}, prompts: {}, resources: {} },
          },
        );
        server.setRequestHandler('tools/list', async () => {
          counts.tools++;
          return {
            tools: [{ name: `tool${revision}`, inputSchema: { type: 'object' } }],
            ...(ttlMs === undefined ? {} : { ttlMs }),
          };
        });
        server.setRequestHandler('tools/call', async () => ({
          content: [{ type: 'text', text: `revision${revision}` }],
        }));
        server.setRequestHandler('prompts/list', async () => {
          counts.prompts++;
          return { prompts: [{ name: `prompt${revision}` }], ttlMs: 0 };
        });
        server.setRequestHandler('prompts/get', async () => ({ messages: [] }));
        server.setRequestHandler('resources/list', async () => {
          counts.resources++;
          return {
            resources: [{ name: `resource${revision}`, uri: `test://resource${revision}` }],
            ttlMs: 0,
          };
        });
        return server;
      },
      { legacy: 'reject' },
    );
    const nodeHandler = toNodeHandler(handler);
    upstream = createServer((req, res) => {
      requests.push({
        method: String(req.headers['mcp-method'] || req.method),
        session: req.headers['mcp-session-id'] as string | undefined,
        version: req.headers['mcp-protocol-version'] as string | undefined,
      });
      void nodeHandler(req, res);
    });
    await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    helper = new TestServerHelper();
    const { baseURL } = await helper.createTestServer({
      mcpServers: {
        upstream: {
          type: 'streamable-http',
          owner: 'admin',
          url: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/mcp`,
        },
      },
      users: [{ username: 'admin', password: 'unused', isAdmin: true }],
      groups: [],
      systemConfig: {
        routing: {
          enableGlobalRoute: true,
          enableGroupNameRoute: true,
          enableBearerAuth: true,
          bearerAuthKey: 'auto-test-token',
        },
      },
    });
    await waitForUpstream();
    client = new LegacyMcpClient({ name: 'legacy-downstream', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${baseURL}/mcp/upstream`), {
        requestInit: { headers: { Authorization: 'Bearer auto-test-token' } },
      }),
    );
  }, 45000);

  afterAll(async () => {
    await client?.close();
    cleanupAllServers();
    for (const [id, context] of Object.entries(transports)) {
      await context.transport.close();
      delete transports[id];
    }
    await helper?.closeTestServer();
    if (upstream)
      await new Promise<void>((resolve) => {
        upstream.closeAllConnections();
        upstream.close(() => resolve());
      });
  });

  it('negotiates modern upstream without initialize, GET or upstream sessions', async () => {
    expect(getServerByName('upstream')?.client?.getProtocolEra()).toBe('modern');
    expect(getServerByName('upstream')?.client?.getNegotiatedProtocolVersion()).toBe('2026-07-28');
    await expect(client.listTools()).resolves.toMatchObject({ tools: [{ name: 'tool1' }] });
    expect(requests[0].method).toBe('server/discover');
    expect(
      requests.every(
        (request) => request.session === undefined && request.version === '2026-07-28',
      ),
    ).toBe(true);
    expect(
      requests.some((request) => request.method === 'initialize' || request.method === 'GET'),
    ).toBe(false);
  });

  it('updates all advertised lists without push or TTL, including direct calls', async () => {
    revision = 2;
    ttlMs = undefined;
    await expect(client.listTools()).resolves.toMatchObject({ tools: [{ name: 'tool2' }] });
    await expect(client.listPrompts()).resolves.toMatchObject({
      prompts: [{ name: 'upstream-prompt2' }],
    });
    await expect(client.listResources()).resolves.toMatchObject({
      resources: [{ uri: 'test://resource2' }],
    });
    revision = 3;
    await expect(client.callTool({ name: 'tool3', arguments: {} })).resolves.toMatchObject({
      content: [{ text: 'revision3' }],
    });
  });

  it('uses TTL until expiry and negotiates again after reconnect', async () => {
    ttlMs = 60000;
    await client.listTools();
    const before = counts.tools;
    await client.listTools();
    expect(counts.tools).toBe(before);
    const probes = requests.filter((request) => request.method === 'server/discover').length;
    await reconnectServer('upstream');
    await waitForUpstream();
    expect(getServerByName('upstream')?.client?.getProtocolEra()).toBe('modern');
    expect(
      requests.filter((request) => request.method === 'server/discover').length,
    ).toBeGreaterThan(probes);
  });
});
