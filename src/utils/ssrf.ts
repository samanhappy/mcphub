import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
  }
}

export type SsrfLookup = (host: string) => Promise<string[]>;

export interface AssertSafeUrlOptions {
  // When true, skip the internal-IP blocklist (loopback / RFC1918 / link-local).
  // Use only for trusted callers (e.g. admin-owned servers) that legitimately
  // need to reach internal services.
  allowInternal?: boolean;
  lookup?: SsrfLookup;
}

// IPv4 blocked ranges as [start, end] inclusive 32-bit integers.
const IPV4_BLOCKED_RANGES: Array<[number, number]> = [
  [0x00000000, 0x00ffffff], // 0.0.0.0/8 unspecified
  [0x0a000000, 0x0affffff], // 10.0.0.0/8 RFC1918
  [0x64000000, 0x657fffff], // 100.64.0.0/10 CGNAT
  [0x7f000000, 0x7fffffff], // 127.0.0.0/8 loopback
  [0xa9fe0000, 0xa9feffff], // 169.254.0.0/16 link-local (IMDS)
  [0xac100000, 0xac1fffff], // 172.16.0.0/12 RFC1918
  [0xc0000000, 0xc00000ff], // 192.0.0.0/24 IETF protocol assignments
  [0xc0a80000, 0xc0a8ffff], // 192.168.0.0/16 RFC1918
  [0xc6120000, 0xc613ffff], // 198.18.0.0/15 benchmarking
];

function ipv4ToInt(ip: string): number {
  const [a, b, c, d] = ip.split('.').map(Number);
  return (((a * 256 + b) * 256 + c) * 256 + d) >>> 0;
}

function isBlockedIpv4Number(n: number): boolean {
  for (const [start, end] of IPV4_BLOCKED_RANGES) {
    if (n >= start && n <= end) return true;
  }
  return false;
}

// Expand an IPv6 textual form (including an embedded IPv4 tail) into 8 hex groups.
function expandIpv6(addr: string): string[] {
  if (addr.includes('.')) {
    const lastColon = addr.lastIndexOf(':');
    const v4 = addr.slice(lastColon + 1);
    const [a, b, c, d] = v4.split('.').map(Number);
    const hi = ((a << 8) | b) >>> 0;
    const lo = ((c << 8) | d) >>> 0;
    addr = `${addr.slice(0, lastColon + 1)}${hi.toString(16)}:${lo.toString(16)}`;
  }

  if (addr.includes('::')) {
    const [head, tail] = addr.split('::');
    const headParts = head ? head.split(':') : [];
    const tailParts = tail ? tail.split(':') : [];
    const missing = 8 - headParts.length - tailParts.length;
    return [...headParts, ...Array(Math.max(0, missing)).fill('0'), ...tailParts];
  }
  return addr.split(':');
}

function ipv6ToBigInt(addr: string): bigint {
  const groups = expandIpv6(addr);
  let result = 0n;
  for (const g of groups) {
    result = (result << 16n) | BigInt(parseInt(g || '0', 16));
  }
  return result;
}

function isBlockedIpv6(big: bigint): boolean {
  if (big === 0n || big === 1n) return true; // ::, ::1
  if ((big >> 118n) === 0x3fan) return true; // fe80::/10 link-local
  if ((big >> 121n) === 0x7en) return true; // fc00::/7 unique-local
  if ((big >> 32n) === 0xffffn) return isBlockedIpv4Number(Number(big & 0xffffffffn)); // ::ffff:a.b.c.d
  if (big < 0x100000000n) return isBlockedIpv4Number(Number(big)); // ::a.b.c.d (deprecated, compatible)
  return false;
}

export function isBlockedIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isBlockedIpv4Number(ipv4ToInt(ip));
  if (family === 6) return isBlockedIpv6(ipv6ToBigInt(ip));
  return true; // not an IP literal — fail closed
}

const defaultLookup: SsrfLookup = async (host) => {
  const records = await dnsLookup(host, { all: true });
  return records.map((r) => r.address);
};

export async function assertSafeUrl(
  rawUrl: string,
  opts: AssertSafeUrlOptions = {},
): Promise<void> {
  const { allowInternal = false, lookup = defaultLookup } = opts;

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError(`Invalid URL: ${rawUrl}`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UnsafeUrlError(`Disallowed URL scheme: ${parsed.protocol}`);
  }

  if (allowInternal) {
    return;
  }

  const host = parsed.hostname;
  if (isIP(host) !== 0) {
    if (isBlockedIp(host)) {
      throw new UnsafeUrlError(`Blocked target IP: ${host}`);
    }
    return;
  }

  let addresses: string[];
  try {
    addresses = await lookup(host);
  } catch {
    throw new UnsafeUrlError(`Unable to resolve host: ${host}`);
  }
  if (addresses.length === 0) {
    throw new UnsafeUrlError(`No addresses resolved for host: ${host}`);
  }
  for (const addr of addresses) {
    if (isBlockedIp(addr)) {
      throw new UnsafeUrlError(`Host ${host} resolves to blocked address: ${addr}`);
    }
  }
}

export type FetchLike = (url: string | URL, init?: RequestInit) => Promise<Response>;

// Wraps a fetch so HTTP redirects (3xx) are followed manually with each hop
// validated against the SSRF blocklist, instead of letting the underlying
// fetch auto-follow to an attacker-chosen internal address. Validates the
// resolved Location (absolute or relative) on every hop and caps the chain
// at maxHops to avoid redirect loops.
export function createRedirectValidatingFetch(
  baseFetch: FetchLike,
  allowInternal: boolean,
): FetchLike {
  const maxHops = 5;
  return async (url, init) => {
    let currentUrl = typeof url === 'string' ? url : url.toString();
    let hops = 0;
    let response = await baseFetch(currentUrl, { ...init, redirect: 'manual' });
    while (
      response.status >= 300 &&
      response.status < 400 &&
      response.status !== 304 &&
      hops < maxHops
    ) {
      const location = response.headers.get('location');
      if (!location) {
        return response;
      }
      const resolvedUrl = new URL(location, currentUrl).toString();
      await assertSafeUrl(resolvedUrl, { allowInternal });
      currentUrl = resolvedUrl;
      hops++;
      response = await baseFetch(currentUrl, { ...init, redirect: 'manual' });
    }
    if (
      response.status >= 300 &&
      response.status < 400 &&
      response.status !== 304
    ) {
      throw new UnsafeUrlError('Too many redirects');
    }
    return response;
  };
}
