import { sanitizeStringForLogging } from './serialization.js';

const LOG_SUMMARY_LIMIT = 8;

const getValueTypeForLogging = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  if (value === null) {
    return 'null';
  }
  if (value && typeof value === 'object') {
    return `object(${Object.keys(value as Record<string, unknown>).length} keys)`;
  }
  return typeof value;
};

const summarizeObjectShapeForLogging = (
  value: Record<string, unknown>,
): Record<string, unknown> => {
  const entries = Object.entries(value);
  return {
    keyCount: entries.length,
    keys: entries.slice(0, LOG_SUMMARY_LIMIT).map(([key]) => key),
    valueTypes: Object.fromEntries(
      entries
        .slice(0, LOG_SUMMARY_LIMIT)
        .map(([key, entryValue]) => [key, getValueTypeForLogging(entryValue)]),
    ),
    truncated: entries.length > LOG_SUMMARY_LIMIT || undefined,
  };
};

export const summarizeArgumentsForLogging = (value: unknown): Record<string, unknown> => {
  if (value === undefined) {
    return { present: false };
  }

  if (Array.isArray(value)) {
    return {
      present: true,
      type: 'array',
      length: value.length,
      itemTypes: Array.from(new Set(value.slice(0, LOG_SUMMARY_LIMIT).map(getValueTypeForLogging))),
      truncated: value.length > LOG_SUMMARY_LIMIT || undefined,
    };
  }

  if (value && typeof value === 'object') {
    return {
      present: true,
      type: 'object',
      ...summarizeObjectShapeForLogging(value as Record<string, unknown>),
    };
  }

  return {
    present: true,
    type: getValueTypeForLogging(value),
  };
};

const summarizeTextPayloadForLogging = (text: string): Record<string, unknown> => ({
  textLength: text.length,
  looksLikeJson: /^[[{]/.test(text.trim()) || undefined,
  wasSanitized: sanitizeStringForLogging(text) !== text || undefined,
});

const summarizeContentItemForLogging = (item: unknown): Record<string, unknown> => {
  if (!item || typeof item !== 'object') {
    return { type: getValueTypeForLogging(item) };
  }

  const record = item as Record<string, unknown>;
  return {
    type: typeof record.type === 'string' ? record.type : 'object',
    keys: Object.keys(record).slice(0, LOG_SUMMARY_LIMIT),
    text: typeof record.text === 'string' ? summarizeTextPayloadForLogging(record.text) : undefined,
    truncated: Object.keys(record).length > LOG_SUMMARY_LIMIT || undefined,
  };
};

export const summarizeToolResultForLogging = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object') {
    return { type: getValueTypeForLogging(value) };
  }

  const record = value as Record<string, unknown>;
  const summary: Record<string, unknown> = {
    type: 'object',
    ...summarizeObjectShapeForLogging(record),
  };

  if (typeof record.isError === 'boolean') {
    summary.isError = record.isError;
  }

  if (Array.isArray(record.content)) {
    summary.contentCount = record.content.length;
    summary.content = record.content
      .slice(0, LOG_SUMMARY_LIMIT)
      .map((item) => summarizeContentItemForLogging(item));
    summary.contentTruncated = record.content.length > LOG_SUMMARY_LIMIT || undefined;
  }

  return summary;
};

export const summarizePromptForLogging = (prompt: unknown): Record<string, unknown> => {
  if (!prompt || typeof prompt !== 'object') {
    return { type: getValueTypeForLogging(prompt) };
  }

  const record = prompt as Record<string, unknown>;
  const summary: Record<string, unknown> = {
    type: 'object',
    ...summarizeObjectShapeForLogging(record),
  };

  if (Array.isArray(record.messages)) {
    const messages = record.messages as Array<Record<string, unknown>>;
    summary.messageCount = messages.length;
    summary.messages = messages.slice(0, LOG_SUMMARY_LIMIT).map((message) => ({
      role: typeof message.role === 'string' ? message.role : undefined,
      contentType:
        message.content && typeof message.content === 'object'
          ? (message.content as Record<string, unknown>).type
          : getValueTypeForLogging(message.content),
      text:
        message.content &&
        typeof message.content === 'object' &&
        typeof (message.content as Record<string, unknown>).text === 'string'
          ? summarizeTextPayloadForLogging(
              String((message.content as Record<string, unknown>).text),
            )
          : undefined,
    }));
    summary.messagesTruncated = messages.length > LOG_SUMMARY_LIMIT || undefined;
  }

  return summary;
};
