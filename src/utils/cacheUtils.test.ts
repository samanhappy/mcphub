// Tests for the npx cache clear used by a server's Reinstall action.
// Regression coverage for the blast radius raised in review on #1161:
// clearRunnerCache('npx') removed the whole shared ~/.npm/_npx directory, so
// reinstalling one server discarded every other npx server's install too. On a
// fleet of ~90 npx servers that silently turns a warm cache cold, and the cost
// only shows up at the next restart.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { clearRunnerCache, getNpxCacheDir, resolveRunnerPackageVersion } from './cacheUtils.js';

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

    await clearRunnerCache('npx', ['-y', '@modelcontextprotocol/server-everything@1.0.0']);

    expect(exists('dddddddddddddddd')).toBe(false);
    expect(exists('eeeeeeeeeeeeeeee')).toBe(true);
  });

  it('stays a no-op for uvx, which refreshes through a flag instead', async () => {
    makeEntry('aaaaaaaaaaaaaaaa', ['cowsay']);

    await clearRunnerCache('uvx', ['cowsay']);

    expect(exists('aaaaaaaaaaaaaaaa')).toBe(true);
  });

  // The Reinstall loop (see #1166) needs to show the version that is actually
  // installed for npx/uvx servers. The same _npx entry metadata the cache clear
  // relies on also carries the resolved package version.
  describe('resolveRunnerPackageVersion', () => {
    const originalUvToolDir = process.env.UV_TOOL_DIR;
    const originalUvCacheDir = process.env.UV_CACHE_DIR;
    const originalXdgCacheHome = process.env.XDG_CACHE_HOME;
    const originalXdgDataHome = process.env.XDG_DATA_HOME;

    /** Write an _npx entry plus the installed package's own package.json. */
    const makeInstalledEntry = (
      hash: string,
      packages: string[],
      installedVersions: Record<string, string>,
    ): string => {
      const dir = makeEntry(hash, packages);
      for (const [pkg, version] of Object.entries(installedVersions)) {
        const pkgDir = path.join(dir, 'node_modules', pkg);
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(
          pkgDir + path.sep + 'package.json',
          JSON.stringify({ name: pkg, version }),
        );
      }
      return dir;
    };

    /** Legacy _npx entry (npm <= 10.9 writes no _npx block) plus installed version. */
    const makeInstalledLegacyEntry = (
      hash: string,
      dependencies: Record<string, string>,
      installedVersions: Record<string, string>,
    ): string => {
      const dir = makeLegacyEntry(hash, dependencies);
      for (const [pkg, version] of Object.entries(installedVersions)) {
        const pkgDir = path.join(dir, 'node_modules', pkg);
        fs.mkdirSync(pkgDir, { recursive: true });
        fs.writeFileSync(
          pkgDir + path.sep + 'package.json',
          JSON.stringify({ name: pkg, version }),
        );
      }
      return dir;
    };

    /** Write a python environment with a <pkg>-<version>.dist-info directory. */
    const makePythonEnv = (envRoot: string, pyVersion: string, distInfoName: string): string => {
      const sp = path.join(envRoot, 'lib', `python${pyVersion}`, 'site-packages');
      fs.mkdirSync(path.join(sp, distInfoName), { recursive: true });
      fs.writeFileSync(
        path.join(sp, distInfoName, 'METADATA'),
        'Metadata-Version: 2.1\nName: placeholder\nVersion: placeholder\n',
      );
      return envRoot;
    };

    beforeEach(() => {
      delete process.env.UV_TOOL_DIR;
      delete process.env.UV_CACHE_DIR;
      delete process.env.XDG_CACHE_HOME;
      delete process.env.XDG_DATA_HOME;
    });

    afterEach(() => {
      if (originalUvToolDir === undefined) delete process.env.UV_TOOL_DIR;
      else process.env.UV_TOOL_DIR = originalUvToolDir;
      if (originalUvCacheDir === undefined) delete process.env.UV_CACHE_DIR;
      else process.env.UV_CACHE_DIR = originalUvCacheDir;
      if (originalXdgCacheHome === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = originalXdgCacheHome;
      if (originalXdgDataHome === undefined) delete process.env.XDG_DATA_HOME;
      else process.env.XDG_DATA_HOME = originalXdgDataHome;
    });

    describe('npx', () => {
      it('resolves the installed version from the matching cache entry', async () => {
        makeInstalledEntry('aaaaaaaaaaaaaaaa', ['cowsay'], { cowsay: '6.1.0' });

        await expect(resolveRunnerPackageVersion('npx', ['-y', 'cowsay'])).resolves.toBe('6.1.0');
      });

      it('resolves a legacy npm entry that wrote no _npx metadata', async () => {
        makeInstalledLegacyEntry('dddddddddddddddd', { cowsay: '^1.5.0' }, { cowsay: '1.5.2' });

        await expect(resolveRunnerPackageVersion('npx', ['-y', 'cowsay'])).resolves.toBe('1.5.2');
      });

      it('resolves the version of a pinned spec', async () => {
        makeInstalledEntry('aaaaaaaaaaaaaaaa', ['cowsay@1.6.0'], { cowsay: '1.6.0' });

        await expect(resolveRunnerPackageVersion('npx', ['-y', 'cowsay@1.6.0'])).resolves.toBe(
          '1.6.0',
        );
      });

      it('resolves a scoped package version', async () => {
        makeInstalledEntry('aaaaaaaaaaaaaaaa', ['@modelcontextprotocol/server-filesystem'], {
          '@modelcontextprotocol/server-filesystem': '1.0.1',
        });

        await expect(
          resolveRunnerPackageVersion('npx', [
            '-y',
            '@modelcontextprotocol/server-filesystem',
            '/srv',
          ]),
        ).resolves.toBe('1.0.1');
      });

      it('prefers the most recently modified matching entry', async () => {
        makeInstalledEntry('aaaaaaaaaaaaaaaa', ['cowsay'], { cowsay: '1.5.0' });
        const fresh = makeInstalledEntry('bbbbbbbbbbbbbbbb', ['cowsay'], { cowsay: '6.1.0' });
        fs.utimesSync(fresh, new Date('2000-01-02'), new Date('2000-01-02'));
        fs.utimesSync(
          path.join(cacheDir, 'aaaaaaaaaaaaaaaa'),
          new Date('2000-01-01'),
          new Date('2000-01-01'),
        );

        await expect(resolveRunnerPackageVersion('npx', ['-y', 'cowsay'])).resolves.toBe('6.1.0');
      });

      it('returns undefined when no cache entry matches', async () => {
        makeInstalledEntry('aaaaaaaaaaaaaaaa', ['cowsay'], { cowsay: '6.1.0' });

        await expect(
          resolveRunnerPackageVersion('npx', ['-y', 'some-other-server']),
        ).resolves.toBeUndefined();
      });

      it('returns undefined when the package cannot be identified', async () => {
        makeInstalledEntry('aaaaaaaaaaaaaaaa', ['cowsay'], { cowsay: '6.1.0' });

        await expect(
          resolveRunnerPackageVersion('npx', ['-c', 'echo hi']),
        ).resolves.toBeUndefined();
      });

      it('returns undefined when the installed package.json is missing', async () => {
        makeEntry('cccccccccccccccc', ['cowsay']); // entry exists, but nothing installed

        await expect(resolveRunnerPackageVersion('npx', ['-y', 'cowsay'])).resolves.toBeUndefined();
      });

      it('returns undefined when the cache directory does not exist', async () => {
        fs.rmSync(cacheDir, { recursive: true, force: true });

        await expect(resolveRunnerPackageVersion('npx', ['-y', 'cowsay'])).resolves.toBeUndefined();
      });
    });

    describe('uvx', () => {
      it('resolves the version from a uv tool install environment', async () => {
        process.env.UV_TOOL_DIR = path.join(tmpRoot, 'tools');
        makePythonEnv(path.join(process.env.UV_TOOL_DIR, 'cowsay'), '3.12', 'cowsay-6.1.dist-info');

        await expect(resolveRunnerPackageVersion('uvx', ['cowsay'])).resolves.toBe('6.1');
      });

      it('normalizes a dashed package name against its dist-info directory', async () => {
        process.env.UV_CACHE_DIR = path.join(tmpRoot, 'cache', 'uv');
        makePythonEnv(
          path.join(process.env.UV_CACHE_DIR, 'environments-v2', 'pyhash', 'envhash'),
          '3.12',
          'mcp_server_fetch-0.1.0.dist-info',
        );

        await expect(
          resolveRunnerPackageVersion('uvx', [
            '--from',
            'mcp-server-fetch',
            'mcp-server-fetch',
            '--port',
            '9000',
          ]),
        ).resolves.toBe('0.1.0');
      });

      it('resolves the version from a uvx ephemeral cache environment', async () => {
        process.env.UV_CACHE_DIR = path.join(tmpRoot, 'cache', 'uv');
        makePythonEnv(
          path.join(process.env.UV_CACHE_DIR, 'environments-v2', 'pyhash', 'envhash'),
          '3.12',
          'cowsay-6.1.dist-info',
        );

        await expect(resolveRunnerPackageVersion('uvx', ['cowsay'])).resolves.toBe('6.1');
      });

      it('prefers the most recently modified uv environment', async () => {
        process.env.UV_CACHE_DIR = path.join(tmpRoot, 'cache', 'uv');
        const envsRoot = path.join(process.env.UV_CACHE_DIR, 'environments-v2', 'pyhash');
        makePythonEnv(path.join(envsRoot, 'old'), '3.12', 'cowsay-1.5.0.dist-info');
        makePythonEnv(path.join(envsRoot, 'new'), '3.12', 'cowsay-6.1.dist-info');
        fs.utimesSync(path.join(envsRoot, 'new'), new Date('2000-01-02'), new Date('2000-01-02'));
        fs.utimesSync(path.join(envsRoot, 'old'), new Date('2000-01-01'), new Date('2000-01-01'));

        await expect(resolveRunnerPackageVersion('uvx', ['cowsay'])).resolves.toBe('6.1');
      });

      it('follows an environments-v2 symlink into the archive', async () => {
        process.env.UV_CACHE_DIR = path.join(tmpRoot, 'cache', 'uv');
        const archive = makePythonEnv(
          path.join(process.env.UV_CACHE_DIR, 'archive-v0', 'somehash'),
          '3.12',
          'cowsay-6.1.dist-info',
        );
        const link = path.join(process.env.UV_CACHE_DIR, 'environments-v2', 'pyhash', 'envhash');
        fs.mkdirSync(path.dirname(link), { recursive: true });
        fs.symlinkSync(archive, link, 'dir');

        await expect(resolveRunnerPackageVersion('uvx', ['cowsay'])).resolves.toBe('6.1');
      });

      it('returns undefined when no uv environment holds the package', async () => {
        process.env.UV_CACHE_DIR = path.join(tmpRoot, 'cache', 'uv');
        makePythonEnv(
          path.join(process.env.UV_CACHE_DIR, 'environments-v2', 'pyhash', 'envhash'),
          '3.12',
          'some-other-server-2.0.0.dist-info',
        );

        await expect(resolveRunnerPackageVersion('uvx', ['cowsay'])).resolves.toBeUndefined();
      });

      it('returns undefined when the cache directory does not exist', async () => {
        process.env.UV_CACHE_DIR = path.join(tmpRoot, 'cache', 'uv');

        await expect(resolveRunnerPackageVersion('uvx', ['cowsay'])).resolves.toBeUndefined();
      });
    });

    it('returns undefined for unsupported commands', async () => {
      makeInstalledEntry('aaaaaaaaaaaaaaaa', ['cowsay'], { cowsay: '6.1.0' });

      await expect(resolveRunnerPackageVersion('node', ['server.js'])).resolves.toBeUndefined();
    });
  });
});
