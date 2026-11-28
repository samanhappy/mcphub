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

describe('normalizeImportedServers metadata links (#1495)', () => {
  it('imports trimmed repository and documentation links', () => {
    const { servers, issues } = normalizeImportedServers({
      mcpServers: {
        mongo: {
          command: 'npx',
          repositoryUrl: '  https://github.com/owner/repo ',
          documentationUrl: 'https://docs.example.com',
        },
      },
    });

    expect(issues).toEqual([]);
    expect(servers[0].config.repositoryUrl).toBe('https://github.com/owner/repo');
    expect(servers[0].config.documentationUrl).toBe('https://docs.example.com');
  });

  it('reports non-string links and drops them from the import', () => {
    const { servers, issues } = normalizeImportedServers({
      mcpServers: { mongo: { command: 'npx', repositoryUrl: 42 as unknown as string } },
    });

    expect(issues).toEqual([
      { name: 'mongo', message: '"repositoryUrl" must be a string URL.' },
    ]);
    expect(servers[0].config.repositoryUrl).toBeUndefined();
  });

  it('omits blank links instead of storing empty strings', () => {
    const { servers } = normalizeImportedServers({
      mcpServers: { mongo: { command: 'npx', documentationUrl: '   ' } },
    });

    expect(servers[0].config).not.toHaveProperty('documentationUrl');
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
