import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DataSource } from 'typeorm';
import { UserDaoImpl } from '../../src/dao/UserDao.js';
import { ServerDaoImpl } from '../../src/dao/ServerDao.js';
import { UserDaoDbImpl } from '../../src/dao/UserDaoDbImpl.js';
import { ServerDaoDbImpl } from '../../src/dao/ServerDaoDbImpl.js';
import { User } from '../../src/db/entities/User.js';
import { Server } from '../../src/db/entities/Server.js';
import { Group } from '../../src/db/entities/Group.js';
import { GroupDaoDbImpl } from '../../src/dao/GroupDaoDbImpl.js';

let mockSource: DataSource;
let mockSettingsPath: string;
let mockUserDao: UserDaoImpl;
jest.mock('../../src/db/connection.js', () => ({ getAppDataSource: () => mockSource }));
jest.mock('../../src/dao/index.js', () => ({ getUserDao: () => mockUserDao }));
jest.mock('../../src/config/index.js', () => ({
  getSettingsPath: () => mockSettingsPath,
  getSettingsGeneration: () => 0,
  clearSettingsCache: () => {},
}));

it('persists JSON memberships and shares, and paginates using current membership', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-user-groups-'));
  mockSettingsPath = path.join(dir, 'settings.json');
  try {
    fs.writeFileSync(
      mockSettingsPath,
      JSON.stringify({
        users: [{ username: 'alice', password: 'hash', userGroups: ['readers'] }],
        mcpServers: {},
      }),
    );
    mockUserDao = new UserDaoImpl();
    const servers = new ServerDaoImpl();
    await servers.create({
      name: 'shared',
      command: 'node',
      owner: 'admin',
      visibility: 'group',
      sharedWithUserGroups: ['readers'],
    });
    expect((await servers.findVisibleToUserPaginated('alice', 1, 10)).total).toBe(1);
    await mockUserDao.update('alice', { userGroups: [] });
    expect((await servers.findVisibleToUserPaginated('alice', 1, 10)).total).toBe(0);
    expect((await new UserDaoImpl().findByUsername('alice'))?.userGroups).toEqual([]);
    expect((await new ServerDaoImpl().findById('shared'))?.sharedWithUserGroups).toEqual([
      'readers',
    ]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const dbSuite = process.env.MCPHUB_TEST_PG_PORT ? describe : describe.skip;
dbSuite('user-group PostgreSQL storage', () => {
  beforeAll(async () => {
    mockSource = new DataSource({
      type: 'postgres',
      host: '127.0.0.1',
      port: Number(process.env.MCPHUB_TEST_PG_PORT),
      username: 'mcphub_test',
      password: 'mcphub_test',
      database: 'mcphub_test',
      entities: [User, Server, Group],
      synchronize: true,
    });
    await mockSource.initialize();
  });
  afterAll(async () => {
    if (!mockSource?.isInitialized) return;
    await mockSource.getRepository(Server).clear();
    await mockSource.getRepository(Group).clear();
    await mockSource.getRepository(User).clear();
    await mockSource.destroy();
  });
  it('round-trips membership and shares and revokes paginated access on removal', async () => {
    const users = new UserDaoDbImpl();
    const servers = new ServerDaoDbImpl();
    const groups = new GroupDaoDbImpl();
    await users.create({ username: 'group-test-alice', password: 'hash', userGroups: ['readers'] });
    await servers.create({
      name: 'group-test-server',
      command: 'node',
      owner: 'admin',
      visibility: 'group',
      sharedWithUserGroups: ['readers'],
    });
    const group = await groups.create({
      name: 'group-test-route',
      servers: ['group-test-server'],
      visibility: 'group',
      sharedWithUserGroups: ['readers'],
    });
    expect((await users.findByUsername('group-test-alice'))?.userGroups).toEqual(['readers']);
    expect((await groups.findById(group.id))?.sharedWithUserGroups).toEqual(['readers']);
    expect((await servers.findVisibleToUserPaginated('group-test-alice', 1, 10)).total).toBe(1);
    await users.update('group-test-alice', { userGroups: [] });
    expect((await servers.findVisibleToUserPaginated('group-test-alice', 1, 10)).total).toBe(0);
  });
});
