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
