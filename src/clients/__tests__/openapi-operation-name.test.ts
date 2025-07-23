import { OpenAPIClient } from '../openapi.js';
import { ServerConfig } from '../../types/index.js';
import { OpenAPIV3 } from 'openapi-types';

describe('OpenAPIClient - Operation Name Generation', () => {
  describe('generateOperationName', () => {
    test('should generate operation name from method and path', async () => {
      const config: ServerConfig = {
        type: 'openapi',
        openapi: {
          schema: {
            openapi: '3.0.0',
            info: { title: 'Test API', version: '1.0.0' },
            paths: {
              '/users': {
                get: {
                  summary: 'Get users',
                  responses: { '200': { description: 'Success' } },
                },
                post: {
                  summary: 'Create user',
                  responses: { '201': { description: 'Created' } },
                },
              },
              '/users/{id}': {
                get: {
                  summary: 'Get user by ID',
                  responses: { '200': { description: 'Success' } },
                },
                delete: {
                  summary: 'Delete user',
                  responses: { '204': { description: 'Deleted' } },
                },
              },
              '/admin/settings': {
                get: {
                  summary: 'Get admin settings',
                  responses: { '200': { description: 'Success' } },
                },
              },
              '/': {
                get: {
                  summary: 'Root endpoint',
                  responses: { '200': { description: 'Success' } },
                },
              },
            },
          } as OpenAPIV3.Document,
        },
      };

      const testClient = new OpenAPIClient(config);
      await testClient.initialize();
      const tools = testClient.getTools();

      // Verify generated operation names
      expect(tools).toHaveLength(6);

      const toolNames = tools.map((t) => t.name).sort();
      expect(toolNames).toEqual(
        [
          'delete_users',
          'get_admin_settings',
          'get_root',
          'get_users',
          'post_users',
          'get_users1', // Second GET /users/{id}, will add numeric suffix
        ].sort(),
      );
    });

    test('should use operationId when available and generate name when missing', async () => {
      const config: ServerConfig = {
        type: 'openapi',
        openapi: {
          schema: {
            openapi: '3.0.0',
            info: { title: 'Test API', version: '1.0.0' },
            paths: {
              '/users': {
                get: {
                  operationId: 'listUsers',
                  summary: 'Get users',
                  responses: { '200': { description: 'Success' } },
                },
                post: {
                  // No operationId, should generate post_users
                  summary: 'Create user',
                  responses: { '201': { description: 'Created' } },
                },
              },
              '/users/{id}': {
                get: {
                  operationId: 'getUserById',
                  summary: 'Get user by ID',
                  responses: { '200': { description: 'Success' } },
                },
              },
            },
          } as OpenAPIV3.Document,
        },
      };

      const testClient = new OpenAPIClient(config);
      await testClient.initialize();
      const tools = testClient.getTools();

      expect(tools).toHaveLength(3);

      const toolsByName = tools.reduce(
        (acc, tool) => {
          acc[tool.name] = tool;
          return acc;
        },
        {} as Record<string, any>,
      );

      // Those with operationId should use the original operationId
      expect(toolsByName['listUsers']).toBeDefined();
      expect(toolsByName['listUsers'].operationId).toBe('listUsers');
      expect(toolsByName['getUserById']).toBeDefined();
      expect(toolsByName['getUserById'].operationId).toBe('getUserById');

      // Those without operationId should generate names
      expect(toolsByName['post_users']).toBeDefined();
      expect(toolsByName['post_users'].operationId).toBe('post_users');
    });

    test('should handle duplicate generated names with counter', async () => {
      const config: ServerConfig = {
        type: 'openapi',
        openapi: {
          schema: {
            openapi: '3.0.0',
            info: { title: 'Test API', version: '1.0.0' },
            paths: {
              '/users': {
                get: {
                  summary: 'Get users',
                  responses: { '200': { description: 'Success' } },
                },
              },
              '/users/': {
                get: {
                  summary: 'Get users with trailing slash',
                  responses: { '200': { description: 'Success' } },
                },
              },
            },
          } as OpenAPIV3.Document,
        },
      };

      const testClient = new OpenAPIClient(config);
      await testClient.initialize();
      const tools = testClient.getTools();

      expect(tools).toHaveLength(2);

      const toolNames = tools.map((t) => t.name).sort();
      expect(toolNames).toEqual(['get_users', 'get_users1']);
    });

    test('should handle complex paths with parameters and special characters', async () => {
      const config: ServerConfig = {
        type: 'openapi',
        openapi: {
          schema: {
            openapi: '3.0.0',
            info: { title: 'Test API', version: '1.0.0' },
            paths: {
              '/api/v1/users/{user-id}/posts/{post_id}': {
                get: {
                  summary: 'Get user post',
                  responses: { '200': { description: 'Success' } },
                },
              },
              '/api-v2/user-profiles': {
                post: {
                  summary: 'Create user profile',
                  responses: { '201': { description: 'Created' } },
                },
              },
            },
          } as OpenAPIV3.Document,
        },
      };

      const testClient = new OpenAPIClient(config);
      await testClient.initialize();
      const tools = testClient.getTools();

      expect(tools).toHaveLength(2);

      const toolNames = tools.map((t) => t.name);
      expect(toolNames).toContain('get_api_v1_users_posts'); // Path parameters removed, special characters cleaned
      expect(toolNames).toContain('post_apiv2_userprofiles'); // Hyphens and underscores cleaned, lowercase with underscores
    });
  });
});
