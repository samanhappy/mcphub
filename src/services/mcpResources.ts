import type { RequestOptions } from '@modelcontextprotocol/server';
import type { Client } from '../clients/mcpSdkClient.js';
import type {
  IGroupServerConfig,
  Resource,
  ServerInfo,
  UpstreamResourceTemplate,
} from '../types/index.js';
import type { FilteredGroupServersResult, McpAppsRouteContext } from '../types/mcpRouting.js';
import { getBuiltinResourceDao, getServerDao } from '../dao/index.js';
import { getMcpRequestGroup } from '../utils/mcpRequestGroup.js';
import { combineListFreshness } from '../utils/listFreshness.js';
import { uriMatchesResourceTemplate } from '../utils/resourceTemplateMatch.js';
import { stripMcpAppsMetadata } from '../utils/mcpApps.js';
import { formatErrorForLogging, summarizeErrorForLogging } from '../utils/serialization.js';
import { logger } from '../utils/logger.js';
import { RequestContextService } from './requestContextService.js';
import { revalidateUpstreamList } from './upstreamListRefresh.js';

interface ResourceRoutingDependencies {
  getMcpAppsRouteContext(
    sessionId: string,
    group: string | undefined,
  ): Promise<McpAppsRouteContext>;
  getGroupLookupName(group: string | undefined): string | undefined;
  getFilteredServerInfosForGroup(
    group: string | undefined,
    options?: { requireClient?: boolean },
  ): Promise<FilteredGroupServersResult>;
  getGroupServerConfig(
    group: string | undefined,
    serverName: string,
    config?: IGroupServerConfig,
  ): Promise<IGroupServerConfig | undefined>;
  filterResourcesByGroup(
    group: string | undefined,
    serverName: string,
    resources: Array<{ uri: string }>,
    config?: IGroupServerConfig,
  ): Promise<Array<{ uri: string }>>;
  filterResourceTemplatesByGroup<
    T extends { uriTemplate?: string; _meta?: Record<string, unknown> },
  >(
    group: string | undefined,
    serverName: string,
    templates: T[],
    config?: IGroupServerConfig,
  ): Promise<T[]>;
  isHubSelfConnection(client: Client): boolean;
  updateServerResourceTemplatesCache(
    info: ServerInfo,
    templates: UpstreamResourceTemplate[] | undefined,
  ): void;
  refreshServerResourceTemplatesCache(
    getTarget: () => ServerInfo | undefined,
    client: Client,
    options?: RequestOptions,
  ): Promise<UpstreamResourceTemplate[] | undefined>;
  beginOnDemandToolCall(info: ServerInfo): (() => void) | undefined;
  ensureServerReady(info: ServerInfo): Promise<void>;
}

// Normalize resource payload to avoid nullable DB fields violating MCP schema
export const normalizeResourceForList = (resource: {
  uri: string;
  name?: string | null;
  description?: string | null;
  mimeType?: string | null;
  [key: string]: unknown;
}): Resource => {
  return {
    ...resource,
    uri: resource.uri,
    name: resource.name || '',
    description: resource.description || '',
    mimeType: resource.mimeType || '',
  };
};

/** Resource routing borrows runtimes; lifecycle ownership remains with the MCP service. */
export const createResourceHandlers = (dependencies: ResourceRoutingDependencies) => {
  const {
    getMcpAppsRouteContext,
    getGroupLookupName,
    getFilteredServerInfosForGroup,
    getGroupServerConfig,
    filterResourcesByGroup,
    filterResourceTemplatesByGroup,
    isHubSelfConnection,
    updateServerResourceTemplatesCache,
    refreshServerResourceTemplatesCache,
    beginOnDemandToolCall,
    ensureServerReady,
  } = dependencies;

  const handleListResourcesRequestImpl = async (_: any, extra: any) => {
    const sessionId = extra.sessionId || '';
    const group = getMcpRequestGroup(extra);
    const lookupGroup = getGroupLookupName(group);
    logger.log(`Handling ListResourcesRequest for group: ${group}`);
    const appsRouteContext = await getMcpAppsRouteContext(sessionId, group);

    // Start with built-in resources (only enabled ones)
    const builtinResources = await getBuiltinResourceDao().findEnabled();
    const allResources: any[] = builtinResources.map((br) =>
      normalizeResourceForList({
        uri: br.uri,
        name: br.name,
        description: br.description,
        mimeType: br.mimeType,
      }),
    );

    const { filteredServerInfos, serverConfigsByName } =
      await getFilteredServerInfosForGroup(lookupGroup);

    for (const serverInfo of filteredServerInfos) {
      if (serverInfo.resources && serverInfo.resources.length > 0) {
        // Filter resources based on server configuration
        const serverConfig = await getServerDao().findById(serverInfo.name);

        let enabledResources = serverInfo.resources;
        if (serverConfig && serverConfig.resources) {
          enabledResources = serverInfo.resources.filter((resource: any) => {
            const resourceConfig = serverConfig.resources?.[resource.uri];
            return resourceConfig?.enabled !== false;
          });
        }

        enabledResources = await filterResourcesByGroup(
          lookupGroup,
          serverInfo.name,
          enabledResources,
          serverConfigsByName.get(serverInfo.name),
        );

        // Apply custom descriptions from server configuration
        const resourcesWithCustomDescriptions = enabledResources.map((resource: any) => {
          const resourceConfig = serverConfig?.resources?.[resource.uri];
          const normalizedResource = normalizeResourceForList({
            ...resource,
            description: resourceConfig?.description || resource.description,
          });
          return appsRouteContext.enabled
            ? normalizedResource
            : stripMcpAppsMetadata(normalizedResource);
        });

        allResources.push(...resourcesWithCustomDescriptions);
      }
    }

    return {
      resources: allResources,
    };
  };

  const handleListResourceTemplatesRequestImpl = async (_: any, extra: any) => {
    const sessionId = extra.sessionId || '';
    const group = getMcpRequestGroup(extra);
    const lookupGroup = getGroupLookupName(group);
    logger.log(`Handling ListResourceTemplatesRequest for group: ${group}`);
    const appsRouteContext = await getMcpAppsRouteContext(sessionId, group);

    const { filteredServerInfos, serverConfigsByName } = await getFilteredServerInfosForGroup(
      lookupGroup,
      {
        requireClient: true,
      },
    );

    // A self-connection mirrors this hub's aggregate resource list back into
    // itself. Its capability cache is intentionally empty, but asking it for
    // resource templates would still route the request through this same server
    // and recurse until the request budget runs out. Skip the connection itself
    // and only query real upstreams.
    const templateServerInfos = filteredServerInfos.filter(
      (serverInfo) => !serverInfo.client || !isHubSelfConnection(serverInfo.client),
    );

    const snapshots: object[] = [];
    const results = await Promise.allSettled(
      templateServerInfos.map(async (serverInfo) => {
        if (!serverInfo.client?.listResourceTemplates) {
          return [];
        }

        const client = serverInfo.client;
        const templates = await client.listResourceTemplates({}, serverInfo.options || {});
        snapshots.push(templates.resourceTemplates);
        if (serverInfo.client === client) {
          updateServerResourceTemplatesCache(serverInfo, templates.resourceTemplates);
        }
        const serverConfig = await getServerDao().findById(serverInfo.name);
        const enabledTemplates = (templates.resourceTemplates || []).filter(
          (template) => serverConfig?.resources?.[template.uriTemplate]?.enabled !== false,
        );
        const filteredTemplates = await filterResourceTemplatesByGroup(
          lookupGroup,
          serverInfo.name,
          enabledTemplates,
          serverConfigsByName.get(serverInfo.name),
        );
        return appsRouteContext.enabled
          ? filteredTemplates
          : filteredTemplates.map((template) => stripMcpAppsMetadata(template));
      }),
    );

    const resourceTemplates = results.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    );
    if (
      results.every((result) => result.status === 'fulfilled') &&
      snapshots.length === templateServerInfos.length
    ) {
      combineListFreshness(snapshots, resourceTemplates);
    }
    return { resourceTemplates };
  };

  const TEMPLATE_LIST_RETRY_MS = 60_000;
  const templateListFailedAt = new WeakMap<object, number>();

  const getReadableResourceTemplates = async (
    serverInfo: ServerInfo,
    uri: string,
    lookupGroup: string | undefined,
    groupServerConfig: IGroupServerConfig | undefined,
  ): Promise<UpstreamResourceTemplate[]> => {
    const serverConfig = await getServerDao().findById(serverInfo.name);
    const groupConfig = await getGroupServerConfig(lookupGroup, serverInfo.name, groupServerConfig);
    if (
      serverConfig?.resources?.[uri]?.enabled === false ||
      (Array.isArray(groupConfig?.resources) && groupConfig.resources.length === 0)
    ) {
      return [];
    }
    const client = serverInfo.client;
    // Modern upstreams have no list-changed stream, so honor the templates' own TTL.
    const modern = client?.getProtocolEra?.() === 'modern';
    if (
      (serverInfo.resourceTemplates === undefined || modern) &&
      serverInfo.status === 'connected' &&
      client &&
      (templateListFailedAt.get(client) ?? -Infinity) < Date.now() - TEMPLATE_LIST_RETRY_MS
    ) {
      const refresh = async () => {
        const listed = await refreshServerResourceTemplatesCache(
          () => serverInfo,
          client,
          serverInfo.options,
        );
        if (listed === undefined) {
          templateListFailedAt.set(client, Date.now());
        }
      };
      await (modern ? revalidateUpstreamList(client, 'templates', refresh) : refresh());
    }
    const templates = serverInfo.resourceTemplates;
    if (!templates?.length) {
      return [];
    }
    const enabled = templates.filter(
      (template) => serverConfig?.resources?.[template.uriTemplate]?.enabled !== false,
    );
    if (
      !groupConfig ||
      !Array.isArray(groupConfig.resources) ||
      groupConfig.resources.includes(uri)
    ) {
      return enabled;
    }
    // Listing shows templates under any selected prefix; reading needs the template itself selected.
    const selected = new Set(groupConfig.resources);
    return enabled.filter((template) => selected.has(template.uriTemplate));
  };

  const findResourceTemplateServer = async (
    uri: string,
    lookupGroup: string | undefined,
    filteredServerInfos: ServerInfo[],
    serverConfigsByName: Map<string, IGroupServerConfig>,
  ): Promise<ServerInfo | undefined> => {
    for (const serverInfo of filteredServerInfos) {
      // Idle on-demand servers keep cached templates; the read wakes them.
      const idleOnDemand =
        serverInfo.config?.startOnDemand === true &&
        serverInfo.status === 'disconnected' &&
        !serverInfo.client;
      if (serverInfo.status !== 'connected' && !idleOnDemand) {
        continue;
      }
      const templates = await getReadableResourceTemplates(
        serverInfo,
        uri,
        lookupGroup,
        serverConfigsByName.get(serverInfo.name),
      );
      if (templates.some((template) => uriMatchesResourceTemplate(template.uriTemplate, uri))) {
        return serverInfo;
      }
    }
    return undefined;
  };

  const handleReadResourceRequestImpl = async (request: any, extra: any) => {
    try {
      const { uri } = request.params;
      const sessionId = extra.sessionId || '';
      const group = getMcpRequestGroup(extra);
      const lookupGroup = getGroupLookupName(group);
      const appsRouteContext = await getMcpAppsRouteContext(sessionId, group);

      // Check built-in resources first
      const builtinResource = await getBuiltinResourceDao().findByUri(uri);
      if (builtinResource && builtinResource.enabled !== false) {
        return {
          contents: [
            {
              uri: builtinResource.uri,
              mimeType: builtinResource.mimeType || 'text/plain',
              text: builtinResource.content,
            },
          ],
        };
      }

      const { filteredServerInfos, serverConfigsByName } =
        await getFilteredServerInfosForGroup(lookupGroup);

      let server: ServerInfo | undefined;
      for (const serverInfo of filteredServerInfos) {
        const idleOnDemand =
          serverInfo.config?.startOnDemand === true &&
          serverInfo.status === 'disconnected' &&
          !serverInfo.client;
        if (serverInfo.status !== 'connected' && !idleOnDemand) {
          continue;
        }
        const serverConfig = await getServerDao().findById(serverInfo.name);
        let enabledResources = serverInfo.resources;
        if (serverConfig?.resources) {
          enabledResources = enabledResources.filter(
            (resource) => serverConfig.resources?.[resource.uri]?.enabled !== false,
          );
        }
        enabledResources = await filterResourcesByGroup(
          lookupGroup,
          serverInfo.name,
          enabledResources,
          serverConfigsByName.get(serverInfo.name),
        );
        if (enabledResources.some((resource) => resource.uri === uri)) {
          server = serverInfo;
          break;
        }
      }

      let result: any;
      // A cached SDK body carries its original TTL, not the remaining lifetime.
      // Fetch modern reads afresh so forwarding the TTL cannot renew stale content.
      const readOptions = RequestContextService.getInstance().getRequestContext()?.stateless
        ? { cacheMode: 'bypass' as const }
        : undefined;

      if (server) {
        // A widget URI the upstream also lists in resources/list is read here, not in
        // the fallback loop below, so it needs the same idle guard: otherwise an
        // idle timer armed by an earlier read can close an on-demand upstream while
        // this read is still in flight.
        const releaseOnDemandRead = beginOnDemandToolCall(server);
        try {
          if (server.config?.startOnDemand && !server.client) {
            await ensureServerReady(server);
          }
          server.lastUsedAt = Date.now();
          if (!server.client) throw new Error(`Resource not found: ${uri}`);
          result = readOptions
            ? await server.client.readResource({ uri }, readOptions)
            : await server.client.readResource({ uri });
        } finally {
          releaseOnDemandRead?.();
        }
        if (!result || !Array.isArray(result.contents)) {
          throw new Error(`Failed to read resource: ${uri}`);
        }
      } else if (appsRouteContext.enabled && uri.startsWith('ui://')) {
        // Not pre-registered in resources/list — common for MCP Apps servers
        // that generate ui:// resources dynamically at tool-call time. A
        // single-server route goes straight to that server. A multi-server
        // route has no way to know which upstream owns the URI up front, so
        // probe each connected candidate in turn and use the first one that
        // answers.
        const candidates = appsRouteContext.serverInfo
          ? [appsRouteContext.serverInfo]
          : (appsRouteContext.serverInfos ?? []);

        for (const candidate of candidates) {
          const config = await getServerDao().findById(candidate.name);
          if (config?.resources?.[uri]?.enabled === false) continue;
          const allowed = await filterResourcesByGroup(
            lookupGroup,
            candidate.name,
            [{ uri }],
            serverConfigsByName.get(candidate.name),
          );
          if (allowed.length === 0) continue;
          // An on-demand candidate may be idle yet still advertise its cached widget
          // link, so a host can read the ui:// resource before any tool call has
          // woken it. Hold off its idle shutdown for every read, awake or not, so an
          // armed idle timer or an overlapping read cannot close the server mid-read,
          // then wake it the same way the call path does if it is not running.
          let releaseOnDemandRead: (() => void) | undefined;
          try {
            if (candidate.config?.startOnDemand && candidate.enabled !== false) {
              releaseOnDemandRead = beginOnDemandToolCall(candidate);
              if (!candidate.client) {
                await ensureServerReady(candidate);
              }
              candidate.lastUsedAt = Date.now();
            }
            if (!candidate.client) {
              continue;
            }
            const candidateResult = readOptions
              ? await candidate.client.readResource({ uri }, readOptions)
              : await candidate.client.readResource({ uri });
            if (candidateResult && Array.isArray(candidateResult.contents)) {
              result = candidateResult;
              break;
            }
          } catch {
            // This candidate doesn't own the resource (or failed to wake); try the next one.
          } finally {
            releaseOnDemandRead?.();
          }
        }

        if (!result) {
          throw new Error(`Resource not found: ${uri}`);
        }
      } else {
        const templateServer = await findResourceTemplateServer(
          uri,
          lookupGroup,
          filteredServerInfos,
          serverConfigsByName,
        );
        if (!templateServer) {
          throw new Error(`Resource not found: ${uri}`);
        }
        const releaseOnDemandRead = beginOnDemandToolCall(templateServer);
        try {
          if (templateServer.config?.startOnDemand) {
            if (!templateServer.client) {
              await ensureServerReady(templateServer);
            }
            templateServer.lastUsedAt = Date.now();
          }
          const client = templateServer.client;
          if (!client) {
            throw new Error(`Resource not found: ${uri}`);
          }
          result = readOptions
            ? await client.readResource({ uri }, readOptions)
            : await client.readResource({ uri });
        } finally {
          releaseOnDemandRead?.();
        }
        if (!result || !Array.isArray(result.contents)) {
          throw new Error(`Failed to read resource: ${uri}`);
        }
      }

      return appsRouteContext.enabled
        ? result
        : {
            ...result,
            contents: result.contents.map((content: { _meta?: Record<string, unknown> }) =>
              stripMcpAppsMetadata(content),
            ),
          };
    } catch (error) {
      logger.error('Error handling ReadResourceRequest', summarizeErrorForLogging(error));
      const safeErrorText = formatErrorForLogging(error);
      return {
        contents: [
          {
            uri: request.params?.uri || '',
            mimeType: 'text/plain',
            text: `Error: ${safeErrorText}`,
          },
        ],
      };
    }
  };

  return {
    handleListResourcesRequestImpl,
    handleListResourceTemplatesRequestImpl,
    handleReadResourceRequestImpl,
  };
};
