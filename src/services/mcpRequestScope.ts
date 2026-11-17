import { AsyncLocalStorage } from 'node:async_hooks';
import type { ServerInfo } from '../types/index.js';

const scope = new AsyncLocalStorage<ServerInfo[]>();

/** Read the request's authorized runtimes before falling back to the global directory. */
export const getRequestServers = (fallback: ServerInfo[]): ServerInfo[] =>
  scope.getStore() ?? fallback;

/** Preserve the parent scope's filtered entries and live authorization projections. */
export const createRequestServerProjection = (fallback: ServerInfo[]): Map<string, ServerInfo> =>
  new Map(getRequestServers(fallback).map((info) => [info.name, info]));

/** Nested discovery and credential projections may replace runtimes, never add servers. */
export const withRequestServers = <T>(servers: ServerInfo[], action: () => T): T => {
  const parent = scope.getStore();
  const allowed = parent && new Set(parent.map((info) => info.name));
  return scope.run(allowed ? servers.filter((info) => allowed.has(info.name)) : servers, action);
};
