import type { ServerConfig, Tool, ToolInputSchema } from '../types';

export type StagingAdapterValue = '' | 'ssh';
export type FileStagingParamRole = 'none' | 'input' | 'output';

export interface StagingParamCandidate {
  path: string;
  description?: string;
  required: boolean;
}

export interface FileStagingParamOption extends StagingParamCandidate {
  hidden: boolean;
  stale: boolean;
}

export interface ServerStagingPatchPayload {
  adapter?: 'ssh' | null;
  shared?: boolean;
}

export interface ToolFileStagingPatchPayload {
  tool: string;
  enabled: boolean;
  inputParams?: string[] | null;
  outputParams?: string[] | null;
}

const MAX_SCHEMA_DEPTH = 8;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Walk a tool's JSON Schema `properties` and return dot-path leaf parameters
 * that can carry an `mcpfile://` string reference (string or untyped leaves).
 * Mirrors the backend's `schemaTypeAt` check in `src/services/fileStaging/dispatch.ts`.
 */
export const extractStagingParamCandidates = (
  inputSchema?: ToolInputSchema | null,
): StagingParamCandidate[] => {
  const rootProps = inputSchema?.properties;
  if (!isPlainObject(rootProps)) {
    return [];
  }

  const results: StagingParamCandidate[] = [];

  const walk = (
    properties: Record<string, unknown>,
    requiredList: readonly string[],
    prefix: string,
    depth: number,
  ) => {
    if (depth > MAX_SCHEMA_DEPTH) return;
    for (const [key, rawNode] of Object.entries(properties)) {
      const path = prefix ? `${prefix}.${key}` : key;
      const required = requiredList.includes(key);
      if (!isPlainObject(rawNode)) {
        continue;
      }

      const rawType = rawNode.type;
      const nestedProps = isPlainObject(rawNode.properties) ? rawNode.properties : undefined;
      const hasNestedProps = Boolean(nestedProps && Object.keys(nestedProps).length > 0);

      if (hasNestedProps && (rawType === 'object' || rawType === undefined)) {
        const nestedRequired = Array.isArray(rawNode.required)
          ? rawNode.required.filter((item): item is string => typeof item === 'string')
          : [];
        walk(nestedProps!, nestedRequired, path, depth + 1);
        continue;
      }

      // Eligible if declared as string or untyped (no string `type` field).
      if (rawType === 'string' || typeof rawType !== 'string') {
        results.push({
          path,
          description: typeof rawNode.description === 'string' ? rawNode.description : undefined,
          required,
        });
      }
    }
  };

  const rootRequired = Array.isArray(inputSchema?.required) ? inputSchema.required : [];
  walk(rootProps, rootRequired, '', 0);
  return results;
};

const isParamHidden = (path: string, hiddenParams: readonly string[]): boolean => {
  if (hiddenParams.length === 0) return false;
  const topLevel = path.split('.')[0];
  return hiddenParams.includes(path) || hiddenParams.includes(topLevel);
};

/**
 * Build the list of parameter rows for the tool file staging editor, combining
 * eligible schema properties with any already-configured stale parameters that
 * no longer match the live schema.
 */
export const buildStagingParamOptions = (
  inputSchema: ToolInputSchema | null | undefined,
  fileStaging: Tool['fileStaging'] | undefined,
  hiddenParams: readonly string[] = [],
): FileStagingParamOption[] => {
  const candidates = extractStagingParamCandidates(inputSchema);
  const seen = new Set<string>();
  const options: FileStagingParamOption[] = [];

  for (const candidate of candidates) {
    seen.add(candidate.path);
    options.push({
      ...candidate,
      hidden: isParamHidden(candidate.path, hiddenParams),
      stale: false,
    });
  }

  const configured = [
    ...(fileStaging?.inputParams ?? []),
    ...(fileStaging?.outputParams ?? []),
  ];
  for (const path of configured) {
    if (seen.has(path)) continue;
    seen.add(path);
    options.push({
      path,
      required: false,
      hidden: isParamHidden(path, hiddenParams),
      stale: true,
    });
  }

  return options;
};

export const buildParamRoleMap = (
  fileStaging?: Tool['fileStaging'],
): Record<string, FileStagingParamRole> => {
  const map: Record<string, FileStagingParamRole> = {};
  for (const param of fileStaging?.inputParams ?? []) {
    map[param] = 'input';
  }
  for (const param of fileStaging?.outputParams ?? []) {
    map[param] = 'output';
  }
  return map;
};

const sortedUnique = (values: readonly string[] | undefined): string[] =>
  Array.from(new Set(values ?? [])).sort();

/**
 * Canonical value key for a tool's stored `fileStaging` config. Used to drive
 * React sync effects by value rather than object identity so background server
 * polling (which deserializes fresh objects on every tick) never wipes unsaved
 * editor drafts or inline errors.
 */
export const getToolFileStagingSyncKey = (
  serverName: string,
  toolName: string,
  fileStaging?: Tool['fileStaging'],
): string =>
  JSON.stringify({
    serverName,
    toolName,
    enabled: fileStaging?.enabled === true,
    inputParams: sortedUnique(fileStaging?.inputParams),
    outputParams: sortedUnique(fileStaging?.outputParams),
  });

/**
 * Canonical value key for a server's stored `staging` config.
 */
export const getServerStagingSyncKey = (
  serverName: string,
  staging?: ServerConfig['staging'],
): string =>
  JSON.stringify({
    serverName,
    adapter: staging?.adapter ?? '',
    shared: staging?.shared === true,
  });

const arraysEqual = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((val, idx) => val === b[idx]);

export const isToolFileStagingDirty = (
  draftEnabled: boolean,
  draftRoles: Record<string, FileStagingParamRole>,
  initialFileStaging?: Tool['fileStaging'],
): boolean => {
  const initialEnabled = initialFileStaging?.enabled === true;
  if (draftEnabled !== initialEnabled) return true;

  const draftInputs = sortedUnique(
    Object.entries(draftRoles)
      .filter(([, role]) => role === 'input')
      .map(([path]) => path),
  );
  const draftOutputs = sortedUnique(
    Object.entries(draftRoles)
      .filter(([, role]) => role === 'output')
      .map(([path]) => path),
  );

  return (
    !arraysEqual(draftInputs, sortedUnique(initialFileStaging?.inputParams)) ||
    !arraysEqual(draftOutputs, sortedUnique(initialFileStaging?.outputParams))
  );
};

export const buildToolFileStagingPayload = (
  toolName: string,
  draftEnabled: boolean,
  draftRoles: Record<string, FileStagingParamRole>,
  initialFileStaging?: Tool['fileStaging'],
): ToolFileStagingPatchPayload => {
  const inputParams = Object.entries(draftRoles)
    .filter(([, role]) => role === 'input')
    .map(([path]) => path);
  const outputParams = Object.entries(draftRoles)
    .filter(([, role]) => role === 'output')
    .map(([path]) => path);

  const payload: ToolFileStagingPatchPayload = {
    tool: toolName,
    enabled: draftEnabled,
  };

  if (inputParams.length > 0) {
    payload.inputParams = inputParams;
  } else if (initialFileStaging?.inputParams?.length) {
    payload.inputParams = null;
  }

  if (outputParams.length > 0) {
    payload.outputParams = outputParams;
  } else if (initialFileStaging?.outputParams?.length) {
    payload.outputParams = null;
  }

  return payload;
};

export const isServerStagingDirty = (
  draftAdapter: StagingAdapterValue,
  draftShared: boolean,
  initialStaging: ServerConfig['staging'] | undefined,
  isAdmin: boolean,
): boolean => {
  const initialAdapter: StagingAdapterValue = initialStaging?.adapter ?? '';
  if (draftAdapter !== initialAdapter) return true;
  if (isAdmin && draftShared !== Boolean(initialStaging?.shared)) return true;
  return false;
};

export const buildServerStagingPayload = (
  draftAdapter: StagingAdapterValue,
  draftShared: boolean,
  initialStaging: ServerConfig['staging'] | undefined,
  isAdmin: boolean,
): ServerStagingPatchPayload => {
  const payload: ServerStagingPatchPayload = {};
  const initialAdapter: StagingAdapterValue = initialStaging?.adapter ?? '';
  const initialShared = Boolean(initialStaging?.shared);

  if (draftAdapter !== initialAdapter) {
    payload.adapter = draftAdapter === '' ? null : draftAdapter;
  }

  if (isAdmin && draftShared !== initialShared) {
    payload.shared = draftShared;
  }

  return payload;
};
