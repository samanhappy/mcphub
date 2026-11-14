import type { AddressInfo } from 'net';
import {
  DEFAULT_INSTALL_BASE_URL,
  getDefaultInstallBaseUrl,
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

  describe('getDefaultInstallBaseUrl', () => {
    describe('before the listener is up, from PORT and MCPHUB_HOST', () => {
      it.each<[string, NodeJS.ProcessEnv, string]>([
        ['neither set', {}, DEFAULT_INSTALL_BASE_URL],
        ['blank values', { PORT: ' ', MCPHUB_HOST: ' ' }, DEFAULT_INSTALL_BASE_URL],
        ['only PORT', { PORT: '3300' }, 'http://localhost:3300'],
        ['only MCPHUB_HOST', { MCPHUB_HOST: '127.0.0.1' }, 'http://127.0.0.1:3000'],
        ['both', { PORT: '3300', MCPHUB_HOST: '192.168.1.10' }, 'http://192.168.1.10:3300'],
        ['an IPv6 host', { PORT: '3300', MCPHUB_HOST: '::1' }, 'http://[::1]:3300'],
        ['a bracketed IPv6 host', { MCPHUB_HOST: '[::1]' }, 'http://[::1]:3000'],
        ['a wildcard host', { PORT: '3300', MCPHUB_HOST: '0.0.0.0' }, 'http://localhost:3300'],
      ])('%s', (_label, env, expected) => {
        expect(getDefaultInstallBaseUrl({ env, bound: null })).toBe(expected);
      });
    });

    describe('listening on one address: that address and the bound port', () => {
      it.each<[string, AddressInfo, string]>([
        ['IPv4', { address: '127.0.0.1', family: 'IPv4', port: 3300 }, 'http://127.0.0.1:3300'],
        ['IPv6', { address: '::1', family: 'IPv6', port: 3300 }, 'http://[::1]:3300'],
      ])('%s', (_label, bound, expected) => {
        expect(getDefaultInstallBaseUrl({ env: {}, bound })).toBe(expected);
      });

      it('prefers the bound address over PORT, MCPHUB_HOST and the request origin', () => {
        expect(
          getDefaultInstallBaseUrl({
            env: { PORT: '3000', MCPHUB_HOST: '127.0.0.1' },
            bound: { address: '127.0.0.2', family: 'IPv4', port: 3917 },
            requestOrigin: 'http://example.test:80',
          }),
        ).toBe('http://127.0.0.2:3917');
      });
    });

    describe('listening on every interface', () => {
      const wildcards: AddressInfo[] = [
        { address: '::', family: 'IPv6', port: 3000 },
        { address: '0.0.0.0', family: 'IPv4', port: 8080 },
      ];

      it.each(wildcards)('uses the origin the client reached ($address)', (bound) => {
        expect(
          getDefaultInstallBaseUrl({ env: {}, bound, requestOrigin: 'http://192.168.1.10:3000/' }),
        ).toBe('http://192.168.1.10:3000');
      });

      it.each(wildcards)('falls back to localhost and the bound port ($address)', (bound) => {
        expect(getDefaultInstallBaseUrl({ env: {}, bound })).toBe(`http://localhost:${bound.port}`);
      });
    });

    it('appends BASE_PATH in every case', () => {
      const basePath = '/hub';
      expect(getDefaultInstallBaseUrl({ env: { PORT: '3300' }, bound: null, basePath })).toBe(
        'http://localhost:3300/hub',
      );
      expect(
        getDefaultInstallBaseUrl({
          env: {},
          bound: { address: '127.0.0.1', family: 'IPv4', port: 3300 },
          basePath,
        }),
      ).toBe('http://127.0.0.1:3300/hub');
      expect(
        getDefaultInstallBaseUrl({
          env: {},
          bound: { address: '::', family: 'IPv6', port: 3000 },
          requestOrigin: 'http://192.168.1.10:3000',
          basePath,
        }),
      ).toBe('http://192.168.1.10:3000/hub');
    });

    it('is only a fallback: a configured base URL still wins', () => {
      expect(
        resolveInstallBaseUrl(
          { install: { baseUrl: 'https://hub.example.com' } },
          getDefaultInstallBaseUrl({ env: { PORT: '3300' }, bound: null }),
          {},
        ),
      ).toBe('https://hub.example.com');
    });
  });
});
