import { isUtf8 } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { extname } from 'node:path';
import { CORE_SCHEMA, load } from 'js-yaml';
import { getSettingsPath } from '../config/index.js';
import type {
  HostedSkill,
  HostedSkillSource,
  SkillEntry,
  SkillPublication,
} from '../types/hostedSkill.js';

export const MAX_SKILL_FILES = 512;
export const MAX_SKILL_BYTES = 16 * 1024 * 1024;
const SKILL_URI_PREFIX = 'skill://mcphub/';
const skillIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type InputFile = { path: string; bytes: Buffer };
type Snapshot = {
  skill: HostedSkill;
  entries: SkillEntry[];
  contents: string[];
};

export class SkillInputError extends Error {}

export function validateSkillPath(path: string): void {
  if (
    path.length > 1024 ||
    // eslint-disable-next-line no-control-regex -- Control characters cannot be Skill path segments.
    /[\\\u0000-\u001f\u007f\uD800-\uDFFF]/u.test(path) ||
    path.split('/').some((part) => !part || part === '.' || part === '..')
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
): Snapshot {
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
        resources: metadata
          .filter((file) => file.path.startsWith(prefix))
          .map(({ uri, size, digest }) => ({ uri, size, digest })),
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
    contents: sorted.map(({ bytes }) => bytes.toString('base64')),
  };
}

const storePath = () => `${getSettingsPath()}.skills`;
const snapshotPath = (id: string) => `${storePath()}/${id}.json`;

const readSnapshot = (id: string): Snapshot | undefined => {
  if (!skillIdPattern.test(id)) return;
  try {
    return JSON.parse(fs.readFileSync(snapshotPath(id), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
};

const writeSnapshot = (snapshot: Snapshot) => {
  fs.mkdirSync(storePath(), { recursive: true, mode: 0o700 });
  const target = snapshotPath(snapshot.skill.id);
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(snapshot), { flag: 'wx', mode: 0o600 });
    fs.renameSync(temporary, target);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
};

export function listSkillSnapshots<T>(project: (snapshot: Snapshot) => T): T[] {
  let files: string[];
  try {
    files = fs.readdirSync(storePath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  return files
    .filter((file) => file.endsWith('.json'))
    .flatMap((file) => {
      const snapshot = readSnapshot(file.slice(0, -5));
      return snapshot ? [project(snapshot)] : [];
    });
}

export function saveSkillSnapshot(snapshot: Snapshot, replaceId?: string): HostedSkill | undefined {
  if (replaceId) {
    const previous = readSnapshot(replaceId)?.skill;
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
  writeSnapshot(snapshot);
  return snapshot.skill;
}

export function updateSkillPublication(
  id: string,
  publication: SkillPublication,
): HostedSkill | undefined {
  const snapshot = readSnapshot(id);
  if (!snapshot) return;
  Object.assign(snapshot.skill, publication);
  writeSnapshot(snapshot);
  return snapshot.skill;
}

export function removeSkill(id: string): boolean {
  if (!readSnapshot(id)) return false;
  fs.unlinkSync(snapshotPath(id));
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
  return id ? readSnapshot(id) : undefined;
}

export function readSkillFile(snapshot: Snapshot, uri: string) {
  const index = snapshot.skill.files.findIndex((file) => file.uri === uri);
  if (index === -1) return;
  const { path } = snapshot.skill.files[index];
  const bytes = Buffer.from(snapshot.contents[index], 'base64');
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
    ...(text ? { text: bytes.toString('utf8') } : { blob: snapshot.contents[index] }),
  };
}
