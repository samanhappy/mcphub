import { ChangelogUpdateInfo } from '../types/index.js';

const DEFAULT_CHANGELOG_API_BASE = 'https://www.mcphub.app/api/v1/changelog';
const DEFAULT_NPM_LATEST_URL = 'https://registry.npmjs.org/@samanhappy/mcphub/latest';
const DEFAULT_TIMEOUT_MS = 5000;
const DEFAULT_CACHE_TTL_SECONDS = 21600;

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  message?: string;
}

interface CachedUpdateInfo {
  key: string;
  expiresAt: number;
  data: ChangelogUpdateInfo;
}

let cachedUpdateInfo: CachedUpdateInfo | null = null;

export function clearChangelogUpdateCache(): void {
  cachedUpdateInfo = null;
}

export async function getChangelogUpdateInfo(input: {
  currentVersion: string;
  locale?: string;
  force?: boolean;
}): Promise<ChangelogUpdateInfo> {
  const locale = normalizeLocale(input.locale);
  const currentVersion = input.currentVersion || 'dev';
  const allChangelogUrl = defaultChangelogUrl(locale);

  if (process.env.DISABLE_UPDATE_CHECK === 'true') {
    return {
      latestVersion: null,
      hasUpdate: false,
      entries: [],
      totalUpdateCount: 0,
      changelogUrl: allChangelogUrl,
      allChangelogUrl,
      source: 'disabled',
    };
  }

  const cacheKey = `${currentVersion}:${locale}`;
  const now = Date.now();
  if (!input.force && cachedUpdateInfo?.key === cacheKey && cachedUpdateInfo.expiresAt > now) {
    return cachedUpdateInfo.data;
  }

  const data = await fetchUpdateInfoFromMcphubWeb(currentVersion, locale).catch(async (error) => {
    console.warn('[changelog] mcphub-web update check failed, falling back to npm latest', {
      error: error instanceof Error ? error.message : String(error),
    });
    return fetchNpmFallback(currentVersion, locale);
  });

  cachedUpdateInfo = {
    key: cacheKey,
    expiresAt: now + cacheTtlMs(),
    data,
  };

  return data;
}

async function fetchUpdateInfoFromMcphubWeb(
  currentVersion: string,
  locale: 'en' | 'zh',
): Promise<ChangelogUpdateInfo> {
  const apiBase = changelogApiBase();
  const url = new URL(`${apiBase}/update-info`);
  url.searchParams.set('currentVersion', currentVersion);
  url.searchParams.set('locale', locale);

  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs()),
  });
  const envelope = (await response.json().catch(() => null)) as
    | ApiEnvelope<ChangelogUpdateInfo>
    | null;

  if (!response.ok || !envelope?.success || !envelope.data) {
    throw new Error(envelope?.message || `Changelog request failed: ${response.status}`);
  }

  return envelope.data;
}

async function fetchNpmFallback(
  currentVersion: string,
  locale: 'en' | 'zh',
): Promise<ChangelogUpdateInfo> {
  const allChangelogUrl = defaultChangelogUrl(locale);
  const response = await fetch(process.env.MCPHUB_NPM_LATEST_URL || DEFAULT_NPM_LATEST_URL, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs()),
  });
  if (!response.ok) {
    throw new Error(`npm latest request failed: ${response.status}`);
  }

  const payload = (await response.json().catch(() => ({}))) as { version?: string };
  const latestVersion = payload.version || null;
  const hasUpdate =
    latestVersion !== null &&
    currentVersion !== 'dev' &&
    compareStableVersions(latestVersion, currentVersion) > 0;

  return {
    latestVersion,
    hasUpdate,
    entries: [],
    totalUpdateCount: hasUpdate ? 1 : 0,
    changelogUrl: latestVersion ? `${allChangelogUrl}/${latestVersion}` : allChangelogUrl,
    allChangelogUrl,
    source: 'npm-fallback',
  };
}

function normalizeLocale(value: string | undefined): 'en' | 'zh' {
  return value?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function changelogApiBase(): string {
  return (process.env.MCPHUB_CHANGELOG_API_BASE || DEFAULT_CHANGELOG_API_BASE).replace(/\/+$/, '');
}

function defaultChangelogUrl(locale: 'en' | 'zh'): string {
  const siteBase = changelogApiBase()
    .replace(/\/api\/v1\/changelog$/i, '')
    .replace(/\/+$/, '');
  return `${siteBase}${locale === 'zh' ? '/zh' : ''}/changelog`;
}

function timeoutMs(): number {
  const value = Number(process.env.MCPHUB_UPDATE_CHECK_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_TIMEOUT_MS;
}

function cacheTtlMs(): number {
  const value = Number(process.env.MCPHUB_UPDATE_CHECK_CACHE_TTL_SECONDS);
  const seconds =
    Number.isFinite(value) && value >= 0 ? Math.floor(value) : DEFAULT_CACHE_TTL_SECONDS;
  return seconds * 1000;
}

function parseStableVersion(version: string): [number, number, number] | null {
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareStableVersions(a: string, b: string): number {
  const parsedA = parseStableVersion(a);
  const parsedB = parseStableVersion(b);
  if (!parsedA || !parsedB) return 0;
  for (let i = 0; i < 3; i++) {
    if (parsedA[i] > parsedB[i]) return 1;
    if (parsedA[i] < parsedB[i]) return -1;
  }
  return 0;
}
