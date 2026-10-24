// Freshness and in-flight work belong to a specific client, never a server name:
// isolated sessions and personal credentials must not share discovery results.
export type UpstreamList = 'tools' | 'prompts' | 'resources' | 'templates';
type ListState = { expiresAt: number; pending?: Promise<void> };
export const upstreamListOwner = Symbol('upstreamListOwner');
const ownerOf = (client: object): object => Reflect.get(client, upstreamListOwner) ?? client;
const clients = new WeakMap<object, Map<UpstreamList, ListState>>();
const stateFor = (client: object, list: UpstreamList): ListState => {
  client = ownerOf(client);
  let lists = clients.get(client);
  if (!lists) clients.set(client, (lists = new Map()));
  let state = lists.get(list);
  if (!state) lists.set(list, (state = { expiresAt: 0 }));
  return state;
};

export const recordUpstreamList = (
  client: object,
  list: UpstreamList,
  ttlMs: unknown,
  startedAt: number,
): void => {
  stateFor(client, list).expiresAt =
    typeof ttlMs === 'number' && Number.isSafeInteger(ttlMs) && ttlMs > 0 ? startedAt + ttlMs : 0;
};

export const clearUpstreamLists = (client: object): void => {
  clients.delete(ownerOf(client));
};

export const revalidateUpstreamList = async (
  client: object,
  list: UpstreamList,
  refresh: () => Promise<void>,
): Promise<void> => {
  const state = stateFor(client, list);
  if (state.pending) return state.pending;
  if (state.expiresAt > performance.now()) return;
  const pending = refresh();
  state.pending = pending;
  try {
    await pending;
  } finally {
    if (state.pending === pending) state.pending = undefined;
  }
};
