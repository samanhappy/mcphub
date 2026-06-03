import type { Tool } from '../types/index.js';

export const MCP_APPS_EXTENSION_ID = 'io.modelcontextprotocol/ui';
export const MCP_APPS_MIME_TYPE = 'text/html;profile=mcp-app';

export const MCP_APPS_CAPABILITIES = {
  experimental: {
    [MCP_APPS_EXTENSION_ID]: {
      mimeTypes: [MCP_APPS_MIME_TYPE],
    },
  },
};

const toRecord = (value: unknown): Record<string, unknown> | undefined => {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
};

export const hasMcpAppsCapability = (capabilities: unknown): boolean => {
  const capabilityRecord = toRecord(capabilities);
  const extension =
    toRecord(capabilityRecord?.experimental)?.[MCP_APPS_EXTENSION_ID] ??
    toRecord(capabilityRecord?.extensions)?.[MCP_APPS_EXTENSION_ID];
  const mimeTypes = toRecord(extension)?.mimeTypes;
  return Array.isArray(mimeTypes) && mimeTypes.includes(MCP_APPS_MIME_TYPE);
};

export const isAppOnlyTool = (tool: Pick<Tool, '_meta'>): boolean => {
  const visibility = toRecord(toRecord(tool._meta)?.ui)?.visibility;
  return Array.isArray(visibility) && !visibility.includes('model');
};

export const filterModelVisibleTools = <T extends Pick<Tool, '_meta'>>(tools: T[]): T[] => {
  return tools.filter((tool) => !isAppOnlyTool(tool));
};

export const stripMcpAppsMetadata = <T extends { _meta?: Record<string, unknown> }>(
  value: T,
): T => {
  if (!value._meta || (!('ui' in value._meta) && !('ui/resourceUri' in value._meta))) {
    return value;
  }

  const { ui: _ui, ['ui/resourceUri']: _resourceUri, ...rest } = value._meta;
  const nextValue = { ...value };
  if (Object.keys(rest).length > 0) {
    nextValue._meta = rest;
  } else {
    delete nextValue._meta;
  }
  return nextValue;
};
