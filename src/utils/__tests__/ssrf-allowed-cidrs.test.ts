import {
  assertSafeUrl,
  createSafeLookup,
  createRedirectValidatingFetch,
  validateAllowedCidrs,
} from '../ssrf.js';

let mockCidrs: unknown = [];
jest.mock('../systemConfigCache.js', () => ({
  getCachedSystemConfig: () => ({ network: { allowedCidrs: mockCidrs } }),
}));

beforeEach(() => {
  mockCidrs = ['192.168.1.0/24', 'fd00:1234::/64'];
});

it.each(['192.168.1.0/24', '10.0.0.1/32', '0.0.0.0/0', 'fd00::/64', '::1/128'])(
  'accepts %s',
  (cidr) => {
    expect(validateAllowedCidrs([cidr])).toBe(true);
  },
);

it.each([
  '192.168.1.1',
  '192.168.1.0/33',
  'fd00::/129',
  'host/24',
  '1.2.3.4/-1',
  '1.2.3.4/01',
  '1.2.3.4/24/',
  '',
  null,
  7,
])('rejects invalid CIDR %s', (cidr) => {
  expect(validateAllowedCidrs([cidr])).toBe(false);
});

it('allows only listed ranges, including IPv6 and mapped IPv4 literals', async () => {
  for (const host of ['192.168.1.1', '192.168.1.255', '[fd00:1234::1]', '[::ffff:192.168.1.1]']) {
    await expect(assertSafeUrl(`http://${host}/mcp`)).resolves.toBeDefined();
  }
  for (const host of [
    '192.168.2.1',
    '127.0.0.1',
    '169.254.169.254',
    '[fd00:1235::1]',
    '[::ffff:192.168.2.1]',
  ]) {
    await expect(assertSafeUrl(`http://${host}/mcp`)).rejects.toThrow();
  }
});

it('checks every DNS answer and fails closed on malformed stored configuration', async () => {
  await expect(
    assertSafeUrl('http://lan.invalid', { lookup: async () => ['192.168.1.1', '192.168.2.1'] }),
  ).rejects.toThrow();
  await expect(
    assertSafeUrl('http://lan.invalid', { lookup: async () => ['192.168.1.1'] }),
  ).resolves.toBeDefined();
  mockCidrs = ['192.168.1.0/24', 'invalid'];
  await expect(assertSafeUrl('http://192.168.1.1')).rejects.toThrow();
});

it('reads policy changes for existing fetch wrappers and validates redirect destinations', async () => {
  const baseFetch = jest.fn(
    async () => new Response(null, { status: 302, headers: { location: 'http://192.168.2.1/' } }),
  );
  const safeFetch = createRedirectValidatingFetch(baseFetch, false);
  await expect(safeFetch('http://192.168.1.1/')).rejects.toThrow('Blocked target IP');
  expect(baseFetch).toHaveBeenCalledTimes(1);
  mockCidrs = [];
  await expect(safeFetch('http://192.168.1.1/')).rejects.toThrow();
  expect(baseFetch).toHaveBeenCalledTimes(1);
});

it('enforces the same policy during socket DNS resolution', async () => {
  const lookup = createSafeLookup(async () => ['192.168.1.1']);
  const resolve = () =>
    new Promise((done, reject) =>
      lookup('lan.invalid', { all: true }, (error, addresses) =>
        error ? reject(error) : done(addresses),
      ),
    );
  await expect(resolve()).resolves.toEqual([{ address: '192.168.1.1', family: 4 }]);
  mockCidrs = [];
  await expect(resolve()).rejects.toThrow('Blocked or empty DNS result');
});

it('does not grant allowlist access to callers explicitly opting out', async () => {
  await expect(assertSafeUrl('http://192.168.1.1/', { allowedCidrs: [] })).rejects.toThrow();
  const baseFetch = jest.fn();
  await expect(
    createRedirectValidatingFetch(baseFetch, false, undefined, [])('http://192.168.1.1/'),
  ).rejects.toThrow();
  expect(baseFetch).not.toHaveBeenCalled();
});
