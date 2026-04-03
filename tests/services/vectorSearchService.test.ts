import { createHash } from 'node:crypto';

const mockVectorRepository = {
  countByServerNameAndModel: jest.fn(),
  getToolIdentityByServerNameAndModel: jest.fn(),
  findByContentIdentity: jest.fn(),
  saveEmbedding: jest.fn(),
  searchSimilar: jest.fn(),
  deleteByServerName: jest.fn(),
};

const mockGetRepositoryFactory = jest.fn(() => () => mockVectorRepository);
const mockGetAppDataSource = jest.fn();
const mockIsDatabaseConnected = jest.fn();
const mockInitializeDatabase = jest.fn();
const mockReconnectDatabase = jest.fn();
const mockGetSmartRoutingConfig = jest.fn();
const mockFindServerById = jest.fn();
const mockGetServerDao = jest.fn(() => ({
  findById: mockFindServerById,
}));
const mockEmitStreamEvent = jest.fn();

jest.mock('../../src/db/index.js', () => ({
  getRepositoryFactory: mockGetRepositoryFactory,
}));

jest.mock('../../src/db/connection.js', () => ({
  getAppDataSource: mockGetAppDataSource,
  isDatabaseConnected: mockIsDatabaseConnected,
  initializeDatabase: mockInitializeDatabase,
  reconnectDatabase: mockReconnectDatabase,
}));

jest.mock('../../src/utils/smartRouting.js', () => ({
  getSmartRoutingConfig: mockGetSmartRoutingConfig,
}));

jest.mock('../../src/dao/index.js', () => ({
  getServerDao: mockGetServerDao,
}));

jest.mock('../../src/services/logService.js', () => ({
  __esModule: true,
  default: {
    emitStreamEvent: mockEmitStreamEvent,
  },
}));

jest.mock('openai', () => ({
  __esModule: true,
  default: class MockOpenAI {
    apiKey?: string;
    embeddings = {
      create: jest.fn(),
    };

    constructor(config: { apiKey?: string }) {
      this.apiKey = config.apiKey;
    }
  },
}));

import {
  removeServerToolEmbeddings,
  saveToolsAsVectorEmbeddings,
  searchToolsByVector,
} from '../../src/services/vectorSearchService.js';

const stableHashSerialize = (value: unknown): string => {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableHashSerialize(item)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries
      .map(([key, val]) => `${JSON.stringify(key)}:${stableHashSerialize(val)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
};

const buildToolSetHash = (tools: Array<{ name: string; description?: string; inputSchema?: unknown }>) =>
  createHash('sha256')
    .update(
      stableHashSerialize(
        tools
          .map((tool) => ({
            name: tool.name || '',
            description: tool.description || '',
            inputSchema: tool.inputSchema || null,
          }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      ),
    )
    .digest('hex');

describe('vectorSearchService', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockGetSmartRoutingConfig.mockResolvedValue({
      enabled: true,
      dbUrl: 'postgres://localhost/test',
      embeddingProvider: 'openai',
      openaiApiEmbeddingModel: 'text-embedding-3-small',
      openaiApiBaseUrl: 'https://api.openai.com/v1',
      openaiApiKey: '',
    });
    mockFindServerById.mockResolvedValue({
      name: 'redis',
      description: 'Fast in-memory data store and cache',
    });
    mockIsDatabaseConnected.mockReturnValue(true);
    mockGetAppDataSource.mockReturnValue({
      isInitialized: true,
      query: jest.fn(async (sql: string) => {
        if (sql.includes('format_type')) {
          return [{ formatted_type: 'vector(100)', atttypmod: 100 }];
        }
        if (sql.includes('SELECT atttypmod as dimensions')) {
          return [{ dimensions: 100 }];
        }
        if (sql.includes('GROUP BY dimensions, model')) {
          return [{ dimensions: 100, model: 'text-embedding-3-small', count: 1 }];
        }
        return [];
      }),
    });
  });

  it('reranks tool results using server similarity and reuses one query embedding', async () => {
    mockVectorRepository.searchSimilar.mockImplementation(
      async (_embedding: number[], _limit: number, _threshold: number, contentTypes?: string[]) => {
        if (contentTypes?.includes('tool')) {
          return [
            {
              embedding: {
                metadata: JSON.stringify({
                  serverName: 'redis',
                  toolName: 'redis-set',
                  description: 'Set a cache value',
                  inputSchema: {},
                }),
                text_content: 'redis-set Set a cache value',
              },
              similarity: 0.7,
            },
            {
              embedding: {
                metadata: JSON.stringify({
                  serverName: 'mail',
                  toolName: 'mail-send',
                  description: 'Send an email',
                  inputSchema: {},
                }),
                text_content: 'mail-send Send an email',
              },
              similarity: 0.75,
            },
          ];
        }

        return [
          {
            embedding: {
              content_id: 'redis',
              metadata: JSON.stringify({
                serverName: 'redis',
                description: 'Fast in-memory data store and cache',
              }),
              text_content: 'redis Fast in-memory data store and cache',
            },
            similarity: 1,
          },
          {
            embedding: {
              content_id: 'mail',
              metadata: JSON.stringify({
                serverName: 'mail',
                description: 'SMTP email server',
              }),
              text_content: 'mail SMTP email server',
            },
            similarity: 0,
          },
        ];
      },
    );

    const results = await searchToolsByVector('缓存操作', 10, 0.7);

    expect(results.map((result) => result.toolName)).toEqual(['redis-set', 'mail-send']);
    expect(results[0].similarity).toBeCloseTo(0.76);
    expect(results[1].similarity).toBeCloseTo(0.6);
    expect(mockVectorRepository.searchSimilar).toHaveBeenCalledTimes(2);
    expect(mockVectorRepository.searchSimilar.mock.calls[0][0]).toBe(
      mockVectorRepository.searchSimilar.mock.calls[1][0],
    );
  });

  it('preserves the original tool similarity when no server score is available', async () => {
    mockVectorRepository.searchSimilar.mockImplementation(
      async (_embedding: number[], _limit: number, _threshold: number, contentTypes?: string[]) => {
        if (contentTypes?.includes('tool')) {
          return [
            {
              embedding: {
                metadata: JSON.stringify({
                  serverName: 'redis',
                  toolName: 'redis-set',
                  description: 'Set a cache value',
                  inputSchema: {},
                }),
                text_content: 'redis-set Set a cache value',
              },
              similarity: 0.82,
            },
          ];
        }

        return [];
      },
    );

    const results = await searchToolsByVector('缓存操作', 10, 0.7);

    expect(results).toHaveLength(1);
    expect(results[0].similarity).toBeCloseTo(0.82);
  });

  it('saves a server embedding alongside tool embeddings', async () => {
    mockVectorRepository.countByServerNameAndModel.mockResolvedValue(0);
    mockVectorRepository.saveEmbedding.mockResolvedValue({});

    await saveToolsAsVectorEmbeddings('redis', [
      {
        name: 'redis-get',
        description: 'Get a cache value',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string' },
          },
        },
      } as any,
    ]);

    expect(mockVectorRepository.saveEmbedding).toHaveBeenCalledWith(
      'server',
      'redis',
      'redis Fast in-memory data store and cache',
      expect.any(Array),
      {
        serverName: 'redis',
        description: 'Fast in-memory data store and cache',
      },
      'text-embedding-3-small',
    );
  });

  it('does not skip syncing when tool embeddings are current but the server embedding is missing', async () => {
    const tools = [
      {
        name: 'redis-get',
        description: 'Get a cache value',
        inputSchema: {
          type: 'object',
          properties: {
            key: { type: 'string' },
          },
        },
      } as any,
    ];

    mockVectorRepository.countByServerNameAndModel.mockResolvedValue(1);
    mockVectorRepository.getToolIdentityByServerNameAndModel.mockResolvedValue([
      {
        contentId: 'redis:redis-get',
        toolSetHash: buildToolSetHash(tools),
      },
    ]);
    mockVectorRepository.findByContentIdentity.mockResolvedValue(null);
    mockVectorRepository.saveEmbedding.mockResolvedValue({});

    await saveToolsAsVectorEmbeddings('redis', tools);

    expect(mockVectorRepository.findByContentIdentity).toHaveBeenCalledWith('server', 'redis');
    expect(mockVectorRepository.saveEmbedding).toHaveBeenCalledWith(
      'server',
      'redis',
      'redis Fast in-memory data store and cache',
      expect.any(Array),
      expect.objectContaining({
        serverName: 'redis',
      }),
      'text-embedding-3-small',
    );
  });

  it('removes server-level embeddings with tool embeddings', async () => {
    mockVectorRepository.deleteByServerName.mockResolvedValue(2);

    await removeServerToolEmbeddings('redis');

    expect(mockVectorRepository.deleteByServerName).toHaveBeenCalledWith('redis');
  });
});
