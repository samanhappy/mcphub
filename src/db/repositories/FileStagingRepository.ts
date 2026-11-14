import type { EntityManager } from 'typeorm';

import { getAppDataSource } from '../connection.js';
import { FileStagingRefEntity } from '../entities/FileStagingRef.js';
import { FileStagingTokenEntity } from '../entities/FileStagingToken.js';

/**
 * Thin persistence layer for the file staging ledger (#1056). All
 * security-relevant decisions live in the caller, inside one transaction.
 */
export class FileStagingRepository {
  async transaction<T>(run: (manager: EntityManager) => Promise<T>): Promise<T> {
    return getAppDataSource().transaction(run);
  }

  async findRef(
    manager: EntityManager,
    ref: string,
    lock = false,
  ): Promise<FileStagingRefEntity | null> {
    return manager.getRepository(FileStagingRefEntity).findOne({
      where: { ref },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
  }

  async findRefs(
    manager: EntityManager,
    refs: readonly string[],
    lock = false,
  ): Promise<FileStagingRefEntity[]> {
    if (refs.length === 0) return [];
    const rows = await manager.getRepository(FileStagingRefEntity).find({
      where: refs.map((ref) => ({ ref })),
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    // A stable lock order keeps concurrent multi-ref leases from deadlocking.
    return rows.sort((a, b) => a.ref.localeCompare(b.ref));
  }

  async saveRef(manager: EntityManager, row: FileStagingRefEntity): Promise<FileStagingRefEntity> {
    return manager.getRepository(FileStagingRefEntity).save(row);
  }

  async deleteRef(manager: EntityManager, ref: string): Promise<void> {
    await manager.getRepository(FileStagingRefEntity).delete({ ref });
  }

  async listRefs(manager: EntityManager): Promise<FileStagingRefEntity[]> {
    return manager.getRepository(FileStagingRefEntity).find();
  }

  async findToken(
    manager: EntityManager,
    tokenHash: string,
    lock = false,
  ): Promise<FileStagingTokenEntity | null> {
    return manager.getRepository(FileStagingTokenEntity).findOne({
      where: { tokenHash },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
  }

  async saveToken(
    manager: EntityManager,
    row: FileStagingTokenEntity,
  ): Promise<FileStagingTokenEntity> {
    return manager.getRepository(FileStagingTokenEntity).save(row);
  }

  async listTokens(manager: EntityManager): Promise<FileStagingTokenEntity[]> {
    return manager.getRepository(FileStagingTokenEntity).find();
  }

  async deleteToken(manager: EntityManager, tokenHash: string): Promise<void> {
    await manager.getRepository(FileStagingTokenEntity).delete({ tokenHash });
  }
}
