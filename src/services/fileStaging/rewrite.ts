import type { ServerConfig } from '../../types/index.js';
import { StagingError } from './types.js';

/**
 * Argument rewrite for a staging-enabled tool call (#1056).
 *
 * Only exact `mcpfile://<uuid>` values in the tool's declared input/output
 * parameters are touched. A ref anywhere else is rejected rather than guessed
 * at, and the hub never scans or rewrites the tool's response.
 */

export interface StagingCallTarget {
  serverName: string;
  serverId: string;
  toolName: string;
  config: ServerConfig;
  inputParams: readonly string[];
  outputParams: readonly string[];
}

export interface RewritePlan {
  inputRefs: string[];
  outputRefs: string[];
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Walk every string value so an undeclared `mcpfile://` ref is never ignored. */
const findRefStrings = (value: unknown, path = ''): Array<{ path: string; value: string }> => {
  if (typeof value === 'string') {
    return value.trim().startsWith('mcpfile://') ? [{ path, value: value.trim() }] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) =>
      findRefStrings(entry, path ? `${path}.${index}` : `${index}`),
    );
  }
  if (isPlainObject(value)) {
    return Object.entries(value).flatMap(([key, entry]) =>
      findRefStrings(entry, path ? `${path}.${key}` : key),
    );
  }
  return [];
};

/**
 * Validate that every ref appears in a declared parameter with the matching
 * direction. Returns the refs split by direction; throws on a mismatch.
 */
export const planRewrite = (
  args: Record<string, unknown> | undefined,
  inputParams: readonly string[],
  outputParams: readonly string[],
): RewritePlan => {
  const refs = findRefStrings(args ?? {});
  if (refs.length === 0) return { inputRefs: [], outputRefs: [] };
  const seen = new Set<string>();
  const inputRefs: string[] = [];
  const outputRefs: string[] = [];
  for (const entry of refs) {
    if (seen.has(entry.value)) {
      throw new StagingError('invalid-ref', 'The same staging reference was used twice');
    }
    seen.add(entry.value);
    if (inputParams.includes(entry.path)) {
      inputRefs.push(entry.value);
    } else if (outputParams.includes(entry.path)) {
      outputRefs.push(entry.value);
    } else {
      throw new StagingError(
        'invalid-ref',
        `A staging reference is not allowed in parameter "${entry.path}"`,
      );
    }
  }
  return { inputRefs, outputRefs };
};

/** Replace each stated ref with the absolute content path handed to the child. */
export const applyRewrite = (
  args: Record<string, unknown>,
  paths: ReadonlyMap<string, string>,
): Record<string, unknown> => {
  const cloned = structuredClone(args);
  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      return paths.get(node.trim()) ?? node;
    }
    if (Array.isArray(node)) return node.map(walk);
    if (isPlainObject(node)) {
      return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, walk(value)]));
    }
    return node;
  };
  return walk(cloned) as Record<string, unknown>;
};
