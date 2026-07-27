import { serializeServersForSettings } from '../../src/utils/serverSettings.js';

describe('serializeServersForSettings', () => {
  it('keeps unique names as legacy-compatible keys', () => {
    expect(
      serializeServersForSettings([
        { id: 'server-id', name: 'fetch', command: 'npx', args: ['fetch-server'] },
      ]),
    ).toEqual({
      fetch: { command: 'npx', args: ['fetch-server'] },
    });
  });

  it('uses stable ids and explicit names when names are duplicated', () => {
    expect(
      serializeServersForSettings([
        { id: 'server-a', name: 'notion', url: 'https://a.example/mcp' },
        { id: 'server-b', name: 'notion', url: 'https://b.example/mcp' },
      ]),
    ).toEqual({
      'server-a': { name: 'notion', url: 'https://a.example/mcp' },
      'server-b': { name: 'notion', url: 'https://b.example/mcp' },
    });
  });
});
