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
