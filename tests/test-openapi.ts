// Test script to verify OpenAPI server functionality
// Run this in the MCPHub project directory with: tsx test-openapi.ts

import { OpenAPIClient } from './src/clients/openapi.js';
import type { ServerConfig } from './src/types/index.js';

async function testOpenAPIClient() {
  console.log('Testing OpenAPI client...');

  // Test configuration
  const testConfig: ServerConfig = {
    type: 'openapi',
    openapi: {
      url: 'https://petstore3.swagger.io/api/v3/openapi.json', // Public Swagger Petstore API
      version: '3.1.0',
      security: {
        type: 'none',
      },
    },
    headers: {
      'Content-Type': 'application/json',
    },
  };

  try {
    // Initialize the OpenAPI client
    const client = new OpenAPIClient(testConfig);
    await client.initialize();

    console.log('✅ OpenAPI client initialized successfully');

    // Get available tools
    const tools = client.getTools();
    console.log(`✅ Found ${tools.length} tools:`);

    tools.slice(0, 5).forEach((tool) => {
      console.log(`  - ${tool.name}: ${tool.description}`);
    });

    // Test a simple GET operation if available
    const getTool = tools.find(
      (tool) => tool.method === 'get' && tool.path.includes('/pet') && !tool.path.includes('{'),
    );

    if (getTool) {
      console.log(`\n🔧 Testing tool: ${getTool.name}`);
      try {
        const result = await client.callTool(getTool.name, {});
        console.log('✅ Tool call successful');
        console.log('Result type:', typeof result);
      } catch (error) {
        console.log('⚠️ Tool call failed (expected for demo API):', (error as Error).message);
      }
    }

    console.log('\n🎉 OpenAPI integration test completed!');
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// Run the test
testOpenAPIClient().catch(console.error);
