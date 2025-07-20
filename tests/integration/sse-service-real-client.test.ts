import { Server } from 'http';
import { AppServer } from '../../src/server.js';
import { TestServerHelper } from '../utils/testServerHelper.js';
import * as mockSettings from '../utils/mockSettings.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { cleanupAllServers } from '../../src/services/mcpService.js';

describe('Real Client Transport Integration Tests', () => {
  let _appServer: AppServer;
  let httpServer: Server;
  let baseURL: string;
  let testServerHelper: TestServerHelper;

  beforeAll(async () => {
    const settings = mockSettings.createMockSettings();
    testServerHelper = new TestServerHelper();
    const result = await testServerHelper.createTestServer(settings);

    _appServer = result.appServer;
    httpServer = result.httpServer;
    baseURL = result.baseURL;
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
    }, 30000);

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
    }, 30000);
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
    }, 30000);

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
    }, 30000);
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
    }, 30000);

    afterAll(async () => {
      if (_authHttpServer) {
        _authHttpServer.close();
      }
    });

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
    }, 30000);

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
    }, 30000);

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
    }, 30000);
  });
});
