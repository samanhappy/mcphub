import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { FileStagingSettings } from '../../types/index.js';
import {
  isValidOwnerHash,
  contentPath,
  digestFile,
  ensureDirectory,
  getStagingRoot,
  getStagingStateDir,
  makeRef,
  metaPath,
  openNoFollow,
  parseRef,
  principalDir,
  refDir,
  removeIfExists,
  writeFileAtomic,
} from './paths.js';
import { assertLeaseQuota, assertRefsLeasable, decideFinalize } from './policy.js';
import {
  type CreateRefInput,
  type LeaseGrant,
  type LeaseRequestItem,
  type StagingRefRecord,
  type StagingStateDocument,
  type StagingTokenRecord,
  StagingError,
} from './types.js';

/**
 * Authoritative file staging state (#1056).
 *
 * The ledger is hub-side, never inferred from the tool-writable staging tree.
 * Output refs take an exclusive lease *before* the upstream call; the lease has
 * no runtime TTL (a crash marks the ref failed at startup instead of letting a
 * second writer steal it). Ready refs are read-only and use read pins.
 */
export interface StagingStateStore {
  init(): Promise<void>;
  createReadyRef(input: CreateRefInput, data: Buffer): Promise<StagingRefRecord>;
  createReservedRef(input: CreateRefInput): Promise<StagingRefRecord>;
  getOwnedRef(ref: string, ownerHash: string): Promise<StagingRefRecord>;
  /** Absolute content path for an owned ref; the caller has already checked it. */
  contentPathFor(ref: string, ownerHash: string): Promise<string>;

  acquireOutputLeases(
    ownerHash: string,
    items: readonly LeaseRequestItem[],
    settings: FileStagingSettings,
  ): Promise<LeaseGrant[]>;
  releaseLeases(leaseId: string, refs?: readonly string[]): Promise<void>;
  finalizeOutputs(
    leaseId: string,
    refs: readonly string[],
    settings: FileStagingSettings,
  ): Promise<StagingRefRecord[]>;
  failOutputs(leaseId: string, refs: readonly string[], reason?: string): Promise<void>;
  pinReadyRef(ref: string, ownerHash: string): Promise<StagingRefRecord>;
  unpinRef(ref: string): Promise<void>;
  createDownloadToken(ref: string, ownerHash: string, ttlSeconds: number): Promise<string>;
  consumeDownloadToken(token: string): Promise<StagingTokenRecord>;
  cleanup(settings: FileStagingSettings): Promise<number>;
  usageBytes(ownerHash?: string): Promise<number>;
}

const emptyDocument = (): StagingStateDocument => ({ version: 1, refs: {}, tokens: {} });

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

const isLivePid = (pid: number): boolean => {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

export interface FileStagingStateStoreOptions {
  rootDir?: string;
  stateDir?: string;
  now?: () => number;
  disableLock?: boolean;
}

const REF_STATES = new Set(['reserved', 'ready', 'failed', 'expired']);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Reject a tampered/corrupt ledger record before it can drive a file path. */
const isValidRefRecord = (key: string, value: unknown): value is StagingRefRecord => {
  if (!value || typeof value !== 'object') return false;
  const record = value as StagingRefRecord;
  const id = parseRef(key);
  return (
    id !== undefined &&
    record.ref === key &&
    record.id === id &&
    isValidOwnerHash(record.ownerHash) &&
    typeof record.serverName === 'string' &&
    typeof record.serverId === 'string' &&
    REF_STATES.has(record.state) &&
    isFiniteNumber(record.size) &&
    isFiniteNumber(record.version) &&
    isFiniteNumber(record.pinCount) &&
    typeof record.createdAt === 'string' &&
    typeof record.expiresAt === 'string'
  );
};

const isValidTokenRecord = (key: string, value: unknown): value is StagingTokenRecord => {
  if (!value || typeof value !== 'object') return false;
  const token = value as StagingTokenRecord;
  return (
    token.tokenHash === key &&
    /^[a-f0-9]{64}$/.test(key) &&
    parseRef(token.ref) !== undefined &&
    isValidOwnerHash(token.ownerHash) &&
    typeof token.contentHash === 'string' &&
    typeof token.expiresAt === 'string'
  );
};

/** State dirs locked by this process (see acquireProcessLock). */
const acquiredStateDirs = new Set<string>();

/**
 * Single-process JSON backend. A lockfile refuses to start when another hub
 * process owns staging: the lease model has no cross-process heartbeat, so
 * running two writers would allow double writes to one reserved ref.
 */
export class FileStagingStateStore implements StagingStateStore {
  private readonly rootDir: string;
  private readonly stateDir: string;
  private readonly now: () => number;
  private readonly disableLock: boolean;
  private readonly refsPath: string;
  private readonly lockPath: string;
  private state: StagingStateDocument = emptyDocument();
  private queue: Promise<unknown> = Promise.resolve();
  private loaded = false;
  private lockHandle?: fs.FileHandle;

  constructor(options: FileStagingStateStoreOptions = {}) {
    this.rootDir = options.rootDir ?? getStagingRoot();
    this.stateDir = options.stateDir ?? getStagingStateDir();
    this.now = options.now ?? (() => Date.now());
    this.disableLock = options.disableLock ?? process.env.NODE_ENV === 'test';
    this.refsPath = path.join(this.stateDir, 'refs.json');
    this.lockPath = path.join(this.stateDir, 'staging.lock');
  }

  async init(): Promise<void> {
    await this.exclusive(async () => {
      if (this.loaded) return;
      await ensureDirectory(this.rootDir);
      await ensureDirectory(this.stateDir);
      await this.acquireProcessLock();
      await this.load();
      this.reconcileStartup();
      await this.persist();
      this.loaded = true;
    });
  }

  private async acquireProcessLock(): Promise<void> {
    if (this.disableLock) return;
    // One writer per process even when two stores are constructed: a second
    // store would otherwise share the pid and silently take the lock over.
    if (acquiredStateDirs.has(this.stateDir)) {
      throw new StagingError(
        'locked',
        'File staging is already initialized in this process for the same state directory',
      );
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        // One syscall creates and writes the pid; a concurrent reader never
        // sees an empty lockfile.
        await fs.writeFile(this.lockPath, String(process.pid), {
          flag: 'wx',
          mode: 0o600,
        });
        acquiredStateDirs.add(this.stateDir);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        const raw = await fs.readFile(this.lockPath, 'utf8').catch(() => '');
        const owner = Number.parseInt(raw.trim(), 10);
        if (Number.isFinite(owner) && isLivePid(owner)) {
          throw new StagingError(
            'locked',
            `File staging is already owned by hub process ${owner}; only one process may run staging`,
          );
        }
        if (!Number.isFinite(owner)) {
          // A truncated/empty lockfile is treated as held: deleting it could
          // hand the ledger to a second live writer.
          throw new StagingError(
            'locked',
            'The file staging lockfile is unreadable; remove it only after confirming no hub process is running',
          );
        }
        await fs.rm(this.lockPath, { force: true });
      }
    }
    throw new StagingError('locked', 'Unable to acquire the file staging process lock');
  }

  private async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.refsPath, 'utf8');
      const parsed = JSON.parse(raw) as Partial<StagingStateDocument>;
      const refs: Record<string, StagingRefRecord> = {};
      for (const [key, value] of Object.entries(parsed.refs ?? {})) {
        if (isValidRefRecord(key, value)) refs[key] = value;
      }
      const tokens: Record<string, StagingTokenRecord> = {};
      for (const [key, value] of Object.entries(parsed.tokens ?? {})) {
        if (isValidTokenRecord(key, value)) tokens[key] = value;
      }
      this.state = { version: 1, refs, tokens };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      this.state = emptyDocument();
    }
  }

  private reconcileStartup(): void {
    const now = new Date(this.now()).toISOString();
    for (const record of Object.values(this.state.refs)) {
      if (record.leaseId) {
        // A child can outlive the hub; never re-lease or overwrite the same
        // destination after a restart. The UUID is never reused.
        record.state = 'failed';
        record.leaseId = undefined;
        record.leaseUntil = undefined;
        record.reservedBytes = undefined;
      }
      if (record.state === 'expired' || (record.state !== 'ready' && record.expiresAt <= now)) {
        record.state = 'expired';
      }
      // No reader survives a restart; a stale pin would otherwise exempt the
      // ref from cleanup forever.
      record.pinCount = 0;
      record.pinUntil = undefined;
    }
    for (const [hash, token] of Object.entries(this.state.tokens)) {
      if (token.usedAt || token.expiresAt <= now) delete this.state.tokens[hash];
    }
  }

  private async persist(): Promise<void> {
    await writeFileAtomic(this.refsPath, JSON.stringify(this.state));
  }

  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    const run = this.queue.then(action, action);
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  private assertInit(): void {
    if (!this.loaded) throw new StagingError('invalid-ref', 'File staging state is not initialized');
  }

  private requireRef(ref: string): StagingRefRecord {
    const id = parseRef(ref);
    if (!id) throw new StagingError('invalid-ref', 'Invalid staging reference');
    const record = this.state.refs[makeRef(id)];
    if (!record) throw new StagingError('not-found', 'Staging reference not found');
    return record;
  }

  private writeMeta(record: StagingRefRecord): Promise<void> {
    const meta = {
      ref: record.ref,
      owner: { kind: 'user', id: record.ownerHash },
      serverId: record.serverId,
      serverName: record.serverName,
      toolName: record.toolName,
      filename: record.filename,
      size: record.size,
      sha256: record.sha256,
      state: record.state,
      version: record.version,
      createdAt: record.createdAt,
      expiresAt: record.expiresAt,
    };
    return writeFileAtomic(metaPath(this.rootDir, record.ownerHash, record.id), JSON.stringify(meta));
  }

  private async createRecord(input: CreateRefInput, state: 'ready' | 'reserved'): Promise<StagingRefRecord> {
    const id = randomUUID();
    const createdAt = new Date(this.now()).toISOString();
    const expiresAt = new Date(this.now() + input.settings.ttlHours * 3600_000).toISOString();
    return {
      ref: makeRef(id),
      id,
      ownerHash: input.principal.ownerHash,
      serverId: input.serverId,
      serverName: input.serverName,
      filename: input.filename,
      state,
      size: 0,
      version: 0,
      allowZeroByte: input.allowZeroByte === true,
      createdAt,
      expiresAt,
      pinCount: 0,
    };
  }

  private quotaUsage(ownerHash?: string): number {
    let total = 0;
    for (const record of Object.values(this.state.refs)) {
      if (record.state === 'expired' || record.state === 'failed') continue;
      if (ownerHash && record.ownerHash !== ownerHash) continue;
      total += record.state === 'ready' ? record.size : (record.reservedBytes ?? 0);
    }
    return total;
  }

  private assertFileCount(
    ownerHash: string,
    additional: number,
    settings: FileStagingSettings,
  ): void {
    let count = 0;
    for (const record of Object.values(this.state.refs)) {
      if (record.ownerHash !== ownerHash) continue;
      if (record.state === 'failed' || record.state === 'expired') continue;
      count += 1;
    }
    if (count + additional > settings.maxFilesPerUser) {
      throw new StagingError('quota-exceeded', 'Per-user staged file limit exceeded');
    }
  }

  async createReadyRef(input: CreateRefInput, data: Buffer): Promise<StagingRefRecord> {
    this.assertInit();
    return this.exclusive(async () => {
      if (data.length > input.settings.inlineMaxBytes) {
        throw new StagingError('quota-exceeded', 'Inline upload exceeds the configured limit');
      }
      if (this.quotaUsage(input.principal.ownerHash) + data.length > input.settings.perUserQuotaBytes) {
        throw new StagingError('quota-exceeded', 'Per-user staging quota exceeded');
      }
      if (this.quotaUsage() + data.length > input.settings.globalQuotaBytes) {
        throw new StagingError('quota-exceeded', 'Global staging quota exceeded');
      }
      this.assertFileCount(input.principal.ownerHash, 1, input.settings);
      const record = await this.createRecord(input, 'ready');
      const dir = refDir(this.rootDir, record.ownerHash, record.id);
      await ensureDirectory(dir);
      const file = path.join(dir, 'content');
      const handle = await fs.open(file, 'wx', 0o600);
      try {
        await handle.writeFile(data);
        await handle.sync();
      } finally {
        await handle.close();
      }
      const digest = await digestFile(file);
      record.size = digest.size;
      record.sha256 = digest.sha256;
      record.version = 1;
      this.state.refs[record.ref] = record;
      await this.writeMeta(record);
      await this.persist();
      return record;
    });
  }

  async createReservedRef(input: CreateRefInput): Promise<StagingRefRecord> {
    this.assertInit();
    return this.exclusive(async () => {
      this.assertFileCount(input.principal.ownerHash, 1, input.settings);
      const record = await this.createRecord(input, 'reserved');
      const dir = refDir(this.rootDir, record.ownerHash, record.id);
      await ensureDirectory(dir);
      const handle = await fs.open(path.join(dir, 'content'), 'wx', 0o600);
      await handle.close();
      this.state.refs[record.ref] = record;
      await this.writeMeta(record);
      await this.persist();
      return record;
    });
  }

  async getOwnedRef(ref: string, ownerHash: string): Promise<StagingRefRecord> {
    this.assertInit();
    const record = this.requireRef(ref);
    if (record.ownerHash !== ownerHash) {
      // Same error as a missing ref: never reveal another principal's refs.
      throw new StagingError('not-found', 'Staging reference not found');
    }
    return record;
  }

  async contentPathFor(ref: string, ownerHash: string): Promise<string> {
    return this.exclusive(async () => {
      const record = this.requireRef(ref);
      if (record.ownerHash !== ownerHash) {
        throw new StagingError('not-found', 'Staging reference not found');
      }
      return contentPath(this.rootDir, record.ownerHash, record.id);
    });
  }

  async acquireOutputLeases(
    ownerHash: string,
    items: readonly LeaseRequestItem[],
    settings: FileStagingSettings,
  ): Promise<LeaseGrant[]> {
    this.assertInit();
    if (items.length === 0) return [];
    return this.exclusive(async () => {
      const nowIso = new Date(this.now()).toISOString();
      const records = items.map((item) => this.requireRef(item.ref));
      assertRefsLeasable(records, items, ownerHash, nowIso);
      assertLeaseQuota(this.quotaUsage(ownerHash), this.quotaUsage(), records.length, settings);
      const reserve = settings.maxFileBytes;

      const leaseUntil = new Date(this.now() + settings.ttlHours * 3600_000).toISOString();
      const leaseByRef = new Map(items.map((item) => [item.ref, item.leaseId] as const));
      for (const record of records) {
        record.leaseId = leaseByRef.get(record.ref);
        record.leaseUntil = leaseUntil;
        record.reservedBytes = reserve;
      }
      await this.persist();
      return records.map((record) => ({
        ref: record.ref,
        id: record.id,
        ownerHash: record.ownerHash,
        contentPath: contentPath(this.rootDir, record.ownerHash, record.id),
      }));
    });
  }

  async releaseLeases(leaseId: string, refs?: readonly string[]): Promise<void> {
    this.assertInit();
    await this.exclusive(async () => {
      for (const record of Object.values(this.state.refs)) {
        if (record.leaseId !== leaseId) continue;
        if (refs && !refs.includes(record.ref)) continue;
        record.leaseId = undefined;
        record.leaseUntil = undefined;
        record.reservedBytes = undefined;
      }
      await this.persist();
    });
  }

  async finalizeOutputs(
    leaseId: string,
    refs: readonly string[],
    settings: FileStagingSettings,
  ): Promise<StagingRefRecord[]> {
    this.assertInit();
    return this.exclusive(async () => {
      // Validate every output before mutating any of them: a failure on the
      // second ref must not leave the first one ready with its lease cleared.
      const decisions: Array<{ record: StagingRefRecord; size: number; sha256: string }> = [];
      for (const ref of refs) {
        const record = this.requireRef(ref);
        const file = contentPath(this.rootDir, record.ownerHash, record.id);
        const digest = await digestFile(file);
        const decision = decideFinalize(record, leaseId, digest, settings);
        decisions.push({ record, size: decision.size, sha256: decision.sha256 });
      }
      const snapshot = decisions.map(({ record }) => structuredClone(record));
      const finalized: StagingRefRecord[] = [];
      try {
        for (const { record, size, sha256 } of decisions) {
          record.size = size;
          record.sha256 = sha256;
          record.version += 1;
          record.state = 'ready';
          record.leaseId = undefined;
          record.leaseUntil = undefined;
          record.reservedBytes = undefined;
          record.expiresAt = new Date(this.now() + settings.ttlHours * 3600_000).toISOString();
          finalized.push(record);
        }
        await Promise.all(finalized.map((record) => this.writeMeta(record)));
        await this.persist();
      } catch (error) {
        decisions.forEach(({ record }, index) => {
          Object.assign(record, snapshot[index]);
        });
        throw error;
      }
      return finalized;
    });
  }

  private async markOutputsFailed(leaseId: string, refs: readonly string[]): Promise<void> {
    for (const ref of refs) {
      const id = parseRef(ref);
      const record = id ? this.state.refs[makeRef(id)] : undefined;
      if (!record || record.leaseId !== leaseId) continue;
      record.state = 'failed';
      record.leaseId = undefined;
      record.leaseUntil = undefined;
      record.reservedBytes = undefined;
      await this.writeMeta(record).catch(() => undefined);
      await removeIfExists(refDir(this.rootDir, record.ownerHash, record.id));
    }
    await this.persist();
  }

  async failOutputs(leaseId: string, refs: readonly string[]): Promise<void> {
    this.assertInit();
    await this.exclusive(() => this.markOutputsFailed(leaseId, refs));
  }

  async pinReadyRef(ref: string, ownerHash: string): Promise<StagingRefRecord> {
    this.assertInit();
    return this.exclusive(async () => {
      const record = this.requireRef(ref);
      if (record.ownerHash !== ownerHash) {
        throw new StagingError('not-found', 'Staging reference not found');
      }
      if (record.state !== 'ready') throw new StagingError('not-ready', 'Staging reference is not ready');
      if (record.expiresAt <= new Date(this.now()).toISOString()) {
        throw new StagingError('expired', 'Staging reference has expired');
      }
      record.pinCount += 1;
      record.pinUntil = new Date(this.now() + 3600_000).toISOString();
      await this.persist();
      return record;
    });
  }

  async unpinRef(ref: string): Promise<void> {
    this.assertInit();
    await this.exclusive(async () => {
      const id = parseRef(ref);
      const record = id ? this.state.refs[makeRef(id)] : undefined;
      if (!record) return;
      record.pinCount = Math.max(0, record.pinCount - 1);
      if (record.pinCount === 0) record.pinUntil = undefined;
      await this.persist();
    });
  }

  async createDownloadToken(ref: string, ownerHash: string, ttlSeconds: number): Promise<string> {
    this.assertInit();
    return this.exclusive(async () => {
      const record = this.requireRef(ref);
      if (record.ownerHash !== ownerHash) {
        throw new StagingError('not-found', 'Staging reference not found');
      }
      if (record.state !== 'ready' || !record.sha256) {
        throw new StagingError('not-ready', 'Staging reference is not ready');
      }
      if (record.expiresAt <= new Date(this.now()).toISOString()) {
        throw new StagingError('expired', 'Staging reference has expired');
      }
      const token = randomBytes(32).toString('base64url');
      const tokenHash = sha256(token);
      this.state.tokens[tokenHash] = {
        tokenHash,
        kind: 'download',
        ref: record.ref,
        ownerHash,
        version: record.version,
        contentHash: record.sha256,
        expiresAt: new Date(this.now() + ttlSeconds * 1000).toISOString(),
      };
      await this.persist();
      return token;
    });
  }

  async consumeDownloadToken(token: string): Promise<StagingTokenRecord> {
    this.assertInit();
    return this.exclusive(async () => {
      const tokenHash = sha256(token);
      const record = this.state.tokens[tokenHash];
      if (!record || record.usedAt) throw new StagingError('not-found', 'Download link is not valid');
      if (record.expiresAt <= new Date(this.now()).toISOString()) {
        throw new StagingError('expired', 'Download link has expired');
      }
      const ref = this.state.refs[record.ref];
      if (!ref || ref.state !== 'ready' || ref.version !== record.version || ref.sha256 !== record.contentHash) {
        throw new StagingError('not-found', 'Download link is not valid');
      }
      record.usedAt = new Date(this.now()).toISOString();
      await this.persist();
      return record;
    });
  }

  async cleanup(settings: FileStagingSettings): Promise<number> {
    this.assertInit();
    return this.exclusive(async () => {
      const nowIso = new Date(this.now()).toISOString();
      let removed = 0;
      for (const [key, record] of Object.entries(this.state.refs)) {
        // A stale pin (past pinUntil) is treated as released: a crashed
        // download must not protect content forever.
        const pinned = record.pinCount > 0 && (!record.pinUntil || record.pinUntil > nowIso);
        if (pinned || record.leaseId) continue;
        const expired = record.expiresAt <= nowIso;
        // Ready content survives until TTL; failed/expired records are swept
        // immediately once nothing pins or leases them.
        if (!expired && record.state !== 'failed' && record.state !== 'expired') continue;
        if (expired) record.state = 'expired';
        await removeIfExists(refDir(this.rootDir, record.ownerHash, record.id));
        delete this.state.refs[key];
        removed += 1;
      }
      for (const [hash, token] of Object.entries(this.state.tokens)) {
        if (token.usedAt || token.expiresAt <= nowIso) delete this.state.tokens[hash];
      }
      await this.persist();
      void settings;
      return removed;
    });
  }

  async usageBytes(ownerHash?: string): Promise<number> {
    this.assertInit();
    return this.quotaUsage(ownerHash);
  }
}

/** Read a staged file without following a symlink at the leaf. */
export const openStagedFile = async (file: string): Promise<fs.FileHandle> =>
  openNoFollow(file, fsConstants.O_RDONLY);

export const stagingPrincipalDir = (ownerHash: string): string =>
  principalDir(getStagingRoot(), ownerHash);
