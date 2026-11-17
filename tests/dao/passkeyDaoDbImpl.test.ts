import { getMetadataArgsStorage, LessThan } from 'typeorm';
import { Passkey } from '../../src/db/entities/Passkey.js';
import type { UserPasskey } from '../../src/types/index.js';

const mockRepository = {
  findOneBy: jest.fn(),
  find: jest.fn(),
  save: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};
const mockGetRepository = jest.fn(() => mockRepository);
jest.mock('../../src/db/connection.js', () => ({
  getAppDataSource: () => ({ getRepository: mockGetRepository }),
}));
import { PasskeyDaoDbImpl } from '../../src/dao/PasskeyDaoDbImpl.js';
import { DatabaseDaoFactory } from '../../src/dao/DatabaseDaoFactory.js';

const row: UserPasskey = {
  id: '4f6c1a2e-3b4d-4e5f-8a9b-0c1d2e3f4a5b',
  username: 'alice',
  credentialId: 'credential',
  publicKey: 'public-key',
  counter: 3,
  transports: ['internal'],
  userHandle: 'handle',
  rpId: 'hub.example.test',
  sessionVersion: 'version',
  name: 'Laptop',
  deviceType: 'multiDevice',
  backedUp: true,
  createdAt: '2026-11-17T00:00:00.000Z',
  lastUsedAt: null,
};

beforeEach(() => {
  jest.resetAllMocks();
  mockGetRepository.mockReturnValue(mockRepository);
});

test('is the passkey store of the database factory', () => {
  expect(DatabaseDaoFactory.getInstance().getPasskeyDao()).toBeInstanceOf(PasskeyDaoDbImpl);
});

test('looks passkeys up by id, credential and owner', async () => {
  const dao = new PasskeyDaoDbImpl();
  mockRepository.findOneBy.mockResolvedValueOnce(row).mockResolvedValueOnce(null);
  mockRepository.find.mockResolvedValueOnce([row]);

  expect(await dao.findById(row.id)).toEqual(row);
  expect(await dao.findByCredentialId('unknown')).toBeNull();
  expect(await dao.findByUsername('alice')).toEqual([row]);
  expect(mockRepository.findOneBy.mock.calls).toEqual([
    [{ id: row.id }],
    [{ credentialId: 'unknown' }],
  ]);
  expect(mockRepository.find).toHaveBeenCalledWith({
    where: { username: 'alice' },
    order: { createdAt: 'ASC' },
  });
});

test('saves, removes one passkey, and removes every passkey of a user', async () => {
  const dao = new PasskeyDaoDbImpl();
  await dao.save(row);
  await dao.delete(row.id);
  await dao.deleteByUsername('alice');
  expect(mockRepository.save).toHaveBeenCalledWith(row);
  expect(mockRepository.delete.mock.calls).toEqual([[{ id: row.id }], [{ username: 'alice' }]]);
});

test('records a sign-in with an update that never inserts a removed passkey', async () => {
  const dao = new PasskeyDaoDbImpl();
  const use = { counter: 4, backedUp: true, lastUsedAt: '2026-11-17T01:00:00.000Z' };
  mockRepository.update
    .mockResolvedValueOnce({ affected: 1 })
    .mockResolvedValueOnce({ affected: 0 })
    .mockResolvedValueOnce({});

  expect(await dao.recordUse(row.id, use)).toBe(true);
  expect(await dao.recordUse(row.id, use)).toBe(false);
  // Drivers that report no count are treated as no row updated
  expect(await dao.recordUse(row.id, use)).toBe(false);
  // The counter check is part of the UPDATE itself
  expect(mockRepository.update).toHaveBeenCalledWith({ id: row.id, counter: LessThan(4) }, use);
  expect(mockRepository.save).not.toHaveBeenCalled();
});

test('matches only a zero stored counter for authenticators that report 0', async () => {
  const dao = new PasskeyDaoDbImpl();
  const use = { counter: 0, backedUp: true, lastUsedAt: null };
  mockRepository.update.mockResolvedValueOnce({ affected: 1 });
  expect(await dao.recordUse(row.id, use)).toBe(true);
  expect(mockRepository.update).toHaveBeenCalledWith({ id: row.id, counter: 0 }, use);
});

test('reads signature counters stored as bigint strings back as numbers', () => {
  const column = getMetadataArgsStorage().columns.find(
    (entry) => entry.target === Passkey && entry.propertyName === 'counter',
  );
  const transformer = column?.options.transformer as {
    to: (value: number) => unknown;
    from: (value: unknown) => number;
  };
  expect(transformer.to(4_000_000_001)).toBe(4_000_000_001);
  expect(transformer.from('4000000001')).toBe(4_000_000_001);
  expect(transformer.from(7)).toBe(7);
  expect(transformer.from(null)).toBe(0);
});
