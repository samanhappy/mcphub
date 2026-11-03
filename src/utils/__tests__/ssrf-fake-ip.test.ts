import {
  assertSafeUrl,
  createRedirectValidatingFetch,
  createSafeLookup,
  validateFakeIpExceptions,
} from '../ssrf.js';

let mockRules: unknown;
jest.mock('../systemConfigCache.js', () => ({
  getCachedSystemConfig: () => ({ network: { fakeIpExceptions: mockRules } }),
}));
beforeEach(() => {
  mockRules = [{ serverId: 'trusted', hostname: 'mcp.example.com' }];
});

it.each([
  '*.example.com',
  'MCP.example.com',
  '127.0.0.1',
  'example.com.',
  'https://example.com',
  'example.com:443',
  'bad..example.com',
])('rejects non-exact hostname %s', (hostname) => {
  expect(validateFakeIpExceptions([{ serverId: 'trusted', hostname }])).toBe(false);
});
it('validates complete rules', () => {
  expect(validateFakeIpExceptions(mockRules)).toBe(true);
  for (const value of [null, {}, [null], [{}], [{ serverId: '', hostname: 'mcp.example.com' }]]) {
    expect(validateFakeIpExceptions(value)).toBe(false);
  }
});
it('allows only the selected server, hostname and Fake-IP range', async () => {
  const opts = { serverId: 'trusted', lookup: async () => ['198.18.0.1', '198.19.255.255'] };
  await expect(assertSafeUrl('https://mcp.example.com/mcp', opts)).resolves.toBeDefined();
  await expect(assertSafeUrl('https://other.example.com/mcp', opts)).rejects.toThrow();
  await expect(
    assertSafeUrl('https://mcp.example.com/mcp', { ...opts, serverId: 'other' }),
  ).rejects.toThrow();
  await expect(assertSafeUrl('https://198.18.0.1/mcp', opts)).rejects.toThrow();
  for (const ip of ['127.0.0.1', '10.0.0.1', '169.254.169.254', '192.168.1.1']) {
    await expect(
      assertSafeUrl('https://mcp.example.com', { ...opts, lookup: async () => ['198.18.0.1', ip] }),
    ).rejects.toThrow();
  }
  mockRules = [{ serverId: 'trusted', hostname: '*' }];
  await expect(assertSafeUrl('https://mcp.example.com', opts)).rejects.toThrow();
});
it('rechecks socket DNS and policy removal for existing lookups', async () => {
  let addresses = ['198.18.0.1'];
  const lookup = createSafeLookup(async () => addresses, undefined, 'trusted');
  const resolve = () =>
    new Promise((done, reject) =>
      lookup('mcp.example.com', { all: true }, (err, records) =>
        err ? reject(err) : done(records),
      ),
    );
  await expect(resolve()).resolves.toEqual([{ address: '198.18.0.1', family: 4 }]);
  addresses = ['198.18.0.1', '169.254.169.254'];
  await expect(resolve()).rejects.toThrow();
  addresses = ['198.18.0.1'];
  mockRules = [];
  await expect(resolve()).rejects.toThrow();
});
it('permits same-host redirects and blocks unrelated destinations', async () => {
  const baseFetch = jest
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: '/next' } }))
    .mockResolvedValueOnce(new Response('ok'));
  const safeFetch = createRedirectValidatingFetch(
    baseFetch,
    false,
    async () => ['198.18.0.1'],
    undefined,
    'trusted',
  );
  expect(await (await safeFetch('https://mcp.example.com')).text()).toBe('ok');
  for (const location of [
    'https://other.example.com',
    'http://127.0.0.1',
    'http://169.254.169.254',
  ]) {
    baseFetch
      .mockReset()
      .mockResolvedValue(new Response(null, { status: 302, headers: { location } }));
    await expect(safeFetch('https://mcp.example.com')).rejects.toThrow();
    expect(baseFetch).toHaveBeenCalledTimes(1);
  }
});
