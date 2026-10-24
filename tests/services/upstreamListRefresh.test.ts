import {
  recordUpstreamList,
  revalidateUpstreamList,
  clearUpstreamLists,
  upstreamListOwner,
} from '../../src/services/upstreamListRefresh.js';

// These clocks control freshness only; no polling timers or background traffic.
describe('modern upstream list revalidation', () => {
  const client = {};
  afterEach(() => {
    clearUpstreamLists(client);
    jest.restoreAllMocks();
  });

  it('shares freshness through a personal runtime proxy but never between clients', async () => {
    const owner = { [upstreamListOwner]: {} };
    const proxy = new Proxy(owner, { get: (target, key) => Reflect.get(target, key) });
    recordUpstreamList(owner, 'tools', 60000, performance.now());
    const refresh = jest.fn().mockResolvedValue(undefined);
    await revalidateUpstreamList(proxy, 'tools', refresh);
    expect(refresh).not.toHaveBeenCalled();
    await revalidateUpstreamList({}, 'tools', refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
    clearUpstreamLists(proxy);
    await revalidateUpstreamList(owner, 'tools', refresh);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('reuses a fresh list and refreshes at its original expiry', async () => {
    const now = jest.spyOn(performance, 'now').mockReturnValue(100);
    recordUpstreamList(client, 'tools', 50, 100);
    const refresh = jest.fn().mockResolvedValue(undefined);
    await revalidateUpstreamList(client, 'tools', refresh);
    expect(refresh).not.toHaveBeenCalled();
    now.mockReturnValue(150);
    await revalidateUpstreamList(client, 'tools', refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('coalesces requests and retries errors rather than keeping stale data fresh', async () => {
    let reject!: (error: Error) => void;
    const refresh = jest.fn(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail;
        }),
    );
    const first = revalidateUpstreamList(client, 'prompts', refresh);
    const second = revalidateUpstreamList(client, 'prompts', refresh);
    reject(new Error('offline'));
    await expect(first).rejects.toThrow('offline');
    await expect(second).rejects.toThrow('offline');
    expect(refresh).toHaveBeenCalledTimes(1);
    await revalidateUpstreamList(client, 'prompts', jest.fn().mockResolvedValue(undefined));
  });

  it.each([undefined, 0, -1, Infinity, NaN, 1.5])(
    'revalidates unknown or unusable TTL %s on demand',
    async (ttl) => {
      recordUpstreamList(client, 'resources', ttl, performance.now());
      const refresh = jest.fn().mockResolvedValue(undefined);
      await revalidateUpstreamList(client, 'resources', refresh);
      await revalidateUpstreamList(client, 'resources', refresh);
      expect(refresh).toHaveBeenCalledTimes(2);
    },
  );

  it('does not renew a TTL from response completion or retain it after close', async () => {
    const now = jest.spyOn(performance, 'now').mockReturnValue(200);
    recordUpstreamList(client, 'tools', 50, 100);
    const refresh = jest.fn().mockResolvedValue(undefined);
    await revalidateUpstreamList(client, 'tools', refresh);
    expect(refresh).toHaveBeenCalledTimes(1);
    now.mockReturnValue(201);
    recordUpstreamList(client, 'tools', 1000, 201);
    clearUpstreamLists(client);
    await revalidateUpstreamList(client, 'tools', refresh);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
});
