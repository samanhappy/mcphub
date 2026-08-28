import type { ServerFormData } from '../types';

export type OpenApiSourceMode = 'url' | 'schema';

export interface OpenApiSource {
  mode: OpenApiSourceMode;
  value: string;
  key: string;
}

export function getOpenApiSource(formData: ServerFormData): OpenApiSource {
  const mode: OpenApiSourceMode = formData.openapi?.inputMode === 'schema' ? 'schema' : 'url';
  const value =
    (mode === 'schema' ? formData.openapi?.schema : formData.openapi?.url)?.trim() || '';

  return {
    mode,
    value,
    key: value ? `${mode}:${value}` : '',
  };
}

export function isOpenApiSourceReady(source: OpenApiSource): boolean {
  if (!source.value) {
    return false;
  }

  if (source.mode === 'schema') {
    try {
      const parsed = JSON.parse(source.value);
      return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed);
    } catch {
      return false;
    }
  }

  try {
    const url = new URL(source.value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function shouldAutoAnalyzeOpenApiSource(options: {
  isEdit: boolean;
  serverType: ServerFormData['type'];
  source: OpenApiSource;
  analyzedSourceKey: string | null;
}): boolean {
  return (
    !options.isEdit &&
    options.serverType === 'openapi' &&
    isOpenApiSourceReady(options.source) &&
    options.source.key !== options.analyzedSourceKey
  );
}
