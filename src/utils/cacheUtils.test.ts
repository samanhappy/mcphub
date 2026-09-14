// Tests for the npx cache clear used by a server's Reinstall action.
// Regression coverage for the blast radius raised in review on #1161:
// clearRunnerCache('npx') removed the whole shared ~/.npm/_npx directory, so
// reinstalling one server discarded every other npx server's install too. On a
// fleet of ~90 npx servers that silently turns a warm cache cold, and the cost
// only shows up at the next restart.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { clearRunnerCache, getNpxCacheDir } from './cacheUtils.js';

describe('clearRunnerCache for npx', () => {
  let tmpRoot: string;
  let cacheDir: string;
  const originalAppData = process.env.APPDATA;

  /** Write the metadata npm itself leaves in each _npx entry. */
  const makeEntry = (hash: string, packages: string[]): string => {
    const dir = path.join(cacheDir, hash);
    fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({ dependencies: {}, _npx: { packages } }),
    );
    return dir;
  };

  /**
   * npm 10.9 - the version the Docker image ships through NodeSource Node 22 -
   * writes no `_npx` block at all, only `dependencies` keyed by package name.
   */
  const makeLegacyEntry = (hash: string, dependencies: Record<string, string>): string => {
    const dir = path.join(cacheDir, hash);
    fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies }));
    return dir;
  };

  const exists = (hash: string): boolean => fs.existsSync(path.join(cacheDir, hash));

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-npx-cache-'));
    // getNpxCacheDir() reads homedir on posix and APPDATA on win32; redirect both.
    jest.spyOn(os, 'homedir').mockReturnValue(tmpRoot);
    process.env.APPDATA = tmpRoot;
    cacheDir = getNpxCacheDir();
    fs.mkdirSync(cacheDir, { recursive: true });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = originalAppData;
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('removes only the entry that installed the target package', async () => {
    makeEntry('aaaaaaaaaaaaaaaa', ['@modelcontextprotocol/server-filesystem']);
    makeEntry('bbbbbbbbbbbbbbbb', ['cowsay']);

    await clearRunnerCache('npx', ['-y', '@modelcontextprotocol/server-filesystem', '/srv']);

    expect(exists('aaaaaaaaaaaaaaaa')).toBe(false);
    expect(exists('bbbbbbbbbbbbbbbb')).toBe(true);
  });

  it('matches the package named by an explicit -p flag, not the command after it', async () => {
    makeEntry('aaaaaaaaaaaaaaaa', ['tsx']);
    makeEntry('bbbbbbbbbbbbbbbb', ['some-server']);

    await clearRunnerCache('npx', ['-y', '-p', 'tsx', '-c', 'some-server --port 1']);

    expect(exists('aaaaaaaaaaaaaaaa')).toBe(false);
    expect(exists('bbbbbbbbbbbbbbbb')).toBe(true);
  });

  it('distinguishes a pinned spec from an unpinned one', async () => {
    makeEntry('aaaaaaaaaaaaaaaa', ['cowsay']);
    makeEntry('bbbbbbbbbbbbbbbb', ['cowsay@1.6.0']);

    await clearRunnerCache('npx', ['-y', 'cowsay@1.6.0']);

    expect(exists('aaaaaaaaaaaaaaaa')).toBe(true);
    expect(exists('bbbbbbbbbbbbbbbb')).toBe(false);
  });

  it('removes nothing when the package cannot be identified', async () => {
    makeEntry('aaaaaaaaaaaaaaaa', ['cowsay']);

    await clearRunnerCache('npx', ['-c', 'echo hi']);

    expect(exists('aaaaaaaaaaaaaaaa')).toBe(true);
  });

  it('leaves an entry whose metadata cannot be read', async () => {
    const dir = path.join(cacheDir, 'cccccccccccccccc');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), 'not json');

    await clearRunnerCache('npx', ['-y', 'cowsay']);

    expect(exists('cccccccccccccccc')).toBe(true);
  });

  it('does not throw when the cache directory does not exist', async () => {
    fs.rmSync(cacheDir, { recursive: true, force: true });

    await expect(clearRunnerCache('npx', ['-y', 'cowsay'])).resolves.toBeUndefined();
  });

  it('matches on the dependency name when npm wrote no _npx metadata', async () => {
    makeLegacyEntry('dddddddddddddddd', { cowsay: '^1.6.0' });
    makeLegacyEntry('eeeeeeeeeeeeeeee', { 'some-other-server': '^2.0.0' });

    await clearRunnerCache('npx', ['-y', 'cowsay']);

    expect(exists('dddddddddddddddd')).toBe(false);
    expect(exists('eeeeeeeeeeeeeeee')).toBe(true);
  });

  it('matches a pinned spec against the dependency name on legacy npm', async () => {
    makeLegacyEntry('dddddddddddddddd', { cowsay: '^1.5.0' });
    makeLegacyEntry('eeeeeeeeeeeeeeee', { 'some-other-server': '^2.0.0' });

    await clearRunnerCache('npx', ['-y', 'cowsay@1.5.0']);

    expect(exists('dddddddddddddddd')).toBe(false);
    expect(exists('eeeeeeeeeeeeeeee')).toBe(true);
  });

  it('keeps a scoped package name intact when stripping the version', async () => {
    makeLegacyEntry('dddddddddddddddd', { '@modelcontextprotocol/server-everything': '^1.0.0' });
    makeLegacyEntry('eeeeeeeeeeeeeeee', { '@modelcontextprotocol/server-filesystem': '^1.0.0' });

    await clearRunnerCache('npx', [
      '-y',
      '@modelcontextprotocol/server-everything@1.0.0',
    ]);

    expect(exists('dddddddddddddddd')).toBe(false);
    expect(exists('eeeeeeeeeeeeeeee')).toBe(true);
  });

  it('stays a no-op for uvx, which refreshes through a flag instead', async () => {
    makeEntry('aaaaaaaaaaaaaaaa', ['cowsay']);

    await clearRunnerCache('uvx', ['cowsay']);

    expect(exists('aaaaaaaaaaaaaaaa')).toBe(true);
  });
});
