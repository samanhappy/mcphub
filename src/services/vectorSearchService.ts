import { getRepositoryFactory } from '../db/index.js';
import { VectorEmbeddingRepository } from '../db/repositories/index.js';
import { Tool } from '../types/index.js';
import { getAppDataSource, isDatabaseConnected, initializeDatabase } from '../db/connection.js';
import { getSmartRoutingConfig } from '../utils/smartRouting.js';
import OpenAI from 'openai';

// Get OpenAI configuration from smartRouting settings or fallback to environment variables
const getOpenAIConfig = async () => {
  const smartRoutingConfig = await getSmartRoutingConfig();
  return {
    apiKey: smartRoutingConfig.openaiApiKey,
    baseURL: smartRoutingConfig.openaiApiBaseUrl,
    embeddingModel: smartRoutingConfig.openaiApiEmbeddingModel,
  };
};

// Constants for embedding models
const EMBEDDING_DIMENSIONS_SMALL = 1536; // OpenAI's text-embedding-3-small outputs 1536 dimensions
const EMBEDDING_DIMENSIONS_LARGE = 3072; // OpenAI's text-embedding-3-large outputs 3072 dimensions
const BGE_DIMENSIONS = 1024; // BAAI/bge-m3 outputs 1024 dimensions
const FALLBACK_DIMENSIONS = 100; // Fallback implementation uses 100 dimensions

// pgvector index limits (as of pgvector 0.7.0+)
// - vector type: up to 2,000 dimensions for both HNSW and IVFFlat
// - halfvec type: up to 4,000 dimensions (can be used for higher dimensional vectors via casting)
// - bit type: up to 64,000 dimensions
// HNSW is recommended as the default choice for better performance and robustness
export const VECTOR_MAX_DIMENSIONS = 2000;
export const HALFVEC_MAX_DIMENSIONS = 4000;

/**
 * Create an appropriate vector index based on the embedding dimensions
 *
 * According to Supabase/pgvector best practices:
 * - HNSW should be the default choice due to better performance and robustness
 * - HNSW indexes can be created immediately (unlike IVFFlat which needs data first)
 * - For vectors > 2000 dimensions, use halfvec casting (up to 4000 dimensions)
 *
 * Index strategy:
 * 1. For dimensions <= 2000: Use HNSW with vector type (best choice)
 * 2. For dimensions 2001-4000: Use HNSW with halfvec casting
 * 3. For dimensions > 4000: No index supported, warn user
 *
 * @param dataSource The TypeORM DataSource
 * @param dimensions The embedding dimensions
 * @param tableName The table name (default: 'vector_embeddings')
 * @param columnName The column name (default: 'embedding')
 * @returns Promise<{success: boolean, indexType: string | null, message: string}>
 */
export async function createVectorIndex(
  dataSource: { query: (sql: string) => Promise<unknown> },
  dimensions: number,
  tableName: string = 'vector_embeddings',
  columnName: string = 'embedding',
): Promise<{ success: boolean; indexType: string | null; message: string }> {
  const indexName = `idx_${tableName}_${columnName}`;

  // Drop any existing index first
  try {
    await dataSource.query(`DROP INDEX IF EXISTS ${indexName};`);
  } catch {
    // Ignore errors when dropping non-existent index
  }

  // Strategy 1: For dimensions <= 2000, use standard HNSW (recommended default)
  if (dimensions <= VECTOR_MAX_DIMENSIONS) {
    try {
      // HNSW is the recommended default - better performance and doesn't require pre-existing data
      await dataSource.query(`
        CREATE INDEX ${indexName}
        ON ${tableName} USING hnsw (${columnName} vector_cosine_ops);
      `);
      console.log(`Created HNSW index for ${dimensions}-dimensional vectors.`);
      return {
        success: true,
        indexType: 'hnsw',
        message: `HNSW index created successfully for ${dimensions} dimensions`,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`HNSW index creation failed: ${errorMessage}`);

      // Fallback to IVFFlat if HNSW fails (e.g., older pgvector version)
      try {
        await dataSource.query(`
          CREATE INDEX ${indexName}
          ON ${tableName} USING ivfflat (${columnName} vector_cosine_ops) WITH (lists = 100);
        `);
        console.log(`Created IVFFlat index for ${dimensions}-dimensional vectors (fallback).`);
        return {
          success: true,
          indexType: 'ivfflat',
          message: `IVFFlat index created successfully for ${dimensions} dimensions`,
        };
      } catch (ivfError: unknown) {
        const ivfErrorMessage = ivfError instanceof Error ? ivfError.message : 'Unknown error';
        console.warn(`IVFFlat index creation also failed: ${ivfErrorMessage}`);
        return {
          success: false,
          indexType: null,
          message: `No index created: ${errorMessage}`,
        };
      }
    }
  }

  // Strategy 2: For dimensions 2001-4000, use halfvec casting with HNSW
  if (dimensions <= HALFVEC_MAX_DIMENSIONS) {
    try {
      // Use halfvec type casting for high-dimensional vectors (pgvector 0.7.0+)
      await dataSource.query(`
        CREATE INDEX ${indexName}
        ON ${tableName} USING hnsw ((${columnName}::halfvec(${dimensions})) halfvec_cosine_ops);
      `);
      console.log(`Created HNSW index with halfvec casting for ${dimensions}-dimensional vectors.`);
      return {
        success: true,
        indexType: 'hnsw-halfvec',
        message: `HNSW index (halfvec) created successfully for ${dimensions} dimensions`,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isHalfvecNotSupported =
        errorMessage.includes('halfvec') ||
        errorMessage.includes('type does not exist') ||
        errorMessage.includes('operator class');

      if (isHalfvecNotSupported) {
        console.warn('');
        console.warn('═══════════════════════════════════════════════════════════════════════════');
        console.warn('  ⚠️  HIGH-DIMENSIONAL EMBEDDING INDEX WARNING');
        console.warn('═══════════════════════════════════════════════════════════════════════════');
        console.warn(
          `  Your embeddings have ${dimensions} dimensions, which requires halfvec support.`,
        );
        console.warn('');
        console.warn('  pgvector dimension limits:');
        console.warn(`  - vector type: max ${VECTOR_MAX_DIMENSIONS} dimensions`);
        console.warn(
          `  - halfvec type: max ${HALFVEC_MAX_DIMENSIONS} dimensions (pgvector 0.7.0+)`,
        );
        console.warn('');
        console.warn('  RECOMMENDATIONS:');
        console.warn('  1. Upgrade pgvector to >= 0.7.0 for halfvec support');
        console.warn('  2. Or use a smaller embedding model:');
        console.warn(
          '     - text-embedding-3-small (1536 dimensions) instead of text-embedding-3-large',
        );
        console.warn('     - bge-m3 (1024 dimensions)');
        console.warn('');
        console.warn('  Vector search will work but may be slower without an optimized index.');
        console.warn('═══════════════════════════════════════════════════════════════════════════');
        console.warn('');
      } else {
        console.warn(`HNSW halfvec index creation failed: ${errorMessage}`);
      }

      return {
        success: false,
        indexType: null,
        message: `No vector index created for ${dimensions} dimensions. ${errorMessage}`,
      };
    }
  }

  // Strategy 3: For dimensions > 4000, no index is supported
  console.warn('');
  console.warn('═══════════════════════════════════════════════════════════════════════════');
  console.warn('  ⚠️  EMBEDDING DIMENSIONS EXCEED INDEX LIMITS');
  console.warn('═══════════════════════════════════════════════════════════════════════════');
  console.warn(`  Your embeddings have ${dimensions} dimensions, which exceeds all limits:`);
  console.warn(`  - vector type: max ${VECTOR_MAX_DIMENSIONS} dimensions`);
  console.warn(`  - halfvec type: max ${HALFVEC_MAX_DIMENSIONS} dimensions`);
  console.warn('');
  console.warn('  RECOMMENDATIONS:');
  console.warn('  1. Use a smaller embedding model:');
  console.warn('     - text-embedding-3-small (1536 dimensions)');
  console.warn('     - text-embedding-3-large (3072 dimensions) with halfvec');
  console.warn('     - bge-m3 (1024 dimensions)');
  console.warn('  2. Or use dimensionality reduction (PCA) to reduce vector size');
  console.warn('');
  console.warn('  Vector search will work but will be slow without an index.');
  console.warn('═══════════════════════════════════════════════════════════════════════════');
  console.warn('');

  return {
    success: false,
    indexType: null,
    message: `Dimensions (${dimensions}) exceed maximum indexable limit (${HALFVEC_MAX_DIMENSIONS})`,
  };
}

// Get dimensions for a model
const getDimensionsForModel = (model: string): number => {
  if (model.includes('bge-m3')) {
    return BGE_DIMENSIONS;
  } else if (model.includes('text-embedding-3-large')) {
    return EMBEDDING_DIMENSIONS_LARGE;
  } else if (model.includes('text-embedding-3')) {
    return EMBEDDING_DIMENSIONS_SMALL;
  } else if (model === 'fallback' || model === 'simple-hash') {
    return FALLBACK_DIMENSIONS;
  }
  // Default to OpenAI small model dimensions
  return EMBEDDING_DIMENSIONS_SMALL;
};

// Initialize the OpenAI client with smartRouting configuration
const getOpenAIClient = async () => {
  const config = await getOpenAIConfig();
  return new OpenAI({
    apiKey: config.apiKey, // Get API key from smartRouting settings or environment variables
    baseURL: config.baseURL, // Get base URL from smartRouting settings or fallback to default
  });
};

/**
 * Generate text embedding using OpenAI's embedding model
 *
 * NOTE: embeddings are 1536 dimensions by default.
 * If you previously used the fallback implementation (100 dimensions),
 * you may need to rebuild your vector database indices after switching.
 *
 * @param text Text to generate embeddings for
 * @returns Promise with vector embedding as number array
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const config = await getOpenAIConfig();
  const openai = await getOpenAIClient();

  // Check if API key is configured
  if (!openai.apiKey) {
    console.warn('OpenAI API key is not configured. Using fallback embedding method.');
    return generateFallbackEmbedding(text);
  }

  // Truncate text if it's too long (OpenAI has token limits)
  const truncatedText = text.length > 8000 ? text.substring(0, 8000) : text;

  // Call OpenAI's embeddings API
  const response = await openai.embeddings.create({
    model: config.embeddingModel, // Modern model with better performance
    input: truncatedText,
  });

  // Return the embedding
  return response.data[0].embedding;
}

/**
 * Fallback embedding function using a simple approach when OpenAI API is unavailable
 * @param text Text to generate embeddings for
 * @returns Vector embedding as number array
 */
function generateFallbackEmbedding(text: string): number[] {
  const words = text.toLowerCase().split(/\s+/);
  const vocabulary = [
    'search',
    'find',
    'get',
    'fetch',
    'retrieve',
    'query',
    'map',
    'location',
    'weather',
    'file',
    'directory',
    'email',
    'message',
    'send',
    'create',
    'update',
    'delete',
    'browser',
    'web',
    'page',
    'click',
    'navigate',
    'screenshot',
    'automation',
    'database',
    'table',
    'record',
    'insert',
    'select',
    'schema',
    'data',
    'image',
    'photo',
    'video',
    'media',
    'upload',
    'download',
    'convert',
    'text',
    'document',
    'pdf',
    'excel',
    'word',
    'format',
    'parse',
    'api',
    'rest',
    'http',
    'request',
    'response',
    'json',
    'xml',
    'time',
    'date',
    'calendar',
    'schedule',
    'reminder',
    'clock',
    'math',
    'calculate',
    'number',
    'sum',
    'average',
    'statistics',
    'user',
    'account',
    'login',
    'auth',
    'permission',
    'role',
  ];

  // Create vector with fallback dimensions
  const vector = new Array(FALLBACK_DIMENSIONS).fill(0);

  words.forEach((word) => {
    const index = vocabulary.indexOf(word);
    if (index >= 0 && index < vector.length) {
      vector[index] += 1;
    }
    // Add some randomness based on word hash
    const hash = word.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    vector[hash % vector.length] += 0.1;
  });

  // Normalize the vector
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    return vector.map((val) => val / magnitude);
  }

  return vector;
}

/**
 * Save tool information as vector embeddings
 * @param serverName Server name
 * @param tools Array of tools to save
 */
export const saveToolsAsVectorEmbeddings = async (
  serverName: string,
  tools: Tool[],
): Promise<void> => {
  try {
    if (tools.length === 0) {
      console.warn(`No tools to save for server: ${serverName}`);
      return;
    }

    const smartRoutingConfig = await getSmartRoutingConfig();
    if (!smartRoutingConfig.enabled) {
      return;
    }

    // Ensure database is initialized before using repository
    if (!isDatabaseConnected()) {
      console.info('Database not initialized, initializing...');
      await initializeDatabase();
    }

    const config = await getOpenAIConfig();
    const vectorRepository = getRepositoryFactory(
      'vectorEmbeddings',
    )() as VectorEmbeddingRepository;

    for (const tool of tools) {
      // Create searchable text from tool information
      const searchableText = [
        tool.name,
        tool.description,
        // Include input schema properties if available
        ...(tool.inputSchema && typeof tool.inputSchema === 'object'
          ? Object.keys(tool.inputSchema).filter((key) => key !== 'type' && key !== 'properties')
          : []),
        // Include schema property names if available
        ...(tool.inputSchema &&
        tool.inputSchema.properties &&
        typeof tool.inputSchema.properties === 'object'
          ? Object.keys(tool.inputSchema.properties)
          : []),
      ]
        .filter(Boolean)
        .join(' ');

      // Generate embedding
      const embedding = await generateEmbedding(searchableText);

      // Check database compatibility before saving
      await checkDatabaseVectorDimensions(embedding.length);

      // Save embedding
      await vectorRepository.saveEmbedding(
        'tool',
        `${serverName}:${tool.name}`,
        searchableText,
        embedding,
        {
          serverName,
          toolName: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        },
        config.embeddingModel, // Store the model used for this embedding
      );
    }

    console.log(`Saved ${tools.length} tool embeddings for server: ${serverName}`);
  } catch (error) {
    console.error(`Error saving tool embeddings for server ${serverName}:${error}`);
  }
};

/**
 * Search for tools using vector similarity
 * @param query Search query text
 * @param limit Maximum number of results to return
 * @param threshold Similarity threshold (0-1)
 * @param serverNames Optional array of server names to filter by
 */
export const searchToolsByVector = async (
  query: string,
  limit: number = 10,
  threshold: number = 0.7,
  serverNames?: string[],
): Promise<
  Array<{
    serverName: string;
    toolName: string;
    description: string;
    inputSchema: any;
    similarity: number;
    searchableText: string;
  }>
> => {
  try {
    const vectorRepository = getRepositoryFactory(
      'vectorEmbeddings',
    )() as VectorEmbeddingRepository;

    // Search by text using vector similarity
    const results = await vectorRepository.searchByText(
      query,
      generateEmbedding,
      limit,
      threshold,
      ['tool'],
    );

    // Filter by server names if provided
    let filteredResults = results;
    if (serverNames && serverNames.length > 0) {
      filteredResults = results.filter((result) => {
        if (typeof result.embedding.metadata === 'string') {
          try {
            const parsedMetadata = JSON.parse(result.embedding.metadata);
            return serverNames.includes(parsedMetadata.serverName);
          } catch (error) {
            return false;
          }
        }
        return false;
      });
    }

    // Transform results to a more useful format
    return filteredResults.map((result) => {
      // Check if we have metadata as a string that needs to be parsed
      if (result.embedding?.metadata && typeof result.embedding.metadata === 'string') {
        try {
          // Parse the metadata string as JSON
          const parsedMetadata = JSON.parse(result.embedding.metadata);

          if (parsedMetadata.serverName && parsedMetadata.toolName) {
            // We have properly structured metadata
            return {
              serverName: parsedMetadata.serverName,
              toolName: parsedMetadata.toolName,
              description: parsedMetadata.description || '',
              inputSchema: parsedMetadata.inputSchema || {},
              similarity: result.similarity,
              searchableText: result.embedding.text_content,
            };
          }
        } catch (error) {
          console.error('Error parsing metadata string:', error);
          // Fall through to the extraction logic below
        }
      }

      // Extract tool info from text_content if metadata is not available or parsing failed
      const textContent = result.embedding?.text_content || '';

      // Extract toolName (first word of text_content)
      const toolNameMatch = textContent.match(/^(\S+)/);
      const toolName = toolNameMatch ? toolNameMatch[1] : '';

      // Extract serverName from toolName if it follows the pattern "serverName_toolPart"
      const serverNameMatch = toolName.match(/^([^_]+)_/);
      const serverName = serverNameMatch ? serverNameMatch[1] : 'unknown';

      // Extract description (everything after the first word)
      const description = textContent.replace(/^\S+\s*/, '').trim();

      return {
        serverName,
        toolName,
        description,
        inputSchema: {},
        similarity: result.similarity,
        searchableText: textContent,
      };
    });
  } catch (error) {
    console.error('Error searching tools by vector:', error);
    return [];
  }
};

/**
 * Get all available tools in vector database
 * @param serverNames Optional array of server names to filter by
 */
export const getAllVectorizedTools = async (
  serverNames?: string[],
): Promise<
  Array<{
    serverName: string;
    toolName: string;
    description: string;
    inputSchema: any;
  }>
> => {
  try {
    const config = await getOpenAIConfig();
    const vectorRepository = getRepositoryFactory(
      'vectorEmbeddings',
    )() as VectorEmbeddingRepository;

    // Try to determine what dimension our database is using
    let dimensionsToUse = getDimensionsForModel(config.embeddingModel); // Default based on the model selected

    try {
      const result = await getAppDataSource().query(`
        SELECT atttypmod as dimensions
        FROM pg_attribute 
        WHERE attrelid = 'vector_embeddings'::regclass 
        AND attname = 'embedding'
      `);

      if (result && result.length > 0 && result[0].dimensions) {
        const rawValue = result[0].dimensions;

        if (rawValue === -1) {
          // No type modifier specified
          dimensionsToUse = getDimensionsForModel(config.embeddingModel);
        } else {
          // For this version of pgvector, atttypmod stores the dimension value directly
          dimensionsToUse = rawValue;
        }
      }
    } catch (error: any) {
      console.warn('Could not determine vector dimensions from database:', error?.message);
    }

    // Get all tool embeddings
    const results = await vectorRepository.searchSimilar(
      new Array(dimensionsToUse).fill(0), // Zero vector with dimensions matching the database
      1000, // Large limit
      -1, // No threshold (get all)
      ['tool'],
    );

    // Filter by server names if provided
    let filteredResults = results;
    if (serverNames && serverNames.length > 0) {
      filteredResults = results.filter((result) => {
        if (typeof result.embedding.metadata === 'string') {
          try {
            const parsedMetadata = JSON.parse(result.embedding.metadata);
            return serverNames.includes(parsedMetadata.serverName);
          } catch (error) {
            return false;
          }
        }
        return false;
      });
    }

    // Transform results
    return filteredResults.map((result) => {
      if (typeof result.embedding.metadata === 'string') {
        try {
          const parsedMetadata = JSON.parse(result.embedding.metadata);
          return {
            serverName: parsedMetadata.serverName,
            toolName: parsedMetadata.toolName,
            description: parsedMetadata.description,
            inputSchema: parsedMetadata.inputSchema,
          };
        } catch (error) {
          console.error('Error parsing metadata string:', error);
          return {
            serverName: 'unknown',
            toolName: 'unknown',
            description: '',
            inputSchema: {},
          };
        }
      }
      return {
        serverName: 'unknown',
        toolName: 'unknown',
        description: '',
        inputSchema: {},
      };
    });
  } catch (error) {
    console.error('Error getting all vectorized tools:', error);
    return [];
  }
};

/**
 * Remove tool embeddings for a server
 * @param serverName Server name
 */
export const removeServerToolEmbeddings = async (serverName: string): Promise<void> => {
  try {
    const _vectorRepository = getRepositoryFactory(
      'vectorEmbeddings',
    )() as VectorEmbeddingRepository;

    // Note: This would require adding a delete method to VectorEmbeddingRepository
    // For now, we'll log that this functionality needs to be implemented
    console.log(`TODO: Remove tool embeddings for server: ${serverName}`);
  } catch (error) {
    console.error(`Error removing tool embeddings for server ${serverName}:`, error);
  }
};

/**
 * Sync all server tools embeddings when smart routing is first enabled
 * This function will scan all currently connected servers and save their tools as vector embeddings
 */
export const syncAllServerToolsEmbeddings = async (): Promise<void> => {
  try {
    console.log('Starting synchronization of all server tools embeddings...');

    // Import getServersInfo to get all server information
    const { getServersInfo } = await import('./mcpService.js');

    const servers = await getServersInfo();
    let totalToolsSynced = 0;
    let serversSynced = 0;

    for (const server of servers) {
      if (server.status === 'connected' && server.tools && server.tools.length > 0) {
        try {
          console.log(`Syncing tools for server: ${server.name} (${server.tools.length} tools)`);
          await saveToolsAsVectorEmbeddings(server.name, server.tools);
          totalToolsSynced += server.tools.length;
          serversSynced++;
        } catch (error) {
          console.error(`Failed to sync tools for server ${server.name}:`, error);
        }
      } else if (server.status === 'connected' && (!server.tools || server.tools.length === 0)) {
        console.log(`Server ${server.name} is connected but has no tools to sync`);
      } else {
        console.log(`Skipping server ${server.name} (status: ${server.status})`);
      }
    }

    console.log(
      `Smart routing tools sync completed: synced ${totalToolsSynced} tools from ${serversSynced} servers`,
    );
  } catch (error) {
    console.error('Error during smart routing tools synchronization:', error);
    throw error;
  }
};

/**
 * Check database vector dimensions and ensure compatibility
 * @param dimensionsNeeded The number of dimensions required
 * @returns Promise that resolves when check is complete
 */
async function checkDatabaseVectorDimensions(dimensionsNeeded: number): Promise<void> {
  try {
    // First check if database is initialized
    if (!getAppDataSource().isInitialized) {
      console.info('Database not initialized, initializing...');
      await initializeDatabase();
    }

    // Check current vector dimension in the database
    // First try to get vector type info directly
    let vectorTypeInfo;
    try {
      vectorTypeInfo = await getAppDataSource().query(`
        SELECT 
          atttypmod,
          format_type(atttypid, atttypmod) as formatted_type
        FROM pg_attribute 
        WHERE attrelid = 'vector_embeddings'::regclass 
        AND attname = 'embedding'
      `);
    } catch (error) {
      console.warn('Could not get vector type info, falling back to atttypmod query');
    }

    // Fallback to original query
    const result = await getAppDataSource().query(`
      SELECT atttypmod as dimensions
      FROM pg_attribute 
      WHERE attrelid = 'vector_embeddings'::regclass 
      AND attname = 'embedding'
    `);

    let currentDimensions = 0;

    // Parse dimensions from result
    if (result && result.length > 0 && result[0].dimensions) {
      if (vectorTypeInfo && vectorTypeInfo.length > 0) {
        // Try to extract dimensions from formatted type like "vector(1024)"
        const match = vectorTypeInfo[0].formatted_type?.match(/vector\((\d+)\)/);
        if (match) {
          currentDimensions = parseInt(match[1]);
        }
      }

      // If we couldn't extract from formatted type, use the atttypmod value directly
      if (currentDimensions === 0) {
        const rawValue = result[0].dimensions;

        if (rawValue === -1) {
          // No type modifier specified
          currentDimensions = 0;
        } else {
          // For this version of pgvector, atttypmod stores the dimension value directly
          currentDimensions = rawValue;
        }
      }
    }

    // Also check the dimensions stored in actual records for validation
    try {
      const recordCheck = await getAppDataSource().query(`
        SELECT dimensions, model, COUNT(*) as count
        FROM vector_embeddings 
        GROUP BY dimensions, model
        ORDER BY count DESC
        LIMIT 5
      `);

      if (recordCheck && recordCheck.length > 0) {
        // If we couldn't determine dimensions from schema, use the most common dimension from records
        if (currentDimensions === 0 && recordCheck[0].dimensions) {
          currentDimensions = recordCheck[0].dimensions;
        }
      }
    } catch (error) {
      console.warn('Could not check dimensions from actual records:', error);
    }

    // If no dimensions are set or they don't match what we need, handle the mismatch
    if (currentDimensions === 0 || currentDimensions !== dimensionsNeeded) {
      console.log(
        `Vector dimensions mismatch: database=${currentDimensions}, needed=${dimensionsNeeded}`,
      );

      if (currentDimensions === 0) {
        console.log('Setting up vector dimensions for the first time...');
      } else {
        console.log('Dimension mismatch detected. Clearing existing incompatible vector data...');

        // Clear all existing vector embeddings with mismatched dimensions
        await clearMismatchedVectorData(dimensionsNeeded);
      }

      // Alter the column type with the new dimensions
      await getAppDataSource().query(`
        ALTER TABLE vector_embeddings 
        ALTER COLUMN embedding TYPE vector(${dimensionsNeeded});
      `);

      // Create appropriate vector index using the helper function
      const result = await createVectorIndex(getAppDataSource(), dimensionsNeeded);
      if (!result.success) {
        console.log('Continuing without optimized vector index...');
      }

      console.log(`Successfully configured vector dimensions to ${dimensionsNeeded}`);
    }
  } catch (error: any) {
    console.error('Error checking/updating vector dimensions:', error);
    throw new Error(`Vector dimension check failed: ${error?.message || 'Unknown error'}`);
  }
}

/**
 * Clear vector embeddings with mismatched dimensions
 * @param expectedDimensions The expected dimensions
 * @returns Promise that resolves when cleanup is complete
 */
async function clearMismatchedVectorData(expectedDimensions: number): Promise<void> {
  try {
    console.log(
      `Clearing vector embeddings with dimensions different from ${expectedDimensions}...`,
    );

    // Delete all embeddings that don't match the expected dimensions
    await getAppDataSource().query(
      `
      DELETE FROM vector_embeddings 
      WHERE dimensions != $1
    `,
      [expectedDimensions],
    );

    console.log('Successfully cleared mismatched vector embeddings');
  } catch (error: any) {
    console.error('Error clearing mismatched vector data:', error);
    throw error;
  }
}
