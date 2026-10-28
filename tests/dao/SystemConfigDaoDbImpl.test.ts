import { SystemConfigDaoDbImpl } from '../../src/dao/SystemConfigDaoDbImpl.js';

const mockGet = jest.fn();
const mockUpdate = jest.fn();
const mockReset = jest.fn();
jest.mock('../../src/db/repositories/SystemConfigRepository.js', () => ({
  SystemConfigRepository: jest.fn(() => ({ get: mockGet, update: mockUpdate, reset: mockReset })),
}));

it('preserves the network policy in database DAO reads, updates and resets', async () => {
  const network = { allowedCidrs: ['192.168.1.0/24', 'fd00::/64'] };
  mockGet.mockResolvedValue({ network });
  mockUpdate.mockResolvedValue({ network });
  mockReset.mockResolvedValue({});
  const dao = new SystemConfigDaoDbImpl();
  expect((await dao.get()).network).toEqual(network);
  expect((await dao.update({ network })).network).toEqual(network);
  expect(mockUpdate).toHaveBeenCalledWith({ network });
  expect((await dao.reset()).network).toBeUndefined();
});

it('round-trips tool policies through the database mapping and rejects invalid rules', async () => {
  const toolPolicies = [{ id: 'read', effect: 'allow' as const, keyId: 'key', tool: 'read' }];
  mockGet.mockResolvedValue({ toolPolicies });
  mockUpdate.mockResolvedValue({ toolPolicies });
  const dao = new SystemConfigDaoDbImpl();
  expect((await dao.get()).toolPolicies).toEqual(toolPolicies);
  expect((await dao.update({ toolPolicies })).toolPolicies).toEqual(toolPolicies);
  expect(mockUpdate).toHaveBeenLastCalledWith({ toolPolicies });
  await expect(dao.update({ toolPolicies: null as never })).rejects.toThrow();
  await expect(dao.updateSection('toolPolicies', null as never)).rejects.toThrow(
    'toolPolicies must be an array',
  );
});
