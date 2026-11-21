import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { EntityManager } from 'typeorm';

import type { FileStagingSettings } from '../../../types/index.js';
import type { FileStagingRefEntity } from '../../../db/entities/FileStagingRef.js';
import type { FileStagingTokenEntity } from '../../../db/entities/FileStagingToken.js';
import { FileStagingRepository } from '../../../db/repositories/FileStagingRepository.js';
import { DbStagingStateStore } from '../dbStateStore.js';

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

/** In-memory repository with transaction rollback, mirroring the real one. */
class FakeRepository extends FileStagingRepository {
  refs = new Map<string, FileStagingRefEntity>();
  tokens = new Map<string, FileStagingTokenEntity>();
  private view?: { refs: Map<string, FileStagingRefEntity>; tokens: Map<string, FileStagingTokenEntity> };

  /**
   * Real PostgreSQL serializes two transactions that lock the same row with
   * `pessimistic_write`. The fake has no row locks, so it serializes the whole
   * transaction instead; that is the same guarantee for a single-token test.
   */
  private queue: Promise<unknown> = Promise.resolve();

  override async transaction<T>(run: (manager: EntityManager) => Promise<T>): Promise<T> {
    const next = this.queue.then(() => this.runTransaction(run));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async runTransaction<T>(run: (manager: EntityManager) => Promise<T>): Promise<T> {
    const refs = new Map(
      [...this.refs].map(([key, value]) => [key, structuredClone(value)] as const),
    );
    const tokens = new Map(
      [...this.tokens].map(([key, value]) => [key, structuredClone(value)] as const),
    );
    const previous = this.view;
    this.view = { refs, tokens };
    try {
      const result = await run({} as EntityManager);
      this.refs = refs;
      this.tokens = tokens;
      return result;
    } finally {
      this.view = previous;
    }
  }

  private current() {
    return this.view ?? { refs: this.refs, tokens: this.tokens };
  }

  /** Recorded so tests can prove quota reads happen under the lock. */
  quotaLockCalls = 0;

  override async lockQuota(): Promise<void> {
    this.quotaLockCalls += 1;
  }

  override async findRef(_m: EntityManager, ref: string): Promise<FileStagingRefEntity | null> {
    return this.current().refs.get(ref) ?? null;
  }

  override async findRefs(_m: EntityManager, refs: readonly string[]): Promise<FileStagingRefEntity[]> {
    return refs
      .map((ref) => this.current().refs.get(ref))
      .filter((row): row is FileStagingRefEntity => Boolean(row))
      .sort((a, b) => a.ref.localeCompare(b.ref));
  }

  override async saveRef(_m: EntityManager, row: FileStagingRefEntity): Promise<FileStagingRefEntity> {
    this.current().refs.set(row.ref, structuredClone(row));
    return row;
  }

  override async deleteRef(_m: EntityManager, ref: string): Promise<void> {
    this.current().refs.delete(ref);
  }

  override async listRefs(): Promise<FileStagingRefEntity[]> {
    return [...this.current().refs.values()];
  }

  override async findToken(_m: EntityManager, tokenHash: string) {
    return this.current().tokens.get(tokenHash) ?? null;
  }

  override async saveToken(_m: EntityManager, row: FileStagingTokenEntity) {
    this.current().tokens.set(row.tokenHash, structuredClone(row));
    return row;
  }

  override async listTokens() {
    return [...this.current().tokens.values()];
  }

  override async deleteToken(_m: EntityManager, tokenHash: string): Promise<void> {
    this.current().tokens.delete(tokenHash);
  }
}

const input = (rootDir: string, ownerHash = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') => ({
  principal: { ownerHash },
  serverId: 'server-1',
  serverName: 'ssh',
  settings: settings(),
});

describe('DbStagingStateStore', () => {
  let rootDir: string;
  let stateDir: string;
  let repository: FakeRepository;
  let store: DbStagingStateStore;

  beforeEach(async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'mcphub-dbstaging-'));
    rootDir = path.join(base, 'staging');
    stateDir = path.join(base, 'state');
    repository = new FakeRepository();
    store = new DbStagingStateStore(repository, { rootDir, stateDir });
    await store.init();
  });

  afterEach(async () => {
    await fs.rm(path.dirname(rootDir), { recursive: true, force: true });
  });

  it('scopes refs to their owner', async () => {
    const ready = await store.createReadyRef(input(rootDir), Buffer.from('hello'));
    await expect(store.getOwnedRef(ready.ref, 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('acquires all output leases atomically and rejects a competing call', async () => {
    const a = await store.createReservedRef(input(rootDir));
    const b = await store.createReservedRef(input(rootDir));
    await expect(
      store.acquireOutputLeases(
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        [
          { ref: a.ref, leaseId: 'call-1' },
          { ref: b.ref, leaseId: 'call-1' },
        ],
        settings(),
      ),
    ).resolves.toHaveLength(2);
    await expect(
      store.acquireOutputLeases('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', [{ ref: a.ref, leaseId: 'call-2' }], settings()),
    ).rejects.toMatchObject({ code: 'lease-conflict' });
    // The failed attempt must not have overwritten the first call's leases.
    const rows = [...repository.refs.values()];
    expect(rows.filter((row) => row.leaseId === 'call-1')).toHaveLength(2);
  });

  it('rolls back a partial multi-ref lease when one ref is already leased', async () => {
    const a = await store.createReservedRef(input(rootDir));
    const b = await store.createReservedRef(input(rootDir));
    await store.acquireOutputLeases('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', [{ ref: a.ref, leaseId: 'call-1' }], settings());
    await expect(
      store.acquireOutputLeases(
        'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        [
          { ref: b.ref, leaseId: 'call-2' },
          { ref: a.ref, leaseId: 'call-2' },
        ],
        settings(),
      ),
    ).rejects.toMatchObject({ code: 'lease-conflict' });
    expect(repository.refs.get(b.ref)?.leaseId).toBeNull();
  });

  it('reserves quota at lease time', async () => {
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

  it('finalizes tool output and rejects a second finalize', async () => {
    const reserved = await store.createReservedRef(input(rootDir));
    const [lease] = await store.acquireOutputLeases(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      [{ ref: reserved.ref, leaseId: 'call-1' }],
      settings(),
    );
    await fs.writeFile(lease.contentPath, 'tool output');
    const [ready] = await store.finalizeOutputs('call-1', [reserved.ref], settings());
    expect(ready).toMatchObject({ state: 'ready', size: 11, version: 1 });
    expect(repository.refs.get(reserved.ref)?.leaseId).toBeNull();
    await expect(store.finalizeOutputs('call-1', [reserved.ref], settings())).rejects.toMatchObject({
      code: 'lease-conflict',
    });
  });

  it('fails finalize when the principal directory was replaced by a symlink', async () => {
    const owner = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const reserved = await store.createReservedRef(input(rootDir));
    await store.acquireOutputLeases(owner, [{ ref: reserved.ref, leaseId: 'call-1' }], settings());
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'mcphub-outside-'));
    const refDirectory = path.join(rootDir, owner, reserved.id);
    await fs.rename(refDirectory, path.join(outside, 'moved'));
    await fs.writeFile(path.join(outside, 'elsewhere'), 'foreign content');
    await fs.symlink(outside, refDirectory);
    try {
      await expect(
        store.finalizeOutputs('call-1', [reserved.ref], settings()),
      ).rejects.toThrow(/symlink/i);
      // The transaction rolled back: the row still holds its lease.
      expect(repository.refs.get(reserved.ref)).toMatchObject({
        state: 'reserved',
        leaseId: 'call-1',
      });

      await store.failOutputs('call-1', [reserved.ref]);
      await expect(store.getOwnedRef(reserved.ref, owner)).resolves.toMatchObject({
        state: 'failed',
        leaseId: undefined,
      });
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('rejects empty output unless allow_zero_byte is set', async () => {
    const reserved = await store.createReservedRef(input(rootDir));
    await store.acquireOutputLeases('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', [{ ref: reserved.ref, leaseId: 'call-1' }], settings());
    await expect(store.finalizeOutputs('call-1', [reserved.ref], settings())).rejects.toMatchObject({
      code: 'not-ready',
    });
  });

  it('turns a leased ref into failed on restart', async () => {
    const reserved = await store.createReservedRef(input(rootDir));
    await store.acquireOutputLeases('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', [{ ref: reserved.ref, leaseId: 'call-1' }], settings());
    const restarted = new DbStagingStateStore(repository, { rootDir, stateDir });
    await restarted.init();
    await expect(restarted.getOwnedRef(reserved.ref, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).resolves.toMatchObject({
      state: 'failed',
      leaseId: undefined,
    });
  });

  it('consumes a download token once and binds it to the ready version', async () => {
    const ready = await store.createReadyRef(input(rootDir), Buffer.from('payload'));
    const token = await store.createDownloadToken(ready.ref, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 300);
    await expect(store.consumeDownloadToken(token)).resolves.toMatchObject({ ref: ready.ref });
    await expect(store.consumeDownloadToken(token)).rejects.toMatchObject({ code: 'not-found' });
  });

  it('keeps pinned content during cleanup and removes failed rows', async () => {
    const ready = await store.createReadyRef(input(rootDir), Buffer.from('payload'));
    await store.pinReadyRef(ready.ref, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    const failed = await store.createReservedRef(input(rootDir));
    await store.acquireOutputLeases('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', [{ ref: failed.ref, leaseId: 'call-1' }], settings());
    await store.failOutputs('call-1', [failed.ref]);
    expect(await store.cleanup(settings())).toBe(1);
    await expect(store.getOwnedRef(ready.ref, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).resolves.toMatchObject({ state: 'ready' });
    await expect(store.getOwnedRef(failed.ref, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('keeps a ready ref alive while a live download token exists', async () => {
    let clock = Date.now();
    const repository = new FakeRepository();
    const store = new DbStagingStateStore(repository, {
      rootDir,
      stateDir,
      disableLock: true,
      now: () => clock,
    });
    await store.init();
    const short = settings({ ttlHours: 0.001 });
    const ready = await store.createReadyRef({ ...input(rootDir), settings: short }, Buffer.from('bytes'));
    const token = await store.createDownloadToken(
      ready.ref,
      input(rootDir).principal.ownerHash,
      300,
    );
    expect(token).toBeTruthy();

    clock += 60_000;
    await store.cleanup(short);
    await expect(store.getOwnedRef(ready.ref, input(rootDir).principal.ownerHash)).resolves.toMatchObject({
      state: 'ready',
    });

    clock += 400_000;
    await store.cleanup(short);
    await expect(store.getOwnedRef(ready.ref, input(rootDir).principal.ownerHash)).rejects.toMatchObject({
      code: 'not-found',
    });
    await expect(store.consumeDownloadToken(token)).rejects.toMatchObject({ code: 'not-found' });
  });

  it('keeps a reservation held by an active output lease during cleanup', async () => {
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

  it('does not clear a lease committed between the cleanup snapshot and the release', async () => {
    const owner = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const reserved = await store.createReservedRef({
      ...input(rootDir),
      maxBytes: 4096,
      settings: settings(),
    });
    const originalFindRefs = repository.findRefs.bind(repository);
    repository.findRefs = async (manager, refs, lock) => {
      const rows = await originalFindRefs(manager, refs, lock);
      // Simulate a concurrent lease that commits after `listRefs` read the
      // snapshot: cleanup must re-read the row under the lock, not save the
      // stale snapshot back.
      for (const row of rows) row.leaseId = 'call-race';
      return rows;
    };

    await store.cleanup(settings());

    await expect(store.getOwnedRef(reserved.ref, owner)).resolves.toMatchObject({
      state: 'reserved',
      leaseId: 'call-race',
      reservedBytes: 4096,
    });
  });

  it('takes the quota lock before the ref lock when finalizing an upload', async () => {
    const reserved = await store.createReservedRef({
      ...input(rootDir),
      maxBytes: 4096,
      settings: settings(),
    });
    const token = await store.createUploadToken(
      reserved.ref,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      60,
    );

    const order: string[] = [];
    const originalLock = repository.lockQuota.bind(repository);
    repository.lockQuota = async (manager: EntityManager) => {
      order.push('quota');
      await originalLock(manager);
    };
    const originalFindRef = repository.findRef.bind(repository);
    repository.findRef = async (manager: EntityManager, ref: string, lock = false) => {
      if (lock) order.push('ref');
      return originalFindRef(manager, ref, lock);
    };

    await store.uploadWithToken(token, Buffer.from('x'), settings());
    // `acquireOutputLeases` takes quota then ref; the upload must match that
    // order or the two transactions can deadlock.
    expect(order).toEqual(['quota', 'ref']);
  });

  it('takes the shared quota lock before accounting uploads and output leases', async () => {
    const order: string[] = [];
    const originalLock = repository.lockQuota.bind(repository);
    const originalList = repository.listRefs.bind(repository);
    repository.lockQuota = async (manager: EntityManager) => {
      order.push('lock');
      await originalLock(manager);
    };
    repository.listRefs = async (manager: EntityManager) => {
      order.push('usage');
      return originalList(manager);
    };

    await store.createReadyRef(input(rootDir), Buffer.from('x'));
    expect(order[0]).toBe('lock');

    order.length = 0;
    const reserved = await store.createReservedRef(input(rootDir));
    order.length = 0;
    await store.acquireOutputLeases(
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      [{ ref: reserved.ref, leaseId: 'call-1' }],
      settings(),
    );
    expect(order[0]).toBe('lock');
    expect(order).toContain('usage');
  });

  it('refuses to start alongside another hub process on the same state dir', async () => {
    const locked = new DbStagingStateStore(new FakeRepository(), {
      rootDir: path.join(path.dirname(rootDir), 'staging-locked'),
      stateDir: path.join(path.dirname(rootDir), 'state-locked'),
      disableLock: false,
    });
    await locked.init();
    const second = new DbStagingStateStore(new FakeRepository(), {
      rootDir: path.join(path.dirname(rootDir), 'staging-locked-2'),
      stateDir: path.join(path.dirname(rootDir), 'state-locked'),
      disableLock: false,
    });
    await expect(second.init()).rejects.toMatchObject({ code: 'locked' });
  });

  it('finalizes a reserved ref from a one-time upload token', async () => {
    const repository = new FakeRepository();
    const store = new DbStagingStateStore(repository, {
      rootDir,
      stateDir,
      disableLock: true,
    });
    await store.init();
    const ownerHash = input(rootDir).principal.ownerHash;
    const reserved = await store.createReservedRef(input(rootDir));
    const token = await store.createUploadToken(reserved.ref, ownerHash, 900);
    expect((await store.getUploadToken(token)).ref).toBe(reserved.ref);

    const record = await store.uploadWithToken(token, Buffer.from('browser bytes'), settings());
    expect(record.state).toBe('ready');
    expect(record.size).toBe(13);
    expect(await fs.readFile(path.join(rootDir, ownerHash, record.id, 'content'), 'utf8')).toBe(
      'browser bytes',
    );

    await expect(
      store.uploadWithToken(token, Buffer.from('again'), settings()),
    ).rejects.toMatchObject({ code: 'not-found' });
    await expect(store.createUploadToken(record.ref, ownerHash, 900)).rejects.toMatchObject({
      code: 'not-ready',
    });
  });

  it('rejects an oversized browser upload without consuming the link', async () => {
    const repository = new FakeRepository();
    const store = new DbStagingStateStore(repository, { rootDir, stateDir, disableLock: true });
    await store.init();
    const ownerHash = input(rootDir).principal.ownerHash;
    const reserved = await store.createReservedRef(input(rootDir));
    const token = await store.createUploadToken(reserved.ref, ownerHash, 900);
    await expect(
      store.uploadWithToken(token, Buffer.alloc(5000), settings({ maxFileBytes: 4096 })),
    ).rejects.toMatchObject({ code: 'quota-exceeded' });
    const record = await store.uploadWithToken(token, Buffer.from('ok'), settings());
    expect(record.state).toBe('ready');
  });

  it('lets only one of two concurrent uploads win the link', async () => {
    const repository = new FakeRepository();
    const store = new DbStagingStateStore(repository, { rootDir, stateDir, disableLock: true });
    await store.init();
    const ownerHash = input(rootDir).principal.ownerHash;
    const reserved = await store.createReservedRef(input(rootDir));
    const token = await store.createUploadToken(reserved.ref, ownerHash, 900);

    const results = await Promise.allSettled([
      store.uploadWithToken(token, Buffer.from('first'), settings()),
      store.uploadWithToken(token, Buffer.from('second'), settings()),
    ]);

    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'not-found' });

    // The committed bytes are the winner's, and the row matches them.
    const record = await store.getOwnedRef(reserved.ref, ownerHash);
    expect(record.state).toBe('ready');
    const content = await fs.readFile(path.join(rootDir, ownerHash, record.id, 'content'), 'utf8');
    expect(['first', 'second']).toContain(content);
    expect(record.size).toBe(content.length);
  });

  it('refuses a browser upload while a tool holds the output lease', async () => {
    const repository = new FakeRepository();
    const store = new DbStagingStateStore(repository, { rootDir, stateDir, disableLock: true });
    await store.init();
    const ownerHash = input(rootDir).principal.ownerHash;
    const reserved = await store.createReservedRef(input(rootDir));
    const token = await store.createUploadToken(reserved.ref, ownerHash, 900);
    await store.acquireOutputLeases(ownerHash, [{ ref: reserved.ref, leaseId: 'call-1' }], settings());

    await expect(
      store.uploadWithToken(token, Buffer.from('browser'), settings()),
    ).rejects.toMatchObject({ code: 'not-ready' });

    await store.releaseLeases('call-1');
    const record = await store.uploadWithToken(token, Buffer.from('browser'), settings());
    expect(record.state).toBe('ready');
  });

  it('reserves the announced ceiling against the quota when the link is minted', async () => {
    const repository = new FakeRepository();
    const store = new DbStagingStateStore(repository, { rootDir, stateDir, disableLock: true });
    await store.init();
    const tight = settings({ perUserQuotaBytes: 3000, maxFileBytes: 4096 });
    await store.createReservedRef({ ...input(rootDir), maxBytes: 2000, settings: tight });
    await expect(
      store.createReservedRef({ ...input(rootDir), maxBytes: 2000, settings: tight }),
    ).rejects.toMatchObject({ code: 'quota-exceeded' });
  });

  it('accepts an upload that exactly fills the announced ceiling', async () => {
    const repository = new FakeRepository();
    const store = new DbStagingStateStore(repository, { rootDir, stateDir, disableLock: true });
    await store.init();
    const tight = settings({ perUserQuotaBytes: 3000, maxFileBytes: 4096 });
    const reserved = await store.createReservedRef({
      ...input(rootDir),
      maxBytes: 2000,
      settings: tight,
    });
    const token = await store.createUploadToken(
      reserved.ref,
      input(rootDir).principal.ownerHash,
      900,
    );
    const record = await store.uploadWithToken(token, Buffer.alloc(2000), tight);
    expect(record.state).toBe('ready');
    expect(record.size).toBe(2000);
  });

  it('rejects an upload one byte over the remaining budget', async () => {
    const repository = new FakeRepository();
    const store = new DbStagingStateStore(repository, { rootDir, stateDir, disableLock: true });
    await store.init();
    const tight = settings({ perUserQuotaBytes: 3000, maxFileBytes: 4096 });
    const reserved = await store.createReservedRef({
      ...input(rootDir),
      maxBytes: 2000,
      settings: tight,
    });
    const token = await store.createUploadToken(
      reserved.ref,
      input(rootDir).principal.ownerHash,
      900,
    );
    await expect(
      store.uploadWithToken(token, Buffer.alloc(3001), tight),
    ).rejects.toMatchObject({ code: 'quota-exceeded' });
  });

  it('does not resurrect an expired reserved ref while releasing its reservation', async () => {
    let clock = Date.now();
    const repository = new FakeRepository();
    const store = new DbStagingStateStore(repository, {
      rootDir,
      stateDir,
      disableLock: true,
      now: () => clock,
    });
    await store.init();
    const short = settings({ ttlHours: 0.001, perUserQuotaBytes: 3000, maxFileBytes: 4096 });
    const minted = await store.createReservedRef({ ...input(rootDir), maxBytes: 3000, settings: short });

    clock += 60_000;
    expect(await store.cleanup(short)).toBe(1);
    await expect(store.getOwnedRef(minted.ref, input(rootDir).principal.ownerHash)).rejects.toMatchObject({
      code: 'not-found',
    });
  });

  it('rejects a link that expires while waiting for the quota lock', async () => {
    let clock = Date.now();
    const repository = new FakeRepository();
    const store = new DbStagingStateStore(repository, {
      rootDir,
      stateDir,
      disableLock: true,
      now: () => clock,
    });
    await store.init();
    const reserved = await store.createReservedRef({
      ...input(rootDir),
      maxBytes: 4096,
      settings: settings(),
    });
    const token = await store.createUploadToken(
      reserved.ref,
      'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      60,
    );

    const originalLock = repository.lockQuota.bind(repository);
    repository.lockQuota = async (manager: EntityManager) => {
      clock += 120_000; // the link expires while the upload waits for the quota lock
      await originalLock(manager);
    };

    await expect(store.uploadWithToken(token, Buffer.from('late'), settings())).rejects.toMatchObject({
      code: 'expired',
    });
  });

  it('rolls back the reserved ref when the upload token cannot be written', async () => {
    const repository = new FakeRepository();
    const store = new DbStagingStateStore(repository, {
      rootDir,
      stateDir,
      disableLock: true,
    });
    await store.init();
    const owner = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    repository.saveToken = async () => {
      throw new Error('token write failed');
    };

    await expect(
      store.createUploadLink(
        { ...input(rootDir), maxBytes: 4096, settings: settings() },
        60,
      ),
    ).rejects.toThrow('token write failed');

    expect(await store.usageBytes(owner)).toBe(0);
    const rows = await repository.transaction((manager) => repository.listRefs(manager));
    expect(rows).toHaveLength(0);
  });

  it('rolls back the ref and token when metadata writing fails', async () => {
    const owner = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const originalWriteMeta = (store as any).writeMeta.bind(store);
    (store as any).writeMeta = async () => {
      throw new Error('metadata write failed');
    };

    await expect(
      store.createUploadLink(
        { ...input(rootDir), maxBytes: 4096, settings: settings() },
        60,
      ),
    ).rejects.toThrow('metadata write failed');
    (store as any).writeMeta = originalWriteMeta;

    expect(await store.usageBytes(owner)).toBe(0);
    expect(repository.tokens.size).toBe(0);
    const rows = await repository.transaction((manager) => repository.listRefs(manager));
    expect(rows).toHaveLength(0);
  });

  it('starts the upload link TTL after the quota lock', async () => {
    let clock = Date.now();
    const repository = new FakeRepository();
    const store = new DbStagingStateStore(repository, {
      rootDir,
      stateDir,
      disableLock: true,
      now: () => clock,
    });
    await store.init();
    const originalLock = repository.lockQuota.bind(repository);
    repository.lockQuota = async (manager: EntityManager) => {
      clock += 61_000;
      await originalLock(manager);
    };

    const { token, expiresAt } = await store.createUploadLink(
      { ...input(rootDir), maxBytes: 4096, settings: settings() },
      60,
    );

    expect(new Date(expiresAt).getTime()).toBeGreaterThan(clock);
    await expect(store.getUploadToken(token)).resolves.toMatchObject({ expiresAt });
  });

  it('keeps a freshly created upload link reservation through an immediate cleanup', async () => {
    const owner = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const { record, token, expiresAt } = await store.createUploadLink(
      { ...input(rootDir), maxBytes: 4096, settings: settings() },
      60,
    );
    expect(record.state).toBe('reserved');
    expect(record.reservedBytes).toBe(4096);

    await store.cleanup(settings());

    expect(await store.usageBytes(owner)).toBe(4096);
    await expect(store.getUploadToken(token)).resolves.toMatchObject({
      ref: record.ref,
      expiresAt,
    });
  });

  it('releases the reservation once an unused upload link is gone', async () => {
    let clock = Date.now();
    const repository = new FakeRepository();
    const store = new DbStagingStateStore(repository, {
      rootDir,
      stateDir,
      disableLock: true,
      now: () => clock,
    });
    await store.init();
    const tight = settings({ perUserQuotaBytes: 3000, maxFileBytes: 4096 });
    await store.createReservedRef({ ...input(rootDir), maxBytes: 3000, settings: tight });
    await expect(
      store.createReservedRef({ ...input(rootDir), maxBytes: 3000, settings: tight }),
    ).rejects.toMatchObject({ code: 'quota-exceeded' });

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
