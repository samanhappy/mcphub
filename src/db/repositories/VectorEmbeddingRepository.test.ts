import { VectorEmbedding } from '../entities/VectorEmbedding.js';

const queryMock = jest.fn();
const getRepositoryMock = jest.fn(() => ({}));
const getAppDataSourceMock = jest.fn(() => ({
  getRepository: getRepositoryMock,
  query: queryMock,
}));

jest.mock('../connection.js', () => ({
  getAppDataSource: getAppDataSourceMock,
}));

import { VectorEmbeddingRepository } from './VectorEmbeddingRepository.js';

describe('VectorEmbeddingRepository.saveEmbedding', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each([
    ['a typed array', new Float32Array([0.1, 0.2])],
    ['an empty array', []],
    ['an array containing NaN', [0.1, Number.NaN]],
    ['an array containing Infinity', [0.1, Number.POSITIVE_INFINITY]],
  ])('rejects %s before writing', async (_description, embedding) => {
    const repository = new VectorEmbeddingRepository();

    await expect(
      repository.saveEmbedding('tool', 'server:tool', 'searchable text', embedding as number[]),
    ).rejects.toThrow('Invalid embedding for tool "server:tool"');

    expect(queryMock).not.toHaveBeenCalled();
  });

  it('fails when PostgreSQL reports that the vector was persisted as NULL', async () => {
    queryMock.mockResolvedValueOnce([
      {
        id: 'embedding-id',
        created_at: new Date('2026-07-28T00:00:00Z'),
        has_embedding: false,
        persisted_dimensions: null,
      },
    ]);
    const repository = new VectorEmbeddingRepository();

    await expect(
      repository.saveEmbedding('tool', 'server:tool', 'searchable text', [0.1, 0.2]),
    ).rejects.toThrow('Embedding for tool "server:tool" was persisted as NULL');
  });

  it('fails when PostgreSQL does not return the persisted row', async () => {
    queryMock.mockResolvedValueOnce([]);
    const repository = new VectorEmbeddingRepository();

    await expect(
      repository.saveEmbedding('tool', 'server:tool', 'searchable text', [0.1, 0.2]),
    ).rejects.toThrow('Embedding write for tool "server:tool" did not return a persisted row');
  });

  it('fails when PostgreSQL reports an unexpected vector dimension', async () => {
    queryMock.mockResolvedValueOnce([
      {
        id: 'embedding-id',
        created_at: new Date('2026-07-28T00:00:00Z'),
        has_embedding: true,
        persisted_dimensions: 1,
      },
    ]);
    const repository = new VectorEmbeddingRepository();

    await expect(
      repository.saveEmbedding('tool', 'server:tool', 'searchable text', [0.1, 0.2]),
    ).rejects.toThrow('Embedding for tool "server:tool" persisted with 1 dimensions; expected 2');
  });

  it('returns the saved entity after PostgreSQL confirms a non-null vector', async () => {
    queryMock.mockResolvedValueOnce([
      {
        id: 'embedding-id',
        created_at: new Date('2026-07-28T00:00:00Z'),
        has_embedding: true,
        persisted_dimensions: '2',
      },
    ]);
    const repository = new VectorEmbeddingRepository();

    const result = await repository.saveEmbedding(
      'tool',
      'server:tool',
      'searchable text',
      [0.1, 0.2],
      { serverName: 'server' },
      'embedding-model',
    );

    expect(queryMock).toHaveBeenCalledWith(
      expect.stringMatching(
        /embedding IS NOT NULL AS has_embedding,\s+vector_dims\(embedding\) AS persisted_dimensions/,
      ),
      [
        'tool',
        'server:tool',
        'searchable text',
        '[0.1,0.2]',
        2,
        '{"serverName":"server"}',
        'embedding-model',
      ],
    );
    expect(result).toEqual(
      expect.objectContaining<Partial<VectorEmbedding>>({
        id: 'embedding-id',
        content_type: 'tool',
        content_id: 'server:tool',
        dimensions: 2,
        metadata: { serverName: 'server' },
        model: 'embedding-model',
      }),
    );
  });
});
