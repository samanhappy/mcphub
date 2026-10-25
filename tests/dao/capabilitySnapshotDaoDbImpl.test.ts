import { DataSource } from 'typeorm';
import { CapabilitySnapshot } from '../../src/db/entities/CapabilitySnapshot.js';
import type { CapabilitySnapshot as Snapshot } from '../../src/types/index.js';
let mockDataSource: DataSource;
jest.mock('../../src/db/connection.js', () => ({ getAppDataSource: () => mockDataSource }));
import { CapabilitySnapshotDaoDbImpl } from '../../src/dao/CapabilitySnapshotDaoDbImpl.js';

beforeEach(async () => {
  mockDataSource = new DataSource({
    type: 'better-sqlite3',
    database: ':memory:',
    entities: [CapabilitySnapshot],
    synchronize: true,
  });
  await mockDataSource.initialize();
});
afterEach(async () => {
  await mockDataSource.destroy();
});
test('round-trips raw schemas and upserts only the matching server and principal', async () => {
  const dao = new CapabilitySnapshotDaoDbImpl();
  const row: Snapshot = {
    serverName: 'demo',
    principal: 'alice',
    fingerprint: 'v1:hash',
    capturedAt: new Date().toISOString(),
    tools: [
      { name: 'ping', inputSchema: { type: 'object', properties: { nested: { type: 'object' } } } },
    ],
  };
  expect(await dao.get('demo', 'alice')).toBeNull();
  await dao.save(row);
  await dao.save({ ...row, principal: 'bob' });
  await dao.save({ ...row, tools: [] });
  expect(await new CapabilitySnapshotDaoDbImpl().get('demo', 'alice')).toEqual({
    ...row,
    tools: [],
  });
  expect(await new CapabilitySnapshotDaoDbImpl().get('demo', 'bob')).toEqual({
    ...row,
    principal: 'bob',
  });
  expect(await dao.get('other', 'alice')).toBeNull();
});
