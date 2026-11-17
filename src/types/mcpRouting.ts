import type { Transport } from '@modelcontextprotocol/server';
import type { Client } from '../clients/mcpSdkClient.js';
import type { IGroupServerConfig, ServerInfo } from './index.js';

export type McpAppsRouteContext = {
  enabled: boolean;
  // Set when the route has exactly one eligible MCP upstream (including idle on-demand).
  // Used for Apps resource routing and legacy unqualified aggregate calls.
  serverInfo?: ServerInfo;
  // Eligible MCP upstreams on an aggregate route. Tool names stay qualified
  // (server::tool), even when other configured upstreams use OpenAPI or their
  // personal runtimes have not been acquired for this request, so
  // calls can still be routed unambiguously; Apps metadata and app-only
  // tools are still surfaced, unlike ordinary (non-Apps) group routes.
  serverInfos?: ServerInfo[];
};

export type FilteredGroupServersResult = {
  filteredServerInfos: ServerInfo[];
  serverConfigsByName: Map<string, IGroupServerConfig>;
};

export type IsolatedClientContext = {
  sessionId: string;
  client: Client;
  transport: Transport;
};
