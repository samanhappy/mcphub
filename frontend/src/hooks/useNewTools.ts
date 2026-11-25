import { useCallback, useEffect, useState } from 'react';
import {
  getToolNames,
  knownToolsStorageKey,
  readKnownTools,
  reconcileKnownTools,
  writeKnownTools,
  type ToolListSource,
} from '../utils/toolChanges';

const getStore = (): Storage | undefined => {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
};

/**
 * Tools of a server that the current user has not acknowledged yet (#1496).
 *
 * Set `ready` only when the name separator and the user are loaded. Before
 * that, the hook does not read or write the baseline.
 */
export const useNewTools = (
  server: ToolListSource,
  nameSeparator: string,
  username: string | undefined,
  ready: boolean,
) => {
  const key = knownToolsStorageKey(username);
  const [newTools, setNewTools] = useState<string[]>([]);
  const signature = getToolNames(server, nameSeparator).join('\n');

  useEffect(() => {
    if (!ready) return;
    const store = getStore();
    if (!store) return;
    const known = readKnownTools(store, key);
    const result = reconcileKnownTools(known[server.name], server, nameSeparator);
    if (result.known && result.known !== known[server.name]) {
      writeKnownTools(store, key, { ...known, [server.name]: result.known });
    }
    setNewTools(result.newTools);
    // The signature stands in for the tool list, which is a new array on every poll.
  }, [ready, key, server.name, server.enabled, signature, nameSeparator]);

  const acknowledge = useCallback(() => {
    if (!ready) return;
    const store = getStore();
    if (!store) return;
    const known = readKnownTools(store, key);
    writeKnownTools(store, key, { ...known, [server.name]: getToolNames(server, nameSeparator) });
    setNewTools([]);
  }, [ready, key, server.name, signature, nameSeparator]);

  return { newTools, acknowledge };
};
