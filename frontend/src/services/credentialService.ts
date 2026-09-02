import type { CredentialBindingSummary } from '@/types';
import { apiDelete, apiGet, apiPut, type ApiResponse } from '@/utils/fetchInterceptor';

export type CredentialValues = {
  env?: Record<string, string>;
  headers?: Record<string, string>;
};

export const listCredentialBindings = () =>
  apiGet<ApiResponse<CredentialBindingSummary[]>>('/credentials');

export const saveCredentialBinding = (serverName: string, values: CredentialValues) =>
  apiPut<ApiResponse<CredentialBindingSummary>>(
    `/credentials/${encodeURIComponent(serverName)}`,
    { values },
  );

export const removeCredentialBinding = (serverName: string) =>
  apiDelete<ApiResponse<{ deleted: boolean }>>(
    `/credentials/${encodeURIComponent(serverName)}`,
  );
