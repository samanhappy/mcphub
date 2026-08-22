import { loadRuntimeConfig } from '../../frontend/src/utils/runtime.js';

describe('frontend runtime configuration', () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
  });

  it('loads configuration from the current BASE_PATH entry path', async () => {
    globalThis.window = {
      location: { pathname: '/mcphub/' },
    } as Window & typeof globalThis;
    globalThis.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: { basePath: '/mcphub', version: 'dev', name: 'mcphub' },
      }),
    }) as unknown as typeof fetch;

    await expect(loadRuntimeConfig()).resolves.toEqual({
      basePath: '/mcphub',
      version: 'dev',
      name: 'mcphub',
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/mcphub/config',
      expect.objectContaining({ method: 'GET' }),
    );
  });
});
