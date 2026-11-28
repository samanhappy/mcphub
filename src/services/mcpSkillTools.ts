import {
  findSkillSnapshot,
  listSkillSnapshots,
  readSkillFile,
  skillsAvailable,
  validateSkillPath,
} from './hostedSkillCatalog.js';
import {
  clientDeclaresSkillsExtension,
  getPublicationFilter,
  resolveAccessibleSkillGroup,
} from './mcpSkills.js';

export const SKILLS_TOOLS_INSTRUCTION = 'Skills are available: call mcphub_list_skills';

const DEFAULT_TEXT_PAGE_CHARS = 16384;
const MAX_TEXT_PAGE_CHARS = 65536;
const MAX_BINARY_TOOL_BYTES = 128 * 1024;
const LIST_PAGE_SIZE = 50;

export const SKILL_TOOL_DEFINITIONS = [
  {
    name: 'mcphub_list_skills',
    title: 'List available Skills',
    description:
      'List the Skills published to this group. Returns each Skill name, description, and stable URI without reading SKILL.md bodies.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        cursor: {
          type: 'string',
          description: 'Optional pagination cursor returned by a previous mcphub_list_skills call.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'mcphub_get_skill',
    title: 'Read a Skill manifest',
    description:
      'Read the SKILL.md body and file index of a Skill published to this group. Pass uri (preferred, from mcphub_list_skills) or name.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        uri: {
          type: 'string',
          description: 'Stable Skill URI returned by mcphub_list_skills.',
        },
        name: {
          type: 'string',
          description: 'Skill name (used when uri is omitted and the name is unique in this group).',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'mcphub_get_skill_file',
    title: 'Read a Skill file',
    description:
      'Read a file inside a Skill published to this group. Supports paged UTF-8 text reads (via offset and limit) or bounded base64 for small binaries.',
    annotations: { readOnlyHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        uri: {
          type: 'string',
          description: 'File URI from mcphub_get_skill, or Skill URI when combined with path.',
        },
        name: {
          type: 'string',
          description: 'Skill name when uri is omitted (must be combined with path).',
        },
        path: {
          type: 'string',
          description: 'Relative file path within the Skill (e.g. references/guide.txt).',
        },
        offset: {
          type: 'integer',
          minimum: 0,
          description: 'Character offset for paging UTF-8 text files (default 0).',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_TEXT_PAGE_CHARS,
          description: `Maximum characters to return per text page (default ${DEFAULT_TEXT_PAGE_CHARS}, max ${MAX_TEXT_PAGE_CHARS}).`,
        },
      },
      additionalProperties: false,
    },
  },
] as const;

export type SkillToolName = (typeof SKILL_TOOL_DEFINITIONS)[number]['name'];

const SKILL_TOOL_NAME_SET = new Set<string>(SKILL_TOOL_DEFINITIONS.map((tool) => tool.name));

export const isSkillToolName = (name: unknown): name is SkillToolName =>
  typeof name === 'string' && SKILL_TOOL_NAME_SET.has(name);

export const isReservedSkillToolName = (name: unknown): boolean => isSkillToolName(name);

const ok = (payload: Record<string, unknown>) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  structuredContent: payload,
});

const failure = (message: string) => ({
  isError: true,
  content: [{ type: 'text' as const, text: message }],
});

export async function shouldExposeSkillTools(
  routeGroup: string | undefined,
  clientCapabilities: unknown,
): Promise<boolean> {
  if (!skillsAvailable()) return false;
  const group = await resolveAccessibleSkillGroup(routeGroup);
  if (!group) return false;
  const mode = group.skillsDelivery ?? 'native';
  if (mode === 'native') return false;
  if (mode === 'both' && clientDeclaresSkillsExtension(clientCapabilities)) return false;
  return listSkillSnapshots(
    (snapshot) =>
      snapshot.skill.enabled &&
      snapshot.skill.groupIds.includes(group.id) &&
      snapshot.entries.length > 0,
  ).some(Boolean);
}

/** Slice a UTF-8 JS string without splitting a UTF-16 surrogate pair. */
function sliceTextSafe(text: string, rawOffset: number, rawLimit: number) {
  let start = Math.max(0, Math.min(rawOffset, text.length));
  if (start > 0 && start < text.length) {
    const code = text.charCodeAt(start);
    if (code >= 0xdc00 && code <= 0xdfff) {
      start += 1;
    }
  }
  const limit = Math.max(1, Math.min(rawLimit, MAX_TEXT_PAGE_CHARS));
  let end = Math.min(start + limit, text.length);
  if (end > start && end < text.length) {
    const lastCode = text.charCodeAt(end - 1);
    if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
      end -= 1;
      if (end === start) {
        end = Math.min(start + 2, text.length);
      }
    }
  }
  const content = text.slice(start, end);
  const hasMore = end < text.length;
  return {
    content,
    offset: start,
    length: content.length,
    totalLength: text.length,
    ...(hasMore ? { nextOffset: end } : {}),
    hasMore,
  };
}

async function resolveVisibleSkillEntry(
  routeGroup: string | undefined,
  uri?: unknown,
  name?: unknown,
) {
  const allowed = await getPublicationFilter(routeGroup);
  if (typeof uri === 'string' && uri.trim()) {
    const snapshot = findSkillSnapshot(uri);
    if (!snapshot || !allowed(snapshot.skill)) {
      return { error: 'Unknown Skill or resource' };
    }
    const entry = snapshot.entries.find((candidate) => candidate.uri === uri);
    if (!entry) return { error: 'Unknown Skill or resource' };
    return { snapshot, entry };
  }
  if (typeof name === 'string' && name.trim()) {
    const matches = listSkillSnapshots((snapshot) =>
      allowed(snapshot.skill)
        ? snapshot.entries
            .filter((entry) => entry.frontmatter.name === name)
            .map((entry) => ({ snapshot, entry }))
        : [],
    ).flat();
    if (matches.length === 0) return { error: 'Unknown Skill or resource' };
    if (matches.length > 1) {
      return {
        error: `Multiple Skills named "${name}" exist in this group; pass uri from mcphub_list_skills instead`,
      };
    }
    return matches[0];
  }
  return { error: 'Either uri or name is required' };
}

export async function executeSkillTool(
  toolName: SkillToolName,
  args: Record<string, unknown>,
  routeGroup: string | undefined,
  clientCapabilities: unknown,
) {
  if (!(await shouldExposeSkillTools(routeGroup, clientCapabilities))) {
    return failure('Skills tools are not enabled on this route');
  }

  if (toolName === 'mcphub_list_skills') {
    const cursor = typeof args.cursor === 'string' ? args.cursor : undefined;
    const allowed = await getPublicationFilter(routeGroup);
    const entries = listSkillSnapshots((snapshot) =>
      allowed(snapshot.skill) ? snapshot.entries.map((entry) => ({ snapshot, entry })) : [],
    )
      .flat()
      .filter(({ entry }) => !cursor || entry.uri > cursor)
      .sort((a, b) => (a.entry.uri < b.entry.uri ? -1 : 1));
    const page = entries.slice(0, LIST_PAGE_SIZE);
    const skills = page.map(({ entry }) => ({
      uri: entry.uri,
      name: entry.frontmatter.name,
      description: entry.frontmatter.description,
    }));
    return ok({
      skills,
      ...(entries.length > page.length ? { nextCursor: skills[skills.length - 1].uri } : {}),
    });
  }

  if (toolName === 'mcphub_get_skill') {
    const resolved = await resolveVisibleSkillEntry(routeGroup, args.uri, args.name);
    if ('error' in resolved) return failure(resolved.error ?? 'Unknown Skill or resource');
    const { snapshot, entry } = resolved;
    const file = readSkillFile(snapshot, entry.uri);
    if (!file || !('text' in file)) return failure('Unknown Skill or resource');
    const prefix = entry.uri.slice(0, -'SKILL.md'.length);
    const manifestFile = snapshot.skill.files.find((f) => f.uri === entry.uri);
    const pathPrefix = manifestFile ? manifestFile.path.slice(0, -'SKILL.md'.length) : '';
    const files = snapshot.skill.files
      .filter((f) => f.uri.startsWith(prefix))
      .map((f) => ({
        path: pathPrefix && f.path.startsWith(pathPrefix) ? f.path.slice(pathPrefix.length) : f.path,
        uri: f.uri,
        size: f.size,
        digest: f.digest,
      }));
    return ok({
      uri: entry.uri,
      name: entry.frontmatter.name,
      description: entry.frontmatter.description,
      content: file.text,
      files,
    });
  }

  if (toolName === 'mcphub_get_skill_file') {
    const allowed = await getPublicationFilter(routeGroup);
    const rawUri = typeof args.uri === 'string' ? args.uri.trim() : undefined;
    const rawName = typeof args.name === 'string' ? args.name.trim() : undefined;
    const rawPath = typeof args.path === 'string' ? args.path.trim() : undefined;

    if (rawPath !== undefined) {
      try {
        validateSkillPath(rawPath);
      } catch {
        return failure('Invalid Skill file path');
      }
    }

    let targetSnapshot;
    let targetFileUri: string | undefined;
    let relativePath: string | undefined;

    if (rawUri && !rawPath) {
      const snapshot = findSkillSnapshot(rawUri);
      if (!snapshot || !allowed(snapshot.skill)) return failure('Unknown Skill or resource');
      const matched = snapshot.skill.files.find((f) => f.uri === rawUri);
      if (!matched) return failure('Unknown Skill or resource');
      targetSnapshot = snapshot;
      targetFileUri = matched.uri;
      relativePath = matched.path;
    } else if (rawPath) {
      const resolved = await resolveVisibleSkillEntry(routeGroup, rawUri, rawName);
      if ('error' in resolved) return failure(resolved.error ?? 'Unknown Skill or resource');
      const { snapshot, entry } = resolved;
      const manifestFile = snapshot.skill.files.find((f) => f.uri === entry.uri);
      const pathPrefix = manifestFile ? manifestFile.path.slice(0, -'SKILL.md'.length) : '';
      const fullPath = pathPrefix + rawPath;
      const matched = snapshot.skill.files.find((f) => f.path === fullPath);
      if (!matched) return failure('Unknown Skill or resource');
      targetSnapshot = snapshot;
      targetFileUri = matched.uri;
      relativePath = rawPath;
    } else {
      return failure('Provide a file uri, or a Skill uri/name together with path');
    }

    const fileMeta = targetSnapshot.skill.files.find((f) => f.uri === targetFileUri);
    const content = readSkillFile(targetSnapshot, targetFileUri);
    if (!fileMeta || !content) return failure('Unknown Skill or resource');

    if ('text' in content) {
      const offset = typeof args.offset === 'number' && Number.isInteger(args.offset) && args.offset >= 0
        ? args.offset
        : 0;
      const limit = typeof args.limit === 'number' && Number.isInteger(args.limit) && args.limit >= 1
        ? args.limit
        : DEFAULT_TEXT_PAGE_CHARS;
      const page = sliceTextSafe(content.text, offset, limit);
      return ok({
        uri: content.uri,
        path: relativePath,
        mimeType: content.mimeType,
        encoding: 'utf-8',
        ...page,
      });
    }

    if (fileMeta.size > MAX_BINARY_TOOL_BYTES) {
      return failure(
        `Binary Skill file exceeds the ${MAX_BINARY_TOOL_BYTES} byte tool read limit`,
      );
    }
    return ok({
      uri: content.uri,
      path: relativePath,
      mimeType: content.mimeType,
      encoding: 'base64',
      content: content.blob,
      size: fileMeta.size,
    });
  }

  return failure('Unknown Skill tool');
}
