import type { Request, Response } from 'express';
import { getHostedMarketCatalog } from '../../src/controllers/marketController.js';

jest.mock('../../src/services/marketService.js', () => ({}));

const baseUrl = 'https://www.mcphub.app/api/v1/registry/';
const payload = { success: true, data: { items: [], page: 2, pageSize: 12, total: 0 } };

describe('hosted Market catalog', () => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { json, status } as unknown as Response;
  let upstream: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    upstream = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => payload,
    } as globalThis.Response);
  });

  afterEach(() => upstream.mockRestore());

  it('forwards pagination and filters only to the public catalog origin', async () => {
    const req = {
      path: '/market/catalog',
      params: {},
      query: {
        page: '2',
        q: 'a & b',
        category: 'other',
        transport: 'http',
        url: 'https://example.com',
      },
    } as unknown as Request;
    await getHostedMarketCatalog(req, res);

    const [url, init] = upstream.mock.calls[0] as [URL, RequestInit];
    expect(url.href).toBe(baseUrl + 'servers?q=a+%26+b&category=other&transport=http&page=2');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeDefined();
    expect(json).toHaveBeenCalledWith(payload);
  });

  it.each([
    ['/market/catalog/categories/', {}, 'categories'],
    [
      '/market/catalog/ac-mizan/registry',
      { author: 'ac-mizan', name: 'registry' },
      'servers/ac-mizan/registry',
    ],
  ])('maps %s to the Registry endpoint', async (path, params, endpoint) => {
    await getHostedMarketCatalog({ path, params, query: {} } as unknown as Request, res);
    expect(String(upstream.mock.calls[0][0])).toBe(baseUrl + endpoint);
  });

  it('rejects invalid author/name without contacting the Registry', async () => {
    const req = { params: { author: '..', name: 'registry' }, query: {} } as unknown as Request;
    await getHostedMarketCatalog(req, res);
    expect(status).toHaveBeenCalledWith(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it.each([
    [404, 404],
    [429, 502],
    [500, 502],
  ])('returns %s from upstream detail as %s', async (upstreamStatus, expectedStatus) => {
    upstream.mockResolvedValue({ ok: false, status: upstreamStatus });
    await getHostedMarketCatalog(
      {
        params: { author: 'ac-mizan', name: 'registry' },
        query: {},
      } as unknown as Request,
      res,
    );
    expect(status).toHaveBeenCalledWith(expectedStatus);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });
});
