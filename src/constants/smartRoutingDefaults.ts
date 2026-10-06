/**
 * Optional MCP tool fields that search_tools and describe_tool can include in a
 * result next to the name, description, inputSchema and serverName they always
 * carry. Listed in the order they appear in a result.
 */
export const TOOL_DEFINITION_FIELDS = [
  'title',
  'annotations',
  'outputSchema',
  'execution',
  'icons',
  '_meta',
] as const;

export type ToolDefinitionField = (typeof TOOL_DEFINITION_FIELDS)[number];

/**
 * Fields included by default: short, and they help a model pick a tool
 * (annotations carry readOnlyHint / destructiveHint). The rest are for clients
 * rather than models and can be large (base64 icons, output schemas).
 */
export const DEFAULT_TOOL_DEFINITION_FIELDS: readonly ToolDefinitionField[] = [
  'title',
  'annotations',
];
