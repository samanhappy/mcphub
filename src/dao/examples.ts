import { logger } from '../utils/logger.js';
/**
 * Data access layer example and test utilities
 *
 * This file demonstrates how to use the DAO layer for managing different types of data
 * in the MCPHub application.
 */

import {
  getUserDao,
  getServerDao,
  getGroupDao,
  getSystemConfigDao,
  getUserConfigDao,
  JsonFileDaoFactory,
  setDaoFactory,
} from './DaoFactory.js';

/**
 * Example usage of UserDao
 */
export async function exampleUserOperations() {
  const userDao = getUserDao();

  // Create a new user
  const newUser = await userDao.createWithHashedPassword('testuser', 'password123', false);
  logger.log('Created user:', newUser.username);

  // Find user by username
  const foundUser = await userDao.findByUsername('testuser');
  logger.log('Found user:', foundUser?.username);

  // Validate credentials
  const isValid = await userDao.validateCredentials('testuser', 'password123');
  logger.log('Credentials valid:', isValid);

  // Update user
  await userDao.update('testuser', { isAdmin: true });
  logger.log('Updated user to admin');

  // Find all admin users
  const admins = await userDao.findAdmins();
  logger.log(
    'Admin users:',
    admins.map((u) => u.username),
  );

  // Delete user
  await userDao.delete('testuser');
  logger.log('Deleted test user');
}

/**
 * Example usage of ServerDao
 */
export async function exampleServerOperations() {
  const serverDao = getServerDao();

  // Create a new server
  const newServer = await serverDao.create({
    name: 'test-server',
    command: 'node',
    args: ['server.js'],
    enabled: true,
    owner: 'admin',
  });
  logger.log('Created server:', newServer.name);

  // Find servers by owner
  const userServers = await serverDao.findByOwner('admin');
  logger.log(
    'Servers owned by admin:',
    userServers.map((s) => s.name),
  );

  // Find enabled servers
  const enabledServers = await serverDao.findEnabled();
  logger.log(
    'Enabled servers:',
    enabledServers.map((s) => s.name),
  );

  // Update server tools
  await serverDao.updateTools('test-server', {
    tool1: { enabled: true, description: 'Test tool' },
  });
  logger.log('Updated server tools');

  // Delete server
  await serverDao.delete('test-server');
  logger.log('Deleted test server');
}

/**
 * Example usage of GroupDao
 */
export async function exampleGroupOperations() {
  const groupDao = getGroupDao();

  // Create a new group
  const newGroup = await groupDao.create({
    name: 'test-group',
    description: 'Test group for development',
    servers: ['server1', 'server2'],
    owner: 'admin',
  });
  logger.log('Created group:', newGroup.name, 'with ID:', newGroup.id);

  // Find groups by owner
  const userGroups = await groupDao.findByOwner('admin');
  logger.log(
    'Groups owned by admin:',
    userGroups.map((g) => g.name),
  );

  // Add server to group
  await groupDao.addServerToGroup(newGroup.id, 'server3');
  logger.log('Added server3 to group');

  // Find groups containing specific server
  const groupsWithServer = await groupDao.findByServer('server1');
  logger.log(
    'Groups containing server1:',
    groupsWithServer.map((g) => g.name),
  );

  // Remove server from group
  await groupDao.removeServerFromGroup(newGroup.id, 'server2');
  logger.log('Removed server2 from group');

  // Delete group
  await groupDao.delete(newGroup.id);
  logger.log('Deleted test group');
}

/**
 * Example usage of SystemConfigDao
 */
export async function exampleSystemConfigOperations() {
  const systemConfigDao = getSystemConfigDao();

  // Get current system config
  const currentConfig = await systemConfigDao.get();
  logger.log('Current system config:', currentConfig);

  // Update routing configuration
  await systemConfigDao.updateSection('routing', {
    enableGlobalRoute: true,
    enableGroupNameRoute: true,
    enableBearerAuth: true,
  });
  logger.log('Updated routing configuration');

  // Update install configuration
  await systemConfigDao.updateSection('install', {
    pythonIndexUrl: 'https://pypi.org/simple/',
    npmRegistry: 'https://registry.npmjs.org/',
    baseUrl: 'https://mcphub.local',
  });
  logger.log('Updated install configuration');

  // Get specific section
  const routingConfig = await systemConfigDao.getSection('routing');
  logger.log('Routing config:', routingConfig);
}

/**
 * Example usage of UserConfigDao
 */
export async function exampleUserConfigOperations() {
  const userConfigDao = getUserConfigDao();

  // Update user configuration
  await userConfigDao.update('admin', {
    routing: {
      enableGlobalRoute: false,
      enableGroupNameRoute: true,
    },
  });
  logger.log('Updated admin user config');

  // Get user configuration
  const adminConfig = await userConfigDao.get('admin');
  logger.log('Admin config:', adminConfig);

  // Get all user configurations
  const allUserConfigs = await userConfigDao.getAll();
  logger.log('All user configs:', Object.keys(allUserConfigs));

  // Get specific section for user
  const userRoutingConfig = await userConfigDao.getSection('admin', 'routing' as never);
  logger.log('Admin routing config:', userRoutingConfig);

  // Delete user configuration
  await userConfigDao.delete('admin');
  logger.log('Deleted admin user config');
}

/**
 * Test all DAO operations
 */
export async function testAllDaoOperations() {
  try {
    logger.log('=== Testing DAO Layer ===');

    logger.log('\n--- User Operations ---');
    await exampleUserOperations();

    logger.log('\n--- Server Operations ---');
    await exampleServerOperations();

    logger.log('\n--- Group Operations ---');
    await exampleGroupOperations();

    logger.log('\n--- System Config Operations ---');
    await exampleSystemConfigOperations();

    logger.log('\n--- User Config Operations ---');
    await exampleUserConfigOperations();

    logger.log('\n=== DAO Layer Test Complete ===');
  } catch (error) {
    logger.error('Error during DAO testing:', error);
  }
}

/**
 * Reset DAO factory for testing purposes
 */
export function resetDaoFactory() {
  const factory = JsonFileDaoFactory.getInstance();
  factory.resetInstances();
  setDaoFactory(factory);
}
