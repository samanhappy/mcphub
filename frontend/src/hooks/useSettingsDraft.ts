import { useCallback, useMemo, useState } from 'react';

export interface SettingsDraftController<T extends Record<string, unknown>> {
  /** Current effective form values: user draft merged over latest remote values. */
  values: T;
  /** True when at least one edited field differs from the latest remote value. */
  dirty: boolean;
  /** Only the fields explicitly edited by the user whose value differs from remote. */
  dirtyFields: Partial<T>;
  /** Update a single field in the local draft. */
  setField: <K extends keyof T>(key: K, value: T[K]) => void;
  /** Update multiple fields atomically in the local draft. */
  patchFields: (patch: Partial<T>) => void;
  /** Discard all local edits and revert to the latest remote values. */
  discard: () => void;
}

/**
 * Pure helper to merge local user edits on top of the latest remote values.
 * Keeping only explicitly touched fields in `draft` ensures that an unrelated
 * remote update (for example toggling an immediate switch in the same section)
 * never overwrites or wipes the user's unsaved text inputs.
 */
export function mergeDraftValues<T extends Record<string, unknown>>(
  remote: T,
  draft: Partial<T>,
): T {
  const keys = Object.keys(draft) as Array<keyof T>;
  if (keys.length === 0) {
    return remote;
  }
  return { ...remote, ...draft };
}

/**
 * Computes only the draft entries that actually differ from `remote`.
 */
export function computeDirtyFields<T extends Record<string, unknown>>(
  remote: T,
  draft: Partial<T>,
): Partial<T> {
  const dirty: Partial<T> = {};
  for (const key of Object.keys(draft) as Array<keyof T>) {
    if (!Object.is(draft[key], remote[key])) {
      dirty[key] = draft[key];
    }
  }
  return dirty;
}

/**
 * Manages section-local form draft state without resetting user edits when
 * unrelated remote config fields update (e.g., from an immediate Switch toggle).
 */
export function useSettingsDraft<T extends Record<string, unknown>>(
  remote: T,
): SettingsDraftController<T> {
  const [draft, setDraft] = useState<Partial<T>>({});

  const values = useMemo(() => mergeDraftValues(remote, draft), [remote, draft]);
  const dirtyFields = useMemo(() => computeDirtyFields(remote, draft), [remote, draft]);
  const dirty = useMemo(() => Object.keys(dirtyFields).length > 0, [dirtyFields]);

  const setField = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }, []);

  const patchFields = useCallback((patch: Partial<T>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  const discard = useCallback(() => {
    setDraft({});
  }, []);

  return {
    values,
    dirty,
    dirtyFields,
    setField,
    patchFields,
    discard,
  };
}
