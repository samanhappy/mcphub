// Mock openid-client before importing services
jest.mock('openid-client', () => ({
  discovery: jest.fn(),
  dynamicClientRegistration: jest.fn(),
  ClientSecretPost: jest.fn(() => jest.fn()),
  ClientSecretBasic: jest.fn(() => jest.fn()),
  None: jest.fn(() => jest.fn()),
  calculatePKCECodeChallenge: jest.fn(),
  randomPKCECodeVerifier: jest.fn(),
  buildAuthorizationUrl: jest.fn(),
  authorizationCodeGrant: jest.fn(),
  refreshTokenGrant: jest.fn(),
}));

import { Server } from 'http';
import { AppServer } from '../../src/server.js';
// Keep an independent v1 client to verify the v2 server's wire compatibility.
import { Client } from '@modelcontextprotocol/sdk-v1/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk-v1/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk-v1/client/streamableHttp.js';
import {
  Client as ModernClient,
  StreamableHTTPClientTransport as ModernStreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { TestServerHelper } from '../utils/testServerHelper.js';
import * as mockSettings from '../utils/mockSettings.js';
import {
  cleanupAllServers,
  deleteMcpServer,
  getServerByName,
} from '../../src/services/mcpService.js';
import type { ServerInfo } from '../../src/types/index.js';
import { transports } from '../../src/services/sseService.js';

describe('Real Client Transport Integration Tests', () => {
  let _appServer: AppServer;
  let httpServer: Server;
  let baseURL: string;
  let testServerHelper: TestServerHelper;

  beforeAll(async () => {
    const settings = mockSettings.createMockSettings({
      systemConfig: {
        routing: {
          enableGlobalRoute: true,
          enableGroupNameRoute: true,
          enableBearerAuth: true,
          bearerAuthKey: 'test-auth-token-123',
        },
        enableSessionRebuild: true,
      },
    });
    testServerHelper = new TestServerHelper();
    const result = await testServerHelper.createTestServer(settings);

    _appServer = result.appServer;
    httpServer = result.httpServer;
    baseURL = result.baseURL;

    // AppServer initializes upstreams asynchronously; wait before any test replaces the fixture.
    const deadline = Date.now() + 30000;
    while (getServerByName('test-server-1')?.status !== 'connected' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(getServerByName('test-server-1')?.status).toBe('connected');
  }, 60000);

  afterAll(async () => {
    // Clean up all MCP server connections first
    cleanupAllServers();

    // Close the test server properly using the helper
    if (testServerHelper) {
      await testServerHelper.closeTestServer();
    } else if (httpServer) {
      // Fallback to direct close if helper is not available
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
      });
    }

    // Wait a bit to ensure all async operations complete
    await new Promise((resolve) => setTimeout(resolve, 100));
  });

  describe('SSE Client Transport Tests', () => {
    it('should connect using real SSEClientTransport', async () => {
      const sseUrl = new URL(`${baseURL}/sse`);
      const options = {
        requestInit: {
          headers: {
            Authorization: 'Bearer test-auth-token-123',
          },
        },
      };

      const transport = new SSEClientTransport(sseUrl, options);

      const client = new Client(
        {
          name: 'real-sse-test-client',
          version: '1.0.0',
        },
        {
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
          },
        },
      );

      let isConnected = false;
      let error: any = null;

      try {
        await client.connect(transport, {});
        isConnected = true;
        console.log('SSE Client connected successfully');

        // Test list tools
        const tools = await client.listTools({});
        console.log('Available tools (SSE):', JSON.stringify(tools, null, 2));

        await client.close();
        console.log('SSE Client closed successfully');
      } catch (err) {
        error = err;
        console.error('SSE Client test failed:', err);

        if (isConnected) {
          try {
            await client.close();
          } catch (closeErr) {
            console.error('Error closing client:', closeErr);
          }
        }
      }

      expect(error).toBeNull();
      expect(isConnected).toBe(true);
    }, 60000);

    it('should connect using real SSEClientTransport with group', async () => {
      const testGroup = 'integration-test-group';
      const options = {
        requestInit: {
          headers: {
            Authorization: 'Bearer test-auth-token-123',
          },
        },
      };
      const sseUrl = new URL(`${baseURL}/sse/${testGroup}`);

      const transport = new SSEClientTransport(sseUrl, options);

      const client = new Client(
        {
          name: 'real-sse-group-test-client',
          version: '1.0.0',
        },
        {
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
          },
        },
      );

      let isConnected = false;
      let error: any = null;

      try {
        await client.connect(transport, {});
        isConnected = true;

        console.log(`SSE Client with group ${testGroup} connected successfully`);

        // Test basic operations
        const tools = await client.listTools({});
        console.log('Available tools (SSE with group):', JSON.stringify(tools, null, 2));

        await client.close();
      } catch (err) {
        error = err;
        console.error('SSE Client with group test failed:', err);

        if (isConnected) {
          try {
            await client.close();
          } catch (closeErr) {
            console.error('Error closing client:', closeErr);
          }
        }
      }

      expect(error).toBeNull();
      expect(isConnected).toBe(true);
    }, 60000);

    it('should connect using real SSEClientTransport with single server', async () => {
      const testServer = 'test-server-1';
      const options = {
        requestInit: {
          headers: {
            Authorization: 'Bearer test-auth-token-123',
          },
        },
      };
      const sseUrl = new URL(`${baseURL}/sse/${testServer}`);

      const transport = new SSEClientTransport(sseUrl, options);

      const client = new Client(
        {
          name: 'real-sse-server-test-client',
          version: '1.0.0',
        },
        {
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
          },
        },
      );

      let isConnected = false;
      let error: any = null;

      try {
        await client.connect(transport, {});
        isConnected = true;

        console.log(`SSE Client with server ${testServer} connected successfully`);

        // Test basic operations
        const tools = await client.listTools({});
        console.log('Available tools (SSE with server):', JSON.stringify(tools, null, 2));

        await client.close();
      } catch (err) {
        error = err;
        console.error('SSE Client with server test failed:', err);

        if (isConnected) {
          try {
            await client.close();
          } catch (closeErr) {
            console.error('Error closing client:', closeErr);
          }
        }
      }

      expect(error).toBeNull();
      expect(isConnected).toBe(true);
    }, 60000);
  });

  describe('MCP 2026-07-28 Dual-stack Tests', () => {
    it('validates routing headers before dispatch and preserves route and auth boundaries', async () => {
      const info = getServerByName('test-server-1')!;
      const original = {
        tools: info.tools,
        openApiClient: info.openApiClient,
        status: info.status,
      };
      const call = jest.fn(async () => ({ ok: true }));
      info.status = 'connected';
      info.tools = [{ name: 'test-server-1-header-test', inputSchema: { type: 'object' } }];
      info.openApiClient = { callTool: call } as unknown as ServerInfo['openApiClient'];
      const sessionsBefore = new Set(Object.keys(transports));
      const send = (route: string, name: string, headers: Record<string, string>) =>
        fetch(`${baseURL}${route}`, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer test-auth-token-123',
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'MCP-Protocol-Version': '2026-07-28',
            ...headers,
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: {
              name,
              arguments: {},
              _meta: {
                'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                'io.modelcontextprotocol/clientCapabilities': {},
              },
            },
          }),
        });
      try {
        for (const [route, name] of [
          ['/mcp', 'test-server-1-header-test'],
          ['/mcp/integration-test-group', 'test-server-1-header-test'],
          ['/mcp/test-server-1', 'header-test'],
        ]) {
          const response = await send(route, name, {
            'Mcp-Method': 'tools/call',
            'Mcp-Name': name,
          });
          expect(response.status).toBe(200);
          expect((await response.json()).result.isError).not.toBe(true);
        }
        const name = 'test-server-1-header-test';
        const encoded = await send('/mcp', name, {
          'mcp-method': 'tools/call',
          'mcp-name': `=?base64?${Buffer.from(name).toString('base64')}?=`,
        });
        expect(encoded.status).toBe(200);
        expect((await encoded.json()).result.isError).not.toBe(true);
        expect(call).toHaveBeenCalledTimes(4);
        for (const headers of [
          { 'Mcp-Name': name },
          { 'Mcp-Method': 'tools/call' },
          { 'Mcp-Method': 'tools/list', 'Mcp-Name': name },
          { 'Mcp-Method': 'tools/call', 'Mcp-Name': 'other-tool' },
          { 'Mcp-Method': 'tools/call', 'Mcp-Name': '=?base64?!!!?=' },
        ]) {
          const response = await send('/mcp', name, headers as Record<string, string>);
          expect(response.status).toBe(400);
          expect((await response.json()).error.code).toBe(-32020);
          expect(call).toHaveBeenCalledTimes(4);
        }
        const denied = await send('/mcp', name, {
          'Mcp-Method': 'tools/call',
          'Mcp-Name': name,
          Authorization: 'Bearer invalid-key',
        });
        expect(denied.status).toBe(401);
        expect(call).toHaveBeenCalledTimes(4);
        expect(Object.keys(transports).every((id) => sessionsBefore.has(id))).toBe(true);
      } finally {
        Object.assign(info, original);
      }
    });

    it('binds explicit application state to authenticated routes without downstream sessions', async () => {
      const info = getServerByName('test-server-1')!;
      const original = {
        tools: info.tools,
        config: info.config,
        openApiClient: info.openApiClient,
        status: info.status,
      };
      const call = jest.fn(async (_name, _args, _headers, _raw, id) => ({ state: id }));
      const clear = jest.fn();
      info.status = 'connected';
      info.tools = [{ name: 'test-server-1-stateful', inputSchema: { type: 'object' } }];
      info.config = {
        ...info.config,
        openapi: { ...info.config?.openapi, cookieSession: true },
      } as ServerInfo['config'];
      info.openApiClient = {
        callTool: call,
        clearSessionCookies: clear,
      } as unknown as ServerInfo['openApiClient'];
      const sessionIdsBefore = new Set(Object.keys(transports));
      const clients: ModernClient[] = [];
      const connect = async (route: string, handle?: string) => {
        const client = new ModernClient(
          { name: 'state-test', version: '1.0.0' },
          { versionNegotiation: { mode: 'auto' } },
        );
        clients.push(client);
        await client.connect(
          new ModernStreamableHTTPClientTransport(new URL(`${baseURL}${route}`), {
            requestInit: {
              headers: {
                Authorization: 'Bearer test-auth-token-123',
                ...(handle ? { 'X-MCPHub-State-Id': handle } : {}),
              },
            },
          }),
        );
        return client;
      };
      try {
        const handle = '65b523af-e4d0-4d99-8e06-461a62a14967';
        const a = await connect('/mcp', handle);
        const b = await connect('/mcp', handle);
        const c = await connect('/mcp/test-server-1', handle);
        for (const client of [a, b]) {
          expect(
            (await client.callTool({ name: 'test-server-1-stateful', arguments: {} })).isError,
          ).not.toBe(true);
        }
        expect(call).toHaveBeenCalledTimes(2);
        expect(call.mock.calls[0][4]).toBe(call.mock.calls[1][4]);
        expect((await c.callTool({ name: 'stateful', arguments: {} })).isError).not.toBe(true);
        expect(call).toHaveBeenCalledTimes(3);
        expect(call.mock.calls[2][4]).not.toBe(call.mock.calls[0][4]);
        const missing = await connect('/mcp');
        expect(
          (await missing.callTool({ name: 'test-server-1-stateful', arguments: {} })).isError,
        ).toBe(true);
        expect(call).toHaveBeenCalledTimes(3);
        expect(Object.keys(transports).every((id) => sessionIdsBefore.has(id))).toBe(true);
      } finally {
        await Promise.all(clients.map((client) => client.close()));
        Object.assign(info, original);
      }
    }, 60000);

    it('restricts upstream resource cache hints on the modern HTTP wire', async () => {
      const info = getServerByName('test-server-1')!;
      const resources = info.resources;
      info.resources = [{ uri: 'test://cache-hints', name: 'Cache hints' }];
      const read = jest.spyOn(info.client!, 'readResource').mockResolvedValue({
        contents: [{ uri: 'test://cache-hints', text: 'resource' }],
        ttlMs: 60000,
        cacheScope: 'public',
        _meta: { trace: 'preserved' },
      });
      try {
        const response = await fetch(`${baseURL}/mcp/test-server-1`, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer test-auth-token-123',
            'Content-Type': 'application/json',
            Accept: 'application/json, text/event-stream',
            'MCP-Protocol-Version': '2026-07-28',
            'Mcp-Method': 'resources/read',
            'Mcp-Name': 'test://cache-hints',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'resources/read',
            params: {
              uri: 'test://cache-hints',
              _meta: {
                'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                'io.modelcontextprotocol/clientCapabilities': {},
              },
            },
          }),
        });
        expect(response.status).toBe(200);
        const { result } = await response.json();
        expect(result.cacheScope).toBe('private');
        expect(result.ttlMs).toBeGreaterThan(0);
        expect(result.ttlMs).toBeLessThanOrEqual(60000);
        expect(result.contents).toEqual([{ uri: 'test://cache-hints', text: 'resource' }]);
        expect(result._meta).toMatchObject({ trace: 'preserved' });
        expect(read).toHaveBeenCalledWith({ uri: 'test://cache-hints' }, { cacheMode: 'bypass' });
      } finally {
        read.mockRestore();
        info.resources = resources;
      }
    });

    it('should serve modern requests without creating a downstream session', async () => {
      const sessionIdsBefore = new Set(Object.keys(transports));
      const transport = new ModernStreamableHTTPClientTransport(new URL(`${baseURL}/mcp`), {
        requestInit: {
          headers: {
            Authorization: 'Bearer test-auth-token-123',
          },
        },
      });
      const client = new ModernClient(
        {
          name: 'modern-http-test-client',
          version: '1.0.0',
        },
        {
          versionNegotiation: { mode: 'auto' },
        },
      );

      try {
        await client.connect(transport);

        expect(client.getProtocolEra()).toBe('modern');

        const tools = await client.listTools({});
        expect(Array.isArray(tools.tools)).toBe(true);
        for (const result of [
          tools,
          await client.listPrompts({}),
          await client.listResources({}),
          await client.listResourceTemplates({}),
        ]) {
          expect(result).toMatchObject({ ttlMs: 0, cacheScope: 'private' });
        }

        // 2026-07-28 HTTP is per-request/stateless and must not populate
        // MCPHub's legacy downstream session map.
        expect(Object.keys(transports).every((sessionId) => sessionIdsBefore.has(sessionId))).toBe(
          true,
        );
      } finally {
        await client.close();
      }
    }, 60000);
  });

  describe('StreamableHTTP Client Transport Tests', () => {
    it('should connect using real StreamableHTTPClientTransport', async () => {
      const mcpUrl = new URL(`${baseURL}/mcp`);
      const options: any = {
        requestInit: {
          headers: {
            Authorization: `Bearer test-auth-token-123`,
          },
        },
      };

      const transport = new StreamableHTTPClientTransport(mcpUrl, options);

      const client = new Client(
        {
          name: 'real-http-test-client',
          version: '1.0.0',
        },
        {
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
          },
        },
      );

      let isConnected = false;
      let error: any = null;

      try {
        await client.connect(transport, {});
        isConnected = true;
        console.log('HTTP Client connected successfully');

        // Test list tools
        const tools = await client.listTools({});
        console.log('Available tools (HTTP):', JSON.stringify(tools, null, 2));

        await client.close();
        console.log('HTTP Client closed successfully');
      } catch (err) {
        error = err;
        console.error('HTTP Client test failed:', err);

        if (isConnected) {
          try {
            await client.close();
          } catch (closeErr) {
            console.error('Error closing client:', closeErr);
          }
        }
      }

      expect(error).toBeNull();
      expect(isConnected).toBe(true);
    }, 60000);

    it('should connect using real StreamableHTTPClientTransport with group', async () => {
      const testGroup = 'integration-test-group';
      const mcpUrl = new URL(`${baseURL}/mcp/${testGroup}`);
      const options: any = {
        requestInit: {
          headers: {
            Authorization: `Bearer test-auth-token-123`,
          },
        },
      };

      const transport = new StreamableHTTPClientTransport(mcpUrl, options);

      const client = new Client(
        {
          name: 'real-http-group-test-client',
          version: '1.0.0',
        },
        {
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
          },
        },
      );

      let isConnected = false;
      let error: any = null;

      try {
        await client.connect(transport, {});
        isConnected = true;

        console.log(`HTTP Client with group ${testGroup} connected successfully`);

        // Test basic operations
        const tools = await client.listTools({});
        console.log('Available tools (HTTP with group):', JSON.stringify(tools, null, 2));

        await client.close();
      } catch (err) {
        error = err;
        console.error('HTTP Client with group test failed:', err);

        if (isConnected) {
          try {
            await client.close();
          } catch (closeErr) {
            console.error('Error closing client:', closeErr);
          }
        }
      }

      expect(error).toBeNull();
      expect(isConnected).toBe(true);
    }, 60000);

    it('continues an existing HTTP session through equivalent group routes', async () => {
      const testGroup = 'integration-test-group';
      const transport = new StreamableHTTPClientTransport(new URL(`${baseURL}/mcp/${testGroup}`), {
        requestInit: {
          headers: {
            Authorization: 'Bearer test-auth-token-123',
          },
        },
      });
      const client = new Client(
        {
          name: 'real-http-equivalent-route-test-client',
          version: '1.0.0',
        },
        {
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
          },
        },
      );

      try {
        await client.connect(transport, {});
        await client.listTools({});

        const sessionId = transport.sessionId;
        expect(sessionId).toBeDefined();

        for (const route of ['/mcp', `/mcp/$smart/${testGroup}`]) {
          const response = await fetch(baseURL + route, {
            method: 'POST',
            headers: {
              Accept: 'application/json, text/event-stream',
              Authorization: 'Bearer test-auth-token-123',
              'Content-Type': 'application/json',
              'mcp-session-id': sessionId as string,
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/list',
              params: {},
            }),
          });

          expect(response.ok).toBe(true);
          await response.arrayBuffer();
        }
      } finally {
        await client.close();
      }
    }, 60000);

    it('should connect using real StreamableHTTPClientTransport with single server', async () => {
      const testServer = 'test-server-1';
      const mcpUrl = new URL(`${baseURL}/mcp/${testServer}`);
      const options: any = {
        requestInit: {
          headers: {
            Authorization: `Bearer test-auth-token-123`,
          },
        },
      };

      const transport = new StreamableHTTPClientTransport(mcpUrl, options);

      const client = new Client(
        {
          name: 'real-http-server-test-client',
          version: '1.0.0',
        },
        {
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
          },
        },
      );

      let isConnected = false;
      let error: any = null;

      try {
        await client.connect(transport, {});
        isConnected = true;

        console.log(`HTTP Client with server ${testServer} connected successfully`);

        // Test basic operations
        const tools = await client.listTools({});
        console.log('Available tools (HTTP with server):', JSON.stringify(tools, null, 2));

        await client.close();
      } catch (err) {
        error = err;
        console.error('HTTP Client with server test failed:', err);

        if (isConnected) {
          try {
            await client.close();
          } catch (closeErr) {
            console.error('Error closing client:', closeErr);
          }
        }
      }

      expect(error).toBeNull();
      expect(isConnected).toBe(true);
    }, 60000);

    it.each([false, true])(
      'serves cached tool names after session rebuild (Apps: %s)',
      async (appsCapable) => {
        const testGroup = 'integration-test-group';
        const mcpUrl = new URL(`${baseURL}/mcp/${testGroup}`);
        const options: any = {
          requestInit: {
            headers: {
              Authorization: 'Bearer test-auth-token-123',
            },
          },
        };

        const transport = new StreamableHTTPClientTransport(mcpUrl, options);
        const client = new Client(
          {
            name: 'real-http-rebuild-test-client',
            version: '1.0.0',
          },
          {
            capabilities: {
              ...(appsCapable
                ? {
                    extensions: {
                      'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] },
                    },
                  }
                : {}),
              tools: {},
              resources: {},
              prompts: {},
            },
          },
        );

        const createTimeout = (ms: number) =>
          new Promise<never>((_, reject) => {
            setTimeout(() => {
              reject(new Error(`Timed out after ${ms}ms waiting for rebuilt session response`));
            }, ms);
          });

        const waitForTools = async () => {
          const maxAttempts = 30;

          for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const listedTools = await client.listTools({});

            if (listedTools.tools.length > 0) {
              return listedTools;
            }

            await new Promise((resolve) => setTimeout(resolve, 500));
          }

          throw new Error('Timed out waiting for upstream tools to become available');
        };

        let sessionId: string | undefined;

        try {
          await client.connect(transport, {});

          const tools = await waitForTools();
          sessionId = transport.sessionId;

          expect(sessionId).toBeDefined();
          expect(tools.tools.length).toBeGreaterThan(0);

          const toolName = tools.tools[0]?.name;

          expect(toolName).toBeDefined();

          delete transports[sessionId as string];
          deleteMcpServer(sessionId as string);

          const result = await Promise.race([
            client.callTool({ name: toolName as string, arguments: {} }),
            createTimeout(5000),
          ]);

          expect(result.isError).not.toBe(true);
          expect(result).toEqual(
            expect.objectContaining({
              content: expect.arrayContaining([
                expect.objectContaining({
                  type: 'text',
                }),
              ]),
            }),
          );
        } finally {
          if (sessionId) {
            delete transports[sessionId];
            deleteMcpServer(sessionId);
          }

          await client.close();
        }
      },
      60000,
    );
  });

  describe('Real Client Authentication Tests', () => {
    let _authAppServer: AppServer;
    let _authHttpServer: Server;
    let authBaseURL: string;

    beforeAll(async () => {
      const authSettings = mockSettings.createMockSettingsWithAuth();
      const authTestServerHelper = new TestServerHelper();
      const authResult = await authTestServerHelper.createTestServer(authSettings);

      _authAppServer = authResult.appServer;
      _authHttpServer = authResult.httpServer;
      authBaseURL = authResult.baseURL;
    }, 60000);

    afterAll(async () => {
      if (_authHttpServer) {
        _authHttpServer.close();
      }
    });

    it.each(['POST', 'GET', 'DELETE'])(
      'returns 404 for expired sessions with rebuild disabled (%s)',
      async (method) => {
        const response = await fetch(authBaseURL + '/mcp', {
          method,
          headers: {
            Authorization: 'Bearer test-auth-token-123',
            Accept: 'application/json, text/event-stream',
            'Content-Type': 'application/json',
            'mcp-session-id': 'expired-session-1144',
          },
          ...(method === 'POST'
            ? {
                body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
              }
            : {}),
        });
        expect(response.status).toBe(404);
        expect(await response.text()).toContain('Please reinitialize the session');
      },
    );

    it('should fail to connect with SSEClientTransport without auth', async () => {
      const sseUrl = new URL(`${authBaseURL}/sse`);
      const options = {
        requestInit: {
          headers: {
            Authorization: 'Bearer test-auth-token-123',
          },
        },
      };
      const transport = new SSEClientTransport(sseUrl, options);

      const client = new Client(
        {
          name: 'real-sse-test-client-no-auth',
          version: '1.0.0',
        },
        {
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
          },
        },
      );

      let error: any = null;

      try {
        await client.connect(transport, {});

        // Should not reach here due to auth failure
        await client.listTools({});

        await client.close();
      } catch (err) {
        error = err;
        console.log('Expected auth error:', err);

        try {
          await client.close();
        } catch (closeErr) {
          // Ignore close errors after connection failure
        }
      }

      expect(error).toBeDefined();
      if (error) {
        expect(error.message).toContain('401');
      }
    }, 60000);

    it('should connect with SSEClientTransport with valid auth', async () => {
      const sseUrl = new URL(`${authBaseURL}/sse`);

      const options = {
        requestInit: {
          headers: {
            Authorization: 'Bearer test-auth-token-123',
          },
        },
      };

      const transport = new SSEClientTransport(sseUrl, options);

      const client = new Client(
        {
          name: 'real-sse-auth-test-client',
          version: '1.0.0',
        },
        {
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
          },
        },
      );

      let isConnected = false;
      let error: any = null;

      try {
        await client.connect(transport, {});
        isConnected = true;
        console.log('SSE Client with auth connected successfully');

        // Test basic operations
        const tools = await client.listTools({});
        console.log('Available tools (SSE with auth):', JSON.stringify(tools, null, 2));

        await client.close();
      } catch (err) {
        error = err;
        console.error('SSE Client with auth test failed:', err);

        if (isConnected) {
          try {
            await client.close();
          } catch (closeErr) {
            console.error('Error closing client:', closeErr);
          }
        }
      }

      expect(error).toBeNull();
      expect(isConnected).toBe(true);
    }, 60000);

    it('should connect with StreamableHTTPClientTransport with auth', async () => {
      const mcpUrl = new URL(`${authBaseURL}/mcp`);

      const options = {
        requestInit: {
          headers: {
            Authorization: 'Bearer test-auth-token-123',
          },
        },
      };

      const transport = new StreamableHTTPClientTransport(mcpUrl, options);

      const client = new Client(
        {
          name: 'real-http-auth-test-client',
          version: '1.0.0',
        },
        {
          capabilities: {
            tools: {},
            resources: {},
            prompts: {},
          },
        },
      );

      let isConnected = false;
      let error: any = null;

      try {
        await client.connect(transport, {});
        isConnected = true;

        console.log('HTTP Client with auth connected successfully');

        // Test basic operations
        const tools = await client.listTools({});
        console.log('Available tools (HTTP with auth):', JSON.stringify(tools, null, 2));

        await client.close();
      } catch (err) {
        error = err;
        console.error('HTTP Client with auth test failed:', err);

        if (isConnected) {
          try {
            await client.close();
          } catch (closeErr) {
            console.error('Error closing client:', closeErr);
          }
        }
      }

      expect(error).toBeNull();
      expect(isConnected).toBe(true);
    }, 60000);
  });
});
