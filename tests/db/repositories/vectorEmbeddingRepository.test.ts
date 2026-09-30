const mockQuery = jest.fn();

jest.mock('../../../src/db/connection.js', () => ({
  getAppDataSource: jest.fn(() => ({
    query: mockQuery,
    getRepository: jest.fn(() => ({})),
  })),
}));

import { VectorEmbeddingRepository } from '../../../src/db/repositories/VectorEmbeddingRepository.js';

describe('VectorEmbeddingRepository', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the stored text of each tool row next to its identity', async () => {
    mockQuery.mockResolvedValue([
      {
        content_id: 'notes:notes-list',
        metadata: { toolSetHash: 'abc' },
        text_content: 'notes-list List notes',
      },
      { content_id: 'notes:notes-get', metadata: '{"toolSetHash":"abc"}', text_content: null },
    ]);

    const identities = await new VectorEmbeddingRepository().getToolIdentityByServerNameAndModel(
      'notes',
      'embed',
    );

    expect(identities).toEqual([
      { contentId: 'notes:notes-list', toolSetHash: 'abc', textContent: 'notes-list List notes' },
      { contentId: 'notes:notes-get', toolSetHash: 'abc', textContent: undefined },
    ]);
    expect(mockQuery.mock.calls[0][0]).toContain('text_content');
  });

  it('deletes exactly the given tool rows', async () => {
    mockQuery.mockResolvedValue([[], 2]);

    const removed = await new VectorEmbeddingRepository().deleteToolEmbeddingsByContentIds([
      'notes:notes-delete',
      'notes:notes-purge',
    ]);

    expect(removed).toBe(2);
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('DELETE FROM vector_embeddings');
    expect(params).toEqual(['tool', ['notes:notes-delete', 'notes:notes-purge']]);
  });

  it('does not query for an empty list, and reports 0 when the delete fails', async () => {
    const repository = new VectorEmbeddingRepository();

    expect(await repository.deleteToolEmbeddingsByContentIds([])).toBe(0);
    expect(mockQuery).not.toHaveBeenCalled();

    mockQuery.mockRejectedValue(new Error('connection lost'));
    expect(await repository.deleteToolEmbeddingsByContentIds(['notes:notes-delete'])).toBe(0);
  });
});
