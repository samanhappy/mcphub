import type { Server } from '../types';

export const SERVER_TAG_MAX_LENGTH = 64;

export const normalizeTag = (value: string): string => value.trim().replace(/\s+/g, ' ');

export const tagKey = (value: string): string => normalizeTag(value).toLowerCase();

export const getServerTagList = (server: Server): string[] => {
  const tags: unknown = server.config?.tags;
  return Array.isArray(tags) ? tags.filter((tag): tag is string => typeof tag === 'string') : [];
};

export const normalizeTags = (values?: readonly string[]): string[] => {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of Array.isArray(values) ? values : []) {
    if (typeof value !== 'string') continue;
    const tag = normalizeTag(value);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
};

export const serverHasTag = (server: Server, tag: string): boolean => {
  const key = tagKey(tag);
  if (!key) return true;
  return getServerTagList(server).some((value) => tagKey(value) === key);
};

export interface ServerTagOption {
  tag: string;
  count: number;
}

export const getServerTagOptions = (servers: readonly Server[]): ServerTagOption[] => {
  const options = new Map<string, ServerTagOption>();
  for (const server of servers) {
    for (const tag of normalizeTags(getServerTagList(server))) {
      const key = tag.toLowerCase();
      const existing = options.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        options.set(key, { tag, count: 1 });
      }
    }
  }
  return Array.from(options.values()).sort((a, b) =>
    a.tag.localeCompare(b.tag, undefined, { sensitivity: 'base' }),
  );
};

export interface TagFilterOption {
  value: string;
  label: string;
  count: number;
}

export const buildTagFilterOptions = (
  visibleServers: readonly Server[],
  allServers: readonly Server[],
  selectedKey: string,
): TagFilterOption[] => {
  const options = getServerTagOptions(visibleServers).map(({ tag, count }) => ({
    value: tagKey(tag),
    label: tag,
    count,
  }));
  if (selectedKey && !options.some((option) => option.value === selectedKey)) {
    const known = getServerTagOptions(allServers).find(({ tag }) => tagKey(tag) === selectedKey);
    options.push({ value: selectedKey, label: known?.tag ?? selectedKey, count: 0 });
  }
  return options;
};

export const isTagCommitKey = (key: string, isComposing: boolean): boolean =>
  !isComposing && (key === 'Enter' || key === ',');

export const shouldClearTagFilter = (
  selectedKey: string,
  hasLoadedServers: boolean,
  allTagOptions: readonly ServerTagOption[],
): boolean =>
  Boolean(selectedKey) &&
  hasLoadedServers &&
  !allTagOptions.some(({ tag }) => tagKey(tag) === selectedKey);
