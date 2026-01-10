import { Repository, Between, Like, FindOptionsWhere } from 'typeorm';
import { Activity } from '../entities/Activity.js';
import { getAppDataSource } from '../connection.js';
import { IActivityFilter, IActivityStats } from '../../types/index.js';

/**
 * Repository for Activity entity
 */
export class ActivityRepository {
  private repository: Repository<Activity>;

  constructor() {
    this.repository = getAppDataSource().getRepository(Activity);
  }

  /**
   * Create a new activity record
   */
  async create(activity: Omit<Activity, 'id'>): Promise<Activity> {
    const newActivity = this.repository.create(activity);
    return await this.repository.save(newActivity);
  }

  /**
   * Find activity by ID
   */
  async findById(id: string): Promise<Activity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  /**
   * Build where clause from filter
   */
  private buildWhereClause(filter?: IActivityFilter): FindOptionsWhere<Activity> {
    const where: FindOptionsWhere<Activity> = {};

    if (filter?.server) {
      where.server = Like(`%${filter.server}%`);
    }
    if (filter?.tool) {
      where.tool = Like(`%${filter.tool}%`);
    }
    if (filter?.status) {
      where.status = filter.status;
    }
    if (filter?.group) {
      where.group = Like(`%${filter.group}%`);
    }
    if (filter?.keyId) {
      where.keyId = filter.keyId;
    }
    if (filter?.keyName) {
      where.keyName = Like(`%${filter.keyName}%`);
    }
    if (filter?.startDate && filter?.endDate) {
      where.timestamp = Between(filter.startDate, filter.endDate);
    }

    return where;
  }

  /**
   * Find activities with pagination and filtering
   */
  async findPaginated(
    page: number,
    limit: number,
    filter?: IActivityFilter,
  ): Promise<{ data: Activity[]; total: number }> {
    const skip = (page - 1) * limit;
    const where = this.buildWhereClause(filter);

    const [data, total] = await this.repository.findAndCount({
      where,
      order: { timestamp: 'DESC' },
      skip,
      take: limit,
    });

    return { data, total };
  }

  /**
   * Get activity statistics
   */
  async getStats(filter?: IActivityFilter): Promise<IActivityStats> {
    const where = this.buildWhereClause(filter);

    // Get total count
    const totalCalls = await this.repository.count({ where });

    // Get success count
    const successWhere = { ...where, status: 'success' };
    const successCount = await this.repository.count({ where: successWhere });

    // Get error count
    const errorWhere = { ...where, status: 'error' };
    const errorCount = await this.repository.count({ where: errorWhere });

    // Get average duration using query builder for more complex aggregation
    let avgDuration = 0;
    if (totalCalls > 0) {
      const qb = this.repository.createQueryBuilder('activity');

      // Apply filters to query builder
      if (filter?.server) {
        qb.andWhere('activity.server LIKE :server', { server: `%${filter.server}%` });
      }
      if (filter?.tool) {
        qb.andWhere('activity.tool LIKE :tool', { tool: `%${filter.tool}%` });
      }
      if (filter?.status) {
        qb.andWhere('activity.status = :status', { status: filter.status });
      }
      if (filter?.group) {
        qb.andWhere('activity.group_name LIKE :group', { group: `%${filter.group}%` });
      }
      if (filter?.keyId) {
        qb.andWhere('activity.key_id = :keyId', { keyId: filter.keyId });
      }
      if (filter?.keyName) {
        qb.andWhere('activity.key_name LIKE :keyName', { keyName: `%${filter.keyName}%` });
      }
      if (filter?.startDate && filter?.endDate) {
        qb.andWhere('activity.timestamp BETWEEN :startDate AND :endDate', {
          startDate: filter.startDate,
          endDate: filter.endDate,
        });
      }

      const result = await qb.select('AVG(activity.duration)', 'avgDuration').getRawOne();

      avgDuration = Math.round(parseFloat(result?.avgDuration || '0'));
    }

    return {
      totalCalls,
      successCount,
      errorCount,
      avgDuration,
    };
  }

  /**
   * Delete activities older than specified date
   */
  async deleteOlderThan(date: Date): Promise<number> {
    const result = await this.repository
      .createQueryBuilder()
      .delete()
      .where('timestamp < :date', { date })
      .execute();

    return result.affected || 0;
  }

  /**
   * Get distinct values for filter dropdowns
   */
  async getDistinctServers(): Promise<string[]> {
    const result = await this.repository
      .createQueryBuilder('activity')
      .select('DISTINCT activity.server', 'server')
      .orderBy('activity.server', 'ASC')
      .getRawMany();

    return result.map((r) => r.server);
  }

  async getDistinctTools(): Promise<string[]> {
    const result = await this.repository
      .createQueryBuilder('activity')
      .select('DISTINCT activity.tool', 'tool')
      .orderBy('activity.tool', 'ASC')
      .getRawMany();

    return result.map((r) => r.tool);
  }

  async getDistinctGroups(): Promise<string[]> {
    const result = await this.repository
      .createQueryBuilder('activity')
      .select('DISTINCT activity.group_name', 'group')
      .where('activity.group_name IS NOT NULL')
      .orderBy('activity.group_name', 'ASC')
      .getRawMany();

    return result.map((r) => r.group);
  }

  async getDistinctKeyNames(): Promise<string[]> {
    const result = await this.repository
      .createQueryBuilder('activity')
      .select('DISTINCT activity.key_name', 'keyName')
      .where('activity.key_name IS NOT NULL')
      .orderBy('activity.key_name', 'ASC')
      .getRawMany();

    return result.map((r) => r.keyName);
  }
}

export default ActivityRepository;
