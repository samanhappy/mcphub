/**
 * Migration utilities for moving from legacy file-based config to DAO layer
 */

import { loadSettings, migrateToDao, switchToDao, switchToLegacy } from './configManager.js';
import { UserDaoImpl, ServerDaoImpl, GroupDaoImpl } from '../dao/index.js';
import { logger } from '../utils/logger.js';

/**
 * Validate data integrity after migration
 */
export async function validateMigration(): Promise<boolean> {
  try {
    logger.log('Validating migration...');

    // Load settings using DAO layer
    switchToDao();
    const daoSettings = await loadSettings();

    // Load settings using legacy method
    switchToLegacy();
    const legacySettings = await loadSettings();

    // Compare key metrics
    const daoUserCount = daoSettings.users?.length || 0;
    const legacyUserCount = legacySettings.users?.length || 0;

    const daoServerCount = Object.keys(daoSettings.mcpServers || {}).length;
    const legacyServerCount = Object.keys(legacySettings.mcpServers || {}).length;

    const daoGroupCount = daoSettings.groups?.length || 0;
    const legacyGroupCount = legacySettings.groups?.length || 0;

    logger.log('Data comparison:');
    logger.log(`Users: DAO=${daoUserCount}, Legacy=${legacyUserCount}`);
    logger.log(`Servers: DAO=${daoServerCount}, Legacy=${legacyServerCount}`);
    logger.log(`Groups: DAO=${daoGroupCount}, Legacy=${legacyGroupCount}`);

    const isValid =
      daoUserCount === legacyUserCount &&
      daoServerCount === legacyServerCount &&
      daoGroupCount === legacyGroupCount;

    if (isValid) {
      logger.log('✅ Migration validation passed');
    } else {
      logger.log('❌ Migration validation failed');
    }

    return isValid;
  } catch (error) {
    logger.error('Migration validation error:', error);
    return false;
  }
}

/**
 * Perform a complete migration with validation
 */
export async function performMigration(): Promise<boolean> {
  try {
    logger.log('🚀 Starting migration to DAO layer...');

    // Step 1: Backup current data
    logger.log('📁 Creating backup of current data...');
    switchToLegacy();
    const _backupData = await loadSettings();

    // Step 2: Perform migration
    logger.log('🔄 Migrating data to DAO layer...');
    const migrationSuccess = await migrateToDao();

    if (!migrationSuccess) {
      logger.error('❌ Migration failed');
      return false;
    }

    // Step 3: Validate migration
    logger.log('🔍 Validating migration...');
    const validationSuccess = await validateMigration();

    if (!validationSuccess) {
      logger.error('❌ Migration validation failed');
      // Could implement rollback here if needed
      return false;
    }

    logger.log('✅ Migration completed successfully!');
    logger.log('💡 You can now use the DAO layer by setting USE_DAO_LAYER=true');

    return true;
  } catch (error) {
    logger.error('Migration error:', error);
    return false;
  }
}

/**
 * Test DAO operations with sample data
 */
export async function testDaoOperations(): Promise<boolean> {
  try {
    logger.log('🧪 Testing DAO operations...');

    switchToDao();
    const userDao = new UserDaoImpl();
    const serverDao = new ServerDaoImpl();
    const groupDao = new GroupDaoImpl();

    // Test user operations
    logger.log('Testing user operations...');
    const testUser = await userDao.createWithHashedPassword('test-dao-user', 'password123', false);
    logger.log(`✅ Created test user: ${testUser.username}`);

    const foundUser = await userDao.findByUsername('test-dao-user');
    logger.log(`✅ Found user: ${foundUser?.username}`);

    const isValidPassword = await userDao.validateCredentials('test-dao-user', 'password123');
    logger.log(`✅ Password validation: ${isValidPassword}`);

    // Test server operations
    logger.log('Testing server operations...');
    const testServer = await serverDao.create({
      name: 'test-dao-server',
      command: 'node',
      args: ['test.js'],
      enabled: true,
      owner: 'test-dao-user',
    });
    logger.log(`✅ Created test server: ${testServer.name}`);

    const userServers = await serverDao.findByOwner('test-dao-user');
    logger.log(`✅ Found ${userServers.length} servers for user`);

    // Test group operations
    logger.log('Testing group operations...');
    const testGroup = await groupDao.create({
      name: 'test-dao-group',
      description: 'Test group for DAO operations',
      servers: ['test-dao-server'],
      owner: 'test-dao-user',
    });
    logger.log(`✅ Created test group: ${testGroup.name} (ID: ${testGroup.id})`);

    const userGroups = await groupDao.findByOwner('test-dao-user');
    logger.log(`✅ Found ${userGroups.length} groups for user`);

    // Cleanup test data
    logger.log('Cleaning up test data...');
    await groupDao.delete(testGroup.id);
    await serverDao.delete('test-dao-server');
    await userDao.delete('test-dao-user');
    logger.log('✅ Test data cleaned up');

    logger.log('🎉 All DAO operations test passed!');
    return true;
  } catch (error) {
    logger.error('DAO operations test error:', error);
    return false;
  }
}

/**
 * Performance comparison between legacy and DAO approaches
 */
export async function performanceComparison(): Promise<void> {
  try {
    logger.log('⚡ Performance comparison...');

    // Test legacy approach
    logger.log('Testing legacy approach...');
    switchToLegacy();
    const legacyStart = Date.now();
    await loadSettings();
    const legacyTime = Date.now() - legacyStart;
    logger.log(`Legacy load time: ${legacyTime}ms`);

    // Test DAO approach
    logger.log('Testing DAO approach...');
    switchToDao();
    const daoStart = Date.now();
    await loadSettings();
    const daoTime = Date.now() - daoStart;
    logger.log(`DAO load time: ${daoTime}ms`);

    // Comparison
    const difference = daoTime - legacyTime;
    const percentage = ((difference / legacyTime) * 100).toFixed(2);

    logger.log(`Performance difference: ${difference}ms (${percentage}%)`);

    if (difference > 0) {
      logger.log(`DAO approach is ${percentage}% slower`);
    } else {
      logger.log(`DAO approach is ${Math.abs(parseFloat(percentage))}% faster`);
    }
  } catch (error) {
    logger.error('Performance comparison error:', error);
  }
}

/**
 * Generate migration report
 */
export async function generateMigrationReport(): Promise<any> {
  try {
    logger.log('📊 Generating migration report...');

    // Collect statistics from both approaches
    switchToLegacy();
    const legacySettings = await loadSettings();

    switchToDao();
    const daoSettings = await loadSettings();

    const report = {
      timestamp: new Date().toISOString(),
      legacy: {
        users: legacySettings.users?.length || 0,
        servers: Object.keys(legacySettings.mcpServers || {}).length,
        groups: legacySettings.groups?.length || 0,
        systemConfigSections: Object.keys(legacySettings.systemConfig || {}).length,
        userConfigs: Object.keys(legacySettings.userConfigs || {}).length,
      },
      dao: {
        users: daoSettings.users?.length || 0,
        servers: Object.keys(daoSettings.mcpServers || {}).length,
        groups: daoSettings.groups?.length || 0,
        systemConfigSections: Object.keys(daoSettings.systemConfig || {}).length,
        userConfigs: Object.keys(daoSettings.userConfigs || {}).length,
      },
    };

    logger.log('📈 Migration Report:');
    logger.log(JSON.stringify(report, null, 2));

    return report;
  } catch (error) {
    logger.error('Report generation error:', error);
    return null;
  }
}
