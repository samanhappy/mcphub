/**
 * Token cost estimation for the Context Footprint feature.
 *
 * Estimates a Definition Cost — the tokens a tool/prompt/resource definition
 * adds to a model's context window — using cl100k_base via gpt-tokenizer.
 * This is an ESTIMATE for relative comparison, not a per-client-model exact
 * count. See docs/adr/0001-cl100k-tokenizer-for-definition-cost.md.
 */
import type { Tool, Prompt, Resource, ItemCost } from '../types/index.js';

// Lazily-loaded cl100k encoder (matches the dynamic-import pattern in tokenTruncation.ts,
// which is proven to work under the ts-jest ESM preset). Cache the import promise itself
// so concurrent callers share a single in-flight import instead of each firing their own.
let encoderPromise: Promise<(text: string) => number[]> | null = null;

function getEncoder(): Promise<(text: string) => number[]> {
  if (!encoderPromise) {
    encoderPromise = import('gpt-tokenizer').then((mod) => mod.encode);
  }
  return encoderPromise;
}

/** Count cl100k tokens in a string. */
export async function countTokens(text: string): Promise<number> {
  const encode = await getEncoder();
  return encode(text).length;
}

/**
 * Serialize a tool definition to the JSON a client forwards to the model:
 * name + description + full inputSchema. Deterministic key order.
 */
export function serializeToolDefinition(tool: Pick<Tool, 'name' | 'description' | 'inputSchema'>): string {
  return JSON.stringify({
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: tool.inputSchema ?? {},
  });
}

export function serializePromptDefinition(
  prompt: Pick<Prompt, 'name' | 'description' | 'arguments'>,
): string {
  return JSON.stringify({
    name: prompt.name,
    description: prompt.description ?? '',
    arguments: prompt.arguments ?? [],
  });
}

export function serializeResourceDefinition(
  resource: Pick<Resource, 'uri' | 'name' | 'description' | 'mimeType'>,
): string {
  return JSON.stringify({
    uri: resource.uri,
    name: resource.name ?? '',
    description: resource.description ?? '',
    mimeType: resource.mimeType ?? '',
  });
}

const isExposed = (enabled: boolean | undefined): boolean => enabled !== false;

export async function itemCostForTool(tool: Tool): Promise<ItemCost> {
  return {
    kind: 'tool',
    name: tool.name,
    cost: await countTokens(serializeToolDefinition(tool)),
    enabled: isExposed(tool.enabled),
  };
}

// NOTE: The base Prompt and Resource interfaces in src/types/index.ts do not carry an
// `enabled` field (that lives on BuiltinPrompt / BuiltinResource). The functions below
// accept an intersection with `{ enabled?: boolean }` so callers can pass enriched
// objects without losing type safety.
export async function itemCostForPrompt(prompt: Prompt & { enabled?: boolean }): Promise<ItemCost> {
  return {
    kind: 'prompt',
    name: prompt.name,
    cost: await countTokens(serializePromptDefinition(prompt)),
    enabled: isExposed(prompt.enabled),
  };
}

export async function itemCostForResource(resource: Resource & { enabled?: boolean }): Promise<ItemCost> {
  return {
    kind: 'resource',
    name: resource.uri,
    cost: await countTokens(serializeResourceDefinition(resource)),
    enabled: isExposed(resource.enabled),
  };
}
