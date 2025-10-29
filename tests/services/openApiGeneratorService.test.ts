// Mock openid-client before importing services
jest.mock('openid-client', () => ({
  discovery: jest.fn(),
  dynamicClientRegistration: jest.fn(),
  ClientSecretPost: jest.fn(() => jest.fn()),
  ClientSecretBasic: jest.fn(() => jest.fn()),
  None: jest.fn(() => jest.fn()),
  calculatePKCECodeChallenge: jest.fn(),
  randomPKCECodeVerifier: jest.fn(),
  buildAuthorizationUrl: jest.fn(),
  authorizationCodeGrant: jest.fn(),
  refreshTokenGrant: jest.fn(),
}));

import { generateOpenAPISpec, getToolStats } from '../../src/services/openApiGeneratorService';

describe('OpenAPI Generator Service', () => {
  describe('generateOpenAPISpec', () => {
    it('should generate a valid OpenAPI specification', async () => {
      const spec = await generateOpenAPISpec();

      // Check basic structure
      expect(spec).toHaveProperty('openapi');
      expect(spec).toHaveProperty('info');
      expect(spec).toHaveProperty('servers');
      expect(spec).toHaveProperty('paths');
      expect(spec).toHaveProperty('components');

      // Check OpenAPI version
      expect(spec.openapi).toBe('3.0.3');

      // Check info section
      expect(spec.info).toHaveProperty('title');
      expect(spec.info).toHaveProperty('description');
      expect(spec.info).toHaveProperty('version');

      // Check components
      expect(spec.components).toHaveProperty('schemas');
      expect(spec.components).toHaveProperty('securitySchemes');

      // Check security schemes
      expect(spec.components?.securitySchemes).toHaveProperty('bearerAuth');
    });

    it('should generate spec with custom options', async () => {
      const options = {
        title: 'Custom API',
        description: 'Custom description',
        version: '2.0.0',
        serverUrl: 'https://custom.example.com',
      };

      const spec = await generateOpenAPISpec(options);

      expect(spec.info.title).toBe('Custom API');
      expect(spec.info.description).toBe('Custom description');
      expect(spec.info.version).toBe('2.0.0');
      expect(spec.servers?.[0].url).toContain('https://custom.example.com');
    });

    it('should handle empty server list gracefully', async () => {
      const spec = await generateOpenAPISpec();

      // Should not throw and should have valid structure
      expect(spec).toHaveProperty('paths');
      expect(typeof spec.paths).toBe('object');
    });

    it('should URL-encode server and tool names with slashes in paths', async () => {
      const spec = await generateOpenAPISpec();

      // Check if any paths contain URL-encoded values
      // Paths with slashes in server/tool names should be encoded
      const paths = Object.keys(spec.paths);

      // If there are any servers with slashes, verify encoding
      // e.g., "com.atlassian/atlassian-mcp-server" should become "com.atlassian%2Fatlassian-mcp-server"
      for (const path of paths) {
        // Path should not have unencoded slashes in the middle segments
        // Valid format: /tools/{encoded-server}/{encoded-tool}
        const pathSegments = path.split('/').filter((s) => s.length > 0);
        if (pathSegments[0] === 'tools' && pathSegments.length >= 3) {
          // The server name (segment 1) and tool name (segment 2+) should not create extra segments
          // If properly encoded, there should be exactly 3 segments: ['tools', serverName, toolName]
          expect(pathSegments.length).toBe(3);
        }
      }
    });
  });

  describe('getToolStats', () => {
    it('should return valid tool statistics', async () => {
      const stats = await getToolStats();

      expect(stats).toHaveProperty('totalServers');
      expect(stats).toHaveProperty('totalTools');
      expect(stats).toHaveProperty('serverBreakdown');

      expect(typeof stats.totalServers).toBe('number');
      expect(typeof stats.totalTools).toBe('number');
      expect(Array.isArray(stats.serverBreakdown)).toBe(true);
    });
  });
});
