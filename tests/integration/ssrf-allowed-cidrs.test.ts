import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import axios from 'axios';
import {
  assertSafeUrl,
  createRedirectValidatingFetch,
  ssrfConnectionOptions,
} from '../../src/utils/ssrf.js';

let mockCidrs: string[] = [];
jest.mock('../../src/utils/systemConfigCache.js', () => ({
  getCachedSystemConfig: () => ({ network: { allowedCidrs: mockCidrs } }),
}));

it('permits real fetch and axios requests only while the internal address is allowlisted', async () => {
  let requests = 0;
  const server: Server = createServer((_req, res) => {
    requests++;
    res.end('ok');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
  const safeFetch = createRedirectValidatingFetch(fetch, false);
  try {
    mockCidrs = ['127.0.0.1/32'];
    expect(await (await safeFetch(url)).text()).toBe('ok');
    const checked = await assertSafeUrl(url);
    expect(
      (await axios.get(checked, { ...ssrfConnectionOptions(false), maxRedirects: 0 })).data,
    ).toBe('ok');
    mockCidrs = [];
    await expect(safeFetch(url)).rejects.toThrow('Blocked target IP');
    await expect(assertSafeUrl(url)).rejects.toThrow('Blocked target IP');
    expect(requests).toBe(2);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    mockCidrs = [];
  }
});

it('blocks rebinding from an allowed subnet to an unlisted subnet before connecting', async () => {
  mockCidrs = ['192.168.1.0/24'];
  const lookup = jest
    .fn()
    .mockResolvedValueOnce(['192.168.1.1'])
    .mockResolvedValue(['192.168.2.1']);
  try {
    await expect(
      createRedirectValidatingFetch(fetch, false, lookup)('http://rebind.invalid:3999/mcp'),
    ).rejects.toThrow();
    expect(lookup).toHaveBeenCalledTimes(2);
  } finally {
    mockCidrs = [];
  }
});
