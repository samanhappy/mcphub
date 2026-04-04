import { VectorEmbedding } from '../entities/VectorEmbedding.js';
import BaseRepository from './BaseRepository.js';
import { getAppDataSource } from '../connection.js';

// Escape special characters for SQL LIKE patterns.
// This is used in methods that filter by content_id with a prefix,
// to ensure that server names with special characters don't break the query.
const escapeLikePattern = (value: string): string => value.replace(/([\\%_])/g, '\\$1');

export class VectorEmbeddingRepository extends BaseRepository<VectorEmbedding> {
  constructor() {
    super(VectorEmbedding);
  }

  /**
   * Find by content type and ID
   * @param contentType Content type
   * @param contentId Content ID
   */
  async findByContentIdentity(
    contentType: string,
    contentId: string,
  ): Promise<VectorEmbedding | null> {
    return this.repository.findOneBy({
      content_type: contentType,
      content_id: contentId,
    });
  }

  /**
   * Create or update an embedding for content
   * @param contentType Content type
   * @param contentId Content ID
   * @param textContent Text content to embed
   * @param embedding Vector embedding
   * @param metadata Additional metadata
   * @param model Model used to create the embedding
   */
  async saveEmbedding(
    contentType: string,
    contentId: string,
    textContent: string,
    embedding: number[],
    metadata: Record<string, any> = {},
    model = 'default',
  ): Promise<VectorEmbedding> {
    // Check if embedding exists
    let vectorEmbedding = await this.findByContentIdentity(contentType, contentId);

    if (!vectorEmbedding) {
      vectorEmbedding = new VectorEmbedding();
      vectorEmbedding.content_type = contentType;
      vectorEmbedding.content_id = contentId;
    }

    // Update properties
    vectorEmbedding.text_content = textContent;
    vectorEmbedding.embedding = embedding;
    vectorEmbedding.dimensions = embedding.length;
    vectorEmbedding.metadata = metadata;
    vectorEmbedding.model = model;

    // For raw SQL operations where our subscriber might not be called
    // Ensure the embedding is properly formatted for postgres
    const rawEmbedding = this.formatEmbeddingForPgVector(embedding);
    if (rawEmbedding) {
      (vectorEmbedding as any).embedding = rawEmbedding;
    }

    return this.save(vectorEmbedding);
  }

  /**
   * Search for similar embeddings using cosine similarity
   * @param embedding Vector embedding to search against
   * @param limit Maximum number of results (default: 10)
   * @param threshold Similarity threshold (default: 0.7)
   * @param contentTypes Optional content types to filter by
   */
  async searchSimilar(
    embedding: number[],
    limit = 10,
    threshold = 0.7,
    contentTypes?: string[],
  ): Promise<Array<{ embedding: VectorEmbedding; similarity: number }>> {
    try {
      // Try using vector similarity operator first
      try {
        // Build query with vector operators
        let query = getAppDataSource()
          .createQueryBuilder()
          .select('vector_embedding.*')
          .addSelect(`1 - (vector_embedding.embedding <=> :embedding) AS similarity`)
          .from(VectorEmbedding, 'vector_embedding')
          .where(`1 - (vector_embedding.embedding <=> :embedding) > :threshold`)
          .orderBy('similarity', 'DESC')
          .limit(limit)
          .setParameter(
            'embedding',
            Array.isArray(embedding) ? `[${embedding.join(',')}]` : embedding,
          )
          .setParameter('threshold', threshold);

        // Add content type filter if provided
        if (contentTypes && contentTypes.length > 0) {
          query = query
            .andWhere('vector_embedding.content_type IN (:...contentTypes)')
            .setParameter('contentTypes', contentTypes);
        }

        // Execute query
        const results = await query.getRawMany();

        // Return results if successful
        return results.map((row) => ({
          embedding: this.mapRawToEntity(row),
          similarity: parseFloat(row.similarity),
        }));
      } catch (vectorError) {
        console.warn(
          'Vector similarity search failed, falling back to basic filtering:',
          vectorError,
        );

        // Fallback to just getting the records by content type
        let query = this.repository.createQueryBuilder('vector_embedding');

        // Add content type filter if provided
        if (contentTypes && contentTypes.length > 0) {
          query = query
            .where('vector_embedding.content_type IN (:...contentTypes)')
            .setParameter('contentTypes', contentTypes);
        }

        // Limit results
        query = query.take(limit);

        // Execute query
        const results = await query.getMany();

        // Return results with a placeholder similarity
        return results.map((entity) => ({
          embedding: entity,
          similarity: 0.5, // Placeholder similarity
        }));
      }
    } catch (error) {
      console.error('Error during vector search:', error);
      return [];
    }
  }

  /**
   * Search by text using vector similarity
   * @param text Text to search for
   * @param getEmbeddingFunc Function to convert text to embedding
   * @param limit Maximum number of results
   * @param threshold Similarity threshold
   * @param contentTypes Optional content types to filter by
   */
  async searchByText(
    text: string,
    getEmbeddingFunc: (text: string) => Promise<number[]>,
    limit = 10,
    threshold = 0.7,
    contentTypes?: string[],
  ): Promise<Array<{ embedding: VectorEmbedding; similarity: number }>> {
    try {
      // Get embedding for the search text
      const embedding = await getEmbeddingFunc(text);

      // Search by embedding
      return this.searchSimilar(embedding, limit, threshold, contentTypes);
    } catch (error) {
      console.error('Error searching by text:', error);
      return [];
    }
  }

  /**
   * Count tool embeddings for a specific server that were generated with a given model.
   * Used to determine whether embeddings are already up-to-date before regenerating.
   * @param serverName Server name
   * @param model Embedding model identifier
   * @returns Number of matching embeddings
   */
  async countByServerNameAndModel(serverName: string, model: string): Promise<number> {
    const prefix = `${escapeLikePattern(serverName)}:%`;

    return this.repository
      .createQueryBuilder('ve')
      .where('ve.content_type = :ct', { ct: 'tool' })
      .andWhere("ve.content_id LIKE :prefix ESCAPE '\\'", { prefix })
      .andWhere('ve.model = :model', { model })
      .getCount();
  }

  /**
   * Return tool embedding identities for a specific server and model.
   * Used by skip-check logic to verify exact tool IDs and tool-set hash.
   */
  async getToolIdentityByServerNameAndModel(
    serverName: string,
    model: string,
  ): Promise<Array<{ contentId: string; toolSetHash?: string }>> {
    const prefix = `${escapeLikePattern(serverName)}:%`;

    const rows = await this.repository
      .createQueryBuilder('ve')
      .select(['ve.content_id', 've.metadata'])
      .where('ve.content_type = :ct', { ct: 'tool' })
      .andWhere("ve.content_id LIKE :prefix ESCAPE '\\'", { prefix })
      .andWhere('ve.model = :model', { model })
      .andWhere('ve.embedding IS NOT NULL')
      .getMany();

    return rows.map((row) => ({
      contentId: row.content_id,
      toolSetHash:
        row.metadata && typeof row.metadata === 'object'
          ? (row.metadata as Record<string, unknown>).toolSetHash?.toString()
          : undefined,
    }));
  }

  /**
   * Delete tool and server embeddings for a specific server
   * @param serverName Server name
   * @returns Number of deleted embeddings
   */
  async deleteByServerName(serverName: string): Promise<number> {
    try {
      const prefix = `${escapeLikePattern(serverName)}:%`;

      const result = await this.repository
        .createQueryBuilder()
        .delete()
        .from(VectorEmbedding)
        .where(
          `(content_type = :toolContentType AND content_id LIKE :prefix ESCAPE '\\')
          OR (content_type = :serverContentType AND content_id = :serverName)`,
          {
            toolContentType: 'tool',
            serverContentType: 'server',
            prefix,
            serverName,
          },
        )
        .execute();

      return result.affected || 0;
    } catch (error) {
      console.error(`Error deleting embeddings for server ${serverName}:`, error);
      return 0;
    }
  }

  /**
   * Map raw database result to entity
   * @param raw Raw database result
   */
  private mapRawToEntity(raw: any): VectorEmbedding {
    const entity = new VectorEmbedding();
    entity.id = raw.id;
    entity.content_type = raw.content_type;
    entity.content_id = raw.content_id;
    entity.text_content = raw.text_content;
    entity.metadata = raw.metadata;
    entity.embedding = raw.embedding;
    entity.dimensions = raw.dimensions;
    entity.model = raw.model;
    entity.createdAt = raw.created_at;
    entity.updatedAt = raw.updated_at;
    return entity;
  }

  /**
   * Format embedding array for pgvector
   * @param embedding Array of embedding values
   * @returns Properly formatted vector string for pgvector
   */
  private formatEmbeddingForPgVector(embedding: number[] | string): string | null {
    if (!embedding) return null;

    // If it's already a string and starts with '[', assume it's formatted
    if (typeof embedding === 'string') {
      if (embedding.startsWith('[') && embedding.endsWith(']')) {
        return embedding;
      }
      return `[${embedding}]`;
    }

    // Format array as proper pgvector string
    if (Array.isArray(embedding)) {
      return `[${embedding.join(',')}]`;
    }

    return null;
  }
}

export default VectorEmbeddingRepository;
