import { sanitizeStringForLogging } from './serialization.js';

const STDERR_TAIL_LIMIT = 32_768;

type StderrStream = {
  on(event: 'data', listener: (data: Buffer | string) => void): unknown;
  on(event: 'end', listener: () => void): unknown;
};

type StdioDiagnosticState = {
  rawTail: string;
  pendingLine: string;
};

type ErrorWithUpstreamStderr = Error & {
  cause?: unknown;
  upstreamStderr?: string;
};

const diagnostics = new WeakMap<object, StdioDiagnosticState>();

const keepTail = (value: string): string => value.slice(-STDERR_TAIL_LIMIT);

export const observeStdioStderr = (
  transport: object,
  stderr: StderrStream,
  logLine: (line: string) => void,
): void => {
  const state: StdioDiagnosticState = {
    rawTail: '',
    pendingLine: '',
  };
  diagnostics.set(transport, state);

  const flushCompleteLines = (): void => {
    const lines = state.pendingLine.split(/\r?\n/);
    state.pendingLine = lines.pop() ?? '';
    for (const line of lines) {
      if (line.length > 0) {
        logLine(sanitizeStringForLogging(line));
      }
    }
  };

  stderr.on('data', (data) => {
    const chunk = data.toString();
    state.rawTail = keepTail(state.rawTail + chunk);
    state.pendingLine = keepTail(state.pendingLine + chunk);
    flushCompleteLines();
  });

  stderr.on('end', () => {
    if (state.pendingLine.length > 0) {
      logLine(sanitizeStringForLogging(state.pendingLine));
      state.pendingLine = '';
    }
  });
};

export const getStdioStderrTail = (transport: object): string | undefined => {
  const tail = diagnostics.get(transport)?.rawTail.trim();
  return tail ? sanitizeStringForLogging(tail) : undefined;
};

export const addStdioErrorContext = (error: unknown, transport: object): unknown => {
  const upstreamStderr = getStdioStderrTail(transport);
  if (!upstreamStderr) {
    return error;
  }

  if (error instanceof Error && Object.isExtensible(error)) {
    (error as ErrorWithUpstreamStderr).upstreamStderr = upstreamStderr;
    return error;
  }

  const contextualError = new Error(
    error instanceof Error ? error.message : String(error),
  ) as ErrorWithUpstreamStderr;
  contextualError.cause = error;
  contextualError.upstreamStderr = upstreamStderr;
  return contextualError;
};
