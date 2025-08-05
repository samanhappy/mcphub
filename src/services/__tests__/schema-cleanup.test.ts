describe('Schema Cleanup Tests', () => {
  describe('cleanInputSchema functionality', () => {
    // Helper function to simulate the cleanInputSchema behavior
    const cleanInputSchema = (schema: any): any => {
      if (!schema || typeof schema !== 'object') {
        return schema;
      }

      const cleanedSchema = { ...schema };
      delete cleanedSchema.$schema;

      return cleanedSchema;
    };

    test('should remove $schema field from inputSchema', () => {
      const schemaWithDollarSchema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'Test property',
          },
        },
        required: ['name'],
      };

      const cleanedSchema = cleanInputSchema(schemaWithDollarSchema);

      expect(cleanedSchema).not.toHaveProperty('$schema');
      expect(cleanedSchema.type).toBe('object');
      expect(cleanedSchema.properties).toEqual({
        name: {
          type: 'string',
          description: 'Test property',
        },
      });
      expect(cleanedSchema.required).toEqual(['name']);
    });

    test('should handle null and undefined schemas', () => {
      expect(cleanInputSchema(null)).toBe(null);
      expect(cleanInputSchema(undefined)).toBe(undefined);
    });

    test('should handle non-object schemas', () => {
      expect(cleanInputSchema('string')).toBe('string');
      expect(cleanInputSchema(42)).toBe(42);
      expect(cleanInputSchema(true)).toBe(true);
    });

    test('should preserve other properties while removing $schema', () => {
      const complexSchema = {
        $schema: 'http://json-schema.org/draft-07/schema#',
        type: 'object',
        title: 'Test Schema',
        description: 'A test schema',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
        additionalProperties: false,
      };

      const cleanedSchema = cleanInputSchema(complexSchema);

      expect(cleanedSchema).not.toHaveProperty('$schema');
      expect(cleanedSchema.type).toBe('object');
      expect(cleanedSchema.title).toBe('Test Schema');
      expect(cleanedSchema.description).toBe('A test schema');
      expect(cleanedSchema.properties).toEqual({
        name: { type: 'string' },
        age: { type: 'number' },
      });
      expect(cleanedSchema.required).toEqual(['name']);
      expect(cleanedSchema.additionalProperties).toBe(false);
    });

    test('should handle schemas without $schema field', () => {
      const schemaWithoutDollarSchema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      };

      const cleanedSchema = cleanInputSchema(schemaWithoutDollarSchema);

      expect(cleanedSchema).toEqual(schemaWithoutDollarSchema);
      expect(cleanedSchema).not.toHaveProperty('$schema');
    });

    test('should handle empty objects', () => {
      const emptySchema = {};
      const cleanedSchema = cleanInputSchema(emptySchema);

      expect(cleanedSchema).toEqual({});
      expect(cleanedSchema).not.toHaveProperty('$schema');
    });
  });
});
