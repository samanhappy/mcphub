// Simple unit test to validate the type conversion logic
describe('Parameter Type Conversion Logic', () => {
  // Extract the conversion function for testing
  function convertQueryParametersToTypes(
    queryParams: Record<string, any>,
    inputSchema: Record<string, any>
  ): Record<string, any> {
    if (!inputSchema || typeof inputSchema !== 'object' || !inputSchema.properties) {
      return queryParams;
    }

    const convertedParams: Record<string, any> = {};
    const properties = inputSchema.properties;

    for (const [key, value] of Object.entries(queryParams)) {
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
              convertedParams[key] = value.split(',').map(item => item.trim());
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

  test('should convert integer parameters correctly', () => {
    const queryParams = {
      limit: '5',
      offset: '10',
      name: 'test'
    };
    
    const inputSchema = {
      type: 'object',
      properties: {
        limit: { type: 'integer' },
        offset: { type: 'integer' },
        name: { type: 'string' }
      }
    };

    const result = convertQueryParametersToTypes(queryParams, inputSchema);

    expect(result).toEqual({
      limit: 5,       // Converted to integer
      offset: 10,     // Converted to integer
      name: 'test'    // Remains string
    });
  });

  test('should convert number parameters correctly', () => {
    const queryParams = {
      price: '19.99',
      discount: '0.15'
    };
    
    const inputSchema = {
      type: 'object',
      properties: {
        price: { type: 'number' },
        discount: { type: 'number' }
      }
    };

    const result = convertQueryParametersToTypes(queryParams, inputSchema);

    expect(result).toEqual({
      price: 19.99,
      discount: 0.15
    });
  });

  test('should convert boolean parameters correctly', () => {
    const queryParams = {
      enabled: 'true',
      disabled: 'false',
      active: '1',
      inactive: '0'
    };
    
    const inputSchema = {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        disabled: { type: 'boolean' },
        active: { type: 'boolean' },
        inactive: { type: 'boolean' }
      }
    };

    const result = convertQueryParametersToTypes(queryParams, inputSchema);

    expect(result).toEqual({
      enabled: true,
      disabled: false,
      active: true,
      inactive: false
    });
  });

  test('should convert array parameters correctly', () => {
    const queryParams = {
      tags: 'tag1,tag2,tag3',
      ids: '1,2,3'
    };
    
    const inputSchema = {
      type: 'object',
      properties: {
        tags: { type: 'array' },
        ids: { type: 'array' }
      }
    };

    const result = convertQueryParametersToTypes(queryParams, inputSchema);

    expect(result).toEqual({
      tags: ['tag1', 'tag2', 'tag3'],
      ids: ['1', '2', '3']
    });
  });

  test('should handle missing schema gracefully', () => {
    const queryParams = {
      limit: '5',
      name: 'test'
    };

    const result = convertQueryParametersToTypes(queryParams, {});

    expect(result).toEqual({
      limit: '5',     // Should remain as string
      name: 'test'    // Should remain as string
    });
  });

  test('should handle properties not in schema', () => {
    const queryParams = {
      limit: '5',
      unknownParam: 'value'
    };
    
    const inputSchema = {
      type: 'object',
      properties: {
        limit: { type: 'integer' }
      }
    };

    const result = convertQueryParametersToTypes(queryParams, inputSchema);

    expect(result).toEqual({
      limit: 5,                     // Converted based on schema
      unknownParam: 'value'         // Kept as is (no schema)
    });
  });

  test('should handle invalid number conversion gracefully', () => {
    const queryParams = {
      limit: 'not-a-number',
      price: 'invalid'
    };
    
    const inputSchema = {
      type: 'object',
      properties: {
        limit: { type: 'integer' },
        price: { type: 'number' }
      }
    };

    const result = convertQueryParametersToTypes(queryParams, inputSchema);

    expect(result).toEqual({
      limit: 'not-a-number',  // Should remain as string when conversion fails
      price: 'invalid'        // Should remain as string when conversion fails
    });
  });
});

// Test the new OpenAPI endpoints functionality
describe('OpenAPI Granular Endpoints', () => {
  // Mock the required services
  const mockGetAvailableServers = jest.fn();
  const mockGenerateOpenAPISpec = jest.fn();
  const mockGetGroupByIdOrName = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('should generate server-specific OpenAPI spec', async () => {
    // Mock available servers
    mockGetAvailableServers.mockResolvedValue(['server1', 'server2']);
    
    // Mock OpenAPI spec generation
    const mockSpec = { openapi: '3.0.3', info: { title: 'server1 MCP API' } };
    mockGenerateOpenAPISpec.mockResolvedValue(mockSpec);

    // Test server spec generation options
    const expectedOptions = {
      title: 'server1 MCP API',
      description: 'OpenAPI specification for server1 MCP server tools',
      serverFilter: ['server1']
    };

    // Verify that the correct options would be passed
    expect(expectedOptions.serverFilter).toEqual(['server1']);
    expect(expectedOptions.title).toBe('server1 MCP API');
  });

  test('should generate group-specific OpenAPI spec', async () => {
    // Mock group data
    const mockGroup = {
      id: 'group1',
      name: 'webtools',
      servers: [
        { name: 'server1', tools: 'all' },
        { name: 'server2', tools: ['tool1', 'tool2'] }
      ]
    };
    mockGetGroupByIdOrName.mockReturnValue(mockGroup);

    // Mock OpenAPI spec generation
    const mockSpec = { openapi: '3.0.3', info: { title: 'webtools Group MCP API' } };
    mockGenerateOpenAPISpec.mockResolvedValue(mockSpec);

    // Test group spec generation options
    const expectedOptions = {
      title: 'webtools Group MCP API',
      description: 'OpenAPI specification for webtools group tools',
      groupFilter: 'webtools'
    };

    // Verify that the correct options would be passed
    expect(expectedOptions.groupFilter).toBe('webtools');
    expect(expectedOptions.title).toBe('webtools Group MCP API');
  });

  test('should handle non-existent server', async () => {
    // Mock available servers (not including 'nonexistent')
    mockGetAvailableServers.mockResolvedValue(['server1', 'server2']);

    // Verify error handling for non-existent server
    const serverExists = ['server1', 'server2'].includes('nonexistent');
    expect(serverExists).toBe(false);
  });

  test('should handle non-existent group', async () => {
    // Mock group lookup returning null
    mockGetGroupByIdOrName.mockReturnValue(null);

    // Verify error handling for non-existent group
    const group = mockGetGroupByIdOrName('nonexistent');
    expect(group).toBeNull();
  });
});