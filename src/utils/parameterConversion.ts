/**
 * Utility functions for converting parameter types based on JSON schema definitions
 */

/**
 * Convert parameters to their proper types based on the tool's input schema
 * This ensures that form-submitted string values are converted to the correct types
 * (e.g., numbers, booleans, arrays) before being passed to MCP tools.
 *
 * @param params - The parameters to convert (typically from form submission)
 * @param inputSchema - The JSON schema definition for the tool's input
 * @returns The converted parameters with proper types
 */
export function convertParametersToTypes(
  params: Record<string, any>,
  inputSchema: Record<string, any>,
): Record<string, any> {
  if (!inputSchema || typeof inputSchema !== 'object' || !inputSchema.properties) {
    return params;
  }

  const convertedParams: Record<string, any> = {};
  const properties = inputSchema.properties;

  for (const [key, value] of Object.entries(params)) {
    const propDef = properties[key];
    if (!propDef || typeof propDef !== 'object') {
      // No schema definition found, keep as is
      convertedParams[key] = value;
      continue;
    }

    const propType = propDef.type;

    try {
      switch (propType) {
        case 'integer':
        case 'number':
          // Convert string to number
          if (typeof value === 'string') {
            const numValue = propType === 'integer' ? parseInt(value, 10) : parseFloat(value);
            convertedParams[key] = isNaN(numValue) ? value : numValue;
          } else {
            convertedParams[key] = value;
          }
          break;

        case 'boolean':
          // Convert string to boolean
          if (typeof value === 'string') {
            convertedParams[key] = value.toLowerCase() === 'true' || value === '1';
          } else {
            convertedParams[key] = value;
          }
          break;

        case 'array':
          // Handle array conversion if needed (e.g., comma-separated strings)
          if (typeof value === 'string' && value.includes(',')) {
            convertedParams[key] = value.split(',').map((item) => item.trim());
          } else {
            convertedParams[key] = value;
          }
          break;

        case 'object':
          // Handle object conversion if needed
          if (typeof value === 'string') {
            try {
              convertedParams[key] = JSON.parse(value);
            } catch {
              // If parsing fails, keep as is
              convertedParams[key] = value;
            }
          } else {
            convertedParams[key] = value;
          }
          break;

        default:
          // For string and other types, keep as is
          convertedParams[key] = value;
          break;
      }
    } catch (error) {
      // If conversion fails, keep the original value
      console.warn(`Failed to convert parameter '${key}' to type '${propType}':`, error);
      convertedParams[key] = value;
    }
  }

  return convertedParams;
}
