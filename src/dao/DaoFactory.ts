import { UserDao, UserDaoImpl } from './UserDao.js';
import { ServerDao, ServerDaoImpl } from './ServerDao.js';
import { GroupDao, GroupDaoImpl } from './GroupDao.js';
import { SystemConfigDao, SystemConfigDaoImpl } from './SystemConfigDao.js';
import { UserConfigDao, UserConfigDaoImpl } from './UserConfigDao.js';

/**
 * DAO Factory interface for creating DAO instances
 */
export interface DaoFactory {
  getUserDao(): UserDao;
  getServerDao(): ServerDao;
  getGroupDao(): GroupDao;
  getSystemConfigDao(): SystemConfigDao;
  getUserConfigDao(): UserConfigDao;
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

  /**
   * Reset all cached DAO instances (useful for testing)
   */
  public resetInstances(): void {
    this.userDao = null;
    this.serverDao = null;
    this.groupDao = null;
    this.systemConfigDao = null;
    this.userConfigDao = null;
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
