import bcrypt from 'bcrypt';
import { UserDao } from './index.js';
import { IUser } from '../types/index.js';
import { UserRepository } from '../db/repositories/UserRepository.js';

/**
 * Database-backed implementation of UserDao
 */
export class UserDaoDbImpl implements UserDao {
  private repository: UserRepository;

  constructor() {
    this.repository = new UserRepository();
  }

  async findAll(): Promise<IUser[]> {
    const users = await this.repository.findAll();
    return users.map((u) => ({
      username: u.username,
      password: u.password,
      isAdmin: u.isAdmin,
      email: u.email ?? undefined,
    }));
  }

  async findById(username: string): Promise<IUser | null> {
    const user = await this.repository.findByUsername(username);
    if (!user) return null;
    return {
      username: user.username,
      password: user.password,
      isAdmin: user.isAdmin,
      email: user.email ?? undefined,
    };
  }

  async findByUsername(username: string): Promise<IUser | null> {
    return await this.findById(username);
  }

  async findByEmail(email: string): Promise<IUser | null> {
    const user = await this.repository.findByEmail(email);
    if (!user) return null;
    return {
      username: user.username,
      password: user.password,
      isAdmin: user.isAdmin,
      email: user.email ?? undefined,
    };
  }

  async create(entity: Omit<IUser, 'id'>): Promise<IUser> {
    const user = await this.repository.create({
      username: entity.username,
      password: entity.password,
      isAdmin: entity.isAdmin || false,
      email: entity.email ?? null,
    });
    return {
      username: user.username,
      password: user.password,
      isAdmin: user.isAdmin,
      email: user.email ?? undefined,
    };
  }

  async createWithHashedPassword(
    username: string,
    password: string,
    isAdmin: boolean,
    email?: string,
  ): Promise<IUser> {
    const hashedPassword = await bcrypt.hash(password, 10);
    return await this.create({ username, password: hashedPassword, isAdmin, email });
  }

  async update(username: string, entity: Partial<IUser>): Promise<IUser | null> {
    const updateData: any = {};
    if (entity.password !== undefined) updateData.password = entity.password;
    if (entity.isAdmin !== undefined) updateData.isAdmin = entity.isAdmin;
    if (entity.email !== undefined) updateData.email = entity.email ?? null;

    const user = await this.repository.update(username, updateData);
    if (!user) return null;
    return {
      username: user.username,
      password: user.password,
      isAdmin: user.isAdmin,
      email: user.email ?? undefined,
    };
  }

  async delete(username: string): Promise<boolean> {
    return await this.repository.delete(username);
  }

  async exists(username: string): Promise<boolean> {
    return await this.repository.exists(username);
  }

  async count(): Promise<number> {
    return await this.repository.count();
  }

  async validateCredentials(username: string, password: string): Promise<boolean> {
    const user = await this.findByUsername(username);
    if (!user) {
      return false;
    }
    return await bcrypt.compare(password, user.password);
  }

  async updatePassword(username: string, newPassword: string): Promise<boolean> {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    const result = await this.update(username, { password: hashedPassword });
    return result !== null;
  }

  async findAdmins(): Promise<IUser[]> {
    const users = await this.repository.findAdmins();
    return users.map((u) => ({
      username: u.username,
      password: u.password,
      isAdmin: u.isAdmin,
      email: u.email ?? undefined,
    }));
  }
}
