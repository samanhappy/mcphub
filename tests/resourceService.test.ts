import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Resource, ResourceTemplate } from '@modelcontextprotocol/sdk/types.js';
import * as mcpService from '../src/services/mcpService';
import * as config from '../src/config';

describe('Resource Service Integration Tests', () => {
  let hubClient: Client;
  let hubServer: Server;

  beforeAll(async () => {
    // Mock settings to only enable the 'everything' server
    vi.spyOn(config, 'loadSettings').mockReturnValue({
      mcpServers: {
        everything: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-everything'],
          enabled: true,
        },
        "time": {
          "command": "docker",
          "args": ["run", "-i", "--rm", "mcp/time"]
        }
      },
      systemConfig: {},
    });

    // Initialize upstream servers, this will connect to 'everything'
    await mcpService.initializeClientsFromSettings(true);

    // Poll until the 'everything' server is connected
    const startTime = Date.now();
    const timeout = 20000; // 20 seconds timeout
    while (true) {
      const servers = mcpService.getServersInfo();

      const disconnectedServer = servers.find(s => s.status === 'disconnected');
      if (disconnectedServer) {
        throw new Error(`Server '${disconnectedServer.name}' has disconnected.`);
      }
      
      const allConnected = servers.length > 0 && servers.every(s => s.status === 'connected');
      if (allConnected) {
        break;
      }

      if (Date.now() - startTime > timeout) {
        const notConnected = servers
          .filter(s => s.status !== 'connected')
          .map(s => `'${s.name}' (${s.status})`);
        throw new Error(`Timeout waiting for all servers to connect. Not connected: ${notConnected.join(', ')}`);
      }

      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const [clientTr, serverTr] = InMemoryTransport.createLinkedPair();

    // Create the MCP Hub server instance
    hubServer = mcpService.createMcpServer('mcphub-test', '1.0.0');
    hubServer.connect(serverTr);

    // Create a client to interact with our Hub, declaring resource capabilities
    hubClient = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: { resources: {} } });
    await hubClient.connect(clientTr);
  }, 30000);

  afterAll(() => {
    hubClient?.close();
    hubServer?.close();
    vi.restoreAllMocks();
  });

  describe('listResources', () => {
    it('should return an aggregated list of resources from the everything server', async () => {
      const response = await hubClient.listResources();
      
      expect(response.resources).toBeInstanceOf(Array);
      expect(response.resources.length).toBeGreaterThan(0);

      const sampleResource = response.resources.find((r: Resource) => r.uri.endsWith('/resource/2'));
      expect(sampleResource).toBeDefined();
      expect(sampleResource?.uri).toBe('test://static/resource/2');
    });
  });

  describe('listResourceTemplates', () => {
    it('should return an aggregated list of resource templates', async () => {
      const response = await hubClient.listResourceTemplates();

      expect(response.resourceTemplates).toBeInstanceOf(Array);
      expect(response.resourceTemplates.length).toBeGreaterThan(0);

      const echoTemplate = response.resourceTemplates.find((t: ResourceTemplate) => t.uriTemplate.endsWith('/resource/{id}'));
      expect(echoTemplate).toBeDefined();
      expect(echoTemplate?.uriTemplate).toBe('test://static/resource/{id}');
    });
  });

  describe('accessResource', () => {
    it('should access a resource successfully through the hub', async () => {
      const response = await hubClient.readResource({ uri: 'test://static/resource/1' });
      
      expect(response.contents[0].mimeType).toBe("text/plain");
      expect(response.contents[0].text).toBe('Resource 1: This is a plaintext resource');
    });

    it('should fail when accessing a non-existent resource', async () => {
       await expect(hubClient.readResource({ uri: 'test://static/resource/999' })).rejects.toThrow()
    });

  });
});