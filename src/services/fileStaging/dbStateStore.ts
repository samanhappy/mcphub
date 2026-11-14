import { createHash, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import type { FileStagingSettings } from '../../types/index.js';
import { FileStagingRepository } from '../../db/repositories/FileStagingRepository.js';
import type { FileStagingRefEntity } from '../../db/entities/FileStagingRef.js';
import type { FileStagingTokenEntity } from '../../db/entities/FileStagingToken.js';
import {
  contentPath,
  digestFile,
  ensureDirectory,
  getStagingRoot,
  getStagingStateDir,
  makeRef,
  metaPath,
  parseRef,
  refDir,
  removeIfExists,
  writeFileAtomic,
} from './paths.js';
import { assertLeaseQuota, assertRefsLeasable, decideFinalize } from './policy.js';
import type { StagingStateStore } from './stateStore.js';
import {
  type CreateRefInput,
  type LeaseGrant,
  type LeaseRequestItem,
  type StagingRefRecord,
  type StagingRefState,
  type StagingTokenRecord,
  StagingError,
} from './types.js';

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

const toRecord = (row: FileStagingRefEntity): StagingRefRecord => ({
  ref: row.ref,
  id: row.id,
  ownerHash: row.ownerHash,
  serverId: row.serverId,
  serverName: row.serverName,
  toolName: row.toolName ?? undefined,
  filename: row.filename ?? undefined,
  state: row.state as StagingRefState,
  size: row.size,
  sha256: row.sha256 ?? undefined,
  version: row.version,
  allowZeroByte: row.allowZeroByte,
  reservedBytes: row.reservedBytes ?? undefined,
  createdAt: new Date(row.createdAt).toISOString(),
  expiresAt: new Date(row.expiresAt).toISOString(),
  leaseId: row.leaseId ?? undefined,
  leaseUntil: row.leaseUntil ? new Date(row.leaseUntil).toISOString() : undefined,
  pinCount: row.pinCount,
  pinUntil: row.pinUntil ? new Date(row.pinUntil).toISOString() : undefined,
});

const toRow = (record: StagingRefRecord): FileStagingRefEntity => ({
  ref: record.ref,
  id: record.id,
  ownerHash: record.ownerHash,
  serverId: record.serverId,
  serverName: record.serverName,
  toolName: record.toolName ?? null,
  filename: record.filename ?? null,
  state: record.state,
  size: record.size,
  sha256: record.sha256 ?? null,
  version: record.version,
  allowZeroByte: record.allowZeroByte,
  reservedBytes: record.reservedBytes ?? null,
  createdAt: new Date(record.createdAt),
  expiresAt: new Date(record.expiresAt),
  leaseId: record.leaseId ?? null,
  leaseUntil: record.leaseUntil ? new Date(record.leaseUntil) : null,
  pinCount: record.pinCount,
  pinUntil: record.pinUntil ? new Date(record.pinUntil) : null,
});

const toToken = (row: FileStagingTokenEntity): StagingTokenRecord => ({
  tokenHash: row.tokenHash,
  kind: 'download',
  ref: row.ref,
  ownerHash: row.ownerHash,
  version: row.version,
  contentHash: row.contentHash,
  expiresAt: new Date(row.expiresAt).toISOString(),
  usedAt: row.usedAt ? new Date(row.usedAt).toISOString() : undefined,
});

const isSweepable = (record: StagingRefRecord, nowIso: string): boolean => {
  const pinned = record.pinCount > 0 && (!record.pinUntil || record.pinUntil > nowIso);
  if (pinned || record.leaseId) return false;
  if (record.state === 'failed' || record.state === 'expired') return true;
  return record.expiresAt <= nowIso;
};

/**
 * Database-backed staging ledger. Used in DB mode so the authoritative state
 * survives container restarts and is not tied to a single data directory;
 * staging still refuses to run alongside a second hub process.
 */
export class DbStagingStateStore implements StagingStateStore {
  private readonly rootDir: string;
  private readonly stateDir: string;
  private readonly now: () => number;

  constructor(
    private readonly repository: FileStagingRepository = new FileStagingRepository(),
    options: { rootDir?: string; stateDir?: string; now?: () => number } = {},
  ) {
    this.rootDir = options.rootDir ?? getStagingRoot();
    this.stateDir = options.stateDir ?? getStagingStateDir();
    this.now = options.now ?? (() => Date.now());
  }

  async init(): Promise<void> {
    await ensureDirectory(this.rootDir);
    await ensureDirectory(this.stateDir);
    // A child process can outlive the hub. Never re-lease a destination whose
    // lease was still held at restart; the UUID is never reused.
    await this.repository.transaction(async (manager) => {
      const rows = await this.repository.listRefs(manager);
      for (const row of rows) {
        if (!row.leaseId && row.pinCount === 0) continue;
        const record = toRecord(row);
        if (row.leaseId) {
          record.state = 'failed';
          record.leaseId = undefined;
          record.leaseUntil = undefined;
          record.reservedBytes = undefined;
        }
        // No reader survives a restart; a stale pin must not exempt the ref
        // from cleanup forever.
        record.pinCount = 0;
        record.pinUntil = undefined;
        await this.repository.saveRef(manager, toRow(record));
      }
    });
  }

  private nowIso(): string {
    return new Date(this.now()).toISOString();
  }

  private async usage(
    manager: Parameters<FileStagingRepository['listRefs']>[0],
    ownerHash?: string,
  ): Promise<number> {
    const rows = await this.repository.listRefs(manager);
    let total = 0;
    for (const row of rows) {
      if (row.state === 'failed' || row.state === 'expired') continue;
      if (ownerHash && row.ownerHash !== ownerHash) continue;
      total += row.state === 'ready' ? row.size : (row.reservedBytes ?? 0);
    }
    return total;
  }

  private async writeMeta(record: StagingRefRecord): Promise<void> {
    await writeFileAtomic(
      metaPath(this.rootDir, record.ownerHash, record.id),
      JSON.stringify({
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
      }),
    );
  }

  private async createRecord(
    input: CreateRefInput,
    state: 'ready' | 'reserved',
  ): Promise<StagingRefRecord> {
    const id = randomUUID();
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
      createdAt: this.nowIso(),
      expiresAt: new Date(this.now() + input.settings.ttlHours * 3600_000).toISOString(),
      pinCount: 0,
    };
  }

  private async assertFileCount(
    manager: Parameters<FileStagingRepository['listRefs']>[0],
    ownerHash: string,
    additional: number,
    settings: FileStagingSettings,
  ): Promise<void> {
    let count = 0;
    for (const row of await this.repository.listRefs(manager)) {
      if (row.ownerHash !== ownerHash) continue;
      if (row.state === 'failed' || row.state === 'expired') continue;
      count += 1;
    }
    if (count + additional > settings.maxFilesPerUser) {
      throw new StagingError('quota-exceeded', 'Per-user staged file limit exceeded');
    }
  }

  async createReadyRef(input: CreateRefInput, data: Buffer): Promise<StagingRefRecord> {
    if (data.length > input.settings.inlineMaxBytes) {
      throw new StagingError('quota-exceeded', 'Inline upload exceeds the configured limit');
    }
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
    try {
      await this.repository.transaction(async (manager) => {
        if (
          (await this.usage(manager, record.ownerHash)) + digest.size >
          input.settings.perUserQuotaBytes
        ) {
          throw new StagingError('quota-exceeded', 'Per-user staging quota exceeded');
        }
        if ((await this.usage(manager)) + digest.size > input.settings.globalQuotaBytes) {
          throw new StagingError('quota-exceeded', 'Global staging quota exceeded');
        }
        await this.assertFileCount(manager, record.ownerHash, 1, input.settings);
        await this.repository.saveRef(manager, toRow(record));
      });
    } catch (error) {
      await removeIfExists(dir);
      throw error;
    }
    await this.writeMeta(record);
    return record;
  }

  async createReservedRef(input: CreateRefInput): Promise<StagingRefRecord> {
    const record = await this.createRecord(input, 'reserved');
    const dir = refDir(this.rootDir, record.ownerHash, record.id);
    await ensureDirectory(dir);
    const handle = await fs.open(path.join(dir, 'content'), 'wx', 0o600);
    await handle.close();
    try {
      await this.repository.transaction(async (manager) => {
        await this.assertFileCount(manager, record.ownerHash, 1, input.settings);
        await this.repository.saveRef(manager, toRow(record));
      });
    } catch (error) {
      await removeIfExists(dir);
      throw error;
    }
    await this.writeMeta(record);
    return record;
  }

  async getOwnedRef(ref: string, ownerHash: string): Promise<StagingRefRecord> {
    if (!parseRef(ref)) throw new StagingError('invalid-ref', 'Invalid staging reference');
    return this.repository.transaction(async (manager) => {
      const row = await this.repository.findRef(manager, ref);
      if (!row || row.ownerHash !== ownerHash) {
        throw new StagingError('not-found', 'Staging reference not found');
      }
      return toRecord(row);
    });
  }

  async contentPathFor(ref: string, ownerHash: string): Promise<string> {
    const record = await this.getOwnedRef(ref, ownerHash);
    return contentPath(this.rootDir, record.ownerHash, record.id);
  }

  async acquireOutputLeases(
    ownerHash: string,
    items: readonly LeaseRequestItem[],
    settings: FileStagingSettings,
  ): Promise<LeaseGrant[]> {
    if (items.length === 0) return [];
    if (items.some((item) => !parseRef(item.ref))) {
      throw new StagingError('invalid-ref', 'Invalid staging reference');
    }
    return this.repository.transaction(async (manager) => {
      const rows = await this.repository.findRefs(
        manager,
        items.map((item) => item.ref),
        true,
      );
      const records = rows.map(toRecord);
      assertRefsLeasable(records, items, ownerHash, this.nowIso());
      assertLeaseQuota(
        await this.usage(manager, ownerHash),
        await this.usage(manager),
        records.length,
        settings,
      );
      const reserve = settings.maxFileBytes;
      const leaseUntil = new Date(this.now() + settings.ttlHours * 3600_000);
      const leaseByRef = new Map(items.map((item) => [item.ref, item.leaseId] as const));
      for (const row of rows) {
        row.leaseId = leaseByRef.get(row.ref) ?? null;
        row.leaseUntil = leaseUntil;
        row.reservedBytes = reserve;
        await this.repository.saveRef(manager, row);
      }
      return records.map((record) => ({
        ref: record.ref,
        id: record.id,
        ownerHash: record.ownerHash,
        contentPath: contentPath(this.rootDir, record.ownerHash, record.id),
      }));
    });
  }

  async releaseLeases(leaseId: string, refs?: readonly string[]): Promise<void> {
    await this.repository.transaction(async (manager) => {
      const rows = await this.repository.listRefs(manager);
      for (const row of rows) {
        if (row.leaseId !== leaseId) continue;
        if (refs && !refs.includes(row.ref)) continue;
        row.leaseId = null;
        row.leaseUntil = null;
        row.reservedBytes = null;
        await this.repository.saveRef(manager, row);
      }
    });
  }

  async finalizeOutputs(
    leaseId: string,
    refs: readonly string[],
    settings: FileStagingSettings,
  ): Promise<StagingRefRecord[]> {
    return this.repository.transaction(async (manager) => {
      const rows = await this.repository.findRefs(manager, refs, true);
      const byRef = new Map(rows.map((row) => [row.ref, row] as const));
      // Validate the whole set before touching any row: a bad second output
      // must not leave the first one ready in a committed transaction.
      const decisions: Array<{ row: FileStagingRefEntity; record: StagingRefRecord; size: number; sha256: string }> = [];
      for (const ref of refs) {
        const row = byRef.get(ref);
        if (!row) throw new StagingError('not-found', 'Staging reference not found');
        const record = toRecord(row);
        const digest = await digestFile(contentPath(this.rootDir, record.ownerHash, record.id));
        const decision = decideFinalize(record, leaseId, digest, settings);
        decisions.push({ row, record, size: decision.size, sha256: decision.sha256 });
      }
      const finalized: StagingRefRecord[] = [];
      for (const { row, record, size, sha256 } of decisions) {
        row.size = size;
        row.sha256 = sha256;
        row.version += 1;
        row.state = 'ready';
        row.leaseId = null;
        row.leaseUntil = null;
        row.reservedBytes = null;
        row.expiresAt = new Date(this.now() + settings.ttlHours * 3600_000);
        await this.repository.saveRef(manager, row);
        finalized.push(toRecord(row));
      }
      return finalized;
    });
  }

  async failOutputs(leaseId: string, refs: readonly string[]): Promise<void> {
    const failed: StagingRefRecord[] = [];
    await this.repository.transaction(async (manager) => {
      const rows = await this.repository.findRefs(manager, refs, true);
      for (const row of rows) {
        if (row.leaseId !== leaseId) continue;
        row.state = 'failed';
        row.leaseId = null;
        row.leaseUntil = null;
        row.reservedBytes = null;
        await this.repository.saveRef(manager, row);
        failed.push(toRecord(row));
      }
    });
    await Promise.all(
      failed.map((record) => removeIfExists(refDir(this.rootDir, record.ownerHash, record.id))),
    );
  }

  async pinReadyRef(ref: string, ownerHash: string): Promise<StagingRefRecord> {
    return this.repository.transaction(async (manager) => {
      const row = await this.repository.findRef(manager, ref, true);
      if (!row || row.ownerHash !== ownerHash) {
        throw new StagingError('not-found', 'Staging reference not found');
      }
      if (row.state !== 'ready') {
        throw new StagingError('not-ready', 'Staging reference is not ready');
      }
      if (new Date(row.expiresAt).toISOString() <= this.nowIso()) {
        throw new StagingError('expired', 'Staging reference has expired');
      }
      row.pinCount += 1;
      row.pinUntil = new Date(this.now() + 3600_000);
      await this.repository.saveRef(manager, row);
      return toRecord(row);
    });
  }

  async unpinRef(ref: string): Promise<void> {
    await this.repository.transaction(async (manager) => {
      const row = await this.repository.findRef(manager, ref, true);
      if (!row) return;
      row.pinCount = Math.max(0, row.pinCount - 1);
      row.pinUntil = row.pinCount === 0 ? null : row.pinUntil;
      await this.repository.saveRef(manager, row);
    });
  }

  async createDownloadToken(ref: string, ownerHash: string, ttlSeconds: number): Promise<string> {
    const token = randomBytes(32).toString('base64url');
    const tokenHash = sha256(token);
    await this.repository.transaction(async (manager) => {
      const row = await this.repository.findRef(manager, ref);
      if (!row || row.ownerHash !== ownerHash) {
        throw new StagingError('not-found', 'Staging reference not found');
      }
      if (row.state !== 'ready' || !row.sha256) {
        throw new StagingError('not-ready', 'Staging reference is not ready');
      }
      if (new Date(row.expiresAt).toISOString() <= this.nowIso()) {
        throw new StagingError('expired', 'Staging reference has expired');
      }
      await this.repository.saveToken(manager, {
        tokenHash,
        kind: 'download',
        ref: row.ref,
        ownerHash,
        version: row.version,
        contentHash: row.sha256,
        expiresAt: new Date(this.now() + ttlSeconds * 1000),
        usedAt: null,
      });
    });
    return token;
  }

  async consumeDownloadToken(token: string): Promise<StagingTokenRecord> {
    const tokenHash = sha256(token);
    return this.repository.transaction(async (manager) => {
      const row = await this.repository.findToken(manager, tokenHash, true);
      if (!row || row.usedAt) throw new StagingError('not-found', 'Download link is not valid');
      if (new Date(row.expiresAt).toISOString() <= this.nowIso()) {
        throw new StagingError('expired', 'Download link has expired');
      }
      const refRow = await this.repository.findRef(manager, row.ref);
      if (
        !refRow ||
        refRow.state !== 'ready' ||
        refRow.version !== row.version ||
        refRow.sha256 !== row.contentHash
      ) {
        throw new StagingError('not-found', 'Download link is not valid');
      }
      row.usedAt = new Date(this.now());
      await this.repository.saveToken(manager, row);
      return toToken(row);
    });
  }

  async cleanup(settings: FileStagingSettings): Promise<number> {
    void settings;
    const nowIso = this.nowIso();
    const sweep: StagingRefRecord[] = [];
    await this.repository.transaction(async (manager) => {
      const rows = await this.repository.listRefs(manager);
      for (const row of rows) {
        const record = toRecord(row);
        if (!isSweepable(record, nowIso)) continue;
        await this.repository.deleteRef(manager, row.ref);
        sweep.push(record);
      }
      for (const token of await this.repository.listTokens(manager)) {
        const expired = new Date(token.expiresAt).toISOString() <= nowIso;
        if (token.usedAt || expired) await this.repository.deleteToken(manager, token.tokenHash);
      }
    });
    await Promise.all(
      sweep.map((record) => removeIfExists(refDir(this.rootDir, record.ownerHash, record.id))),
    );
    return sweep.length;
  }

  async usageBytes(ownerHash?: string): Promise<number> {
    return this.repository.transaction((manager) => this.usage(manager, ownerHash));
  }
}
