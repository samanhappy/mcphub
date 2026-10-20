import { getNameSeparator } from '../config/index.js';
import type { ServerConfig } from '../types/index.js';

export type ToolConfig = NonNullable<ServerConfig['tools']>[string];

type InputSchema = Record<string, unknown> | undefined;

/**
 * Per-tool config is stored under whatever name its writer used: the
 * server-prefixed name (the dashboard) or the bare upstream name (a direct API
 * call, a hand-written settings file). Accept either, own keys only.
 */
export const findToolConfig = (
  tools: ServerConfig['tools'] | undefined,
  serverName: string,
  toolName: string,
): ToolConfig | undefined => {
  if (!tools) return undefined;
  const prefix = `${serverName}${getNameSeparator()}`;
  const bareName = toolName.startsWith(prefix) ? toolName.slice(prefix.length) : toolName;
  for (const key of [`${prefix}${bareName}`, bareName]) {
    if (Object.prototype.hasOwnProperty.call(tools, key)) return tools[key];
  }
  return undefined;
};

/**
 * The key to write a tool's config under: the entry that already exists under
 * any name the tool may be addressed by (as given, server-prefixed, or with one
 * prefix removed), else the name as given. Writing into that entry keeps one
 * entry per tool, so a description edit or a toggle never creates a second entry
 * that shadows settings stored under the other name.
 */
export const findToolConfigKey = (
  tools: ServerConfig['tools'] | undefined,
  serverName: string,
  toolName: string,
): string => {
  if (!tools) return toolName;
  const prefix = `${serverName}${getNameSeparator()}`;
  const candidates = [toolName, `${prefix}${toolName}`];
  if (toolName.startsWith(prefix)) candidates.push(toolName.slice(prefix.length));
  return candidates.find((key) => Object.prototype.hasOwnProperty.call(tools, key)) ?? toolName;
};

/** The configured hidden parameters that take effect: required ones never do. */
export const getEffectiveHiddenParams = (
  inputSchema: InputSchema,
  toolConfig: Pick<ToolConfig, 'hiddenParams'> | undefined,
): string[] => {
  const hidden = toolConfig?.hiddenParams;
  if (!Array.isArray(hidden) || hidden.length === 0) return [];
  const required = Array.isArray(inputSchema?.required) ? (inputSchema.required as unknown[]) : [];
  return hidden.filter((name) => !required.includes(name));
};

/** The input schema without the hidden top-level properties. */
export const hideSchemaParams = <T extends InputSchema>(inputSchema: T, hidden: string[]): T => {
  const properties = inputSchema?.properties;
  if (hidden.length === 0 || !properties || typeof properties !== 'object') return inputSchema;
  const visible = { ...(properties as Record<string, unknown>) };
  for (const name of hidden) delete visible[name];
  return { ...inputSchema, properties: visible };
};

/** The tool as a model sees it: hidden parameters removed from its input schema. */
export const applyHiddenParams = <T extends { inputSchema?: InputSchema }>(
  tool: T,
  toolConfig: Pick<ToolConfig, 'hiddenParams'> | undefined,
): T => {
  const hidden = getEffectiveHiddenParams(tool.inputSchema, toolConfig);
  return hidden.length === 0
    ? tool
    : { ...tool, inputSchema: hideSchemaParams(tool.inputSchema, hidden) };
};

/**
 * Call arguments without the hidden parameters, so a model that guesses one
 * cannot reach it; the upstream default applies instead.
 */
export const removeHiddenArguments = <T>(
  args: T,
  inputSchema: InputSchema,
  toolConfig: Pick<ToolConfig, 'hiddenParams'> | undefined,
): T => {
  const hidden = getEffectiveHiddenParams(inputSchema, toolConfig);
  if (hidden.length === 0 || !args || typeof args !== 'object' || Array.isArray(args)) return args;
  const visible = { ...(args as Record<string, unknown>) };
  for (const name of hidden) delete visible[name];
  return visible as T;
};
