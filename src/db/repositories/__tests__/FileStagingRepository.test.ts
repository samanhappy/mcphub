import type { EntityManager } from 'typeorm';

import { FileStagingRepository } from '../FileStagingRepository.js';

const ref = (id: string): string => `mcpfile://${id}`;

const A = ref('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const B = ref('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const C = ref('cccccccc-cccc-4ccc-8ccc-cccccccccccc');

/**
 * The lock order is decided by the statement's ORDER BY, not by the order of
 * the `IN (...)` list: PostgreSQL locks rows as the executor returns them.
 */
const fakeManager = (): {
  manager: EntityManager;
  whereCalls: string[][];
  orderBy: string[];
  locks: string[];
} => {
  const whereCalls: string[][] = [];
  const orderBy: string[] = [];
  const locks: string[] = [];
  const query = {
    where: (_sql: string, params: { refs: string[] }) => {
      whereCalls.push(params.refs);
      return query;
    },
    orderBy: (column: string, direction: string) => {
      orderBy.push(`${column} ${direction}`);
      return query;
    },
    setLock: (mode: string) => {
      locks.push(mode);
      return query;
    },
    getMany: async () => whereCalls.at(-1)!.map((value) => ({ ref: value })),
  };
  const manager = {
    getRepository: () => ({ createQueryBuilder: () => query }),
  } as unknown as EntityManager;
  return { manager, whereCalls, orderBy, locks };
};

describe('FileStagingRepository.findRefs', () => {
  it('orders the locking query by ref so concurrent transactions agree', async () => {
    const repository = new FileStagingRepository();
    const { manager, whereCalls, orderBy, locks } = fakeManager();

    await repository.findRefs(manager, [C, A, B], true);

    expect(whereCalls).toEqual([[A, B, C]]);
    expect(orderBy).toEqual(['ref.ref ASC']);
    expect(locks).toEqual(['pessimistic_write']);
  });

  it('deduplicates the requested refs', async () => {
    const repository = new FileStagingRepository();
    const { manager, whereCalls } = fakeManager();

    await repository.findRefs(manager, [B, A, B], true);

    expect(whereCalls).toEqual([[A, B]]);
  });

  it('does not lock when the caller did not ask for it', async () => {
    const repository = new FileStagingRepository();
    const { manager, locks } = fakeManager();

    await repository.findRefs(manager, [A]);

    expect(locks).toEqual([]);
  });

  it('does not query for an empty list', async () => {
    const repository = new FileStagingRepository();
    const { manager, whereCalls } = fakeManager();

    await expect(repository.findRefs(manager, [], true)).resolves.toEqual([]);
    expect(whereCalls).toEqual([]);
  });
});
