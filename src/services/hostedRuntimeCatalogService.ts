import { getNameSeparator } from '../config/index.js';
import { getServersInfo } from './mcpService.js';
import { getHostedNodeIdentity } from './hostedNodeIdentity.js';
import { stripRuntimeToolName } from './hostedRuntimeCatalogNames.js';
import { filterModelVisibleTools } from '../utils/mcpApps.js';

export interface HostedRuntimeTool {
  name: string;
  publicName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  enabled: boolean;
}

export interface HostedRuntimeServer {
  slug: string;
  status: string;
  enabled: boolean;
  description: string;
  version?: string;
  instructions?: string;
  error: string | null;
  tools: HostedRuntimeTool[];
}

export interface HostedRuntimeCatalog {
  clusterId: string;
  nodeId: string;
  nameSeparator: string;
  servers: HostedRuntimeServer[];
}

export async function getHostedRuntimeCatalog(): Promise<HostedRuntimeCatalog> {
  const identity = getHostedNodeIdentity();
  const nameSeparator = getNameSeparator();
  const servers = await getServersInfo();

  return {
    clusterId: identity.clusterId ?? 'default',
    nodeId: identity.nodeId,
    nameSeparator,
    servers: servers.map((server) => ({
      slug: server.name,
      status: server.status,
      enabled: server.enabled !== false,
      description: server.config?.description ?? '',
      version: server.version,
      instructions: server.instructions,
      error: server.error,
      tools: filterModelVisibleTools(server.tools).map((tool) => ({
        name: stripRuntimeToolName(server.name, tool.name, nameSeparator),
        publicName: tool.name,
        description: tool.description ?? '',
        inputSchema: tool.inputSchema ?? {},
        enabled: tool.enabled !== false,
      })),
    })),
  };
}
