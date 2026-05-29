import bcrypt from 'bcrypt';
import { UserDao } from './index.js';
import { IUser } from '../types/index.js';
import { UserRepository } from '../db/repositories/UserRepository.js';
import { User } from '../db/entities/User.js';

/**
 * Database-backed implementation of UserDao
 */
export class UserDaoDbImpl implements UserDao {
  private repository: UserRepository;

  constructor() {
    this.repository = new UserRepository();
  }

  private toIUser(u: User): IUser {
    return {
      username: u.username,
      password: u.password,
      isAdmin: u.isAdmin,
      email: u.email ?? undefined,
      ssoUserId: u.ssoUserId ?? undefined,
    };
  }

  async findAll(): Promise<IUser[]> {
    const users = await this.repository.findAll();
    return users.map((u) => this.toIUser(u));
  }

  async findById(username: string): Promise<IUser | null> {
    const user = await this.repository.findByUsername(username);
    if (!user) return null;
    return this.toIUser(user);
  }

  async findByUsername(username: string): Promise<IUser | null> {
    return await this.findById(username);
  }

  async findByEmail(email: string): Promise<IUser | null> {
    const user = await this.repository.findByEmail(email);
    if (!user) return null;
    return this.toIUser(user);
  }

  async findBySsoUserId(ssoUserId: string): Promise<IUser | null> {
    const user = await this.repository.findBySsoUserId(ssoUserId);
    if (!user) return null;
    return this.toIUser(user);
  }

  async create(entity: Omit<IUser, 'id'>): Promise<IUser> {
    const user = await this.repository.create({
      username: entity.username,
      password: entity.password,
      isAdmin: entity.isAdmin || false,
      email: entity.email ?? null,
      ssoUserId: entity.ssoUserId ?? null,
    });
    return this.toIUser(user);
  }

  async createWithHashedPassword(
    username: string,
    password: string,
    isAdmin: boolean,
    email?: string,
    ssoUserId?: string,
  ): Promise<IUser> {
    const hashedPassword = await bcrypt.hash(password, 10);
    return await this.create({ username, password: hashedPassword, isAdmin, email, ssoUserId });
  }

  async update(username: string, entity: Partial<IUser>): Promise<IUser | null> {
    const updateData: any = {};
    if (entity.password !== undefined) updateData.password = entity.password;
    if (entity.isAdmin !== undefined) updateData.isAdmin = entity.isAdmin;
    if (entity.email !== undefined) updateData.email = entity.email ?? null;
    if (entity.ssoUserId !== undefined) updateData.ssoUserId = entity.ssoUserId ?? null;

    const user = await this.repository.update(username, updateData);
    if (!user) return null;
    return this.toIUser(user);
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
    return users.map((u) => this.toIUser(u));
  }
}
