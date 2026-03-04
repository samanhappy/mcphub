import { convertParametersToTypes, sanitizeToolArguments } from '../../src/utils/parameterConversion.js';

describe('Parameter Conversion Utilities', () => {
  describe('convertParametersToTypes', () => {
    it('should convert string to number when schema type is number', () => {
      const params = { count: '42' };
      const schema = {
        type: 'object',
        properties: {
          count: { type: 'number' },
        },
      };

      const result = convertParametersToTypes(params, schema);

      expect(result.count).toBe(42);
      expect(typeof result.count).toBe('number');
    });

    it('should convert string to integer when schema type is integer', () => {
      const params = { age: '25' };
      const schema = {
        type: 'object',
        properties: {
          age: { type: 'integer' },
        },
      };

      const result = convertParametersToTypes(params, schema);

      expect(result.age).toBe(25);
      expect(typeof result.age).toBe('number');
      expect(Number.isInteger(result.age)).toBe(true);
    });

    it('should convert string to boolean when schema type is boolean', () => {
      const params = { enabled: 'true', disabled: 'false', flag: '1' };
      const schema = {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          disabled: { type: 'boolean' },
          flag: { type: 'boolean' },
        },
      };

      const result = convertParametersToTypes(params, schema);

      expect(result.enabled).toBe(true);
      expect(result.disabled).toBe(false);
      expect(result.flag).toBe(true);
    });

    it('should convert comma-separated string to array when schema type is array', () => {
      const params = { tags: 'one,two,three' };
      const schema = {
        type: 'object',
        properties: {
          tags: { type: 'array' },
        },
      };

      const result = convertParametersToTypes(params, schema);

      expect(Array.isArray(result.tags)).toBe(true);
      expect(result.tags).toEqual(['one', 'two', 'three']);
    });

    it('should parse JSON string to object when schema type is object', () => {
      const params = { config: '{"key": "value", "nested": {"prop": 123}}' };
      const schema = {
        type: 'object',
        properties: {
          config: { type: 'object' },
        },
      };

      const result = convertParametersToTypes(params, schema);

      expect(typeof result.config).toBe('object');
      expect(result.config).toEqual({ key: 'value', nested: { prop: 123 } });
    });

    it('should keep values unchanged when they already have the correct type', () => {
      const params = { count: 42, enabled: true, tags: ['a', 'b'] };
      const schema = {
        type: 'object',
        properties: {
          count: { type: 'number' },
          enabled: { type: 'boolean' },
          tags: { type: 'array' },
        },
      };

      const result = convertParametersToTypes(params, schema);

      expect(result.count).toBe(42);
      expect(result.enabled).toBe(true);
      expect(result.tags).toEqual(['a', 'b']);
    });

    it('should keep string values unchanged when schema type is string', () => {
      const params = { name: 'John Doe' };
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
      };

      const result = convertParametersToTypes(params, schema);

      expect(result.name).toBe('John Doe');
      expect(typeof result.name).toBe('string');
    });

    it('should handle parameters without schema definition', () => {
      const params = { unknown: 'value' };
      const schema = {
        type: 'object',
        properties: {
          known: { type: 'string' },
        },
      };

      const result = convertParametersToTypes(params, schema);

      expect(result.unknown).toBe('value');
    });

    it('should return original params when schema has no properties', () => {
      const params = { key: 'value' };
      const schema = { type: 'object' };

      const result = convertParametersToTypes(params, schema);

      expect(result).toEqual(params);
    });

    it('should return original params when schema is null or undefined', () => {
      const params = { key: 'value' };

      const resultNull = convertParametersToTypes(params, null as any);
      const resultUndefined = convertParametersToTypes(params, undefined as any);

      expect(resultNull).toEqual(params);
      expect(resultUndefined).toEqual(params);
    });

    it('should handle invalid number conversion gracefully', () => {
      const params = { count: 'not-a-number' };
      const schema = {
        type: 'object',
        properties: {
          count: { type: 'number' },
        },
      };

      const result = convertParametersToTypes(params, schema);

      // When conversion fails, it should keep original value
      expect(result.count).toBe('not-a-number');
    });

    it('should handle invalid JSON string for object gracefully', () => {
      const params = { config: '{invalid json}' };
      const schema = {
        type: 'object',
        properties: {
          config: { type: 'object' },
        },
      };

      const result = convertParametersToTypes(params, schema);

      // When JSON parsing fails, it should keep original value
      expect(result.config).toBe('{invalid json}');
    });

    it('should handle mixed parameter types correctly', () => {
      const params = {
        name: 'Test',
        count: '10',
        price: '19.99',
        enabled: 'true',
        tags: 'tag1,tag2',
        config: '{"nested": true}',
      };
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          count: { type: 'integer' },
          price: { type: 'number' },
          enabled: { type: 'boolean' },
          tags: { type: 'array' },
          config: { type: 'object' },
        },
      };

      const result = convertParametersToTypes(params, schema);

      expect(result.name).toBe('Test');
      expect(result.count).toBe(10);
      expect(result.price).toBe(19.99);
      expect(result.enabled).toBe(true);
      expect(result.tags).toEqual(['tag1', 'tag2']);
      expect(result.config).toEqual({ nested: true });
    });

    it('should handle empty string values', () => {
      const params = { name: '', count: '', enabled: '' };
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          count: { type: 'number' },
          enabled: { type: 'boolean' },
        },
      };

      const result = convertParametersToTypes(params, schema);

      expect(result.name).toBe('');
      // Empty string should remain as empty string for number (NaN check keeps original)
      expect(result.count).toBe('');
      // Empty string converts to false for boolean
      expect(result.enabled).toBe(false);
    });

    it('should handle array that is already an array', () => {
      const params = { tags: ['existing', 'array'] };
      const schema = {
        type: 'object',
        properties: {
          tags: { type: 'array' },
        },
      };

      const result = convertParametersToTypes(params, schema);

      expect(result.tags).toEqual(['existing', 'array']);
    });

    it('should handle object that is already an object', () => {
      const params = { config: { key: 'value' } };
      const schema = {
        type: 'object',
        properties: {
          config: { type: 'object' },
        },
      };

      const result = convertParametersToTypes(params, schema);

      expect(result.config).toEqual({ key: 'value' });
    });
  });
});

describe('sanitizeToolArguments', () => {
  it('should return empty object for undefined args', () => {
    expect(sanitizeToolArguments(undefined)).toEqual({});
  });

  it('should return empty object for null args', () => {
    expect(sanitizeToolArguments(null as any)).toEqual({});
  });

  it('should pass through args when no schema provided', () => {
    const args = { _placeholder: true, key: 'value' };
    expect(sanitizeToolArguments(args)).toEqual(args);
  });

  it('should pass through args when schema has no properties', () => {
    const args = { _placeholder: true, key: 'value' };
    expect(sanitizeToolArguments(args, { type: 'object' })).toEqual(args);
  });

  it('should pass through args when additionalProperties is true', () => {
    const args = { _placeholder: true, key: 'value' };
    const schema = {
      type: 'object',
      properties: { key: { type: 'string' } },
      additionalProperties: true,
    };
    expect(sanitizeToolArguments(args, schema)).toEqual(args);
  });

  it('should strip _placeholder from no-arg tool calls', () => {
    const args = { _placeholder: true };
    const schema = {
      type: 'object',
      properties: {},
    };
    expect(sanitizeToolArguments(args, schema)).toEqual({});
  });

  it('should strip unknown keys while keeping defined ones', () => {
    const args = { _placeholder: true, query: 'test', unknown: 'value' };
    const schema = {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
    };
    expect(sanitizeToolArguments(args, schema)).toEqual({ query: 'test' });
  });

  it('should keep all args when all are in schema', () => {
    const args = { name: 'test', value: 42 };
    const schema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        value: { type: 'number' },
      },
    };
    expect(sanitizeToolArguments(args, schema)).toEqual(args);
  });

  it('should handle empty args object', () => {
    const schema = {
      type: 'object',
      properties: { key: { type: 'string' } },
    };
    expect(sanitizeToolArguments({}, schema)).toEqual({});
  });

  it('should handle non-object schema gracefully', () => {
    const args = { _placeholder: true };
    expect(sanitizeToolArguments(args, 'not-an-object' as any)).toEqual(args);
  });
});
