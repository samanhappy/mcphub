import { stripRuntimeToolName } from '../../src/services/hostedRuntimeCatalogNames.js';

describe('hostedRuntimeCatalogService', () => {
  it('strips the configured server prefix from runtime tool names', () => {
    expect(stripRuntimeToolName('time', 'time-current_time', '-')).toBe('current_time');
    expect(stripRuntimeToolName('brave-search', 'brave-search-web_search', '-')).toBe(
      'web_search',
    );
  });

  it('leaves non-prefixed tool names unchanged', () => {
    expect(stripRuntimeToolName('time', 'current_time', '-')).toBe('current_time');
  });
});
