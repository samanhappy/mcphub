import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CapabilitySnapshot } from '../../src/types/index.js';
let mockSettingsPath: string;
jest.mock('../../src/config/index.js', () => ({ getSettingsPath: () => mockSettingsPath }));
import { CapabilitySnapshotDaoImpl } from '../../src/dao/CapabilitySnapshotDao.js';
let directory: string;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'capability-dao-'));
  mockSettingsPath = path.join(directory, 'settings.json');
});
afterEach(() => fs.rmSync(directory, { recursive: true, force: true }));
test('persists across DAO instances, atomically replaces one principal, and stays out of settings', async () => {
  const dao = new CapabilitySnapshotDaoImpl();
  const row: CapabilitySnapshot = {
    serverName: 'demo',
    principal: '',
    fingerprint: 'v1:test',
    capturedAt: new Date().toISOString(),
    tools: [],
  };
  expect(await dao.get('demo', '')).toBeNull();
  await Promise.all([dao.save(row), dao.save({ ...row, principal: 'alice' })]);
  await dao.save({ ...row, fingerprint: 'new' });
  expect(await new CapabilitySnapshotDaoImpl().get('demo', '')).toEqual({
    ...row,
    fingerprint: 'new',
  });
  expect(await new CapabilitySnapshotDaoImpl().get('demo', 'alice')).toEqual({
    ...row,
    principal: 'alice',
  });
  expect(fs.existsSync(mockSettingsPath)).toBe(false);
  expect(fs.statSync(`${mockSettingsPath}.capabilities.json`).mode & 0o777).toBe(0o600);
  expect(fs.readdirSync(directory)).toEqual(['settings.json.capabilities.json']);
});
