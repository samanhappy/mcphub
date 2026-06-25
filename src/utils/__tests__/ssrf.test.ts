import { describe, expect, it } from '@jest/globals';

import { assertSafeUrl, isBlockedIp, UnsafeUrlError } from '../ssrf.js';

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
