import { isUtf8 } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { CORE_SCHEMA, load } from 'js-yaml';
import { getSettingsPath } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { isReplicaMode } from '../utils/replicaMode.js';
import { isHostedModeEnabled } from './hostedMode.js';
import type {
  HostedSkill,
  HostedSkillSource,
  SkillEntry,
  SkillPublication,
} from '../types/hostedSkill.js';

export const skillsAvailable = () => !isReplicaMode() && !isHostedModeEnabled();

export const MAX_SKILL_FILES = 512;
export const MAX_SKILL_BYTES = 16 * 1024 * 1024;
const SKILL_URI_PREFIX = 'skill://mcphub/';
const skillIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const metadataFile = '.mcphub.json';

type InputFile = { path: string; bytes: Buffer };
type Snapshot = {
  skill: HostedSkill;
  entries: Omit<SkillEntry, 'resources'>[];
};

export class SkillInputError extends Error {}
export class SkillNameConflict extends Error {}

const invalidPathPart = (part: string) =>
  !part || /[. ]$/.test(part) || /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(part);

export function validateSkillPath(path: string): void {
  if (
    path.length > 1024 ||
    // eslint-disable-next-line no-control-regex -- Control characters cannot be Skill path segments.
    /[<>:"\\|?*\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(path) ||
    path.split('/').some(invalidPathPart) ||
    path.split('/', 1)[0].toLowerCase() === metadataFile
  ) {
    throw new SkillInputError('Invalid Skill file path');
  }
}

const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

const readFrontmatter = (bytes: Buffer, directory: string): SkillEntry['frontmatter'] => {
  if (!isUtf8(bytes)) throw new SkillInputError('SKILL.md must be valid UTF-8');
  const yaml = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(
    bytes.toString('utf8'),
  )?.[1];
  if (!yaml || Buffer.byteLength(yaml) > 64 * 1024) {
    throw new SkillInputError('SKILL.md needs YAML frontmatter of up to 64 KiB');
  }
  try {
    const seen = new Set<object>();
    const value = load(yaml, { schema: CORE_SCHEMA });
    const frontmatter = JSON.parse(
      JSON.stringify(value, (_, field: unknown) => {
        if (typeof field === 'number' && !Number.isFinite(field)) throw new Error();
        if (field && typeof field === 'object') {
          if (seen.has(field)) throw new Error();
          seen.add(field);
        }
        return field;
      }),
    );
    const { name, description } = frontmatter;
    if (
      !Array.isArray(frontmatter) &&
      name === directory &&
      typeof name === 'string' &&
      name.length <= 64 &&
      skillNamePattern.test(name) &&
      !invalidPathPart(name) &&
      typeof description === 'string' &&
      description.trim() &&
      description.length <= 1024
    ) {
      return frontmatter;
    }
  } catch {
    // Return the same input error for malformed and non-JSON frontmatter.
  }
  throw new SkillInputError('Invalid SKILL.md frontmatter or name does not match its directory');
};

export function buildSkillSnapshot(
  directory: string,
  source: HostedSkillSource,
  files: InputFile[],
  id: string = randomUUID(),
): Snapshot & { contents: Buffer[] } {
  if (
    files.length > MAX_SKILL_FILES ||
    files.reduce((sum, file) => sum + file.bytes.length, 0) > MAX_SKILL_BYTES
  ) {
    throw new SkillInputError('A Skill may contain at most 512 files and 16 MiB');
  }
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const paths = new Set(sorted.map(({ path }) => path));
  for (const { path } of sorted) {
    validateSkillPath(path);
    for (let slash = path.indexOf('/'); slash !== -1; slash = path.indexOf('/', slash + 1)) {
      if (paths.has(path.slice(0, slash)))
        throw new SkillInputError('Conflicting Skill file paths');
    }
  }
  const manifest = sorted.find(({ path }) => path === 'SKILL.md');
  if (!manifest || paths.size !== files.length) {
    throw new SkillInputError('A Skill requires SKILL.md and unique file paths');
  }
  const frontmatter = readFrontmatter(manifest.bytes, directory);
  const root = `${SKILL_URI_PREFIX}${id}/${frontmatter.name}/`;
  const metadata = sorted.map(({ path, bytes }) => ({
    path,
    uri: root + path.split('/').map(encodeURIComponent).join('/'),
    digest: `sha256:${sha256(bytes)}`,
    size: bytes.length,
  }));
  const entries = sorted.flatMap(({ path, bytes }, index) => {
    if (path !== 'SKILL.md' && !path.endsWith('/SKILL.md')) return [];
    const prefix = path.slice(0, -'SKILL.md'.length);
    return [
      {
        uri: metadata[index].uri,
        frontmatter: prefix
          ? readFrontmatter(bytes, prefix.slice(0, -1).split('/').slice(-1)[0])
          : frontmatter,
      },
    ];
  });
  return {
    skill: {
      id,
      name: frontmatter.name,
      description: frontmatter.description,
      source,
      enabled: false,
      global: false,
      groupIds: [],
      version: sha256(JSON.stringify(metadata.map(({ path, digest }) => [path, digest]))),
      files: metadata,
    },
    entries,
    contents: sorted.map(({ bytes }) => bytes),
  };
}

const storePath = () => resolve(process.cwd(), 'data', 'skills');

function containedPath(root: string, path: string): string {
  const file = resolve(root, path);
  if (!file.startsWith(root + sep)) throw new SkillInputError('Invalid Skill storage path');
  return file;
}

const fileStat = (path: string) => fs.lstatSync(path, { throwIfNoEntry: false });
const storageEntries = (root: string) => {
  if (!fileStat(root)?.isDirectory()) return [];
  return fs.readdirSync(root);
};

function readRegularFile(path: string, limit: number): Buffer | undefined {
  if (!fileStat(path)?.isFile()) return;
  try {
    const flag = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0);
    const fd = fs.openSync(path, flag);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > limit) return;
      const bytes = Buffer.alloc(stat.size);
      if (fs.readSync(fd, bytes, 0, bytes.length, 0) === bytes.length) return bytes;
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT' && code !== 'ELOOP') throw error;
  }
}

function readMetadata(root: string, name: string): Snapshot | undefined {
  if (!skillNamePattern.test(name)) return;
  const directory = containedPath(root, name);
  if (!fileStat(directory)?.isDirectory()) return;
  const bytes = readRegularFile(join(directory, metadataFile), 8 * MAX_SKILL_BYTES);
  if (!bytes) return;
  const snapshot: Snapshot = JSON.parse(bytes.toString('utf8'));
  if (snapshot.skill.name === name && skillIdPattern.test(snapshot.skill.id)) return snapshot;
}

function writeMetadata(directory: string, snapshot: Snapshot) {
  const temporary = join(directory, `.${randomUUID()}.tmp`);
  try {
    fs.writeFileSync(temporary, JSON.stringify(snapshot), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, join(directory, metadataFile));
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

const backupPrefix = '.backup-';

function recoverReplacements(root: string) {
  for (const entry of storageEntries(root)) {
    if (!entry.startsWith(backupPrefix)) continue;
    const name = entry.slice(backupPrefix.length);
    if (!skillNamePattern.test(name)) continue;
    const backup = containedPath(root, entry);
    if (!fileStat(backup)?.isDirectory()) continue;
    const target = containedPath(root, name);
    if (!fileStat(target)) fs.renameSync(backup, target);
    else if (readMetadata(root, name)) fs.rmSync(backup, { recursive: true });
  }
}

function writeSnapshot(
  root: string,
  { contents, ...snapshot }: Snapshot & { contents: Buffer[] },
  replace: boolean,
) {
  const { name, files } = snapshot.skill;
  if (!skillNamePattern.test(name)) throw new SkillInputError('Invalid Skill name');
  const target = containedPath(root, name);
  if (!replace && fileStat(target)) {
    throw new SkillNameConflict(
      'A Skill with this name already exists. Use Replace files to update it.',
    );
  }

  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  if (!fileStat(root)?.isDirectory()) throw new Error('Invalid Skill storage directory');
  const staged = fs.mkdtempSync(join(root, '.import-'));
  const backup = containedPath(root, backupPrefix + name);
  try {
    for (const [index, { path }] of files.entries()) {
      validateSkillPath(path);
      const file = containedPath(staged, path);
      try {
        fs.mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
        fs.writeFileSync(file, contents[index], { flag: 'wx', mode: 0o600 });
      } catch (error) {
        if (
          ['EEXIST', 'EISDIR', 'ENOTDIR', 'ENAMETOOLONG'].includes(
            (error as NodeJS.ErrnoException).code ?? '',
          )
        ) {
          throw new SkillInputError('Conflicting or unsupported Skill file paths');
        }
        throw error;
      }
    }
    writeMetadata(staged, snapshot);

    if (replace) fs.renameSync(target, backup);
    try {
      fs.renameSync(staged, target);
    } catch (error) {
      if (replace) fs.renameSync(backup, target);
      throw error;
    }
    if (replace) fs.rmSync(backup, { recursive: true });
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
  }
}

function prepareStore(): string {
  const root = storePath();
  recoverReplacements(root);
  for (const legacyRoot of new Set([root, resolve(`${getSettingsPath()}.skills`)])) {
    for (const entry of storageEntries(legacyRoot).sort()) {
      if (!entry.endsWith('.json') || !skillIdPattern.test(entry.slice(0, -5))) continue;
      const path = containedPath(legacyRoot, entry);
      const bytes = readRegularFile(path, 64 * MAX_SKILL_BYTES);
      if (!bytes) continue;
      const legacy: Snapshot & { contents: string[] } = JSON.parse(bytes.toString('utf8'));
      try {
        const snapshot = buildSkillSnapshot(
          legacy.skill.name,
          legacy.skill.source,
          legacy.skill.files.map(({ path }, index) => ({
            path,
            bytes: Buffer.from(legacy.contents[index], 'base64'),
          })),
          entry.slice(0, -5),
        );
        const { enabled, global, groupIds } = legacy.skill;
        Object.assign(snapshot.skill, { enabled, global, groupIds });
        const current = readMetadata(root, snapshot.skill.name);
        const metadata = { skill: snapshot.skill, entries: snapshot.entries };
        if (JSON.stringify(current) !== JSON.stringify(metadata)) {
          writeSnapshot(root, snapshot, false);
        }
        fs.unlinkSync(path);
      } catch (error) {
        if (!(error instanceof SkillNameConflict || error instanceof SkillInputError)) throw error;
        // Keep conflicting preview snapshots available for manual recovery.
        const archive = containedPath(legacyRoot, `${entry}.${randomUUID()}.conflict`);
        fs.renameSync(path, archive);
        logger.warn(`Could not migrate Skill snapshot ${entry}. Retained as ${archive}`);
      }
    }
  }
  return root;
}

function* storedSnapshots(root: string) {
  for (const name of storageEntries(root)) {
    const snapshot = readMetadata(root, name);
    if (snapshot) yield snapshot;
  }
}

function readSnapshot(root: string, id: string): Snapshot | undefined {
  if (!skillIdPattern.test(id)) return;
  for (const snapshot of storedSnapshots(root)) {
    if (snapshot.skill.id === id) return snapshot;
  }
}

export function listSkillSnapshots<T>(project: (snapshot: Snapshot) => T): T[] {
  return Array.from(storedSnapshots(prepareStore()), project);
}

export function saveSkillSnapshot(
  snapshot: Snapshot & { contents: Buffer[] },
  replaceId?: string,
): HostedSkill | undefined {
  const root = prepareStore();
  if (replaceId) {
    const previous = readSnapshot(root, replaceId)?.skill;
    if (!previous) return;
    if (previous.name !== snapshot.skill.name) {
      throw new SkillInputError('An updated Skill must keep its original name');
    }
    Object.assign(snapshot.skill, {
      enabled: previous.enabled,
      global: previous.global,
      groupIds: previous.groupIds,
    });
  }
  writeSnapshot(root, snapshot, Boolean(replaceId));
  return snapshot.skill;
}

export function updateSkillPublication(
  id: string,
  publication: SkillPublication,
): HostedSkill | undefined {
  const root = prepareStore();
  const snapshot = readSnapshot(root, id);
  if (!snapshot) return;
  Object.assign(snapshot.skill, publication);
  writeMetadata(containedPath(root, snapshot.skill.name), snapshot);
  return snapshot.skill;
}

export function removeSkill(id: string): boolean {
  const root = prepareStore();
  const snapshot = readSnapshot(root, id);
  if (!snapshot) return false;
  const directory = containedPath(root, snapshot.skill.name);
  const removed = containedPath(root, `.deleted-${randomUUID()}`);
  fs.renameSync(directory, removed);
  fs.rmSync(removed, { recursive: true });
  return true;
}

function getHostedSkillId(uri: string): string | undefined {
  if (!uri.startsWith(SKILL_URI_PREFIX)) return;
  const end = uri.indexOf('/', SKILL_URI_PREFIX.length);
  if (end === -1) return;
  const id = uri.slice(SKILL_URI_PREFIX.length, end);
  return skillIdPattern.test(id) ? id : undefined;
}

export const isHostedSkillUri = (uri: string): boolean => getHostedSkillId(uri) !== undefined;

export function findSkillSnapshot(uri: string): Snapshot | undefined {
  const id = getHostedSkillId(uri);
  if (!id) return;
  const name = uri.slice(SKILL_URI_PREFIX.length + id.length + 1).split('/', 1)[0];
  const snapshot = readMetadata(prepareStore(), name);
  if (snapshot?.skill.id === id) return snapshot;
}

export function describeSkillEntry(
  snapshot: Snapshot,
  entry: Snapshot['entries'][number],
): SkillEntry {
  const prefix = entry.uri.slice(0, -'SKILL.md'.length);
  return {
    ...entry,
    resources: snapshot.skill.files
      .filter(({ uri }) => uri.startsWith(prefix))
      .map(({ uri, size, digest }) => ({ uri, size, digest })),
  };
}

export function readSkillFile(snapshot: Snapshot, uri: string) {
  const file = snapshot.skill.files.find((file) => file.uri === uri);
  if (!file) return;
  const { path, size, digest } = file;
  validateSkillPath(path);
  let directory = containedPath(storePath(), snapshot.skill.name);
  if (!fileStat(directory)?.isDirectory()) return;
  const parts = path.split('/');
  const filename = parts.pop()!;
  for (const part of parts) {
    directory = containedPath(directory, part);
    if (!fileStat(directory)?.isDirectory()) return;
  }
  const bytes = readRegularFile(
    containedPath(directory, filename),
    Math.min(size, MAX_SKILL_BYTES),
  );
  if (!bytes || bytes.length !== size || `sha256:${sha256(bytes)}` !== digest) return;
  const mimeTypes: Record<string, string> = {
    '.md': 'text/markdown',
    '.txt': 'text/plain',
    '.json': 'application/json',
    '.yaml': 'application/yaml',
    '.yml': 'application/yaml',
    '.html': 'text/html',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.pdf': 'application/pdf',
  };
  const text = isUtf8(bytes);
  const mimeType =
    mimeTypes[extname(path).toLowerCase()] ?? (text ? 'text/plain' : 'application/octet-stream');
  return {
    uri,
    mimeType,
    ...(text ? { text: bytes.toString('utf8') } : { blob: bytes.toString('base64') }),
  };
}
