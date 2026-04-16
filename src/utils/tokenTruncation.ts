/**
 * Token-aware text truncation utilities for embedding generation.
 *
 * Provides precise tokenization for known model families and a conservative
 * heuristic fallback for unknown models.
 *
 * Model families and strategies:
 * - OpenAI / Azure (text-embedding-*):  BPE cl100k_base via gpt-tokenizer (exact)
 * - BAAI/BGE and HuggingFace models:    Tokenizer via @huggingface/tokenizers (exact)
 * - Google Gemini (gemini-embedding-*): countTokens API via @google/genai (exact)
 * - Unknown models:                     heuristic maxTokens * 3 chars (approximate)
 */

/**
 * Per-model token limits.
 * Order matters: more specific entries must appear before generic ones.
 * bge-m3 is explicitly listed before the generic 'bge' catch-all because
 * its real limit (8192 tokens) differs substantially from the conservative
 * 512 used for other BGE variants.
 */
const MODEL_TOKEN_LIMITS: Array<[string, number]> = [
  ['text-embedding-3-small', 8191],
  ['text-embedding-3-large', 8191],
  ['text-embedding-ada-002', 8191],
  ['gemini-embedding-001', 2048],
  ['bge-m3', 8192],
];

/**
 * Returns the default maximum token limit for a given embedding model name.
 * Used when no explicit limit is configured via EMBEDDING_MAX_TOKENS or
 * smartRouting.embeddingMaxTokens.
 */
export function getModelDefaultTokenLimit(model: string): number {
  const lower = model.toLowerCase();
  for (const [pattern, limit] of MODEL_TOKEN_LIMITS) {
    if (lower.includes(pattern)) {
      return limit;
    }
  }
  // For other BGE variants (bge-large-en, bge-small-zh, etc.) use conservative limit
  if (lower.includes('bge')) {
    return 512;
  }
  // Default conservative limit: safe for entirely unknown models.
  // Users can raise it with EMBEDDING_MAX_TOKENS if they know their model supports more.
  return 512;
}

// ─────────────────────────────────────────────────────────────────────────────
// Model family detection helpers
// ─────────────────────────────────────────────────────────────────────────────

const OPENAI_MODELS = new Set(['text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002']);

function isOpenAIModel(model: string): boolean {
  return OPENAI_MODELS.has(model.toLowerCase());
}

function isGeminiModel(model: string): boolean {
  return model.toLowerCase() === 'gemini-embedding-001';
}

function isBgeM3Model(model: string): boolean {
  return model.toLowerCase().includes('bge-m3');
}

export function truncateWithHeuristic(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 3;
  return text.length <= maxChars ? text : text.substring(0, maxChars);
}

// ─────────────────────────────────────────────────────────────────────────────
// Branch 1 — OpenAI / Azure: BPE cl100k_base via gpt-tokenizer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Truncates text using OpenAI's BPE tokenizer (cl100k_base).
 *
 * Encodes the input text into tokens using the gpt-tokenizer library,
 * which implements the exact cl100k_base BPE vocabulary used by OpenAI's
 * embedding models (text-embedding-3-small, text-embedding-3-large, text-embedding-ada-002).
 * If the token count exceeds maxTokens, decodes the truncated token sequence back to text.
 *
 * @param text       The input text to truncate.
 * @param maxTokens  The maximum number of tokens allowed.
 * @returns          The original text if it fits, or a truncated prefix.
 */
async function truncateWithGptTokenizer(text: string, maxTokens: number): Promise<string> {
  const { encode, decode } = await import('gpt-tokenizer');
  const tokens = encode(text);
  if (tokens.length <= maxTokens) {
    return text;
  }
  return decode(tokens.slice(0, maxTokens));
}

// ─────────────────────────────────────────────────────────────────────────────
// Branch 2 — HuggingFace / BGE: Tokenizer (no ONNX, pure JS tokenisation)
// ─────────────────────────────────────────────────────────────────────────────

// Primary and mirror endpoints for tokenizer downloads.
// The mirror is used as a fallback for regions where huggingface.co is blocked (e.g. China).
const HF_OFFICIAL_HOST = 'https://huggingface.co/';
const HF_MIRROR_HOST = 'https://hf-mirror.com/';
const HF_FETCH_TIMEOUT_MS = 10_000;

// Cache key includes the remote host so a failed attempt from one endpoint
// does not prevent a successful download from the other.
interface HFTokenizerEncodeResult {
  ids: ArrayLike<number | bigint>;
}

interface HFTokenizer {
  encode(text: string): HFTokenizerEncodeResult;
  decode(ids: ArrayLike<number | bigint>, options?: { skip_special_tokens?: boolean }): string;
}

const tokenizerCache = new Map<string, HFTokenizer>();

// In-flight download promises: deduplicates concurrent requests for the same key,
// ensuring only one download attempt is made even when multiple callers arrive simultaneously.
const tokenizerInFlight = new Map<string, Promise<HFTokenizer>>();

// Host health state: tracks hosts that have recently failed so that downstream
// callers skip them during the TTL window instead of re-attempting and logging noise.
// The problem is structural (regional network blocking), not transient, so the TTL
// is intentionally long to avoid repeated futile connection attempts.
const HF_HOST_UNHEALTHY_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface HostHealth {
  unhealthyUntil: number;
  lastError?: string;
}

const hostHealth = new Map<string, HostHealth>();

function isHostUnhealthy(host: string): boolean {
  const health = hostHealth.get(host);
  if (!health) return false;
  if (Date.now() < health.unhealthyUntil) return true;
  hostHealth.delete(host); // TTL expired — allow retry
  return false;
}

function markHostUnhealthy(host: string, error: unknown): void {
  hostHealth.set(host, {
    unhealthyUntil: Date.now() + HF_HOST_UNHEALTHY_TTL_MS,
    lastError: error instanceof Error ? error.message : String(error),
  });
}

function markHostHealthy(host: string): void {
  hostHealth.delete(host);
}

/**
 * Fetches or retrieves a cached HuggingFace tokenizer for a given model,
 * downloading tokenizer files from the specified remote host.
 *
 * Models like BAAI/bge-m3 are public and do not require authentication.
 * The tokenizer is cached per (modelId, remoteHost) pair to allow independent
 * retries against the official host and the mirror without cross-contamination.
 *
 * Concurrent calls for the same (modelId, remoteHost) pair share a single in-flight
 * promise so the tokenizer is downloaded exactly once.
 *
 * @param modelId     The fully-qualified HuggingFace Hub model ID (e.g., "BAAI/bge-m3").
 * @param remoteHost  The base URL of the host to download from.
 * @returns           The cached or freshly-downloaded tokenizer instance.
 */
function buildHFTokenizerFileUrl(modelId: string, remoteHost: string, filename: string): string {
  const normalizedHost = remoteHost.replace(/\/+$/, '');
  return `${normalizedHost}/${modelId}/resolve/main/${filename}`;
}

async function fetchHFJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(HF_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function fetchOptionalHFJson(url: string): Promise<unknown> {
  try {
    return await fetchHFJson(url);
  } catch {
    return {};
  }
}

async function loadHFTokenizer(modelId: string, remoteHost: string): Promise<HFTokenizer> {
  const { Tokenizer } = await import('@huggingface/tokenizers');
  const [tokenizerJson, tokenizerConfig] = await Promise.all([
    fetchHFJson(buildHFTokenizerFileUrl(modelId, remoteHost, 'tokenizer.json')),
    fetchOptionalHFJson(buildHFTokenizerFileUrl(modelId, remoteHost, 'tokenizer_config.json')),
  ]);
  return new Tokenizer(
    tokenizerJson as Record<string, unknown>,
    tokenizerConfig as Record<string, unknown>,
  ) as unknown as HFTokenizer;
}

async function getHFTokenizer(modelId: string, remoteHost: string): Promise<HFTokenizer> {
  const cacheKey = `${modelId}@${remoteHost}`;

  // Fast path: cached tokenizer is available
  if (tokenizerCache.has(cacheKey)) {
    return tokenizerCache.get(cacheKey)!;
  }

  // Return in-flight promise to deduplicate concurrent downloads for the same key
  if (tokenizerInFlight.has(cacheKey)) {
    return tokenizerInFlight.get(cacheKey)!;
  }

  const downloadPromise = (async () => {
    try {
      const tokenizer = await loadHFTokenizer(modelId, remoteHost);
      tokenizerCache.set(cacheKey, tokenizer);
      return tokenizer;
    } finally {
      tokenizerInFlight.delete(cacheKey);
    }
  })();

  tokenizerInFlight.set(cacheKey, downloadPromise);
  return downloadPromise;
}

/**
 * Resolves a shorthand model name to a fully-qualified HuggingFace Hub repo ID.
 * BAAI/bge-m3 is a public model — no HF_TOKEN is required to download its
 * tokenizer.json file.
 */
function getHFModelId(model: string): string {
  if (model.includes('/')) {
    // Already fully qualified (e.g. "BAAI/bge-m3", "sentence-transformers/all-MiniLM-L6-v2")
    return model;
  }
  const lower = model.toLowerCase();
  if (lower.includes('bge-m3')) {
    return 'BAAI/bge-m3';
  }
  if (lower.includes('bge')) {
    return `BAAI/${model}`;
  }
  return model;
}

/**
 * Truncates text using a HuggingFace tokenizer (BAAI/BGE and other transformer models).
 *
 * Downloads tokenizer files from the Hugging Face Hub (or mirror) and uses the
 * lightweight @huggingface/tokenizers package to tokenize input text with the
 * model's own vocabulary, then decodes a truncated token sequence back to text.
 * This provides exact tokenization matching the model's behavior, with tokenizer
 * instances cached to avoid repeated downloads.
 * 
 * Uses a three-tier fallback strategy to ensure robustness across all deployment environments:
 *   1. Official HuggingFace Hub (huggingface.co)
 *   2. hf-mirror.com — accessible in regions where huggingface.co is blocked (e.g. China)
 *   3. Conservative character-based heuristic (~3 chars per token)
 *
 * @param text       The input text to truncate.
 * @param maxTokens  The maximum number of tokens allowed.
 * @param model      The model identifier (shorthand or fully-qualified HF Hub ID).
 * @returns          The original text if it fits, or a truncated prefix.
 */
async function truncateWithHFTokenizer(
  text: string,
  maxTokens: number,
  model: string,
): Promise<string> {
  const modelId = getHFModelId(model);

  // Helper: apply token-level truncation using a downloaded tokenizer instance.
  const tokenizeAndTruncate = (tokenizer: HFTokenizer): string => {
    const encoded = tokenizer.encode(text);
    const rawIds: ArrayLike<number | bigint> = encoded.ids;
    const ids = Array.from(rawIds as ArrayLike<number>).map(Number);
    if (ids.length <= maxTokens) {
      return text;
    }
    const truncatedIds = ids.slice(0, maxTokens);
    return tokenizer.decode(truncatedIds, { skip_special_tokens: true });
  };

  // Tier 1: Official HuggingFace Hub — skipped when marked unhealthy (TTL active) to avoid
  // log noise and latency in deployments where the host is permanently blocked (e.g. China).
  if (isHostUnhealthy(HF_OFFICIAL_HOST)) {
    const health = hostHealth.get(HF_OFFICIAL_HOST)!;
    console.warn(
      `Skipping HuggingFace Hub (marked unhealthy until ${new Date(health.unhealthyUntil).toISOString()}, TTL active). Trying hf-mirror.com directly for model "${model}" (${modelId}).`,
    );
  } else {
    try {
      const tokenizer = await getHFTokenizer(modelId, HF_OFFICIAL_HOST);
      const result = await tokenizeAndTruncate(tokenizer);
      markHostHealthy(HF_OFFICIAL_HOST);
      return result;
    } catch (error) {
      markHostUnhealthy(HF_OFFICIAL_HOST, error);
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `HuggingFace Hub unreachable for model "${model}" (${modelId}): ${message}. Retrying with hf-mirror.com...`,
        error,
      );
    }
  }

  // Tier 2: hf-mirror.com (accessible in regions where huggingface.co is blocked)
  try {
    const tokenizer = await getHFTokenizer(modelId, HF_MIRROR_HOST);
    const result = await tokenizeAndTruncate(tokenizer);
    markHostHealthy(HF_MIRROR_HOST);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `hf-mirror.com also failed for model "${model}" (${modelId}): ${message}. Falling back to character-based heuristic truncation.`,
      error,
    );
  }

  // Tier 3: Conservative character-based heuristic (~3 chars per token).
  // This ensures embedding generation can proceed even when all tokenizer
  // download attempts fail.
  return truncateWithHeuristic(text, maxTokens);
}

// ─────────────────────────────────────────────────────────────────────────────
// Branch 3 — Google Gemini: countTokens API with binary-search bisection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Truncates text using Google Gemini's countTokens API.
 *
 * Uses the @google/genai library to query the exact token count from Gemini's
 * tokenizer (SentencePiece). To minimize API calls, a binary-search algorithm
 * finds the longest text prefix whose token count does not exceed maxTokens.
 * If no Google API key is configured, falls back to a conservative 3× char heuristic.
 *
 * @param text       The input text to truncate.
 * @param maxTokens  The maximum number of tokens allowed.
 * @param model      The Gemini model identifier (e.g., "gemini-embedding-001").
 * @returns          The original text if it fits, or a truncated prefix.
 */
async function truncateWithGeminiAPI(
  text: string,
  maxTokens: number,
  model: string,
  apiKey?: string,
): Promise<string> {
  // Pre-filter: if char count is safely within 2× the token limit the text fits
  // (each SentencePiece token is at least 1 character), so skip the network call.
  if (text.length <= maxTokens * 2) {
    return text;
  }

  // Use the apiKey provided from smartRouting config (with priority: env var → settings → default)
  const finalApiKey = apiKey || '';
  if (!finalApiKey) {
    // No Google Gemini API key configured (OPENAI_API_KEY) — fall back to conservative heuristic
    return truncateWithHeuristic(text, maxTokens);
  }

  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({ apiKey: finalApiKey });

  const countTokens = async (chunk: string): Promise<number> => {
    const result = await ai.models.countTokens({ model, contents: chunk });
    return result.totalTokens ?? 0;
  };

  const totalTokens = await countTokens(text);
  if (totalTokens <= maxTokens) {
    return text;
  }

  // Binary search: find the longest prefix whose token count ≤ maxTokens.
  // This minimizes the number of countTokens calls (O(log n) on text length).
  let lo = 0;
  let hi = text.length;
  while (lo < hi - 1) {
    const mid = Math.floor((lo + hi) / 2);
    const count = await countTokens(text.slice(0, mid));
    if (count <= maxTokens) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return text.slice(0, lo);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main entry point
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Truncates `text` so that its token count does not exceed `maxTokens`,
 * using the most accurate tokenization strategy available for the given model.
 *
 * The function is async because the Gemini branch may require a network call.
 * All callers in vectorSearchService.ts must use `await`.
 *
 * NOTE: When using Google Gemini embeddings (gemini-embedding-*), the Google AI
 * Studio API key must be provided via the `OPENAI_API_KEY` environment variable,
 * not `GOOGLE_API_KEY`. This allows centralized API key configuration across all
 * embedding model families.
 *
 * @param text      Input text to potentially truncate.
 * @param maxTokens Maximum number of tokens allowed.
 * @param model     Embedding model identifier (selects truncation strategy).
 * @param apiKey    Optional API key for Gemini models (from smartRouting config).
 * @returns         The original text if it fits, or a truncated prefix.
 */
export async function truncateToTokenLimit(
  text: string,
  maxTokens: number,
  model: string,
  apiKey?: string,
): Promise<string> {
  if (isOpenAIModel(model)) {
    return truncateWithGptTokenizer(text, maxTokens);
  }
  if (isGeminiModel(model)) {
    return truncateWithGeminiAPI(text, maxTokens, model, apiKey);
  }
  if (isBgeM3Model(model)) {
    return truncateWithHFTokenizer(text, maxTokens, model);
  }
  // Fallback heuristic: ~3 chars per token (conservative for CJK/multilingual).
  // Ratio is safe for English (~4 chars/token) and CJK (~2 chars/token).
  return truncateWithHeuristic(text, maxTokens);
}
