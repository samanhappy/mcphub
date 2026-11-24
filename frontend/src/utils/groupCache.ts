export const getServerNamesFingerprint = (servers: Array<{ name: string }>): string =>
  servers
    .map((server) => server.name)
    .sort()
    .join('\0');

export const shouldRefreshGroupsForServerNames = (
  previousFingerprint: string | null,
  nextFingerprint: string,
): boolean => previousFingerprint !== null && previousFingerprint !== nextFingerprint;
