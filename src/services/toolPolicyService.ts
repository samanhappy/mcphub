import { evaluateToolPolicy, validateToolPolicies } from '../utils/toolPolicy.js';
import type { Tool } from '../types/index.js';
import { getGroupDao, getServerDao, getSystemConfigDao } from '../dao/index.js';
import { getNameSeparator } from '../config/index.js';
import { RequestContextService } from './requestContextService.js';
import { UserContextService } from './userContextService.js';

// Existing visibility, key scope and capability gates still intersect with these rules.
export const getToolPolicy = async (route?: string) => {
  const configured = (await getSystemConfigDao().get({ failClosed: true }))?.toolPolicies;
  const rules = configured === undefined ? [] : configured;
  validateToolPolicies(rules);
  const requestContext = RequestContextService.getInstance();
  const subject = {
    username: UserContextService.getInstance().getCurrentUser()?.username,
    keyId: requestContext.getBearerKeyContext().keyId,
  };
  const active = rules.some(
    (rule) =>
      (!rule.username || rule.username === subject.username) &&
      (!rule.keyId || rule.keyId === subject.keyId),
  );
  const groupName = route === '$smart' ? undefined : route?.replace(/^\$smart\//, '');
  const group =
    active && groupName
      ? ((await getGroupDao().findByName(groupName)) ??
        (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(groupName)
          ? await getGroupDao().findById(groupName)
          : undefined))
      : undefined;
  const groupId = group?.id;
  const servers = active ? await getServerDao().findAll() : [];
  const serverId = (name: string) => servers.find((server) => server.name === name)?.id;
  const authorize = (name: string, tool?: string, potential = false) =>
    evaluateToolPolicy(rules, subject, { groupId, serverId: serverId(name), tool }, potential);
  return {
    active,
    groupId,
    serverId,
    authorize,
    filterTools: (name: string, tools: Tool[]) =>
      tools.filter((tool) => {
        const prefix = `${name}${getNameSeparator()}`;
        return (
          authorize(name, tool.name.startsWith(prefix) ? tool.name.slice(prefix.length) : tool.name)
            .decision === 'allow'
        );
      }),
  };
};
