const NPM_REGISTRY = 'https://registry.npmjs.org';
const PACKAGE_NAME = '@samanhappy/mcphub';

export const checkLatestVersion = async (): Promise<string | null> => {
  try {
    const response = await fetch(`${NPM_REGISTRY}/${PACKAGE_NAME}/latest`);
    if (!response.ok) {
      throw new Error(`Failed to fetch latest version: ${response.status}`);
    }
    const data = await response.json();
    return data.version || null;
  } catch (error) {
    console.error('Error checking for latest version:', error);
    return null;
  }
};

export const compareVersions = (current: string, latest: string): number => {
  if (current === 'dev') return -1;
  const currentParts = current.split('.').map(Number);
  const latestParts = latest.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    const currentPart = currentParts[i] || 0;
    const latestPart = latestParts[i] || 0;

    if (currentPart > latestPart) return -1;
    if (currentPart < latestPart) return 1;
  }

  return 0;
};
