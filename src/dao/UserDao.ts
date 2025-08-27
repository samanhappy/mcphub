import { IUser } from '../types/index.js';
import { BaseDao } from './base/BaseDao.js';
import { JsonFileBaseDao } from './base/JsonFileBaseDao.js';
import bcrypt from 'bcryptjs';

/**
 * User DAO interface with user-specific operations
 */
export interface UserDao extends BaseDao<IUser, string> {
  /**
   * Find user by username
   */
  findByUsername(username: string): Promise<IUser | null>;

  /**
   * Validate user credentials
   */
  validateCredentials(username: string, password: string): Promise<boolean>;

  /**
   * Create user with hashed password
   */
  createWithHashedPassword(username: string, password: string, isAdmin?: boolean): Promise<IUser>;

  /**
   * Update user password
   */
  updatePassword(username: string, newPassword: string): Promise<boolean>;

  /**
   * Find all admin users
   */
  findAdmins(): Promise<IUser[]>;
}

/**
 * JSON file-based User DAO implementation
 */
export class UserDaoImpl extends JsonFileBaseDao implements UserDao {
  protected async getAll(): Promise<IUser[]> {
    const settings = await this.loadSettings();
    return settings.users || [];
  }

  protected async saveAll(users: IUser[]): Promise<void> {
    const settings = await this.loadSettings();
    settings.users = users;
    await this.saveSettings(settings);
  }

  protected getEntityId(user: IUser): string {
    return user.username;
  }

  protected createEntity(_data: Omit<IUser, 'username'>): IUser {
    // This method should not be called directly for users
    throw new Error('Use createWithHashedPassword instead');
  }

  protected updateEntity(existing: IUser, updates: Partial<IUser>): IUser {
    return {
      ...existing,
      ...updates,
      username: existing.username, // Username should not be updated
    };
  }

  async findAll(): Promise<IUser[]> {
    return this.getAll();
  }

  async findById(username: string): Promise<IUser | null> {
    return this.findByUsername(username);
  }

  async findByUsername(username: string): Promise<IUser | null> {
    const users = await this.getAll();
    return users.find((user) => user.username === username) || null;
  }

  async create(_data: Omit<IUser, 'username'>): Promise<IUser> {
    throw new Error('Use createWithHashedPassword instead');
  }

  async createWithHashedPassword(
    username: string,
    password: string,
    isAdmin: boolean = false,
  ): Promise<IUser> {
    const users = await this.getAll();

    // Check if user already exists
    if (users.find((user) => user.username === username)) {
      throw new Error(`User ${username} already exists`);
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser: IUser = {
      username,
      password: hashedPassword,
      isAdmin,
    };

    users.push(newUser);
    await this.saveAll(users);

    return newUser;
  }

  async update(username: string, updates: Partial<IUser>): Promise<IUser | null> {
    const users = await this.getAll();
    const index = users.findIndex((user) => user.username === username);

    if (index === -1) {
      return null;
    }

    // Don't allow username changes
    const { username: _, ...allowedUpdates } = updates;
    const updatedUser = this.updateEntity(users[index], allowedUpdates);
    users[index] = updatedUser;

    await this.saveAll(users);
    return updatedUser;
  }

  async updatePassword(username: string, newPassword: string): Promise<boolean> {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const result = await this.update(username, { password: hashedPassword });
    return result !== null;
  }

  async delete(username: string): Promise<boolean> {
    const users = await this.getAll();
    const index = users.findIndex((user) => user.username === username);

    if (index === -1) {
      return false;
    }

    users.splice(index, 1);
    await this.saveAll(users);
    return true;
  }

  async exists(username: string): Promise<boolean> {
    const user = await this.findByUsername(username);
    return user !== null;
  }

  async count(): Promise<number> {
    const users = await this.getAll();
    return users.length;
  }

  async validateCredentials(username: string, password: string): Promise<boolean> {
    const user = await this.findByUsername(username);
    if (!user) {
      return false;
    }

    return bcrypt.compare(password, user.password);
  }

  async findAdmins(): Promise<IUser[]> {
    const users = await this.getAll();
    return users.filter((user) => user.isAdmin === true);
  }
}
