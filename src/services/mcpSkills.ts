import { fromJsonSchema, ProtocolError, type Server } from '@modelcontextprotocol/server';
import { getGroupDao } from '../dao/DaoFactory.js';
import { canAccessGroupRoute } from '../utils/groupAccess.js';
import { getMcpRequestGroup } from '../utils/mcpRequestGroup.js';
import { UserContextService } from './userContextService.js';
import type { SkillPublication } from '../types/hostedSkill.js';
import {
  findSkillSnapshot,
  listSkillSnapshots,
  readSkillFile,
  skillsAvailable,
} from './hostedSkillCatalog.js';

export const SKILLS_EXTENSION_ID = 'io.modelcontextprotocol/skills';

const cache = { ttlMs: 0, cacheScope: 'private' as const };
const unknownSkill = () => new ProtocolError(-32602, 'Unknown Skill or resource');

async function getPublicationFilter(): Promise<(skill: SkillPublication) => boolean> {
  if (!skillsAvailable()) return () => false;
  const target = getMcpRequestGroup();
  if (!target) return (skill) => skill.enabled && skill.global;
  const dao = getGroupDao();
  const group =
    (await dao.findByName(target)) ??
    (/^[a-f0-9-]{36}$/i.test(target) ? await dao.findById(target) : null);
  const user = UserContextService.getInstance().getCurrentUser();
  if (
    !group ||
    ((group.visibility === 'private' || group.visibility === 'group') && !user) ||
    !canAccessGroupRoute(group, user ?? undefined)
  ) {
    return () => false;
  }
  return (skill) => skill.enabled && skill.groupIds.includes(group.id);
}

async function getVisibleSnapshot(uri: string) {
  const allowed = await getPublicationFilter();
  const snapshot = findSkillSnapshot(uri);
  if (!snapshot || !allowed(snapshot.skill)) throw unknownSkill();
  return snapshot;
}

const listParams = fromJsonSchema<{ cursor?: string }>({
  type: 'object',
  properties: { cursor: { type: 'string', maxLength: 16384 } },
});
const getParams = fromJsonSchema<{ uri: string }>({
  type: 'object',
  properties: { uri: { type: 'string', maxLength: 16384 } },
  required: ['uri'],
});

export function registerSkillHandlers(server: Server) {
  server.registerCapabilities({ extensions: { [SKILLS_EXTENSION_ID]: {} } });
  server.setRequestHandler('skills/list', { params: listParams }, async ({ cursor }) => {
    const allowed = await getPublicationFilter();
    const entries = listSkillSnapshots((snapshot) =>
      allowed(snapshot.skill) ? snapshot.entries : [],
    )
      .flat()
      .filter(({ uri }) => !cursor || uri > cursor)
      .sort((a, b) => (a.uri < b.uri ? -1 : 1));
    const skills = entries.slice(0, 20);
    return {
      resultType: 'complete',
      skills,
      ...(entries.length > skills.length ? { nextCursor: skills[skills.length - 1].uri } : {}),
      ...cache,
    };
  });
  server.setRequestHandler('skills/get', { params: getParams }, async ({ uri }) => {
    const snapshot = await getVisibleSnapshot(uri);
    const skill = snapshot.entries.find((entry) => entry.uri === uri);
    if (!skill) throw unknownSkill();
    return { resultType: 'complete', skill, ...cache };
  });
}

export async function readHostedSkillResource(uri: string) {
  const snapshot = await getVisibleSnapshot(uri);
  const file = readSkillFile(snapshot, uri);
  if (!file) throw unknownSkill();
  return { contents: [file], ...cache };
}
