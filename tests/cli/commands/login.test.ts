import * as login from '../../../src/cli/commands/login.js';
import { ApiClient } from '../../../src/cli/http.js';
import { Credentials } from '../../../src/cli/profile.js';

function fakeClient(response: unknown): ApiClient {
  const fetchImpl = (async () =>
    ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify(response),
    } as unknown as Response)) as unknown as typeof fetch;
  return new ApiClient({ baseUrl: 'http://hub.test', fetchImpl });
}

function fakeDeps(initial: Credentials, opts: { response?: unknown; prompts?: any } = {}) {
  const state: { saved?: Credentials } = {};
  const deps: login.LoginDeps = {
    loadCreds: () => initial,
    saveCreds: (c) => {
      state.saved = c;
    },
    createClient: () => fakeClient(opts.response ?? {
      success: true,
      token: 'fresh-jwt',
      user: { username: 'admin', isAdmin: true },
    }),
    prompts: opts.prompts ?? {
      line: async () => '',
      password: async () => 'unused',
    },
  };
  return { deps, state };
}

describe('login command', () => {
  it('logs in with --url --username --password, saves a JWT profile', async () => {
    const { deps, state } = fakeDeps({ current: '', profiles: {} });
    await login.run(
      ['--url', 'http://hub.test', '--username', 'admin', '--password', 'admin123'],
      {},
      deps,
    );
    expect(state.saved?.profiles.default).toMatchObject({
      url: 'http://hub.test',
      tokenKind: 'jwt',
      token: 'fresh-jwt',
      username: 'admin',
    });
    expect(state.saved?.current).toBe('default');
  });

  it('saves under a named profile when --profile is provided via globals', async () => {
    const { deps, state } = fakeDeps({ current: '', profiles: {} });
    await login.run(
      ['--url', 'http://hub.test', '--username', 'admin', '--password', 'admin123'],
      { profile: 'staging' },
      deps,
    );
    expect(state.saved?.profiles.staging).toBeDefined();
    expect(state.saved?.current).toBe('staging');
  });

  it('throws when password is missing and prompt returns empty', async () => {
    const { deps } = fakeDeps(
      { current: '', profiles: {} },
      {
        prompts: { line: async () => '', password: async () => '' },
      },
    );
    await expect(
      login.run(['--url', 'http://hub.test', '--username', 'admin'], {}, deps),
    ).rejects.toThrow(/Password is required/);
  });

  it('logout clears the token but keeps url and username', async () => {
    const initial: Credentials = {
      current: 'default',
      profiles: {
        default: {
          url: 'http://hub.test',
          tokenKind: 'jwt',
          token: 'old',
          username: 'admin',
        },
      },
    };
    const { deps, state } = fakeDeps(initial);
    await login.logout([], {}, deps);
    expect(state.saved?.profiles.default.token).toBeUndefined();
    expect(state.saved?.profiles.default.url).toBe('http://hub.test');
    expect(state.saved?.profiles.default.username).toBe('admin');
  });
});
