const repository = {
  findOne: jest.fn().mockResolvedValue({ name: 'existing', id: 'id' }),
  create: jest.fn(),
  merge: jest.fn(),
  save: jest.fn(),
};
jest.mock('../../src/db/connection.js', () => ({
  getAppDataSource: () => ({ getRepository: () => repository }),
}));

import { GroupRepository } from '../../src/db/repositories/GroupRepository.js';
import { ServerRepository } from '../../src/db/repositories/ServerRepository.js';

const original = process.env.SMART_ROUTING_PATH;
beforeEach(() => {
  jest.clearAllMocks();
  process.env.SMART_ROUTING_PATH = 'my_smart';
});
afterEach(() => {
  if (original === undefined) delete process.env.SMART_ROUTING_PATH;
  else process.env.SMART_ROUTING_PATH = original;
});

it('rejects reserved database server creates, updates and renames before saving', async () => {
  const servers = new ServerRepository();
  await expect(
    servers.create({ name: 'my_smart', enabled: true, visibility: 'private' }),
  ).rejects.toThrow('reserved');
  await expect(servers.update('existing', { name: 'my_smart' })).rejects.toThrow('reserved');
  await expect(servers.rename('existing', 'my_smart')).rejects.toThrow('reserved');
  expect(repository.save).not.toHaveBeenCalled();
});

it('rejects reserved database group names and explicit ID changes before saving', async () => {
  const groups = new GroupRepository();
  await expect(groups.create({ name: 'my_smart', servers: [] })).rejects.toThrow('reserved');
  await expect(groups.update('id', { name: 'my_smart' })).rejects.toThrow('reserved');
  await expect(groups.update('id', { id: 'my_smart' })).rejects.toThrow('reserved');
  expect(repository.save).not.toHaveBeenCalled();
});
