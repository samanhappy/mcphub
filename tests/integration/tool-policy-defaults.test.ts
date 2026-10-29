const mockGetConfig = jest.fn();

jest.mock('../../src/db/repositories/SystemConfigRepository.js', () => ({
  SystemConfigRepository: jest.fn(() => ({ get: mockGetConfig })),
}));
jest.mock('../../src/dao/index.js', () => ({
  getSystemConfigDao: () =>
    new (jest.requireActual('../../src/dao/SystemConfigDaoDbImpl.js').SystemConfigDaoDbImpl)(),
}));
jest.mock('../../src/config/index.js', () => ({ getNameSeparator: () => '-' }));

import { getToolPolicy } from '../../src/services/toolPolicyService.js';

it('preserves tool discovery and authorization when an upgraded database returns SQL NULL policies', async () => {
  mockGetConfig.mockResolvedValue({ toolPolicies: null });
  const policy = await getToolPolicy('existing-server');
  const tools = [{ name: 'existing-server-read', inputSchema: { type: 'object' as const } }];
  expect(policy.active).toBe(false);
  expect(policy.filterTools('existing-server', tools)).toEqual(tools);
  expect(policy.authorize('existing-server', 'read').decision).toBe('allow');
});

it.each([{}, false, [{ id: 'invalid', effect: 'typo' }]])(
  'continues to reject malformed database policies: %j',
  async (toolPolicies) => {
    mockGetConfig.mockResolvedValue({ toolPolicies });
    await expect(getToolPolicy()).rejects.toThrow();
  },
);
