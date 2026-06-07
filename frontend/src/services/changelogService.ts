import { ApiResponse, apiGet } from '@/utils/fetchInterceptor';
import { ChangelogUpdateInfo } from '@/types';

const DISMISSED_UPDATE_KEY = 'mcphub.dismissedUpdateVersion';

export async function fetchChangelogUpdateInfo(input: {
  currentVersion: string;
  locale?: string;
  force?: boolean;
}): Promise<ChangelogUpdateInfo | null> {
  const params = new URLSearchParams();
  params.set('currentVersion', input.currentVersion);
  params.set('locale', normalizeLocale(input.locale));
  if (input.force) params.set('force', 'true');

  const response = await apiGet<ApiResponse<ChangelogUpdateInfo>>(
    `/changelog/update-info?${params.toString()}`,
  );
  if (!response.success || !response.data) return null;
  return response.data;
}

export function dismissUpdateVersion(version: string): void {
  localStorage.setItem(DISMISSED_UPDATE_KEY, version);
}

export function isUpdateDismissed(version: string | null | undefined): boolean {
  if (!version) return false;
  return localStorage.getItem(DISMISSED_UPDATE_KEY) === version;
}

export function shouldShowUpdateBadge(info: ChangelogUpdateInfo | null): boolean {
  return Boolean(info?.hasUpdate && info.latestVersion && !isUpdateDismissed(info.latestVersion));
}

function normalizeLocale(value?: string): 'en' | 'zh' {
  return value?.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

