import 'reflect-metadata'; // Ensure reflect-metadata is imported here too
import { DataSource, DataSourceOptions } from 'typeorm';
import entities from './entities/index.js';
import { registerPostgresVectorType } from './types/postgresVectorType.js';
import { VectorEmbeddingSubscriber } from './subscribers/VectorEmbeddingSubscriber.js';
import { getSmartRoutingConfig } from '../utils/smartRouting.js';

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
const getDatabaseUrl = (): string => {
  return getSmartRoutingConfig().dbUrl;
};

// Default database configuration
const defaultConfig: DataSourceOptions = {
  type: 'postgres',
  url: getDatabaseUrl(),
  synchronize: true,
  entities: entities,
  subscribers: [VectorEmbeddingSubscriber],
};

// AppDataSource is the TypeORM data source
let appDataSource = new DataSource(defaultConfig);

// Global promise to track initialization status
let initializationPromise: Promise<DataSource> | null = null;

// Function to create a new DataSource with updated configuration
export const updateDataSourceConfig = (): DataSource => {
  const newConfig: DataSourceOptions = {
    ...defaultConfig,
    url: getDatabaseUrl(),
  };

  // If the configuration has changed, we need to create a new DataSource
  const currentUrl = (appDataSource.options as any).url;
  if (currentUrl !== newConfig.url) {
    console.log('Database URL configuration changed, updating DataSource...');
    appDataSource = new DataSource(newConfig);
    // Reset initialization promise when configuration changes
    initializationPromise = null;
  }

  return appDataSource;
};

// Get the current AppDataSource instance
export const getAppDataSource = (): DataSource => {
  return appDataSource;
};

// Reconnect database with updated configuration
export const reconnectDatabase = async (): Promise<DataSource> => {
  try {
    // Close existing connection if it exists
    if (appDataSource.isInitialized) {
      console.log('Closing existing database connection...');
      await appDataSource.destroy();
    }

    // Reset initialization promise to allow fresh initialization
    initializationPromise = null;

    // Update configuration and reconnect
    appDataSource = updateDataSourceConfig();
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
  if (appDataSource.isInitialized) {
    console.log('Database already initialized, returning existing instance');
    return Promise.resolve(appDataSource);
  }

  // Create a new initialization promise
  initializationPromise = performDatabaseInitialization();

  try {
    const result = await initializationPromise;
    console.log('Database initialization completed successfully');
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
    appDataSource = updateDataSourceConfig();

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

              // Now try to create the index
              await appDataSource.query(`
                CREATE INDEX IF NOT EXISTS idx_vector_embeddings_embedding 
                ON vector_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
              `);
              console.log('Created IVFFlat index for vector similarity search.');
            } else {
              console.log(
                'No existing vector data found, skipping index creation - will be handled by vector service.',
              );
            }
          } catch (indexError: any) {
            console.warn('IVFFlat index creation failed:', indexError.message);
            console.warn('Trying alternative index type...');

            try {
              // Try HNSW index instead
              await appDataSource.query(`
                CREATE INDEX IF NOT EXISTS idx_vector_embeddings_embedding 
                ON vector_embeddings USING hnsw (embedding vector_cosine_ops);
              `);
              console.log('Created HNSW index for vector similarity search.');
            } catch (hnswError: any) {
              // Final fallback to simpler index type
              console.warn('HNSW index creation failed too. Using simple L2 distance index.');

              try {
                // Create a basic GIN index as last resort
                await appDataSource.query(`
                  CREATE INDEX IF NOT EXISTS idx_vector_embeddings_embedding 
                  ON vector_embeddings USING gin (embedding);
                `);
                console.log('Created GIN index for basic vector lookups.');
              } catch (ginError: any) {
                console.warn('All index creation attempts failed:', ginError.message);
                console.warn('Vector search will be slower without an optimized index.');
              }
            }
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
      if (defaultConfig.synchronize) {
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

                // One more attempt at creating the index with dimensions
                try {
                  // Drop existing index if any
                  await appDataSource.query(`
                      DROP INDEX IF EXISTS idx_vector_embeddings_embedding;
                    `);

                  // Create new index with proper dimensions
                  await appDataSource.query(`
                      CREATE INDEX idx_vector_embeddings_embedding 
                      ON vector_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
                    `);
                  console.log('Created IVFFlat index in final check.');
                } catch (indexError: any) {
                  console.warn('Final index creation attempt did not succeed:', indexError.message);
                  console.warn('Using basic lookup without vector index.');
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
  return appDataSource.isInitialized;
};

// Close database connection
export const closeDatabase = async (): Promise<void> => {
  if (appDataSource.isInitialized) {
    await appDataSource.destroy();
    console.log('Database connection closed.');
  }
};

// Export AppDataSource for backward compatibility
export const AppDataSource = appDataSource;

export default getAppDataSource;
