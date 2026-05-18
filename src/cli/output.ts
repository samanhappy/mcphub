// stdout/stderr helpers. Honors NO_COLOR and non-TTY stdout. JSON output is
// always emitted via printJson() so --json never mixes with ANSI escapes.

const colorEnabled =
  process.env.NO_COLOR === undefined &&
  process.env.TERM !== 'dumb' &&
  process.stdout.isTTY === true;

const wrap = (code: number, text: string): string =>
  colorEnabled ? `\x1b[${code}m${text}\x1b[0m` : text;

export const red = (s: string): string => wrap(31, s);
export const green = (s: string): string => wrap(32, s);
export const yellow = (s: string): string => wrap(33, s);
export const cyan = (s: string): string => wrap(36, s);
export const dim = (s: string): string => wrap(2, s);
export const bold = (s: string): string => wrap(1, s);

export function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

export function printLine(text = ''): void {
  process.stdout.write(text + '\n');
}

export function printError(text: string): void {
  process.stderr.write(red(text) + '\n');
}

export function printWarn(text: string): void {
  process.stderr.write(yellow(text) + '\n');
}

// Minimal column-aligned table printer. Renders to stdout. Columns are sized
// by the widest cell in each column; values are coerced via String().
export function printTable(rows: Array<Record<string, unknown>>, columns: string[]): void {
  if (rows.length === 0) {
    printLine(dim('(empty)'));
    return;
  }
  const widths = columns.map((col) =>
    Math.max(col.length, ...rows.map((r) => String(r[col] ?? '').length)),
  );
  const renderRow = (cells: string[]): string =>
    cells.map((cell, i) => cell.padEnd(widths[i])).join('  ');

  printLine(bold(renderRow(columns)));
  printLine(dim(renderRow(widths.map((w) => '-'.repeat(w)))));
  for (const row of rows) {
    printLine(renderRow(columns.map((col) => String(row[col] ?? ''))));
  }
}

export function maskToken(token: string | undefined): string {
  if (!token) return '(none)';
  if (token.length <= 4) return '*'.repeat(token.length);
  return '*'.repeat(Math.max(token.length - 4, 4)) + token.slice(-4);
}
