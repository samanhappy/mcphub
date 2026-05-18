import * as config from '../../../src/cli/commands/config.js';
import { Credentials } from '../../../src/cli/profile.js';

function makeDeps(initial: Credentials) {
  const state: { saved?: Credentials } = {};
  return {
    deps: {
      loadCreds: () => initial,
      saveCreds: (c: Credentials) => {
        state.saved = c;
      },
    },
    state,
  };
}

const initial: Credentials = {
  current: 'default',
  profiles: {
    default: { url: 'http://hub.test', tokenKind: 'jwt', token: 'tok-1234', username: 'admin' },
    staging: { url: 'http://staging.hub', tokenKind: 'bearer', token: 'tok-5678' },
  },
};

describe('config command', () => {
  it('config use switches the current profile', async () => {
    const { deps, state } = makeDeps(initial);
    await config.run(['use', 'staging'], {}, deps);
    expect(state.saved?.current).toBe('staging');
  });

  it('config set-url updates the targeted profile', async () => {
    const { deps, state } = makeDeps(initial);
    await config.run(['set-url', 'https://new.hub'], { profile: 'staging' }, deps);
    expect(state.saved?.profiles.staging.url).toBe('https://new.hub');
    // Token preserved
    expect(state.saved?.profiles.staging.token).toBe('tok-5678');
  });

  it('config set-token with --bearer flips tokenKind', async () => {
    const { deps, state } = makeDeps(initial);
    await config.run(['set-token', 'new-bearer', '--bearer'], {}, deps);
    expect(state.saved?.profiles.default.token).toBe('new-bearer');
    expect(state.saved?.profiles.default.tokenKind).toBe('bearer');
  });

  it('config remove deletes the profile and fixes current pointer', async () => {
    const { deps, state } = makeDeps(initial);
    await config.run(['remove', 'default'], {}, deps);
    expect(state.saved?.profiles.default).toBeUndefined();
    expect(state.saved?.current).toBe('staging');
  });

  it('unknown subcommand throws CliUsageError', async () => {
    const { deps } = makeDeps(initial);
    await expect(config.run(['bogus'], {}, deps)).rejects.toThrow(/Unknown config subcommand/);
  });
});
