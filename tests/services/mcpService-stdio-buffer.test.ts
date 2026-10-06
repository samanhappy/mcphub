import { Client } from '@modelcontextprotocol/client';

const mockBaseFetch = jest.fn();

jest.mock('../../src/services/oauthService.js', () => ({
  initializeAllOAuthClients: jest.fn(),
}));

jest.mock('../../src/services/mcpOAuthProvider.js', () => ({
  createOAuthProvider: jest.fn(async () => undefined),
}));

jest.mock('../../src/services/groupService.js', () => ({
  getServersInGroup: jest.fn(),
  getServerConfigInGroup: jest.fn(),
}));

jest.mock('../../src/services/sseService.js', () => ({
  getGroup: jest.fn(() => ''),
}));

jest.mock('../../src/services/vectorSearchService.js', () => ({
  removeServerToolEmbeddings: jest.fn(),
  saveToolsAsVectorEmbeddings: jest.fn(),
}));

jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({
    filterData: (data: any) => data,
  })),
}));

jest.mock('../../src/services/smartRoutingService.js', () => ({
  initSmartRoutingService: jest.fn(),
  getSmartRoutingTools: jest.fn(),
  handleSearchToolsRequest: jest.fn(),
  handleDescribeToolRequest: jest.fn(),
  isSmartRoutingGroup: jest.fn(() => false),
}));

jest.mock('../../src/services/activityLoggingService.js', () => ({
  getActivityLoggingService: jest.fn(() => ({
    logToolCall: jest.fn(),
  })),
}));

jest.mock('../../src/services/keepAliveService.js', () => ({
  setupClientKeepAlive: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../src/services/proxy.js', () => ({
  createFetchWithProxy: jest.fn(() => mockBaseFetch),
  getProxyConfigFromEnv: jest.fn(() => undefined),
}));

jest.mock('../../src/dao/index.js', () => ({
  getUserDao: jest.fn(() => ({
    findByUsername: jest.fn(async (username: string) => ({ isAdmin: username === 'admin' })),
  })),
  getServerDao: jest.fn(() => ({
    findAll: jest.fn(async () => []),
    findById: jest.fn(async () => null),
  })),
  getSystemConfigDao: jest.fn(() => ({
    get: jest.fn(async () => ({})),
  })),
  getBuiltinPromptDao: jest.fn(() => ({
    findEnabled: jest.fn(async () => []),
  })),
  getBuiltinResourceDao: jest.fn(() => ({
    findEnabled: jest.fn(async () => []),
  })),
}));

import { createTransportFromConfig } from '../../src/services/mcpService.js';
import { normalizeServerConfigForPersistence } from '../../src/utils/serverConfigPersistence.js';

// A real local process supplies one JSON-RPC message larger than the SDK default.
const serverScript = `
const readline = require('node:readline');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const req = JSON.parse(line);
  if (req.id === undefined) return;
  let result = {};
  if (req.method === 'initialize') result = { protocolVersion: req.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'big', version: '1' } };
  if (req.method === 'tools/call') result = { content: [{ type: 'text', text: 'x'.repeat(req.params.arguments.bytes) }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }) + '\\n');
});`;

describe('stdio buffer configuration with real process', () => {
  const connect = async (maxBufferSize?: number) => {
    const config = normalizeServerConfigForPersistence({
      type: 'stdio',
      command: process.execPath,
      args: ['-e', serverScript],
      options: { maxBufferSize },
    });
    const transport = await createTransportFromConfig('big', config);
    const client = new Client({ name: 'test', version: '1' });
    await client.connect(transport);
    return { client, transport };
  };
  it('receives an 11 MiB response and remains connected when configured', async () => {
    const { client } = await connect(16 * 1024 * 1024);
    try {
      const result = await client.callTool({ name: 'big', arguments: { bytes: 11 * 1024 * 1024 } });
      expect((result.content as Array<{ text: string }>)[0].text.length).toBe(11 * 1024 * 1024);
      const followup = await client.callTool({ name: 'big', arguments: { bytes: 10 } });
      expect(followup.content).toEqual([{ type: 'text', text: 'xxxxxxxxxx' }]);
    } finally {
      await client.close();
    }
  }, 30000);
  it('retains the default limit when omitted', async () => {
    const { client } = await connect();
    try {
      await expect(
        client.callTool({ name: 'big', arguments: { bytes: 11 * 1024 * 1024 } }),
      ).rejects.toThrow('Connection closed');
    } finally {
      await client.close();
    }
  }, 30000);
  it.each([0, -1, 1.5, NaN, Infinity])(
    'rejects invalid file-config limits before spawning: %s',
    async (maxBufferSize) => {
      await expect(
        createTransportFromConfig('invalid', {
          command: process.execPath,
          options: { maxBufferSize },
        }),
      ).rejects.toThrow('positive safe integer');
    },
  );
});
