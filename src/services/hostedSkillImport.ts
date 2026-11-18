import { createHash } from 'node:crypto';
import {
  buildSkillSnapshot,
  MAX_SKILL_BYTES,
  MAX_SKILL_FILES,
  SkillInputError,
  validateSkillPath,
} from './hostedSkillCatalog.js';

const encodePath = (path: string) => path.split('/').map(encodeURIComponent).join('/');
const gitSha = /^[a-f0-9]{40}$/;

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

async function githubBytes(url: string, signal: AbortSignal, limit: number): Promise<Buffer> {
  try {
    const response = await fetch(url, {
      signal,
      redirect: 'error',
      headers: { 'User-Agent': 'MCPHub-Skills' },
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new SkillInputError(`GitHub returned HTTP ${response.status}`);
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
          throw new SkillInputError('GitHub response exceeds the size limit');
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }
  } catch (error) {
    if (error instanceof SkillInputError) throw error;
    throw new SkillInputError('Could not read from GitHub');
  }
}

type TreeItem = { path: string; type: string; mode: string; sha: string; size: number };
type GitTree = { truncated: boolean; tree: TreeItem[] };

export async function importGitHubSkill(input: string, id?: string) {
  let url: URL;
  let segments: string[];
  try {
    url = new URL(input);
    segments = url.pathname.replace(/\/$/, '').slice(1).split('/').map(decodeURIComponent);
  } catch {
    throw new SkillInputError('Enter a GitHub repository directory URL');
  }
  const [owner, repo, tree, ref, ...directory] = segments;
  if (
    url.origin !== 'https://github.com' ||
    url.username ||
    url.password ||
    !/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(owner ?? '') ||
    !/^[A-Za-z0-9_.-]+$/.test(repo ?? '') ||
    repo === '.' ||
    repo === '..' ||
    tree !== 'tree' ||
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
  const repoPath = `${owner}/${repo}`;
  const base = `https://api.github.com/repos/${repoPath}`;
  const signal = AbortSignal.timeout(45_000);
  const json = async <T>(path: string): Promise<T> => {
    const bytes = await githubBytes(base + path, signal, 8 * 1024 * 1024);
    try {
      return JSON.parse(bytes.toString('utf8'));
    } catch {
      throw new SkillInputError('Invalid GitHub API response');
    }
  };
  const commit = await json<{ sha: string; commit: { tree: { sha: string } } }>(
    `/commits/${encodeURIComponent(ref)}`,
  );
  if (!gitSha.test(commit.sha)) throw new SkillInputError('Invalid GitHub commit');
  const getTree = async (sha: string, recursive = false): Promise<TreeItem[]> => {
    if (!gitSha.test(sha)) throw new SkillInputError('Invalid GitHub tree');
    const result = await json<GitTree>(`/git/trees/${sha}${recursive ? '?recursive=1' : ''}`);
    if (result.truncated) throw new SkillInputError('GitHub directory tree is too large');
    return result.tree;
  };
  let sha = commit.commit.tree.sha;
  for (const segment of directory) {
    const entry = (await getTree(sha)).find(
      (item) => item.path === segment && item.type === 'tree',
    );
    if (!entry) throw new SkillInputError('GitHub directory not found');
    sha = entry.sha;
  }

  const files = (await getTree(sha, true)).filter((item) => item.type !== 'tree');
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
  const root = `https://raw.githubusercontent.com/${repoPath}/${commit.sha}/${encodePath(directory.join('/'))}`;
  for (let offset = 0; offset < files.length; offset += 8) {
    const batch = await Promise.all(
      files.slice(offset, offset + 8).map(async (file) => {
        const bytes = await githubBytes(`${root}/${encodePath(file.path)}`, signal, file.size);
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
    directory[directory.length - 1],
    {
      type: 'github',
      url: `https://github.com/${repoPath}/tree/${encodeURIComponent(ref)}/${encodePath(directory.join('/'))}`,
      commit: commit.sha,
    },
    inputFiles,
    id,
  );
}
