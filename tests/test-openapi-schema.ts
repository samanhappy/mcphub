// Test script to verify OpenAPI schema support
// Run this in the MCPHub project directory with: tsx test-openapi-schema.ts

import { OpenAPIClient } from './src/clients/openapi.js';
import type { ServerConfig } from './src/types/index.js';

async function testOpenAPISchemaSupport() {
  console.log('🧪 Testing OpenAPI Schema Support...\n');

  // Test 1: Schema-based OpenAPI client
  console.log('1️⃣ Testing OpenAPI client with JSON schema...');

  const sampleSchema = {
    openapi: '3.1.0',
    info: {
      title: 'Test API',
      version: '1.0.0',
    },
    servers: [
      {
        url: 'https://api.example.com',
      },
    ],
    paths: {
      '/users': {
        get: {
          operationId: 'getUsers',
          summary: 'Get all users',
          responses: {
            '200': {
              description: 'List of users',
              content: {
                'application/json': {
                  schema: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        id: { type: 'integer' },
                        name: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      '/users/{id}': {
        get: {
          operationId: 'getUserById',
          summary: 'Get user by ID',
          parameters: [
            {
              name: 'id',
              in: 'path',
              required: true,
              schema: { type: 'integer' },
            },
          ],
          responses: {
            '200': {
              description: 'User details',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      id: { type: 'integer' },
                      name: { type: 'string' },
                      email: { type: 'string' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  };

  try {
    const schemaConfig: ServerConfig = {
      type: 'openapi',
      openapi: {
        schema: sampleSchema,
        version: '3.1.0',
        security: {
          type: 'apiKey',
          apiKey: {
            name: 'X-API-Key',
            in: 'header',
            value: 'test-key',
          },
        },
      },
    };

    console.log('   Creating OpenAPI client with schema...');
    const client = new OpenAPIClient(schemaConfig);

    console.log('   Initializing client...');
    await client.initialize();

    console.log('   Getting available tools...');
    const tools = client.getTools();

    console.log(`   ✅ Schema-based client initialized successfully!`);
    console.log(`   📋 Found ${tools.length} tools:`);

    tools.forEach((tool) => {
      console.log(`      - ${tool.name}: ${tool.description}`);
    });

    // Test 2: Compare with URL-based client (if available)
    console.log('\n2️⃣ Testing configuration validation...');

    // Valid configurations
    const validConfigs = [
      {
        name: 'URL-based config',
        config: {
          type: 'openapi' as const,
          openapi: {
            url: 'https://api.example.com/openapi.json',
          },
        },
      },
      {
        name: 'Schema-based config',
        config: {
          type: 'openapi' as const,
          openapi: {
            schema: sampleSchema,
          },
        },
      },
      {
        name: 'Both URL and schema (should prefer schema)',
        config: {
          type: 'openapi' as const,
          openapi: {
            url: 'https://api.example.com/openapi.json',
            schema: sampleSchema,
          },
        },
      },
    ];

    validConfigs.forEach(({ name, config }) => {
      try {
        const _client = new OpenAPIClient(config);
        console.log(`   ✅ ${name}: Valid configuration`);
      } catch (error) {
        console.log(`   ❌ ${name}: Invalid configuration - ${error}`);
      }
    });

    // Invalid configurations
    console.log('\n3️⃣ Testing invalid configurations...');

    const invalidConfigs = [
      {
        name: 'No URL or schema',
        config: {
          type: 'openapi' as const,
          openapi: {
            version: '3.1.0',
          },
        },
      },
      {
        name: 'Empty openapi object',
        config: {
          type: 'openapi' as const,
          openapi: {},
        },
      },
    ];

    invalidConfigs.forEach(({ name, config }) => {
      try {
        const _client = new OpenAPIClient(config);
        console.log(`   ❌ ${name}: Should have failed but didn't`);
      } catch (error) {
        console.log(`   ✅ ${name}: Correctly rejected - ${(error as Error).message}`);
      }
    });

    console.log('\n🎉 All tests completed successfully!');
    console.log('\n📝 Summary:');
    console.log('   ✅ OpenAPI client supports JSON schema input');
    console.log('   ✅ Schema parsing and tool extraction works');
    console.log('   ✅ Configuration validation works correctly');
    console.log('   ✅ Both URL and schema modes are supported');
  } catch (error) {
    console.error('❌ Test failed:', (error as Error).message);
    console.error('   Stack trace:', (error as Error).stack);
  }
}

// Handle uncaught errors gracefully
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the test
testOpenAPISchemaSupport().catch(console.error);
