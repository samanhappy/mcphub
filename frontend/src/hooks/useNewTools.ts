import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getToolNames,
  knownToolsFor,
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
  // The tool list is a new array on every poll, so compare it by value.
  const signature = JSON.stringify(getToolNames(server, nameSeparator));
  const toolNames = useMemo<string[]>(() => JSON.parse(signature), [signature]);
  const serverName = server.name;
  const enabled = server.enabled;

  useEffect(() => {
    if (!ready) return;
    const store = getStore();
    if (!store) return;
    const known = readKnownTools(store, key);
    const previous = knownToolsFor(known, serverName);
    const result = reconcileKnownTools(previous, toolNames, enabled);
    if (result.known && result.known !== previous) {
      writeKnownTools(store, key, { ...known, [serverName]: result.known });
    }
    setNewTools(result.newTools);
  }, [ready, key, serverName, enabled, toolNames]);

  const acknowledge = useCallback(() => {
    if (!ready) return;
    const store = getStore();
    if (!store) return;
    const known = readKnownTools(store, key);
    writeKnownTools(store, key, { ...known, [serverName]: toolNames });
    setNewTools([]);
  }, [ready, key, serverName, toolNames]);

  return { newTools, acknowledge };
};
