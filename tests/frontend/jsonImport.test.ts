import { normalizeImportedServers } from '../../frontend/src/utils/jsonImport';

describe('normalizeImportedServers', () => {
  it('preserves stdio timeout options during JSON import', () => {
    const servers = normalizeImportedServers({
      mcpServers: {
        'my-server': {
          command: 'npx',
          args: ['-y', 'some-mcp-server'],
          options: {
            timeout: 120000,
            resetTimeoutOnProgress: true,
            maxTotalTimeout: 240000,
          },
        },
      },
    });

    expect(servers).toEqual([
      {
        name: 'my-server',
        config: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', 'some-mcp-server'],
          options: {
            timeout: 120000,
            resetTimeoutOnProgress: true,
            maxTotalTimeout: 240000,
          },
        },
      },
    ]);
  });
});
