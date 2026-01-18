import { loadOriginalSettings } from '../config/index.js';
import { initializeDatabase } from '../db/connection.js';
import { setDaoFactory } from '../dao/DaoFactory.js';
import { DatabaseDaoFactory } from '../dao/DatabaseDaoFactory.js';
import { UserRepository } from '../db/repositories/UserRepository.js';
import { ServerRepository } from '../db/repositories/ServerRepository.js';
import { GroupRepository } from '../db/repositories/GroupRepository.js';
import { SystemConfigRepository } from '../db/repositories/SystemConfigRepository.js';
import { UserConfigRepository } from '../db/repositories/UserConfigRepository.js';
import { OAuthClientRepository } from '../db/repositories/OAuthClientRepository.js';
import { OAuthTokenRepository } from '../db/repositories/OAuthTokenRepository.js';
import { BearerKeyRepository } from '../db/repositories/BearerKeyRepository.js';

/**
 * Migrate from file-based configuration to database
 */
export async function migrateToDatabase(): Promise<boolean> {
  try {
    console.log('Starting migration from file to database...');

    // Initialize database connection
    await initializeDatabase();
    console.log('Database connection established');

    // Load current settings from file
    const settings = loadOriginalSettings();
    console.log('Loaded settings from file');

    // Create repositories
    const userRepo = new UserRepository();
    const serverRepo = new ServerRepository();
    const groupRepo = new GroupRepository();
    const systemConfigRepo = new SystemConfigRepository();
    const userConfigRepo = new UserConfigRepository();
    const oauthClientRepo = new OAuthClientRepository();
    const oauthTokenRepo = new OAuthTokenRepository();
    const bearerKeyRepo = new BearerKeyRepository();

    // Migrate users
    if (settings.users && settings.users.length > 0) {
      console.log(`Migrating ${settings.users.length} users...`);
      for (const user of settings.users) {
        const exists = await userRepo.exists(user.username);
        if (!exists) {
          await userRepo.create({
            username: user.username,
            password: user.password,
            isAdmin: user.isAdmin || false,
          });
          console.log(`  - Created user: ${user.username}`);
        } else {
          console.log(`  - User already exists: ${user.username}`);
        }
      }
    }

    // Migrate servers
    if (settings.mcpServers) {
      const serverNames = Object.keys(settings.mcpServers);
      console.log(`Migrating ${serverNames.length} servers...`);
      for (const [name, config] of Object.entries(settings.mcpServers)) {
        const exists = await serverRepo.exists(name);
        if (!exists) {
          await serverRepo.create({
            name,
            type: config.type,
            url: config.url,
            command: config.command,
            args: config.args,
            env: config.env,
            headers: config.headers,
            enabled: config.enabled !== undefined ? config.enabled : true,
            owner: config.owner,
            enableKeepAlive: config.enableKeepAlive,
            keepAliveInterval: config.keepAliveInterval,
            tools: config.tools,
            prompts: config.prompts,
            options: config.options,
            oauth: config.oauth,
            openapi: config.openapi,
          });
          console.log(`  - Created server: ${name}`);
        } else {
          console.log(`  - Server already exists: ${name}`);
        }
      }
    }

    // Migrate groups
    if (settings.groups && settings.groups.length > 0) {
      console.log(`Migrating ${settings.groups.length} groups...`);
      for (const group of settings.groups) {
        const exists = await groupRepo.existsByName(group.name);
        if (!exists) {
          await groupRepo.create({
            name: group.name,
            description: group.description,
            servers: Array.isArray(group.servers) ? group.servers : [],
            owner: group.owner,
          });
          console.log(`  - Created group: ${group.name}`);
        } else {
          console.log(`  - Group already exists: ${group.name}`);
        }
      }
    }

    // Migrate system config
    if (settings.systemConfig) {
      console.log('Migrating system configuration...');
      const systemConfig = {
        routing: settings.systemConfig.routing || {},
        install: settings.systemConfig.install || {},
        smartRouting: settings.systemConfig.smartRouting || {},
        mcpRouter: settings.systemConfig.mcpRouter || {},
        nameSeparator: settings.systemConfig.nameSeparator,
        oauth: settings.systemConfig.oauth || {},
        oauthServer: settings.systemConfig.oauthServer || {},
        auth: settings.systemConfig.auth || {},
        enableSessionRebuild: settings.systemConfig.enableSessionRebuild,
      };
      await systemConfigRepo.update(systemConfig);
      console.log('  - System configuration updated');
    }

    // Migrate bearer auth keys
    console.log('Migrating bearer authentication keys...');

    // Prefer explicit bearerKeys if present in settings
    if (Array.isArray(settings.bearerKeys) && settings.bearerKeys.length > 0) {
      for (const key of settings.bearerKeys) {
        await bearerKeyRepo.create({
          name: key.name,
          token: key.token,
          enabled: key.enabled,
          accessType: key.accessType,
          allowedGroups: key.allowedGroups ?? [],
          allowedServers: key.allowedServers ?? [],
        } as any);
        console.log(`  - Migrated bearer key: ${key.name} (${key.id ?? 'no-id'})`);
      }
    } else if (settings.systemConfig?.routing) {
      // Fallback to legacy routing.enableBearerAuth / bearerAuthKey
      const routing = settings.systemConfig.routing as any;
      const enableBearerAuth: boolean = !!routing.enableBearerAuth;
      const rawKey: string = (routing.bearerAuthKey || '').trim();

      // Migration rules:
      // 1) enable=false, key empty   -> no keys
      // 2) enable=false, key present -> one disabled key (name=default)
      // 3) enable=true, key present  -> one enabled key (name=default)
      // 4) enable=true, key empty    -> no keys
      if (rawKey) {
        await bearerKeyRepo.create({
          name: 'default',
          token: rawKey,
          enabled: enableBearerAuth,
          accessType: 'all',
          allowedGroups: [],
          allowedServers: [],
        } as any);
        console.log(
          `  - Migrated legacy bearer auth config to key: default (enabled=${enableBearerAuth})`,
        );
      } else {
        console.log('  - No legacy bearer auth key found, skipping bearer key migration');
      }
    } else {
      console.log('  - No bearer auth configuration found, skipping bearer key migration');
    }

    // Migrate user configs
    if (settings.userConfigs) {
      const usernames = Object.keys(settings.userConfigs);
      console.log(`Migrating ${usernames.length} user configurations...`);
      for (const [username, config] of Object.entries(settings.userConfigs)) {
        const userConfig = {
          routing: config.routing || {},
          additionalConfig: config,
        };
        await userConfigRepo.update(username, userConfig);
        console.log(`  - Updated configuration for user: ${username}`);
      }
    }

    // Migrate OAuth clients
    if (settings.oauthClients && settings.oauthClients.length > 0) {
      console.log(`Migrating ${settings.oauthClients.length} OAuth clients...`);
      for (const client of settings.oauthClients) {
        const exists = await oauthClientRepo.exists(client.clientId);
        if (!exists) {
          await oauthClientRepo.create({
            clientId: client.clientId,
            clientSecret: client.clientSecret,
            name: client.name,
            redirectUris: client.redirectUris,
            grants: client.grants,
            scopes: client.scopes,
            owner: client.owner,
            metadata: client.metadata,
          });
          console.log(`  - Created OAuth client: ${client.clientId}`);
        } else {
          console.log(`  - OAuth client already exists: ${client.clientId}`);
        }
      }
    }

    // Migrate OAuth tokens
    if (settings.oauthTokens && settings.oauthTokens.length > 0) {
      console.log(`Migrating ${settings.oauthTokens.length} OAuth tokens...`);
      for (const token of settings.oauthTokens) {
        const exists = await oauthTokenRepo.exists(token.accessToken);
        if (!exists) {
          await oauthTokenRepo.create({
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            accessTokenExpiresAt: new Date(token.accessTokenExpiresAt),
            refreshTokenExpiresAt: token.refreshTokenExpiresAt
              ? new Date(token.refreshTokenExpiresAt)
              : undefined,
            scope: token.scope,
            clientId: token.clientId,
            username: token.username,
          });
          console.log(`  - Created OAuth token for client: ${token.clientId}`);
        } else {
          console.log(`  - OAuth token already exists: ${token.accessToken.substring(0, 8)}...`);
        }
      }
    }

    console.log('✅ Migration completed successfully');
    return true;
  } catch (error) {
    console.error('❌ Migration failed:', error);
    return false;
  }
}

/**
 * Initialize database mode
 * This function should be called during application startup when USE_DB=true
 */
export async function initializeDatabaseMode(): Promise<boolean> {
  try {
    console.log('Initializing database mode...');

    // Initialize database connection
    await initializeDatabase();
    console.log('Database connection established');

    // Switch to database factory
    setDaoFactory(DatabaseDaoFactory.getInstance());
    console.log('Switched to database-backed DAO implementations');

    // Check if migration is needed
    const userRepo = new UserRepository();
    const bearerKeyRepo = new BearerKeyRepository();
    const systemConfigRepo = new SystemConfigRepository();

    const userCount = await userRepo.count();

    if (userCount === 0) {
      console.log('No users found in database, running migration...');
      const migrated = await migrateToDatabase();
      if (!migrated) {
        throw new Error('Migration failed');
      }
    } else {
      console.log(`Database already contains ${userCount} users, skipping migration`);

      // One-time migration for legacy bearer auth config stored inside DB routing settings.
      // If bearerKeys table already has data, do nothing.
      const bearerKeyCount = await bearerKeyRepo.count();
      if (bearerKeyCount > 0) {
        console.log(
          `Bearer keys table already contains ${bearerKeyCount} keys, skipping legacy bearer auth migration`,
        );
      } else {
        const systemConfig = await systemConfigRepo.get();
        const routing = (systemConfig as any)?.routing || {};
        const enableBearerAuth: boolean = !!routing.enableBearerAuth;
        const rawKey: string = (routing.bearerAuthKey || '').trim();

        if (rawKey) {
          await bearerKeyRepo.create({
            name: 'default',
            token: rawKey,
            enabled: enableBearerAuth,
            accessType: 'all',
            allowedGroups: [],
            allowedServers: [],
          } as any);
          console.log(
            `  - Migrated legacy DB routing bearer auth config to key: default (enabled=${enableBearerAuth})`,
          );
        } else {
          console.log('No legacy DB routing bearer auth key found, skipping bearer key migration');
        }
      }
    }

    console.log('✅ Database mode initialized successfully');
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize database mode:', error);
    return false;
  }
}

/**
 * CLI tool for migration
 */
export async function runMigrationCli(): Promise<void> {
  console.log('MCPHub Configuration Migration Tool');
  console.log('====================================\n');

  const success = await migrateToDatabase();

  if (success) {
    console.log('\n✅ Migration completed successfully!');
    console.log('You can now set USE_DB=true to use database-backed configuration');
    process.exit(0);
  } else {
    console.log('\n❌ Migration failed!');
    process.exit(1);
  }
}
