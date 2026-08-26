/**
 * Pre-save OpenAPI tool statistics for the import preview (#1082).
 *
 * Importing a large OpenAPI document can silently produce a tools/list larger
 * than a model's context window. This service measures what the import *would*
 * generate — tool count, definition payload size and a token estimate —
 * without persisting anything, so the form can surface the numbers before the
 * user confirms.
 *
 * Token estimation reuses the Context Footprint estimator (cl100k via
 * gpt-tokenizer) so preview numbers agree with the per-server footprint shown
 * elsewhere in the dashboard.
 */
import { OpenAPIClient } from '../clients/openapi.js';
import type { ServerConfig, OpenApiToolStats } from '../types/index.js';
import { itemCostForTool } from '../utils/tokenCost.js';

export async function previewOpenApiToolStats(
  config: ServerConfig,
): Promise<OpenApiToolStats> {
  // Throwaway client: initialize() fetches (or parses) the spec, dereferences
  // it and runs extractTools() — exactly what a real connection would do. No
  // DAO writes happen here; persistOAuth2Token is left unset so any token
  // refresh result stays in-memory only.
  const client = new OpenAPIClient(config);
  await client.initialize();

  const tools = client.getTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema,
  }));

  const items = await Promise.all(tools.map((tool) => itemCostForTool(tool)));

  return {
    toolCount: tools.length,
    definitionsBytes: Buffer.byteLength(JSON.stringify(tools)),
    estimatedTokens: items.reduce((sum, item) => sum + item.cost, 0),
    // Effective security requirement the spec declares, for form prefill (#1077).
    declaredSecurity: client.getDeclaredSecurity(),
  };
}
