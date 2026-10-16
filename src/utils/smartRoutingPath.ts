import type { RequestHandler } from 'express';
import type { McpSettings } from '../types/index.js';

export const getSmartRoutingPath = (): string => {
  const value = process.env.SMART_ROUTING_PATH ?? '$smart';
  if (value !== '$smart' && !/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
    throw new Error(
      'SMART_ROUTING_PATH must be a single path segment of 1-64 letters, digits, hyphens or underscores',
    );
  }
  return value;
};

export const getSmartRoutingNameError = (name?: string): string | undefined => {
  const path = getSmartRoutingPath();
  return path !== '$smart' && name === path
    ? `Name "${name}" is reserved by SMART_ROUTING_PATH`
    : undefined;
};

export const assertSmartRoutingNameAvailable = (name?: string): void => {
  const error = getSmartRoutingNameError(name);
  if (error) throw new Error(error);
};

export const assertSmartRoutingSettingsAvailable = (settings: McpSettings): void => {
  for (const name of Object.keys(settings.mcpServers || {})) assertSmartRoutingNameAvailable(name);
  for (const group of settings.groups || []) {
    assertSmartRoutingNameAvailable(group.name);
    assertSmartRoutingNameAvailable(group.id);
  }
};

export const normalizeSmartRoutingGroup = (group?: string): string | undefined => {
  const path = getSmartRoutingPath();
  if (group === path) return '$smart';
  if (group?.startsWith(`${path}/`)) return `$smart/${group.slice(path.length + 1)}`;
  return group;
};

// Normalize route params before user context, bearer scope and session checks; preserve the OAuth resource URL.
export const smartRoutingPathMiddleware: RequestHandler = (req, _res, next) => {
  const group = normalizeSmartRoutingGroup(req.params.group);
  if (group !== undefined) req.params.group = group;
  next();
};
