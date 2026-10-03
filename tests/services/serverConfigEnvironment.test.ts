import {
  getServerEnvironment,
  expandServerConfig,
} from '../../src/services/serverConfigEnvironment.js';

jest.mock('../../src/dao/index.js', () => ({
  getUserDao: () => ({
    findByUsername: async (username: string) =>
      username === 'admin' ? { isAdmin: true } : username === 'member' ? { isAdmin: false } : null,
  }),
}));

describe('server configuration environment boundary', () => {
  const original = process.env;
  beforeEach(() => {
    process.env = { ...original, HUB_SECRET: 'synthetic-hub-secret' };
  });
  afterAll(() => {
    process.env = original;
  });

  it.each(['member', 'deleted-user'])('does not expose process secrets for %s', async (owner) => {
    const config = {
      owner,
      url: 'https://example.com/${HUB_SECRET}',
      env: { COPIED: '${HUB_SECRET}', OWN: 'user-value' },
      headers: { Leak: '${HUB_SECRET}', Indirect: '${COPIED}', Own: '${OWN}' },
    };
    const expanded = await expandServerConfig(config);
    const env = await getServerEnvironment(config);
    expect(JSON.stringify(expanded)).not.toContain('synthetic-hub-secret');
    expect(env.HUB_SECRET).toBeUndefined();
    expect(expanded.headers.Own).toBe('user-value');
  });

  it('preserves authorization fields as literal values', async () => {
    const config = {
      owner: '${ROLE}',
      visibility: 'group' as const,
      sharedWithUsers: ['${ROLE}'],
      env: { ROLE: 'admin', DOLLAR: '$' },
      headers: { Leak: '${DOLLAR}{HUB_SECRET}' },
    };
    const expanded = await expandServerConfig(config);
    expect(expanded.owner).toBe(config.owner);
    expect(expanded.visibility).toBe(config.visibility);
    expect(expanded.sharedWithUsers).toEqual(config.sharedWithUsers);
    expect((await getServerEnvironment(expanded)).HUB_SECRET).toBeUndefined();
  });

  it.each(['admin', undefined])('preserves trusted process expansion for %s', async (owner) => {
    expect(
      (await expandServerConfig({ owner, headers: { Secret: '${HUB_SECRET}' } })).headers.Secret,
    ).toBe('synthetic-hub-secret');
  });
  it('keeps resolved personal credential values literal', async () => {
    const env = await getServerEnvironment({
      owner: 'admin',
      credentialTemplate: [{ target: 'env', name: 'KEY' }],
      env: { KEY: 'literal-${HUB_SECRET}' },
    });
    expect(env.KEY).toBe('literal-${HUB_SECRET}');
  });
});
