import { createAuthClient } from 'better-auth/react';
import { getBasePath } from '../utils/runtime';

const normalizePath = (value: string): string => {
  if (!value) {
    return '/api/auth/better';
  }
  return value.startsWith('/') ? value : `/${value}`;
};

const resolveBaseUrl = (basePathOverride?: string): string => {
  if (typeof window === 'undefined') {
    return '';
  }
  const basePath = getBasePath();
  const authPath = normalizePath(basePathOverride || '/api/auth/better');
  return `${window.location.origin}${basePath}${authPath}`;
};

export const createBetterAuthClient = (basePathOverride?: string) =>
  createAuthClient({
    baseURL: resolveBaseUrl(basePathOverride),
    fetchOptions: {
      credentials: 'include',
    },
  });

export const authClient = createBetterAuthClient();
