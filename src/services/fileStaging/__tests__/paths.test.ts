import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  assertNoSymlinkComponents,
  contentPath,
  digestFile,
  ensureDirectory,
  isValidOwnerHash,
  makeRef,
  parseRef,
  refDir,
} from '../paths.js';

const OWNER = 'a'.repeat(64);
const ID = '11111111-1111-4111-8111-111111111111';

describe('staging refs and paths', () => {
  it('accepts only the exact generated ref form', () => {
    expect(parseRef(makeRef(ID))).toBe(ID);
    expect(parseRef(` ${makeRef(ID)} `)).toBeUndefined();
    expect(parseRef(makeRef(ID).toUpperCase())).toBeUndefined();
    expect(parseRef('mcpfile://../../etc/passwd')).toBeUndefined();
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

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcphub-staging-paths-'));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('rejects a symlinked ancestor when creating a directory', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mcphub-outside-'));
    await fs.symlink(outside, path.join(root, 'link'));
    await expect(ensureDirectory(path.join(root, 'link', 'nested'))).rejects.toThrow(
      /symlinked/i,
    );
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('detects a symlinked per-ref directory', async () => {
    const dir = refDir(root, OWNER, ID);
    await ensureDirectory(path.dirname(dir));
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mcphub-outside-'));
    await fs.symlink(outside, dir);
    await expect(assertNoSymlinkComponents(root, dir)).rejects.toThrow(/symlinked/i);
    await fs.rm(outside, { recursive: true, force: true });
  });

  it('refuses a symlinked leaf and a hardlinked file', async () => {
    const dir = refDir(root, OWNER, ID);
    await ensureDirectory(dir);
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
});
