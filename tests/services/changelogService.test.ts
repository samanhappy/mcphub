import {
  clearChangelogUpdateCache,
  getChangelogUpdateInfo,
} from '../../src/services/changelogService.js';

describe('changelogService', () => {
  const originalFetch = global.fetch;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clearChangelogUpdateCache();
    process.env = { ...originalEnv };
    process.env.MCPHUB_CHANGELOG_API_BASE = 'https://updates.example.com/api/v1/changelog';
    process.env.MCPHUB_UPDATE_CHECK_CACHE_TTL_SECONDS = '21600';
    global.fetch = jest.fn();
  });

  afterAll(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it('fetches update info from mcphub-web and caches by version and locale', async () => {
    const payload = {
      latestVersion: '1.0.12',
      hasUpdate: true,
      entries: [],
      totalUpdateCount: 1,
      changelogUrl: 'https://www.mcphub.app/changelog/1.0.12',
      allChangelogUrl: 'https://www.mcphub.app/changelog',
      source: 'mcphub-web',
    };
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: payload }),
    });

    const first = await getChangelogUpdateInfo({ currentVersion: '1.0.11', locale: 'en' });
    const second = await getChangelogUpdateInfo({ currentVersion: '1.0.11', locale: 'en' });

    expect(first).toEqual(payload);
    expect(second).toEqual(payload);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toContain(
      'currentVersion=1.0.11',
    );
  });

  it('returns disabled payload when update checks are disabled', async () => {
    process.env.DISABLE_UPDATE_CHECK = 'true';

    const result = await getChangelogUpdateInfo({ currentVersion: '1.0.11', locale: 'zh-CN' });

    expect(result).toEqual({
      latestVersion: null,
      hasUpdate: false,
      entries: [],
      totalUpdateCount: 0,
      changelogUrl: 'https://updates.example.com/zh/changelog',
      allChangelogUrl: 'https://updates.example.com/zh/changelog',
      source: 'disabled',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('normalizes regional Chinese locales for update requests', async () => {
    const payload = {
      latestVersion: '1.0.12',
      hasUpdate: true,
      entries: [],
      totalUpdateCount: 1,
      changelogUrl: 'https://www.mcphub.app/zh/changelog/1.0.12',
      allChangelogUrl: 'https://www.mcphub.app/zh/changelog',
      source: 'mcphub-web',
    };
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, data: payload }),
    });

    await getChangelogUpdateInfo({ currentVersion: '1.0.11', locale: 'zh-TW' });

    expect(String((global.fetch as jest.Mock).mock.calls[0][0])).toContain('locale=zh');
  });

  it('falls back to npm latest without release details', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ success: false, message: 'unavailable' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ version: '1.0.12' }),
      });

    const result = await getChangelogUpdateInfo({ currentVersion: '1.0.11', locale: 'en' });

    expect(result).toEqual({
      latestVersion: '1.0.12',
      hasUpdate: true,
      entries: [],
      totalUpdateCount: 1,
      changelogUrl: 'https://updates.example.com/changelog/1.0.12',
      allChangelogUrl: 'https://updates.example.com/changelog',
      source: 'npm-fallback',
    });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('handles invalid npm fallback JSON without throwing', async () => {
    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ success: false, message: 'unavailable' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
      });

    const result = await getChangelogUpdateInfo({ currentVersion: '1.0.11', locale: 'en' });

    expect(result).toEqual({
      latestVersion: null,
      hasUpdate: false,
      entries: [],
      totalUpdateCount: 0,
      changelogUrl: 'https://updates.example.com/changelog',
      allChangelogUrl: 'https://updates.example.com/changelog',
      source: 'npm-fallback',
    });
  });
});
