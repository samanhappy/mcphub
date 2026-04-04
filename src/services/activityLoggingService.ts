import { getActivityDao, isActivityLoggingEnabled } from '../dao/DaoFactory.js';
import { IActivity, ActivityStatus } from '../types/index.js';
import {
  safeStringify as safeJsonStringify,
  sanitizeStringForLogging,
} from '../utils/serialization.js';

/**
 * Service for logging tool call activities
 * Only logs when in database mode
 */
export class ActivityLoggingService {
  private static instance: ActivityLoggingService;

  public static getInstance(): ActivityLoggingService {
    if (!ActivityLoggingService.instance) {
      ActivityLoggingService.instance = new ActivityLoggingService();
    }
    return ActivityLoggingService.instance;
  }

  private constructor() {
    // Private constructor for singleton
  }

  /**
   * Check if activity logging is available
   */
  isEnabled(): boolean {
    return isActivityLoggingEnabled();
  }

  /**
   * Log a tool call activity
   */
  async logToolCall(params: {
    server: string;
    tool: string;
    duration: number;
    status: ActivityStatus;
    input?: any;
    output?: any;
    group?: string;
    keyId?: string;
    keyName?: string;
    errorMessage?: string;
  }): Promise<void> {
    if (!this.isEnabled()) {
      return;
    }

    const activityDao = getActivityDao();
    if (!activityDao) {
      return;
    }

    try {
      const activity: Omit<IActivity, 'id'> = {
        timestamp: new Date(),
        server: params.server,
        tool: params.tool,
        duration: params.duration,
        status: params.status,
        input: params.input ? this.safeStringify(params.input) : undefined,
        output: params.output ? this.safeStringify(params.output) : undefined,
        group: params.group,
        keyId: params.keyId,
        keyName: params.keyName,
        errorMessage: params.errorMessage
          ? sanitizeStringForLogging(params.errorMessage)
          : undefined,
      };

      await activityDao.create(activity);
    } catch (error) {
      // Don't let logging failures affect the main flow
      console.error('Failed to log activity:', error);
    }
  }

  /**
   * Safely stringify an object, handling circular references
   */
  private safeStringify(obj: any): string {
    try {
      // Limit the size of the stringified data
      const str = safeJsonStringify(obj, 2);
      // Limit to 100KB
      if (str.length > 100000) {
        return JSON.stringify({
          _truncated: true,
          _message: 'Data too large to store',
          _originalLength: str.length,
        });
      }
      return str;
    } catch (error) {
      return JSON.stringify({
        _error: 'Failed to stringify data',
        _type: typeof obj,
      });
    }
  }
}

/**
 * Convenience function to get the activity logging service instance
 */
export function getActivityLoggingService(): ActivityLoggingService {
  return ActivityLoggingService.getInstance();
}
