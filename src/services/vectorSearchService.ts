import { getRepositoryFactory } from '../db/index.js';
import { VectorEmbeddingRepository } from '../db/repositories/index.js';
import { Tool } from '../types/index.js';
import { getAppDataSource, isDatabaseConnected, initializeDatabase, reconnectDatabase } from '../db/connection.js';
import { getServerDao } from '../dao/index.js';
import { getSmartRoutingConfig, type SmartRoutingConfig } from '../utils/smartRouting.js';
import { toFloat32Array } from '../utils/base64.js';
import {
  truncateToTokenLimit,
  truncateWithHeuristic,
  getModelDefaultTokenLimit,
} from '../utils/tokenTruncation.js';
import { safeStringify, summarizeErrorForLogging } from '../utils/serialization.js';
import logService from './logService.js';
import { createHash } from 'node:crypto';
import OpenAI from 'openai';
import axios from 'axios';

const maskApiKey = (apiKey: string): string => {
  if (!apiKey) {
    return 'missing';
  }
  if (apiKey.length <= 10) {
    return `${apiKey.substring(0, 2)}***${apiKey.substring(apiKey.length - 2)}`;
  }
  return `${apiKey.substring(0, 6)}***${apiKey.substring(apiKey.length - 4)}`;
};

const shellEscapeSingleQuotes = (value: string): string => value.replace(/'/g, `'"'"'`);

const buildEmbeddingsDebugCurl = (
  baseURL: string | undefined,
  payload: { model: string; input: string; encoding_format: 'base64' | 'float' },
): string => {
  const normalizedBaseURL = (baseURL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const payloadJson = JSON.stringify(payload);
  return [
    `curl -s -X POST ${normalizedBaseURL}/embeddings`,
    `  -H "Authorization: Bearer <YOUR_API_KEY>"`,
    `  -H "Content-Type: application/json"`,
    `  -d '${shellEscapeSingleQuotes(payloadJson)}'`,
  ].join(' \\\n');
};

// Get OpenAI configuration from smartRouting settings or fallback to environment variables
const getOpenAIConfig = async () => {
  const smartRoutingConfig = await getSmartRoutingConfig();
  return {
    apiKey: smartRoutingConfig.openaiApiKey,
    baseURL: smartRoutingConfig.openaiApiBaseUrl,
    embeddingModel: smartRoutingConfig.openaiApiEmbeddingModel,
  };
};

const getAzureOpenAIConfig = (smartRoutingConfig: SmartRoutingConfig) => {
  return {
    endpoint: smartRoutingConfig.azureOpenaiEndpoint,
    apiKey: smartRoutingConfig.azureOpenaiApiKey,
    apiVersion: smartRoutingConfig.azureOpenaiApiVersion,
    embeddingDeployment: smartRoutingConfig.azureOpenaiEmbeddingDeployment,
  };
};

const generateAzureOpenAIEmbedding = async (
  text: string,
  smartRoutingConfig: SmartRoutingConfig,
): Promise<number[]> => {
  const azureConfig = getAzureOpenAIConfig(smartRoutingConfig);

  if (!azureConfig.endpoint || !azureConfig.apiKey) {
    throw new Error('Azure OpenAI endpoint/apiKey is not configured');
  }

  if (!azureConfig.apiVersion) {
    throw new Error('Azure OpenAI apiVersion is not configured');
  }

  if (!azureConfig.embeddingDeployment) {
    throw new Error('Azure OpenAI embedding deployment is not configured');
  }

  const endpoint = azureConfig.endpoint.replace(/\/+$/, '');
  const url = `${endpoint}/openai/deployments/${encodeURIComponent(
    azureConfig.embeddingDeployment,
  )}/embeddings?api-version=${encodeURIComponent(azureConfig.apiVersion)}`;

  // Truncate text to the model's token limit before sending to Azure OpenAI.
  // Azure deployment names are arbitrary user-defined identifiers (e.g. "my-embeddings"),
  // not recognizable OpenAI model names. Azure OpenAI uses OpenAI models internally
  // (e.g. text-embedding-3-small) so they share the same cl100k_base BPE tokenizer.
  // Use the dedicated azureOpenaiEmbeddingModel field (the actual underlying OpenAI model name)
  // so that truncation uses the correct token limit and tokenizer family.
  const embeddingModel = smartRoutingConfig.azureOpenaiEmbeddingModel || 'text-embedding-3-small';
  const azureMaxTokens =
    smartRoutingConfig.embeddingMaxTokens ?? getModelDefaultTokenLimit(embeddingModel);
  text = await truncateToTokenLimit(text, azureMaxTokens, embeddingModel, smartRoutingConfig.openaiApiKey);

  const response = await axios.post(
    url,
    {
      input: text,
    },
    {
      headers: {
        'api-key': azureConfig.apiKey,
        'Content-Type': 'application/json',
      },
    },
  );

  const embedding = response?.data?.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error('Azure embeddings response missing embedding data');
  }

  return embedding;
};

// ============================================================================
// Embedding Model Dimensions
// ============================================================================
// These constants define the vector dimension output for different embedding models.
// When the model changes, the entire vector database may need reindexing.
/** OpenAI text-embedding-3-small model produces 1536-dimensional vectors */
const EMBEDDING_DIMENSIONS_SMALL = 1536;
/** OpenAI text-embedding-3-large model produces 3072-dimensional vectors */
const EMBEDDING_DIMENSIONS_LARGE = 3072;
/** BAAI/bge-m3 model produces 1024-dimensional vectors */
const BGE_DIMENSIONS = 1024;
/** Google Gemini gemini-embedding-001 model produces 3072-dimensional vectors by default */
const GEMINI_EMBEDDING_DIMENSIONS = 3072;
/** Fallback embedding method (used when no API is configured) produces 100-dimensional vectors */
const FALLBACK_DIMENSIONS = 100;

// ============================================================================
// Provider Support Configuration
// ============================================================================
/** Base URLs that support base64 embedding encoding (more efficient than float arrays) */
const BASE64_EMBEDDING_SUPPORTED_PROVIDERS = [
  'https://api.openai.com',
  'https://api.siliconflow.cn',
  'https://openrouter.ai',
];

// ============================================================================
// Adaptive Pacing Configuration (Rate Limiting)
// ============================================================================
// These constants control the dynamic rate limiting mechanism that prevents
// hitting provider rate limits. Rate limits are typically measured in 1-minute windows (RPM).
// When 403/429 errors occur, the system enters a binary protection mode: pacing jumps
// directly to 63 seconds, stays there while rate-limit responses continue, and resets back
// to the base level after 63 seconds without new 403/429 errors. Retry-After, when present,
// still takes precedence over all local timing decisions.
// DEFAULT: 0 ms. The retry logic (Retry-After header → 63s fallback) already handles
// rate limit recovery automatically. The adaptive pacing then self-calibrates upward
// after each 403/429 and persists for subsequent calls. A non-zero baseline is only
// needed when a provider requires a fixed minimum interval between requests.
/** Initial delay between embedding API calls (ms). Increases on rate-limit errors. */
const SAFE_BASE_PACING_DELAY_MS = 0;
/** Increment to add when pacing delay increases (ms).
 * Set equal to the max delay so the first 403/429 immediately enables full protection. */
const SAFE_PACING_DELAY_STEP_MS = 63 * 1000;
/** Maximum allowed pacing delay between API calls (ms).
 * Set to 63 seconds: 60s RPM window + 3s safety margin. */
const SAFE_MAX_PACING_DELAY_MS = 63 * 1000;
/** Time to wait before allowing pacing delay to reset back to base level (ms).
 * Set to 63 seconds: 60s for the RPM window reset + 3s safety margin.
 * Aligned with how providers measure rate limits (requests per minute).
 * After 63s without new 403/429 errors, the rate limit bucket has fully reset. */
const SAFE_PACING_COOLDOWN_MS = 63 * 1000;

// ============================================================================
// Retry Policy Configuration
// ============================================================================
// These constants define the retry behavior for failed API calls.
// Strategy:
//   403/429 with Retry-After: always honor the server's specified wait, no time budget applied.
//   403/429 without Retry-After: use 63s cooldown per retry, budget-limited to 5 minutes total.
//   503/504: fixed exponential backoff sequence (4s, 8s, 16s, 30s, 60s, 120s, 240s), exactly 7 attempts.
//            No time budget imposed — all 7 attempts will be made regardless of total elapsed time.
/** Maximum total retry time for 403/429 rate-limit retries (ms). */
const MAX_TOTAL_RETRY_TIME_MS = 5 * 60 * 1000; // 5 minutes
/** Fixed exponential backoff wait sequence for 503/504 errors in milliseconds (7 attempts). */
const RETRY_EXPONENTIAL_SEQUENCE_MS = [4000, 8000, 16000, 30000, 60000, 120000, 240000];
/** Random jitter added to each retry delay to prevent thundering herd (ms) */
const RETRY_JITTER_MS = 1000;
/** HTTP status codes that trigger automatic retry (rate limits, server errors) */
const RETRYABLE_STATUS_CODES = new Set([403, 429, 503, 504]);

// ============================================================================
// Runtime State for Pacing and Sync Management
// ============================================================================
// Current adaptive pacing delay between embedding API calls (ms).
// Increases when rate-limit errors occur, decreases after cooldown period.
let adaptivePacingDelayMs = SAFE_BASE_PACING_DELAY_MS;

// Current configured baseline pacing delay between provider-backed embedding calls (ms).
// This can be overridden from Smart Routing settings and may be set to 0.
let configuredBasePacingDelayMs = SAFE_BASE_PACING_DELAY_MS;

// Timestamp (ms) when pacing delay was last increased.
// Used to calculate cooldown before allowing delay to decrease.
let lastPacingIncreaseAt = 0;

// Flag indicating a full embeddings resync has been scheduled.
// Prevents multiple redundant resync operations.
let fullResyncScheduled = false;

// Flag indicating a full embeddings resync is currently in progress.
// Prevents concurrent resync operations.
let fullResyncInProgress = false;

// Timestamp (ms) of the last embedding API call.
// Used to calculate required wait time before next call in the queue.
let lastEmbeddingCallAt = 0;

// Promise chain that serializes all embedding API calls through a single queue.
// Each call waits for the previous one to complete before starting.
// Ensures that adaptive pacing is applied consistently across all parallel sync operations.
let embeddingQueueTail: Promise<void> = Promise.resolve();

const sleep = async (ms: number): Promise<void> => {
  if (ms <= 0) {
    return;
  }

  await new Promise((resolve) => setTimeout(resolve, ms));
};

const withJitter = (baseDelayMs: number): number => {
  return baseDelayMs + Math.floor(Math.random() * RETRY_JITTER_MS);
};

const extractErrorStatus = (error: any): number | undefined => {
  const status = [error?.status, error?.response?.status, error?.cause?.status].find(
    (value) => typeof value === 'number',
  );

  return status as number | undefined;
};

const isRetryableStatus = (status?: number): boolean => {
  return typeof status === 'number' && RETRYABLE_STATUS_CODES.has(status);
};

/**
 * Extract Retry-After header value from error response and convert to milliseconds.
 * Handles both seconds (numeric) and HTTP-date formats.
 * Returns undefined if no valid Retry-After header is found.
 */
const extractRetryAfterMs = (error: any): number | undefined => {
  const retryAfter =
    error?.response?.headers?.['retry-after'] ||
    error?.response?.headers?.['Retry-After'] ||
    error?.headers?.['retry-after'] ||
    error?.headers?.['Retry-After'];

  if (!retryAfter) {
    return undefined;
  }

  // If it's numeric, treat as seconds and convert to milliseconds
  const numericValue = parseInt(String(retryAfter), 10);
  if (!isNaN(numericValue) && numericValue > 0) {
    return numericValue * 1000;
  }

  // If it's an HTTP date, parse it and calculate delay until that time
  try {
    const retryAtTime = new Date(retryAfter).getTime();
    if (!isNaN(retryAtTime)) {
      const delayMs = Math.max(0, retryAtTime - Date.now());
      return delayMs > 0 ? delayMs : undefined;
    }
  } catch (e) {
    // Ignore parsing errors
  }

  return undefined;
};

const applyConfiguredBasePacingDelay = (basePacingDelayMs?: number): void => {
  const normalizedBaseDelay =
    typeof basePacingDelayMs === 'number' && !Number.isNaN(basePacingDelayMs) && basePacingDelayMs >= 0
      ? Math.floor(basePacingDelayMs)
      : SAFE_BASE_PACING_DELAY_MS;
  const previousBaseDelay = configuredBasePacingDelayMs;

  configuredBasePacingDelayMs = normalizedBaseDelay;

  if (
    adaptivePacingDelayMs === previousBaseDelay ||
    adaptivePacingDelayMs < configuredBasePacingDelayMs
  ) {
    adaptivePacingDelayMs = configuredBasePacingDelayMs;
  }
};

const getAdaptivePacingDelayMs = (): number => {
  if (
    lastPacingIncreaseAt > 0 &&
    Date.now() - lastPacingIncreaseAt > SAFE_PACING_COOLDOWN_MS &&
    adaptivePacingDelayMs > configuredBasePacingDelayMs
  ) {
    // After the cooldown period (aligned with rate limit window resets),
    // immediately restore pacing to base level instead of decrementing gradually.
    // This allows faster recovery and more throughput once the provider's rate limit resets.
    adaptivePacingDelayMs = configuredBasePacingDelayMs;
  }

  return adaptivePacingDelayMs;
};

const increaseAdaptivePacingDelay = (status?: number): void => {
  const previousDelay = adaptivePacingDelayMs;
  adaptivePacingDelayMs = Math.min(
    SAFE_MAX_PACING_DELAY_MS,
    adaptivePacingDelayMs + SAFE_PACING_DELAY_STEP_MS,
  );
  lastPacingIncreaseAt = Date.now();

  if (adaptivePacingDelayMs !== previousDelay) {
    console.warn(
      `[Embedding][Throttle] Increased pacing delay to ${adaptivePacingDelayMs}ms after status=${status ?? 'unknown'}`,
    );
  }
};

const executeWithRetry = async <T>(
  operation: () => Promise<T>,
  context: { provider: string; model?: string; baseURL?: string },
): Promise<T> => {
  let totalRetryTimeMs = 0;
  let attempt = 1;
  let exponentialAttempt = 0;

  while (true) {
    try {
      return await operation();
    } catch (error: any) {
      const status = extractErrorStatus(error);
      const isRetryable = isRetryableStatus(status);

      if (!isRetryable) {
        throw error;
      }

      let waitMs: number;

      if (status === 403 || status === 429) {
        // STRATEGY FOR RATE LIMIT ERRORS (403/429):
        // - With Retry-After header: always honor the server's instruction unconditionally.
        //   Applying a self-imposed budget here would be counterproductive: if the server says
        //   "wait 8 minutes", cutting it short means the next attempt would fail immediately again.
        // - Without Retry-After header: use a 63s cooldown and apply the 5-minute budget as a
        //   safety net to avoid retrying blindly forever.
        increaseAdaptivePacingDelay(status);
        const retryAfterMs = extractRetryAfterMs(error);
        if (retryAfterMs !== undefined && retryAfterMs > 0) {
          // Server specified an explicit wait — honor it regardless of accumulated time.
          waitMs = retryAfterMs;
          console.warn(
            `[Embedding][Retry] provider=${context.provider}, model=${context.model || 'unknown'}, baseURL=${context.baseURL || 'default'}, status=${status}, attempt=${attempt}, respecting Retry-After header: ${waitMs}ms`,
          );
        } else {
          // No Retry-After header: use 63 second cooldown and apply the 5-minute safety budget.
          waitMs = 63 * 1000;
          console.warn(
            `[Embedding][Retry] provider=${context.provider}, model=${context.model || 'unknown'}, baseURL=${context.baseURL || 'default'}, status=${status}, attempt=${attempt}, applying 63s rate-limit cooldown (no Retry-After header found)`,
          );

          if (totalRetryTimeMs + waitMs > MAX_TOTAL_RETRY_TIME_MS) {
            const remainingMs = MAX_TOTAL_RETRY_TIME_MS - totalRetryTimeMs;
            console.warn(
              `[Embedding][Retry] Max retry time limit reached (no Retry-After). totalTime=${totalRetryTimeMs}ms, nextWait=${waitMs}ms, remaining=${remainingMs}ms, limit=${MAX_TOTAL_RETRY_TIME_MS}ms. Throwing error.`,
            );
            throw error;
          }
        }

        totalRetryTimeMs += waitMs;
      } else {
        // STRATEGY FOR OTHER ERRORS (503, 504, etc):
        // Fixed exponential sequence: 4s, 8s, 16s, 30s, 60s, 120s, 240s — exactly 7 attempts.
        // No time budget imposed; all 7 attempts will be made regardless of total elapsed time.
        if (exponentialAttempt >= RETRY_EXPONENTIAL_SEQUENCE_MS.length) {
          console.warn(
            `[Embedding][Retry] Exhausted all ${RETRY_EXPONENTIAL_SEQUENCE_MS.length} exponential backoff attempts. provider=${context.provider}, model=${context.model || 'unknown'}, status=${status}. Throwing error.`,
          );
          throw error;
        }

        waitMs = withJitter(RETRY_EXPONENTIAL_SEQUENCE_MS[exponentialAttempt]);
        console.warn(
          `[Embedding][Retry] provider=${context.provider}, model=${context.model || 'unknown'}, baseURL=${context.baseURL || 'default'}, status=${status}, attempt=${attempt} (exponential ${exponentialAttempt + 1}/${RETRY_EXPONENTIAL_SEQUENCE_MS.length}), waiting=${waitMs}ms`,
        );
        exponentialAttempt++;
      }

      console.log(
        `[Embedding][Retry] Attempt ${attempt} failed. Waiting ${waitMs}ms before retry...`,
      );
      await sleep(waitMs);
      attempt++;
    }
  }
};

/**
 * Serializes all embedding API calls through a single promise queue so that
 * parallel sync operations cannot bypass the adaptive pacing delay.
 */
const withEmbeddingQueue = <T>(operation: () => Promise<T>): Promise<T> => {
  const result = embeddingQueueTail.then(async () => {
    const now = Date.now();
    const elapsed = now - lastEmbeddingCallAt;
    const pacingDelayMs = getAdaptivePacingDelayMs();
    const waitMs = lastEmbeddingCallAt === 0 ? 0 : Math.max(0, pacingDelayMs - elapsed);
    if (waitMs > 0) {
      console.log(`[Embedding][Queue] Pacing wait ${waitMs}ms before next API call`);
      await sleep(waitMs);
    }
    lastEmbeddingCallAt = Date.now();
    return operation();
  });
  // Keep tail void-typed so the chain does not accumulate resolved values.
  embeddingQueueTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
};

const scheduleFullEmbeddingResync = (reason: string): void => {
  if (fullResyncScheduled || fullResyncInProgress) {
    console.log(`[Embedding] Full embeddings resync already in progress/scheduled. reason=${reason}`);
    return;
  }

  fullResyncScheduled = true;
  console.warn(`[Embedding] Scheduling full embeddings resync. reason=${reason}`);

  setTimeout(async () => {
    if (fullResyncInProgress) {
      fullResyncScheduled = false;
      return;
    }

    fullResyncScheduled = false;
    fullResyncInProgress = true;

    try {
      await syncAllServerToolsEmbeddings();
    } catch (error) {
      console.error('[EMBED_SYNC_ERROR] Full embeddings resync failed', { reason, error });
    } finally {
      fullResyncInProgress = false;
    }
  }, 5000);
};

// pgvector index limits (as of pgvector 0.7.0+)
// - vector type: up to 2,000 dimensions for both HNSW and IVFFlat
// - halfvec type: up to 4,000 dimensions (can be used for higher dimensional vectors via casting)
// - bit type: up to 64,000 dimensions
// HNSW is recommended as the default choice for better performance and robustness
export const VECTOR_MAX_DIMENSIONS = 2000;
export const HALFVEC_MAX_DIMENSIONS = 4000;

/**
 * Create an appropriate vector index based on the embedding dimensions
 *
 * According to Supabase/pgvector best practices:
 * - HNSW should be the default choice due to better performance and robustness
 * - HNSW indexes can be created immediately (unlike IVFFlat which needs data first)
 * - For vectors > 2000 dimensions, use halfvec casting (up to 4000 dimensions)
 *
 * Index strategy:
 * 1. For dimensions <= 2000: Use HNSW with vector type (best choice)
 * 2. For dimensions 2001-4000: Use HNSW with halfvec casting
 * 3. For dimensions > 4000: No index supported, warn user
 *
 * @param dataSource The TypeORM DataSource
 * @param dimensions The embedding dimensions
 * @param tableName The table name (default: 'vector_embeddings')
 * @param columnName The column name (default: 'embedding')
 * @returns Promise<{success: boolean, indexType: string | null, message: string}>
 */
export async function createVectorIndex(
  dataSource: { query: (sql: string) => Promise<unknown> },
  dimensions: number,
  tableName: string = 'vector_embeddings',
  columnName: string = 'embedding',
): Promise<{ success: boolean; indexType: string | null; message: string }> {
  const indexName = `idx_${tableName}_${columnName}`;

  // Drop any existing index first
  try {
    await dataSource.query(`DROP INDEX IF EXISTS ${indexName};`);
  } catch {
    // Ignore errors when dropping non-existent index
  }

  // Strategy 1: For dimensions <= 2000, use standard HNSW (recommended default)
  if (dimensions <= VECTOR_MAX_DIMENSIONS) {
    try {
      // HNSW is the recommended default - better performance and doesn't require pre-existing data
      await dataSource.query(`
        CREATE INDEX ${indexName}
        ON ${tableName} USING hnsw (${columnName} vector_cosine_ops);
      `);
      console.log(`Created HNSW index for ${dimensions}-dimensional vectors.`);
      return {
        success: true,
        indexType: 'hnsw',
        message: `HNSW index created successfully for ${dimensions} dimensions`,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`HNSW index creation failed: ${errorMessage}`);

      // Fallback to IVFFlat if HNSW fails (e.g., older pgvector version)
      try {
        await dataSource.query(`
          CREATE INDEX ${indexName}
          ON ${tableName} USING ivfflat (${columnName} vector_cosine_ops) WITH (lists = 100);
        `);
        console.log(`Created IVFFlat index for ${dimensions}-dimensional vectors (fallback).`);
        return {
          success: true,
          indexType: 'ivfflat',
          message: `IVFFlat index created successfully for ${dimensions} dimensions`,
        };
      } catch (ivfError: unknown) {
        const ivfErrorMessage = ivfError instanceof Error ? ivfError.message : 'Unknown error';
        console.warn(`IVFFlat index creation also failed: ${ivfErrorMessage}`);
        return {
          success: false,
          indexType: null,
          message: `No index created: ${errorMessage}`,
        };
      }
    }
  }

  // Strategy 2: For dimensions 2001-4000, use halfvec casting with HNSW
  if (dimensions <= HALFVEC_MAX_DIMENSIONS) {
    try {
      // Use halfvec type casting for high-dimensional vectors (pgvector 0.7.0+)
      await dataSource.query(`
        CREATE INDEX ${indexName}
        ON ${tableName} USING hnsw ((${columnName}::halfvec(${dimensions})) halfvec_cosine_ops);
      `);
      console.log(`Created HNSW index with halfvec casting for ${dimensions}-dimensional vectors.`);
      return {
        success: true,
        indexType: 'hnsw-halfvec',
        message: `HNSW index (halfvec) created successfully for ${dimensions} dimensions`,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      const isHalfvecNotSupported =
        errorMessage.includes('halfvec') ||
        errorMessage.includes('type does not exist') ||
        errorMessage.includes('operator class');

      if (isHalfvecNotSupported) {
        console.warn('');
        console.warn('═══════════════════════════════════════════════════════════════════════════');
        console.warn('  ⚠️  HIGH-DIMENSIONAL EMBEDDING INDEX WARNING');
        console.warn('═══════════════════════════════════════════════════════════════════════════');
        console.warn(
          `  Your embeddings have ${dimensions} dimensions, which requires halfvec support.`,
        );
        console.warn('');
        console.warn('  pgvector dimension limits:');
        console.warn(`  - vector type: max ${VECTOR_MAX_DIMENSIONS} dimensions`);
        console.warn(
          `  - halfvec type: max ${HALFVEC_MAX_DIMENSIONS} dimensions (pgvector 0.7.0+)`,
        );
        console.warn('');
        console.warn('  RECOMMENDATIONS:');
        console.warn('  1. Upgrade pgvector to >= 0.7.0 for halfvec support');
        console.warn('  2. Or use a smaller embedding model:');
        console.warn(
          '     - text-embedding-3-small (1536 dimensions) instead of text-embedding-3-large',
        );
        console.warn('     - bge-m3 (1024 dimensions)');
        console.warn('');
        console.warn('  Vector search will work but may be slower without an optimized index.');
        console.warn('═══════════════════════════════════════════════════════════════════════════');
        console.warn('');
      } else {
        console.warn(`HNSW halfvec index creation failed: ${errorMessage}`);
      }

      return {
        success: false,
        indexType: null,
        message: `No vector index created for ${dimensions} dimensions. ${errorMessage}`,
      };
    }
  }

  // Strategy 3: For dimensions > 4000, no index is supported
  console.warn('');
  console.warn('═══════════════════════════════════════════════════════════════════════════');
  console.warn('  ⚠️  EMBEDDING DIMENSIONS EXCEED INDEX LIMITS');
  console.warn('═══════════════════════════════════════════════════════════════════════════');
  console.warn(`  Your embeddings have ${dimensions} dimensions, which exceeds all limits:`);
  console.warn(`  - vector type: max ${VECTOR_MAX_DIMENSIONS} dimensions`);
  console.warn(`  - halfvec type: max ${HALFVEC_MAX_DIMENSIONS} dimensions`);
  console.warn('');
  console.warn('  RECOMMENDATIONS:');
  console.warn('  1. Use a smaller embedding model:');
  console.warn('     - text-embedding-3-small (1536 dimensions)');
  console.warn('     - text-embedding-3-large (3072 dimensions) with halfvec');
  console.warn('     - bge-m3 (1024 dimensions)');
  console.warn('  2. Or use dimensionality reduction (PCA) to reduce vector size');
  console.warn('');
  console.warn('  Vector search will work but will be slow without an index.');
  console.warn('═══════════════════════════════════════════════════════════════════════════');
  console.warn('');

  return {
    success: false,
    indexType: null,
    message: `Dimensions (${dimensions}) exceed maximum indexable limit (${HALFVEC_MAX_DIMENSIONS})`,
  };
}

// Get dimensions for a model
const getDimensionsForModel = (model: string): number => {
  model = model.toLowerCase();
  if (model.includes('bge-m3')) {
    return BGE_DIMENSIONS;
  } else if (model.includes('text-embedding-3-large')) {
    return EMBEDDING_DIMENSIONS_LARGE;
  } else if (model.includes('text-embedding-3')) {
    return EMBEDDING_DIMENSIONS_SMALL;
  } else if (model.includes('gemini-embedding-001')) {
    // Google Gemini gemini-embedding-001 defaults to 3072 dimensions.
    // Future implementation improvements may allow configurable dimensions
    // for Gemini models, but for now we will assume the default.
    return GEMINI_EMBEDDING_DIMENSIONS;
  } else if (model === 'fallback' || model === 'simple-hash') {
    return FALLBACK_DIMENSIONS;
  }
  // Default to OpenAI small model dimensions
  return EMBEDDING_DIMENSIONS_SMALL;
};

// Initialize the OpenAI client with smartRouting configuration
const getOpenAIClient = async () => {
  const config = await getOpenAIConfig();
  return new OpenAI({
    apiKey: config.apiKey, // Get API key from smartRouting settings or environment variables
    baseURL: config.baseURL, // Get base URL from smartRouting settings or fallback to default
  });
};

// Check if the provider supports base64 embeddings
const supportBase64Embeddings = async (baseURL: string = ''): Promise<boolean> => {
  return !baseURL || BASE64_EMBEDDING_SUPPORTED_PROVIDERS.some((url) => baseURL.startsWith(url));
};

/**
 * Generate text embedding using OpenAI's embedding model
 *
 * NOTE: embeddings are 1536 dimensions by default.
 * If you previously used the fallback implementation (100 dimensions),
 * you may need to rebuild your vector database indices after switching.
 *
 * @param text Text to generate embeddings for
 * @returns Promise with vector embedding as number array
 */
async function generateEmbedding(text: string): Promise<number[]> {
  const smartRoutingConfig = await getSmartRoutingConfig();
  applyConfiguredBasePacingDelay(smartRoutingConfig.basePacingDelayMs);
  const provider = smartRoutingConfig.embeddingProvider || 'openai';

  // Normalize whitespace before generating the embedding (issue #639):
  // tool descriptions fetched from MCP servers can contain raw newline characters
  // and other whitespace that introduce noise into the vector representation,
  // potentially affecting the quality of semantic search results.
  text = text.replace(/\s+/g, ' ').trim();

  if (provider === 'azure_openai') {
    const azureConfig = getAzureOpenAIConfig(smartRoutingConfig);

    if (!azureConfig.endpoint || !azureConfig.apiKey) {
      console.warn('Azure OpenAI endpoint/key not configured. Using fallback embedding method.');
      return generateFallbackEmbedding(text);
    }

    try {
      return await withEmbeddingQueue(() =>
        executeWithRetry(
          () => generateAzureOpenAIEmbedding(text, smartRoutingConfig),
          {
            provider: 'azure_openai',
            model: smartRoutingConfig.azureOpenaiEmbeddingModel,
            baseURL: azureConfig.endpoint,
          },
        ),
      );
    } catch (error: any) {
      const status = extractErrorStatus(error);
      console.warn(
        'Azure OpenAI embeddings request failed after retries',
        {
          status: status ?? 'unknown',
          endpoint: azureConfig.endpoint || 'missing',
          deployment: azureConfig.embeddingDeployment || 'missing',
          apiVersion: azureConfig.apiVersion || 'missing',
          error,
        },
      );
      throw error;
    }
  }

  const config = await getOpenAIConfig();
  const openai = await getOpenAIClient();

  // Check if API key is configured
  if (!openai.apiKey) {
    console.warn('OpenAI API key is not configured. Using fallback embedding method.');
    return generateFallbackEmbedding(text);
  }

  // Truncate text to the model's token limit using precise tokenization.
  // Apply a safety margin for providers where the local tokenizer may count
  // slightly fewer tokens than the server-side tokenizer (e.g. SiliconFlow).
  const TOKEN_SAFETY_FACTOR = 0.92; // 8% safety margin for token counting discrepancies
  const isSiliconFlow = config.baseURL?.includes('siliconflow.cn');
  const rawMaxTokens =
    smartRoutingConfig.embeddingMaxTokens ?? getModelDefaultTokenLimit(config.embeddingModel);
  const maxTokens = isSiliconFlow ? Math.floor(rawMaxTokens * TOKEN_SAFETY_FACTOR) : rawMaxTokens;
  
  let truncatedText: string;
  const _truncateStart = Date.now();
  try {
    truncatedText = await truncateToTokenLimit(
      text,
      maxTokens,
      config.embeddingModel,
      config.apiKey,
    );
  } catch (truncationError: any) {
    console.warn(
      `Token truncation failed for model ${config.embeddingModel}: ${
        truncationError?.message ?? String(truncationError)
      }. Falling back to character-based truncation.`,
    );
    // As a fallback, use the shared conservative character-based heuristic (~3 chars/token)
    // to prevent oversized text from causing a failure in the embedding API call.
    truncatedText = truncateWithHeuristic(text, maxTokens);
  }
  console.debug(
    `[Embedding] Truncation: ${text.length} → ${truncatedText.length} chars (${Date.now() - _truncateStart}ms, maxTokens=${maxTokens})`,
  );

  // Determine encoding format based on configuration
  const encodingFormatSetting = smartRoutingConfig.embeddingEncodingFormat || 'auto';
  let encodingFormat: 'base64' | 'float';
  if (encodingFormatSetting === 'auto') {
    const canUseBase64 = await supportBase64Embeddings(config.baseURL);
    encodingFormat = canUseBase64 ? 'base64' : 'float';
  } else {
    encodingFormat = encodingFormatSetting;
  }

  const embeddingPayload = {
    model: config.embeddingModel,
    encoding_format: encodingFormat,
    input: truncatedText,
  } as const;

  if (process.env.DEBUG === 'true') {
    const debugCurl = buildEmbeddingsDebugCurl(config.baseURL, embeddingPayload);

    console.log(
      `[Embedding] HTTP request details: ${JSON.stringify(
        {
          url: `${(config.baseURL || 'https://api.openai.com/v1').replace(/\/+$/, '')}/embeddings`,
          method: 'POST',
          headers: {
            Authorization: `Bearer ${maskApiKey(config.apiKey || '')}`,
            'Content-Type': 'application/json',
          },
          payload: embeddingPayload,
        },
        null,
        2,
      )}`,
    );
    console.log(
      `[Embedding] Reproducible curl (copy/paste and replace <YOUR_API_KEY>):\n${debugCurl}`,
    );
  }

  console.debug(
    `[Embedding] API request → model=${config.embeddingModel}, encoding_format=${encodingFormat}, input_length=${truncatedText.length} chars | input_preview: "${truncatedText.substring(0, 200).replace(/\s+/g, ' ')}"`,
  );
  const _requestStart = Date.now();
  try {
    // Call OpenAI-compatible embeddings API with conservative retry/backoff policy.
    const response = await withEmbeddingQueue(() =>
      executeWithRetry(
        () =>
          openai.embeddings.create({
            model: embeddingPayload.model,
            encoding_format: embeddingPayload.encoding_format,
            input: embeddingPayload.input,
          }),
        {
          provider,
          model: config.embeddingModel,
          baseURL: config.baseURL,
        },
      ),
    );
    console.debug(`[Embedding] API response OK in ${Date.now() - _requestStart}ms`);

    if (encodingFormat === 'base64' && typeof response.data[0].embedding === 'string') {
      const embeddingBase64Str = response.data[0].embedding as unknown as string;
      return toFloat32Array(embeddingBase64Str);
    }

    // Return the embedding
    return response.data[0].embedding;
  } catch (error: any) {
    const status = extractErrorStatus(error);
    console.warn('OpenAI-compatible embeddings request failed after retries', {
      status: status ?? 'unknown',
      baseURL: config.baseURL || 'default',
      model: config.embeddingModel || 'default',
      requestDurationMs: Date.now() - _requestStart,
      error,
    });

    throw error;
  }
}

/**
 * Fallback embedding function using a simple approach when OpenAI API is unavailable
 * @param text Text to generate embeddings for
 * @returns Vector embedding as number array
 */
function generateFallbackEmbedding(text: string): number[] {
  const words = text.toLowerCase().split(/\s+/);
  const vocabulary = [
    'search',
    'find',
    'get',
    'fetch',
    'retrieve',
    'query',
    'map',
    'location',
    'weather',
    'file',
    'directory',
    'email',
    'message',
    'send',
    'create',
    'update',
    'delete',
    'browser',
    'web',
    'page',
    'click',
    'navigate',
    'screenshot',
    'automation',
    'database',
    'table',
    'record',
    'insert',
    'select',
    'schema',
    'data',
    'image',
    'photo',
    'video',
    'media',
    'upload',
    'download',
    'convert',
    'text',
    'document',
    'pdf',
    'excel',
    'word',
    'format',
    'parse',
    'api',
    'rest',
    'http',
    'request',
    'response',
    'json',
    'xml',
    'time',
    'date',
    'calendar',
    'schedule',
    'reminder',
    'clock',
    'math',
    'calculate',
    'number',
    'sum',
    'average',
    'statistics',
    'user',
    'account',
    'login',
    'auth',
    'permission',
    'role',
  ];

  // Create vector with fallback dimensions
  const vector = new Array(FALLBACK_DIMENSIONS).fill(0);

  words.forEach((word) => {
    const index = vocabulary.indexOf(word);
    if (index >= 0 && index < vector.length) {
      vector[index] += 1;
    }
    // Add some randomness based on word hash
    const hash = word.split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    vector[hash % vector.length] += 0.1;
  });

  // Normalize the vector
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    return vector.map((val) => val / magnitude);
  }

  return vector;
}

const stableHashSerialize = (value: unknown): string => {
  if (value === null || value === undefined) {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableHashSerialize(item)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries
      .map(([key, val]) => `${JSON.stringify(key)}:${stableHashSerialize(val)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
};

const buildToolSetHash = (tools: Tool[]): string => {
  const normalized = tools
    .map((tool) => ({
      name: tool.name || '',
      description: tool.description || '',
      inputSchema: tool.inputSchema || null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return createHash('sha256').update(stableHashSerialize(normalized)).digest('hex');
};

const buildServerSearchableText = (serverName: string, description?: string | null): string =>
  [serverName, description || ''].filter(Boolean).join(' ');

const parseEmbeddingMetadata = (
  metadata: unknown,
): Record<string, any> | null => {
  if (!metadata) {
    return null;
  }

  if (typeof metadata === 'string') {
    try {
      return JSON.parse(metadata);
    } catch (error) {
      console.error('Error parsing vector embedding metadata string', safeStringify({ error }));
      return null;
    }
  }

  if (typeof metadata === 'object') {
    return metadata as Record<string, any>;
  }

  return null;
};

/**
 * Save tool information as vector embeddings
 *
 * Uses a two-phase approach to prevent DB connection staleness:
 *   Phase 1 — Generate all embeddings in memory (no DB access). For servers with many
 *             tools and slow/unavailable embedding providers (e.g. BAAI/bge-m3 behind
 *             a restricted network), this phase can take 10-60 s. Keeping DB operations
 *             out of this phase avoids exhausting connection-pool idle timeouts.
 *   Phase 2 — Verify the connection is still alive with a lightweight SELECT 1, reconnect
 *             if necessary, call checkDatabaseVectorDimensions exactly ONCE (not once per
 *             tool), and then persist all embeddings in a tight write loop.
 *
 * @param serverName Server name
 * @param tools Array of tools to save
 */
export const saveToolsAsVectorEmbeddings = async (
  serverName: string,
  tools: Tool[],
  options: {
    reportProgress?: boolean;
  } = {},
): Promise<void> => {
  const shouldReport = options.reportProgress === true;
  let progressErrorEmitted = false;
  let lastProgressCurrent = 0;

  const emitProgress = (current: number, status: 'started' | 'in_progress' | 'completed' | 'error') => {
    if (!shouldReport) return;
    lastProgressCurrent = current;
    if (status === 'error') {
      progressErrorEmitted = true;
    }
    logService.emitStreamEvent({
      type: 'embedding-sync-progress',
      progress: { serverName, current, total: tools.length, status },
    });
  };

  try {
    if (tools.length === 0) {
      console.warn('No tools to save as vector embeddings', { serverName });
      return;
    }

    const smartRoutingConfig = await getSmartRoutingConfig();
    if (!smartRoutingConfig.enabled) {
      return;
    }

    // Ensure database is initialized before starting
    if (!isDatabaseConnected()) {
      console.log('Database not initialized, initializing...');
      await initializeDatabase();
    }

    const config = await getOpenAIConfig();
    const embeddingProvider = smartRoutingConfig.embeddingProvider || 'openai';
    const persistedEmbeddingModel =
      embeddingProvider === 'azure_openai'
        ? smartRoutingConfig.azureOpenaiEmbeddingModel || 'text-embedding-3-small'
        : config.embeddingModel;
    const serverConfig = await getServerDao().findById(serverName);
    const serverDescription = serverConfig?.description || '';
    const serverSearchableText = buildServerSearchableText(serverName, serverDescription);

    const expectedContentIds = tools
      .map((tool) => `${serverName}:${tool.name}`)
      .sort((a, b) => a.localeCompare(b));
    const expectedToolSetHash = buildToolSetHash(tools);

    // ── Skip check: avoid regenerating embeddings that are already up-to-date ──
    // Validate exact content IDs and a tool-set hash/version marker to avoid
    // false positives when only counts match but the actual tool set changed.
    // This is an optimization to skip the expensive embedding generation phase when
    // nothing changed, which can save a lot of time for servers with many tools and
    // slow embedding providers. It also prevents rewrites on every server restart.
    if (isDatabaseConnected()) {
      try {
        const skipCheckRepo = getRepositoryFactory(
          'vectorEmbeddings',
        )() as VectorEmbeddingRepository;
        const existingCount = await skipCheckRepo.countByServerNameAndModel(
          serverName,
          persistedEmbeddingModel,
        );

        if (existingCount !== tools.length) {
          console.log(
            `[Embedding] [${serverName}] Generating embeddings: existing=${existingCount}, expected=${tools.length} (model=${persistedEmbeddingModel}, hash=${expectedToolSetHash.substring(0, 12)})`,
          );
        } else {
          const existingIdentities = await skipCheckRepo.getToolIdentityByServerNameAndModel(
            serverName,
            persistedEmbeddingModel,
          );

          const existingContentIds = existingIdentities
            .map((item) => item.contentId)
            .sort((a, b) => a.localeCompare(b));
          const hasExactContentIds =
            existingContentIds.length === expectedContentIds.length &&
            existingContentIds.every((contentId, idx) => contentId === expectedContentIds[idx]);
          const hasMatchingToolSetHash =
            existingIdentities.length > 0 &&
            existingIdentities.every((item) => item.toolSetHash === expectedToolSetHash);
          const existingServerEmbedding = await skipCheckRepo.findByContentIdentity('server', serverName);
          const hasCurrentServerEmbedding =
            existingServerEmbedding?.model === persistedEmbeddingModel &&
            existingServerEmbedding.text_content === serverSearchableText && existingServerEmbedding.embedding != null;

          if (hasExactContentIds && hasMatchingToolSetHash && hasCurrentServerEmbedding) {
            console.log(
              `[Embedding] [${serverName}] Skipping — tool set already up-to-date (model=${persistedEmbeddingModel}, hash=${expectedToolSetHash.substring(0, 12)})`,
            );
            return;
          }

          console.log(
            `[Embedding] [${serverName}] Generating embeddings: existing=${existingCount}, expected=${tools.length} (model=${persistedEmbeddingModel}, hash=${expectedToolSetHash.substring(0, 12)})`,
          );
        }
      } catch (skipCheckError: any) {
        console.warn(
          `[Embedding] [${serverName}] Skip check failed, proceeding with full sync: ${skipCheckError?.message ?? skipCheckError}`,
        );
      }
    }

    // ── Phase 1: Generate all embeddings in memory (no DB access) ──────────────
    // This can take a significant amount of time for servers with many tools and
    // slow or unreachable embedding providers. Performing DB writes here would
    // interleave long network/compute waits with DB queries, risking connection
    // pool staleness (empty driverError) on the subsequent writes.
    const toolEmbeddings: Array<{
      tool: Tool;
      searchableText: string;
      embedding: number[];
    }> = [];

    let vectorDimensionsReset = false;

    emitProgress(0, 'started');

    for (let _toolIdx = 0; _toolIdx < tools.length; _toolIdx++) {
      const tool = tools[_toolIdx];

      // Create searchable text from tool information
      const searchableText = [
        tool.name,
        tool.description,
        // Include input schema properties if available
        ...(tool.inputSchema && typeof tool.inputSchema === 'object'
          ? Object.keys(tool.inputSchema).filter((key) => key !== 'type' && key !== 'properties')
          : []),
        // Include schema property names if available
        ...(tool.inputSchema &&
        tool.inputSchema.properties &&
        typeof tool.inputSchema.properties === 'object'
          ? Object.keys(tool.inputSchema.properties)
          : []),
      ]
        .filter(Boolean)
        .join(' ');

      console.debug(
        `[Embedding] [${serverName}] Tool ${_toolIdx + 1}/${tools.length}: "${tool.name}" | raw text: ${searchableText.length} chars | preview: "${searchableText.substring(0, 200).replace(/\s+/g, ' ')}"`,
      );

      try {
        const embedding = await generateEmbedding(searchableText);
        toolEmbeddings.push({ tool, searchableText, embedding });
        emitProgress(_toolIdx + 1, 'in_progress');
      } catch (error: any) {
        const status = extractErrorStatus(error);
        console.warn('[EMBED_SYNC_ERROR] Failed while embedding tool', {
          serverName,
          toolName: tool.name,
          status: status ?? 'unknown',
          error: summarizeErrorForLogging(error),
        });
        emitProgress(_toolIdx, 'error');
        throw error;
      }
    }

    let serverEmbedding: number[];
    try {
      serverEmbedding = await generateEmbedding(serverSearchableText);
    } catch (error: any) {
      const status = extractErrorStatus(error);
      console.warn('[EMBED_SYNC_ERROR] Failed while embedding server metadata', {
        serverName,
        status: status ?? 'unknown',
        error: summarizeErrorForLogging(error),
      });
      emitProgress(toolEmbeddings.length, 'error');
      throw error;
    }

    // ── Phase 2: Persist embeddings to DB ──────────────────────────────────────
    // Probe the connection before writing; reconnect if it went stale during the
    // (potentially long) embedding-generation phase above.
    if (!isDatabaseConnected()) {
      console.info('Database connection lost during embedding generation, reinitializing...');
      await initializeDatabase();
    } else {
      try {
        await getAppDataSource().query('SELECT 1');
      } catch {
        console.warn(
          'DB connection stale after embedding generation for server %s — reconnecting...',
          serverName,
        );
        await reconnectDatabase();
      }
    }

    const vectorRepository = getRepositoryFactory(
      'vectorEmbeddings',
    )() as VectorEmbeddingRepository;

    // Check DB vector dimensions exactly once for the whole batch (all embeddings
    // produced by the same model always share the same dimension count).
    if (toolEmbeddings.length > 0 || serverEmbedding.length > 0) {
      vectorDimensionsReset = await checkDatabaseVectorDimensions(
        toolEmbeddings[0]?.embedding.length ?? serverEmbedding.length,
      );
    }

    for (const { tool, searchableText, embedding } of toolEmbeddings) {
      await vectorRepository.saveEmbedding(
        'tool',
        `${serverName}:${tool.name}`,
        searchableText,
        embedding,
        {
          serverName,
          toolName: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          toolSetHash: expectedToolSetHash,
        },
        persistedEmbeddingModel,
      );
    }

    await vectorRepository.saveEmbedding(
      'server',
      serverName,
      serverSearchableText,
      serverEmbedding,
      {
        serverName,
        description: serverDescription,
      },
      persistedEmbeddingModel,
    );

    emitProgress(toolEmbeddings.length, 'completed');

    if (vectorDimensionsReset) {
      scheduleFullEmbeddingResync(
        `Vector dimensions changed while syncing server "${serverName}"`,
      );
    }

    console.log('Saved tool embeddings', safeStringify({ serverName, toolCount: tools.length }));
  } catch (error) {
    if (shouldReport && !progressErrorEmitted) {
      emitProgress(lastProgressCurrent, 'error');
    }
    console.error('Error saving tool embeddings', safeStringify({ serverName, error }));
    throw error;
  }
};

/**
 * Search for tools using vector similarity
 * @param query Search query text
 * @param limit Maximum number of results to return
 * @param threshold Similarity threshold (0-1)
 * @param serverNames Optional array of server names to filter by
 */
export const searchToolsByVector = async (
  query: string,
  limit: number = 10,
  threshold: number = 0.7,
  serverNames?: string[],
): Promise<
  Array<{
    serverName: string;
    toolName: string;
    description: string;
    inputSchema: any;
    similarity: number;
    searchableText: string;
  }>
> => {
  try {
    const vectorRepository = getRepositoryFactory(
      'vectorEmbeddings',
    )() as VectorEmbeddingRepository;
    const queryEmbedding = await generateEmbedding(query);

    const [toolResults, rawServerResults] = await Promise.all([
      vectorRepository.searchSimilar(queryEmbedding, limit, threshold, ['tool']),
      vectorRepository.searchSimilar(queryEmbedding, 50, 0.1, ['server']),
    ]);

    const allowedServerNames = serverNames && serverNames.length > 0 ? new Set(serverNames) : null;
    const serverScoreMap = new Map<string, number>();

    for (const result of rawServerResults) {
      const parsedMetadata = parseEmbeddingMetadata(result.embedding?.metadata);
      const resultServerName = parsedMetadata?.serverName || result.embedding?.content_id;

      if (!resultServerName || (allowedServerNames && !allowedServerNames.has(resultServerName))) {
        continue;
      }

      const existingScore = serverScoreMap.get(resultServerName) ?? Number.NEGATIVE_INFINITY;
      if (result.similarity > existingScore) {
        serverScoreMap.set(resultServerName, result.similarity);
      }
    }

    // Filter by server names if provided
    const filteredResults = allowedServerNames
      ? toolResults.filter((result) => {
          const parsedMetadata = parseEmbeddingMetadata(result.embedding?.metadata);
          return !!parsedMetadata?.serverName && allowedServerNames.has(parsedMetadata.serverName);
        })
      : toolResults;

    // Transform results to a more useful format
    return filteredResults
      .map((result) => {
        const parsedMetadata = parseEmbeddingMetadata(result.embedding?.metadata);

        if (parsedMetadata?.serverName && parsedMetadata?.toolName) {
          const serverSimilarityBoost = serverScoreMap.get(parsedMetadata.serverName);
          return {
            serverName: parsedMetadata.serverName,
            toolName: parsedMetadata.toolName,
            description: parsedMetadata.description || '',
            inputSchema: parsedMetadata.inputSchema || {},
            similarity:
              serverSimilarityBoost !== undefined
                ? result.similarity * 0.8 + serverSimilarityBoost * 0.2
                : result.similarity,
            searchableText: result.embedding.text_content,
          };
        }

        // Extract tool info from text_content if metadata is not available or parsing failed
        const textContent = result.embedding?.text_content || '';

        // Extract toolName (first word of text_content)
        const toolNameMatch = textContent.match(/^(\S+)/);
        const toolName = toolNameMatch ? toolNameMatch[1] : '';

        // Extract serverName from toolName if it follows the pattern "serverName_toolPart"
        const serverNameMatch = toolName.match(/^([^_]+)_/);
        const serverName = serverNameMatch ? serverNameMatch[1] : 'unknown';

        // Extract description (everything after the first word)
        const description = textContent.replace(/^\S+\s*/, '').trim();
        const serverSimilarityBoost = serverScoreMap.get(serverName);

        return {
          serverName,
          toolName,
          description,
          inputSchema: {},
          similarity:
            serverSimilarityBoost !== undefined
              ? result.similarity * 0.8 + serverSimilarityBoost * 0.2
              : result.similarity,
          searchableText: textContent,
        };
      })
      .sort((a, b) => b.similarity - a.similarity);
  } catch (error) {
    console.error(
      'Error searching tools by vector',
      safeStringify({ query, limit, threshold, error }),
    );
    return [];
  }
};

/**
 * Get all available tools in vector database
 * @param serverNames Optional array of server names to filter by
 */
export const getAllVectorizedTools = async (
  serverNames?: string[],
): Promise<
  Array<{
    serverName: string;
    toolName: string;
    description: string;
    inputSchema: any;
  }>
> => {
  try {
    const config = await getOpenAIConfig();
    const vectorRepository = getRepositoryFactory(
      'vectorEmbeddings',
    )() as VectorEmbeddingRepository;

    // Try to determine what dimension our database is using
    let dimensionsToUse = getDimensionsForModel(config.embeddingModel); // Default based on the model selected

    try {
      const result = await getAppDataSource().query(`
        SELECT atttypmod as dimensions
        FROM pg_attribute 
        WHERE attrelid = 'vector_embeddings'::regclass 
        AND attname = 'embedding'
      `);

      if (result && result.length > 0 && result[0].dimensions) {
        const rawValue = result[0].dimensions;

        if (rawValue === -1) {
          // No type modifier specified
          dimensionsToUse = getDimensionsForModel(config.embeddingModel);
        } else {
          // For this version of pgvector, atttypmod stores the dimension value directly
          dimensionsToUse = rawValue;
        }
      }
    } catch (error: any) {
      console.warn('Could not determine vector dimensions from database', {
        error: error?.message,
      });
    }

    // Get all tool embeddings
    const results = await vectorRepository.searchSimilar(
      new Array(dimensionsToUse).fill(0), // Zero vector with dimensions matching the database
      1000, // Large limit
      -1, // No threshold (get all)
      ['tool'],
    );

    // Filter by server names if provided
    let filteredResults = results;
    if (serverNames && serverNames.length > 0) {
      filteredResults = results.filter((result) => {
        if (typeof result.embedding.metadata === 'string') {
          try {
            const parsedMetadata = JSON.parse(result.embedding.metadata);
            return serverNames.includes(parsedMetadata.serverName);
          } catch (error) {
            return false;
          }
        }
        return false;
      });
    }

    // Transform results
    return filteredResults.map((result) => {
      if (typeof result.embedding.metadata === 'string') {
        try {
          const parsedMetadata = JSON.parse(result.embedding.metadata);
          return {
            serverName: parsedMetadata.serverName,
            toolName: parsedMetadata.toolName,
            description: parsedMetadata.description,
            inputSchema: parsedMetadata.inputSchema,
          };
        } catch (error) {
          console.error(
            'Error parsing vector embedding metadata string',
            safeStringify({ error }),
          );
          return {
            serverName: 'unknown',
            toolName: 'unknown',
            description: '',
            inputSchema: {},
          };
        }
      }
      return {
        serverName: 'unknown',
        toolName: 'unknown',
        description: '',
        inputSchema: {},
      };
    });
  } catch (error) {
    console.error('Error getting all vectorized tools', safeStringify({ error, serverNames }));
    return [];
  }
};

/**
 * Remove tool and server embeddings for a server
 * @param serverName Server name
 */
export const removeServerToolEmbeddings = async (serverName: string): Promise<void> => {
  try {
    const smartRoutingConfig = await getSmartRoutingConfig();
    if (!smartRoutingConfig.dbUrl && !process.env.DB_URL) {
      console.warn('Skipping embedding cleanup because DB URL is not configured', {
        serverName,
      });
      return;
    }

    // Ensure database is initialized before using repository
    if (!isDatabaseConnected()) {
      console.info('Database not initialized, initializing...');
      await initializeDatabase();
    }

    const vectorRepository = getRepositoryFactory(
      'vectorEmbeddings',
    )() as VectorEmbeddingRepository;

    const removedCount = await vectorRepository.deleteByServerName(serverName);
    console.log('Removed server embeddings', safeStringify({ serverName, removedCount }));
  } catch (error) {
    console.error('Error removing server embeddings', safeStringify({ serverName, error }));
  }
};

/**
 * Sync all server tools embeddings when smart routing is first enabled
 * This function will scan all currently connected servers and save their tools as vector embeddings
 */
export const syncAllServerToolsEmbeddings = async (): Promise<void> => {
  try {
    console.log('Starting synchronization of all server tool embeddings');

    // Import getServersInfo to get all server information
    const { getServersInfo } = await import('./mcpService.js');

    const servers = await getServersInfo();
    let totalToolsSynced = 0;
    let serversSynced = 0;

    for (const server of servers) {
      if (server.status === 'connected' && server.tools && server.tools.length > 0) {
        try {
          console.log('Syncing tool embeddings for server', {
            serverName: server.name,
            toolCount: server.tools.length,
          });
          await saveToolsAsVectorEmbeddings(server.name, server.tools);
          totalToolsSynced += server.tools.length;
          serversSynced++;
        } catch (error) {
          console.warn(
            `[EMBED_SYNC_ERROR] Failed to sync tool embeddings for server "${server.name}"`,
          );
          console.error(
            'Failed to sync tool embeddings for server',
            safeStringify({
              serverName: server.name,
              error,
            }),
          );
        }
      } else if (server.status === 'connected' && (!server.tools || server.tools.length === 0)) {
        console.log('Connected server has no tools to sync', safeStringify({ serverName: server.name }));
      } else {
        console.log('Skipping server during tool embedding sync', {
          serverName: server.name,
          status: server.status,
        });
      }
    }

    console.log('Completed smart routing tool embedding sync', {
      totalToolsSynced,
      serversSynced,
    });
  } catch (error) {
    console.error('Error during smart routing tool embedding synchronization', { error });
    throw error;
  }
};

/**
 * Check database vector dimensions and ensure compatibility
 * @param dimensionsNeeded The number of dimensions required
 * @returns Promise that resolves when check is complete
 */
async function checkDatabaseVectorDimensions(dimensionsNeeded: number): Promise<boolean> {
  try {
    // First check if database is initialized
    if (!getAppDataSource().isInitialized) {
      console.info('Database not initialized, initializing...');
      await initializeDatabase();
    }

    // Check current vector dimension in the database
    // First try to get vector type info directly
    let vectorTypeInfo;
    try {
      vectorTypeInfo = await getAppDataSource().query(`
        SELECT 
          atttypmod,
          format_type(atttypid, atttypmod) as formatted_type
        FROM pg_attribute 
        WHERE attrelid = 'vector_embeddings'::regclass 
        AND attname = 'embedding'
      `);
    } catch (error) {
      console.warn('Could not get vector type info, falling back to atttypmod query');
    }

    // Fallback to original query
    const result = await getAppDataSource().query(`
      SELECT atttypmod as dimensions
      FROM pg_attribute 
      WHERE attrelid = 'vector_embeddings'::regclass 
      AND attname = 'embedding'
    `);

    let currentDimensions = 0;

    // Parse dimensions from result
    if (result && result.length > 0 && result[0].dimensions) {
      if (vectorTypeInfo && vectorTypeInfo.length > 0) {
        // Try to extract dimensions from formatted type like "vector(1024)"
        const match = vectorTypeInfo[0].formatted_type?.match(/vector\((\d+)\)/);
        if (match) {
          currentDimensions = parseInt(match[1]);
        }
      }

      // If we couldn't extract from formatted type, use the atttypmod value directly
      if (currentDimensions === 0) {
        const rawValue = result[0].dimensions;

        if (rawValue === -1) {
          // No type modifier specified
          currentDimensions = 0;
        } else {
          // For this version of pgvector, atttypmod stores the dimension value directly
          currentDimensions = rawValue;
        }
      }
    }

    // Also check the dimensions stored in actual records for validation
    try {
      const recordCheck = await getAppDataSource().query(`
        SELECT dimensions, model, COUNT(*) as count
        FROM vector_embeddings 
        GROUP BY dimensions, model
        ORDER BY count DESC
        LIMIT 5
      `);

      if (recordCheck && recordCheck.length > 0) {
        // If we couldn't determine dimensions from schema, use the most common dimension from records
        if (currentDimensions === 0 && recordCheck[0].dimensions) {
          currentDimensions = recordCheck[0].dimensions;
        }
      }
    } catch (error) {
      console.warn('Could not check vector dimensions from actual records', { error });
    }

    // If no dimensions are set or they don't match what we need, handle the mismatch
    if (currentDimensions === 0 || currentDimensions !== dimensionsNeeded) {
      console.log('Vector dimensions mismatch detected', {
        currentDimensions,
        dimensionsNeeded,
      });

      if (currentDimensions === 0) {
        console.log('Setting up vector dimensions for the first time...');
      } else {
        console.log('Dimension mismatch detected. Clearing existing incompatible vector data...');

        // Clear all existing vector embeddings with mismatched dimensions
        await clearMismatchedVectorData(dimensionsNeeded);
      }

      // Drop any existing index BEFORE altering the column type.
      // This is required because PostgreSQL attempts to rebuild the index
      // automatically during ALTER COLUMN, which fails when the new dimensions
      // exceed the vector type HNSW limit (2000). For example, switching from
      // 100-dimensional (fallback) to 3072-dimensional (gemini-embedding-001 or
      // text-embedding-3-large) vectors would trigger error code 54000 from
      // hnswbuild.c without this pre-emptive drop.
      try {
        await getAppDataSource().query(
          `DROP INDEX IF EXISTS idx_vector_embeddings_embedding;`,
        );
      } catch (dropError: any) {
        console.warn('Could not drop existing vector index before ALTER', {
          error: dropError?.message,
        });
      }

      // Alter the column type with the new dimensions
      // Use halfvec for dimensions > 2000, vector otherwise
      const vectorType = dimensionsNeeded <= VECTOR_MAX_DIMENSIONS ? 'vector' : 'halfvec';
      console.log('Using vector storage type for configured dimensions', {
        vectorType,
        dimensionsNeeded,
      });

      await getAppDataSource().query(`
        ALTER TABLE vector_embeddings 
        ALTER COLUMN embedding TYPE ${vectorType}(${dimensionsNeeded});
      `);

      // Create appropriate vector index using the helper function
      const result = await createVectorIndex(getAppDataSource(), dimensionsNeeded);
      if (!result.success) {
        console.log('Continuing without optimized vector index...');
      }

      console.log('Successfully configured vector dimensions', { dimensionsNeeded });
      // Only signal that a full resync is needed when existing data was cleared due
      // to a real dimension change. When currentDimensions === 0 it is a first-time
      // setup — there are no stale embeddings to re-generate.
      return currentDimensions !== 0;
    }

    return false;
  } catch (error: any) {
    console.error('Error checking or updating vector dimensions', { error });
    throw new Error(`Vector dimension check failed: ${error?.message || 'Unknown error'}`);
  }
}

/**
 * Clear vector embeddings with mismatched dimensions
 * @param expectedDimensions The expected dimensions
 * @returns Promise that resolves when cleanup is complete
 */
async function clearMismatchedVectorData(expectedDimensions: number): Promise<void> {
  try {
    console.log(
      `Clearing vector embeddings with dimensions different from ${expectedDimensions}...`,
    );

    // Delete all embeddings that don't match the expected dimensions
    await getAppDataSource().query(
      `
      DELETE FROM vector_embeddings 
      WHERE dimensions != $1
    `,
      [expectedDimensions],
    );

    console.log('Successfully cleared mismatched vector embeddings');
  } catch (error: any) {
    console.error('Error clearing mismatched vector data:', error);
    throw error;
  }
}
