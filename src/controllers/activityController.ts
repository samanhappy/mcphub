import { Request, Response } from 'express';
import { getActivityDao, isActivityLoggingEnabled } from '../dao/DaoFactory.js';
import { IActivityFilter } from '../types/index.js';

/**
 * Check if activity feature is available (database mode only)
 */
export const checkActivityAvailable = async (req: Request, res: Response): Promise<void> => {
  res.json({
    success: true,
    data: {
      available: isActivityLoggingEnabled(),
    },
  });
};

/**
 * Get paginated list of activities
 */
export const getActivities = async (req: Request, res: Response): Promise<void> => {
  try {
    const activityDao = getActivityDao();
    if (!activityDao) {
      res.status(404).json({
        success: false,
        message: 'Activity logging is only available in database mode',
      });
      return;
    }

    // Parse pagination parameters
    const page = parseInt(req.query.page as string, 10) || 1;
    const limit = parseInt(req.query.limit as string, 10) || 20;

    // Validate pagination parameters
    if (page < 1) {
      res.status(400).json({
        success: false,
        message: 'Page number must be greater than 0',
      });
      return;
    }

    if (limit < 1 || limit > 100) {
      res.status(400).json({
        success: false,
        message: 'Limit must be between 1 and 100',
      });
      return;
    }

    // Build filter from query parameters
    const filter: IActivityFilter = {};
    if (req.query.server) {
      filter.server = req.query.server as string;
    }
    if (req.query.tool) {
      filter.tool = req.query.tool as string;
    }
    if (req.query.status && (req.query.status === 'success' || req.query.status === 'error')) {
      filter.status = req.query.status as 'success' | 'error';
    }
    if (req.query.group) {
      filter.group = req.query.group as string;
    }
    if (req.query.keyId) {
      filter.keyId = req.query.keyId as string;
    }
    if (req.query.keyName) {
      filter.keyName = req.query.keyName as string;
    }
    if (req.query.startDate) {
      filter.startDate = new Date(req.query.startDate as string);
    }
    if (req.query.endDate) {
      filter.endDate = new Date(req.query.endDate as string);
    }

    const result = await activityDao.findPaginated(page, limit, filter);

    res.json({
      success: true,
      data: result.data,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: result.totalPages,
        hasNextPage: result.page < result.totalPages,
        hasPrevPage: result.page > 1,
      },
    });
  } catch (error) {
    console.error('Error fetching activities:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch activities',
    });
  }
};

/**
 * Get activity by ID (for viewing full details including input/output)
 */
export const getActivityById = async (req: Request, res: Response): Promise<void> => {
  try {
    const activityDao = getActivityDao();
    if (!activityDao) {
      res.status(404).json({
        success: false,
        message: 'Activity logging is only available in database mode',
      });
      return;
    }

    const { id } = req.params;
    const activity = await activityDao.findById(id);

    if (!activity) {
      res.status(404).json({
        success: false,
        message: 'Activity not found',
      });
      return;
    }

    res.json({
      success: true,
      data: activity,
    });
  } catch (error) {
    console.error('Error fetching activity:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch activity',
    });
  }
};

/**
 * Get activity statistics
 */
export const getActivityStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const activityDao = getActivityDao();
    if (!activityDao) {
      res.status(404).json({
        success: false,
        message: 'Activity logging is only available in database mode',
      });
      return;
    }

    // Build filter from query parameters
    const filter: IActivityFilter = {};
    if (req.query.server) {
      filter.server = req.query.server as string;
    }
    if (req.query.tool) {
      filter.tool = req.query.tool as string;
    }
    if (req.query.status && (req.query.status === 'success' || req.query.status === 'error')) {
      filter.status = req.query.status as 'success' | 'error';
    }
    if (req.query.group) {
      filter.group = req.query.group as string;
    }
    if (req.query.keyId) {
      filter.keyId = req.query.keyId as string;
    }
    if (req.query.keyName) {
      filter.keyName = req.query.keyName as string;
    }
    if (req.query.startDate) {
      filter.startDate = new Date(req.query.startDate as string);
    }
    if (req.query.endDate) {
      filter.endDate = new Date(req.query.endDate as string);
    }

    const stats = await activityDao.getStats(filter);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Error fetching activity stats:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch activity statistics',
    });
  }
};

/**
 * Get distinct filter options (servers, tools, groups)
 */
export const getActivityFilterOptions = async (req: Request, res: Response): Promise<void> => {
  try {
    const activityDao = getActivityDao();
    if (!activityDao) {
      res.status(404).json({
        success: false,
        message: 'Activity logging is only available in database mode',
      });
      return;
    }

    const [servers, tools, groups, keyNames] = await Promise.all([
      activityDao.getDistinctServers(),
      activityDao.getDistinctTools(),
      activityDao.getDistinctGroups(),
      activityDao.getDistinctKeyNames(),
    ]);

    res.json({
      success: true,
      data: {
        servers,
        tools,
        groups,
        keyNames,
      },
    });
  } catch (error) {
    console.error('Error fetching filter options:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch filter options',
    });
  }
};

/**
 * Delete old activity records
 */
export const deleteOldActivities = async (req: Request, res: Response): Promise<void> => {
  try {
    const activityDao = getActivityDao();
    if (!activityDao) {
      res.status(404).json({
        success: false,
        message: 'Activity logging is only available in database mode',
      });
      return;
    }

    // Default to 30 days if not specified
    const daysOld = parseInt(req.query.daysOld as string, 10) || 30;

    if (daysOld < 1) {
      res.status(400).json({
        success: false,
        message: 'daysOld must be at least 1',
      });
      return;
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const deletedCount = await activityDao.deleteOlderThan(cutoffDate);

    res.json({
      success: true,
      data: {
        deletedCount,
        cutoffDate: cutoffDate.toISOString(),
      },
    });
  } catch (error) {
    console.error('Error deleting old activities:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete old activities',
    });
  }
};
