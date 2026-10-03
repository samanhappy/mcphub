// Freshness is attached to the snapshot, never a server name or projected response.
type Freshness = { expiresAt: number; valid: boolean; dependencies?: Freshness[] };
const expiries = new WeakMap<object, Freshness>();
const isValid = (freshness: Freshness): boolean =>
  freshness.valid && (freshness.dependencies?.every(isValid) ?? true);

export const recordListFreshness = (snapshot: object, ttlMs: unknown, startedAt: number): void => {
  invalidateListFreshness(snapshot);
  expiries.delete(snapshot);
  if (typeof ttlMs === 'number' && Number.isSafeInteger(ttlMs) && ttlMs > 0) {
    expiries.set(snapshot, { expiresAt: startedAt + ttlMs, valid: true });
  }
};

export const remainingListTtl = (
  snapshots: object[],
  projectionStartedAt: number,
  now: number,
): number => {
  if (snapshots.length === 0) return 0;
  let remaining = 5000 - (now - projectionStartedAt);
  for (const snapshot of snapshots) {
    const expiry = expiries.get(snapshot);
    if (!expiry || !isValid(expiry)) return 0;
    remaining = Math.min(remaining, expiry.expiresAt - now);
  }
  return Math.max(0, Math.floor(remaining));
};

export const invalidateListFreshness = (snapshot: object): void => {
  const expiry = expiries.get(snapshot);
  if (expiry) expiry.valid = false;
};

export const preserveListFreshness = <T extends object>(source: object, normalized: T): T => {
  const expiry = expiries.get(source);
  if (expiry) expiries.set(normalized, expiry);
  return normalized;
};

export const combineListFreshness = (sources: object[], projection: object): void => {
  const dependencies = sources.map((source) => expiries.get(source));
  if (dependencies.length === 0 || dependencies.some((entry) => !entry || !isValid(entry))) return;
  const known = dependencies as Freshness[];
  expiries.set(projection, {
    expiresAt: Math.min(...known.map((entry) => entry.expiresAt)),
    valid: true,
    dependencies: known,
  });
};
