type Row = { id: string; name: string; allowedGroups?: string[]; excludedGroups?: string[] };

let mockGroups: Row[];
let mockKeys: Row[];
let mockFailKeySave: boolean;

// A transaction over copies of the rows: they replace the stored rows only if the callback resolves.
const mockTransaction = jest.fn(async (run: (manager: unknown) => Promise<unknown>) => {
  const groups = structuredClone(mockGroups);
  const keys = structuredClone(mockKeys);
  const repository = (rows: Row[], isKeys: boolean) => ({
    findOne: async ({ where }: { where: { id: string } }) =>
      rows.find((row) => row.id === where.id) ?? null,
    find: async () => rows,
    merge: (row: Row, changes: Partial<Row>) =>
      Object.assign(
        row,
        Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== undefined)),
      ),
    save: async (saved: Row | Row[]) => {
      if (isKeys && mockFailKeySave) throw new Error('key save failed');
      return saved;
    },
  });
  const result = await run({
    getRepository: (entity: { name: string }) =>
      entity.name === 'BearerKey' ? repository(keys, true) : repository(groups, false),
  });
  mockGroups = groups;
  mockKeys = keys;
  return result;
});

jest.mock('../../../src/db/connection.js', () => ({
  getAppDataSource: jest.fn(() => ({ transaction: mockTransaction })),
}));

import { GroupRepository } from '../../../src/db/repositories/GroupRepository.js';

describe('GroupRepository.updateWithKeyScopes', () => {
  beforeEach(() => {
    mockFailKeySave = false;
    mockGroups = [
      { id: 'id-a', name: 'team-a' },
      { id: 'id-b', name: 'team-b' },
    ];
    mockKeys = [
      {
        id: 'k1',
        name: 'by-name',
        allowedGroups: ['team-a', 'other'],
        excludedGroups: ['team-a', 'other-id'],
      },
      { id: 'k2', name: 'by-id', allowedGroups: ['id-a'] },
      { id: 'k3', name: 'unrelated', allowedGroups: ['team-b'] },
    ];
  });

  it('renames the group and moves name-scoped keys in one transaction', async () => {
    const updated = await new GroupRepository().updateWithKeyScopes('id-a', { name: 'team-c' });

    expect(updated?.name).toBe('team-c');
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    expect(mockGroups.find((g) => g.id === 'id-a')?.name).toBe('team-c');
    expect(mockKeys.map((k) => k.allowedGroups)).toEqual([
      ['team-c', 'other'],
      ['id-a'],
      ['team-b'],
    ]);
    // The exclude list is part of the same atomic rename.
    expect(mockKeys[0].excludedGroups).toEqual(['team-c', 'other-id']);
  });

  it('rolls back the rename when the key update fails', async () => {
    mockFailKeySave = true;

    await expect(
      new GroupRepository().updateWithKeyScopes('id-a', { name: 'team-c' }),
    ).rejects.toThrow('key save failed');
    expect(mockGroups.find((g) => g.id === 'id-a')?.name).toBe('team-a');
    expect(mockKeys[0].allowedGroups).toEqual(['team-a', 'other']);
    expect(mockKeys[0].excludedGroups).toEqual(['team-a', 'other-id']);
  });

  it('rejects a new name equal to another group ID', async () => {
    await expect(
      new GroupRepository().updateWithKeyScopes('id-a', { name: 'id-b' }),
    ).rejects.toThrow('already used as a group ID');
    expect(mockGroups.find((g) => g.id === 'id-a')?.name).toBe('team-a');
    expect(mockKeys[0].allowedGroups).toEqual(['team-a', 'other']);
    expect(mockKeys[0].excludedGroups).toEqual(['team-a', 'other-id']);
  });

  it('rejects a new name already taken by another group', async () => {
    await expect(
      new GroupRepository().updateWithKeyScopes('id-a', { name: 'team-b' }),
    ).rejects.toThrow('already exists');
  });

  it('leaves keys alone when the name does not change', async () => {
    mockFailKeySave = true;

    await expect(
      new GroupRepository().updateWithKeyScopes('id-a', { description: 'new' } as never),
    ).resolves.toEqual(expect.objectContaining({ name: 'team-a' }));
  });
});
