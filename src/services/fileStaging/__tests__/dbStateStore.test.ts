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
  maxFilesPerUser: 100,
  cleanupIntervalMinutes: 15,
  ...overrides,
});

/** In-memory repository with transaction rollback, mirroring the real one. */
class FakeRepository extends FileStagingRepository {
  refs = new Map<string, FileStagingRefEntity>();
  tokens = new Map<string, FileStagingTokenEntity>();
  private view?: { refs: Map<string, FileStagingRefEntity>; tokens: Map<string, FileStagingTokenEntity> };

  override async transaction<T>(run: (manager: EntityManager) => Promise<T>): Promise<T> {
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
});
