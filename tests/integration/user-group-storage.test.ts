import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DataSource } from 'typeorm';
import { scopedDataSource } from '../../src/db/transactionContext.js';
import { updateUser } from '../../src/services/userService.js';
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
let mockUserDao: UserDaoImpl | UserDaoDbImpl;
jest.mock('../../src/db/connection.js', () => ({
  getAppDataSource: () => scopedDataSource(mockSource),
}));
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
    const suspendedAt = new Date().toISOString();
    await mockUserDao.update('alice', { disabled: true, suspendedAt });
    expect(await new UserDaoImpl().findByUsername('alice')).toMatchObject({
      disabled: true,
      suspendedAt,
    });
    await mockUserDao.update('alice', { disabled: false });
    expect(await new UserDaoImpl().findByUsername('alice')).toMatchObject({
      disabled: false,
      suspendedAt,
    });
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
  it('persists suspension and retains the dashboard generation on reactivation', async () => {
    const users = new UserDaoDbImpl();
    const username = 'suspension-test-user';
    const suspendedAt = new Date().toISOString();
    expect((await users.create({ username, password: 'hash' })).disabled).toBe(false);
    await users.update(username, { disabled: true, suspendedAt });
    expect(await new UserDaoDbImpl().findByUsername(username)).toMatchObject({
      disabled: true,
      suspendedAt,
    });
    await users.update(username, { disabled: false });
    expect(await new UserDaoDbImpl().findByUsername(username)).toMatchObject({
      disabled: false,
      suspendedAt,
    });
  });
  it('serializes competing account suspension and demotion in PostgreSQL', async () => {
    const users = new UserDaoDbImpl();
    mockUserDao = users;
    const adminA = 'suspension-admin-a';
    const adminB = 'suspension-admin-b';
    await users.create({ username: adminA, password: 'hash', isAdmin: true });
    await users.create({ username: adminB, password: 'hash', isAdmin: true });
    const results = await Promise.allSettled([
      updateUser(adminB, { disabled: true }, { username: adminA }),
      updateUser(adminA, { isAdmin: false }, { username: adminB }),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const enabledAdmins = (await users.findAdmins()).filter((user) => !user.disabled);
    expect(enabledAdmins.map((user) => user.username)).toEqual([
      expect.stringMatching(/^suspension-admin-[ab]$/),
    ]);
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
