import type { EntityManager } from 'typeorm';

import { FileStagingRepository } from '../FileStagingRepository.js';

const ref = (id: string): string => `mcpfile://${id}`;

const A = ref('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
const B = ref('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
const C = ref('cccccccc-cccc-4ccc-8ccc-cccccccccccc');

/** Records the `where` list the query builder receives, in order. */
const fakeManager = (): { manager: EntityManager; whereCalls: string[][]; lockModes: string[] } => {
  const whereCalls: string[][] = [];
  const lockModes: string[] = [];
  const manager = {
    getRepository: () => ({
      find: async (options: { where: Array<{ ref: string }>; lock?: { mode: string } }) => {
        whereCalls.push(options.where.map((entry) => entry.ref));
        if (options.lock) lockModes.push(options.lock.mode);
        // Deliberately return the rows out of order.
        return options.where.map((entry) => ({ ref: entry.ref })).reverse();
      },
    }),
  } as unknown as EntityManager;
  return { manager, whereCalls, lockModes };
};

describe('FileStagingRepository.findRefs', () => {
  it('sorts the requested refs before the locking query', async () => {
    const repository = new FileStagingRepository();
    const { manager, whereCalls, lockModes } = fakeManager();

    await repository.findRefs(manager, [C, A, B], true);

    // PostgreSQL locks rows in the order the IN (...) list presents them.
    expect(whereCalls).toEqual([[A, B, C]]);
    expect(lockModes).toEqual(['pessimistic_write']);
  });

  it('deduplicates the requested refs', async () => {
    const repository = new FileStagingRepository();
    const { manager, whereCalls } = fakeManager();

    await repository.findRefs(manager, [B, A, B], true);

    expect(whereCalls).toEqual([[A, B]]);
  });

  it('returns rows in a stable order', async () => {
    const repository = new FileStagingRepository();
    const { manager } = fakeManager();

    const rows = await repository.findRefs(manager, [C, A, B]);

    expect(rows.map((row) => row.ref)).toEqual([A, B, C]);
  });

  it('does not query for an empty list', async () => {
    const repository = new FileStagingRepository();
    const { manager, whereCalls } = fakeManager();

    await expect(repository.findRefs(manager, [], true)).resolves.toEqual([]);
    expect(whereCalls).toEqual([]);
  });
});
