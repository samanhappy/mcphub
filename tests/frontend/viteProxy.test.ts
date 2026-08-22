import { createDevProxyConfig } from '../../frontend/viteProxy.js';

describe('createDevProxyConfig', () => {
  it('prefixes the development API proxy with BASE_PATH', () => {
    expect(Object.keys(createDevProxyConfig('/mcphub/'))).toEqual([
      '/mcphub/api',
      '/mcphub/config',
      '/mcphub/public-config',
    ]);
  });

  it('keeps root proxy paths when BASE_PATH is empty', () => {
    expect(Object.keys(createDevProxyConfig(''))).toEqual(['/api', '/config', '/public-config']);
  });
});
