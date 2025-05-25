import 'reflect-metadata'; // Ensure reflect-metadata is imported here too
import { DataSource, DataSourceOptions } from 'typeorm';
import dotenv from 'dotenv';
import dotenvExpand from 'dotenv-expand';
import path from 'path';
import { fileURLToPath } from 'url';
import entities from './entities/index.js';
import { registerPostgresVectorType } from './types/postgresVectorType.js';
import { VectorEmbeddingSubscriber } from './subscribers/VectorEmbeddingSubscriber.js';
import { loadSettings } from '../config/index.js';

// Get database URL from smart routing config or fallback to environment variable
const getDatabaseUrl = (): string => {
  try {
    const settings = loadSettings();
    const smartRouting = settings.systemConfig?.smartRouting;

    // Use smart routing dbUrl if smart routing is enabled and dbUrl is configured
    if (smartRouting?.enabled && smartRouting?.dbUrl) {
      console.log('Using smart routing database URL');
      return smartRouting.dbUrl;
    }
  } catch (error) {
    console.warn(
      'Failed to load settings for smart routing database URL, falling back to environment variable:',
      error,
    );
  }

  return '';
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
let AppDataSource = new DataSource(defaultConfig);

// Function to create a new DataSource with updated configuration
export const updateDataSourceConfig = (): DataSource => {
  const newConfig: DataSourceOptions = {
    ...defaultConfig,
    url: getDatabaseUrl(),
  };

  // If the configuration has changed, we need to create a new DataSource
  const currentUrl = (AppDataSource.options as any).url;
  if (currentUrl !== newConfig.url) {
    console.log('Database URL configuration changed, updating DataSource...');
    AppDataSource = new DataSource(newConfig);
  }

  return AppDataSource;
};

// Get the current AppDataSource instance
export const getAppDataSource = (): DataSource => {
  return AppDataSource;
};

// Reconnect database with updated configuration
export const reconnectDatabase = async (): Promise<DataSource> => {
  try {
    // Close existing connection if it exists
    if (AppDataSource.isInitialized) {
      console.log('Closing existing database connection...');
      await AppDataSource.destroy();
    }

    // Update configuration and reconnect
    AppDataSource = updateDataSourceConfig();
    return await initializeDatabase();
  } catch (error) {
    console.error('Error during database reconnection:', error);
    throw error;
  }
};

// Initialize database connection
export const initializeDatabase = async (): Promise<DataSource> => {
  try {
    // Update configuration before initializing
    AppDataSource = updateDataSourceConfig();

    if (!AppDataSource.isInitialized) {
      console.log('Initializing database connection...');
      await AppDataSource.initialize();

      // Register the vector type with TypeORM
      registerPostgresVectorType(AppDataSource);

      // Create pgvector extension if it doesn't exist
      await AppDataSource.query('CREATE EXTENSION IF NOT EXISTS vector;').catch((err) => {
        console.warn('Failed to create vector extension:', err.message);
        console.warn('Vector functionality may not be available.');
      });

      // Set up vector column and index with a more direct approach
      try {
        // First, create the extension
        await AppDataSource.query(`CREATE EXTENSION IF NOT EXISTS vector;`);

        // Check if table exists first
        const tableExists = await AppDataSource.query(`
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
            await AppDataSource.query(`DROP INDEX IF EXISTS idx_vector_embeddings_embedding;`);
          } catch (dropError: any) {
            console.warn('Note: Could not drop existing index:', dropError.message);
          }

          // Step 2: Alter column type to vector (if it's not already)
          try {
            // Check column type first
            const columnType = await AppDataSource.query(`
              SELECT data_type FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'vector_embeddings'
              AND column_name = 'embedding';
            `);

            if (columnType.length > 0 && columnType[0].data_type !== 'vector') {
              await AppDataSource.query(`
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
            const records = await AppDataSource.query(`
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
              await AppDataSource.query(`
                ALTER TABLE vector_embeddings 
                ALTER COLUMN embedding TYPE vector(${dimensions});
              `);

              // Now try to create the index
              await AppDataSource.query(`
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
              await AppDataSource.query(`
                CREATE INDEX IF NOT EXISTS idx_vector_embeddings_embedding 
                ON vector_embeddings USING hnsw (embedding vector_cosine_ops);
              `);
              console.log('Created HNSW index for vector similarity search.');
            } catch (hnswError: any) {
              // Final fallback to simpler index type
              console.warn('HNSW index creation failed too. Using simple L2 distance index.');

              try {
                // Create a basic GIN index as last resort
                await AppDataSource.query(`
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
        setTimeout(async () => {
          try {
            console.log('Running final vector configuration check...');

            // Try setup again with the same code from above
            const tableExists = await AppDataSource.query(`
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
                const records = await AppDataSource.query(`
                  SELECT dimensions FROM vector_embeddings LIMIT 1;
                `);

                // Only proceed if we have existing data, otherwise let vector service handle it
                if (records && records.length > 0 && records[0].dimensions) {
                  const dimensions = records[0].dimensions;
                  console.log(`Found vector dimension from database: ${dimensions}`);

                  // Ensure column type is vector with explicit dimensions
                  await AppDataSource.query(`
                    ALTER TABLE vector_embeddings 
                    ALTER COLUMN embedding TYPE vector(${dimensions});
                  `);
                  console.log('Vector embedding column type updated in final check.');

                  // One more attempt at creating the index with dimensions
                  try {
                    // Drop existing index if any
                    await AppDataSource.query(`
                      DROP INDEX IF EXISTS idx_vector_embeddings_embedding;
                    `);

                    // Create new index with proper dimensions
                    await AppDataSource.query(`
                      CREATE INDEX idx_vector_embeddings_embedding 
                      ON vector_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
                    `);
                    console.log('Created IVFFlat index in final check.');
                  } catch (indexError: any) {
                    console.warn(
                      'Final index creation attempt did not succeed:',
                      indexError.message,
                    );
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
        }, 3000); // Give synchronize some time to complete
      }
    }
    return AppDataSource;
  } catch (error) {
    console.error('Error during database initialization:', error);
    throw error;
  }
};

// Get database connection status
export const isDatabaseConnected = (): boolean => {
  return AppDataSource.isInitialized;
};

// Close database connection
export const closeDatabase = async (): Promise<void> => {
  if (AppDataSource.isInitialized) {
    await AppDataSource.destroy();
    console.log('Database connection closed.');
  }
};

// Export AppDataSource for backward compatibility
export { AppDataSource };

export default getAppDataSource;
