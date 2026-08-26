/** Display helpers for the Context Footprint feature. */

/** Compact token formatting: 940 -> "940", 4200 -> "4.2k". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

/** Integer percent reduction from `direct` to `smart`, clamped to [0, 100]. */
export function percentSaved(direct: number, smart: number): number {
  if (direct <= 0) return 0;
  const pct = Math.round(((direct - smart) / direct) * 100);
  return Math.max(0, Math.min(100, pct));
}

/**
 * Threshold above which an OpenAPI import preview warns that the generated
 * tool list may not fit a model's context window (#1082). ~100k tokens of
 * tool definitions leaves little room in common 128k–200k windows once the
 * system prompt and conversation are counted.
 */
export const OPENAPI_STATS_WARN_TOKENS = 100_000;

/** Human-readable byte size: 366457 -> "357.9 KB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
