import { expandEnvVars, replaceEnvVars } from '../../src/config/index.js';

describe('MCP Service - Headers Environment Variable Expansion', () => {
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

  describe('expandEnvVars', () => {
    it('should expand environment variables in ${VAR} format', () => {
      process.env.CONTEXT7_API_KEY = 'ctx7sk-test123';
      const result = expandEnvVars('${CONTEXT7_API_KEY}');
      expect(result).toBe('ctx7sk-test123');
    });

    it('should expand environment variables in $VAR format', () => {
      process.env.TEST_VAR = 'test-value';
      const result = expandEnvVars('$TEST_VAR');
      expect(result).toBe('test-value');
    });

    it('should expand multiple environment variables', () => {
      process.env.VAR1 = 'value1';
      process.env.VAR2 = 'value2';
      const result = expandEnvVars('${VAR1}-and-${VAR2}');
      expect(result).toBe('value1-and-value2');
    });

    it('should return empty string for undefined variables', () => {
      const result = expandEnvVars('${UNDEFINED_VAR}');
      expect(result).toBe('');
    });

    it('should handle strings without variables', () => {
      const result = expandEnvVars('plain-string');
      expect(result).toBe('plain-string');
    });
  });

  describe('replaceEnvVars - Object (Headers)', () => {
    it('should expand environment variables in header values', () => {
      process.env.CONTEXT7_API_KEY = 'ctx7sk-d16example123';
      const headers = {
        CONTEXT7_API_KEY: '${CONTEXT7_API_KEY}',
      };
      const result = replaceEnvVars(headers);
      expect(result).toEqual({
        CONTEXT7_API_KEY: 'ctx7sk-d16example123',
      });
    });

    it('should expand multiple headers with environment variables', () => {
      process.env.API_KEY = 'test-api-key';
      process.env.AUTH_TOKEN = 'test-auth-token';
      const headers = {
        'X-API-Key': '${API_KEY}',
        Authorization: 'Bearer ${AUTH_TOKEN}',
        'Content-Type': 'application/json',
      };
      const result = replaceEnvVars(headers);
      expect(result).toEqual({
        'X-API-Key': 'test-api-key',
        Authorization: 'Bearer test-auth-token',
        'Content-Type': 'application/json',
      });
    });

    it('should handle $VAR format in headers', () => {
      process.env.MY_KEY = 'my-value';
      const headers = {
        'X-Custom-Header': '$MY_KEY',
      };
      const result = replaceEnvVars(headers);
      expect(result).toEqual({
        'X-Custom-Header': 'my-value',
      });
    });

    it('should return empty string for undefined variables in headers', () => {
      const headers = {
        'X-Undefined': '${UNDEFINED_VAR}',
      };
      const result = replaceEnvVars(headers);
      expect(result).toEqual({
        'X-Undefined': '',
      });
    });

    it('should handle mix of variables and static values', () => {
      process.env.TOKEN = 'secret123';
      const headers = {
        Authorization: 'Bearer ${TOKEN}',
        'Content-Type': 'application/json',
        'X-Custom': 'static-value',
      };
      const result = replaceEnvVars(headers);
      expect(result).toEqual({
        Authorization: 'Bearer secret123',
        'Content-Type': 'application/json',
        'X-Custom': 'static-value',
      });
    });

    it('should handle empty object', () => {
      const headers = {};
      const result = replaceEnvVars(headers);
      expect(result).toEqual({});
    });
  });

  describe('replaceEnvVars - Array (Args)', () => {
    it('should expand environment variables in array elements', () => {
      process.env.PORT = '3000';
      const args = ['--port', '${PORT}'];
      const result = replaceEnvVars(args);
      expect(result).toEqual(['--port', '3000']);
    });

    it('should handle multiple variables in array', () => {
      process.env.HOST = 'localhost';
      process.env.PORT = '8080';
      const args = ['--host', '${HOST}', '--port', '${PORT}'];
      const result = replaceEnvVars(args);
      expect(result).toEqual(['--host', 'localhost', '--port', '8080']);
    });
  });

  describe('Real-world Context7 Scenario', () => {
    it('should correctly expand Context7 API key from environment', () => {
      // Simulate the environment variable being set in the container
      process.env.CONTEXT7_API_KEY = 'ctx7sk-d16examplekey123';

      // Simulate the configuration from mcp_settings.json
      const serverConfig = {
        type: 'streamable-http',
        url: 'https://mcp.context7.com/mcp',
        headers: {
          CONTEXT7_API_KEY: '${CONTEXT7_API_KEY}',
        },
        enabled: true,
      };

      // Simulate what happens in createTransportFromConfig
      const expandedHeaders = replaceEnvVars(serverConfig.headers);

      // Verify that the environment variable was correctly expanded
      expect(expandedHeaders.CONTEXT7_API_KEY).toBe('ctx7sk-d16examplekey123');
      expect(expandedHeaders.CONTEXT7_API_KEY).not.toBe('${CONTEXT7_API_KEY}');
      expect(expandedHeaders.CONTEXT7_API_KEY).toMatch(/^ctx7sk-/);
    });

    it('should handle case when environment variable is not set', () => {
      // Don't set the environment variable
      delete process.env.CONTEXT7_API_KEY;

      const serverConfig = {
        type: 'streamable-http',
        url: 'https://mcp.context7.com/mcp',
        headers: {
          CONTEXT7_API_KEY: '${CONTEXT7_API_KEY}',
        },
        enabled: true,
      };

      const expandedHeaders = replaceEnvVars(serverConfig.headers);

      // Should be empty string when env var is not set
      expect(expandedHeaders.CONTEXT7_API_KEY).toBe('');
    });
  });
});
