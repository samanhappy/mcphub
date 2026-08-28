import type { ServerFormData } from '../../frontend/src/types';
import {
  getOpenApiSource,
  isOpenApiSourceReady,
  shouldAutoAnalyzeOpenApiSource,
} from '../../frontend/src/utils/openApiSourceAnalysis';

const formWithSource = (inputMode: 'url' | 'schema', value: string): ServerFormData => ({
  name: 'new-api',
  url: '',
  command: '',
  arguments: '',
  env: [],
  headers: [],
  openapi: {
    inputMode,
    url: inputMode === 'url' ? value : '',
    schema: inputMode === 'schema' ? value : '',
  },
});

describe('OpenAPI source analysis trigger', () => {
  it('waits for a valid URL or JSON object before analyzing', () => {
    expect(
      isOpenApiSourceReady(getOpenApiSource(formWithSource('url', 'https://example.com'))),
    ).toBe(true);
    expect(isOpenApiSourceReady(getOpenApiSource(formWithSource('url', 'https://')))).toBe(false);
    expect(
      isOpenApiSourceReady(getOpenApiSource(formWithSource('schema', '{"openapi":"3.1.0"}'))),
    ).toBe(true);
    expect(isOpenApiSourceReady(getOpenApiSource(formWithSource('schema', '{')))).toBe(false);
  });

  it('auto-analyzes only new, ready, not-yet-analyzed sources', () => {
    const source = getOpenApiSource(formWithSource('url', 'https://example.com/openapi.json'));

    expect(
      shouldAutoAnalyzeOpenApiSource({
        isEdit: false,
        serverType: 'openapi',
        source,
        analyzedSourceKey: null,
      }),
    ).toBe(true);
    expect(
      shouldAutoAnalyzeOpenApiSource({
        isEdit: true,
        serverType: 'openapi',
        source,
        analyzedSourceKey: null,
      }),
    ).toBe(false);
    expect(
      shouldAutoAnalyzeOpenApiSource({
        isEdit: false,
        serverType: 'openapi',
        source,
        analyzedSourceKey: source.key,
      }),
    ).toBe(false);
    expect(
      shouldAutoAnalyzeOpenApiSource({
        isEdit: false,
        serverType: 'sse',
        source,
        analyzedSourceKey: null,
      }),
    ).toBe(false);
  });
});
