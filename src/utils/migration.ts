import { legacyServerId } from './serverIdentity.js';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import { toStoredToken } from './bearerKeyToken.js';
import { assertSmartRoutingSettingsAvailable } from './smartRoutingPath.js';
import { syncSettingsToDatabase } from './settingsSync.js';
import { migrateCredentialBindings } from './credentialBindingMigration.js';
import { getSettingsPath, loadOriginalSettings } from '../config/index.js';
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
import { BuiltinPromptRepository } from '../db/repositories/BuiltinPromptRepository.js';
import { BuiltinResourceRepository } from '../db/repositories/BuiltinResourceRepository.js';
import { logger } from './logger.js';

/**
 * Replace usable bearer tokens left in the source settings file with their hashed form
 * (the format file mode already uses). Never fails the migration: the database copy is done.
 */
function scrubSourceFileSecrets(): void {
  let settingsPath = '';
  try {
    settingsPath = getSettingsPath();
    const raw = JSON.parse(fs.readFileSync(settingsPath, 'utf8').replace(/^\uFEFF/, ''));
    const routing = raw.systemConfig?.routing;
    const legacyKey: string = (routing?.bearerAuthKey || '').trim();
    const hasRawKeys =
      Array.isArray(raw.bearerKeys) && raw.bearerKeys.some((k: any) => k.token && !k.tokenHash);
    if (!hasRawKeys && !routing?.bearerAuthKey) return;

    // an existing array (even empty) is authoritative, as in BearerKeyDaoImpl.loadKeysWithMigration()
    if (Array.isArray(raw.bearerKeys)) {
      for (const key of raw.bearerKeys) {
        if (key.token && !key.tokenHash) {
          Object.assign(key, toStoredToken(key.token));
          delete key.token;
        }
      }
    } else if (legacyKey) {
      // same conversion as the file DAO's legacy migration
      raw.bearerKeys = [
        {
          id: randomUUID(),
          name: 'default',
          ...toStoredToken(legacyKey),
          enabled: !!routing.enableBearerAuth,
          kind: 'system',
          accessType: 'all',
          allowedGroups: [],
          allowedServers: [],
        },
      ];
    }
    if (routing) routing.bearerAuthKey = '';
    fs.writeFileSync(settingsPath, JSON.stringify(raw, null, 2), 'utf8');
    logger.log('  - Replaced plaintext bearer tokens in the source settings file with hashes');
  } catch (error) {
    logger.warn(
      `Migration succeeded, but plaintext bearer tokens may remain in ${settingsPath || 'the settings file'} ` +
        `(could not rewrite it: ${error instanceof Error ? error.message : error}). Remove them manually.`,
    );
  }
}

/**
 * Migrate from file-based configuration to database
 */
export async function migrateToDatabase(seedServersAndGroups = true): Promise<boolean> {
  try {
    logger.log('Starting migration from file to database...');

    // Initialize database connection
    await initializeDatabase();
    logger.log('Database connection established');

    // Validate/import credentials before any configuration writes.
    await migrateCredentialBindings();

    // Load current settings from file
    const settings = loadOriginalSettings(
      !['upsert', 'prune'].includes(process.env.MCPHUB_SETTINGS_SYNC ?? ''),
    );
    logger.log('Loaded settings from file');
    if (seedServersAndGroups) assertSmartRoutingSettingsAvailable(settings);

    // Create repositories
    const userRepo = new UserRepository();
    const serverRepo = new ServerRepository();
    const groupRepo = new GroupRepository();
    const systemConfigRepo = new SystemConfigRepository();
    const userConfigRepo = new UserConfigRepository();
    const oauthClientRepo = new OAuthClientRepository();
    const oauthTokenRepo = new OAuthTokenRepository();
    const bearerKeyRepo = new BearerKeyRepository();
    const builtinPromptRepo = new BuiltinPromptRepository();
    const builtinResourceRepo = new BuiltinResourceRepository();

    // Migrate users
    if (settings.users && settings.users.length > 0) {
      logger.log(`Migrating ${settings.users.length} users...`);
      for (const user of settings.users) {
        const exists = await userRepo.exists(user.username);
        if (!exists) {
          await userRepo.create({
            username: user.username,
            password: user.password,
            isAdmin: user.isAdmin || false,
            email: user.email ?? null,
            ssoUserId: (user as any).ssoUserId ?? null,
          });
          logger.log(`  - Created user: ${user.username}`);
        } else {
          logger.log(`  - User already exists: ${user.username}`);
        }
      }
    }

    // Startup sync owns these declarations and applies them in one transaction.
    if (seedServersAndGroups && settings.mcpServers) {
      const serverNames = Object.keys(settings.mcpServers);
      logger.log(`Migrating ${serverNames.length} servers...`);
      for (const [name, config] of Object.entries(settings.mcpServers)) {
        const exists = await serverRepo.exists(name);
        if (!exists) {
          // startOnDemand/idleTimeoutMs have no dedicated DB columns and must be
          // mirrored into the schema-less `options` blob (see
          // serverConfigPersistence.ts / ServerDaoDbImpl.ts), otherwise a JSON-mode
          // user who already configured on-demand servers silently loses that
          // setting the moment they migrate to the database.
          const options = {
            ...(config.options ?? {}),
            ...(config.startOnDemand === true ? { startOnDemand: true } : {}),
            ...(typeof config.idleTimeoutMs === 'number' && config.idleTimeoutMs > 0
              ? { idleTimeoutMs: config.idleTimeoutMs }
              : {}),
          };

          await serverRepo.create({
            id: config.id ?? legacyServerId(name),
            name,
            type: config.type,
            description: config.description,
            url: config.url,
            command: config.command,
            args: config.args,
            env: config.env,
            headers: config.headers,
            enabled: config.enabled !== undefined ? config.enabled : true,
            owner: config.owner,
            visibility: config.visibility ?? 'private',
            sharedWithUsers: config.sharedWithUsers,
            enableKeepAlive: config.enableKeepAlive,
            protocolNegotiation: config.protocolNegotiation,
            keepAliveInterval: config.keepAliveInterval,
            tools: config.tools,
            prompts: config.prompts,
            resources: config.resources,
            options: Object.keys(options).length > 0 ? options : config.options,
            oauth: config.oauth,
            openapi: config.openapi,
            passthroughHeaders: config.passthroughHeaders,
            perSessionClient: config.perSessionClient,
            credentialTemplate: config.credentialTemplate,
          });
          logger.log(`  - Created server: ${name}`);
        } else {
          logger.log(`  - Server already exists: ${name}`);
        }
      }
    }

    // Migrate groups
    if (seedServersAndGroups && settings.groups && settings.groups.length > 0) {
      logger.log(`Migrating ${settings.groups.length} groups...`);
      for (const group of settings.groups) {
        const exists = await groupRepo.existsByName(group.name);
        if (!exists) {
          await groupRepo.create({
            name: group.name,
            description: group.description,
            instructions: group.instructions,
            servers: Array.isArray(group.servers) ? group.servers : [],
            owner: group.owner,
            visibility: group.visibility,
            sharedWithUsers: group.sharedWithUsers,
          });
          logger.log(`  - Created group: ${group.name}`);
        } else {
          logger.log(`  - Group already exists: ${group.name}`);
        }
      }
    }

    // Migrate system config
    if (settings.systemConfig) {
      logger.log('Migrating system configuration...');
      const systemConfig = {
        toolPolicies: settings.systemConfig.toolPolicies,
        network: settings.systemConfig.network || {},
        // the legacy bearerAuthKey is migrated to a hashed bearer key below
        routing: { ...settings.systemConfig.routing, bearerAuthKey: '' },
        install: settings.systemConfig.install || {},
        smartRouting: settings.systemConfig.smartRouting || {},
        toolResultCompression: settings.systemConfig.toolResultCompression || {},
        mcpRouter: settings.systemConfig.mcpRouter || {},
        nameSeparator: settings.systemConfig.nameSeparator,
        oauth: settings.systemConfig.oauth || {},
        oauthServer: settings.systemConfig.oauthServer || {},
        auth: settings.systemConfig.auth || {},
        enableSessionRebuild: settings.systemConfig.enableSessionRebuild,
        discovery: settings.systemConfig.discovery || {},
      };
      await systemConfigRepo.update(systemConfig);
      logger.log('  - System configuration updated');
    }

    // Migrate bearer auth keys
    logger.log('Migrating bearer authentication keys...');

    // An existing bearerKeys array (even empty) is authoritative, as in BearerKeyDaoImpl.loadKeysWithMigration()
    if (Array.isArray(settings.bearerKeys)) {
      for (const key of settings.bearerKeys) {
        await bearerKeyRepo.create({
          name: key.name,
          // Keys created by a hashing-aware version only carry tokenHash/tokenPrefix
          ...(key.tokenHash
            ? { tokenHash: key.tokenHash, tokenPrefix: key.tokenPrefix }
            : { token: key.token }),
          enabled: key.enabled,
          kind: key.kind ?? 'system',
          owner: key.owner,
          accessType: key.accessType,
          allowedGroups: key.allowedGroups ?? [],
          allowedServers: key.allowedServers ?? [],
        } as any);
        logger.log(`  - Migrated bearer key: ${key.name} (${key.id ?? 'no-id'})`);
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
          kind: 'system',
          accessType: 'all',
          allowedGroups: [],
          allowedServers: [],
        } as any);
        logger.log(
          `  - Migrated legacy bearer auth config to key: default (enabled=${enableBearerAuth})`,
        );
      } else {
        logger.log('  - No legacy bearer auth key found, skipping bearer key migration');
      }
    } else {
      logger.log('  - No bearer auth configuration found, skipping bearer key migration');
    }

    // Migrate user configs
    if (settings.userConfigs) {
      const usernames = Object.keys(settings.userConfigs);
      logger.log(`Migrating ${usernames.length} user configurations...`);
      for (const [username, config] of Object.entries(settings.userConfigs)) {
        const userConfig = {
          routing: config.routing || {},
          additionalConfig: config,
        };
        await userConfigRepo.update(username, userConfig);
        logger.log(`  - Updated configuration for user: ${username}`);
      }
    }

    // Migrate OAuth clients
    if (settings.oauthClients && settings.oauthClients.length > 0) {
      logger.log(`Migrating ${settings.oauthClients.length} OAuth clients...`);
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
            clientIdIssuedAt: client.clientIdIssuedAt,
            metadata: client.metadata,
          });
          logger.log(`  - Created OAuth client: ${client.clientId}`);
        } else {
          logger.log(`  - OAuth client already exists: ${client.clientId}`);
        }
      }
    }

    // Migrate OAuth tokens
    if (settings.oauthTokens && settings.oauthTokens.length > 0) {
      logger.log(`Migrating ${settings.oauthTokens.length} OAuth tokens...`);
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
            sessionVersion: token.sessionVersion,
          });
          logger.log(`  - Created OAuth token for client: ${token.clientId}`);
        } else {
          logger.log(`  - OAuth token already exists: ${token.accessToken.substring(0, 8)}...`);
        }
      }
    }

    // Migrate built-in prompts
    if (settings.prompts && settings.prompts.length > 0) {
      logger.log(`Migrating ${settings.prompts.length} built-in prompts...`);
      for (const prompt of settings.prompts) {
        const exists = await builtinPromptRepo.findByName(prompt.name);
        if (!exists) {
          await builtinPromptRepo.create({
            name: prompt.name,
            title: prompt.title,
            description: prompt.description,
            template: prompt.template,
            arguments: prompt.arguments,
            enabled: prompt.enabled !== false,
          } as any);
          logger.log(`  - Created built-in prompt: ${prompt.name}`);
        } else {
          logger.log(`  - Built-in prompt already exists: ${prompt.name}`);
        }
      }
    }

    // Migrate built-in resources
    if (settings.resources && settings.resources.length > 0) {
      logger.log(`Migrating ${settings.resources.length} built-in resources...`);
      for (const resource of settings.resources) {
        const exists = await builtinResourceRepo.findByUri(resource.uri);
        if (!exists) {
          await builtinResourceRepo.create({
            uri: resource.uri,
            name: resource.name,
            description: resource.description,
            mimeType: resource.mimeType,
            content: resource.content,
            enabled: resource.enabled !== false,
          } as any);
          logger.log(`  - Created built-in resource: ${resource.uri}`);
        } else {
          logger.log(`  - Built-in resource already exists: ${resource.uri}`);
        }
      }
    }

    scrubSourceFileSecrets();

    logger.log('✅ Migration completed successfully');
    return true;
  } catch (error) {
    logger.error('❌ Migration failed:', error);
    return false;
  }
}

/**
 * Initialize database mode
 * This function should be called during application startup when USE_DB=true
 */
export async function initializeDatabaseMode(): Promise<boolean> {
  try {
    logger.log('Initializing database mode...');

    // Initialize database connection
    await initializeDatabase();
    logger.log('Database connection established');

    // Switch to database factory
    setDaoFactory(DatabaseDaoFactory.getInstance());
    logger.log('Switched to database-backed DAO implementations');

    // Check if migration is needed
    const userRepo = new UserRepository();
    const bearerKeyRepo = new BearerKeyRepository();
    const systemConfigRepo = new SystemConfigRepository();

    const userCount = await userRepo.count();

    if (userCount === 0) {
      logger.log('No users found in database, running migration...');
      const migrated = await migrateToDatabase(
        !['upsert', 'prune'].includes(process.env.MCPHUB_SETTINGS_SYNC ?? ''),
      );
      if (!migrated) {
        throw new Error('Migration failed');
      }
    } else {
      logger.log(`Database already contains ${userCount} users, skipping configuration migration`);
      await migrateCredentialBindings();

      // One-time migration for legacy bearer auth config stored inside DB routing settings.
      // If bearerKeys table already has data, do nothing.
      const bearerKeyCount = await bearerKeyRepo.count();
      if (bearerKeyCount > 0) {
        logger.log(
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
            kind: 'system',
            accessType: 'all',
            allowedGroups: [],
            allowedServers: [],
          } as any);
          await systemConfigRepo.updateSection('routing', { ...routing, bearerAuthKey: '' });
          logger.log(
            `  - Migrated legacy DB routing bearer auth config to key: default (enabled=${enableBearerAuth})`,
          );
        } else {
          logger.log('No legacy DB routing bearer auth key found, skipping bearer key migration');
        }
      }
    }

    await syncSettingsToDatabase();

    logger.log('✅ Database mode initialized successfully');
    return true;
  } catch (error) {
    logger.error('❌ Failed to initialize database mode:', error);
    return false;
  }
}

/**
 * CLI tool for migration
 */
export async function runMigrationCli(): Promise<void> {
  logger.log('MCPHub Configuration Migration Tool');
  logger.log('====================================\n');

  const success = await migrateToDatabase();

  if (success) {
    logger.log('\n✅ Migration completed successfully!');
    logger.log('You can now set USE_DB=true to use database-backed configuration');
    process.exit(0);
  } else {
    logger.log('\n❌ Migration failed!');
    process.exit(1);
  }
}
