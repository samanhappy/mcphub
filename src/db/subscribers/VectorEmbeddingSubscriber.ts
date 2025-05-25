import { EntitySubscriberInterface, EventSubscriber, InsertEvent, UpdateEvent } from 'typeorm';
import { VectorEmbedding } from '../entities/VectorEmbedding.js';

/**
 * A subscriber to format vector embeddings before saving to database
 */
@EventSubscriber()
export class VectorEmbeddingSubscriber implements EntitySubscriberInterface<VectorEmbedding> {
  /**
   * Indicates that this subscriber only listens to VectorEmbedding events
   */
  listenTo() {
    return VectorEmbedding;
  }

  /**
   * Called before entity insertion
   */
  beforeInsert(event: InsertEvent<VectorEmbedding>) {
    this.formatEmbedding(event.entity);
  }

  /**
   * Called before entity update
   */
  beforeUpdate(event: UpdateEvent<VectorEmbedding>) {
    if (event.entity && event.entity.embedding) {
      this.formatEmbedding(event.entity as VectorEmbedding);
    }
  }

  /**
   * Format embedding as a proper vector string
   */
  private formatEmbedding(entity: VectorEmbedding | undefined) {
    if (!entity || !entity.embedding || !Array.isArray(entity.embedding)) {
      return;
    }

    // If the embedding is already a string, don't process it
    if (typeof entity.embedding === 'string') {
      return;
    }

    // Format array as proper pgvector string
    // Ensure the string starts with '[' and ends with ']' as required by pgvector
    const vectorString = `[${entity.embedding.join(',')}]`;

    // Store the string directly (TypeORM will handle conversion)
    // We need to use 'as any' because the type is declared as number[] but we're setting a string
    (entity as any).embedding = vectorString;
  }
}
