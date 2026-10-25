import { CapabilitySnapshot } from '../../src/db/entities/CapabilitySnapshot.js';
import type { CapabilitySnapshot as Snapshot } from '../../src/types/index.js';

const mockRepository = {
  findOneBy: jest.fn(),
  upsert: jest.fn(),
};
const mockGetRepository = jest.fn(() => mockRepository);
jest.mock('../../src/db/connection.js', () => ({
  getAppDataSource: () => ({ getRepository: mockGetRepository }),
}));
import { CapabilitySnapshotDaoDbImpl } from '../../src/dao/CapabilitySnapshotDaoDbImpl.js';

const row: Snapshot = {
  serverName: 'demo',
  principal: 'alice',
  fingerprint: 'v1:hash',
  capturedAt: new Date().toISOString(),
  tools: [
    { name: 'ping', inputSchema: { type: 'object', properties: { nested: { type: 'object' } } } },
  ],
};

beforeEach(() => {
  jest.resetAllMocks();
  mockGetRepository.mockReturnValue(mockRepository);
});

test('reads raw schemas using both server and principal, including missing snapshots', async () => {
  const dao = new CapabilitySnapshotDaoDbImpl();
  mockRepository.findOneBy.mockResolvedValueOnce(null).mockResolvedValueOnce({
    ...row,
    tools: JSON.stringify(row.tools),
  });
  expect(await dao.get('other', 'alice')).toBeNull();
  expect(await dao.get('demo', 'alice')).toEqual(row);
  expect(mockRepository.findOneBy.mock.calls).toEqual([
    [{ serverName: 'other', principal: 'alice' }],
    [{ serverName: 'demo', principal: 'alice' }],
  ]);
  expect(mockGetRepository).toHaveBeenCalledWith(CapabilitySnapshot);
});

test('serializes raw schemas and upserts on the server/principal composite key', async () => {
  const dao = new CapabilitySnapshotDaoDbImpl();
  await dao.save(row);
  await dao.save({ ...row, principal: 'bob', tools: [] });
  expect(mockRepository.upsert.mock.calls).toEqual([
    [{ ...row, tools: JSON.stringify(row.tools) }, ['serverName', 'principal']],
    [{ ...row, principal: 'bob', tools: '[]' }, ['serverName', 'principal']],
  ]);
});
