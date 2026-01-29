/**
 * Database retry utility for handling connection failures gracefully
 * Implements exponential backoff with jitter for resilient database operations
 */

export interface RetryOptions {
  /** Maximum number of retry attempts (default: 3) */
  maxRetries?: number;
  /** Initial delay in milliseconds before first retry (default: 1000) */
  initialDelayMs?: number;
  /** Maximum delay in milliseconds between retries (default: 30000) */
  maxDelayMs?: number;
  /** Multiplier for exponential backoff (default: 2) */
  backoffMultiplier?: number;
  /** Whether to add jitter to delays (default: true) */
  jitter?: boolean;
  /** Operation name for logging */
  operationName?: string;
  /** Callback when a retry is attempted */
  onRetry?: (error: Error, attempt: number, delayMs: number) => void;
}

const DEFAULT_OPTIONS: Required<Omit<RetryOptions, 'onRetry' | 'operationName'>> = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  jitter: true,
};

/**
 * Known database connection error codes that should trigger a retry
 */
const RETRYABLE_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'ENETUNREACH',
  'EHOSTUNREACH',
  'EPIPE',
  'EAI_AGAIN',
  'PROTOCOL_CONNECTION_LOST',
  'ER_CON_COUNT_ERROR',
  '57P01', // PostgreSQL: admin_shutdown
  '57P02', // PostgreSQL: crash_shutdown
  '57P03', // PostgreSQL: cannot_connect_now
  '08000', // PostgreSQL: connection_exception
  '08003', // PostgreSQL: connection_does_not_exist
  '08006', // PostgreSQL: connection_failure
  '08001', // PostgreSQL: sqlclient_unable_to_establish_sqlconnection
  '08004', // PostgreSQL: sqlserver_rejected_establishment_of_sqlconnection
]);

/**
 * Known database connection error message patterns that should trigger a retry
 */
const RETRYABLE_ERROR_PATTERNS = [
  /connection.*reset/i,
  /connection.*closed/i,
  /connection.*lost/i,
  /connection.*terminated/i,
  /connection.*refused/i,
  /connection.*timeout/i,
  /connection.*failed/i,
  /network.*error/i,
  /socket.*hang.*up/i,
  /read.*econnreset/i,
  /write.*econnreset/i,
  /cannot.*connect/i,
  /server.*closed/i,
  /client.*closed/i,
  /pool.*exhausted/i,
  /too.*many.*connections/i,
  /database.*unavailable/i,
];

/**
 * Check if an error is a retryable database connection error
 */
export function isRetryableDbError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const err = error as Record<string, unknown>;

  // Check error code
  const code = err.code as string | undefined;
  if (code && RETRYABLE_ERROR_CODES.has(code)) {
    return true;
  }

  // Check errno
  const errno = err.errno as string | undefined;
  if (errno && RETRYABLE_ERROR_CODES.has(errno)) {
    return true;
  }

  // Check driver error (nested error from TypeORM)
  const driverError = err.driverError as Record<string, unknown> | undefined;
  if (driverError) {
    const driverCode = driverError.code as string | undefined;
    if (driverCode && RETRYABLE_ERROR_CODES.has(driverCode)) {
      return true;
    }
  }

  // Check error message patterns
  const message = err.message as string | undefined;
  if (message) {
    for (const pattern of RETRYABLE_ERROR_PATTERNS) {
      if (pattern.test(message)) {
        return true;
      }
    }
  }

  // Check nested error message
  if (driverError) {
    const driverMessage = driverError.message as string | undefined;
    if (driverMessage) {
      for (const pattern of RETRYABLE_ERROR_PATTERNS) {
        if (pattern.test(driverMessage)) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Calculate delay with optional jitter for the next retry attempt
 */
function calculateDelay(
  attempt: number,
  initialDelayMs: number,
  maxDelayMs: number,
  backoffMultiplier: number,
  jitter: boolean,
): number {
  // Calculate base delay with exponential backoff
  const baseDelay = initialDelayMs * Math.pow(backoffMultiplier, attempt - 1);

  // Cap at max delay
  const cappedDelay = Math.min(baseDelay, maxDelayMs);

  // Add jitter if enabled (±25% of the delay)
  if (jitter) {
    const jitterRange = cappedDelay * 0.25;
    const jitterOffset = Math.random() * jitterRange * 2 - jitterRange;
    return Math.max(0, Math.round(cappedDelay + jitterOffset));
  }

  return Math.round(cappedDelay);
}

/**
 * Sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Execute a database operation with retry logic
 *
 * @param operation - The async operation to execute
 * @param options - Retry configuration options
 * @returns The result of the operation
 * @throws The last error if all retries are exhausted
 *
 * @example
 * ```typescript
 * const users = await withDbRetry(
 *   () => userRepository.findAll(),
 *   { operationName: 'findAllUsers', maxRetries: 3 }
 * );
 * ```
 */
export async function withDbRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const { maxRetries, initialDelayMs, maxDelayMs, backoffMultiplier, jitter } = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  const { operationName = 'database operation', onRetry } = options;

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // If it's the last attempt or not a retryable error, throw immediately
      if (attempt > maxRetries || !isRetryableDbError(error)) {
        throw lastError;
      }

      // Calculate delay for next retry
      const delayMs = calculateDelay(
        attempt,
        initialDelayMs,
        maxDelayMs,
        backoffMultiplier,
        jitter,
      );

      // Log the retry attempt
      console.warn(
        `[DB Retry] ${operationName} failed (attempt ${attempt}/${maxRetries + 1}), ` +
          `retrying in ${delayMs}ms: ${lastError.message}`,
      );

      // Call the onRetry callback if provided
      if (onRetry) {
        onRetry(lastError, attempt, delayMs);
      }

      // Wait before retrying
      await sleep(delayMs);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError || new Error(`${operationName} failed after ${maxRetries} retries`);
}

/**
 * Create a retry-wrapped version of a database function
 *
 * @param fn - The function to wrap
 * @param options - Retry configuration options
 * @returns A wrapped function with retry logic
 *
 * @example
 * ```typescript
 * const findAllWithRetry = createRetryWrapper(
 *   () => repository.findAll(),
 *   { operationName: 'findAll' }
 * );
 * const users = await findAllWithRetry();
 * ```
 */
export function createRetryWrapper<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: RetryOptions = {},
): (...args: TArgs) => Promise<TResult> {
  return (...args: TArgs) =>
    withDbRetry(() => fn(...args), {
      ...options,
      operationName: options.operationName || fn.name || 'wrapped operation',
    });
}

export default withDbRetry;
