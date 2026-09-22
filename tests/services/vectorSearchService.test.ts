const mockVectorRepository = {
  countByServerNameAndModel: jest.fn(),
  getToolIdentityByServerNameAndModel: jest.fn(),
  findByContentIdentity: jest.fn(),
  findEmbeddingStatus: jest.fn(),
  saveEmbedding: jest.fn(),
  searchSimilar: jest.fn(),
  deleteByServerName: jest.fn(),
  deleteStaleToolEmbeddings: jest.fn(),
};

const mockGetRepositoryFactory = jest.fn(() => () => mockVectorRepository);
const mockGetAppDataSource = jest.fn();
const mockIsDatabaseConnected = jest.fn();
const mockInitializeDatabase = jest.fn();
const mockReconnectDatabase = jest.fn();
const mockGetSmartRoutingConfig = jest.fn();
const mockFindServerById = jest.fn();
const mockEmbeddingCreate = jest.fn();
const mockOpenAIConstructor = jest.fn();
const mockGetServerDao = jest.fn(() => ({
  findById: mockFindServerById,
}));
const mockEmitStreamEvent = jest.fn();
const mockAxiosPost = jest.fn();

jest.mock('axios', () => ({
  post: mockAxiosPost,
}));

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
      create: mockEmbeddingCreate,
    };

    constructor(config: { apiKey?: string }) {
      this.apiKey = config.apiKey;
      mockOpenAIConstructor(config);
    }
  },
}));

import {
  buildToolSetHash,
  removeServerToolEmbeddings,
  saveToolsAsVectorEmbeddings,
  searchToolsByVector,
} from '../../src/services/vectorSearchService.js';

describe('vectorSearchService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEmbeddingCreate.mockReset();
    mockOpenAIConstructor.mockReset();
    mockAxiosPost.mockReset();

    mockGetSmartRoutingConfig.mockResolvedValue({
      enabled: true,
      dbUrl: 'postgres://localhost/test',
      embeddingProvider: 'openai',
      embeddingModel: 'text-embedding-3-small',
      llmProviderBaseUrl: 'https://api.openai.com/v1',
      llmProviderApiKey: '',
      embeddingDimensions: undefined,
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

  it('scopes the search to the requested servers in SQL, not after the limit', async () => {
    // Regression: the server filter used to be applied in JS *after* the
    // database had already returned the global top-`limit` rows. Embeddings are
    // keyed per server and the same tool set usually exists under several
    // server entries (read-only entry, write twin, per-user copies), so a
    // group-scoped search spent its whole budget on rows it then discarded and
    // could return nothing while good matches sat above the threshold.
    mockVectorRepository.searchSimilar.mockImplementation(
      async (
        _embedding: number[],
        limit: number,
        _threshold: number,
        contentTypes?: string[],
        serverNames?: string[],
      ) => {
        // Ordered by similarity like `ORDER BY similarity DESC` does: the
        // copies the caller did NOT ask for score higher than the one it did.
        const rows = contentTypes?.includes('tool')
          ? [
              {
                serverName: 'redis',
                toolName: 'redis-get',
                text: 'redis-get Read a cache value',
                similarity: 0.9,
              },
              {
                serverName: 'redis-rw',
                toolName: 'redis-rw-get',
                text: 'redis-rw-get Read a cache value',
                similarity: 0.8,
              },
              {
                serverName: 'redis-me',
                toolName: 'redis-me-get',
                text: 'redis-me-get Read a cache value',
                similarity: 0.65,
              },
            ]
          : [];

        // Stand in for the SQL predicate: the database filters, then limits.
        return rows
          .filter((row) => !serverNames || serverNames.includes(row.serverName))
          .slice(0, limit)
          .map((row) => ({
            embedding: {
              metadata: JSON.stringify({
                serverName: row.serverName,
                toolName: row.toolName,
                description: 'Read a cache value',
                inputSchema: {},
              }),
              text_content: row.text,
            },
            similarity: row.similarity,
          }));
      },
    );

    const results = await searchToolsByVector('read a cache value', 1, 0.3, ['redis-me']);

    expect(results.map((result) => result.toolName)).toEqual(['redis-me-get']);
    for (const call of mockVectorRepository.searchSimilar.mock.calls) {
      expect(call[4]).toEqual(['redis-me']);
    }
  });

  it('leaves the search unscoped when no server names are given', async () => {
    mockVectorRepository.searchSimilar.mockResolvedValue([]);

    await searchToolsByVector('anything', 10, 0.3);

    for (const call of mockVectorRepository.searchSimilar.mock.calls) {
      expect(call[4]).toBeUndefined();
    }
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
    mockVectorRepository.deleteStaleToolEmbeddings.mockResolvedValue(0);

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

    expect(mockVectorRepository.deleteStaleToolEmbeddings).toHaveBeenCalledWith(
      'redis',
      ['redis:redis-get'],
      'text-embedding-3-small',
    );

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

  it('preserves sibling embeddings during a partial tool update', async () => {
    mockVectorRepository.countByServerNameAndModel.mockResolvedValue(2);
    mockVectorRepository.saveEmbedding.mockResolvedValue({});

    await saveToolsAsVectorEmbeddings(
      'redis',
      [
        {
          name: 'redis-get',
          description: 'Updated description',
          inputSchema: { type: 'object' },
        },
      ],
      { partial: true },
    );

    expect(mockVectorRepository.saveEmbedding).toHaveBeenCalledWith(
      'tool',
      'redis:redis-get',
      expect.any(String),
      expect.any(Array),
      expect.any(Object),
      'text-embedding-3-small',
    );
    expect(mockVectorRepository.deleteStaleToolEmbeddings).not.toHaveBeenCalled();
    expect(mockVectorRepository.deleteByServerName).not.toHaveBeenCalled();
  });

  it('does not remove server embeddings for an empty partial update', async () => {
    await saveToolsAsVectorEmbeddings('redis', [], { partial: true });
    expect(mockVectorRepository.deleteByServerName).not.toHaveBeenCalled();
    expect(mockVectorRepository.deleteStaleToolEmbeddings).not.toHaveBeenCalled();
  });

  it('uses configured dimensions, the Dashboard API key, and normalized provider output', async () => {
    mockGetSmartRoutingConfig.mockResolvedValue({
      enabled: true,
      dbUrl: 'postgres://localhost/test',
      embeddingProvider: 'openai',
      embeddingEncodingFormat: 'float',
      embeddingDimensions: 2,
      embeddingModel: 'text-embedding-3-small',
      llmProviderBaseUrl: 'https://api.example.com/v1',
      llmProviderApiKey: 'sk-from-dashboard',
    });
    mockEmbeddingCreate.mockResolvedValue({ data: [{ embedding: [3, 4] }] });
    mockVectorRepository.countByServerNameAndModel.mockResolvedValue(0);
    mockVectorRepository.saveEmbedding.mockResolvedValue({});
    mockVectorRepository.deleteStaleToolEmbeddings.mockResolvedValue(0);
    mockGetAppDataSource.mockReturnValue({
      isInitialized: true,
      query: jest.fn(async (sql: string) => {
        if (sql.includes('format_type')) {
          return [{ formatted_type: 'vector(2)', atttypmod: 2 }];
        }
        if (sql.includes('SELECT atttypmod as dimensions')) {
          return [{ dimensions: 2 }];
        }
        if (sql.includes('GROUP BY dimensions, model')) {
          return [{ dimensions: 2, model: 'text-embedding-3-small', count: 1 }];
        }
        return [];
      }),
    });

    await saveToolsAsVectorEmbeddings('redis', [
      {
        name: 'redis-get',
        description: 'Get a cache value',
        inputSchema: {},
      } as any,
    ]);

    expect(mockOpenAIConstructor).toHaveBeenCalledWith({
      apiKey: 'sk-from-dashboard',
      baseURL: 'https://api.example.com/v1',
    });
    expect(mockEmbeddingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'text-embedding-3-small',
        dimensions: 2,
        encoding_format: 'float',
      }),
    );
    expect(mockVectorRepository.saveEmbedding).toHaveBeenCalledWith(
      'tool',
      'redis:redis-get',
      expect.any(String),
      [0.6, 0.8],
      expect.any(Object),
      'text-embedding-3-small',
    );
  });

  it('does not forward dimensions to non-MRL models (issue #1131)', async () => {
    mockGetSmartRoutingConfig.mockResolvedValue({
      enabled: true,
      dbUrl: 'postgres://localhost/test',
      embeddingProvider: 'openai',
      embeddingEncodingFormat: 'float',
      embeddingDimensions: 2560,
      embeddingModel: 'Qwen3-Embedding-4B',
      llmProviderBaseUrl: 'https://embeddings.example.com/v1',
      llmProviderApiKey: 'sk-from-dashboard',
    });
    mockEmbeddingCreate.mockResolvedValue({ data: [{ embedding: [1, 2, 3] }] });
    mockVectorRepository.countByServerNameAndModel.mockResolvedValue(0);
    mockVectorRepository.saveEmbedding.mockResolvedValue({});
    mockVectorRepository.deleteStaleToolEmbeddings.mockResolvedValue(0);
    mockGetAppDataSource.mockReturnValue({
      isInitialized: true,
      query: jest.fn(async (sql: string) => {
        if (sql.includes('format_type')) {
          return [{ formatted_type: 'vector(3)', atttypmod: 3 }];
        }
        if (sql.includes('SELECT atttypmod as dimensions')) {
          return [{ dimensions: 3 }];
        }
        if (sql.includes('GROUP BY dimensions, model')) {
          return [{ dimensions: 3, model: 'Qwen3-Embedding-4B', count: 1 }];
        }
        return [];
      }),
    });

    await saveToolsAsVectorEmbeddings('redis', [
      {
        name: 'redis-get',
        description: 'Get a cache value',
        inputSchema: {},
      } as any,
    ]);

    const createArgs = mockEmbeddingCreate.mock.calls[0][0];
    expect(createArgs).toMatchObject({
      model: 'Qwen3-Embedding-4B',
      encoding_format: 'float',
    });
    // Non-MRL models reject the `dimensions` parameter outright; it must not be sent.
    expect(createArgs).not.toHaveProperty('dimensions');
  });

  it('forwards dimensions for non-MRL models when embeddingDimensionsApiPassthrough is enabled', async () => {
    mockGetSmartRoutingConfig.mockResolvedValue({
      enabled: true,
      dbUrl: 'postgres://localhost/test',
      embeddingProvider: 'openai',
      embeddingEncodingFormat: 'float',
      embeddingDimensions: 2560,
      embeddingDimensionsApiPassthrough: true,
      embeddingModel: 'Qwen3-Embedding-4B',
      llmProviderBaseUrl: 'https://embeddings.example.com/v1',
      llmProviderApiKey: 'sk-from-dashboard',
    });
    mockEmbeddingCreate.mockResolvedValue({ data: [{ embedding: [1, 2, 3] }] });
    mockVectorRepository.countByServerNameAndModel.mockResolvedValue(0);
    mockVectorRepository.saveEmbedding.mockResolvedValue({});
    mockVectorRepository.deleteStaleToolEmbeddings.mockResolvedValue(0);
    mockGetAppDataSource.mockReturnValue({
      isInitialized: true,
      query: jest.fn(async (sql: string) => {
        if (sql.includes('format_type')) {
          return [{ formatted_type: 'vector(3)', atttypmod: 3 }];
        }
        if (sql.includes('SELECT atttypmod as dimensions')) {
          return [{ dimensions: 3 }];
        }
        if (sql.includes('GROUP BY dimensions, model')) {
          return [{ dimensions: 3, model: 'Qwen3-Embedding-4B', count: 1 }];
        }
        return [];
      }),
    });

    await saveToolsAsVectorEmbeddings('redis', [
      {
        name: 'redis-get',
        description: 'Get a cache value',
        inputSchema: {},
      } as any,
    ]);

    expect(mockEmbeddingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'Qwen3-Embedding-4B',
        dimensions: 2560,
      }),
    );
  });

  it('forwards dimensions on the Azure path for MRL models (issue #1131)', async () => {
    mockGetSmartRoutingConfig.mockResolvedValue({
      enabled: true,
      dbUrl: 'postgres://localhost/test',
      embeddingProvider: 'azure_openai',
      embeddingDimensions: 768,
      llmProviderApiKey: 'sk-for-truncation',
      azureOpenaiEndpoint: 'https://example.openai.azure.com',
      azureOpenaiApiKey: 'azure-key',
      azureOpenaiApiVersion: '2024-02-15-preview',
      azureOpenaiEmbeddingDeployment: 'my-embedding',
      azureOpenaiEmbeddingModel: 'text-embedding-3-small',
    });
    mockAxiosPost.mockResolvedValue({ data: { data: [{ embedding: [1, 2, 3] }] } });
    mockVectorRepository.countByServerNameAndModel.mockResolvedValue(0);
    mockVectorRepository.saveEmbedding.mockResolvedValue({});
    mockVectorRepository.deleteStaleToolEmbeddings.mockResolvedValue(0);
    mockGetAppDataSource.mockReturnValue({
      isInitialized: true,
      query: jest.fn(async (sql: string) => {
        if (sql.includes('format_type')) {
          return [{ formatted_type: 'vector(3)', atttypmod: 3 }];
        }
        if (sql.includes('SELECT atttypmod as dimensions')) {
          return [{ dimensions: 3 }];
        }
        if (sql.includes('GROUP BY dimensions, model')) {
          return [{ dimensions: 3, model: 'text-embedding-3-small', count: 1 }];
        }
        return [];
      }),
    });

    await saveToolsAsVectorEmbeddings('redis', [
      {
        name: 'redis-get',
        description: 'Get a cache value',
        inputSchema: {},
      } as any,
    ]);

    expect(mockAxiosPost.mock.calls[0][1]).toMatchObject({ dimensions: 768 });
  });

  it('does not forward dimensions on the Azure path for non-MRL models (issue #1131)', async () => {
    mockGetSmartRoutingConfig.mockResolvedValue({
      enabled: true,
      dbUrl: 'postgres://localhost/test',
      embeddingProvider: 'azure_openai',
      embeddingDimensions: 2560,
      llmProviderApiKey: 'sk-for-truncation',
      azureOpenaiEndpoint: 'https://example.openai.azure.com',
      azureOpenaiApiKey: 'azure-key',
      azureOpenaiApiVersion: '2024-02-15-preview',
      azureOpenaiEmbeddingDeployment: 'my-embedding',
      azureOpenaiEmbeddingModel: 'Qwen3-Embedding-4B',
    });
    mockAxiosPost.mockResolvedValue({ data: { data: [{ embedding: [1, 2, 3] }] } });
    mockVectorRepository.countByServerNameAndModel.mockResolvedValue(0);
    mockVectorRepository.saveEmbedding.mockResolvedValue({});
    mockVectorRepository.deleteStaleToolEmbeddings.mockResolvedValue(0);
    mockGetAppDataSource.mockReturnValue({
      isInitialized: true,
      query: jest.fn(async (sql: string) => {
        if (sql.includes('format_type')) {
          return [{ formatted_type: 'vector(3)', atttypmod: 3 }];
        }
        if (sql.includes('SELECT atttypmod as dimensions')) {
          return [{ dimensions: 3 }];
        }
        if (sql.includes('GROUP BY dimensions, model')) {
          return [{ dimensions: 3, model: 'Qwen3-Embedding-4B', count: 1 }];
        }
        return [];
      }),
    });

    await saveToolsAsVectorEmbeddings('redis', [
      {
        name: 'redis-get',
        description: 'Get a cache value',
        inputSchema: {},
      } as any,
    ]);

    expect(mockAxiosPost.mock.calls[0][1]).not.toHaveProperty('dimensions');
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
    mockVectorRepository.findEmbeddingStatus.mockResolvedValue(null);
    mockVectorRepository.saveEmbedding.mockResolvedValue({});
    mockVectorRepository.deleteStaleToolEmbeddings.mockResolvedValue(0);

    await saveToolsAsVectorEmbeddings('redis', tools);

    expect(mockVectorRepository.findEmbeddingStatus).toHaveBeenCalledWith('server', 'redis');
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

  describe('buildToolSetHash (issue #1198)', () => {
    const tool = (overrides: { hasDescriptionOverride?: boolean; description?: string }) => ({
      name: 'redis-get',
      description: overrides.description ?? 'Get a cache value',
      hasDescriptionOverride: overrides.hasDescriptionOverride,
      inputSchema: { type: 'object', properties: {} },
    });

    it('is stable across raw upstream description churn when there is no override', () => {
      const first = buildToolSetHash([tool({ description: 'raw description v1' }) as any]);
      const second = buildToolSetHash([
        tool({ description: 'raw description v2 entirely different' }) as any,
      ]);
      expect(first).toBe(second);
    });

    it('distinguishes an empty override from no override', () => {
      const withoutOverride = buildToolSetHash([tool({}) as any]);
      const emptyOverride = buildToolSetHash([
        tool({ hasDescriptionOverride: true, description: '' }) as any,
      ]);
      expect(emptyOverride).not.toBe(withoutOverride);
    });

    it('changes when an overridden description changes', () => {
      const first = buildToolSetHash([
        tool({ hasDescriptionOverride: true, description: 'SHORT override' }) as any,
      ]);
      const second = buildToolSetHash([
        tool({ hasDescriptionOverride: true, description: 'DIFFERENT override' }) as any,
      ]);
      expect(first).not.toBe(second);
    });

    it('changes when an override is added or removed', () => {
      const withoutOverride = buildToolSetHash([tool({}) as any]);
      const withOverride = buildToolSetHash([
        tool({ hasDescriptionOverride: true, description: 'SHORT override' }) as any,
      ]);
      expect(withoutOverride).not.toBe(withOverride);
    });
  });
});
