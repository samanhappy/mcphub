/**
 * Boots MCPHub with the integration-test fixture (time-mcp upstream, bearer auth)
 * and prints a single JSON line with the streamable HTTP endpoint for mcp-fuzzer.
 * Keeps running until SIGINT/SIGTERM.
 */
import { TestServerHelper } from '../tests/utils/testServerHelper.js';
import { createMockSettings } from '../tests/utils/mockSettings.js';

const FUZZ_GROUP = 'integration-test-group';
const FUZZ_BEARER = 'test-auth-token-123';

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

  process.stdout.write(
    JSON.stringify({
      endpoint,
      port,
      group: FUZZ_GROUP,
    }) + '\n',
  );

  const shutdown = async (): Promise<void> => {
    await helper.closeTestServer();
    process.exit(0);
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
