import {
  DaoFactory,
  UserDao,
  ServerDao,
  GroupDao,
  SystemConfigDao,
  UserConfigDao,
  OAuthClientDao,
  OAuthTokenDao,
  BearerKeyDao,
} from './index.js';
import { UserDaoDbImpl } from './UserDaoDbImpl.js';
import { ServerDaoDbImpl } from './ServerDaoDbImpl.js';
import { GroupDaoDbImpl } from './GroupDaoDbImpl.js';
import { SystemConfigDaoDbImpl } from './SystemConfigDaoDbImpl.js';
import { UserConfigDaoDbImpl } from './UserConfigDaoDbImpl.js';
import { OAuthClientDaoDbImpl } from './OAuthClientDaoDbImpl.js';
import { OAuthTokenDaoDbImpl } from './OAuthTokenDaoDbImpl.js';
import { BearerKeyDaoDbImpl } from './BearerKeyDaoDbImpl.js';

/**
 * Database-backed DAO factory implementation
 */
export class DatabaseDaoFactory implements DaoFactory {
  private static instance: DatabaseDaoFactory;

  private userDao: UserDao | null = null;
  private serverDao: ServerDao | null = null;
  private groupDao: GroupDao | null = null;
  private systemConfigDao: SystemConfigDao | null = null;
  private userConfigDao: UserConfigDao | null = null;
  private oauthClientDao: OAuthClientDao | null = null;
  private oauthTokenDao: OAuthTokenDao | null = null;
  private bearerKeyDao: BearerKeyDao | null = null;

  /**
   * Get singleton instance
   */
  public static getInstance(): DatabaseDaoFactory {
    if (!DatabaseDaoFactory.instance) {
      DatabaseDaoFactory.instance = new DatabaseDaoFactory();
    }
    return DatabaseDaoFactory.instance;
  }

  private constructor() {
    // Private constructor for singleton
  }

  getUserDao(): UserDao {
    if (!this.userDao) {
      this.userDao = new UserDaoDbImpl();
    }
    return this.userDao!;
  }

  getServerDao(): ServerDao {
    if (!this.serverDao) {
      this.serverDao = new ServerDaoDbImpl();
    }
    return this.serverDao!;
  }

  getGroupDao(): GroupDao {
    if (!this.groupDao) {
      this.groupDao = new GroupDaoDbImpl();
    }
    return this.groupDao!;
  }

  getSystemConfigDao(): SystemConfigDao {
    if (!this.systemConfigDao) {
      this.systemConfigDao = new SystemConfigDaoDbImpl();
    }
    return this.systemConfigDao!;
  }

  getUserConfigDao(): UserConfigDao {
    if (!this.userConfigDao) {
      this.userConfigDao = new UserConfigDaoDbImpl();
    }
    return this.userConfigDao!;
  }

  getOAuthClientDao(): OAuthClientDao {
    if (!this.oauthClientDao) {
      this.oauthClientDao = new OAuthClientDaoDbImpl();
    }
    return this.oauthClientDao!;
  }

  getOAuthTokenDao(): OAuthTokenDao {
    if (!this.oauthTokenDao) {
      this.oauthTokenDao = new OAuthTokenDaoDbImpl();
    }
    return this.oauthTokenDao!;
  }

  getBearerKeyDao(): BearerKeyDao {
    if (!this.bearerKeyDao) {
      this.bearerKeyDao = new BearerKeyDaoDbImpl();
    }
    return this.bearerKeyDao!;
  }

  /**
   * Reset all cached DAO instances (useful for testing)
   */
  public resetInstances(): void {
    this.userDao = null;
    this.serverDao = null;
    this.groupDao = null;
    this.systemConfigDao = null;
    this.userConfigDao = null;
    this.oauthClientDao = null;
    this.oauthTokenDao = null;
    this.bearerKeyDao = null;
  }
}
