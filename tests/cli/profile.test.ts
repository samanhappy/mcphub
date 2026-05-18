import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  configPath,
  credentialsPath,
  deleteProfile,
  getProfile,
  loadCredentials,
  saveCredentials,
  setCurrentProfile,
  setProfile,
} from '../../src/cli/profile.js';

describe('profile / credentials', () => {
  let tmpRoot: string;
  let originalXdgData: string | undefined;
  let originalXdgConfig: string | undefined;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-cli-'));
    originalXdgData = process.env.XDG_DATA_HOME;
    originalXdgConfig = process.env.XDG_CONFIG_HOME;
    originalHome = process.env.HOME;
    process.env.XDG_DATA_HOME = path.join(tmpRoot, 'data');
    process.env.XDG_CONFIG_HOME = path.join(tmpRoot, 'config');
    // Point HOME away from the real one so the legacy ~/.mcphub fallback
    // can't accidentally pick up the developer's real credentials.
    process.env.HOME = tmpRoot;
  });

  afterEach(() => {
    process.env.XDG_DATA_HOME = originalXdgData;
    process.env.XDG_CONFIG_HOME = originalXdgConfig;
    process.env.HOME = originalHome;
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns empty credentials when no file exists', () => {
    const creds = loadCredentials();
    expect(creds).toEqual({ current: '', profiles: {} });
  });

  it('resolves XDG paths via env vars', () => {
    expect(credentialsPath()).toBe(path.join(tmpRoot, 'data', 'mcphub', 'credentials.json'));
    expect(configPath()).toBe(path.join(tmpRoot, 'config', 'mcphub', 'config.json'));
  });

  it('prefers legacy ~/.mcphub/credentials.json when it already exists', () => {
    const legacy = path.join(tmpRoot, '.mcphub');
    fs.mkdirSync(legacy, { recursive: true });
    const legacyFile = path.join(legacy, 'credentials.json');
    fs.writeFileSync(legacyFile, JSON.stringify({ current: 'legacy', profiles: {} }));
    expect(credentialsPath()).toBe(legacyFile);
  });

  it('saves and reloads credentials with 0600 permissions on POSIX', () => {
    const before = loadCredentials();
    const next = setProfile(before, 'default', {
      url: 'http://hub.test',
      tokenKind: 'jwt',
      token: 'abc',
      username: 'admin',
    });
    saveCredentials(next);

    const reloaded = loadCredentials();
    expect(reloaded.current).toBe('default');
    expect(reloaded.profiles.default.token).toBe('abc');
    expect(reloaded.profiles.default.savedAt).toBeDefined();

    if (process.platform !== 'win32') {
      const stat = fs.statSync(credentialsPath());
      expect((stat.mode & 0o777).toString(8)).toBe('600');
    }
  });

  it('setProfile keeps existing current; first profile becomes current automatically', () => {
    const empty = loadCredentials();
    const a = setProfile(empty, 'a', { url: 'http://a' });
    expect(a.current).toBe('a');
    const b = setProfile(a, 'b', { url: 'http://b' });
    expect(b.current).toBe('a');
  });

  it('setCurrentProfile throws when target does not exist', () => {
    expect(() => setCurrentProfile({ current: '', profiles: {} }, 'nope')).toThrow();
  });

  it('deleteProfile removes the profile and falls back current pointer', () => {
    let creds = loadCredentials();
    creds = setProfile(creds, 'a', { url: 'http://a' });
    creds = setProfile(creds, 'b', { url: 'http://b' });
    expect(creds.current).toBe('a');

    creds = deleteProfile(creds, 'a');
    expect(creds.profiles.a).toBeUndefined();
    expect(creds.current).toBe('b');
  });

  it('getProfile honors --profile override over current', () => {
    let creds = loadCredentials();
    creds = setProfile(creds, 'a', { url: 'http://a' });
    creds = setProfile(creds, 'b', { url: 'http://b' });
    expect(getProfile(creds)?.url).toBe('http://a');
    expect(getProfile(creds, 'b')?.url).toBe('http://b');
    expect(getProfile(creds, 'missing')).toBeUndefined();
  });

  it('saveCredentials performs an atomic rename', () => {
    const credsA = setProfile(loadCredentials(), 'a', { url: 'http://a' });
    saveCredentials(credsA);
    const dir = path.dirname(credentialsPath());
    const stragglers = fs.readdirSync(dir).filter((f) => f.startsWith('credentials.json.tmp.'));
    expect(stragglers).toEqual([]);
  });
});
