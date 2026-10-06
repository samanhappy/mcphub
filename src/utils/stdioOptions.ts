export class StdioOptionsError extends Error {}

export const validateMaxBufferSize = (value: unknown): number | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new StdioOptionsError('options.maxBufferSize must be a positive safe integer in bytes');
  }
  return value;
};
