import { getActivityDao, isActivityLoggingEnabled } from '../dao/DaoFactory.js';
import { IActivity, ActivityStatus } from '../types/index.js';
import {
  stringifyWithoutRedaction,
  sanitizeStringForLogging,
} from '../utils/serialization.js';
import { getCachedSystemConfig } from '../utils/systemConfigCache.js';

const PAYLOAD_OMITTED = JSON.stringify({
  _omitted: true,
  _reason: 'activityLog.storeToolPayload is disabled',
});

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
    username?: string;
    keyId?: string;
    keyName?: string;
    sourceIp?: string;
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
      const storePayload = this.shouldStoreToolPayload();
      const activity: Omit<IActivity, 'id'> = {
        timestamp: new Date(),
        server: params.server,
        tool: params.tool,
        duration: params.duration,
        status: params.status,
        input: this.serializePayload(params.input, storePayload),
        output: this.serializePayload(params.output, storePayload),
        group: params.group,
        username: params.username,
        keyId: params.keyId,
        keyName: params.keyName,
        sourceIp: params.sourceIp,
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
   * Whether to persist full tool call payloads. Defaults to true; deployments
   * that treat tool arguments as sensitive can opt out via system config.
   */
  private shouldStoreToolPayload(): boolean {
    return getCachedSystemConfig()?.activityLog?.storeToolPayload !== false;
  }

  /**
   * Serialize a tool call payload for storage.
   *
   * Payloads are stored verbatim (no field-level redaction): heuristic
   * redaction corrupts the audit record on false positives and gives false
   * assurance on false negatives, so the decision is whether to store at all.
   */
  private serializePayload(payload: any, storePayload: boolean): string | undefined {
    if (payload === undefined || payload === null) {
      return undefined;
    }
    if (!storePayload) {
      return PAYLOAD_OMITTED;
    }
    return this.safeStringify(payload);
  }

  /**
   * Stringify an object without redaction, handling circular references and
   * capping the stored size.
   */
  private safeStringify(obj: any): string {
    try {
      // Limit the size of the stringified data
      const str = stringifyWithoutRedaction(obj, 2);
      // Limit to 100KB
      if (str.length > 100000) {
        return JSON.stringify({
          _truncated: true,
          _message: 'Data too large to store',
          _originalLength: str.length,
        });
      }
      return str;
    } catch (_error) {
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
