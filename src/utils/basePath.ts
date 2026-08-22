export const normalizeBasePath = (value?: string | null): string => {
  const trimmed = value?.trim() ?? '';
  if (!trimmed || trimmed === '/') {
    return '';
  }

  const withLeadingSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withLeadingSlash.replace(/\/+$/, '');
};

export const joinBasePath = (basePath: string | undefined | null, route: string): string => {
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  return `${normalizeBasePath(basePath)}${normalizedRoute}`;
};
