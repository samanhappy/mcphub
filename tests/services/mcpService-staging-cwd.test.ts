/// <reference types="jest" />

/**
 * The staging boundary's fail-closed call site (#1056): a server that stages
 * must never start its child in the hub working directory. A cwd that cannot be
 * resolved refuses the launch instead of falling back.
 */

const mockFindByUsername = jest.fn();

// `openid-client` is ESM-only and reaches mcpService through oauthService.
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
jest.mock('../../src/services/sseService.js', () => ({ getGroup: jest.fn(() => '') }));
jest.mock('../../src/services/vectorSearchService.js', () => ({
  removeServerToolEmbeddings: jest.fn(),
  saveToolsAsVectorEmbeddings: jest.fn(),
}));
jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({ filterData: (data: any) => data })),
}));
jest.mock('../../src/services/smartRoutingService.js', () => ({
  initSmartRoutingService: jest.fn(),
  getSmartRoutingTools: jest.fn(),
  handleSearchToolsRequest: jest.fn(),
  handleDescribeToolRequest: jest.fn(),
  isSmartRoutingGroup: jest.fn(() => false),
}));
jest.mock('../../src/services/activityLoggingService.js', () => ({
  getActivityLoggingService: jest.fn(() => ({ logToolCall: jest.fn() })),
}));

jest.mock('../../src/dao/DaoFactory.js', () => ({
  getServerDao: () => ({
    findById: async () => null,
    findAll: async () => [],
    findByUrl: async () => null,
  }),
  getUserDao: () => ({ findByUsername: mockFindByUsername }),
  getSystemConfigDao: () => ({ get: async () => ({}) }),
  getSettingsDao: () => ({ get: async () => ({}) }),
  getGroupDao: () => ({ findAll: async () => [] }),
  getVectorSearchDao: () => ({}),
}));

jest.mock('@modelcontextprotocol/client/stdio', () => ({
  StdioClientTransport: jest.fn().mockImplementation((options: unknown) => ({ options })),
}));

import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createTransportFromConfig } from '../../src/services/mcpService.js';
import type { ServerConfig } from '../../src/types/index.js';

const stagedConfig = (overrides: Partial<ServerConfig> = {}): ServerConfig =>
  ({
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@fangjunjie/ssh-mcp-server@1.11.0', '--host', 'h'],
    owner: 'missing-user',
    visibility: 'private',
    staging: { adapter: 'ssh' },
    tools: {
      upload: { enabled: true, fileStaging: { enabled: true, inputParams: ['localPath'] } },
    },
    ...overrides,
  }) as ServerConfig;

describe('staging cwd at the transport seam', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFindByUsername.mockResolvedValue(null);
  });

  it('refuses to launch a staged child when the principal cannot be resolved', async () => {
    // No user row for the owner: the per-principal root has no owner to key on.
    // The specific refusal matters: an earlier argv-validation failure would
    // also match a loose /staging/ pattern and hide a fallback to the hub cwd.
    await expect(createTransportFromConfig('sftp', stagedConfig())).rejects.toThrow(
      /principal is unavailable/i,
    );
    expect(StdioClientTransport).not.toHaveBeenCalled();
  });

  it('starts a non-staged stdio server in the hub cwd as before', async () => {
    const config = stagedConfig({
      staging: undefined,
      tools: { upload: { enabled: true } },
    } as Partial<ServerConfig>);

    await createTransportFromConfig('plain', config);

    expect(StdioClientTransport).toHaveBeenCalledTimes(1);
    const options = (StdioClientTransport as unknown as jest.Mock).mock.calls[0][0];
    expect(options.cwd).toBe(process.cwd());
  });
});
