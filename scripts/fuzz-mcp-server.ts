/**
 * Boots MCPHub with the integration-test fixture (time-mcp upstream, bearer auth)
 * and prints a single JSON line with the streamable HTTP endpoint for mcp-fuzzer
 * once tools/list returns at least one tool. Keeps running until SIGINT/SIGTERM.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { TestServerHelper, delay } from '../tests/utils/testServerHelper.js';
import { createMockSettings } from '../tests/utils/mockSettings.js';

const FUZZ_GROUP = 'integration-test-group';
const FUZZ_BEARER = 'test-auth-token-123';
const TOOLS_PROBE_ATTEMPTS = 60;
const TOOLS_PROBE_DELAY_MS = 2000;

async function waitForTools(endpoint: string): Promise<number> {
  for (let attempt = 1; attempt <= TOOLS_PROBE_ATTEMPTS; attempt++) {
    const client = new Client(
      { name: 'fuzz-fixture-probe', version: '1.0.0' },
      { capabilities: { tools: {} } },
    );

    try {
      const transport = new StreamableHTTPClientTransport(new URL(endpoint), {
        requestInit: {
          headers: {
            Authorization: `Bearer ${FUZZ_BEARER}`,
          },
        },
      });
      await client.connect(transport, {});
      const { tools } = await client.listTools({});
      await client.close();

      if (tools.length > 0) {
        return tools.length;
      }
    } catch {
      // Upstream MCP servers may still be connecting.
    }

    if (attempt < TOOLS_PROBE_ATTEMPTS) {
      await delay(TOOLS_PROBE_DELAY_MS);
    }
  }

  throw new Error(
    `timed out waiting for tools/list to return at least one tool (${TOOLS_PROBE_ATTEMPTS} attempts)`,
  );
}

async function main(): Promise<void> {
  const helper = new TestServerHelper();
  const settings = createMockSettings({
    systemConfig: {
      routing: {
        enableGlobalRoute: true,
        enableGroupNameRoute: true,
        enableBearerAuth: true,
        bearerAuthKey: FUZZ_BEARER,
      },
      enableSessionRebuild: false,
    },
  });

  const { baseURL, port } = await helper.createTestServer(settings);
  const endpoint = `${baseURL}/mcp/${FUZZ_GROUP}`;
  const toolCount = await waitForTools(endpoint);

  process.stdout.write(
    JSON.stringify({
      endpoint,
      port,
      group: FUZZ_GROUP,
      toolCount,
      ready: true,
    }) + '\n',
  );

  const shutdown = async (): Promise<void> => {
    try {
      await helper.closeTestServer();
    } catch (error) {
      console.error('Error closing test server:', error);
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', () => {
    void shutdown();
  });
  process.on('SIGTERM', () => {
    void shutdown();
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
