import { Repository } from 'typeorm';
import { User } from '../entities/User.js';
import { getAppDataSource } from '../connection.js';

/**
 * Repository for User entity
 */
export class UserRepository {
  private repository: Repository<User>;

  constructor() {
    this.repository = getAppDataSource().getRepository(User);
  }

  /**
   * Find all users
   */
  async findAll(): Promise<User[]> {
    return await this.repository.find({ order: { createdAt: 'ASC' } });
  }

  /**
   * Find user by username
   */
  async findByUsername(username: string): Promise<User | null> {
    return await this.repository.findOne({ where: { username } });
  }

  /**
   * Create a new user
   */
  async create(user: Omit<User, 'id' | 'createdAt' | 'updatedAt'>): Promise<User> {
    const newUser = this.repository.create(user);
    return await this.repository.save(newUser);
  }

  /**
   * Update an existing user
   */
  async update(username: string, userData: Partial<User>): Promise<User | null> {
    const user = await this.findByUsername(username);
    if (!user) {
      return null;
    }
    const updated = this.repository.merge(user, userData);
    return await this.repository.save(updated);
  }

  /**
   * Delete a user
   */
  async delete(username: string): Promise<boolean> {
    const result = await this.repository.delete({ username });
    return (result.affected ?? 0) > 0;
  }

  /**
   * Check if user exists
   */
  async exists(username: string): Promise<boolean> {
    const count = await this.repository.count({ where: { username } });
    return count > 0;
  }

  /**
   * Count total users
   */
  async count(): Promise<number> {
    return await this.repository.count();
  }

  /**
   * Find all admin users
   */
  async findAdmins(): Promise<User[]> {
    return await this.repository.find({ where: { isAdmin: true }, order: { createdAt: 'ASC' } });
  }
}

export default UserRepository;
