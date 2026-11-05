import { setTimeout as delay } from 'node:timers/promises';

const mockConfig = jest.fn();
const mockServer = jest.fn();
const mockGenerate = jest.fn();
jest.mock('../../src/utils/smartRouting.js', () => ({ getSmartRoutingConfig: mockConfig }));
jest.mock('../../src/dao/index.js', () => ({
  getServerDao: () => ({ findById: mockServer }),
}));
jest.mock('openai', () => ({
  __esModule: true,
  default: class {
    apiKey = 'test-key';
    embeddings = { create: mockGenerate };
  },
}));

import { initializeDatabase, closeDatabase, getAppDataSource } from '../../src/db/connection.js';
import {
  saveToolsAsVectorEmbeddings,
  removeServerToolEmbeddings,
} from '../../src/services/vectorSearchService.js';

// Requires an explicitly supplied disposable PostgreSQL instance with pgvector.
const dbSuite = process.env.MCPHUB_TEST_PG_PORT ? describe : describe.skip;
dbSuite('embedding mutation ordering with real PostgreSQL/pgvector (#703)', () => {
  const tool = { name: 'demo-read', description: 'Read data', inputSchema: {} };
  const config = {
    enabled: true,
    dbUrl: `postgres://mcphub_test:mcphub_test@127.0.0.1:${process.env.MCPHUB_TEST_PG_PORT}/mcphub_test`,
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-3-small',
    embeddingEncodingFormat: 'float',
    embeddingDimensions: 3,
    llmProviderBaseUrl: 'https://example.invalid/v1',
    llmProviderApiKey: 'test-key',
    basePacingDelayMs: 0,
  };
  const response = { data: [{ embedding: [1, 2, 3] }] };
  const count = async () =>
    Number((await getAppDataSource().query('SELECT count(*) FROM vector_embeddings'))[0].count);

  beforeAll(async () => {
    mockConfig.mockResolvedValue(config);
    await initializeDatabase();
  });
  beforeEach(async () => {
    mockConfig.mockResolvedValue(config);
    mockServer.mockResolvedValue({ name: 'demo', enabled: true });
    mockGenerate.mockReset().mockResolvedValue(response);
    await getAppDataSource().query('TRUNCATE vector_embeddings');
  });
  afterAll(async () => {
    await closeDatabase();
  });

  const pause = () => {
    let resume!: () => void;
    let signal!: () => void;
    const started = new Promise<void>((resolve) => {
      signal = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      resume = resolve;
    });
    mockGenerate.mockImplementationOnce(async () => {
      signal();
      await blocked;
      return response;
    });
    return { started, resume };
  };

  test('persists actual tool and server vectors and removes both', async () => {
    await saveToolsAsVectorEmbeddings('demo', [tool]);
    const rows = await getAppDataSource().query(
      'SELECT content_type, vector_dims(embedding) AS dims, model FROM vector_embeddings ORDER BY content_type',
    );
    expect(rows).toEqual([
      { content_type: 'server', dims: 3, model: config.embeddingModel },
      { content_type: 'tool', dims: 3, model: config.embeddingModel },
    ]);
    await removeServerToolEmbeddings('demo');
    expect(await count()).toBe(0);
  });

  test('cleanup completes while generation is paused and rows never reappear', async () => {
    const { started, resume } = pause();
    const sync = saveToolsAsVectorEmbeddings('demo', [tool]);
    await started;
    try {
      await removeServerToolEmbeddings('demo');
      expect(await count()).toBe(0);
    } finally {
      resume();
      await sync;
    }
    expect(await count()).toBe(0);
    await saveToolsAsVectorEmbeddings('demo', [tool]);
    expect(await count()).toBe(2);
  });

  test('cleanup waits for an INSERT blocked inside PostgreSQL, then removes its rows', async () => {
    const source = getAppDataSource();
    const lock = source.createQueryRunner();
    await lock.connect();
    await lock.query('SELECT pg_advisory_lock(703)');
    await source.query(
      `CREATE OR REPLACE FUNCTION block_embedding_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_advisory_xact_lock(703); RETURN NEW; END $$`,
    );
    await source.query(
      'CREATE TRIGGER block_embedding_insert BEFORE INSERT ON vector_embeddings FOR EACH ROW EXECUTE FUNCTION block_embedding_insert()',
    );
    const sync = saveToolsAsVectorEmbeddings('demo', [tool]);
    let cleanup: Promise<void> | undefined;
    try {
      let blocked = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        const rows = await source.query(
          "SELECT pid FROM pg_stat_activity WHERE wait_event = 'advisory' AND query ILIKE '%INSERT%vector_embeddings%'",
        );
        if (rows.length) {
          blocked = true;
          break;
        }
        await delay(25);
      }
      expect(blocked).toBe(true);
      cleanup = removeServerToolEmbeddings('demo');
    } finally {
      await lock.query('SELECT pg_advisory_unlock(703)');
      await lock.release();
      await Promise.all([sync, cleanup]);
      await source.query('DROP TRIGGER block_embedding_insert ON vector_embeddings');
      await source.query('DROP FUNCTION block_embedding_insert()');
    }
    expect(await count()).toBe(0);
  });

  test('rejects old dimensions before changing the real column or inserting rows', async () => {
    const { started, resume } = pause();
    const sync = saveToolsAsVectorEmbeddings('demo', [tool]);
    const rejection = expect(sync).rejects.toThrow('Embedding configuration changed');
    await started;
    mockConfig.mockResolvedValue({ ...config, embeddingDimensions: 6 });
    resume();
    await rejection;
    expect(await count()).toBe(0);
    const [column] = await getAppDataSource().query(
      "SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute WHERE attrelid = 'vector_embeddings'::regclass AND attname = 'embedding'",
    );
    expect(column.type).toBe('vector(3)');
  });
});
