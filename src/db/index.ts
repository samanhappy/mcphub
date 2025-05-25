import { initializeDatabase, closeDatabase, isDatabaseConnected } from './connection.js';
import * as repositories from './repositories/index.js';

/**
 * Initialize the database module
 */
export async function initializeDbModule(): Promise<boolean> {
  try {
    // Connect to the database
    await initializeDatabase();
    return true;
  } catch (error) {
    console.error('Failed to initialize database module:', error);
    return false;
  }
}

/**
 * Get the repository factory for a database entity type
 * @param entityType The type of entity to get a repository for
 */
export function getRepositoryFactory(entityType: 'vectorEmbeddings') {
  // Return the appropriate repository based on entity type
  switch (entityType) {
    case 'vectorEmbeddings':
      return () => new repositories.VectorEmbeddingRepository();
    default:
      throw new Error(`Unknown entity type: ${entityType}`);
  }
}

// Re-export everything from the database module
export { initializeDatabase, closeDatabase, isDatabaseConnected, repositories };
