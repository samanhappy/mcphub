import 'reflect-metadata'; // Ensure reflect-metadata is imported here too
import { DataSource, DataSourceOptions } from 'typeorm';
import entities from './entities/index.js';
import { registerPostgresVectorType } from './types/postgresVectorType.js';
import { VectorEmbeddingSubscriber } from './subscribers/VectorEmbeddingSubscriber.js';
import { getSmartRoutingConfig } from '../utils/smartRouting.js';
import { createVectorIndex } from '../services/vectorSearchService.js';
import { isRetryableDbError } from '../utils/dbRetry.js';

// Connection pool and retry configuration
const CONNECTION_CONFIG = {
  // Connection pool settings
  poolSize: parseInt(process.env.DB_POOL_SIZE || '10', 10),
  poolIdleTimeout: parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '30000', 10), // 30 seconds
  connectionTimeout: parseInt(process.env.DB_CONNECTION_TIMEOUT || '60000', 10), // 60 seconds

  // Retry settings for initial connection
  maxConnectionRetries: parseInt(process.env.DB_MAX_CONNECTION_RETRIES || '5', 10),
  connectionRetryDelayMs: parseInt(process.env.DB_CONNECTION_RETRY_DELAY || '3000', 10),

  // Health check settings
  healthCheckIntervalMs: parseInt(process.env.DB_HEALTH_CHECK_INTERVAL || '30000', 10), // 30 seconds
  enableHealthCheck: process.env.DB_ENABLE_HEALTH_CHECK !== 'false',
};

// Health check state
let healthCheckInterval: NodeJS.Timeout | null = null;
let isHealthy = false;
let lastHealthCheckError: Error | null = null;
let reconnectionInProgress = false;

// Helper function to create required PostgreSQL extensions
const createRequiredExtensions = async (dataSource: DataSource): Promise<void> => {
  try {
    await dataSource.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";');
    console.log('UUID extension created or already exists.');
  } catch (err: any) {
    console.warn('Failed to create uuid-ossp extension:', err.message);
    console.warn('UUID generation functionality may not be available.');
  }

  try {
    await dataSource.query('CREATE EXTENSION IF NOT EXISTS vector;');
    console.log('Vector extension created or already exists.');
  } catch (err: any) {
    console.warn('Failed to create vector extension:', err.message);
    console.warn('Vector functionality may not be available.');
  }
};

// Get database URL from smart routing config or fallback to environment variable
const getDatabaseUrl = async (): Promise<string> => {
  return (await getSmartRoutingConfig()).dbUrl;
};

// Default database configuration with connection pooling
const getDefaultConfig = async (): Promise<DataSourceOptions> => {
  return {
    type: 'postgres',
    url: await getDatabaseUrl(),
    synchronize: true,
    entities: entities,
    subscribers: [VectorEmbeddingSubscriber],
    // Connection pool configuration for better resilience
    extra: {
      // Maximum number of clients in the pool
      max: CONNECTION_CONFIG.poolSize,
      // Close idle connections after this many milliseconds
      idleTimeoutMillis: CONNECTION_CONFIG.poolIdleTimeout,
      // Connection timeout
      connectionTimeoutMillis: CONNECTION_CONFIG.connectionTimeout,
      // Keep-alive settings to detect dead connections faster
      keepAlive: true,
      keepAliveInitialDelayMillis: 10000,
    },
  };
};

// AppDataSource is the TypeORM data source (initialized with empty config, will be updated)
let appDataSource: DataSource | null = null;

// Global promise to track initialization status
let initializationPromise: Promise<DataSource> | null = null;

// Function to create a new DataSource with updated configuration
export const updateDataSourceConfig = async (): Promise<DataSource> => {
  const newConfig = await getDefaultConfig();

  // If the configuration has changed, we need to create a new DataSource
  if (appDataSource) {
    const currentUrl = (appDataSource.options as any).url;
    const newUrl = (newConfig as any).url;
    if (currentUrl !== newUrl) {
      console.log('Database URL configuration changed, updating DataSource...');
      appDataSource = new DataSource(newConfig);
      // Reset initialization promise when configuration changes
      initializationPromise = null;
    }
  } else {
    // First time initialization
    appDataSource = new DataSource(newConfig);
  }

  return appDataSource;
};

// Get the current AppDataSource instance
export const getAppDataSource = (): DataSource => {
  if (!appDataSource) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return appDataSource;
};

// Reconnect database with updated configuration
export const reconnectDatabase = async (): Promise<DataSource> => {
  try {
    // Close existing connection if it exists
    if (appDataSource && appDataSource.isInitialized) {
      console.log('Closing existing database connection...');
      await appDataSource.destroy();
    }

    // Reset initialization promise to allow fresh initialization
    initializationPromise = null;

    // Update configuration and reconnect
    appDataSource = await updateDataSourceConfig();
    return await initializeDatabase();
  } catch (error) {
    console.error('Error during database reconnection:', error);
    throw error;
  }
};

// Initialize database connection with concurrency control
export const initializeDatabase = async (): Promise<DataSource> => {
  // If initialization is already in progress, wait for it to complete
  if (initializationPromise) {
    console.log('Database initialization already in progress, waiting for completion...');
    return initializationPromise;
  }

  // If already initialized, return the existing instance
  if (appDataSource && appDataSource.isInitialized) {
    console.log('Database already initialized, returning existing instance');
    return Promise.resolve(appDataSource);
  }

  // Create a new initialization promise
  initializationPromise = performDatabaseInitialization();

  try {
    const result = await initializationPromise;
    console.log('Database initialization completed successfully');

    // Start health check after successful initialization
    isHealthy = true;
    startHealthCheck();

    return result;
  } catch (error) {
    // Reset the promise on error so initialization can be retried
    initializationPromise = null;
    console.error('Database initialization failed:', error);
    throw error;
  }
};

// Internal function to perform the actual database initialization
const performDatabaseInitialization = async (): Promise<DataSource> => {
  try {
    // Update configuration before initializing
    appDataSource = await updateDataSourceConfig();

    if (!appDataSource.isInitialized) {
      console.log('Initializing database connection...');
      // Register the vector type with TypeORM
      await appDataSource.initialize();
      registerPostgresVectorType(appDataSource);

      // Create required PostgreSQL extensions
      await createRequiredExtensions(appDataSource);

      // Set up vector column and index with a more direct approach
      try {
        // Check if table exists first
        const tableExists = await appDataSource.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public'
            AND table_name = 'vector_embeddings'
          );
        `);

        if (tableExists[0].exists) {
          // Add pgvector support via raw SQL commands
          console.log('Configuring vector support for embeddings table...');

          // Step 1: Drop any existing index on the column
          try {
            await appDataSource.query(`DROP INDEX IF EXISTS idx_vector_embeddings_embedding;`);
          } catch (dropError: any) {
            console.warn('Note: Could not drop existing index:', dropError.message);
          }

          // Step 2: Alter column type to vector (if it's not already)
          try {
            // Check column type first
            const columnType = await appDataSource.query(`
              SELECT data_type FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'vector_embeddings'
              AND column_name = 'embedding';
            `);

            if (columnType.length > 0 && columnType[0].data_type !== 'vector') {
              await appDataSource.query(`
                ALTER TABLE vector_embeddings 
                ALTER COLUMN embedding TYPE vector USING embedding::vector;
              `);
              console.log('Vector embedding column type updated successfully.');
            }
          } catch (alterError: any) {
            console.warn('Could not alter embedding column type:', alterError.message);
            console.warn('Will try to recreate the table later.');
          }

          // Step 3: Try to create appropriate indices
          try {
            // First, let's check if there are any records to determine the dimensions
            const records = await appDataSource.query(`
              SELECT dimensions FROM vector_embeddings LIMIT 1;
            `);

            let dimensions = 1536; // Default to common OpenAI embedding size
            if (records && records.length > 0 && records[0].dimensions) {
              dimensions = records[0].dimensions;
              console.log(`Found vector dimension from existing data: ${dimensions}`);
            } else {
              console.log(`Using default vector dimension: ${dimensions} (no existing data found)`);
            }

            // Set the vector dimensions explicitly only if table has data
            if (records && records.length > 0) {
              await appDataSource.query(`
                ALTER TABLE vector_embeddings 
                ALTER COLUMN embedding TYPE vector(${dimensions});
              `);

              // Create appropriate vector index using the helper function
              const result = await createVectorIndex(appDataSource, dimensions);
              if (!result.success) {
                console.log('Continuing without optimized vector index...');
              }
            } else {
              console.log(
                'No existing vector data found, skipping index creation - will be handled by vector service.',
              );
            }
          } catch (indexError: any) {
            console.warn('Vector index creation failed:', indexError.message);
            console.warn('Vector search will work but may be slower without an optimized index.');
          }
        } else {
          console.log(
            'Vector embeddings table does not exist yet - will configure after schema sync.',
          );
        }
      } catch (error: any) {
        console.warn('Could not set up vector column/index:', error.message);
        console.warn('Will attempt again after schema synchronization.');
      }

      console.log('Database connection established successfully.');

      // Run one final setup check after schema synchronization is done
      const config = await getDefaultConfig();
      if (config.synchronize) {
        try {
          console.log('Running final vector configuration check...');

          // Try setup again with the same code from above
          const tableExists = await appDataSource.query(`
              SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public'
                AND table_name = 'vector_embeddings'
              );
            `);

          if (tableExists[0].exists) {
            console.log('Vector embeddings table found, checking configuration...');

            // Get the dimension size first
            try {
              // Try to get dimensions from an existing record
              const records = await appDataSource.query(`
                  SELECT dimensions FROM vector_embeddings LIMIT 1;
                `);

              // Only proceed if we have existing data, otherwise let vector service handle it
              if (records && records.length > 0 && records[0].dimensions) {
                const dimensions = records[0].dimensions;
                console.log(`Found vector dimension from database: ${dimensions}`);

                // Ensure column type is vector with explicit dimensions
                await appDataSource.query(`
                    ALTER TABLE vector_embeddings 
                    ALTER COLUMN embedding TYPE vector(${dimensions});
                  `);
                console.log('Vector embedding column type updated in final check.');

                // Create appropriate vector index using the helper function
                const result = await createVectorIndex(appDataSource, dimensions);
                if (!result.success) {
                  console.log('Continuing without optimized vector index...');
                }
              } else {
                console.log(
                  'No existing vector data found, vector dimensions will be configured by vector service.',
                );
              }
            } catch (setupError: any) {
              console.warn('Vector setup in final check failed:', setupError.message);
            }
          }
        } catch (error: any) {
          console.warn('Post-initialization vector setup failed:', error.message);
        }
      }
    }
    return appDataSource;
  } catch (error) {
    console.error('Error during database initialization:', error);
    throw error;
  }
};

// Get database connection status
export const isDatabaseConnected = (): boolean => {
  return appDataSource ? appDataSource.isInitialized : false;
};

// Get database health status
export const getDatabaseHealth = (): {
  connected: boolean;
  healthy: boolean;
  lastError: string | null;
  reconnecting: boolean;
} => {
  return {
    connected: isDatabaseConnected(),
    healthy: isHealthy,
    lastError: lastHealthCheckError?.message || null,
    reconnecting: reconnectionInProgress,
  };
};

// Perform a health check on the database connection
export const checkDatabaseHealth = async (): Promise<boolean> => {
  if (!appDataSource || !appDataSource.isInitialized) {
    isHealthy = false;
    lastHealthCheckError = new Error('Database not initialized');
    return false;
  }

  try {
    // Simple query to check connection
    await appDataSource.query('SELECT 1');
    isHealthy = true;
    lastHealthCheckError = null;
    return true;
  } catch (error) {
    isHealthy = false;
    lastHealthCheckError = error instanceof Error ? error : new Error(String(error));
    console.warn('[DB Health] Health check failed:', lastHealthCheckError.message);

    // If it's a retryable error, attempt reconnection
    if (isRetryableDbError(error) && !reconnectionInProgress) {
      console.log('[DB Health] Detected connection issue, attempting reconnection...');
      attemptReconnection().catch((err) => {
        console.error('[DB Health] Reconnection attempt failed:', err.message);
      });
    }

    return false;
  }
};

// Start the health check interval
export const startHealthCheck = (): void => {
  if (!CONNECTION_CONFIG.enableHealthCheck || healthCheckInterval) {
    return;
  }

  console.log(
    `[DB Health] Starting health check (interval: ${CONNECTION_CONFIG.healthCheckIntervalMs}ms)`,
  );

  healthCheckInterval = setInterval(async () => {
    await checkDatabaseHealth();
  }, CONNECTION_CONFIG.healthCheckIntervalMs);

  // Unref the interval so it doesn't prevent process exit
  healthCheckInterval.unref();
};

// Stop the health check interval
export const stopHealthCheck = (): void => {
  if (healthCheckInterval) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
    console.log('[DB Health] Health check stopped');
  }
};

// Attempt to reconnect to the database with retries
const attemptReconnection = async (): Promise<void> => {
  if (reconnectionInProgress) {
    console.log('[DB Reconnect] Reconnection already in progress, skipping...');
    return;
  }

  reconnectionInProgress = true;
  console.log('[DB Reconnect] Starting reconnection attempt...');

  try {
    // Close existing connection if it exists
    if (appDataSource && appDataSource.isInitialized) {
      try {
        console.log('[DB Reconnect] Closing existing connection...');
        await appDataSource.destroy();
      } catch (closeError: any) {
        console.warn('[DB Reconnect] Error closing connection:', closeError.message);
      }
    }

    // Reset state
    initializationPromise = null;

    // Retry connection with exponential backoff
    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= CONNECTION_CONFIG.maxConnectionRetries; attempt++) {
      try {
        console.log(
          `[DB Reconnect] Connection attempt ${attempt}/${CONNECTION_CONFIG.maxConnectionRetries}...`,
        );

        appDataSource = await updateDataSourceConfig();
        await performDatabaseInitialization();

        console.log('[DB Reconnect] Successfully reconnected to database');
        isHealthy = true;
        lastHealthCheckError = null;
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(`[DB Reconnect] Attempt ${attempt} failed: ${lastError.message}`);

        if (attempt < CONNECTION_CONFIG.maxConnectionRetries) {
          const delay = CONNECTION_CONFIG.connectionRetryDelayMs * Math.pow(2, attempt - 1);
          console.log(`[DB Reconnect] Waiting ${delay}ms before next attempt...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // All retries exhausted
    console.error(
      `[DB Reconnect] Failed to reconnect after ${CONNECTION_CONFIG.maxConnectionRetries} attempts`,
    );
    lastHealthCheckError = lastError;
  } finally {
    reconnectionInProgress = false;
  }
};

// Close database connection
export const closeDatabase = async (): Promise<void> => {
  // Stop health checks first
  stopHealthCheck();

  if (appDataSource && appDataSource.isInitialized) {
    await appDataSource.destroy();
    console.log('Database connection closed.');
  }
  isHealthy = false;
};

// Export AppDataSource for backward compatibility
export const AppDataSource = appDataSource;

export default getAppDataSource;
