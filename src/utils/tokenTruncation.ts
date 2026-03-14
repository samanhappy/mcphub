/**
 * Token-aware text truncation utilities for embedding generation.
 *
 * Provides precise tokenization for known model families and a conservative
 * heuristic fallback for unknown models.
 *
 * Model families and strategies:
 * - OpenAI / Azure (text-embedding-*):  BPE cl100k_base via gpt-tokenizer (exact)
 * - BAAI/BGE and HuggingFace models:    AutoTokenizer via @huggingface/transformers (exact)
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

function truncateWithHeuristic(text: string, maxTokens: number): string {
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
// Branch 2 — HuggingFace / BGE: AutoTokenizer (no ONNX, pure JS tokenisation)
// ─────────────────────────────────────────────────────────────────────────────

// Tokenizer instances are cached in memory to avoid repeated HF Hub downloads
const tokenizerCache = new Map<string, ReturnType<typeof import('@huggingface/transformers')['AutoTokenizer']['from_pretrained']> extends Promise<infer T> ? T : never>();

/**
 * Fetches or retrieves a cached HuggingFace tokenizer for a given model.
 *
 * The tokenizer is downloaded from HuggingFace Hub (public models like BAAI/bge-m3
 * do not require authentication). Once downloaded, the tokenizer is cached in memory
 * to avoid redundant network requests on subsequent calls.
 *
 * @param modelId  The fully-qualified HuggingFace Hub model ID (e.g., "BAAI/bge-m3").
 * @returns        The cached or freshly-downloaded tokenizer instance.
 */
 
async function getHFTokenizer(modelId: string): Promise<any> {
  if (!tokenizerCache.has(modelId)) {
    const { AutoTokenizer } = await import('@huggingface/transformers');
    const tokenizer = await AutoTokenizer.from_pretrained(modelId);
    tokenizerCache.set(modelId, tokenizer);
  }
  return tokenizerCache.get(modelId);
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
 * Truncates text using a HuggingFace AutoTokenizer (BAAI/BGE and other transformer models).
 *
 * Leverages the @huggingface/transformers library to tokenize input text using
 * the model's own SentencePiece or WordPiece tokenizer, then decodes a truncated
 * token sequence back to text. This provides exact tokenization matching the model's
 * vocabulary and behavior, with tokenizer instances cached to avoid repeated downloads.
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
  try {
    const modelId = getHFModelId(model);
    const tokenizer = await getHFTokenizer(modelId);
    // Tokenize without automatic truncation so we can apply the exact limit
    const encoded = await tokenizer(text, { padding: false, truncation: false });
    // input_ids.data is BigInt64Array or Int32Array depending on the model/environment
    const rawIds: ArrayLike<number | bigint> = (encoded.input_ids as {
      data: ArrayLike<number | bigint>;
    }).data;
    const ids = Array.from(rawIds as ArrayLike<number>).map(Number);
    if (ids.length <= maxTokens) {
      return text;
    }
    const truncatedIds = ids.slice(0, maxTokens);
    return (await tokenizer.decode(truncatedIds, { skip_special_tokens: true })) as string;
  } catch (error) {
    console.warn(
      `Failed to load or use HuggingFace tokenizer for model '${model}', falling back to heuristic truncation:`,
      error,
    );
    return truncateWithHeuristic(text, maxTokens);
  }
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
