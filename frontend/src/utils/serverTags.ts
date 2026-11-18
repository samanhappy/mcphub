import type { Server } from '../types';

export const SERVER_TAG_MAX_LENGTH = 64;

export const normalizeTag = (value: string): string => value.trim().replace(/\s+/g, ' ');

export const normalizeTags = (values?: readonly string[]): string[] => {
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const value of values ?? []) {
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
  const key = tag.trim().toLowerCase();
  if (!key) return true;
  return (server.config?.tags ?? []).some((value) => value.toLowerCase() === key);
};

export interface ServerTagOption {
  tag: string;
  count: number;
}

export const getServerTagOptions = (servers: readonly Server[]): ServerTagOption[] => {
  const options = new Map<string, ServerTagOption>();
  for (const server of servers) {
    for (const tag of normalizeTags(server.config?.tags)) {
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
