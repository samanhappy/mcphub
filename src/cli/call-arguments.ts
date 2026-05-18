import fs from 'node:fs';
import { CliUsageError } from './errors.js';

// Parse `key=value` pairs into a plain object. Type coercion:
//   42, 1.5            → number
//   true, false        → boolean
//   null               → null
//   @path              → JSON loaded from a file
//   {...} or [...]     → parsed as JSON literal
//   anything else      → string
//
// Quoted strings keep their text verbatim: key="42" stays as "42". The shell
// strips outer quotes before they reach argv, so we look for an explicit
// JSON-string form key=\"42\" (i.e. argv contains `key="42"`).

export interface ParsedCallArgs {
  args: Record<string, unknown>;
  extra: string[]; // positional args left over (none in normal use)
}

export interface CoerceOptions {
  fs?: Pick<typeof fs, 'readFileSync'>;
  noCoerce?: boolean;
}

export function parseCallArguments(argv: string[], options: CoerceOptions = {}): ParsedCallArgs {
  const args: Record<string, unknown> = {};
  const extra: string[] = [];
  const reader = options.fs ?? fs;

  for (const token of argv) {
    const eq = token.indexOf('=');
    if (eq <= 0) {
      extra.push(token);
      continue;
    }
    const key = token.slice(0, eq);
    const raw = token.slice(eq + 1);

    if (options.noCoerce) {
      args[key] = raw;
      continue;
    }

    args[key] = coerce(raw, reader);
  }

  return { args, extra };
}

function coerce(raw: string, reader: Pick<typeof fs, 'readFileSync'>): unknown {
  if (raw === 'null') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;

  if (raw.startsWith('@')) {
    const path = raw.slice(1);
    if (!path) throw new CliUsageError('@ prefix requires a file path');
    let content: string;
    try {
      content = reader.readFileSync(path, 'utf8');
    } catch (e) {
      throw new CliUsageError(`Failed to read file ${path}: ${(e as Error).message}`);
    }
    try {
      return JSON.parse(content);
    } catch (e) {
      throw new CliUsageError(`Failed to parse JSON from ${path}: ${(e as Error).message}`);
    }
  }

  if (
    raw.length > 1 &&
    ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']')))
  ) {
    try {
      return JSON.parse(raw);
    } catch {
      // fall through and keep as string — a value that happens to start with
      // a brace but isn't valid JSON is more likely meant literally.
    }
  }

  if (raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2) {
    // Explicit JSON string form — preserve the inner text without coercion.
    try {
      return JSON.parse(raw);
    } catch {
      return raw.slice(1, -1);
    }
  }

  if (isNumeric(raw)) {
    return Number(raw);
  }

  return raw;
}

function isNumeric(s: string): boolean {
  if (s === '' || s === '-' || s === '.') return false;
  // Preserve identifier-like strings such as zip codes and phone numbers:
  // a leading zero on a multi-digit integer keeps the value as a string.
  if (/^-?0\d/.test(s)) return false;
  return /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(s);
}
