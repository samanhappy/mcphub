/**
 * Lightweight MCP tool-result compression.
 *
 * Design inspired by Headroom's Apache-2.0 content routing and log/search/diff
 * compression strategies, reimplemented for MCPHub.
 */
import type {
  ToolResultCompressionConfig,
  ToolResultCompressionStrategy,
} from '../types/index.js';
import { countTokens } from '../utils/tokenCost.js';
import { getCachedSystemConfig } from '../utils/systemConfigCache.js';
import { getSystemConfigDao } from '../dao/index.js';

const DEFAULT_CONFIG: Required<ToolResultCompressionConfig> = {
  enabled: false,
  minTokens: 2000,
  maxOutputTokens: 1200,
  strategy: 'auto',
};

const VALID_STRATEGIES = new Set<ToolResultCompressionStrategy>([
  'auto',
  'json',
  'log',
  'search',
  'diff',
  'text',
]);

type TextContentBlock = {
  type: string;
  text?: unknown;
  [key: string]: unknown;
};

type ToolResultLike = {
  content?: TextContentBlock[];
  isError?: boolean;
  [key: string]: unknown;
};

type CompressionMetadata = {
  strategy: Exclude<ToolResultCompressionStrategy, 'auto'>;
  omittedItems?: number;
  omittedLines?: number;
  omittedMatches?: number;
  omittedHunks?: number;
};

type TextCompressionResult = {
  text: string;
  metadata: CompressionMetadata;
};

export type ToolResultCompressionContext = {
  serverName?: string;
  toolName?: string;
  group?: string;
};

const normalizePositiveInteger = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : fallback;
};

export const normalizeToolResultCompressionConfig = (
  config?: ToolResultCompressionConfig,
): Required<ToolResultCompressionConfig> => {
  const strategy = config?.strategy;
  return {
    enabled: config?.enabled === true,
    minTokens: normalizePositiveInteger(config?.minTokens, DEFAULT_CONFIG.minTokens),
    maxOutputTokens: normalizePositiveInteger(
      config?.maxOutputTokens,
      DEFAULT_CONFIG.maxOutputTokens,
    ),
    strategy: strategy && VALID_STRATEGIES.has(strategy) ? strategy : DEFAULT_CONFIG.strategy,
  };
};

const getRuntimeConfig = async (): Promise<Required<ToolResultCompressionConfig>> => {
  const cached = getCachedSystemConfig();
  if (cached?.toolResultCompression) {
    return normalizeToolResultCompressionConfig(cached.toolResultCompression);
  }

  const systemConfig = await getSystemConfigDao().get();
  return normalizeToolResultCompressionConfig(systemConfig?.toolResultCompression);
};

const markerFor = (
  metadata: CompressionMetadata,
  originalTokens: number,
  compressedTokens: number,
): string => {
  const attrs: string[] = [
    `strategy=${metadata.strategy}`,
    `original_tokens=${originalTokens}`,
    `compressed_tokens=${compressedTokens}`,
  ];

  if (metadata.omittedItems) attrs.push(`omitted_items=${metadata.omittedItems}`);
  if (metadata.omittedLines) attrs.push(`omitted_lines=${metadata.omittedLines}`);
  if (metadata.omittedMatches) attrs.push(`omitted_matches=${metadata.omittedMatches}`);
  if (metadata.omittedHunks) attrs.push(`omitted_hunks=${metadata.omittedHunks}`);

  return `[mcphub:compressed-tool-result ${attrs.join(' ')}]`;
};

const tryParseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

const detectStrategy = (
  text: string,
  configured: ToolResultCompressionStrategy,
): Exclude<ToolResultCompressionStrategy, 'auto'> => {
  if (configured !== 'auto') return configured;

  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    if (tryParseJson(trimmed) !== undefined) return 'json';
  }
  if (/^(diff --git|diff --combined |diff --cc |--- a\/|@@\s+-\d+)/m.test(text)) {
    return 'diff';
  }
  const lines = text.split(/\r?\n/);
  const sample = lines.slice(0, 80);
  const searchMatches = sample.filter((line) => parseSearchLine(line) !== null).length;
  if (searchMatches >= Math.min(5, Math.max(2, Math.floor(sample.length * 0.35)))) {
    return 'search';
  }
  if (
    sample.some((line) =>
      /\b(ERROR|FAIL|FAILED|FATAL|CRITICAL|WARN|WARNING)\b|Traceback \(most recent call last\)|^\s*at\s+[\w.$]+\(/i.test(
        line,
      ),
    )
  ) {
    return 'log';
  }
  return 'text';
};

const safeStringify = (value: unknown): string => JSON.stringify(value, null, 2);

const stringifyJsonSample = (value: unknown, maxItems: number): { text: string; omitted: number } => {
  if (Array.isArray(value)) {
    const kept = value.slice(0, maxItems);
    return {
      text: safeStringify({
        items: kept,
        omittedItems: Math.max(0, value.length - kept.length),
        totalItems: value.length,
      }),
      omitted: Math.max(0, value.length - kept.length),
    };
  }

  if (!value || typeof value !== 'object') {
    return { text: safeStringify(value), omitted: 0 };
  }

  const entries = Object.entries(value as Record<string, unknown>);
  const output: Record<string, unknown> = {};
  let omitted = 0;

  for (const [key, entryValue] of entries) {
    if (Array.isArray(entryValue)) {
      const kept = entryValue.slice(0, maxItems);
      output[key] = {
        items: kept,
        omittedItems: Math.max(0, entryValue.length - kept.length),
        totalItems: entryValue.length,
      };
      omitted += Math.max(0, entryValue.length - kept.length);
    } else if (entryValue && typeof entryValue === 'object') {
      output[key] = summarizeObject(entryValue as Record<string, unknown>, maxItems);
    } else {
      output[key] = entryValue;
    }
  }

  return { text: safeStringify(output), omitted };
};

const summarizeObject = (value: Record<string, unknown>, maxItems: number): Record<string, unknown> => {
  const output: Record<string, unknown> = {};
  for (const [key, entryValue] of Object.entries(value)) {
    if (Array.isArray(entryValue)) {
      output[key] = {
        items: entryValue.slice(0, maxItems),
        omittedItems: Math.max(0, entryValue.length - maxItems),
        totalItems: entryValue.length,
      };
    } else if (typeof entryValue === 'string' && entryValue.length > 280) {
      output[key] = `${entryValue.slice(0, 180)} ... ${entryValue.slice(-80)}`;
    } else {
      output[key] = entryValue;
    }
  }
  return output;
};

const compressJson = (text: string): TextCompressionResult => {
  const parsed = tryParseJson(text);
  if (parsed === undefined) return compressText(text);
  const { text: compressed, omitted } = stringifyJsonSample(parsed, 5);
  return {
    text: compressed,
    metadata: { strategy: 'json', omittedItems: omitted },
  };
};

const uniqueByNormalizedMessage = (lines: string[]): string[] => {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const line of lines) {
    const normalized = line
      .toLowerCase()
      .replace(/\b0x[0-9a-f]+\b/g, '0xHEX')
      .replace(/\b\d+\b/g, 'N')
      .replace(/\/[^\s:]+/g, '/PATH');
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(line);
  }
  return output;
};

const compressLog = (text: string): TextCompressionResult => {
  const lines = text.split(/\r?\n/);
  const selected = new Set<number>();
  const importantPattern =
    /\b(ERROR|FAIL|FAILED|FATAL|CRITICAL|WARN|WARNING)\b|Traceback \(most recent call last\)|^\s*at\s+[\w.$]+\(|^\s*File ".*", line \d+|^=+\s*(FAILURES|ERRORS|short test summary info)|^[-=]{5,}$/i;

  lines.forEach((line, index) => {
    if (!importantPattern.test(line)) return;
    for (let i = Math.max(0, index - 2); i <= Math.min(lines.length - 1, index + 3); i += 1) {
      selected.add(i);
    }
  });

  lines.slice(Math.max(0, lines.length - 20)).forEach((_line, offset) => {
    selected.add(Math.max(0, lines.length - 20) + offset);
  });

  const ordered = Array.from(selected).sort((a, b) => a - b);
  const compressedLines = uniqueByNormalizedMessage(ordered.map((index) => lines[index]));
  return {
    text: compressedLines.join('\n'),
    metadata: {
      strategy: 'log',
      omittedLines: Math.max(0, lines.length - compressedLines.length),
    },
  };
};

type SearchLine = {
  file: string;
  line: number;
  body: string;
};

function parseSearchLine(line: string): SearchLine | null {
  if (/^(?:\d{4}-\d{2}-\d{2}|\d{2}:\d{2}:\d{2}|\[\d{4}-\d{2}-\d{2}|\[\d{2}:\d{2}:\d{2})/.test(line)) {
    return null;
  }
  const match = /^(.*?)(?::|-)(\d+)(?::|-)(.*)$/.exec(line);
  if (!match) return null;
  const parsedLine = Number(match[2]);
  if (!Number.isFinite(parsedLine)) return null;
  return { file: match[1], line: parsedLine, body: match[3] };
}

const compressSearch = (text: string): TextCompressionResult => {
  const lines = text.split(/\r?\n/);
  const byFile = new Map<string, SearchLine[]>();
  const passthrough: string[] = [];

  for (const line of lines) {
    const parsed = parseSearchLine(line);
    if (!parsed) {
      if (line.trim()) passthrough.push(line);
      continue;
    }
    const matches = byFile.get(parsed.file) ?? [];
    matches.push(parsed);
    byFile.set(parsed.file, matches);
  }

  if (byFile.size === 0) return compressText(text);

  const output: string[] = passthrough.slice(0, 10);
  let omitted = 0;
  const files = Array.from(byFile.entries()).slice(0, 20);
  omitted += Math.max(0, byFile.size - files.length);

  for (const [file, matches] of files) {
    const kept = matches.length <= 6
      ? matches
      : [...matches.slice(0, 4), ...matches.slice(-2)];
    output.push(...kept.map((match) => `${file}:${match.line}:${match.body}`));
    if (matches.length > kept.length) {
      omitted += matches.length - kept.length;
      output.push(`[... ${matches.length - kept.length} more matches in ${file}]`);
    }
  }

  return {
    text: output.join('\n'),
    metadata: { strategy: 'search', omittedMatches: omitted },
  };
};

const compressDiff = (text: string): TextCompressionResult => {
  const lines = text.split(/\r?\n/);
  const keep = new Set<number>();

  lines.forEach((line, index) => {
    if (
      /^(diff --git|diff --combined |diff --cc |index |--- |\+\+\+ |@@|Binary files|new file mode|deleted file mode)/.test(
        line,
      ) ||
      /^[+-](?![+-])/.test(line)
    ) {
      for (let i = Math.max(0, index - 2); i <= Math.min(lines.length - 1, index + 2); i += 1) {
        keep.add(i);
      }
    }
  });

  const ordered = Array.from(keep).sort((a, b) => a - b);
  const output: string[] = [];
  let last = -1;
  let omittedHunks = 0;
  for (const index of ordered) {
    if (last !== -1 && index > last + 1) {
      output.push(`[... ${index - last - 1} diff lines omitted]`);
      omittedHunks += 1;
    }
    output.push(lines[index]);
    last = index;
  }

  return {
    text: output.join('\n'),
    metadata: {
      strategy: 'diff',
      omittedLines: Math.max(0, lines.length - ordered.length),
      omittedHunks,
    },
  };
};

const compressText = (text: string): TextCompressionResult => {
  const lines = text.split(/\r?\n/);
  const keepHead = Math.min(40, Math.ceil(lines.length * 0.35));
  const keepTail = Math.min(30, Math.ceil(lines.length * 0.25));
  const head = lines.slice(0, keepHead);
  const tailStart = Math.max(keepHead, lines.length - keepTail);
  const tail = lines.slice(tailStart);
  const omitted = Math.max(0, tailStart - keepHead);
  const middle = omitted > 0 ? [`[... ${omitted} lines omitted]`] : [];
  return {
    text: [...head, ...middle, ...tail].join('\n'),
    metadata: { strategy: 'text', omittedLines: omitted },
  };
};

const compressByStrategy = (
  text: string,
  strategy: Exclude<ToolResultCompressionStrategy, 'auto'>,
): TextCompressionResult => {
  switch (strategy) {
    case 'json':
      return compressJson(text);
    case 'log':
      return compressLog(text);
    case 'search':
      return compressSearch(text);
    case 'diff':
      return compressDiff(text);
    case 'text':
      return compressText(text);
  }
};

const fitToTokenBudget = async (text: string, maxOutputTokens: number): Promise<string> => {
  if ((await countTokens(text)) <= maxOutputTokens) return text;

  const lines = text.split(/\r?\n/);
  let headCount = Math.min(30, Math.ceil(lines.length * 0.45));
  let tailCount = Math.min(20, Math.ceil(lines.length * 0.25));

  while (headCount > 5 || tailCount > 5) {
    const head = lines.slice(0, headCount);
    const tail = lines.slice(Math.max(headCount, lines.length - tailCount));
    const omitted = Math.max(0, lines.length - head.length - tail.length);
    const candidate = [...head, `[... ${omitted} lines omitted to fit output budget]`, ...tail].join(
      '\n',
    );
    if ((await countTokens(candidate)) <= maxOutputTokens) return candidate;
    headCount = Math.max(5, Math.floor(headCount * 0.75));
    tailCount = Math.max(5, Math.floor(tailCount * 0.75));
    if (headCount === 5 && tailCount === 5) break;
  }

  const maxChars = maxOutputTokens * 4;
  return `${text.slice(0, Math.floor(maxChars * 0.65))}\n[... content omitted to fit output budget]\n${text.slice(
    -Math.floor(maxChars * 0.25),
  )}`;
};

const compressTextBlock = async (
  text: string,
  config: Required<ToolResultCompressionConfig>,
): Promise<string> => {
  const originalTokens = await countTokens(text);
  if (originalTokens < config.minTokens) return text;

  const strategy = detectStrategy(text, config.strategy);
  const result = compressByStrategy(text, strategy);
  const fitted = await fitToTokenBudget(result.text, config.maxOutputTokens);
  const compressedTokens = await countTokens(fitted);

  if (compressedTokens >= originalTokens) return text;

  return `${markerFor(result.metadata, originalTokens, compressedTokens)}\n${fitted}`;
};

export const maybeCompressToolResult = async <T extends ToolResultLike>(
  result: T,
  _context: ToolResultCompressionContext = {},
): Promise<T> => {
  try {
    const config = await getRuntimeConfig();
    if (!config.enabled || result?.isError === true || !Array.isArray(result?.content)) {
      return result;
    }

    let changed = false;
    const content = await Promise.all(
      result.content.map(async (block) => {
        if (block?.type !== 'text' || typeof block.text !== 'string') return block;
        const text = await compressTextBlock(block.text, config);
        if (text === block.text) return block;
        changed = true;
        return { ...block, text };
      }),
    );

    return changed ? ({ ...result, content } as T) : result;
  } catch (error) {
    console.warn('Tool result compression failed, returning original result', {
      error: error instanceof Error ? error.message : String(error),
    });
    return result;
  }
};
