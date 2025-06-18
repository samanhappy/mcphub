import { getRepositoryFactory } from '../db/index.js';
import { VectorEmbeddingRepository } from '../db/repositories/index.js';
import { ToolInfo } from '../types/index.js';
import { getAppDataSource, initializeDatabase } from '../db/connection.js';
import { getSmartRoutingConfig } from '../utils/smartRouting.js';
import OpenAI from 'openai';

// Get OpenAI configuration from smartRouting settings or fallback to environment variables
const getOpenAIConfig = () => {
  const smartRoutingConfig = getSmartRoutingConfig();
  return {
    apiKey: smartRoutingConfig.openaiApiKey,
    baseURL: smartRoutingConfig.openaiApiBaseUrl,
    embeddingModel: smartRoutingConfig.openaiApiEmbeddingModel,
  };
};

// Constants for embedding models
const EMBEDDING_DIMENSIONS = 1536; // OpenAI's text-embedding-3-small outputs 1536 dimensions
const BGE_DIMENSIONS = 1024; // BAAI/bge-m3 outputs 1024 dimensions
const FALLBACK_DIMENSIONS = 100; // Fallback implementation uses 100 dimensions

// Get dimensions for a model
const getDimensionsForModel = (model: string): number => {
  if (model.includes('bge-m3')) {
    return BGE_DIMENSIONS;
  } else if (model.includes('text-embedding-3')) {
    return EMBEDDING_DIMENSIONS;
  } else if (model === 'fallback' || model === 'simple-hash') {
    return FALLBACK_DIMENSIONS;
  }
  // Default to OpenAI dimensions
  return EMBEDDING_DIMENSIONS;
};

// Initialize the OpenAI client with smartRouting configuration
const getOpenAIClient = () => {
  const config = getOpenAIConfig();
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
  try {
    const config = getOpenAIConfig();
    const openai = getOpenAIClient();

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
  } catch (error) {
    console.error('Error generating embedding:', error);
    console.warn('Falling back to simple embedding method');
    return generateFallbackEmbedding(text);
  }
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
  tools: ToolInfo[],
): Promise<void> => {
  try {
    if (tools.length === 0) {
      console.warn(`No tools to save for server: ${serverName}`);
      return;
    }

    const smartRoutingConfig = getSmartRoutingConfig();
    if (!smartRoutingConfig.enabled) {
      return;
    }

    const config = getOpenAIConfig();
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

      try {
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
      } catch (toolError) {
        console.error(`Error processing tool ${tool.name} for server ${serverName}:`, toolError);
        // Continue with the next tool rather than failing the whole batch
      }
    }

    console.log(`Saved ${tools.length} tool embeddings for server: ${serverName}`);
  } catch (error) {
    console.error(`Error saving tool embeddings for server ${serverName}:`, error);
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
    const config = getOpenAIConfig();
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

    const servers = getServersInfo();
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

      // Drop any existing indices first
      await getAppDataSource().query(`DROP INDEX IF EXISTS idx_vector_embeddings_embedding;`);

      // Alter the column type with the new dimensions
      await getAppDataSource().query(`
        ALTER TABLE vector_embeddings 
        ALTER COLUMN embedding TYPE vector(${dimensionsNeeded});
      `);

      // Create a new index with better error handling
      try {
        await getAppDataSource().query(`
          CREATE INDEX idx_vector_embeddings_embedding 
          ON vector_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
        `);
      } catch (indexError: any) {
        // If the index already exists (code 42P07) or there's a duplicate key constraint (code 23505),
        // it's not a critical error as the index is already there
        if (indexError.code === '42P07' || indexError.code === '23505') {
          console.log('Index already exists, continuing...');
        } else {
          console.warn('Warning: Failed to create index, but continuing:', indexError.message);
        }
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
