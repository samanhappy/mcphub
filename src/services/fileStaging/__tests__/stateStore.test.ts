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
  uploadTtlSeconds: 900,
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

  it('rolls back the ref and token when metadata writing fails', async () => {
    const store = await createStore();
    const owner = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const originalWriteMeta = (store as any).writeMeta.bind(store);
    (store as any).writeMeta = async () => {
      throw new Error('metadata write failed');
    };

    await expect(
      store.createUploadLink({ ...input(rootDir), maxBytes: 4096, settings: settings() }, 60),
    ).rejects.toThrow('metadata write failed');
    (store as any).writeMeta = originalWriteMeta;

    expect(await store.usageBytes(owner)).toBe(0);
    expect(await store.cleanup(settings())).toBe(0);
  });

  it('rolls the persisted state back when persist fails after writing', async () => {
    const store = await createStore();
    const owner = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const originalPersist = (store as any).persist.bind(store);
    let calls = 0;
    (store as any).persist = async () => {
      calls += 1;
      await originalPersist();
      if (calls === 1) throw new Error('persist failed after rename');
    };

    await expect(
      store.createUploadLink({ ...input(rootDir), maxBytes: 4096, settings: settings() }, 60),
    ).rejects.toThrow('persist failed after rename');
    (store as any).persist = originalPersist;

    // The rollback must have written the old state, not merely cleared memory.
    const reloaded = new FileStagingStateStore({ rootDir, stateDir, disableLock: true });
    await reloaded.init();
    expect(await reloaded.usageBytes(owner)).toBe(0);
  });

  it('creates the reserved ref and upload token atomically', async () => {
    const store = await createStore();
    const owner = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const { record, token, expiresAt } = await store.createUploadLink(
      { ...input(rootDir), maxBytes: 4096, settings: settings() },
      60,
    );
    expect(record.state).toBe('reserved');
    expect(record.reservedBytes).toBe(4096);
    await expect(store.getUploadToken(token)).resolves.toMatchObject({
      ref: record.ref,
      kind: 'upload',
      expiresAt,
    });

    // An immediate cleanup sees the token, so the quota stays reserved.
    await store.cleanup(settings());
    expect(await store.usageBytes(owner)).toBe(4096);
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

  it('keeps a reservation held by an active output lease during cleanup', async () => {
    const store = await createStore();
    const owner = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const reserved = await store.createReservedRef({
      ...input(rootDir),
      maxBytes: 4096,
      settings: settings(),
    });
    await store.acquireOutputLeases(owner, [{ ref: reserved.ref, leaseId: 'call-1' }], settings());
    expect(await store.usageBytes(owner)).toBe(4096);

    await store.cleanup(settings());

    expect(await store.usageBytes(owner)).toBe(4096);
    await expect(store.getOwnedRef(reserved.ref, owner)).resolves.toMatchObject({
      state: 'reserved',
      leaseId: 'call-1',
      reservedBytes: 4096,
    });
  });

  it('fails finalize when the principal directory was replaced by a symlink', async () => {
    const store = await createStore();
    const owner = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const reserved = await store.createReservedRef(input(rootDir));
    await store.acquireOutputLeases(owner, [{ ref: reserved.ref, leaseId: 'call-1' }], settings());
    // The tool shares this UID: it can swap its own ref directory for a link to
    // a file it wrote elsewhere. Finalize must not digest through the link.
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mcphub-outside-'));
    const refDirectory = path.dirname(
      path.join(rootDir, owner, reserved.id, 'content'),
    );
    await fs.rename(refDirectory, path.join(outside, 'moved'));
    await fs.writeFile(path.join(outside, 'elsewhere'), 'foreign content');
    await fs.symlink(outside, refDirectory);
    try {
      await expect(
        store.finalizeOutputs('call-1', [reserved.ref], settings()),
      ).rejects.toThrow(/symlink/i);
      await expect(store.getOwnedRef(reserved.ref, owner)).resolves.toMatchObject({
        state: 'reserved',
        leaseId: 'call-1',
      });

      // The caller fails the output after a rejected finalize; it is terminal.
      await store.failOutputs('call-1', [reserved.ref]);
      await expect(store.getOwnedRef(reserved.ref, owner)).resolves.toMatchObject({
        state: 'failed',
        leaseId: undefined,
      });
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
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

  it('consumes a download token exactly once', async () => {
    const store = await createStore();
    const ready = await store.createReadyRef(input(rootDir), Buffer.from('payload'));
    const token = await store.createDownloadToken(
      ready.ref,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      300,
    );
    await expect(store.consumeDownloadToken(token)).resolves.toMatchObject({ ref: ready.ref });
    await expect(store.consumeDownloadToken(token)).rejects.toMatchObject({ code: 'not-found' });
  });

  it('rejects a download token whose recorded content hash no longer matches the ref', async () => {
    const store = await createStore();
    const ready = await store.createReadyRef(input(rootDir), Buffer.from('payload'));
    const token = await store.createDownloadToken(
      ready.ref,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      300,
    );
    // Simulate a re-upload that replaced the content under the same ref: the
    // ledger row now carries a different hash, so the old link must not serve
    // the new bytes.
    const internals = store as unknown as {
      state: { refs: Record<string, { sha256?: string }> };
      persist: () => Promise<void>;
    };
    internals.state.refs[ready.ref].sha256 = 'b'.repeat(64);
    await internals.persist();
    await expect(store.consumeDownloadToken(token)).rejects.toMatchObject({ code: 'not-found' });
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

  it('refuses to start while another owner holds the lock', async () => {
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(path.join(stateDir, 'staging.lock'), '1');
    await expect(createStore({ disableLock: false })).rejects.toMatchObject({ code: 'locked' });
  });

  it('rejects a download token once the underlying ref has expired', async () => {
    let clock = Date.now();
    const store = await createStore({ now: () => clock });
    const ready = await store.createReadyRef(input(rootDir), Buffer.from('payload'));
    const token = await store.createDownloadToken(
      ready.ref,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      300,
    );
    // Past the ref TTL but before the token TTL would matter: cleanup runs on a
    // timer, so without the ref check the token would still serve the content.
    clock += 2 * 3600_000;
    await expect(store.consumeDownloadToken(token)).rejects.toMatchObject({ code: 'expired' });
  });

  it('finalizes a reserved ref from a one-time upload token', async () => {
    const store = await createStore();
    const ownerHash = input(rootDir).principal.ownerHash;
    const reserved = await store.createReservedRef(input(rootDir));
    const token = await store.createUploadToken(reserved.ref, ownerHash, 900);

    // Peeking must not consume the link; the browser may reload the page.
    const peeked = await store.getUploadToken(token);
    expect(peeked.ref).toBe(reserved.ref);
    expect(peeked.kind).toBe('upload');

    const record = await store.uploadWithToken(token, Buffer.from('browser bytes'), settings());
    expect(record.state).toBe('ready');
    expect(record.size).toBe(13);
    expect(record.sha256).toMatch(/^[a-f0-9]{64}$/);
    const content = path.join(rootDir, ownerHash, record.id, 'content');
    expect(await fs.readFile(content, 'utf8')).toBe('browser bytes');

    // The link is single use, and the ref is no longer writable.
    await expect(
      store.uploadWithToken(token, Buffer.from('again'), settings()),
    ).rejects.toMatchObject({ code: 'not-found' });
    await expect(
      store.createUploadToken(record.ref, ownerHash, 900),
    ).rejects.toMatchObject({ code: 'not-ready' });
  });

  it('rejects an upload token that outlived its link', async () => {
    let clock = Date.now();
    const store = await createStore({ now: () => clock });
    const reserved = await store.createReservedRef(input(rootDir));
    const token = await store.createUploadToken(
      reserved.ref,
      input(rootDir).principal.ownerHash,
      900,
    );
    clock += 901_000;
    await expect(
      store.uploadWithToken(token, Buffer.from('late'), settings()),
    ).rejects.toMatchObject({ code: 'expired' });
  });

  it('rejects an upload larger than the configured limit and leaves the ref writable', async () => {
    const store = await createStore();
    const ownerHash = input(rootDir).principal.ownerHash;
    const reserved = await store.createReservedRef(input(rootDir));
    const token = await store.createUploadToken(reserved.ref, ownerHash, 900);
    await expect(
      store.uploadWithToken(token, Buffer.alloc(5000), settings({ maxFileBytes: 4096 })),
    ).rejects.toMatchObject({ code: 'quota-exceeded' });
    // Nothing was consumed: a smaller retry still succeeds.
    const record = await store.uploadWithToken(token, Buffer.from('ok'), settings());
    expect(record.state).toBe('ready');
  });

  it('refuses a browser upload while a tool holds the output lease', async () => {
    const store = await createStore();
    const ownerHash = input(rootDir).principal.ownerHash;
    const reserved = await store.createReservedRef(input(rootDir));
    const token = await store.createUploadToken(reserved.ref, ownerHash, 900);
    await store.acquireOutputLeases(
      ownerHash,
      [{ ref: reserved.ref, leaseId: 'call-1' }],
      settings(),
    );

    await expect(
      store.uploadWithToken(token, Buffer.from('browser'), settings()),
    ).rejects.toMatchObject({ code: 'not-ready' });

    // The link survives: once the lease is released the upload still works.
    await store.releaseLeases('call-1');
    const record = await store.uploadWithToken(token, Buffer.from('browser'), settings());
    expect(record.state).toBe('ready');
  });

  it('reserves the announced ceiling against the quota when the link is minted', async () => {
    const store = await createStore();
    const tight = settings({ perUserQuotaBytes: 3000, maxFileBytes: 4096 });
    const first = await store.createReservedRef({ ...input(rootDir), maxBytes: 2000, settings: tight });
    expect(first.reservedBytes).toBe(2000);
    await expect(
      store.createReservedRef({ ...input(rootDir), maxBytes: 2000, settings: tight }),
    ).rejects.toMatchObject({ code: 'quota-exceeded' });
  });

  it('refuses a browser upload through a ref directory replaced by a symlink', async () => {
    const store = await createStore();
    const ownerHash = input(rootDir).principal.ownerHash;
    const reserved = await store.createReservedRef(input(rootDir));
    const token = await store.createUploadToken(reserved.ref, ownerHash, 900);

    // A tool shares this process's UID and can replace its own ref directory.
    const outside = path.join(path.dirname(rootDir), 'outside-upload');
    await fs.mkdir(outside, { recursive: true });
    const refDirectory = path.join(rootDir, ownerHash, reserved.id);
    await fs.rename(refDirectory, path.join(path.dirname(rootDir), 'moved-upload'));
    await fs.symlink(outside, refDirectory);

    await expect(
      store.uploadWithToken(token, Buffer.from('escape'), settings()),
    ).rejects.toThrow(/symlinked path component/i);
    await expect(fs.stat(path.join(outside, 'content'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('accepts an upload that exactly fills the announced ceiling', async () => {
    const store = await createStore();
    const tight = settings({ perUserQuotaBytes: 3000, maxFileBytes: 4096 });
    const reserved = await store.createReservedRef({
      ...input(rootDir),
      maxBytes: 2000,
      settings: tight,
    });
    const token = await store.createUploadToken(reserved.ref, input(rootDir).principal.ownerHash, 900);

    // The ref's own reservation must not be counted a second time.
    const record = await store.uploadWithToken(token, Buffer.alloc(2000), tight);
    expect(record.state).toBe('ready');
    expect(record.size).toBe(2000);
  });

  it('rejects an upload one byte over the remaining budget', async () => {
    const store = await createStore();
    const tight = settings({ perUserQuotaBytes: 3000, maxFileBytes: 4096 });
    const reserved = await store.createReservedRef({
      ...input(rootDir),
      maxBytes: 2000,
      settings: tight,
    });
    const token = await store.createUploadToken(reserved.ref, input(rootDir).principal.ownerHash, 900);
    await expect(
      store.uploadWithToken(token, Buffer.alloc(3001), tight),
    ).rejects.toMatchObject({ code: 'quota-exceeded' });
  });

  it('releases the reservation once an unused upload link is gone', async () => {
    let clock = Date.now();
    const store = await createStore({ now: () => clock });
    const tight = settings({ perUserQuotaBytes: 3000, maxFileBytes: 4096 });
    await store.createReservedRef({ ...input(rootDir), maxBytes: 3000, settings: tight });
    // A second link cannot fit while the first holds its ceiling.
    await expect(
      store.createReservedRef({ ...input(rootDir), maxBytes: 3000, settings: tight }),
    ).rejects.toMatchObject({ code: 'quota-exceeded' });

    // The link expires unused; the next sweep must return its quota.
    clock += 901_000;
    await store.cleanup(tight);
    const again = await store.createReservedRef({
      ...input(rootDir),
      maxBytes: 3000,
      settings: tight,
    });
    expect(again.state).toBe('reserved');
  });
});
