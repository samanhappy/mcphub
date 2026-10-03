import axios from 'axios';
import { lookup as dnsLookup } from 'node:dns/promises';
jest.mock('node:dns/promises', () => ({ lookup: jest.fn() }));
import {
  createRedirectValidatingFetch,
  createSafeLookup,
  assertSafeUrl,
  ssrfConnectionOptions,
} from '../../src/utils/ssrf.js';

it('rejects a changed DNS answer at the real fetch connection, before sending a request', async () => {
  const lookup = jest
    .fn(async () => '8.8.8.8')
    .mockResolvedValueOnce('8.8.8.8')
    .mockResolvedValue('127.0.0.1');
  const safeFetch = createRedirectValidatingFetch(fetch, false, async () => [await lookup()]);
  await expect(safeFetch('http://rebind.invalid:3999/secret')).rejects.toThrow();
  expect(lookup).toHaveBeenCalledTimes(2);
});

it('hands the checked address directly to the socket lookup callback', async () => {
  const lookup = jest.fn(async () => ['8.8.8.8']);
  const result = await new Promise((resolve, reject) => {
    createSafeLookup(lookup)('rebind.invalid', { all: true }, (error, addresses) => {
      if (error) reject(error);
      else resolve(addresses);
    });
  });
  expect(result).toEqual([{ address: '8.8.8.8', family: 4 }]);
  expect(lookup).toHaveBeenCalledTimes(1);
});

it('rejects DNS rebinding through the real axios socket agent', async () => {
  const lookup = dnsLookup as jest.Mock;
  lookup
    .mockReset()
    .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
    .mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
  const url = await assertSafeUrl('http://rebind.invalid:3999/secret');
  await expect(
    axios.get(url, { ...ssrfConnectionOptions(false), maxRedirects: 0 }),
  ).rejects.toThrow('Blocked or empty DNS result');
  expect(lookup).toHaveBeenCalledTimes(2);
});
