import { replaceEnvVars, expandEnvVars } from '../../src/config/index.js';

describe('Environment Variable Expansion - Comprehensive Tests', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset process.env before each test
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    // Restore original environment
    process.env = originalEnv;
  });

  describe('expandEnvVars - String expansion', () => {
    it('should expand ${VAR} format', () => {
      process.env.TEST_VAR = 'test-value';
      expect(expandEnvVars('${TEST_VAR}')).toBe('test-value');
    });

    it('should expand $VAR format', () => {
      process.env.TEST_VAR = 'test-value';
      expect(expandEnvVars('$TEST_VAR')).toBe('test-value');
    });

    it('should expand multiple variables', () => {
      process.env.HOST = 'localhost';
      process.env.PORT = '3000';
      expect(expandEnvVars('http://${HOST}:${PORT}')).toBe('http://localhost:3000');
    });

    it('should return empty string for undefined variables', () => {
      expect(expandEnvVars('${UNDEFINED_VAR}')).toBe('');
    });

    it('should handle strings without variables', () => {
      expect(expandEnvVars('plain-string')).toBe('plain-string');
    });

    it('should handle mixed variable formats', () => {
      process.env.VAR1 = 'value1';
      process.env.VAR2 = 'value2';
      expect(expandEnvVars('$VAR1-${VAR2}')).toBe('value1-value2');
    });
  });

  describe('replaceEnvVars - Recursive expansion', () => {
    it('should expand environment variables in nested objects', () => {
      process.env.API_KEY = 'secret123';
      process.env.BASE_URL = 'https://api.example.com';

      const config = {
        url: '${BASE_URL}/endpoint',
        headers: {
          'X-API-Key': '${API_KEY}',
          'Content-Type': 'application/json',
        },
        nested: {
          value: '$API_KEY',
        },
      };

      const result = replaceEnvVars(config);

      expect(result).toEqual({
        url: 'https://api.example.com/endpoint',
        headers: {
          'X-API-Key': 'secret123',
          'Content-Type': 'application/json',
        },
        nested: {
          value: 'secret123',
        },
      });
    });

    it('should expand environment variables in arrays', () => {
      process.env.ARG1 = 'value1';
      process.env.ARG2 = 'value2';

      const args = ['--arg1', '${ARG1}', '--arg2', '${ARG2}'];
      const result = replaceEnvVars(args);

      expect(result).toEqual(['--arg1', 'value1', '--arg2', 'value2']);
    });

    it('should expand environment variables in nested arrays', () => {
      process.env.ITEM = 'test-item';

      const config = {
        items: ['${ITEM}', 'static-item'],
      };

      const result = replaceEnvVars(config);

      expect(result).toEqual({
        items: ['test-item', 'static-item'],
      });
    });

    it('should preserve non-string values', () => {
      const config = {
        enabled: true,
        timeout: 3000,
        ratio: 0.5,
        nullable: null,
      };

      const result = replaceEnvVars(config);

      expect(result).toEqual({
        enabled: true,
        timeout: 3000,
        ratio: 0.5,
        nullable: null,
      });
    });

    it('should expand deeply nested structures', () => {
      process.env.DEEP_VALUE = 'deep-secret';

      const config = {
        level1: {
          level2: {
            level3: {
              value: '${DEEP_VALUE}',
            },
          },
        },
      };

      const result = replaceEnvVars(config);

      expect(result).toEqual({
        level1: {
          level2: {
            level3: {
              value: 'deep-secret',
            },
          },
        },
      });
    });

    it('should expand environment variables in mixed nested structures', () => {
      process.env.VAR1 = 'value1';
      process.env.VAR2 = 'value2';

      const config = {
        array: [
          {
            key: '${VAR1}',
          },
          {
            key: '${VAR2}',
          },
        ],
      };

      const result = replaceEnvVars(config);

      expect(result).toEqual({
        array: [
          {
            key: 'value1',
          },
          {
            key: 'value2',
          },
        ],
      });
    });
  });

  describe('ServerConfig scenarios', () => {
    it('should expand URL with environment variables', () => {
      process.env.SERVER_HOST = 'api.example.com';
      process.env.SERVER_PORT = '8080';

      const config = {
        type: 'sse',
        url: 'https://${SERVER_HOST}:${SERVER_PORT}/mcp',
      };

      const result = replaceEnvVars(config);

      expect(result.url).toBe('https://api.example.com:8080/mcp');
    });

    it('should expand command with environment variables', () => {
      process.env.PYTHON_PATH = '/usr/bin/python3';

      const config = {
        type: 'stdio',
        command: '${PYTHON_PATH}',
        args: ['-m', 'my_module'],
      };

      const result = replaceEnvVars(config);

      expect(result.command).toBe('/usr/bin/python3');
    });

    it('should expand OpenAPI configuration', () => {
      process.env.API_BASE_URL = 'https://api.example.com';
      process.env.API_KEY = 'secret-key-123';

      const config = {
        type: 'openapi',
        openapi: {
          url: '${API_BASE_URL}/openapi.json',
          security: {
            type: 'apiKey',
            apiKey: {
              name: 'X-API-Key',
              in: 'header',
              value: '${API_KEY}',
            },
          },
        },
      };

      const result = replaceEnvVars(config);

      expect(result.openapi.url).toBe('https://api.example.com/openapi.json');
      expect(result.openapi.security.apiKey.value).toBe('secret-key-123');
    });

    it('should expand OAuth configuration', () => {
      process.env.CLIENT_ID = 'my-client-id';
      process.env.CLIENT_SECRET = 'my-client-secret';
      process.env.ACCESS_TOKEN = 'my-access-token';

      const config = {
        type: 'sse',
        url: 'https://mcp.example.com',
        oauth: {
          clientId: '${CLIENT_ID}',
          clientSecret: '${CLIENT_SECRET}',
          accessToken: '${ACCESS_TOKEN}',
          scopes: ['read', 'write'],
        },
      };

      const result = replaceEnvVars(config);

      expect(result.oauth.clientId).toBe('my-client-id');
      expect(result.oauth.clientSecret).toBe('my-client-secret');
      expect(result.oauth.accessToken).toBe('my-access-token');
      expect(result.oauth.scopes).toEqual(['read', 'write']);
    });

    it('should expand environment variables in env object', () => {
      process.env.API_KEY = 'my-api-key';
      process.env.DEBUG = 'true';

      const config = {
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
        env: {
          MY_API_KEY: '${API_KEY}',
          DEBUG: '${DEBUG}',
        },
      };

      const result = replaceEnvVars(config);

      expect(result.env.MY_API_KEY).toBe('my-api-key');
      expect(result.env.DEBUG).toBe('true');
    });

    it('should handle complete server configuration', () => {
      process.env.SERVER_URL = 'https://mcp.example.com';
      process.env.AUTH_TOKEN = 'bearer-token-123';
      process.env.TIMEOUT = '60000';

      const config = {
        type: 'streamable-http',
        url: '${SERVER_URL}/mcp',
        headers: {
          Authorization: 'Bearer ${AUTH_TOKEN}',
          'User-Agent': 'MCPHub/1.0',
        },
        options: {
          timeout: 30000,
        },
        enabled: true,
      };

      const result = replaceEnvVars(config);

      expect(result.url).toBe('https://mcp.example.com/mcp');
      expect(result.headers.Authorization).toBe('Bearer bearer-token-123');
      expect(result.headers['User-Agent']).toBe('MCPHub/1.0');
      expect(result.options.timeout).toBe(30000);
      expect(result.enabled).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle empty string values', () => {
      const config = {
        value: '',
      };

      const result = replaceEnvVars(config);

      expect(result.value).toBe('');
    });

    it('should handle undefined values', () => {
      const result = replaceEnvVars(undefined);
      expect(result).toEqual([]);
    });

    it('should handle null values in objects', () => {
      const config = {
        value: null,
      };

      const result = replaceEnvVars(config);

      expect(result.value).toBe(null);
    });

    it('should not break on circular references prevention', () => {
      // Note: This test ensures we don't have infinite recursion issues
      // by using a deeply nested structure
      process.env.DEEP = 'value';

      const config = {
        a: { b: { c: { d: { e: { f: { g: { h: { i: { j: '${DEEP}' } } } } } } } } },
      };

      const result = replaceEnvVars(config);

      expect(result.a.b.c.d.e.f.g.h.i.j).toBe('value');
    });
  });
});
