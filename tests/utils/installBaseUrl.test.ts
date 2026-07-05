import {
  DEFAULT_INSTALL_BASE_URL,
  getInstallBaseUrlFromEnv,
  resolveInstallBaseUrl,
  withResolvedInstallBaseUrl,
} from '../../src/utils/installBaseUrl.js';

describe('installBaseUrl utilities', () => {
  it('prefers an explicit system config base URL over INSTALL_BASE_URL', () => {
    expect(
      resolveInstallBaseUrl(
        { install: { baseUrl: 'https://settings.example.com/mcphub' } },
        DEFAULT_INSTALL_BASE_URL,
        { INSTALL_BASE_URL: 'https://env.example.com/mcphub' },
      ),
    ).toBe('https://settings.example.com/mcphub');
  });

  it('uses INSTALL_BASE_URL when the system config base URL is unset', () => {
    expect(
      resolveInstallBaseUrl({ install: {} }, DEFAULT_INSTALL_BASE_URL, {
        INSTALL_BASE_URL: 'https://env.example.com/mcphub',
      }),
    ).toBe('https://env.example.com/mcphub');
  });

  it('falls back to localhost when neither config nor env are set', () => {
    expect(resolveInstallBaseUrl({}, DEFAULT_INSTALL_BASE_URL, {})).toBe(DEFAULT_INSTALL_BASE_URL);
  });

  it('treats blank values as unset', () => {
    expect(
      resolveInstallBaseUrl({ install: { baseUrl: '   ' } }, DEFAULT_INSTALL_BASE_URL, {
        INSTALL_BASE_URL: '   ',
      }),
    ).toBe(DEFAULT_INSTALL_BASE_URL);
  });

  it('returns a response copy with the resolved base URL without mutating the source config', () => {
    const source = { install: { pythonIndexUrl: 'https://pypi.example.com' } };

    const resolved = withResolvedInstallBaseUrl(source, DEFAULT_INSTALL_BASE_URL, {
      INSTALL_BASE_URL: 'https://env.example.com/mcphub',
    });

    expect(resolved).toEqual({
      install: {
        pythonIndexUrl: 'https://pypi.example.com',
        baseUrl: 'https://env.example.com/mcphub',
      },
    });
    expect(source).toEqual({ install: { pythonIndexUrl: 'https://pypi.example.com' } });
  });

  it('reads INSTALL_BASE_URL from the provided environment', () => {
    expect(getInstallBaseUrlFromEnv({ INSTALL_BASE_URL: ' https://env.example.com ' })).toBe(
      'https://env.example.com',
    );
  });
});
