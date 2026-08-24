// Tests for the process-lister availability probe used by stdio cleanup.
// Regression coverage for issue #1072: slim Docker images without procps
// made tree-kill's internal `ps` spawn fail with an unhandled 'error' event,
// crashing MCPHub via the global uncaughtException handler.

import fs from 'fs';
import path from 'path';
import { isProcessTreeKillAvailable, resetProcessTreeKillCache } from './processTree.js';

const setPlatform = (platform: NodeJS.Platform): void => {
  Object.defineProperty(process, 'platform', { value: platform });
};

describe('isProcessTreeKillAvailable', () => {
  const originalPlatform = process.platform;
  const originalPath = process.env.PATH;

  afterEach(() => {
    setPlatform(originalPlatform);
    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }
    jest.restoreAllMocks();
    resetProcessTreeKillCache();
  });

  it('is always true on win32 (tree-kill uses taskkill)', () => {
    setPlatform('win32');
    expect(isProcessTreeKillAvailable()).toBe(true);
  });

  it('is always true on darwin (tree-kill uses pgrep)', () => {
    setPlatform('darwin');
    expect(isProcessTreeKillAvailable()).toBe(true);
  });

  it('detects ps on a custom PATH entry on Linux', () => {
    setPlatform('linux');
    process.env.PATH = '/custom/bin';
    jest
      .spyOn(fs, 'accessSync')
      .mockImplementation(((candidate: fs.PathLike) => {
        if (String(candidate) === path.join('/custom/bin', 'ps')) return undefined;
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }) as typeof fs.accessSync);
    expect(isProcessTreeKillAvailable()).toBe(true);
  });

  it('detects ps at well-known absolute paths even with an empty PATH', () => {
    setPlatform('linux');
    process.env.PATH = '';
    jest
      .spyOn(fs, 'accessSync')
      .mockImplementation(((candidate: fs.PathLike) => {
        if (String(candidate) === '/usr/bin/ps') return undefined;
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }) as typeof fs.accessSync);
    expect(isProcessTreeKillAvailable()).toBe(true);
  });

  it('returns false when no ps executable exists anywhere', () => {
    setPlatform('linux');
    process.env.PATH = '';
    jest.spyOn(fs, 'accessSync').mockImplementation((() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }) as typeof fs.accessSync);
    expect(isProcessTreeKillAvailable()).toBe(false);
  });

  it('caches the result until reset', () => {
    setPlatform('linux');
    process.env.PATH = '';
    const accessSync = jest
      .spyOn(fs, 'accessSync')
      .mockImplementation((() => {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }) as typeof fs.accessSync);

    expect(isProcessTreeKillAvailable()).toBe(false);

    // ps appears afterwards — cached result must stay false until reset.
    accessSync.mockImplementation(((candidate: fs.PathLike) => {
      if (String(candidate) === '/bin/ps') return undefined;
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    }) as typeof fs.accessSync);
    expect(isProcessTreeKillAvailable()).toBe(false);

    resetProcessTreeKillCache();
    expect(isProcessTreeKillAvailable()).toBe(true);
  });
});
