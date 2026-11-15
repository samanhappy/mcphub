import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  assertNoSymlinkComponents,
  contentPath,
  digestFile,
  ensureDirectory,
  isValidOwnerHash,
  isValidRefId,
  makeRef,
  openNoFollow,
  parseRef,
  refDir,
} from '../paths.js';

// paths.ts reads fsConstants.O_NOFOLLOW, so the whole module is mocked to let
// one test simulate a platform without it (Windows).
jest.mock('node:fs', () => {
  const actual = jest.requireActual<typeof import('node:fs')>('node:fs');
  return { ...actual, constants: { ...actual.constants }, __esModule: true };
});

const OWNER = 'a'.repeat(64);
const ID = '11111111-1111-4111-8111-111111111111';

describe('staging refs and paths', () => {
  it('accepts only the exact generated ref form', () => {
    expect(parseRef(makeRef(ID))).toBe(ID);
    expect(parseRef('mcpfile://../../etc/passwd')).toBeUndefined();
    expect(parseRef(`mcpfile://${ID}x`)).toBeUndefined();
    expect(parseRef(ID)).toBeUndefined();
  });

  it('does not trim or normalise', () => {
    expect(parseRef(` ${makeRef(ID)} `)).toBeUndefined();
    expect(parseRef(`\t${makeRef(ID)}\n`)).toBeUndefined();
    expect(parseRef(` ${makeRef(ID)}`)).toBeUndefined();
    expect(parseRef(makeRef(ID).toUpperCase())).toBeUndefined();
    expect(parseRef(`MCPFILE://${ID}`)).toBeUndefined();
  });

  it('accepts only v4 uuids', () => {
    // Same shape, version nibble 1: a v1 ref must not parse.
    const v1 = '11111111-1111-1111-8111-111111111111';
    expect(isValidRefId(v1)).toBe(false);
    expect(parseRef(makeRef(v1))).toBeUndefined();
    const v5 = '11111111-1111-5111-8111-111111111111';
    expect(isValidRefId(v5)).toBe(false);
    const v4 = '11111111-1111-4111-8111-111111111111';
    expect(isValidRefId(v4)).toBe(true);
  });

  it('refuses path components that are not a sha256 owner or a uuid', () => {
    expect(isValidOwnerHash(OWNER)).toBe(true);
    expect(isValidOwnerHash('..')).toBe(false);
    expect(() => refDir('/srv/staging', '..', ID)).toThrow();
    expect(() => refDir('/srv/staging', OWNER, '../../..')).toThrow();
    expect(refDir('/srv/staging', OWNER, ID)).toBe(
      path.join('/srv/staging', OWNER, ID),
    );
  });

  it('keeps every derived path inside the staging root', () => {
    const resolved = contentPath('/srv/staging', OWNER, ID);
    expect(path.relative('/srv/staging', resolved).startsWith('..')).toBe(false);
  });
});

describe('filesystem guards', () => {
  let root: string;
  // ensureDirectory takes the staging root explicitly so these tests do not
  // depend on the hub cwd.
  let stagingRoot: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcphub-staging-paths-'));
    stagingRoot = path.join(root, 'staging');
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('rejects a symlinked ancestor below the staging root when creating a directory', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mcphub-outside-'));
    await ensureDirectory(stagingRoot, 0o700, stagingRoot);
    await fs.symlink(outside, path.join(stagingRoot, 'link'));
    await expect(
      ensureDirectory(path.join(stagingRoot, 'link', 'nested'), 0o700, stagingRoot),
    ).rejects.toThrow(/symlinked/i);
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('creates the staging root under a symlinked ancestor', async () => {
    // macOS `/tmp` -> `/private/tmp` and any deployment whose staging root is
    // reached through a symlink: the ancestor is deployment configuration.
    const real = path.join(root, 'real');
    await fs.mkdir(real);
    await fs.symlink(real, path.join(root, 'link'));
    const target = path.join(root, 'link', 'staging', OWNER, ID);
    await ensureDirectory(target, 0o700, path.join(root, 'link', 'staging'));
    expect((await fs.lstat(target)).isDirectory()).toBe(true);
    // Written through the symlink, as the root itself resolves there.
    expect((await fs.lstat(path.join(real, 'staging', OWNER, ID))).isDirectory()).toBe(true);
  });

  it('still rejects a symlink below the resolved ancestor', async () => {
    const real = path.join(root, 'real');
    await fs.mkdir(real);
    await fs.symlink(real, path.join(root, 'link'));
    const linkRoot = path.join(root, 'link', 'staging');
    await ensureDirectory(linkRoot, 0o700, linkRoot);
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mcphub-outside-'));
    await fs.symlink(outside, path.join(linkRoot, OWNER));
    await expect(ensureDirectory(path.join(linkRoot, OWNER, ID), 0o700, linkRoot)).rejects.toThrow(
      /symlinked/i,
    );
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('accepts an existing directory', async () => {
    await ensureDirectory(path.dirname(refDir(stagingRoot, OWNER, ID)), 0o700, stagingRoot);
    await expect(
      ensureDirectory(path.dirname(refDir(stagingRoot, OWNER, ID)), 0o700, stagingRoot),
    ).resolves.toBeUndefined();
  });

  it('detects a symlinked per-ref directory', async () => {
    const dir = refDir(root, OWNER, ID);
    await ensureDirectory(path.dirname(dir), 0o700, root);
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mcphub-outside-'));
    await fs.symlink(outside, dir);
    await expect(assertNoSymlinkComponents(root, dir)).rejects.toThrow(/symlinked/i);
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('refuses a symlinked leaf and a hardlinked file', async () => {
    const dir = refDir(root, OWNER, ID);
    await ensureDirectory(dir, 0o700, root);
    const target = path.join(dir, 'target');
    await fs.writeFile(target, 'data');
    const leaf = path.join(dir, 'content');
    await fs.symlink(target, leaf);
    await expect(digestFile(leaf)).rejects.toThrow();

    await fs.rm(leaf);
    await fs.writeFile(leaf, 'data');
    await fs.link(leaf, path.join(dir, 'second'));
    await expect(digestFile(leaf)).rejects.toThrow(/hard link/i);
  });

  it('fails closed when the platform has no O_NOFOLLOW', async () => {
    const dir = refDir(root, OWNER, ID);
    await ensureDirectory(dir, 0o700, root);
    const file = path.join(dir, 'content');
    await fs.writeFile(file, 'data');
    // Windows has no O_NOFOLLOW; a plain open there would follow the link.
    const fsModule = jest.requireMock('node:fs') as { constants: Record<string, number | undefined> };
    const original = fsModule.constants.O_NOFOLLOW;
    fsModule.constants.O_NOFOLLOW = undefined;
    try {
      await expect(openNoFollow(file, fsConstants.O_RDONLY)).rejects.toMatchObject({
        code: 'unsupported',
      });
    } finally {
      fsModule.constants.O_NOFOLLOW = original;
    }
    await expect(openNoFollow(file, fsConstants.O_RDONLY)).resolves.toBeDefined();
  });
});
