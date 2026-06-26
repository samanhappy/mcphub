import { describe, expect, it, jest } from '@jest/globals';

import {
  assertSafeUrl,
  createRedirectValidatingFetch,
  isBlockedIp,
  UnsafeUrlError,
} from '../ssrf.js';

describe('isBlockedIp', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.255.255.255', 'loopback /8 upper'],
    ['10.0.0.1', 'RFC1918 10/8'],
    ['172.16.0.1', 'RFC1918 172.16/12 lower'],
    ['172.31.255.255', 'RFC1918 172.16/12 upper'],
    ['192.168.1.1', 'RFC1918 192.168/16'],
    ['169.254.169.254', 'link-local (IMDS)'],
    ['169.254.0.1', 'link-local lower'],
    ['0.0.0.0', 'unspecified'],
    ['::1', 'IPv6 loopback'],
    ['fe80::1', 'IPv6 link-local'],
    ['fc00::1', 'IPv6 ULA'],
    ['fd00::1', 'IPv6 ULA'],
    ['::', 'IPv6 unspecified'],
    ['::ffff:127.0.0.1', 'IPv4-mapped loopback'],
    ['::ffff:169.254.169.254', 'IPv4-mapped link-local'],
  ])('blocks %s (%s)', (ip) => {
    expect(isBlockedIp(ip)).toBe(true);
  });

  it.each([
    ['8.8.8.8', 'Google DNS'],
    ['1.1.1.1', 'Cloudflare DNS'],
    ['172.32.0.1', 'just outside 172.16/12'],
    ['11.0.0.1', 'just outside 10/8'],
    ['2606:4700:4700::1111', 'Cloudflare IPv6'],
  ])('allows %s (%s)', (ip) => {
    expect(isBlockedIp(ip)).toBe(false);
  });
});

const lookup = (map: Record<string, string[]>) => (host: string) =>
  Promise.resolve(map[host] ?? []);

describe('assertSafeUrl', () => {
  it('rejects non-http(s) schemes', async () => {
    await expect(assertSafeUrl('file:///etc/passwd')).rejects.toThrow(
      UnsafeUrlError,
    );
    await expect(assertSafeUrl('gopher://127.0.0.1/x')).rejects.toThrow(
      UnsafeUrlError,
    );
  });

  it('rejects an IP-literal loopback URL without DNS', async () => {
    await expect(
      assertSafeUrl('http://127.0.0.1:8181/secret'),
    ).rejects.toThrow(UnsafeUrlError);
  });

  it('rejects the cloud metadata endpoint', async () => {
    await expect(
      assertSafeUrl('http://169.254.169.254/latest/meta-data/'),
    ).rejects.toThrow(UnsafeUrlError);
  });

  it('rejects a hostname that resolves to a privateIP', async () => {
    await expect(
      assertSafeUrl('http://internal.example/admin', {
        lookup: lookup({ 'internal.example': ['10.0.0.5'] }),
      }),
    ).rejects.toThrow(UnsafeUrlError);
  });

  it('rejects a hostname that resolves to link-local', async () => {
    await expect(
      assertSafeUrl('http://meta.example/', {
        lookup: lookup({ 'meta.example': ['169.254.169.254'] }),
      }),
    ).rejects.toThrow(UnsafeUrlError);
  });

  it('fails closed when DNS resolves nothing', async () => {
    await expect(
      assertSafeUrl('http://unresolvable.invalid/'),
    ).rejects.toThrow(UnsafeUrlError);
  });

  it('rejects IPv4-mapped-IPv6 loopback', async () => {
    await expect(
      assertSafeUrl('http://mapped.example/', {
        lookup: lookup({ 'mapped.example': ['::ffff:127.0.0.1'] }),
      }),
    ).rejects.toThrow(UnsafeUrlError);
  });

  it('rejects a hostname with even one blocked resolved address', async () => {
    await expect(
      assertSafeUrl('http://mixed.example/', {
        lookup: lookup({ 'mixed.example': ['8.8.8.8', '127.0.0.1'] }),
      }),
    ).rejects.toThrow(UnsafeUrlError);
  });

  it('allows a hostname that resolves only to public IPs', async () => {
    await expect(
      assertSafeUrl('https://public.example/api', {
        lookup: lookup({ 'public.example': ['93.184.216.34'] }),
      }),
    ).resolves.toBeUndefined();
  });
});

describe('assertSafeUrl with allowInternal', () => {
  it('allows loopback when allowInternal is true', async () => {
    await expect(
      assertSafeUrl('http://127.0.0.1:8181/secret', { allowInternal: true }),
    ).resolves.toBeUndefined();
  });

  it('allows the metadata endpoint when allowInternal is true', async () => {
    await expect(
      assertSafeUrl('http://169.254.169.254/latest/meta-data/', {
        allowInternal: true,
      }),
    ).resolves.toBeUndefined();
  });

  it('allows a hostname resolving to private IP when allowInternal is true', async () => {
    await expect(
      assertSafeUrl('http://internal.example/admin', {
        allowInternal: true,
        lookup: lookup({ 'internal.example': ['10.0.0.5'] }),
      }),
    ).resolves.toBeUndefined();
  });

  it('still rejects non-http schemes even with allowInternal', async () => {
    await expect(
      assertSafeUrl('file:///etc/passwd', { allowInternal: true }),
    ).rejects.toThrow(UnsafeUrlError);
    await expect(
      assertSafeUrl('gopher://127.0.0.1/x', { allowInternal: true }),
    ).rejects.toThrow(UnsafeUrlError);
  });

  it('still rejects loopback when allowInternal is false (default)', async () => {
    await expect(
      assertSafeUrl('http://127.0.0.1:8181/secret'),
    ).rejects.toThrow(UnsafeUrlError);
  });
});

describe('createRedirectValidatingFetch', () => {
  const makeResponse = (
    status: number,
    location?: string,
    body: BodyInit = '',
  ): Response => {
    const headers = new Headers();
    if (location) headers.set('location', location);
    const nullBody = status === 204 || status === 304;
    return new Response(nullBody ? null : body, { status, headers });
  };

  it('returns the response directly for a non-redirect (2xx)', async () => {
    const baseFetch = jest.fn(async () => makeResponse(200));
    const safeFetch = createRedirectValidatingFetch(
      baseFetch as unknown as typeof fetch,
      false,
    );
    const res = await safeFetch('http://8.8.8.8/api');
    expect(res.status).toBe(200);
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it('follows a redirect to a safe Location and returns the final response', async () => {
    const baseFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        makeResponse(302, 'http://8.8.8.8/next') as Response,
      )
      .mockResolvedValueOnce(makeResponse(200, undefined, 'done') as Response);
    const safeFetch = createRedirectValidatingFetch(baseFetch, false);
    const res = await safeFetch('http://8.8.8.8/start');
    expect(res.status).toBe(200);
    expect(baseFetch).toHaveBeenCalledTimes(2);
    expect(baseFetch).toHaveBeenNthCalledWith(
      1,
      'http://8.8.8.8/start',
      expect.objectContaining({ redirect: 'manual' }),
    );
    expect(baseFetch).toHaveBeenNthCalledWith(
      2,
      'http://8.8.8.8/next',
      expect.objectContaining({ redirect: 'manual' }),
    );
  });

  it('rejects a redirect to an internal IP Location without following', async () => {
    const baseFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        makeResponse(302, 'http://127.0.0.1:8181/secret') as Response,
      );
    const safeFetch = createRedirectValidatingFetch(baseFetch, false);
    await expect(safeFetch('http://8.8.8.8/start')).rejects.toThrow(
      UnsafeUrlError,
    );
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it('allows a redirect to an internal IP when allowInternal is true', async () => {
    const baseFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        makeResponse(302, 'http://127.0.0.1:8181/secret') as Response,
      )
      .mockResolvedValueOnce(makeResponse(200, undefined, 'internal') as Response);
    const safeFetch = createRedirectValidatingFetch(baseFetch, true);
    const res = await safeFetch('http://8.8.8.8/start');
    expect(res.status).toBe(200);
    expect(baseFetch).toHaveBeenCalledTimes(2);
  });

  it('rejects the metadata endpoint on redirect', async () => {
    const baseFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        makeResponse(302, 'http://169.254.169.254/latest/meta-data/') as Response,
      );
    const safeFetch = createRedirectValidatingFetch(baseFetch, false);
    await expect(safeFetch('http://8.8.8.8/start')).rejects.toThrow(
      UnsafeUrlError,
    );
  });

  it('rejects after too many redirects (>5 hops)', async () => {
    const baseFetch = jest
      .fn<typeof fetch>()
      .mockImplementation(async (url: URL | RequestInfo) =>
        makeResponse(302, `${url.toString()}/x`),
      );
    const safeFetch = createRedirectValidatingFetch(baseFetch, false);
    await expect(safeFetch('http://8.8.8.8/loop')).rejects.toThrow(
      UnsafeUrlError,
    );
    expect(baseFetch).toHaveBeenCalledTimes(6);
  });

  it('returns the response when a 3xx has no Location header', async () => {
    const baseFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(makeResponse(302) as Response);
    const safeFetch = createRedirectValidatingFetch(baseFetch, false);
    const res = await safeFetch('http://8.8.8.8/start');
    expect(res.status).toBe(302);
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });

  it('resolves a relative Location against the current URL', async () => {
    const baseFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(makeResponse(302, '/next') as Response)
      .mockResolvedValueOnce(makeResponse(200, undefined, 'done') as Response);
    const safeFetch = createRedirectValidatingFetch(baseFetch, false);
    const res = await safeFetch('http://8.8.8.8/start');
    expect(res.status).toBe(200);
    expect(baseFetch).toHaveBeenNthCalledWith(
      2,
      'http://8.8.8.8/next',
      expect.anything(),
    );
  });

  it('does not treat 304 Not Modified as a redirect', async () => {
    const baseFetch = jest
      .fn<typeof fetch>()
      .mockResolvedValueOnce(makeResponse(304) as Response);
    const safeFetch = createRedirectValidatingFetch(baseFetch, false);
    const res = await safeFetch('http://8.8.8.8/start');
    expect(res.status).toBe(304);
    expect(baseFetch).toHaveBeenCalledTimes(1);
  });
});
