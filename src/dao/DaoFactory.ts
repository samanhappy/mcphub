import { UserDao, UserDaoImpl } from './UserDao.js';
import { ServerDao, ServerDaoImpl } from './ServerDao.js';
import { GroupDao, GroupDaoImpl } from './GroupDao.js';
import { SystemConfigDao, SystemConfigDaoImpl } from './SystemConfigDao.js';
import { UserConfigDao, UserConfigDaoImpl } from './UserConfigDao.js';
import { OAuthClientDao, OAuthClientDaoImpl } from './OAuthClientDao.js';
import { OAuthTokenDao, OAuthTokenDaoImpl } from './OAuthTokenDao.js';
import { BearerKeyDao, BearerKeyDaoImpl } from './BearerKeyDao.js';

/**
 * DAO Factory interface for creating DAO instances
 */
export interface DaoFactory {
  getUserDao(): UserDao;
  getServerDao(): ServerDao;
  getGroupDao(): GroupDao;
  getSystemConfigDao(): SystemConfigDao;
  getUserConfigDao(): UserConfigDao;
  getOAuthClientDao(): OAuthClientDao;
  getOAuthTokenDao(): OAuthTokenDao;
  getBearerKeyDao(): BearerKeyDao;
}

/**
 * Default DAO factory implementation using JSON file-based DAOs
 */
export class JsonFileDaoFactory implements DaoFactory {
  private static instance: JsonFileDaoFactory;

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
  public static getInstance(): JsonFileDaoFactory {
    if (!JsonFileDaoFactory.instance) {
      JsonFileDaoFactory.instance = new JsonFileDaoFactory();
    }
    return JsonFileDaoFactory.instance;
  }

  private constructor() {
    // Private constructor for singleton
  }

  getUserDao(): UserDao {
    if (!this.userDao) {
      this.userDao = new UserDaoImpl();
    }
    return this.userDao;
  }

  getServerDao(): ServerDao {
    if (!this.serverDao) {
      this.serverDao = new ServerDaoImpl();
    }
    return this.serverDao;
  }

  getGroupDao(): GroupDao {
    if (!this.groupDao) {
      this.groupDao = new GroupDaoImpl();
    }
    return this.groupDao;
  }

  getSystemConfigDao(): SystemConfigDao {
    if (!this.systemConfigDao) {
      this.systemConfigDao = new SystemConfigDaoImpl();
    }
    return this.systemConfigDao;
  }

  getUserConfigDao(): UserConfigDao {
    if (!this.userConfigDao) {
      this.userConfigDao = new UserConfigDaoImpl();
    }
    return this.userConfigDao;
  }

  getOAuthClientDao(): OAuthClientDao {
    if (!this.oauthClientDao) {
      this.oauthClientDao = new OAuthClientDaoImpl();
    }
    return this.oauthClientDao;
  }

  getOAuthTokenDao(): OAuthTokenDao {
    if (!this.oauthTokenDao) {
      this.oauthTokenDao = new OAuthTokenDaoImpl();
    }
    return this.oauthTokenDao;
  }

  getBearerKeyDao(): BearerKeyDao {
    if (!this.bearerKeyDao) {
      this.bearerKeyDao = new BearerKeyDaoImpl();
    }
    return this.bearerKeyDao;
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

/**
 * Global DAO factory instance
 */
let daoFactory: DaoFactory = JsonFileDaoFactory.getInstance();

/**
 * Set the global DAO factory (useful for dependency injection)
 */
export function setDaoFactory(factory: DaoFactory): void {
  daoFactory = factory;
}

/**
 * Get the global DAO factory
 */
export function getDaoFactory(): DaoFactory {
  return daoFactory;
}

/**
 * Switch to database-backed DAOs based on environment variable
 * This is synchronous and should be called during app initialization
 */
export function initializeDaoFactory(): void {
  // If USE_DB is explicitly set, use its value; otherwise, auto-detect based on DB_URL presence
  const useDatabase =
    process.env.USE_DB !== undefined ? process.env.USE_DB === 'true' : !!process.env.DB_URL;
  if (useDatabase) {
    console.log('Using database-backed DAO implementations');
    // Dynamic import to avoid circular dependencies
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const DatabaseDaoFactoryModule = require('./DatabaseDaoFactory.js');
    setDaoFactory(DatabaseDaoFactoryModule.DatabaseDaoFactory.getInstance());
  } else {
    console.log('Using file-based DAO implementations');
    setDaoFactory(JsonFileDaoFactory.getInstance());
  }
}

/**
 * Convenience functions to get specific DAOs
 */
export function getUserDao(): UserDao {
  return getDaoFactory().getUserDao();
}

export function getServerDao(): ServerDao {
  return getDaoFactory().getServerDao();
}

export function getGroupDao(): GroupDao {
  return getDaoFactory().getGroupDao();
}

export function getSystemConfigDao(): SystemConfigDao {
  return getDaoFactory().getSystemConfigDao();
}

export function getUserConfigDao(): UserConfigDao {
  return getDaoFactory().getUserConfigDao();
}

export function getOAuthClientDao(): OAuthClientDao {
  return getDaoFactory().getOAuthClientDao();
}

export function getOAuthTokenDao(): OAuthTokenDao {
  return getDaoFactory().getOAuthTokenDao();
}

export function getBearerKeyDao(): BearerKeyDao {
  return getDaoFactory().getBearerKeyDao();
}
