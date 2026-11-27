import { jest } from '@jest/globals';
import type { Tool } from '../../src/types/index.js';
import {
  EmbeddingSyncScheduler,
  type EmbeddingSyncExecutor,
} from '../../src/services/embeddingSyncScheduler.js';
import { logger } from '../../src/utils/logger.js';

const makeTool = (name: string, description = `${name} description`): Tool => ({
  name,
  description,
  inputSchema: { type: 'object', properties: {} },
});

const createDeferred = () => {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flushMicrotasks = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setImmediate(resolve));
};

const createMockExecutor = (): {
  executor: EmbeddingSyncExecutor;
  saveServerTools: jest.Mock<EmbeddingSyncExecutor['saveServerTools']>;
  removeServerEmbeddings: jest.Mock<EmbeddingSyncExecutor['removeServerEmbeddings']>;
  removeToolEmbeddings: jest.Mock<EmbeddingSyncExecutor['removeToolEmbeddings']>;
  syncAllServerTools: jest.Mock<EmbeddingSyncExecutor['syncAllServerTools']>;
  invalidateServerBatches: jest.Mock<NonNullable<EmbeddingSyncExecutor['invalidateServerBatches']>>;
} => {
  const saveServerTools = jest.fn<EmbeddingSyncExecutor['saveServerTools']>().mockResolvedValue();
  const removeServerEmbeddings = jest
    .fn<EmbeddingSyncExecutor['removeServerEmbeddings']>()
    .mockResolvedValue();
  const removeToolEmbeddings = jest
    .fn<EmbeddingSyncExecutor['removeToolEmbeddings']>()
    .mockResolvedValue();
  const syncAllServerTools = jest
    .fn<EmbeddingSyncExecutor['syncAllServerTools']>()
    .mockResolvedValue();
  const invalidateServerBatches = jest.fn<
    NonNullable<EmbeddingSyncExecutor['invalidateServerBatches']>
  >();

  return {
    executor: {
      saveServerTools,
      removeServerEmbeddings,
      removeToolEmbeddings,
      syncAllServerTools,
      invalidateServerBatches,
    },
    saveServerTools,
    removeServerEmbeddings,
    removeToolEmbeddings,
    syncAllServerTools,
    invalidateServerBatches,
  };
};

describe('EmbeddingSyncScheduler', () => {
  let logSpy: jest.SpiedFunction<typeof logger.log>;
  let warnSpy: jest.SpiedFunction<typeof logger.warn>;

  beforeEach(() => {
    logSpy = jest.spyOn(logger, 'log').mockImplementation(() => undefined);
    warnSpy = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    warnSpy.mockRestore();
  });

  const loggedEvents = (): string[] =>
    [...logSpy.mock.calls, ...warnSpy.mock.calls]
      .map((call) => (call[1] as { event?: string } | undefined)?.event)
      .filter((event): event is string => typeof event === 'string');

  it('serializes all mutation jobs strictly one at a time across servers and full resyncs', async () => {
    const mocks = createMockExecutor();
    const scheduler = new EmbeddingSyncScheduler(mocks.executor);

    let activeCount = 0;
    let maxActiveCount = 0;
    const order: string[] = [];

    const firstGate = createDeferred();
    mocks.saveServerTools.mockImplementation(async (serverName) => {
      activeCount += 1;
      maxActiveCount = Math.max(maxActiveCount, activeCount);
      order.push(`sync:${serverName}:start`);
      if (serverName === 'alpha') {
        await firstGate.promise;
      }
      order.push(`sync:${serverName}:end`);
      activeCount -= 1;
    });

    mocks.syncAllServerTools.mockImplementation(async () => {
      activeCount += 1;
      maxActiveCount = Math.max(maxActiveCount, activeCount);
      order.push('full-resync:start');
      await flushMicrotasks();
      order.push('full-resync:end');
      activeCount -= 1;
    });

    mocks.removeServerEmbeddings.mockImplementation(async (serverName) => {
      activeCount += 1;
      maxActiveCount = Math.max(maxActiveCount, activeCount);
      order.push(`cleanup:${serverName}:start`);
      await flushMicrotasks();
      order.push(`cleanup:${serverName}:end`);
      activeCount -= 1;
    });

    const p1 = scheduler.enqueueServerSync('alpha', [makeTool('a')]);
    const p2 = scheduler.enqueueServerSync('beta', [makeTool('b')]);
    const p3 = scheduler.requestFullResync('config-update');
    const p4 = scheduler.enqueueServerCleanup('gamma');

    await flushMicrotasks();
    expect(order).toEqual(['sync:alpha:start']);
    expect(scheduler.getState().isIdle).toBe(false);

    firstGate.resolve();
    await Promise.all([p1, p2, p3, p4]);
    await scheduler.waitForIdle();

    expect(maxActiveCount).toBe(1);
    expect(order).toEqual([
      'sync:alpha:start',
      'sync:alpha:end',
      'sync:beta:start',
      'sync:beta:end',
      'full-resync:start',
      'full-resync:end',
      'cleanup:gamma:start',
      'cleanup:gamma:end',
    ]);
    expect(scheduler.getState().isIdle).toBe(true);
  });

  it('deduplicates pending server syncs and merges reportProgress', async () => {
    const mocks = createMockExecutor();
    const scheduler = new EmbeddingSyncScheduler(mocks.executor);

    const blocker = createDeferred();
    mocks.saveServerTools.mockImplementationOnce(async () => {
      await blocker.promise;
    });

    const pBlock = scheduler.enqueueServerSync('blocker', [makeTool('x')]);
    await flushMicrotasks();

    const p1 = scheduler.enqueueServerSync('redis', [makeTool('v1')], { reportProgress: true });
    const p2 = scheduler.enqueueServerSync('redis', [makeTool('v2')]);
    const p3 = scheduler.enqueueServerSync('redis', [makeTool('v3')]);

    blocker.resolve();
    await Promise.all([pBlock, p1, p2, p3]);

    expect(mocks.saveServerTools).toHaveBeenCalledTimes(2);
    expect(mocks.saveServerTools).toHaveBeenLastCalledWith('redis', [makeTool('v3')], {
      reportProgress: true,
    });
    expect(loggedEvents()).toContain('merge');
  });

  it('coalesces single-tool sync into a pending full server sync and supersedes single-tool sync on full sync', async () => {
    const mocks = createMockExecutor();
    const scheduler = new EmbeddingSyncScheduler(mocks.executor);

    const blocker = createDeferred();
    mocks.saveServerTools.mockImplementationOnce(async () => {
      await blocker.promise;
    });

    const pBlock = scheduler.enqueueServerSync('blocker', [makeTool('x')]);
    await flushMicrotasks();

    // Case 1: single-tool sync coalesces into pending full server sync for 'redis'
    const pFull = scheduler.enqueueServerSync('redis', [
      makeTool('get', 'old get'),
      makeTool('set', 'old set'),
    ]);
    const pSingle = scheduler.enqueueSingleToolSync('redis', makeTool('get', 'new get'));

    // Case 2: pending single-tool syncs for 'fetch' are deduplicated, then superseded by a full sync
    const pFetchSingle1 = scheduler.enqueueSingleToolSync('fetch', makeTool('fetch_html', 'v1'));
    const pFetchSingle2 = scheduler.enqueueSingleToolSync('fetch', makeTool('fetch_html', 'v2'));
    const pFetchFull = scheduler.enqueueServerSync('fetch', [
      makeTool('fetch_html', 'v3'),
      makeTool('fetch_json', 'v3'),
    ]);

    blocker.resolve();
    await Promise.all([pBlock, pFull, pSingle, pFetchSingle1, pFetchSingle2, pFetchFull]);

    // 1 blocker + 1 redis (coalesced) + 1 fetch (superseded) = 3 total saves
    expect(mocks.saveServerTools).toHaveBeenCalledTimes(3);
    expect(mocks.saveServerTools).toHaveBeenNthCalledWith(
      2,
      'redis',
      [makeTool('get', 'new get'), makeTool('set', 'old set')],
      undefined,
    );
    expect(mocks.saveServerTools).toHaveBeenNthCalledWith(
      3,
      'fetch',
      [makeTool('fetch_html', 'v3'), makeTool('fetch_json', 'v3')],
      undefined,
    );
    expect(loggedEvents()).toEqual(expect.arrayContaining(['merge', 'superseded']));
  });

  it('coalesces repeated full resync requests into one real execution', async () => {
    const mocks = createMockExecutor();
    const scheduler = new EmbeddingSyncScheduler(mocks.executor);

    const blocker = createDeferred();
    mocks.saveServerTools.mockImplementationOnce(async () => {
      await blocker.promise;
    });

    const pBlock = scheduler.enqueueServerSync('blocker', [makeTool('x')]);
    await flushMicrotasks();

    // Multiple pending requests coalesce into one queued full resync
    const r1 = scheduler.requestFullResync('reason-1');
    const r2 = scheduler.requestFullResync('reason-2');
    const r3 = scheduler.requestFullResync('reason-3');

    blocker.resolve();
    await Promise.all([pBlock, r1, r2, r3]);

    expect(mocks.syncAllServerTools).toHaveBeenCalledTimes(1);
    expect(loggedEvents()).toEqual(
      expect.arrayContaining(['full-resync-requested', 'full-resync-coalesced']),
    );
  });

  it('coalesces routine full resync during active run, but schedules one follow-up when generation bumps', async () => {
    const mocks = createMockExecutor();
    const scheduler = new EmbeddingSyncScheduler(mocks.executor);

    const activeResyncGate = createDeferred();
    mocks.syncAllServerTools.mockImplementationOnce(async () => {
      await activeResyncGate.promise;
    });

    const r1 = scheduler.requestFullResync('initial');
    await flushMicrotasks();

    // Routine duplicate while active -> coalesced into active run
    const r2 = scheduler.requestFullResync('duplicate-while-active');
    // Config/dimension change while active -> schedules exactly one follow-up
    const r3 = scheduler.requestFullResync('model-changed-1', { bumpGeneration: true });
    const r4 = scheduler.requestFullResync('model-changed-2', { bumpGeneration: true });

    activeResyncGate.resolve();
    await Promise.all([r1, r2, r3, r4]);

    expect(mocks.syncAllServerTools).toHaveBeenCalledTimes(2);
  });

  it('lets cleanup supersede pending sync work for the same server without affecting other servers', async () => {
    const mocks = createMockExecutor();
    const scheduler = new EmbeddingSyncScheduler(mocks.executor);

    const blocker = createDeferred();
    mocks.saveServerTools.mockImplementationOnce(async () => {
      await blocker.promise;
    });

    const pBlock = scheduler.enqueueServerSync('blocker', [makeTool('x')]);
    await flushMicrotasks();

    const pRedisSync = scheduler.enqueueServerSync('redis', [makeTool('get')]);
    const pRedisSingle = scheduler.enqueueSingleToolSync('redis', makeTool('set'));
    const pRedisToolRm = scheduler.enqueueToolRemoval('redis', ['redis:old']);
    const pFetchSync = scheduler.enqueueServerSync('fetch', [makeTool('html')]);

    // Cleanup for 'redis' must cancel all pending redis sync/removal jobs and invalidate active batches
    const pRedisCleanup = scheduler.enqueueServerCleanup('redis');
    expect(mocks.invalidateServerBatches).toHaveBeenCalledWith('redis');

    // A fresh sync queued AFTER cleanup must NOT be merged into the cancelled sync and must run AFTER cleanup
    const pRedisFreshSync = scheduler.enqueueServerSync('redis', [makeTool('fresh')]);

    blocker.resolve();
    await Promise.all([
      pBlock,
      pRedisSync,
      pRedisSingle,
      pRedisToolRm,
      pFetchSync,
      pRedisCleanup,
      pRedisFreshSync,
    ]);

    expect(mocks.removeToolEmbeddings).not.toHaveBeenCalled();
    expect(mocks.removeServerEmbeddings).toHaveBeenCalledTimes(1);
    expect(mocks.removeServerEmbeddings).toHaveBeenCalledWith('redis');

    // Only blocker, fetch, and the post-cleanup fresh redis sync executed
    expect(mocks.saveServerTools.mock.calls.map((c) => c[0])).toEqual([
      'blocker',
      'fetch',
      'redis',
    ]);
    expect(mocks.saveServerTools.mock.calls[2][1]).toEqual([makeTool('fresh')]);
    expect(mocks.removeServerEmbeddings.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.saveServerTools.mock.invocationCallOrder[2],
    );
    expect(loggedEvents()).toEqual(expect.arrayContaining(['cleanup-wins', 'superseded']));
  });

  it('invalidates stale queued sync jobs on generation bump while preserving cleanup jobs', async () => {
    const mocks = createMockExecutor();
    const scheduler = new EmbeddingSyncScheduler(mocks.executor);

    const blocker = createDeferred();
    mocks.saveServerTools.mockImplementationOnce(async () => {
      await blocker.promise;
    });

    const pBlock = scheduler.enqueueServerSync('blocker', [makeTool('x')]);
    await flushMicrotasks();

    const pStaleSync = scheduler.enqueueServerSync('redis', [makeTool('stale')]);
    const pCleanup = scheduler.enqueueServerCleanup('deleted-server');

    const newGen = scheduler.bumpGeneration('provider-changed');
    expect(newGen).toBe(1);
    expect(scheduler.getGeneration()).toBe(1);

    const pNewSync = scheduler.enqueueServerSync('fresh-server', [makeTool('fresh')]);

    blocker.resolve();
    await Promise.all([pBlock, pStaleSync, pCleanup, pNewSync]);

    // Stale sync was dropped, cleanup preserved, new-generation sync executed
    expect(mocks.saveServerTools.mock.calls.map((c) => c[0])).toEqual(['blocker', 'fresh-server']);
    expect(mocks.removeServerEmbeddings).toHaveBeenCalledWith('deleted-server');
    expect(loggedEvents()).toContain('superseded');
  });

  it('recovers cleanly after job failures, logs EMBED_SYNC_ERROR, and never gets stuck', async () => {
    const mocks = createMockExecutor();
    const scheduler = new EmbeddingSyncScheduler(mocks.executor);

    mocks.saveServerTools
      .mockRejectedValueOnce(new Error('provider 429'))
      .mockResolvedValueOnce(undefined);

    const pFail = scheduler.enqueueServerSync('redis', [makeTool('a')]);
    const pRecover = scheduler.enqueueServerSync('fetch', [makeTool('b')]);

    await expect(pFail).rejects.toThrow('provider 429');
    await expect(pRecover).resolves.toBeUndefined();
    await scheduler.waitForIdle();

    expect(scheduler.getState()).toMatchObject({
      activeJob: null,
      queueLength: 0,
      isIdle: true,
    });
    expect(mocks.saveServerTools).toHaveBeenCalledTimes(2);
    expect(loggedEvents()).toEqual(expect.arrayContaining(['enqueue', 'start', 'fail', 'finish']));
    expect(
      warnSpy.mock.calls.some(
        (call) => typeof call[0] === 'string' && call[0].includes('[EMBED_SYNC_ERROR]'),
      ),
    ).toBe(true);
  });

  it('executes index clears exclusively inside the scheduler so concurrent syncs cannot interleave', async () => {
    const mocks = createMockExecutor();
    const scheduler = new EmbeddingSyncScheduler(mocks.executor);

    const events: string[] = [];
    const clearGate = createDeferred();

    const preClearBlocker = createDeferred();
    mocks.saveServerTools.mockImplementationOnce(async () => {
      events.push('blocker:start');
      await preClearBlocker.promise;
      events.push('blocker:end');
    });
    mocks.saveServerTools.mockImplementation(async (serverName) => {
      events.push(`sync:${serverName}:start`);
      events.push(`sync:${serverName}:end`);
    });

    const pBlocker = scheduler.enqueueServerSync('blocker', [makeTool('x')]);
    await flushMicrotasks();

    // Queued before clear -> superseded by clearAll
    const pStale = scheduler.enqueueServerSync('stale', [makeTool('s')]);

    const pClear = scheduler.enqueueIndexClear('manual-reindex', async () => {
      events.push('clear:start');
      await clearGate.promise;
      events.push('clear:end');
    });

    preClearBlocker.resolve();
    await flushMicrotasks();

    // Enqueue a sync WHILE the clear is actively running — it must wait until clear finishes.
    expect(events).toEqual(['blocker:start', 'blocker:end', 'clear:start']);
    const pDuringClear = scheduler.enqueueServerSync('fresh', [makeTool('f')]);
    await flushMicrotasks();
    expect(events).toEqual(['blocker:start', 'blocker:end', 'clear:start']);

    clearGate.resolve();
    await Promise.all([pBlocker, pStale, pClear, pDuringClear]);
    await scheduler.waitForIdle();

    expect(events).toEqual([
      'blocker:start',
      'blocker:end',
      'clear:start',
      'clear:end',
      'sync:fresh:start',
      'sync:fresh:end',
    ]);
  });

  it('preserves queued tool removals and personal-credential partial syncs across generation bumps', async () => {
    const mocks = createMockExecutor();
    const scheduler = new EmbeddingSyncScheduler(mocks.executor);

    const blocker = createDeferred();
    mocks.saveServerTools.mockImplementationOnce(async () => {
      await blocker.promise;
    });

    const pBlock = scheduler.enqueueServerSync('blocker', [makeTool('x')]);
    await flushMicrotasks();

    const pGlobalStale = scheduler.enqueueServerSync('global-srv', [makeTool('g')]);
    const pToolRemoval = scheduler.enqueueToolRemoval('personal-srv', ['personal-srv:disabled']);
    const pPersonalPartial = scheduler.enqueueServerSync(
      'personal-srv',
      [makeTool('personal-srv:enabled')],
      { partial: true },
    );

    const pResync = scheduler.requestFullResync('dimension-reset', { bumpGeneration: true });

    blocker.resolve();
    await Promise.all([pBlock, pGlobalStale, pToolRemoval, pPersonalPartial, pResync]);
    await scheduler.waitForIdle();

    // Global stale sync was dropped, but disabled tool removal and personal partial sync ran
    expect(mocks.removeToolEmbeddings).toHaveBeenCalledWith('personal-srv', [
      'personal-srv:disabled',
    ]);
    expect(mocks.saveServerTools.mock.calls.map((c) => c[0])).toEqual(['blocker', 'personal-srv']);
    expect(mocks.saveServerTools.mock.calls[1][1]).toEqual([makeTool('personal-srv:enabled')]);
    expect(mocks.saveServerTools.mock.calls[1][2]).toEqual({ partial: true });
    expect(mocks.syncAllServerTools).toHaveBeenCalledTimes(1);
  });

  it('preserves latest snapshot order for single -> partial -> single and partial -> single -> partial sequences', async () => {
    const mocks = createMockExecutor();
    const scheduler = new EmbeddingSyncScheduler(mocks.executor);

    const blocker = createDeferred();
    mocks.saveServerTools.mockImplementationOnce(async () => {
      await blocker.promise;
    });

    const pBlock = scheduler.enqueueServerSync('blocker', [makeTool('x')]);
    await flushMicrotasks();

    // Sequence 1: single(v1) -> partial(v2) -> single(v3) on server 's1'
    const s1a = scheduler.enqueueSingleToolSync('s1', makeTool('t', 'v1'));
    const s1b = scheduler.enqueueServerSync('s1', [makeTool('t', 'v2')], { partial: true });
    const s1c = scheduler.enqueueSingleToolSync('s1', makeTool('t', 'v3'));

    // Sequence 2: partial(v1) -> single(v2) -> partial(v3) on server 's2'
    const s2a = scheduler.enqueueServerSync('s2', [makeTool('t', 'v1')], { partial: true });
    const s2b = scheduler.enqueueSingleToolSync('s2', makeTool('t', 'v2'));
    const s2c = scheduler.enqueueServerSync('s2', [makeTool('t', 'v3')], { partial: true });

    blocker.resolve();
    await Promise.all([pBlock, s1a, s1b, s1c, s2a, s2b, s2c]);
    await scheduler.waitForIdle();

    expect(mocks.saveServerTools).toHaveBeenCalledTimes(3);
    expect(mocks.saveServerTools).toHaveBeenNthCalledWith(2, 's1', [makeTool('t', 'v3')], {
      partial: true,
    });
    expect(mocks.saveServerTools).toHaveBeenNthCalledWith(3, 's2', [makeTool('t', 'v3')], {
      partial: true,
    });
  });

  it('retains a pending full resync across generation bumps so both callers await the same execution and share failures', async () => {
    const mocks = createMockExecutor();
    const scheduler = new EmbeddingSyncScheduler(mocks.executor);

    const blocker = createDeferred();
    mocks.saveServerTools.mockImplementationOnce(async () => {
      await blocker.promise;
    });

    let resyncStarted = false;
    mocks.syncAllServerTools.mockImplementationOnce(async () => {
      resyncStarted = true;
      throw new Error('resync provider failure');
    });

    const pBlock = scheduler.enqueueServerSync('blocker', [makeTool('x')]);
    await flushMicrotasks();

    let firstSettled = false;
    const r1 = scheduler.requestFullResync('config-change-1', { bumpGeneration: true });
    const r1Outcome = r1
      .then(() => {
        firstSettled = true;
        return 'resolved';
      })
      .catch((err: Error) => {
        firstSettled = true;
        return `rejected:${err.message}`;
      });

    const r2 = scheduler.requestFullResync('config-change-2', { bumpGeneration: true });
    const r2Outcome = r2
      .then(() => 'resolved')
      .catch((err: Error) => `rejected:${err.message}`);

    await flushMicrotasks();
    // Neither caller may resolve before the coalesced resync actually executes
    expect(resyncStarted).toBe(false);
    expect(firstSettled).toBe(false);

    blocker.resolve();
    await pBlock;

    expect(await r1Outcome).toBe('rejected:resync provider failure');
    expect(await r2Outcome).toBe('rejected:resync provider failure');
    expect(mocks.syncAllServerTools).toHaveBeenCalledTimes(1);
    await scheduler.waitForIdle();
  });
});
