/**
 * Utility functions for safe JSON serialization
 * Handles circular references and provides type-safe serialization
 */

const serializeError = (error: Error): Record<string, unknown> => {
  const serialized: Record<string, unknown> = {};

  Object.getOwnPropertyNames(error).forEach((propertyName) => {
    serialized[propertyName] = Reflect.get(error, propertyName) as unknown;
  });

  serialized.name = serialized.name ?? error.name;

  return serialized;
};

const createSafeJsonReplacer = () => {
  const seen = new WeakSet<object>();

  return (_key: string, value: unknown): unknown => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular Reference]';
      }

      seen.add(value);

      if (value instanceof Error) {
        return serializeError(value);
      }
    }

    return value;
  };
};

/**
 * Creates a JSON-safe copy of an object by removing circular references
 * Uses a replacer function with WeakSet to efficiently track visited objects
 *
 * @param obj - The object to make JSON-safe
 * @returns A new object that can be safely serialized to JSON
 */
export const createSafeJSON = <T>(obj: T): T => {
  return JSON.parse(JSON.stringify(obj, createSafeJsonReplacer()));
};

/**
 * Safe JSON stringifier that handles circular references
 * Useful for logging or debugging purposes
 *
 * @param obj - The object to stringify
 * @param space - Number of spaces to use for indentation (optional)
 * @returns JSON string representation of the object
 */
export const safeStringify = (obj: any, space?: number): string => {
  return JSON.stringify(obj, createSafeJsonReplacer(), space);
};

/**
 * Removes specific properties that might contain circular references
 * More targeted approach for known problematic properties
 *
 * @param obj - The object to clean
 * @param excludeProps - Array of property names to exclude
 * @returns A new object without the specified properties
 */
export const excludeCircularProps = <T extends Record<string, any>>(
  obj: T,
  excludeProps: string[],
): Omit<T, keyof (typeof excludeProps)[number]> => {
  const result = { ...obj };
  excludeProps.forEach((prop) => {
    delete result[prop];
  });
  return result;
};
