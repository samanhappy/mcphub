import { normalizeServerConfigForPersistence } from '../../src/utils/serverConfigPersistence.js';

test('rejects personal OAuth on stdio and rejects server-level tokens in personal mode', () => {
  expect(() =>
    normalizeServerConfigForPersistence({
      type: 'stdio',
      command: 'node',
      oauth: { identityMode: 'personal' },
    } as any),
  ).toThrow(/personal OAuth/i);
  expect(() =>
    normalizeServerConfigForPersistence({
      type: 'streamable-http',
      url: 'https://gitlab.example/api/v4/mcp',
      oauth: { identityMode: 'personal', accessToken: 'shared-token' },
    } as any),
  ).toThrow(/personal OAuth/i);
});

test('preserves personal mode while existing shared configurations remain compatible', () => {
  expect(
    normalizeServerConfigForPersistence({
      type: 'streamable-http',
      url: 'https://gitlab.example/api/v4/mcp',
      oauth: { identityMode: 'personal', clientId: 'registered-client' },
    } as any).oauth,
  ).toMatchObject({ identityMode: 'personal' });
  expect(
    normalizeServerConfigForPersistence({
      type: 'streamable-http',
      url: 'https://gitlab.example/api/v4/mcp',
      oauth: { accessToken: 'shared' },
    }).oauth?.accessToken,
  ).toBe('shared');
});
