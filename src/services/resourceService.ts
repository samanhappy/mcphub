import { ReadResourceRequestSchema, ListResourcesRequestSchema, ListResourceTemplatesRequestSchema, Resource, ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";
import { ServerInfo } from "../types/index.js";
import { getGroupByIdOrName } from "./groupService.js";

export async function handleListResourcesRequest(
  serverInfos: ServerInfo[],
  request: typeof ListResourcesRequestSchema._type,
  extra: { sessionId: string }
) {
  const group = getGroupByIdOrName(extra.sessionId);
  const targetServers = serverInfos.filter(
    (s) => s.client && s.status === 'connected' && (!group || group.servers.includes(s.name))
  );

  const allResources: Resource[] = [];
  for (const serverInfo of targetServers) {
    if (serverInfo.client) {
      const { resources } = await serverInfo.client.listResources()
        .catch(() => ({ resources: [] }))
      allResources.push(...resources);
    }
  }
  return { resources: allResources };
}

export async function handleListResourceTemplatesRequest(
  serverInfos: ServerInfo[],
  request: typeof ListResourceTemplatesRequestSchema._type,
  extra: { sessionId: string }
) {
  const group = getGroupByIdOrName(extra.sessionId);
  const targetServers = serverInfos.filter(
    (s) => s.client && s.status === 'connected' && (!group || group.servers.includes(s.name))
  );

  const allResourceTemplates: ResourceTemplate[] = [];
  for (const serverInfo of targetServers) {
    if (serverInfo.client) {
      const { resourceTemplates } = await serverInfo.client.listResourceTemplates()
        .catch(() => ({ resourceTemplates: [] }));
      allResourceTemplates.push(...resourceTemplates);
    }
  }
  return { resourceTemplates: allResourceTemplates };
}

export async function handleReadResourceRequest(
  serverInfos: ServerInfo[],
  request: typeof ReadResourceRequestSchema._type,
  extra: { sessionId: string }
) {



  const uri = request.params.uri;
  const group = getGroupByIdOrName(extra.sessionId);
  const targetServers = serverInfos.filter(
    (s) => s.client && s.status === 'connected' && (!group || group.servers.includes(s.name))
  );

  const promises = targetServers.map(serverInfo => {
    if (serverInfo.client) {
      return serverInfo.client.readResource({ uri });
    }
    return Promise.reject(new Error(`Server not connected: ${serverInfo.name}`));
  });

  const results = await Promise.allSettled(promises);

  for (const result of results) {
    if (result.status === 'fulfilled') {
      return result.value;
    }
  }

  throw new Error("Resource not found");
}