#!/usr/bin/env node

/**
 * MCPHub DAO Layer Demo Script
 *
 * This script demonstrates how to use the new DAO layer for managing
 * MCPHub configuration data.
 */

import {
  loadSettings,
  switchToDao,
  switchToLegacy,
  getDaoConfigService,
} from '../config/configManager.js';

import {
  performMigration,
  validateMigration,
  testDaoOperations,
  performanceComparison,
  generateMigrationReport,
} from '../config/migrationUtils.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case 'migrate':
      {
        console.log('🚀 Starting migration to DAO layer...');
        const success = await performMigration();
        process.exit(success ? 0 : 1);
      }
      break;

    case 'validate':
      {
        console.log('🔍 Validating migration...');
        const isValid = await validateMigration();
        process.exit(isValid ? 0 : 1);
      }
      break;

    case 'test':
      {
        console.log('🧪 Testing DAO operations...');
        const testSuccess = await testDaoOperations();
        process.exit(testSuccess ? 0 : 1);
      }
      break;

    case 'compare':
      {
        console.log('⚡ Comparing performance...');
        await performanceComparison();
        process.exit(0);
      }
      break;

    case 'report':
      {
        console.log('📊 Generating migration report...');
        await generateMigrationReport();
        process.exit(0);
      }
      break;

    case 'demo':
      {
        await runDemo();
        process.exit(0);
      }
      break;

    case 'switch-dao':
      {
        switchToDao();
        console.log('✅ Switched to DAO layer');
        process.exit(0);
      }
      break;

    case 'switch-legacy':
      {
        switchToLegacy();
        console.log('✅ Switched to legacy file-based approach');
        process.exit(0);
      }
      break;

    default: {
      printHelp();
      process.exit(1);
    }
  }
}

function printHelp() {
  console.log(`
MCPHub DAO Layer Demo

Usage: node dao-demo.js <command>

Commands:
  migrate       - Migrate from legacy format to DAO layer
  validate      - Validate migration integrity
  test          - Test DAO operations with sample data
  compare       - Compare performance between legacy and DAO approaches
  report        - Generate migration report
  demo          - Run interactive demo
  switch-dao    - Switch to DAO layer
  switch-legacy - Switch to legacy file-based approach

Examples:
  node dao-demo.js migrate
  node dao-demo.js test
  node dao-demo.js compare
`);
}

async function runDemo() {
  console.log('🎭 MCPHub DAO Layer Interactive Demo');
  console.log('=====================================\n');

  try {
    // Step 1: Show current configuration
    console.log('📋 Step 1: Loading current configuration...');
    switchToLegacy();
    const legacySettings = await loadSettings();
    console.log(`Current data:
- Users: ${legacySettings.users?.length || 0}
- Servers: ${Object.keys(legacySettings.mcpServers || {}).length}
- Groups: ${legacySettings.groups?.length || 0}
- System Config Sections: ${Object.keys(legacySettings.systemConfig || {}).length}
- User Configs: ${Object.keys(legacySettings.userConfigs || {}).length}
`);

    // Step 2: Switch to DAO and show same data
    console.log('🔄 Step 2: Switching to DAO layer...');
    switchToDao();
    const daoService = getDaoConfigService();

    const daoSettings = await daoService.loadSettings();
    console.log(`DAO layer data:
- Users: ${daoSettings.users?.length || 0}
- Servers: ${Object.keys(daoSettings.mcpServers || {}).length}
- Groups: ${daoSettings.groups?.length || 0}
- System Config Sections: ${Object.keys(daoSettings.systemConfig || {}).length}
- User Configs: ${Object.keys(daoSettings.userConfigs || {}).length}
`);

    // Step 3: Demonstrate CRUD operations
    console.log('🛠️ Step 3: Demonstrating CRUD operations...');

    // Test user creation (if not exists)
    try {
      // Add demo data if needed
      if (!daoSettings.users?.length) {
        console.log('Creating demo user...');
        // Note: In practice, you'd use the UserDao directly for password hashing
        const demoSettings = {
          ...daoSettings,
          users: [
            {
              username: 'demo-user',
              password: 'hashed-password',
              isAdmin: false,
            },
          ],
        };
        await daoService.saveSettings(demoSettings);
        console.log('✅ Demo user created');
      }

      // Add demo server if needed
      if (!Object.keys(daoSettings.mcpServers || {}).length) {
        console.log('Creating demo server...');
        const demoSettings = {
          ...daoSettings,
          mcpServers: {
            'demo-server': {
              command: 'echo',
              args: ['hello'],
              enabled: true,
              owner: 'admin',
            },
          },
        };
        await daoService.saveSettings(demoSettings);
        console.log('✅ Demo server created');
      }

      // Add demo group if needed
      if (!daoSettings.groups?.length) {
        console.log('Creating demo group...');
        const demoSettings = {
          ...daoSettings,
          groups: [
            {
              id: 'demo-group-1',
              name: 'Demo Group',
              description: 'A demo group for testing',
              servers: ['demo-server'],
              owner: 'admin',
            },
          ],
        };
        await daoService.saveSettings(demoSettings);
        console.log('✅ Demo group created');
      }
    } catch (error) {
      console.log('⚠️ Some demo operations failed (this is expected for password hashing)');
      console.log('In production, you would use individual DAO methods for proper handling');
    }

    // Step 4: Show benefits
    console.log(`
🌟 Benefits of the DAO Layer:

1. 📦 Separation of Concerns
   - Data access logic is separated from business logic
   - Each data type has its own DAO with specific operations

2. 🔄 Easy Database Migration
   - Ready for switching from JSON files to database
   - Interface remains the same, implementation changes

3. 🧪 Better Testing
   - Can easily mock DAO interfaces for unit tests
   - Isolated testing of data access operations

4. 🔒 Type Safety
   - Strong typing for all data operations
   - Compile-time checking of data structure changes

5. 🚀 Enhanced Features
   - User password hashing in UserDao
   - Server filtering by owner/type in ServerDao
   - Group membership management in GroupDao
   - Section-based config updates in SystemConfigDao

6. 🏗️ Future Extensibility
   - Easy to add new data types
   - Consistent interface across all data operations
   - Support for complex queries and relationships
`);

    console.log('✅ Demo completed successfully!');
  } catch (error) {
    console.error('❌ Demo failed:', error);
  }
}

// Run the main function
if (require.main === module) {
  main().catch(console.error);
}
