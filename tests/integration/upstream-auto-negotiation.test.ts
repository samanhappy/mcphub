import { clearUpstreamLists } from '../../src/services/upstreamListRefresh.js';
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
  let hubURL: string;
  const identityClients: LegacyMcpClient[] = [];
  let identityTtl: number | undefined = 60000;
  let identityGate: Promise<void> | undefined;
  const identityStarted = new Set<string>();
  let failLists = false;
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
      ({ requestInfo }) => {
        const kind = new URL(requestInfo!.url).pathname.slice(1);
        const identity = requestInfo!.headers.get('X-Custom-User-Id') ?? 'anonymous';
        const server = new Server(
          { name: 'modern-upstream', version: '1' },
          {
            capabilities: { tools: {}, prompts: {}, resources: {} },
          },
        );
        if (kind !== 'mcp') {
          const suffix = kind === 'identity' ? identity : kind;
          const beforeList = async () => {
            if (kind === 'failing' && failLists) throw new Error('upstream list unavailable');
            if (kind === 'identity') {
              identityStarted.add(identity);
              await identityGate;
            }
          };
          const hints = () =>
            kind === 'identity'
              ? identityTtl === undefined
                ? {}
                : { ttlMs: identityTtl }
              : { ttlMs: kind === 'healthy' ? 60000 : 0 };
          server.setRequestHandler('tools/list', async () => {
            await beforeList();
            return {
              tools: [{ name: `tool_${suffix}`, inputSchema: { type: 'object' } }],
              ...hints(),
            };
          });
          server.setRequestHandler('tools/call', async () => ({
            content: [{ type: 'text', text: suffix }],
          }));
          server.setRequestHandler('prompts/list', async () => {
            await beforeList();
            return { prompts: [{ name: `prompt_${suffix}` }], ...hints() };
          });
          server.setRequestHandler('resources/list', async () => {
            await beforeList();
            return {
              resources: [{ name: `resource_${suffix}`, uri: `test://${suffix}` }],
              ...hints(),
            };
          });
          server.setRequestHandler('resources/read', async ({ params }) => ({
            contents: [{ uri: params.uri, text: suffix }],
          }));
          return server;
        }
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
        ...Object.fromEntries(
          ['identity', 'healthy', 'failing'].map((name) => [
            name,
            {
              type: 'streamable-http' as const,
              owner: 'admin',
              url: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/${name}`,
              ...(name === 'identity' ? { passthroughHeaders: ['X-Custom-User-Id'] } : {}),
            },
          ]),
        ),
        upstream: {
          type: 'streamable-http',
          owner: 'admin',
          url: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/mcp`,
        },
      },
      users: [{ username: 'admin', password: 'unused', isAdmin: true }],
      groups: [{ id: 'mixed', name: 'mixed', servers: ['healthy', 'failing'] }],
      prompts: [{ id: 'builtin-prompt', name: 'builtin_prompt', template: 'built in' }],
      resources: [
        {
          id: 'builtin-resource',
          name: 'builtin_resource',
          uri: 'test://builtin',
          content: 'built in',
        },
      ],
      systemConfig: {
        routing: {
          enableGlobalRoute: true,
          enableGroupNameRoute: true,
          enableBearerAuth: true,
          bearerAuthKey: 'auto-test-token',
        },
      },
    });
    hubURL = baseURL;
    await waitForUpstream();
    // Startup lists must finish before testing TTL reuse or introducing failures.
    for (let i = 0; i < 200; i++) {
      if (
        ['identity', 'healthy', 'failing'].every((name) => getServerByName(name)?.resources.length)
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    client = new LegacyMcpClient({ name: 'legacy-downstream', version: '1' });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(`${baseURL}/mcp/upstream`), {
        requestInit: { headers: { Authorization: 'Bearer auto-test-token' } },
      }),
    );
  }, 45000);

  afterAll(async () => {
    await Promise.all(identityClients.map((entry) => entry.close()));
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
      prompts: expect.arrayContaining([expect.objectContaining({ name: 'upstream-prompt2' })]),
    });
    await expect(client.listResources()).resolves.toMatchObject({
      resources: expect.arrayContaining([expect.objectContaining({ uri: 'test://resource2' })]),
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

  const identityClient = async (identity: string, route = 'identity', modern = false) => {
    const entry = new LegacyMcpClient(
      { name: `caller-${identity}`, version: '1' },
      modern ? { versionNegotiation: { mode: 'auto' } } : undefined,
    );
    identityClients.push(entry);
    await entry.connect(
      new StreamableHTTPClientTransport(new URL(`${hubURL}/mcp/${route}`), {
        requestInit: {
          headers: {
            Authorization: 'Bearer auto-test-token',
            ...(identity === 'missing' ? {} : { 'X-Custom-User-Id': identity }),
          },
        },
      }),
    );
    return entry;
  };

  it.each(['tools', 'prompts', 'resources'] as const)(
    'isolates positive-TTL %s by forwarded identity',
    async (field) => {
      identityTtl = 60000;
      clearUpstreamLists(getServerByName('identity')!.client!);
      const alice = await identityClient('alice');
      const bob = await identityClient('bob');
      const list = (entry: LegacyMcpClient) =>
        field === 'tools'
          ? entry.listTools()
          : field === 'prompts'
            ? entry.listPrompts()
            : entry.listResources();
      expect(JSON.stringify(await list(alice))).toContain('alice');
      expect(JSON.stringify(await list(bob))).toContain('bob');
      expect(JSON.stringify(await list(bob))).not.toContain('alice');
      expect(JSON.stringify(getServerByName('identity')?.[field])).not.toMatch(/alice|bob/);
    },
  );

  it.each(['tools', 'prompts', 'resources'] as const)(
    'does not coalesce concurrent %s for different identities without a reusable TTL',
    async (field) => {
      const ttl = field === 'tools' ? 0 : undefined;
      identityTtl = ttl;
      identityStarted.clear();
      clearUpstreamLists(getServerByName('identity')!.client!);
      const alice = await identityClient('alice');
      const bob = await identityClient('bob');
      let release!: () => void;
      identityGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const list = (entry: LegacyMcpClient) =>
        field === 'tools'
          ? entry.listTools()
          : field === 'prompts'
            ? entry.listPrompts()
            : entry.listResources();
      const pending = Promise.all([list(alice), list(bob)]);
      try {
        for (
          let i = 0;
          i < 100 && (!identityStarted.has('alice') || !identityStarted.has('bob'));
          i++
        ) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
      } finally {
        release();
        identityGate = undefined;
      }
      const [a, b] = await pending;
      expect(JSON.stringify(a)).toContain('alice');
      expect(JSON.stringify(a)).not.toContain('bob');
      expect(JSON.stringify(b)).toContain('bob');
      expect(JSON.stringify(b)).not.toContain('alice');
      expect([...identityStarted].sort()).toEqual(['alice', 'bob']);
    },
  );

  it('keeps callers without a forwarded identity anonymous and routes personalized calls', async () => {
    const alice = await identityClient('alice');
    const missing = await identityClient('missing');
    expect((await missing.listTools()).tools.map((tool) => tool.name)).toEqual(['tool_anonymous']);
    await expect(alice.callTool({ name: 'tool_alice', arguments: {} })).resolves.toMatchObject({
      content: [{ text: 'alice' }],
    });
    await expect(alice.readResource({ uri: 'test://alice' })).resolves.toMatchObject({
      contents: [{ text: 'alice' }],
    });
    expect(JSON.stringify(getServerByName('identity')?.tools)).not.toContain('alice');
  });

  it('keeps healthy resource reads and partial lists available when another upstream fails', async () => {
    const mixed = await identityClient('reader', 'mixed', true);
    failLists = true;
    try {
      await expect(
        mixed.readResource({ uri: 'test://healthy' }, { cacheMode: 'bypass' }),
      ).resolves.toMatchObject({
        contents: [{ text: 'healthy' }],
      });
      const tools = await mixed.listTools();
      expect(tools.tools.map((tool) => tool.name)).toEqual(['healthy-tool_healthy']);
      expect(tools.ttlMs).toBe(0);
      const prompts = await mixed.listPrompts();
      expect(prompts.prompts.map((prompt) => prompt.name)).toEqual(
        expect.arrayContaining(['healthy-prompt_healthy', 'builtin_prompt']),
      );
      expect(prompts.prompts.some((prompt) => prompt.name.includes('failing'))).toBe(false);
      const resources = await mixed.listResources();
      expect(resources.resources.map((resource) => resource.uri)).toEqual(
        expect.arrayContaining(['test://healthy', 'test://builtin']),
      );
      expect(resources.resources.some((resource) => resource.uri === 'test://failing')).toBe(false);
      // A request-local failure must not disconnect the shared client or erase its last snapshot.
      expect(getServerByName('failing')?.status).toBe('connected');
      expect(getServerByName('failing')?.tools.length).toBe(1);
    } finally {
      failLists = false;
    }
    expect(
      (await mixed.listTools()).tools.some((tool) => tool.name === 'failing-tool_failing'),
    ).toBe(true);
  });
});
