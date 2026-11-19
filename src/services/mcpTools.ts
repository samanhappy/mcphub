import type { Server, ServerContext, RequestOptions } from '@modelcontextprotocol/server';
import type { Client } from '../clients/mcpSdkClient.js';
import type {
  IGroup,
  IGroupServerConfig,
  ServerInfo,
  Tool,
  ToolPolicyAudit,
} from '../types/index.js';
import type {
  FilteredGroupServersResult,
  IsolatedClientContext,
  McpAppsRouteContext,
} from '../types/mcpRouting.js';
import { getServerDao } from '../dao/index.js';
import { getNameSeparator } from '../config/index.js';
import { getMcpRequestGroup } from '../utils/mcpRequestGroup.js';
import {
  getGroupLookupName,
  normalizeToolNameForServer,
  resolveNameFromGroup,
} from '../utils/mcpRouteNames.js';
import { projectGroupToolName, assertValidGroupToolNames } from '../utils/groupToolNames.js';
import { isSafePassthroughHeader } from '../utils/passthroughHeaders.js';
import { canServeToolRequests } from '../utils/serverAvailability.js';
import { hasPersonalAuthentication } from '../utils/credentialTemplate.js';
import { applyHiddenParams, findToolConfig } from '../utils/toolConfig.js';
import { isAppOnlyTool, stripMcpAppsMetadata } from '../utils/mcpApps.js';
import {
  summarizeArgumentsForLogging,
  summarizeToolResultForLogging,
} from '../utils/mcpRequestLogging.js';
import { ToolUnavailableError } from '../utils/toolUnavailableError.js';
import { formatErrorForLogging, summarizeErrorForLogging } from '../utils/serialization.js';
import { logger } from '../utils/logger.js';
import {
  assertToolCallArgumentsSafe,
  isToolCallGuardEnabled,
  ToolCallBlockedError,
} from '../middlewares/toolCallGuard.js';
import { getToolPolicy } from './toolPolicyService.js';
import { setMetricsServer } from './metricsService.js';
import { getActivityLoggingService } from './activityLoggingService.js';
import { RequestContextService } from './requestContextService.js';
import { UserContextService } from './userContextService.js';
import { maybeCompressToolResult } from './toolResultCompressionService.js';
import {
  assertHostedToolAllowed,
  type HostedCreditReservation,
  reserveHostedToolCall,
  settleHostedToolCall,
} from './hostedAuthService.js';
import {
  getSmartRoutingTools,
  handleSearchToolsRequest,
  handleDescribeToolRequest,
  isSmartRoutingGroup,
} from './smartRoutingService.js';
import { containsStagingRef } from './fileStaging/dispatch.js';
import { isReservedStagingName } from './fileStaging/tools.js';

interface ToolRoutingDependencies {
  getVisibleServerInfos(): ServerInfo[];
  getVisibleServerByName(name: string): ServerInfo | undefined;
  getServerByName(name: string): ServerInfo | undefined;
  getDownstreamServer(sessionId: string): Server | undefined;
  getMcpAppsRouteContext(
    sessionId: string,
    group: string | undefined,
  ): Promise<McpAppsRouteContext>;
  getFilteredServerInfosForGroup(group: string | undefined): Promise<FilteredGroupServersResult>;
  findRouteGroup(group: string): Promise<IGroup | null>;
  filterToolsByConfig(serverName: string, tools: Tool[]): Promise<Tool[]>;
  filterToolsByGroup(
    group: string | undefined,
    serverName: string,
    tools: Tool[],
    config?: IGroupServerConfig,
  ): Promise<Tool[]>;
  resolveDescriptionOverride(
    description: string | undefined,
    config?: { description?: string },
  ): string;
  classifyUnavailableReason(name: string): string;
  beginOnDemandToolCall(info: ServerInfo): (() => void) | undefined;
  ensureServerReady(info: ServerInfo): Promise<void>;
  acquireClientState(info: ServerInfo, openAiSession?: unknown): { id: string; release(): void };
  getOrCreateIsolatedClient(
    sessionId: string,
    info: ServerInfo,
    downstream?: Server,
  ): Promise<Pick<IsolatedClientContext, 'client' | 'transport'>>;
  callToolWithReconnect(
    info: ServerInfo,
    params: Parameters<Client['callTool']>[0],
    options?: RequestOptions,
    retries?: number,
    isolated?: IsolatedClientContext,
    extra?: Pick<ServerContext, 'mcpReq'>,
  ): ReturnType<Client['callTool']>;
  withoutHiddenArguments<T>(info: ServerInfo, toolName: string, args: T): T;
  withStagingTools(group: string | undefined, tools: Tool[], extra: unknown): Promise<Tool[]>;
}

const summarizeToolRequestForLogging = (params: any): Record<string, unknown> => ({
  name: typeof params?.name === 'string' ? params.name : 'unknown',
  arguments: summarizeArgumentsForLogging(params?.arguments),
});

const getActivityInputFromToolRequest = (request: any): unknown => {
  if (request?.params?.name === 'call_tool') {
    return request?.params?.arguments?.arguments;
  }

  return request?.params?.arguments;
};

const getActivityToolNameFromRequest = (request: any): string => {
  if (request?.params?.name === 'call_tool') {
    const nestedToolName = request?.params?.arguments?.toolName;
    return typeof nestedToolName === 'string' ? nestedToolName : 'call_tool';
  }

  return typeof request?.params?.name === 'string' ? request.params.name : 'unknown';
};

const stripToolServerPrefix = (toolName: string, serverName?: string): string => {
  if (!serverName) {
    return toolName;
  }

  const separator = getNameSeparator();
  const prefix = `${serverName}${separator}`;
  return toolName.startsWith(prefix) ? toolName.substring(prefix.length) : toolName;
};

export const findToolOnServer = (
  serverInfo: ServerInfo,
  toolName: string,
  allowRawName: boolean,
  preferRawName = false,
): Tool | undefined => {
  // A listed upstream name takes precedence over a colliding legacy cache alias.
  const rawTool =
    preferRawName && allowRawName
      ? serverInfo.tools.find(
          (tool) => normalizeToolNameForServer(serverInfo.name, tool.name) === toolName,
        )
      : undefined;
  const tool =
    rawTool ||
    serverInfo.tools.find(
      (tool) =>
        tool.name === toolName ||
        (allowRawName && normalizeToolNameForServer(serverInfo.name, tool.name) === toolName),
    );
  if (!tool) {
    return undefined;
  }
  // A tool disabled via POST /api/servers/:server/tools/:tool/toggle must be
  // unresolvable for execution, not just hidden from tools/list — otherwise a
  // caller who already knows the tool name can invoke it regardless of the
  // disabled flag.
  //
  // The runtime tool cache (serverInfo.tools, built by normalizeToolForCache)
  // never carries an `enabled` field — that field only exists on the
  // *projection* built for the dashboard/API (buildToolWithDescriptionMetadata),
  // which is a different object. So the persisted per-tool config must be
  // consulted directly here.
  //
  // A disable may be stored under the runtime (prefixed) name, as the
  // dashboard writes it, or under the bare upstream name, as a settings file
  // or a direct API call may. findToolConfig checks both, and never reads
  // another tool's runtime key as this tool's bare name.
  const toolConfig = findToolConfig(
    serverInfo.config?.tools,
    serverInfo.name,
    tool.name,
    serverInfo.tools.map((candidate) => candidate.name),
  );
  if (toolConfig && toolConfig.enabled === false) {
    return undefined;
  }
  return tool;
};

export const createToolHandlers = (dependencies: ToolRoutingDependencies) => {
  const {
    getVisibleServerInfos,
    getVisibleServerByName,
    getServerByName,
    getDownstreamServer,
    getMcpAppsRouteContext,
    getFilteredServerInfosForGroup,
    findRouteGroup,
    filterToolsByConfig,
    filterToolsByGroup,
    resolveDescriptionOverride,
    classifyUnavailableReason,
    beginOnDemandToolCall,
    ensureServerReady,
    acquireClientState,
    getOrCreateIsolatedClient,
    callToolWithReconnect,
    withoutHiddenArguments,
    withStagingTools,
  } = dependencies;

  // Get server by tool name
  const getServerByTool = (toolName: string): ServerInfo | undefined => {
    return getVisibleServerInfos().find(
      (serverInfo) =>
        serverInfo.enabled !== false && serverInfo.tools.some((tool) => tool.name === toolName),
    );
  };

  const assertToolAvailableForRoute = (tool: Tool, appsRouteContext: McpAppsRouteContext): void => {
    if (isAppOnlyTool(tool) && !appsRouteContext.enabled) {
      throw new Error(`Tool '${tool.name}' is only available to MCP Apps`);
    }
  };

  const resolveToolInGroup = async (
    group: string | undefined,
    toolName: string,
    appsRouteContext: McpAppsRouteContext,
  ): Promise<{ serverInfo: ServerInfo; toolName: string; tool: Tool } | undefined> => {
    const lookupGroup = getGroupLookupName(group);
    if (!lookupGroup) {
      return undefined;
    }

    const { filteredServerInfos, serverConfigsByName } =
      await getFilteredServerInfosForGroup(lookupGroup);

    // Accept raw names only on single-upstream routes, even without client
    // capabilities after session rebuild. Count configured servers as well so
    // a disabled or disconnected peer cannot make a group appear unambiguous.
    const allowRawName =
      !isSmartRoutingGroup(group) &&
      serverConfigsByName.size <= 1 &&
      filteredServerInfos.length === 1;

    // Validate the full visible catalog before routing, even if the client skips tools/list.
    const hasOriginalToolNames = [...serverConfigsByName.values()].some(
      (config) => config.preserveToolNames,
    );
    if (hasOriginalToolNames) {
      await listGroupTools(lookupGroup, filteredServerInfos, serverConfigsByName, appsRouteContext);
    }

    for (const serverInfo of filteredServerInfos) {
      // An idle on-demand server is selected here and woken by the caller (#1029)
      if (!canServeToolRequests(serverInfo)) {
        continue;
      }

      const serverConfig = serverConfigsByName.get(serverInfo.name);
      const internalToolName = serverConfig?.preserveToolNames
        ? `${serverInfo.name}${getNameSeparator()}${toolName}`
        : resolveNameFromGroup(toolName, serverInfo.name, serverConfig);
      const tool = findToolOnServer(
        serverInfo,
        internalToolName,
        allowRawName,
        serverConfigsByName.size === 0,
      );
      if (!tool || (hasOriginalToolNames && !appsRouteContext.enabled && isAppOnlyTool(tool))) {
        continue;
      }

      const filteredTools = await filterToolsByGroup(
        lookupGroup,
        serverInfo.name,
        [tool],
        serverConfig,
      );
      if (filteredTools.length === 0) {
        continue;
      }

      // Retain the resolved identity when callers revalidate discovery after waking.
      return { serverInfo, toolName: tool.name, tool };
    }

    return undefined;
  };

  const projectToolForDownstream = (
    serverName: string,
    tool: Tool,
    appsRouteContext: McpAppsRouteContext,
    serverConfig?: IGroupServerConfig,
    useRawName = false,
  ): Tool | undefined => {
    if (!appsRouteContext.enabled && isAppOnlyTool(tool)) {
      return undefined;
    }

    const projectedTool = appsRouteContext.enabled ? tool : stripMcpAppsMetadata(tool);

    // Naming follows the route, independently of Apps capabilities or connection state.
    if (useRawName) {
      return {
        ...projectedTool,
        name: normalizeToolNameForServer(serverName, projectedTool.name),
      };
    }

    // Group and aggregate routes keep qualified names, including single-member groups.
    return {
      ...projectedTool,
      name: projectGroupToolName(projectedTool.name, serverName, serverConfig, getNameSeparator()),
    };
  };

  const listGroupTools = async (
    group: string | undefined,
    filteredServerInfos: ServerInfo[],
    serverConfigsByName: Map<string, IGroupServerConfig>,
    appsRouteContext: McpAppsRouteContext,
  ): Promise<Tool[]> => {
    // If the startup prime of an on-demand server is still in flight, wait for it
    // so this list reflects the freshly cached tools instead of returning empty.
    // No wake is triggered from list itself; the prime handles that. See #1029.
    await Promise.allSettled(
      filteredServerInfos
        .filter(
          (si) =>
            si.config?.startOnDemand === true &&
            si.tools.length === 0 &&
            si.capabilityCache?.state !== 'fresh' &&
            si.spawningPromise,
        )
        .map((si) => si.spawningPromise as Promise<void>),
    );

    const useRawName = !!group && !isSmartRoutingGroup(group) && !(await findRouteGroup(group));
    const allTools = [];
    for (const serverInfo of filteredServerInfos) {
      if (serverInfo.tools && serverInfo.tools.length > 0) {
        const groupServerConfig = serverConfigsByName.get(serverInfo.name);

        // Filter tools based on server configuration
        let tools = await filterToolsByConfig(serverInfo.name, serverInfo.tools);

        // If this is a group request, apply group-level tool filtering
        tools = await filterToolsByGroup(group, serverInfo.name, tools, groupServerConfig);

        // Apply custom descriptions and hidden parameters from server configuration
        const serverConfig = await getServerDao().findById(serverInfo.name);
        const runtimeNames = serverInfo.tools.map((tool) => tool.name);
        const toolsWithCustomDescriptions = tools.map((tool) => {
          const toolConfig = findToolConfig(
            serverConfig?.tools,
            serverInfo.name,
            tool.name,
            runtimeNames,
          );
          return {
            ...applyHiddenParams(tool, toolConfig),
            description: resolveDescriptionOverride(tool.description, toolConfig),
          };
        });

        allTools.push(
          ...toolsWithCustomDescriptions.flatMap((tool) => {
            const projectedTool = projectToolForDownstream(
              serverInfo.name,
              tool,
              appsRouteContext,
              groupServerConfig,
              useRawName,
            );
            return projectedTool ? [projectedTool] : [];
          }),
        );
      }
    }

    if ([...serverConfigsByName.values()].some((config) => config.preserveToolNames)) {
      assertValidGroupToolNames(allTools);
    }
    return allTools;
  };

  // Names the call handler always routes to a meta-tool on a Smart Routing session,
  // whichever of them the current mode lists (see handleCallToolRequestImpl)
  const SMART_ROUTING_META_TOOL_NAMES = new Set(['search_tools', 'describe_tool', 'call_tool']);

  // Each member's pinnedTools, narrowed to its tools selection. Empty when the
  // route is not a $smart/<group> or the group pins nothing.
  const resolvePinnedSmartRoutingServers = async (group: string | undefined) => {
    const lookupGroup = getGroupLookupName(group);
    if (!lookupGroup) {
      return undefined;
    }

    const { filteredServerInfos, serverConfigsByName } =
      await getFilteredServerInfosForGroup(lookupGroup);
    const pinnedConfigsByName = new Map<string, IGroupServerConfig>();
    for (const [serverName, serverConfig] of serverConfigsByName) {
      const selection = serverConfig.tools;
      const pinnedTools = (serverConfig.pinnedTools ?? []).filter(
        (toolName) => !Array.isArray(selection) || selection.includes(toolName),
      );
      if (pinnedTools.length > 0) {
        pinnedConfigsByName.set(serverName, { ...serverConfig, tools: pinnedTools });
      }
    }
    if (pinnedConfigsByName.size === 0) {
      return undefined;
    }

    return {
      lookupGroup,
      pinnedServerInfos: filteredServerInfos.filter((serverInfo) =>
        pinnedConfigsByName.has(serverInfo.name),
      ),
      pinnedConfigsByName,
    };
  };

  // Tools a $smart/<group> lists next to its meta-tools: each member's pinnedTools,
  // narrowed to its tools selection and then run through the same filtering and
  // projection as a direct group listing.
  const getPinnedSmartRoutingTools = async (
    group: string | undefined,
    appsRouteContext: McpAppsRouteContext = { enabled: false },
  ): Promise<Tool[]> => {
    const pinned = await resolvePinnedSmartRoutingServers(group);
    if (!pinned) {
      return [];
    }

    return listGroupTools(
      pinned.lookupGroup,
      pinned.pinnedServerInfos,
      pinned.pinnedConfigsByName,
      appsRouteContext,
    );
  };

  const handleListToolsRequestImpl = async (_: any, extra: any) => {
    const sessionId = extra.sessionId || '';
    const group = getMcpRequestGroup(extra);
    logger.log(`Handling ListToolsRequest for group: ${group}`);

    // Special handling for $smart group to return smart routing tools
    // Support both $smart and $smart/{group} patterns
    if (isSmartRoutingGroup(group)) {
      const smartRoutingTools = await getSmartRoutingTools(group);
      let pinnedTools: Tool[] = [];
      try {
        const appsRouteContext = await getMcpAppsRouteContext(sessionId, group);
        // A pin named like a meta-tool (e.g. alias "describe" + separator "_" +
        // tool "tool") would be intercepted by it on call, even in a mode that
        // does not list that meta-tool, so it is not listed at all
        pinnedTools = (await getPinnedSmartRoutingTools(group, appsRouteContext)).filter(
          (tool) => !SMART_ROUTING_META_TOOL_NAMES.has(tool.name),
        );
      } catch (error) {
        // Pins are an optimisation: failing to resolve them must not cost the meta-tools
        logger.warn(`Failed to list pinned tools for ${group}; returning meta-tools only`, error);
      }
      // A $smart route still needs the hub's virtual staging tools: the model
      // calls them directly, and the meta-tools cannot reach a hub built-in.
      const stagingTools = await withStagingTools(group, [], extra);
      // Nothing to add: return the generator's own object, so callers that
      // compare the response by identity keep working.
      if (pinnedTools.length === 0 && stagingTools.length === 0) return smartRoutingTools;
      const tools = [...smartRoutingTools.tools, ...pinnedTools, ...stagingTools];
      return stagingTools.length > 0 ? { tools, stagingTools: true } : { tools };
    }

    const { filteredServerInfos, serverConfigsByName } =
      await getFilteredServerInfosForGroup(group);
    const appsRouteContext = await getMcpAppsRouteContext(sessionId, group);

    const listed = await listGroupTools(
      group,
      filteredServerInfos,
      serverConfigsByName,
      appsRouteContext,
    );
    const tools = await withStagingTools(group, listed, extra);
    // Hub tools are generated per route, not part of the upstream snapshot, so
    // the list must not be cached across calls.
    return tools.some((tool) => isReservedStagingName(tool.name))
      ? { tools, stagingTools: true }
      : { tools };
  };

  /**
   * Add the hub built-ins to a `search_tools` answer. The model must be able to
   * find them by name through discovery, not only see them in `tools/list`.
   */
  const appendStagingToolsToSearchResult = (result: any, stagingTools: Tool[]): any => {
    const [block] = result?.content ?? [];
    if (!block || block.type !== 'text') return result;
    let parsed: any;
    try {
      parsed = JSON.parse(block.text);
    } catch {
      return result;
    }
    const listed = Array.isArray(parsed.tools) ? parsed.tools : [];
    const names = new Set(listed.map((tool: any) => tool.name));
    const added = stagingTools.filter((tool) => !names.has(tool.name));
    if (added.length === 0) return result;
    const tools = [...listed, ...added];
    return {
      ...result,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            ...parsed,
            tools,
            metadata: {
              ...(parsed.metadata ?? {}),
              totalResults: tools.length,
              stagingTools: true,
            },
          }),
        },
      ],
    };
  };

  const handleCallToolRequestImpl = async (request: any, extra: any) => {
    logger.log('Handling CallToolRequest for tool', summarizeToolRequestForLogging(request.params));
    const startTime = Date.now();
    const activityLogger = getActivityLoggingService();

    // Opt-in fail-closed guard for high-confidence command-injection / SSRF /
    // cloud-credential-theft payloads in tool call arguments. Disabled by
    // default (TOOL_CALL_GUARD_ENABLED=true to enable); see
    // src/middlewares/toolCallGuard.ts.
    if (isToolCallGuardEnabled()) {
      try {
        assertToolCallArgumentsSafe(request?.params?.arguments);
      } catch (guardError) {
        if (guardError instanceof ToolCallBlockedError) {
          logger.warn(
            `Tool call blocked by guard: server/tool=${
              request?.params?.name ?? 'unknown'
            }, rule=${guardError.ruleId}`,
          );
          return {
            content: [
              {
                type: 'text',
                text: `Error: ${guardError.message}`,
              },
            ],
            isError: true,
            errorCode: -32001,
          };
        }
        throw guardError;
      }
    }

    // Get request context for activity logging
    const requestContextService = RequestContextService.getInstance();
    const bearerKeyContext = requestContextService.getBearerKeyContext();
    const sessionId = extra.sessionId || '';

    // For OpenAPI cookie-session isolation, use a real per-caller session id.
    // Direct API controllers fall back to shared synthetic ids ('api-session' /
    // 'openapi-session') when x-session-id is absent, which would leak cookies
    // across callers, so only accept an explicitly-provided session header or a
    // non-synthetic extra.sessionId. Fail-safe (undefined) otherwise.
    const isSyntheticSessionFallback = (id: string) =>
      id === 'api-session' || id === 'openapi-session';
    const explicitXSessionId = extra?.headers?.['x-session-id'];
    const cookieSessionId = [
      requestContextService.getSessionId(),
      typeof explicitXSessionId === 'string' ? explicitXSessionId : undefined,
      typeof extra?.sessionId === 'string' ? extra.sessionId : undefined,
    ].find(
      (id): id is string =>
        typeof id === 'string' && id.length > 0 && !isSyntheticSessionFallback(id),
    );

    // Extract group and key info from request context (set by SSE/HTTP handlers)
    // Fallback to extra for backward compatibility (e.g., direct API calls)
    const group = getMcpRequestGroup(extra);
    const username =
      requestContextService.getUsernameContext() ||
      extra?.username ||
      UserContextService.getInstance().getCurrentUser()?.username ||
      (requestContextService.getKeyKindContext() === 'system' ? 'system' : undefined) ||
      undefined;
    let appsRouteContext: McpAppsRouteContext;
    const keyId = bearerKeyContext.keyId || extra?.keyId || undefined;
    const keyName = bearerKeyContext.keyName || extra?.keyName || undefined;
    const sourceIp = requestContextService.getRequestContext()?.remoteAddress || undefined;
    let policyAudit: ToolPolicyAudit | undefined;
    let hostedReservation: HostedCreditReservation | null = null;
    let releaseOnDemandToolCall: (() => void) | undefined;
    let clientStateLease: ReturnType<typeof acquireClientState> | undefined;
    const getToolStateId = (info: ServerInfo, legacyId: string | undefined): string | undefined => {
      if (!requestContextService.getRequestContext()?.stateless) return legacyId;
      clientStateLease ??= acquireClientState(info, request.params?._meta?.['openai/session']);
      return clientStateLease.id;
    };

    const reserveHostedIfNeeded = async (serverName: string, toolName: string) => {
      const policy = await getToolPolicy(group, extra?.policyGroupId);
      const decision = policy.authorize(serverName, toolName);
      policyAudit = { ...decision, serverId: policy.serverId(serverName), groupId: policy.groupId };
      logger.log('Tool policy decision', {
        username,
        callerId: keyId,
        server: serverName,
        tool: toolName,
        ...policyAudit,
      });
      if (decision.decision === 'deny') {
        throw new ToolUnavailableError(`Tool not available: ${toolName}`, decision.reason);
      }
      const hostedAuth = requestContextService.getHostedAuthContext();
      assertHostedToolAllowed(hostedAuth, serverName, toolName);
      hostedReservation = await reserveHostedToolCall(hostedAuth, serverName, toolName);
    };

    const settleHostedIfNeeded = async (input: {
      success: boolean;
      requestContent?: unknown;
      responseContent?: unknown;
    }) => {
      const reservation = hostedReservation;
      hostedReservation = null;
      await settleHostedToolCall(reservation, {
        success: input.success,
        latencyMs: Date.now() - startTime,
        requestContent: input.requestContent,
        responseContent: input.responseContent,
      });
    };

    try {
      appsRouteContext = await getMcpAppsRouteContext(sessionId, group);

      const lookupRoute = getGroupLookupName(group);
      // Direct routes own their listed raw names, even when a tool is disabled.
      const upstreamOwnsMetaName =
        SMART_ROUTING_META_TOOL_NAMES.has(request.params.name) &&
        !!lookupRoute &&
        !isSmartRoutingGroup(group) &&
        !(await findRouteGroup(lookupRoute)) &&
        getVisibleServerByName(lookupRoute)?.tools.some(
          (tool) => normalizeToolNameForServer(lookupRoute, tool.name) === request.params.name,
        );

      // Special handling for smart routing tools
      if (!upstreamOwnsMetaName && request.params.name === 'search_tools') {
        const { query, limit = 10 } = request.params.arguments || {};
        const result = await handleSearchToolsRequest(query, limit, sessionId, group);
        // Hub built-ins are not in the vector index, so a $smart client would
        // never discover the staging tools from search alone (#1056 PR3).
        const stagingTools = await withStagingTools(group, [], extra);
        if (stagingTools.length === 0) return result;
        return appendStagingToolsToSearchResult(result, stagingTools);
      }

      // Special handling for describe_tool (progressive disclosure mode)
      if (!upstreamOwnsMetaName && request.params.name === 'describe_tool') {
        const { toolName } = request.params.arguments || {};
        return await handleDescribeToolRequest(toolName, sessionId, group);
      }

      // Special handling for call_tool
      if (!upstreamOwnsMetaName && request.params.name === 'call_tool') {
        const { toolName } = request.params.arguments || {};
        if (!toolName) {
          throw new Error('toolName parameter is required');
        }

        const { arguments: toolArgs } = request.params.arguments || {};
        // Preserve legacy raw aggregate calls; explicit routes use the shared
        // resolver so cached names still obey group filtering.
        const singleServerAppsRoute = !getGroupLookupName(group) && !!appsRouteContext.serverInfo;
        let targetServerInfo: ServerInfo | undefined;
        let targetToolName = toolName;
        let targetTool: Tool | undefined;
        if (singleServerAppsRoute) {
          targetServerInfo = appsRouteContext.serverInfo;
        } else if (extra && extra.server) {
          targetServerInfo = getVisibleServerByName(extra.server);
        } else if (getGroupLookupName(group)) {
          const groupTool = await resolveToolInGroup(group, toolName, appsRouteContext);
          if (groupTool) {
            targetServerInfo = groupTool.serverInfo;
            targetToolName = groupTool.toolName;
            targetTool = groupTool.tool;
          }
        } else {
          // Find the first server that has this tool.
          // On-demand servers may be sleeping (disconnected) but still advertise
          // their cached tool list — include them as candidates.
          targetServerInfo = getVisibleServerInfos().find(
            (serverInfo) =>
              serverInfo.enabled !== false &&
              (serverInfo.status === 'connected' || serverInfo.config?.startOnDemand === true) &&
              serverInfo.tools.some((tool) => tool.name === toolName),
          );
        }

        if (!targetServerInfo) {
          throw new ToolUnavailableError(
            `Tool not available: ${toolName}`,
            classifyUnavailableReason(toolName),
          );
        }

        setMetricsServer(targetServerInfo.name);

        // If the target is an on-demand server that is not yet running, wake it up now.
        // Concurrent callers are serialised via ensureServerReady's singleton promise.
        releaseOnDemandToolCall = beginOnDemandToolCall(targetServerInfo);
        if (targetServerInfo.config?.startOnDemand && targetServerInfo.status !== 'connected') {
          await ensureServerReady(targetServerInfo);
          // Re-read status from the mutated serverInfo after async spawn
          // Routing may have captured a tool from the persisted directory before wake.
          targetTool = undefined;
          const freshStatus = (targetServerInfo as ServerInfo).status;
          if (freshStatus !== 'connected') {
            throw new Error(
              `Failed to start on-demand server '${targetServerInfo.name}' — check server logs`,
            );
          }
        }

        // Record activity timestamp for on-demand servers
        targetServerInfo.lastUsedAt = Date.now();

        // Check if the tool exists on the server
        const tool =
          targetTool ?? findToolOnServer(targetServerInfo, targetToolName, singleServerAppsRoute);
        if (!tool) {
          throw new ToolUnavailableError(`Tool not available: ${toolName}`, 'tool-not-found');
        }
        assertToolAvailableForRoute(tool, appsRouteContext);

        // Handle OpenAPI servers differently
        if (targetServerInfo.openApiClient) {
          // For OpenAPI servers, use the OpenAPI client
          const openApiClient = targetServerInfo.openApiClient;

          // Use toolArgs if it has properties, otherwise fallback to request.params.arguments
          const finalArgs = toolArgs && typeof toolArgs === 'object' ? toolArgs : {};

          logger.log('Invoking OpenAPI tool', {
            toolName: targetToolName,
            serverName: targetServerInfo.name,
            arguments: summarizeArgumentsForLogging(finalArgs),
          });

          // Remove server prefix from tool name if present
          const cleanToolName = normalizeToolNameForServer(targetServerInfo.name, tool.name);

          // Extract passthrough headers from extra or request context
          let passthroughHeaders: Record<string, string> | undefined;
          let requestHeaders: Record<string, string | string[] | undefined> | null = null;

          // Try to get headers from extra parameter first (if available)
          if (extra?.headers) {
            requestHeaders = extra.headers;
          } else {
            // Fallback to request context service
            const requestContextService = RequestContextService.getInstance();
            requestHeaders = requestContextService.getHeaders();
          }

          if (requestHeaders && targetServerInfo.config?.openapi?.passthroughHeaders) {
            passthroughHeaders = {};
            for (const headerName of targetServerInfo.config.openapi.passthroughHeaders) {
              if (!isSafePassthroughHeader(headerName)) continue;
              // Handle different header name cases (Express normalizes headers to lowercase)
              const headerValue =
                requestHeaders[headerName] || requestHeaders[headerName.toLowerCase()];
              if (headerValue) {
                passthroughHeaders[headerName] = Array.isArray(headerValue)
                  ? headerValue[0]
                  : String(headerValue);
              }
            }
          }

          const stateId = targetServerInfo.config?.openapi?.cookieSession
            ? getToolStateId(targetServerInfo, cookieSessionId)
            : cookieSessionId;
          if (targetServerInfo.config?.openapi?.cookieSession && !stateId) {
            throw new Error(
              `OpenAPI server '${targetServerInfo.name}' requires cookie-session state and is not yet available on stateless MCP requests`,
            );
          }

          await reserveHostedIfNeeded(targetServerInfo.name, cleanToolName);
          const result = await openApiClient.callTool(
            cleanToolName,
            withoutHiddenArguments(targetServerInfo, cleanToolName, finalArgs),
            passthroughHeaders,
            false,
            stateId,
          );
          await settleHostedIfNeeded({
            success: true,
            requestContent: finalArgs,
            responseContent: result,
          });

          logger.log('OpenAPI tool invocation result', {
            serverName: targetServerInfo.name,
            toolName: cleanToolName,
            result: summarizeToolResultForLogging(result),
          });

          // Log successful activity
          const duration = Date.now() - startTime;
          await activityLogger.logToolCall({
            policy: policyAudit,
            server: targetServerInfo.name,
            tool: cleanToolName,
            duration,
            status: 'success',
            input: finalArgs,
            output: result,
            group,
            username,
            keyId,
            keyName,
            sourceIp,
            hasCredentialTemplate: hasPersonalAuthentication(targetServerInfo.config),
          });

          return await maybeCompressToolResult(
            {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result),
                },
              ],
            },
            {
              serverName: targetServerInfo.name,
              toolName: cleanToolName,
              group,
            },
          );
        }

        // Call the tool on the target server (MCP servers)
        // For servers with perSessionClient: true, use a per-session dedicated client
        let isolatedCtx: IsolatedClientContext | undefined;
        if (
          targetServerInfo.config?.perSessionClient &&
          !hasPersonalAuthentication(targetServerInfo.config)
        ) {
          const stateId = getToolStateId(targetServerInfo, sessionId);
          if (!stateId) {
            throw new Error(
              `Server '${targetServerInfo.name}' requires per-session client isolation and is not yet available on stateless MCP requests`,
            );
          }
          const isolated = await getOrCreateIsolatedClient(
            stateId,
            targetServerInfo,
            extra.mcpReq && !requestContextService.getRequestContext()?.stateless
              ? getDownstreamServer(sessionId)
              : undefined,
          );
          isolatedCtx = {
            sessionId: stateId,
            client: isolated.client,
            transport: isolated.transport,
          };
        } else if (!targetServerInfo.client) {
          throw new Error(`Client not found for server: ${targetServerInfo.name}`);
        }

        // Use toolArgs if it has properties, otherwise fallback to request.params.arguments
        const finalArgs = toolArgs && typeof toolArgs === 'object' ? toolArgs : {};

        logger.log('Invoking tool', {
          toolName: targetToolName,
          serverName: targetServerInfo.name,
          arguments: summarizeArgumentsForLogging(finalArgs),
          perSessionClient: !!targetServerInfo.config?.perSessionClient,
        });

        const cleanToolName = normalizeToolNameForServer(targetServerInfo.name, tool.name);
        await reserveHostedIfNeeded(targetServerInfo.name, cleanToolName);
        const result = await callToolWithReconnect(
          targetServerInfo,
          {
            name: cleanToolName,
            arguments: finalArgs,
          },
          targetServerInfo.options || {},
          1,
          isolatedCtx,
          extra,
        );
        await settleHostedIfNeeded({
          success: !result.isError,
          requestContent: finalArgs,
          responseContent: result,
        });

        logger.log('Tool invocation result', {
          serverName: targetServerInfo.name,
          toolName: cleanToolName,
          result: summarizeToolResultForLogging(result),
        });

        // Log successful activity
        const duration = Date.now() - startTime;
        await activityLogger.logToolCall({
          policy: policyAudit,
          server: targetServerInfo.name,
          tool: cleanToolName,
          duration,
          status: result.isError ? 'error' : 'success',
          input: finalArgs,
          output: result,
          group,
          username,
          keyId,
          keyName,
          sourceIp,
          hasCredentialTemplate: hasPersonalAuthentication(targetServerInfo.config),
          // A nested call forwards its inner arguments, which may carry a ref.
          suppressPayload: containsStagingRef(finalArgs),
          errorMessage: result.isError ? 'Tool returned error response' : undefined,
        });

        return await maybeCompressToolResult(result, {
          serverName: targetServerInfo.name,
          toolName: cleanToolName,
          group,
        });
      }

      // Regular tool handling
      const lookupGroup = getGroupLookupName(group);
      // Explicit routes share name resolution and group filtering regardless of
      // Apps support; keep legacy raw aggregate calls compatible.
      const singleServerAppsRoute = !getGroupLookupName(group) && !!appsRouteContext.serverInfo;
      const groupTool =
        !singleServerAppsRoute && lookupGroup
          ? await resolveToolInGroup(group, request.params.name, appsRouteContext)
          : undefined;
      const serverInfo = singleServerAppsRoute
        ? appsRouteContext.serverInfo
        : (groupTool?.serverInfo ??
          (lookupGroup ? undefined : getServerByTool(request.params.name)));
      const routeToolName = groupTool?.toolName ?? request.params.name;
      let tool =
        groupTool?.tool ??
        (serverInfo
          ? findToolOnServer(serverInfo, routeToolName, singleServerAppsRoute)
          : undefined);
      if (!serverInfo || !tool) {
        throw new ToolUnavailableError(
          `Tool not available: ${request.params.name}`,
          classifyUnavailableReason(request.params.name),
        );
      }
      assertToolAvailableForRoute(tool, appsRouteContext);
      setMetricsServer(serverInfo.name);

      // Wake the on-demand server before invoking the tool. It may be asleep with
      // a cached tool list (visible above) but no live client. Mirrors the
      // $smart call_tool path. See #1029.
      releaseOnDemandToolCall = beginOnDemandToolCall(serverInfo);
      if (serverInfo.config?.startOnDemand && serverInfo.status !== 'connected') {
        await ensureServerReady(serverInfo);
        tool = findToolOnServer(serverInfo, routeToolName, singleServerAppsRoute);
        if (!tool)
          throw new ToolUnavailableError(
            `Tool not available: ${request.params.name}`,
            'tool-not-found',
          );
        assertToolAvailableForRoute(tool, appsRouteContext);
      }
      serverInfo.lastUsedAt = Date.now();

      // Handle OpenAPI servers differently
      if (serverInfo.openApiClient) {
        // For OpenAPI servers, use the OpenAPI client
        const openApiClient = serverInfo.openApiClient;

        // Remove server prefix from tool name if present
        const cleanToolName = normalizeToolNameForServer(serverInfo.name, tool.name);

        logger.log('Invoking OpenAPI tool', {
          toolName: cleanToolName,
          serverName: serverInfo.name,
          arguments: summarizeArgumentsForLogging(request.params.arguments),
        });

        // Extract passthrough headers from extra or request context
        let passthroughHeaders: Record<string, string> | undefined;
        let requestHeaders: Record<string, string | string[] | undefined> | null = null;

        // Try to get headers from extra parameter first (if available)
        if (extra?.headers) {
          requestHeaders = extra.headers;
        } else {
          // Fallback to request context service
          const requestContextService = RequestContextService.getInstance();
          requestHeaders = requestContextService.getHeaders();
        }

        if (requestHeaders && serverInfo.config?.openapi?.passthroughHeaders) {
          passthroughHeaders = {};
          for (const headerName of serverInfo.config.openapi.passthroughHeaders) {
            if (!isSafePassthroughHeader(headerName)) continue;
            // Handle different header name cases (Express normalizes headers to lowercase)
            const headerValue =
              requestHeaders[headerName] || requestHeaders[headerName.toLowerCase()];
            if (headerValue) {
              passthroughHeaders[headerName] = Array.isArray(headerValue)
                ? headerValue[0]
                : String(headerValue);
            }
          }
        }

        const finalArgs = request.params.arguments || {};
        const stateId = serverInfo.config?.openapi?.cookieSession
          ? getToolStateId(serverInfo, cookieSessionId)
          : cookieSessionId;
        if (serverInfo.config?.openapi?.cookieSession && !stateId) {
          throw new Error(
            `OpenAPI server '${serverInfo.name}' requires cookie-session state and is not yet available on stateless MCP requests`,
          );
        }

        await reserveHostedIfNeeded(serverInfo.name, cleanToolName);
        const result = await openApiClient.callTool(
          cleanToolName,
          withoutHiddenArguments(serverInfo, cleanToolName, finalArgs),
          passthroughHeaders,
          false,
          stateId,
        );
        await settleHostedIfNeeded({
          success: true,
          requestContent: finalArgs,
          responseContent: result,
        });

        logger.log('OpenAPI tool invocation result', {
          serverName: serverInfo.name,
          toolName: cleanToolName,
          result: summarizeToolResultForLogging(result),
        });

        // Log successful activity
        const duration = Date.now() - startTime;
        await activityLogger.logToolCall({
          policy: policyAudit,
          server: serverInfo.name,
          tool: cleanToolName,
          duration,
          status: 'success',
          input: request.params.arguments,
          output: result,
          group,
          username,
          keyId,
          keyName,
          sourceIp,
          hasCredentialTemplate: hasPersonalAuthentication(serverInfo.config),
        });

        return await maybeCompressToolResult(
          {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result),
              },
            ],
          },
          {
            serverName: serverInfo.name,
            toolName: cleanToolName,
            group,
          },
        );
      }

      // Handle MCP servers
      // For servers with perSessionClient: true, use a per-session dedicated client
      let isolatedCtx: IsolatedClientContext | undefined;
      if (serverInfo.config?.perSessionClient && !hasPersonalAuthentication(serverInfo.config)) {
        const stateId = getToolStateId(serverInfo, sessionId);
        if (!stateId) {
          throw new Error(
            `Server '${serverInfo.name}' requires per-session client isolation and is not yet available on stateless MCP requests`,
          );
        }
        const isolated = await getOrCreateIsolatedClient(
          stateId,
          serverInfo,
          extra.mcpReq && !requestContextService.getRequestContext()?.stateless
            ? getDownstreamServer(sessionId)
            : undefined,
        );
        isolatedCtx = {
          sessionId: stateId,
          client: isolated.client,
          transport: isolated.transport,
        };
      } else if (!serverInfo.client) {
        throw new Error(`Client not found for server: ${serverInfo.name}`);
      }

      const cleanToolName = normalizeToolNameForServer(serverInfo.name, tool.name);
      await reserveHostedIfNeeded(serverInfo.name, cleanToolName);
      const result = await callToolWithReconnect(
        serverInfo,
        { ...request.params, name: cleanToolName },
        serverInfo.options || {},
        1,
        isolatedCtx,
        extra,
      );
      await settleHostedIfNeeded({
        success: !result.isError,
        requestContent: request.params.arguments,
        responseContent: result,
      });
      logger.log('Tool call result', {
        serverName: serverInfo.name,
        toolName: cleanToolName,
        result: summarizeToolResultForLogging(result),
      });

      // Log successful activity. A staged call carries refs and staging paths;
      // the payload is suppressed (the ref is a download capability).
      const duration = Date.now() - startTime;
      await activityLogger.logToolCall({
        policy: policyAudit,
        server: serverInfo.name,
        tool: cleanToolName,
        duration,
        status: result.isError ? 'error' : 'success',
        input: request.params.arguments,
        output: result,
        group,
        username,
        keyId,
        keyName,
        sourceIp,
        hasCredentialTemplate: hasPersonalAuthentication(serverInfo.config),
        // A staged call carries refs and staging paths; the ref is a download
        // capability, so it never enters the activity record.
        suppressPayload: containsStagingRef(request.params.arguments),
        errorMessage: result.isError ? 'Tool returned error response' : undefined,
      });

      return await maybeCompressToolResult(result, {
        serverName: serverInfo.name,
        toolName: cleanToolName,
        group,
      });
    } catch (error) {
      const unavailable =
        error instanceof ToolUnavailableError
          ? { message: error.message, reason: error.reason }
          : undefined;
      const activityToolName = getActivityToolNameFromRequest(request);
      logger.error('Error handling CallToolRequest', {
        group,
        username,
        callerId: keyId,
        callerLabel: keyName,
        toolName: activityToolName,
        ...summarizeErrorForLogging(error),
        ...(unavailable ? { decision: 'deny', reason: unavailable.reason } : {}),
      });

      // Log error activity
      const duration = Date.now() - startTime;
      await settleHostedIfNeeded({
        success: false,
        requestContent: getActivityInputFromToolRequest(request),
        responseContent: { error: formatErrorForLogging(error) },
      });
      const serverInfo =
        (typeof extra?.server === 'string' ? getServerByName(extra.server) : undefined) ||
        getServerByTool(activityToolName);
      const cleanToolName = stripToolServerPrefix(activityToolName, serverInfo?.name);

      await activityLogger.logToolCall({
        policy:
          policyAudit ??
          (unavailable ? { decision: 'deny', reason: unavailable.reason } : undefined),
        server: serverInfo?.name || 'unknown',
        tool: cleanToolName,
        duration,
        status: 'error',
        input: getActivityInputFromToolRequest(request),
        group,
        username,
        keyId,
        keyName,
        sourceIp,
        hasCredentialTemplate: hasPersonalAuthentication(serverInfo?.config),
        // An error path can still carry a ref (a staging call that failed after
        // rewriting); the payload rule applies to it as well.
        suppressPayload: containsStagingRef(request.params.arguments),
        // The reason is an internal diagnostic; the caller-facing message stays
        // identical for hidden and nonexistent targets.
        errorMessage: unavailable
          ? `${unavailable.message} (reason: ${unavailable.reason})`
          : formatErrorForLogging(error),
      });

      // For unavailable-target errors, surface exactly the unified message (no
      // error-class name, no reason) so hidden vs nonexistent is indistinguishable.
      const safeErrorText = unavailable ? unavailable.message : formatErrorForLogging(error);

      return {
        content: [
          {
            type: 'text',
            text: `Error: ${safeErrorText}`,
          },
        ],
        isError: true,
      };
    } finally {
      clientStateLease?.release();
      releaseOnDemandToolCall?.();
    }
  };

  return {
    handleListToolsRequestImpl,
    handleCallToolRequestImpl,
    resolvePinnedSmartRoutingServers,
  };
};
