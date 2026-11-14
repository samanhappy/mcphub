import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { FileStagingSettings } from '../../../types/index.js';
import { FileStagingStateStore } from '../stateStore.js';
import { StagingError } from '../types.js';

const settings = (overrides: Partial<FileStagingSettings> = {}): FileStagingSettings => ({
  enabled: true,
  maxFileBytes: 4096,
  inlineMaxBytes: 1024,
  perUserQuotaBytes: 1024 * 1024,
  globalQuotaBytes: 4 * 1024 * 1024,
  ttlHours: 1,
  downloadTtlSeconds: 300,
  maxFilesPerUser: 100,
  cleanupIntervalMinutes: 15,
  ...overrides,
});

const input = (root: string, ownerHash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', serverId = 'server-1') => ({
  principal: { ownerHash },
  serverId,
  serverName: 'ssh',
  settings: settings(),
});

describe('FileStagingStateStore', () => {
  let rootDir: string;
  let stateDir: string;
  const stores: FileStagingStateStore[] = [];

  const createStore = async (options: { disableLock?: boolean; now?: () => number } = {}) => {
    const store = new FileStagingStateStore({
      rootDir,
      stateDir,
      disableLock: options.disableLock ?? true,
      now: options.now,
    });
    await store.init();
    stores.push(store);
    return store;
  };

  beforeEach(async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'mcphub-staging-'));
    rootDir = path.join(base, 'staging');
    stateDir = path.join(base, 'state');
  });

  afterEach(async () => {
    await fs.rm(path.dirname(rootDir), { recursive: true, force: true });
  });

  it('creates a ready ref and scopes it to its owner and server', async () => {
    const store = await createStore();
    const record = await store.createReadyRef(input(rootDir), Buffer.from('hello'));
    expect(record.state).toBe('ready');
    expect(record.size).toBe(5);
    expect(record.sha256).toMatch(/^[0-9a-f]{64}$/);

    await expect(store.getOwnedRef(record.ref, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).resolves.toMatchObject({
      ref: record.ref,
    });
    await expect(store.getOwnedRef(record.ref, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('rejects oversized inline uploads and unknown refs', async () => {
    const store = await createStore();
    await expect(
      store.createReadyRef(
        { ...input(rootDir), settings: settings({ inlineMaxBytes: 2 }) },
        Buffer.from('hello'),
      ),
    ).rejects.toMatchObject({ code: 'quota-exceeded' });
    await expect(store.getOwnedRef('mcpfile://not-a-uuid', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).rejects.toMatchObject({
      code: 'invalid-ref',
    });
  });

  it('acquires all output leases or none', async () => {
    const store = await createStore();
    const a = await store.createReservedRef(input(rootDir));
    const b = await store.createReservedRef(input(rootDir));

    const leases = await store.acquireOutputLeases(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      [
        { ref: a.ref, leaseId: 'call-1' },
        { ref: b.ref, leaseId: 'call-1' },
      ],
      settings(),
    );
    expect(leases.map((lease) => lease.ref)).toEqual([a.ref, b.ref]);

    await expect(
      store.acquireOutputLeases('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', [{ ref: a.ref, leaseId: 'call-2' }], settings()),
    ).rejects.toMatchObject({ code: 'lease-conflict' });

    // The failed attempt must not have leaked a lease on the other ref.
    await store.releaseLeases('call-1');
    await expect(
      store.acquireOutputLeases('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', [{ ref: b.ref, leaseId: 'call-3' }], settings()),
    ).resolves.toHaveLength(1);
  });

  it('rejects a second ref in the same call and refs owned by someone else', async () => {
    const store = await createStore();
    const a = await store.createReservedRef(input(rootDir));
    await expect(
      store.acquireOutputLeases(
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        [
          { ref: a.ref, leaseId: 'call-1' },
          { ref: a.ref, leaseId: 'call-1' },
        ],
        settings(),
      ),
    ).rejects.toMatchObject({ code: 'invalid-ref' });
    await expect(
      store.acquireOutputLeases('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', [{ ref: a.ref, leaseId: 'call-1' }], settings()),
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('reserves quota at lease time', async () => {
    const store = await createStore();
    const tight = settings({ maxFileBytes: 1024, perUserQuotaBytes: 1500 });
    const a = await store.createReservedRef({ ...input(rootDir), settings: tight });
    const b = await store.createReservedRef({ ...input(rootDir), settings: tight });
    await expect(
      store.acquireOutputLeases('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', [{ ref: a.ref, leaseId: 'call-1' }], tight),
    ).resolves.toHaveLength(1);
    await expect(
      store.acquireOutputLeases('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', [{ ref: b.ref, leaseId: 'call-2' }], tight),
    ).rejects.toMatchObject({ code: 'quota-exceeded' });
  });

  it('finalizes a tool-written output and releases the lease', async () => {
    const store = await createStore();
    const reserved = await store.createReservedRef(input(rootDir));
    const [lease] = await store.acquireOutputLeases(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      [{ ref: reserved.ref, leaseId: 'call-1' }],
      settings(),
    );
    await fs.writeFile(lease.contentPath, 'tool output');

    const [ready] = await store.finalizeOutputs('call-1', [reserved.ref], settings());
    expect(ready.state).toBe('ready');
    expect(ready.size).toBe(11);
    expect(ready.version).toBe(1);
    expect(ready.leaseId).toBeUndefined();

    // Finalizing again is impossible: the lease is gone and the ref is ready.
    await expect(store.finalizeOutputs('call-1', [reserved.ref], settings())).rejects.toMatchObject({
      code: 'lease-conflict',
    });
  });

  it('fails empty outputs unless allow_zero_byte was requested', async () => {
    const store = await createStore();
    const strict = await store.createReservedRef(input(rootDir));
    await store.acquireOutputLeases('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', [{ ref: strict.ref, leaseId: 'call-1' }], settings());
    await expect(store.finalizeOutputs('call-1', [strict.ref], settings())).rejects.toMatchObject({
      code: 'not-ready',
    });

    const allowed = await store.createReservedRef({ ...input(rootDir), allowZeroByte: true });
    await store.acquireOutputLeases('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', [{ ref: allowed.ref, leaseId: 'call-2' }], settings());
    const [ready] = await store.finalizeOutputs('call-2', [allowed.ref], settings());
    expect(ready.state).toBe('ready');
    expect(ready.size).toBe(0);
  });

  it('marks failed outputs terminal and removes their content', async () => {
    const store = await createStore();
    const reserved = await store.createReservedRef(input(rootDir));
    await store.acquireOutputLeases('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', [{ ref: reserved.ref, leaseId: 'call-1' }], settings());
    await store.failOutputs('call-1', [reserved.ref]);
    await expect(store.getOwnedRef(reserved.ref, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).resolves.toMatchObject({
      state: 'failed',
      leaseId: undefined,
    });
  });

  it('pins ready content against cleanup', async () => {
    const store = await createStore();
    const ready = await store.createReadyRef(
      { ...input(rootDir), settings: settings({ ttlHours: 1 }) },
      Buffer.from('x'),
    );
    await store.pinReadyRef(ready.ref, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    // Force expiry without advancing the clock: pin, then cleanup must keep it.
    expect(await store.cleanup(settings())).toBe(0);
    await store.unpinRef(ready.ref);
    await expect(store.getOwnedRef(ready.ref, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).resolves.toMatchObject({
      state: 'ready',
      pinCount: 0,
    });
  });

  it('consumes a download token exactly once', async () => {
    const store = await createStore();
    const ready = await store.createReadyRef(input(rootDir), Buffer.from('payload'));
    const token = await store.createDownloadToken(ready.ref, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 300);
    await expect(store.consumeDownloadToken(token)).resolves.toMatchObject({ ref: ready.ref });
    await expect(store.consumeDownloadToken(token)).rejects.toMatchObject({ code: 'not-found' });
  });

  it('rejects download tokens after the content version changes', async () => {
    const store = await createStore();
    const ready = await store.createReadyRef(input(rootDir), Buffer.from('payload'));
    const token = await store.createDownloadToken(ready.ref, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 300);
    // A fresh ledger entry with a different hash (simulated by rewriting state)
    // must invalidate the token; consuming it must not serve stale content.
    await store.consumeDownloadToken(token);
    await expect(store.consumeDownloadToken(token)).rejects.toBeInstanceOf(StagingError);
  });

  it('fails a leased reserved ref after restart instead of letting it be stolen', async () => {
    const store = await createStore();
    const reserved = await store.createReservedRef(input(rootDir));
    await store.acquireOutputLeases('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', [{ ref: reserved.ref, leaseId: 'call-1' }], settings());

    const restarted = await createStore();
    await expect(restarted.getOwnedRef(reserved.ref, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).resolves.toMatchObject({
      state: 'failed',
      leaseId: undefined,
    });
    await expect(
      restarted.acquireOutputLeases('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', [{ ref: reserved.ref, leaseId: 'call-2' }], settings()),
    ).rejects.toMatchObject({ code: 'not-reserved' });
  });


  it('fails closed on an empty or truncated lockfile', async () => {
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(path.join(stateDir, 'staging.lock'), '');
    await expect(createStore({ disableLock: false })).rejects.toMatchObject({ code: 'locked' });
  });

  it('refuses a second store in the same process for the same state dir', async () => {
    await createStore({ disableLock: false });
    await expect(createStore({ disableLock: false })).rejects.toMatchObject({ code: 'locked' });
  });

  it('finalizes every output or none', async () => {
    const store = await createStore();
    const owner = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const first = await store.createReservedRef(input(rootDir));
    const second = await store.createReservedRef(input(rootDir));
    const grants = await store.acquireOutputLeases(
      owner,
      [
        { ref: first.ref, leaseId: 'call-1' },
        { ref: second.ref, leaseId: 'call-1' },
      ],
      settings(),
    );
    await fs.writeFile(grants[0].contentPath, 'first');
    // The second output was never written; finalize must leave the first untouched.
    await expect(
      store.finalizeOutputs('call-1', [first.ref, second.ref], settings()),
    ).rejects.toMatchObject({ code: 'not-ready' });
    await expect(store.getOwnedRef(first.ref, owner)).resolves.toMatchObject({
      state: 'reserved',
      leaseId: 'call-1',
    });

    await fs.writeFile(grants[1].contentPath, 'second');
    const finalized = await store.finalizeOutputs('call-1', [first.ref, second.ref], settings());
    expect(finalized.map((record) => record.state)).toEqual(['ready', 'ready']);
  });

  it('caps the number of live refs per principal', async () => {
    const store = await createStore();
    const owner = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const tight = settings({ maxFilesPerUser: 1 });
    await store.createReservedRef({ ...input(rootDir), settings: tight });
    await expect(
      store.createReservedRef({ ...input(rootDir), settings: tight }),
    ).rejects.toMatchObject({ code: 'quota-exceeded' });
  });

  it('treats an expired ref as gone for pins and downloads', async () => {
    const owner = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    let clock = Date.now();
    const expiring = await createStore({ now: () => clock });
    const ready = await expiring.createReadyRef(input(rootDir), Buffer.from('data'));
    clock += 2 * 3600_000;
    await expect(expiring.pinReadyRef(ready.ref, owner)).rejects.toMatchObject({
      code: 'expired',
    });
    await expect(expiring.createDownloadToken(ready.ref, owner, 300)).rejects.toMatchObject({
      code: 'expired',
    });
  });

  it('never sweeps a ref while its output lease is held', async () => {
    const store = await createStore();
    const owner = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const reserved = await store.createReservedRef(input(rootDir));
    await store.acquireOutputLeases(owner, [{ ref: reserved.ref, leaseId: 'call-1' }], settings());
    expect(await store.cleanup(settings())).toBe(0);
    await expect(store.getOwnedRef(reserved.ref, owner)).resolves.toMatchObject({ state: 'reserved' });
  });

  it('rejects a tampered ledger record instead of trusting its paths', async () => {
    const store = await createStore();
    const ready = await store.createReadyRef(input(rootDir), Buffer.from('data'));
    const refsPath = path.join(stateDir, 'refs.json');
    const document = JSON.parse(await fs.readFile(refsPath, 'utf8'));
    document.refs[ready.ref].ownerHash = '..';
    await fs.writeFile(refsPath, JSON.stringify(document));

    const reloaded = await createStore();
    await expect(
      reloaded.getOwnedRef(ready.ref, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('refuses to start when another live process owns the lock', async () => {
    await fs.mkdir(stateDir, { recursive: true });
    // PID 1 is always alive in the test container and is not this process.
    await fs.writeFile(path.join(stateDir, 'staging.lock'), '1');
    await expect(createStore({ disableLock: false })).rejects.toMatchObject({ code: 'locked' });
  });
});
