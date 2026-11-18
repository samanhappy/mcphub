import { normalizeImportedServers } from '../../frontend/src/utils/jsonImport';

describe('normalizeImportedServers', () => {
  it('preserves stdio timeout options during JSON import', () => {
    const { servers, issues } = normalizeImportedServers({
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

    expect(issues).toEqual([]);
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

describe('protocol negotiation JSON import', () => {
  it.each(['auto', 'legacy'] as const)('retains %s on Streamable HTTP imports', (mode) => {
    const result = normalizeImportedServers({
      mcpServers: {
        remote: {
          type: 'streamable-http',
          url: 'https://example.com/mcp',
          protocolNegotiation: mode,
        },
      },
    });
    expect(result.issues).toEqual([]);
    expect(result.servers[0].config.protocolNegotiation).toBe(mode);
  });
  it('reports auto on a legacy-only transport', () => {
    const result = normalizeImportedServers({
      mcpServers: {
        local: {
          type: 'stdio',
          command: 'node',
          protocolNegotiation: 'auto',
        },
      },
    });
    expect(result.servers).toEqual([]);
    expect(result.issues[0].message).toContain('streamable-http');
  });
});

describe('normalizeImportedServers tags (#1506)', () => {
  it('imports and normalizes server tags', () => {
    const { servers, issues } = normalizeImportedServers({
      mcpServers: {
        mongo: { command: 'npx', tags: [' db ', 'DB', 'test'] },
      },
    });

    expect(issues).toEqual([]);
    expect(servers[0].config.tags).toEqual(['db', 'test']);
  });

  it('reports tags longer than 64 characters instead of truncating them', () => {
    const longTag = 'x'.repeat(65);
    const { servers, issues } = normalizeImportedServers({
      mcpServers: {
        mongo: { command: 'npx', tags: ['db', longTag] },
      },
    });

    expect(servers).toEqual([]);
    expect(issues).toEqual([
      { name: 'mongo', message: `tag "${longTag}" is longer than 64 characters.` },
    ]);
  });

  it('reports tags that are not an array of strings', () => {
    const { servers, issues } = normalizeImportedServers({
      mcpServers: {
        mongo: { command: 'npx', tags: 'db' as unknown as string[] },
      },
    });

    expect(servers).toEqual([]);
    expect(issues).toEqual([{ name: 'mongo', message: '"tags" must be an array of strings.' }]);
  });
});
