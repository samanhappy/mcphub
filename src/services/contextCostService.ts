/**
 * Context Footprint aggregation.
 *
 * Turns runtime server/group state into the token cost numbers surfaced by the
 * GUI. Live-only: cost is computed for connected servers; disconnected servers
 * report connected=false with a zero footprint. No persistence.
 */
import type { ServerInfo, ServerCost, ItemCost, GroupCost, IGroupServerConfig, SmartRoutingCost } from '../types/index.js';
import { itemCostForTool, itemCostForPrompt, itemCostForResource, countTokens, serializeToolDefinition } from '../utils/tokenCost.js';
import { getServersInfo } from './mcpService.js';
import { getNameSeparator } from '../config/index.js';
import { getAllGroups, normalizeGroupServers } from './groupService.js';
import { getSmartRoutingConfig } from '../utils/smartRouting.js';
import { getSmartRoutingMetaToolDefinitions } from './smartRoutingService.js';

const isConnected = (info: ServerInfo): boolean =>
  info.status === 'connected' && info.enabled !== false;

/** Compute a single server's Context Footprint from its runtime ServerInfo. */
export async function serverCostFromInfo(info: ServerInfo): Promise<ServerCost> {
  if (!isConnected(info)) {
    return { name: info.name, connected: false, exposed: 0, gross: 0, items: [] };
  }

  // Resources have no per-item enabled flag upstream, so resource exposed == gross by design.
  // Tools and prompts carry an explicit `enabled` boolean set by getServersInfo.
  // Count all three kinds concurrently rather than awaiting each batch in sequence.
  const [tools, prompts, resources] = await Promise.all([
    Promise.all((info.tools ?? []).map((t) => itemCostForTool(t))),
    Promise.all((info.prompts ?? []).map((p) => itemCostForPrompt(p))),
    Promise.all((info.resources ?? []).map((r) => itemCostForResource(r))),
  ]);
  const items: ItemCost[] = [...tools, ...prompts, ...resources];

  const gross = items.reduce((sum, i) => sum + i.cost, 0);
  const exposed = items.filter((i) => i.enabled).reduce((sum, i) => sum + i.cost, 0);

  return { name: info.name, connected: true, exposed, gross, items };
}

/**
 * Context Footprint for every server visible to the current user.
 * Delegates visibility/enabled filtering to getServersInfo.
 */
export async function getServerCosts(): Promise<ServerCost[]> {
  const infos = await getServersInfo();
  return Promise.all(infos.map((info) => serverCostFromInfo(info as ServerInfo)));
}

/** Strip server-name prefix from a prefixed item name (e.g. "s1-toolA" → "toolA"). */
const shortName = (full: string, server: string, sep: string): string => {
  const prefix = `${server}${sep}`;
  return full.startsWith(prefix) ? full.slice(prefix.length) : full;
};

/**
 * Whether an item's short name is selected by the group's per-server config.
 * `undefined` selection means the field was absent — treat same as 'all'.
 */
const isSelected = (selection: string[] | 'all' | undefined, short: string): boolean =>
  selection === undefined || selection === 'all' || selection.includes(short);

/** Compute the Smart Routing meta-tool token cost for a group scope. */
const smartRoutingCostFor = async (groupName: string): Promise<SmartRoutingCost> => {
  const ref = `$smart/${groupName}`;
  const sumCost = async (tools: any[]): Promise<number> => {
    const counts = await Promise.all(
      tools.map((t) =>
        countTokens(
          serializeToolDefinition({ name: t.name, description: t.description, inputSchema: t.inputSchema }),
        ),
      ),
    );
    return counts.reduce((a, b) => a + b, 0);
  };
  const [baseTools, pdTools] = await Promise.all([
    getSmartRoutingMetaToolDefinitions(ref, false),
    getSmartRoutingMetaToolDefinitions(ref, true),
  ]);
  return { base: await sumCost(baseTools), progressiveDisclosure: await sumCost(pdTools) };
};

/** Per-group Context Footprint — Direct (gross/exposed) + Smart Routing costs. */
export async function getGroupCosts(): Promise<GroupCost[]> {
  const [serverCosts, groups, smartConfig] = await Promise.all([
    getServerCosts(),
    getAllGroups(),
    getSmartRoutingConfig(),
  ]);
  const sep = getNameSeparator();
  const costByServer = new Map(serverCosts.map((c) => [c.name, c]));
  const smartEnabled = smartConfig.enabled === true;

  return Promise.all(
    groups.map(async (group) => {
      const members: IGroupServerConfig[] = normalizeGroupServers(group.servers);
      let exposed = 0;
      let gross = 0;
      let connectedCount = 0;

      for (const member of members) {
        const sc = costByServer.get(member.name);
        if (!sc || !sc.connected) continue;
        connectedCount += 1;
        for (const item of sc.items) {
          gross += item.cost;
          const selection =
            item.kind === 'tool'
              ? member.tools
              : item.kind === 'prompt'
                ? member.prompts
                : member.resources;
          // Resources use URIs as names (not prefixed); tools/prompts are prefixed
          const key =
            item.kind === 'resource' ? item.name : shortName(item.name, member.name, sep);
          if (item.enabled && isSelected(selection, key)) {
            exposed += item.cost;
          }
        }
      }

      return {
        id: group.id,
        name: group.name,
        connectedCount,
        totalCount: members.length,
        direct: { exposed, gross },
        smartRouting: smartEnabled ? await smartRoutingCostFor(group.name) : null,
      };
    }),
  );
}
