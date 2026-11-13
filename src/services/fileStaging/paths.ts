import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Ref ids are UUIDs; anything else never touches the filesystem. */
export const isValidRefId = (id: string): boolean => UUID_RE.test(id);

export const parseRef = (ref: unknown): string | undefined => {
  if (typeof ref !== 'string') return undefined;
  const match = /^mcpfile:\/\/([0-9a-fA-F-]{36})$/.exec(ref.trim());
  return match && isValidRefId(match[1]) ? match[1].toLowerCase() : undefined;
};

export const makeRef = (id: string): string => `mcpfile://${id}`;

/** Storage root: under the hub cwd so the trusted SSH server's local-root check applies. */
export const getStagingRoot = (): string =>
  path.resolve(process.env.MCPHUB_STAGING_ROOT ?? path.join(process.cwd(), 'data', 'uploads', 'staging'));

/** Authoritative ledger lives outside the tool-writable staging root. */
export const getStagingStateDir = (): string =>
  path.resolve(process.env.MCPHUB_STAGING_STATE_DIR ?? path.join(process.cwd(), 'data', 'staging-state'));

export const principalDir = (root: string, ownerHash: string): string =>
  path.join(root, ownerHash);

export const refDir = (root: string, ownerHash: string, id: string): string =>
  path.join(root, ownerHash, id);

export const contentPath = (root: string, ownerHash: string, id: string): string =>
  path.join(refDir(root, ownerHash, id), 'content');

export const metaPath = (root: string, ownerHash: string, id: string): string =>
  path.join(refDir(root, ownerHash, id), 'meta.json');

/**
 * Create a directory (0700) after checking that no existing component is a
 * symlink. `mkdir` itself never follows a symlink for the final component, but
 * a symlinked ancestor would silently relocate the whole tree.
 */
export const ensureDirectory = async (dir: string, mode = 0o700): Promise<void> => {
  const resolved = path.resolve(dir);
  const parts = resolved.split(path.sep);
  let current = parts[0] === '' ? path.sep : parts[0];
  for (let i = 1; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) {
        throw new Error(`Refusing to use symlinked directory component: ${current}`);
      }
      if (!stat.isDirectory()) {
        throw new Error(`Path component is not a directory: ${current}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      await fs.mkdir(current, { mode });
    }
  }
};

/** Open a staged file without following a symlink at the leaf. */
export const openNoFollow = async (file: string, flags: number): Promise<fs.FileHandle> =>
  fs.open(file, flags | fsConstants.O_NOFOLLOW);

export interface FileDigest {
  size: number;
  sha256: string;
}

/**
 * Hash a staged file while checking it is a regular, single-link file. Used at
 * finalize and before a download; the caller must already have verified the
 * parent components.
 */
export const digestFile = async (file: string): Promise<FileDigest> => {
  const handle = await openNoFollow(file, fsConstants.O_RDONLY);
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('Staged content is not a regular file');
    if (stat.nlink !== 1) throw new Error('Staged content has multiple hard links');
    const hash = createHash('sha256');
    const stream = handle.createReadStream({ autoClose: false });
    for await (const chunk of stream) hash.update(chunk as Buffer);
    return { size: stat.size, sha256: hash.digest('hex') };
  } finally {
    await handle.close();
  }
};

/** Write a file atomically (temp + fsync + rename) with 0600 permissions. */
export const writeFileAtomic = async (target: string, data: string | Buffer): Promise<void> => {
  const dir = path.dirname(target);
  await ensureDirectory(dir);
  const temp = path.join(dir, `.${path.basename(target)}.${process.pid}.${Date.now()}.tmp`);
  const handle = await fs.open(temp, 'wx', 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await fs.rename(temp, target);
  try {
    const dirHandle = await fs.open(dir, 'r');
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close();
    }
  } catch {
    // Directory fsync is not supported everywhere; the rename is still atomic.
  }
};

export const removeIfExists = async (target: string): Promise<void> => {
  try {
    await fs.rm(target, { recursive: true, force: true });
  } catch {
    // Cleanup is best-effort; a leftover is swept on the next startup.
  }
};
