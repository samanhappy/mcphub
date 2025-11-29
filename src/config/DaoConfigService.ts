import { McpSettings, IUser, ServerConfig } from '../types/index.js';
import {
  UserDao,
  ServerDao,
  GroupDao,
  SystemConfigDao,
  UserConfigDao,
  ServerConfigWithName,
  getUserDao,
  getServerDao,
  getGroupDao,
  getSystemConfigDao,
  getUserConfigDao,
} from '../dao/index.js';

/**
 * Configuration service using DAO layer
 */
export class DaoConfigService {
  constructor(
    private userDao: UserDao,
    private serverDao: ServerDao,
    private groupDao: GroupDao,
    private systemConfigDao: SystemConfigDao,
    private userConfigDao: UserConfigDao,
  ) {}

  /**
   * Load complete settings using DAO layer
   */
  async loadSettings(user?: IUser): Promise<McpSettings> {
    const [users, servers, groups, systemConfig, userConfigs] = await Promise.all([
      this.userDao.findAll(),
      this.serverDao.findAll(),
      this.groupDao.findAll(),
      this.systemConfigDao.get(),
      this.userConfigDao.getAll(),
    ]);

    // Convert servers back to the original format
    const mcpServers: { [key: string]: ServerConfig } = {};
    for (const server of servers) {
      const { name, ...config } = server;
      mcpServers[name] = config;
    }

    const settings: McpSettings = {
      users,
      mcpServers,
      groups,
      systemConfig,
      userConfigs,
    };

    // Apply user-specific filtering if needed
    if (user && !user.isAdmin) {
      return this.filterSettingsForUser(settings, user);
    }

    return settings;
  }

  /**
   * Save settings using DAO layer
   */
  async saveSettings(settings: McpSettings, user?: IUser): Promise<boolean> {
    try {
      // If user is not admin, merge with existing settings
      if (user && !user.isAdmin) {
        const currentSettings = await this.loadSettings();
        settings = this.mergeSettingsForUser(currentSettings, settings, user);
      }

      // Save each component using respective DAOs
      const promises: Promise<any>[] = [];

      // Save users
      if (settings.users) {
        // Note: For users, we need to handle creation/updates separately
        // since passwords might need hashing
        // This is a simplified approach - in practice, you'd want more sophisticated handling
        const currentUsers = await this.userDao.findAll();
        for (const user of settings.users) {
          const existing = currentUsers.find((u: IUser) => u.username === user.username);
          if (existing) {
            promises.push(this.userDao.update(user.username, user));
          } else {
            // For new users, we'd need to handle password hashing properly
            // This is a placeholder - actual implementation would use createWithHashedPassword
            console.warn('Creating new user requires special handling for password hashing');
          }
        }
      }

      // Save servers
      if (settings.mcpServers) {
        const currentServers = await this.serverDao.findAll();
        const currentServerNames = new Set(currentServers.map((s: ServerConfigWithName) => s.name));

        for (const [name, config] of Object.entries(settings.mcpServers)) {
          const serverWithName: ServerConfigWithName = { name, ...config };
          if (currentServerNames.has(name)) {
            promises.push(this.serverDao.update(name, serverWithName));
          } else {
            promises.push(this.serverDao.create(serverWithName));
          }
        }

        // Remove servers that are no longer in the settings
        for (const existingServer of currentServers) {
          if (!settings.mcpServers[existingServer.name]) {
            promises.push(this.serverDao.delete(existingServer.name));
          }
        }
      }

      // Save groups
      if (settings.groups) {
        const currentGroups = await this.groupDao.findAll();
        const currentGroupIds = new Set(currentGroups.map((g: any) => g.id));

        for (const group of settings.groups) {
          if (group.id && currentGroupIds.has(group.id)) {
            promises.push(this.groupDao.update(group.id, group));
          } else {
            promises.push(this.groupDao.create(group));
          }
        }

        // Remove groups that are no longer in the settings
        const newGroupIds = new Set(settings.groups.map((g) => g.id).filter(Boolean));
        for (const existingGroup of currentGroups) {
          if (!newGroupIds.has(existingGroup.id)) {
            promises.push(this.groupDao.delete(existingGroup.id));
          }
        }
      }

      // Save system config
      if (settings.systemConfig) {
        promises.push(this.systemConfigDao.update(settings.systemConfig));
      }

      // Save user configs
      if (settings.userConfigs) {
        for (const [username, config] of Object.entries(settings.userConfigs)) {
          promises.push(this.userConfigDao.update(username, config));
        }
      }

      await Promise.all(promises);
      return true;
    } catch (error) {
      console.error('Failed to save settings using DAO layer:', error);
      return false;
    }
  }

  /**
   * Filter settings for non-admin users
   */
  private filterSettingsForUser(settings: McpSettings, user: IUser): McpSettings {
    if (user.isAdmin) {
      return settings;
    }

    // Non-admin users can only see their own servers and groups
    const filteredServers: { [key: string]: ServerConfig } = {};
    for (const [name, config] of Object.entries(settings.mcpServers || {})) {
      if (config.owner === user.username || config.owner === undefined) {
        filteredServers[name] = config;
      }
    }

    const filteredGroups = (settings.groups || []).filter(
      (group) => group.owner === user.username || group.owner === undefined,
    );

    return {
      ...settings,
      mcpServers: filteredServers,
      groups: filteredGroups,
      users: [], // Non-admin users can't see user list
      systemConfig: {}, // Non-admin users can't see system config
      userConfigs: { [user.username]: settings.userConfigs?.[user.username] || {} },
    };
  }

  /**
   * Merge settings for non-admin users
   */
  private mergeSettingsForUser(
    currentSettings: McpSettings,
    newSettings: McpSettings,
    user: IUser,
  ): McpSettings {
    if (user.isAdmin) {
      return newSettings;
    }

    // Non-admin users can only modify their own servers, groups, and user config
    const mergedSettings = { ...currentSettings };

    // Merge servers (only user's own servers)
    if (newSettings.mcpServers) {
      for (const [name, config] of Object.entries(newSettings.mcpServers)) {
        const existingConfig = currentSettings.mcpServers?.[name];
        if (!existingConfig || existingConfig.owner === user.username) {
          mergedSettings.mcpServers = mergedSettings.mcpServers || {};
          mergedSettings.mcpServers[name] = { ...config, owner: user.username };
        }
      }
    }

    // Merge groups (only user's own groups)
    if (newSettings.groups) {
      const userGroups = newSettings.groups
        .filter((group) => !group.owner || group.owner === user.username)
        .map((group) => ({ ...group, owner: user.username }));

      const otherGroups = (currentSettings.groups || []).filter(
        (group) => group.owner !== user.username,
      );

      mergedSettings.groups = [...otherGroups, ...userGroups];
    }

    // Merge user config (only user's own config)
    if (newSettings.userConfigs?.[user.username]) {
      mergedSettings.userConfigs = mergedSettings.userConfigs || {};
      mergedSettings.userConfigs[user.username] = newSettings.userConfigs[user.username];
    }

    return mergedSettings;
  }

  /**
   * Clear all caches
   */
  async clearCache(): Promise<void> {
    // DAO implementations handle their own caching
    // This could be extended to clear DAO-level caches if needed
  }

  /**
   * Get cache info for debugging
   */
  getCacheInfo(): { hasCache: boolean } {
    // DAO implementations handle their own caching
    return { hasCache: false };
  }
}

/**
 * Create a DaoConfigService with DAO implementations from factory
 */
export function createDaoConfigService(): DaoConfigService {
  return new DaoConfigService(
    getUserDao(),
    getServerDao(),
    getGroupDao(),
    getSystemConfigDao(),
    getUserConfigDao(),
  );
}
