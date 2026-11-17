import type { ServerConfig, ServerInfo } from '../../src/types/index.js';

const mockFindAll = jest.fn();
const mockFindById = jest.fn();

jest.mock('../../src/services/oauthService.js', () => ({
  initializeAllOAuthClients: jest.fn(),
}));
jest.mock('../../src/services/mcpOAuthProvider.js', () => ({
  createOAuthProvider: async () => undefined,
}));
jest.mock('../../src/dao/index.js', () => ({
  getUserDao: () => ({ findByUsername: async () => null }),
  getServerDao: () => ({ findAll: mockFindAll, findById: mockFindById }),
  getGroupDao: () => ({ findByName: async () => null, findById: async () => null }),
  getSystemConfigDao: () => ({ get: async () => ({}) }),
}));
jest.mock('../../src/services/services.js', () => ({
  getDataService: () => ({ filterData: <T>(data: T[]) => data }),
}));
jest.mock('../../src/services/sseService.js', () => ({ getGroup: () => '' }));
jest.mock('../../src/services/activityLoggingService.js', () => ({
  getActivityLoggingService: () => ({ logToolCall: async () => undefined }),
}));
jest.mock('../../src/services/hostedAuthService.js', () => ({
  assertHostedToolAllowed: jest.fn(),
  reserveHostedToolCall: async () => null,
  settleHostedToolCall: async () => undefined,
}));
jest.mock('../../src/config/index.js', () => ({
  getNameSeparator: () => '::',
  default: { mcpHubName: 'test-hub', mcpHubVersion: '1.0.0' },
}));

import {
  cleanupAllServers,
  handleCallToolRequest,
  setServerInfosForTest,
} from '../../src/services/mcpService.js';

describe('MCP request scope across replica and personal runtime wrappers', () => {
  const oldMode = process.env.MCPHUB_REPLICA_MODE;

  afterEach(() => {
    cleanupAllServers();
    if (oldMode === undefined) delete process.env.MCPHUB_REPLICA_MODE;
    else process.env.MCPHUB_REPLICA_MODE = oldMode;
  });

  it.each(['disabled', 'deleted', 'tool disabled'])(
    'does not restore a %s upstream while preparing an unrelated personal runtime',
    async (change) => {
      const callTool = jest.fn(async () => ({ content: [{ type: 'text', text: 'executed' }] }));
      const definitions = [
        { name: 'personal', oauth: { identityMode: 'personal' as const } },
        { name: 'neutral' },
        { name: 'target' },
      ].map((config) => ({ ...config, enabled: true }));
      const infos: ServerInfo[] = definitions.map((config) => ({
        name: config.name,
        config,
        enabled: true,
        status: 'connected',
        tools:
          config.name === 'target'
            ? [{ name: 'target::run', inputSchema: { type: 'object' } }]
            : [],
        prompts: [],
        resources: [],
        createTime: Date.now(),
        error: null,
      }));
      infos[2].client = { callTool, close: jest.fn() } as unknown as ServerInfo['client'];
      setServerInfosForTest(infos);
      const live = definitions.flatMap((config) => {
        if (config.name !== 'target') return [config];
        if (change === 'deleted') return [];
        return [
          {
            ...config,
            ...(change === 'disabled'
              ? { enabled: false }
              : { tools: { 'target::run': { enabled: false } } }),
          },
        ];
      });
      mockFindAll.mockResolvedValue(live);
      mockFindById.mockImplementation(
        async (name: string): Promise<ServerConfig | undefined> =>
          live.find((config) => config.name === name),
      );
      process.env.MCPHUB_REPLICA_MODE = 'true';

      const result = await handleCallToolRequest(
        { params: { name: 'target::run', arguments: {} } },
        { sessionId: 'aggregate' },
      );

      expect(result.isError).toBe(true);
      expect(callTool).not.toHaveBeenCalled();
    },
  );
});
