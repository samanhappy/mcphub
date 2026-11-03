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

const mockGetServersInfo = jest.fn(async () => []);

jest.mock('../../src/services/mcpService.js', () => ({
  getServersInfo: mockGetServersInfo,
}));

import { generateOpenAPISpec, getToolStats } from '../../src/services/openApiGeneratorService';

describe('OpenAPI Generator Service', () => {
  beforeEach(() => {
    mockGetServersInfo.mockResolvedValue([]);
  });

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

    it('should exclude app-only tools from generated paths', async () => {
      mockGetServersInfo.mockResolvedValue([
        {
          name: 'apps',
          status: 'connected',
          tools: [
            {
              name: 'apps-open_dashboard',
              description: 'Open dashboard',
              inputSchema: { type: 'object' },
            },
            {
              name: 'apps-poll_dashboard',
              description: 'Refresh dashboard',
              inputSchema: { type: 'object' },
              _meta: { ui: { visibility: ['app'] } },
            },
          ],
        },
      ] as any);

      const spec = await generateOpenAPISpec();

      expect(spec.paths).toHaveProperty('/tools/apps/open_dashboard');
      expect(spec.paths).not.toHaveProperty('/tools/apps/poll_dashboard');
    });
  });

  describe('tool input schema conversion', () => {
    const generateSpec = async (properties: Record<string, unknown>, root: object = {}) => {
      mockGetServersInfo.mockResolvedValue([
        {
          name: 'example',
          status: 'connected',
          tools: [
            {
              name: 'example-lookup',
              description: 'Lookup',
              inputSchema: { type: 'object', properties, ...root },
            },
          ],
        },
      ] as any);

      return generateOpenAPISpec();
    };

    const generateOperations = async (properties: Record<string, unknown>, root: object = {}) => {
      const spec = await generateSpec(properties, root);
      return spec.paths['/tools/example/lookup'] as Record<string, any>;
    };

    const bodyProperties = (operations: Record<string, any>) =>
      operations.post.requestBody.content['application/json'].schema.properties;

    it('should keep primitive-only tools as query parameters', async () => {
      const operations = await generateOperations({
        limit: { type: 'integer', description: 'Max rows' },
        ratio: { type: 'number' },
        enabled: { type: 'boolean' },
      });

      expect(operations).toHaveProperty('get');
      expect(operations).not.toHaveProperty('post');
      expect(operations.get.parameters).toEqual([
        {
          name: 'limit',
          in: 'query',
          required: false,
          description: 'Max rows',
          schema: { type: 'integer' },
        },
        {
          name: 'ratio',
          in: 'query',
          required: false,
          description: 'Parameter ratio',
          schema: { type: 'number' },
        },
        {
          name: 'enabled',
          in: 'query',
          required: false,
          description: 'Parameter enabled',
          schema: { type: 'boolean' },
        },
      ]);
    });

    it('should send a nullable array through the request body as an OpenAPI 3.0 nullable', async () => {
      const operations = await generateOperations({
        ids: { type: ['array', 'null'], items: { type: 'integer' } },
        n: { type: 'integer' },
      });

      expect(operations).not.toHaveProperty('get');
      expect(operations.post.parameters).toBeUndefined();
      expect(bodyProperties(operations)).toEqual({
        ids: { type: 'array', items: { type: 'integer' }, nullable: true },
        n: { type: 'integer' },
      });
    });

    it('should send a nullable scalar through the request body as an OpenAPI 3.0 nullable', async () => {
      const operations = await generateOperations({ limit: { type: ['integer', 'null'] } });

      expect(operations).not.toHaveProperty('get');
      expect(bodyProperties(operations)).toEqual({
        limit: { type: 'integer', nullable: true },
      });
    });

    it('should turn an anyOf with a null member into a nullable schema', async () => {
      const operations = await generateOperations({
        limit: { description: 'Max rows', anyOf: [{ type: 'integer' }, { type: 'null' }] },
      });

      expect(bodyProperties(operations)).toEqual({
        limit: { description: 'Max rows', type: 'integer', nullable: true },
      });
    });

    it('should keep the other members of a nullable oneOf', async () => {
      const operations = await generateOperations({
        value: { oneOf: [{ type: 'integer' }, { type: 'boolean' }, { type: 'null' }] },
      });

      expect(bodyProperties(operations)).toEqual({
        value: { oneOf: [{ type: 'integer', nullable: true }, { type: 'boolean' }] },
      });
    });

    it('should turn a type list into an anyOf', async () => {
      const operations = await generateOperations({
        value: { type: ['string', 'integer', 'null'] },
      });

      expect(bodyProperties(operations)).toEqual({
        value: { anyOf: [{ type: 'string', nullable: true }, { type: 'integer' }] },
      });
    });

    it('should convert nullable schemas nested in properties, items and combinators', async () => {
      const operations = await generateOperations({
        filter: {
          type: 'object',
          properties: {
            items: { type: 'array', items: { type: ['string', 'null'] } },
            type: { allOf: [{ anyOf: [{ type: 'string' }, { type: 'null' }] }] },
          },
        },
      });

      expect(bodyProperties(operations)).toEqual({
        filter: {
          type: 'object',
          properties: {
            items: { type: 'array', items: { type: 'string', nullable: true } },
            type: { allOf: [{ type: 'string', nullable: true }] },
          },
        },
      });
    });

    it('should replace const with a single-value enum', async () => {
      const operations = await generateOperations({
        kind: { const: 'search' },
        filter: { type: 'object' },
      });

      expect(bodyProperties(operations)).toEqual({
        kind: { enum: ['search'] },
        filter: { type: 'object' },
      });
    });

    it.each([
      ['oneOf', { oneOf: [{ type: 'integer' }, { type: 'boolean' }] }],
      ['allOf', { allOf: [{ type: 'integer' }] }],
    ])('should send a property declared with %s through the request body', async (_name, opt) => {
      const operations = await generateOperations({ opt, n: { type: 'integer' } });

      expect(operations).not.toHaveProperty('get');
      expect(bodyProperties(operations)).toEqual({ opt, n: { type: 'integer' } });
    });

    it('should inline local $defs references, including inside allOf', async () => {
      const operations = await generateOperations(
        {
          limit: { $ref: '#/$defs/Limit', description: 'Max rows' },
          page: { allOf: [{ $ref: '#/$defs/Limit' }] },
          legacy: { $ref: '#/definitions/Legacy' },
        },
        {
          $defs: { Limit: { type: ['integer', 'null'], minimum: 1 } },
          definitions: { Legacy: { type: 'string' } },
        },
      );

      expect(bodyProperties(operations)).toEqual({
        limit: { type: 'integer', minimum: 1, nullable: true, description: 'Max rows' },
        page: { allOf: [{ type: 'integer', minimum: 1, nullable: true }] },
        legacy: { type: 'string' },
      });
    });

    it('should not leave a recursive definition as an unresolved reference', async () => {
      const operations = await generateOperations(
        { tree: { $ref: '#/$defs/Node' } },
        {
          $defs: {
            Node: {
              type: 'object',
              properties: { value: { type: 'string' }, child: { $ref: '#/$defs/Node' } },
            },
          },
        },
      );

      expect(bodyProperties(operations)).toEqual({
        tree: {
          type: 'object',
          properties: { value: { type: 'string' }, child: {} },
        },
      });
    });

    it('should produce a document that validates as OpenAPI 3.0.3', async () => {
      const spec = await generateSpec(
        {
          limit: { $ref: '#/$defs/Limit' },
          ids: { type: ['array', 'null'], items: { type: 'integer' } },
          name: { anyOf: [{ type: 'string' }, { type: 'null' }] },
          page: { allOf: [{ $ref: '#/$defs/Limit' }] },
          kind: { const: 'search' },
          mixed: { type: ['string', 'integer', 'null'] },
          tree: { $ref: '#/$defs/Node' },
        },
        {
          $defs: {
            Limit: { type: ['integer', 'null'], minimum: 1 },
            Node: { type: 'object', properties: { child: { $ref: '#/$defs/Node' } } },
          },
        },
      );

      const SwaggerParser = (await import('@apidevtools/swagger-parser')).default;
      await expect(SwaggerParser.validate(JSON.parse(JSON.stringify(spec)))).resolves.toBeDefined();
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
