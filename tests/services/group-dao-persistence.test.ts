const repository = {
  findAll: jest.fn(),
  findById: jest.fn(),
  findByName: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
};
jest.mock('../../src/db/repositories/GroupRepository.js', () => ({
  GroupRepository: jest.fn(() => repository),
}));
import { GroupDaoDbImpl } from '../../src/dao/GroupDaoDbImpl.js';

beforeEach(() => jest.clearAllMocks());

test('normalizes nullable legacy visibility across database lookup paths', async () => {
  const row = { id: 'id', name: 'legacy', servers: [], visibility: null, sharedWithUsers: null };
  repository.findAll.mockResolvedValue([row]);
  repository.findById.mockResolvedValue(row);
  repository.findByName.mockResolvedValue(row);
  const dao = new GroupDaoDbImpl();
  const groups = [
    ...(await dao.findAll()),
    await dao.findById('id'),
    await dao.findByName('legacy'),
  ];
  for (const group of groups) {
    expect(group?.visibility).toBeUndefined();
    expect(group?.sharedWithUsers).toBeUndefined();
  }
});

test('persists explicit visibility and shared usernames on create/update', async () => {
  repository.create.mockImplementation(async (data) => ({ id: 'id', ...data }));
  repository.update.mockImplementation(async (_id, data) => ({ id: 'id', ...data }));
  const dao = new GroupDaoDbImpl();
  const created = await dao.create({
    name: 'team',
    servers: [],
    visibility: 'group',
    sharedWithUsers: ['alice'],
  });
  expect(created).toMatchObject({ visibility: 'group', sharedWithUsers: ['alice'] });
  expect(repository.create).toHaveBeenCalledWith(
    expect.objectContaining({ visibility: 'group', sharedWithUsers: ['alice'] }),
  );
  await dao.update('id', { visibility: 'private', sharedWithUsers: [] });
  expect(repository.update).toHaveBeenCalledWith(
    'id',
    expect.objectContaining({ visibility: 'private', sharedWithUsers: [] }),
  );
});
