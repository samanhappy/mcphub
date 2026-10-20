import { getNameSeparator } from '../config/index.js';
import type { ServerConfig } from '../types/index.js';

export type ToolConfig = NonNullable<ServerConfig['tools']>[string];

type InputSchema = Record<string, unknown> | undefined;

const hasKey = (tools: NonNullable<ServerConfig['tools']>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(tools, key);

/**
 * The keys a tool's config may be stored under, given its runtime
 * (server-prefixed) name: that name, then the bare upstream name, which the
 * dashboard and a hand-written settings file use respectively. A runtime name
 * always belongs to its own tool, so the bare fallback is skipped when it is
 * another tool's runtime name: on server `fc` with tools `scrape` and
 * `fc-scrape`, key `fc-scrape` is the runtime name of `scrape`, never the bare
 * name of `fc-scrape`.
 */
const toolConfigKeys = (
  serverName: string,
  runtimeName: string,
  runtimeNames: readonly string[],
): string[] => {
  const bareName = runtimeName.slice(`${serverName}${getNameSeparator()}`.length);
  return runtimeNames.includes(bareName) ? [runtimeName] : [runtimeName, bareName];
};

/**
 * A tool's config, looked up by its runtime name (a bare name is accepted too
 * when it does not start with the server prefix). `runtimeNames` lists the
 * runtime names of the server's tools, to keep one tool from reading another's
 * entry; own keys only.
 */
export const findToolConfig = (
  tools: ServerConfig['tools'] | undefined,
  serverName: string,
  toolName: string,
  runtimeNames: readonly string[] = [],
): ToolConfig | undefined => {
  if (!tools) return undefined;
  const prefix = `${serverName}${getNameSeparator()}`;
  const runtimeName = toolName.startsWith(prefix) ? toolName : `${prefix}${toolName}`;
  const key = toolConfigKeys(serverName, runtimeName, runtimeNames).find((candidate) =>
    hasKey(tools, candidate),
  );
  return key === undefined ? undefined : tools[key];
};

/**
 * The runtime name of the tool a caller means by `toolName`: a runtime name
 * first (what the dashboard sends), else a bare upstream name. Undefined when
 * the server does not list such a tool (e.g. it is not connected).
 */
export const resolveRuntimeToolName = (
  serverName: string,
  toolName: string,
  runtimeNames: readonly string[],
): string | undefined => {
  if (runtimeNames.includes(toolName)) return toolName;
  const prefixed = `${serverName}${getNameSeparator()}${toolName}`;
  return runtimeNames.includes(prefixed) ? prefixed : undefined;
};

/**
 * The key to write a tool's config under. The requested tool is resolved first,
 * then its existing entry is reused under the same keys `findToolConfig` reads,
 * so a description edit or a toggle never creates a second entry that shadows
 * settings stored under the other name, nor writes to another tool's entry. An
 * unresolved tool (server not connected) is written under the name as given.
 */
export const findToolConfigKey = (
  tools: ServerConfig['tools'] | undefined,
  serverName: string,
  toolName: string,
  runtimeNames: readonly string[],
): string => {
  const runtimeName = resolveRuntimeToolName(serverName, toolName, runtimeNames);
  if (!tools || !runtimeName) return toolName;
  return (
    toolConfigKeys(serverName, runtimeName, runtimeNames).find((key) => hasKey(tools, key)) ??
    toolName
  );
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
