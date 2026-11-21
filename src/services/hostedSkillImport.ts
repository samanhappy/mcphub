import { createHash } from 'node:crypto';
import { Agent, EnvHttpProxyAgent, ProxyAgent, type Dispatcher } from 'undici';
import { getSystemConfigDao } from '../dao/DaoFactory.js';
import type { SkillSearchResult } from '../types/hostedSkill.js';
import {
  buildSkillSnapshot,
  MAX_SKILL_BYTES,
  MAX_SKILL_FILES,
  SkillInputError,
  validateSkillPath,
} from './hostedSkillCatalog.js';
import { getProxyConfigFromEnv, isSkillImportProxy } from './proxy.js';

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');
const gitSha = /^[a-f0-9]{40}$/;
const catalogOrigin = 'https://skills.sh';
const isRepository = (owner: string, repo: string) =>
  /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner) &&
  /^[A-Za-z0-9_.-]{1,100}$/.test(repo) &&
  repo !== '.' &&
  repo !== '..' &&
  !/\s/.test(owner + repo);
const isSkillSlug = (slug: string) =>
  slug.length <= 64 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) && !/\s/.test(slug);

export class SkillSearchError extends Error {}

export function importSkillDirectory(payload: Buffer, id?: string) {
  let input: { directory: string; files: Array<{ path: string; base64: string }> };
  try {
    input = JSON.parse(payload.toString('utf8'));
  } catch {
    throw new SkillInputError('Invalid Skill directory upload');
  }
  if (
    !input ||
    typeof input.directory !== 'string' ||
    !Array.isArray(input.files) ||
    input.files.length > MAX_SKILL_FILES
  ) {
    throw new SkillInputError('Invalid Skill directory upload');
  }
  const files = input.files.map((file) => {
    if (!file || typeof file.path !== 'string' || typeof file.base64 !== 'string') {
      throw new SkillInputError('Invalid Skill file');
    }
    const bytes = Buffer.from(file.base64, 'base64');
    if (bytes.toString('base64') !== file.base64)
      throw new SkillInputError('Invalid file encoding');
    return { path: file.path, bytes };
  });
  return buildSkillSnapshot(
    input.directory,
    { type: 'directory', name: input.directory },
    files,
    id,
  );
}

async function remoteBytes(
  url: string,
  signal: AbortSignal,
  limit: number,
  provider = 'GitHub',
  dispatcher?: Dispatcher,
): Promise<Buffer> {
  try {
    const response = await fetch(url, {
      signal,
      redirect: 'error',
      headers: { 'User-Agent': 'MCPHub-Skills' },
      ...(dispatcher && { dispatcher }),
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new SkillInputError(`${provider} returned HTTP ${response.status}`);
    }
    const chunks: Buffer[] = [];
    const reader = response.body.getReader();
    let size = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return Buffer.concat(chunks, size);
        size += value.length;
        if (size > limit) {
          await reader.cancel();
          throw new SkillInputError(`${provider} response exceeds the size limit`);
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    if (error instanceof SkillInputError) throw error;
    throw new SkillInputError(`Could not read from ${provider}`);
  }
}

type TreeItem = { path: string; type: string; mode: string; sha: string; size: number };
type GitTree = { truncated: boolean; tree: TreeItem[] };

export async function searchSkillsCatalog(input: unknown): Promise<SkillSearchResult[]> {
  const query = typeof input === 'string' ? input.trim() : '';
  if (
    (input !== undefined && typeof input !== 'string') ||
    query.length === 1 ||
    query.length > 100
  ) {
    throw new SkillInputError('Enter a search query of 2 to 100 characters');
  }
  const params = new URLSearchParams({ q: query, limit: '20' });
  try {
    const bytes = await remoteBytes(
      query ? `${catalogOrigin}/api/search?${params}` : `${catalogOrigin}/api/skills/all-time/0`,
      AbortSignal.timeout(8_000),
      1024 * 1024,
      'skills.sh',
    );
    const payload = JSON.parse(bytes.toString('utf8')) as { skills?: unknown[] };
    if (!Array.isArray(payload?.skills)) throw new Error('Invalid skills.sh response');
    const matches = new Map<string, SkillSearchResult>();
    for (const item of payload.skills) {
      if (!item || typeof item !== 'object') continue;
      const { source, name, skillId, installs } = item as Record<string, unknown>;
      if (typeof source !== 'string' || typeof skillId !== 'string') continue;
      const [owner, repo, extra] = source.split('/');
      if (extra !== undefined || !isRepository(owner, repo ?? '') || !isSkillSlug(skillId)) {
        continue;
      }
      const url = `${catalogOrigin}/${source}/${skillId}`;
      matches.set(url, {
        source,
        name: typeof name === 'string' ? name.slice(0, 120) : skillId,
        installs:
          typeof installs === 'number' && Number.isSafeInteger(installs) && installs >= 0
            ? installs
            : null,
        url,
      });
      if (matches.size === 20) break;
    }
    return [...matches.values()];
  } catch {
    throw new SkillSearchError('Could not load the skills.sh catalog');
  }
}

export async function importRemoteSkill(input: string, id?: string) {
  const selection =
    (await getSystemConfigDao().get({ failClosed: true })).install?.skillImportProxy ?? 'server';
  const proxy = getProxyConfigFromEnv(process.env);
  let dispatcher: Dispatcher;
  try {
    if (!isSkillImportProxy(selection)) throw new Error('Invalid proxy selection');
    if (selection === 'direct') dispatcher = new Agent();
    else if (selection === 'server') dispatcher = new EnvHttpProxyAgent(proxy);
    else dispatcher = new ProxyAgent(selection);
  } catch {
    throw new SkillInputError('Invalid Skill import proxy configuration on the MCPHub server');
  }
  try {
    return await downloadRemoteSkill(input, id, dispatcher);
  } finally {
    await dispatcher.destroy();
  }
}

async function downloadRemoteSkill(input: string, id?: string, dispatcher?: Dispatcher) {
  let url: URL;
  let segments: string[];
  try {
    url = new URL(input);
    segments = url.pathname.replace(/\/$/, '').slice(1).split('/').map(decodeURIComponent);
  } catch {
    throw new SkillInputError('Enter a GitHub directory or skills.sh Skill URL');
  }
  const [owner, repo, target, ref, ...directory] = segments;
  const fromCatalog = [catalogOrigin, 'https://www.skills.sh'].includes(url.origin);
  if (url.username || url.password || !isRepository(owner ?? '', repo ?? '')) {
    throw new SkillInputError('Enter a GitHub directory or skills.sh Skill URL');
  }
  if (fromCatalog) {
    if (segments.length !== 3 || !isSkillSlug(target)) {
      throw new SkillInputError('Use https://skills.sh/OWNER/REPO/SKILL');
    }
  } else {
    if (
      url.origin !== 'https://github.com' ||
      target !== 'tree' ||
      !ref ||
      !directory.length ||
      directory.length > 16
    ) {
      throw new SkillInputError('Use https://github.com/OWNER/REPO/tree/REF/DIRECTORY');
    }
    validateSkillPath(ref);
    for (const segment of directory) {
      validateSkillPath(segment);
      if (segment.includes('/')) throw new SkillInputError('Invalid GitHub directory');
    }
  }
  const requestedRef = fromCatalog ? 'HEAD' : ref;
  const repoPath = `${owner}/${repo}`;
  const base = `https://api.github.com/repos/${repoPath}`;
  const signal = AbortSignal.timeout(45_000);
  const json = async <T>(path: string): Promise<T> => {
    const bytes = await remoteBytes(base + path, signal, 8 * 1024 * 1024, 'GitHub', dispatcher);
    try {
      return JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new SkillInputError('Invalid GitHub API response');
    }
  };
  const commit = await json<{ sha: string; commit: { tree: { sha: string } } }>(
    `/commits/${encodeURIComponent(requestedRef)}`,
  );
  if (!gitSha.test(commit.sha)) throw new SkillInputError('Invalid GitHub commit');
  const getTree = async (sha: string, recursive = false): Promise<TreeItem[]> => {
    if (!gitSha.test(sha)) throw new SkillInputError('Invalid GitHub tree');
    const result = await json<GitTree>(`/git/trees/${sha}${recursive ? '?recursive=1' : ''}`);
    if (result.truncated) throw new SkillInputError('GitHub directory tree is too large');
    return result.tree;
  };
  let sha = commit.commit.tree.sha;
  let fileTree: TreeItem[];
  let directoryPath = directory.join('/');
  if (fromCatalog) {
    const repositoryTree = await getTree(sha, true);
    const matches = repositoryTree.filter(
      (item) =>
        item.type === 'blob' &&
        (item.path === `${target}/SKILL.md` || item.path.endsWith(`/${target}/SKILL.md`)),
    );
    if (matches.length > 1) {
      throw new SkillInputError(
        'Multiple Skill directories match. Import a specific GitHub directory URL.',
      );
    }
    if (!matches.length && !repositoryTree.some((item) => item.path === 'SKILL.md')) {
      throw new SkillInputError('Skill directory not found in the GitHub repository');
    }
    directoryPath = matches[0]?.path.slice(0, -'/SKILL.md'.length) ?? '';
    if (directoryPath) validateSkillPath(directoryPath);
    const prefix = directoryPath ? directoryPath + '/' : '';
    fileTree = repositoryTree
      .filter((item) => item.path.startsWith(prefix) && item.path !== directoryPath)
      .map((item) => ({ ...item, path: item.path.slice(prefix.length) }));
  } else {
    for (const segment of directory) {
      const entry = (await getTree(sha)).find(
        (item) => item.path === segment && item.type === 'tree',
      );
      if (!entry) throw new SkillInputError('GitHub directory not found');
      sha = entry.sha;
    }
    fileTree = await getTree(sha, true);
  }

  const files = fileTree.filter((item) => item.type !== 'tree');
  let total = 0;
  for (const file of files) {
    validateSkillPath(file.path);
    if (
      file.type !== 'blob' ||
      !['100644', '100755'].includes(file.mode) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0
    ) {
      throw new SkillInputError('GitHub Skill files must be regular files');
    }
    total += file.size;
  }
  if (files.length > MAX_SKILL_FILES || total > MAX_SKILL_BYTES) {
    throw new SkillInputError('A Skill may contain at most 512 files and 16 MiB');
  }
  if (!files.some((file) => file.path === 'SKILL.md')) {
    throw new SkillInputError('GitHub directory does not contain SKILL.md');
  }

  const inputFiles = [];
  const root = `https://raw.githubusercontent.com/${repoPath}/${commit.sha}${directoryPath ? '/' + encodePath(directoryPath) : ''}`;
  for (let offset = 0; offset < files.length; offset += 8) {
    const batch = await Promise.all(
      files.slice(offset, offset + 8).map(async (file) => {
        const bytes = await remoteBytes(
          `${root}/${encodePath(file.path)}`,
          signal,
          file.size,
          'GitHub',
          dispatcher,
        );
        const blob = createHash('sha1')
          .update(`blob ${bytes.length}\0`)
          .update(bytes)
          .digest('hex');
        if (bytes.length !== file.size || blob !== file.sha) {
          throw new SkillInputError('GitHub file does not match the pinned tree');
        }
        return { path: file.path, bytes };
      }),
    );
    inputFiles.push(...batch);
  }
  return buildSkillSnapshot(
    fromCatalog ? target : directory[directory.length - 1],
    {
      type: fromCatalog ? 'skills-sh' : 'github',
      url: fromCatalog
        ? `${catalogOrigin}/${repoPath}/${target}`
        : `https://github.com/${repoPath}/tree/${encodeURIComponent(ref)}/${encodePath(directoryPath)}`,
      commit: commit.sha,
    },
    inputFiles,
    id,
  );
}
