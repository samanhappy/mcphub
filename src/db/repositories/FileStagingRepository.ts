import type { EntityManager } from 'typeorm';

import { getAppDataSource } from '../connection.js';
import { FileStagingRefEntity } from '../entities/FileStagingRef.js';
import { FileStagingTokenEntity } from '../entities/FileStagingToken.js';

/** Code-point order, not locale order: the same sequence on every host. */
const compareRefs = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Thin persistence layer for the file staging ledger (#1056). All
 * security-relevant decisions live in the caller, inside one transaction.
 */
export class FileStagingRepository {
  async transaction<T>(run: (manager: EntityManager) => Promise<T>): Promise<T> {
    return getAppDataSource().transaction(run);
  }

  /**
   * Serialize quota accounting across concurrent transactions (#1056).
   *
   * Usage is a SUM over ledger rows, so two transactions reserving *different*
   * refs would each read the pre-reservation total and both pass the check.
   * A transaction-scoped advisory lock makes "read usage, then reserve" atomic
   * for the per-user and global limits alike; it is released at commit.
   */
  async lockQuota(manager: EntityManager): Promise<void> {
    await manager.query('SELECT pg_advisory_xact_lock(1056, 0)');
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
    const requested = [...new Set(refs)].sort(compareRefs);
    // `FOR UPDATE` locks rows in the order the executor returns them, which the
    // planner chooses — sorting the `IN (...)` list does not fix lock order. An
    // explicit `ORDER BY ref` does: two transactions locking overlapping sets
    // then take shared rows in the same order instead of deadlocking.
    const query = manager
      .getRepository(FileStagingRefEntity)
      .createQueryBuilder('ref')
      .where('ref.ref IN (:...refs)', { refs: requested })
      .orderBy('ref.ref', 'ASC');
    if (lock) query.setLock('pessimistic_write');
    return query.getMany();
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
