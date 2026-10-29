const mockConfig = jest.fn();
const mockServers = jest.fn();
const mockKeys = jest.fn();
const mockGroups = jest.fn();
jest.mock('../../src/dao/DaoFactory.js', () => ({
  getSystemConfigDao: () => ({ get: mockConfig }),
  getServerDao: () => ({ findAll: mockServers }),
  getBearerKeyDao: () => ({ findAll: mockKeys }),
  getGroupDao: () => ({ findAll: mockGroups }),
}));
import { warnMissingToolPolicyReferences } from '../../src/services/toolPolicyDiagnostics.js';
import { logger } from '../../src/utils/logger.js';

beforeEach(() => {
  mockConfig.mockResolvedValue({ toolPolicies: [] });
  mockServers.mockResolvedValue([{ id: 'server' }]);
  mockKeys.mockResolvedValue([{ id: 'key', token: 'must-not-log' }]);
  mockGroups.mockResolvedValue([{ id: 'group' }]);
});
afterEach(() => jest.restoreAllMocks());

test('startup warns for every missing reference, including rules with a valid reference', async () => {
  mockConfig.mockResolvedValue({
    toolPolicies: [
      { id: 'valid', effect: 'deny', serverId: 'server', keyId: 'key', groupId: 'group' },
      { id: 'stale', effect: 'deny', serverId: 'deleted', keyId: 'key', groupId: 'gone' },
      { id: 'future-key', effect: 'allow', keyId: 'future' },
    ],
  });
  const warn = jest.spyOn(logger, 'warn');
  await warnMissingToolPolicyReferences();
  expect(warn).toHaveBeenCalledTimes(3);
  expect(warn.mock.calls.map((call) => call[1])).toEqual([
    { policyId: 'stale', selector: 'serverId', value: 'deleted' },
    { policyId: 'stale', selector: 'groupId', value: 'gone' },
    { policyId: 'future-key', selector: 'keyId', value: 'future' },
  ]);
  expect(JSON.stringify(warn.mock.calls)).not.toContain('must-not-log');
});

test('no policies require no reference lookups', async () => {
  mockServers.mockClear();
  await warnMissingToolPolicyReferences();
  expect(mockServers).not.toHaveBeenCalled();
});

test('lookup failures produce a diagnostic rather than preventing startup', async () => {
  mockConfig.mockRejectedValueOnce(new Error('database unavailable'));
  const warn = jest.spyOn(logger, 'warn');
  await expect(warnMissingToolPolicyReferences()).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalledWith('Could not check tool policy references', expect.any(Error));
});
