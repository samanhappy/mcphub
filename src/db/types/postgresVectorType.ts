import { DataSource } from 'typeorm';

/**
 * Register the PostgreSQL vector type with TypeORM
 * @param dataSource TypeORM data source
 */
export function registerPostgresVectorType(dataSource: DataSource): void {
  // Skip if not postgres
  if (dataSource.driver.options.type !== 'postgres') {
    return;
  }

  // Get the postgres driver
  const pgDriver = dataSource.driver;

  // Add 'vector' to the list of supported column types
  if (pgDriver.supportedDataTypes) {
    pgDriver.supportedDataTypes.push('vector' as any);
  }

  // Override the normalization for the vector type
  if ((pgDriver as any).dataTypeDefaults) {
    (pgDriver as any).dataTypeDefaults['vector'] = {
      type: 'vector',
    };
  }

  // Override the column type resolver to prevent it from converting vector to other types
  const originalColumnTypeResolver = (pgDriver as any).columnTypeResolver;
  if (originalColumnTypeResolver) {
    (pgDriver as any).columnTypeResolver = (column: any) => {
      if (column.type === 'vector') {
        return 'vector';
      }
      return originalColumnTypeResolver(column);
    };
  }
}
