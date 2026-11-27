/**
 * JSON payloads are stored in `text` columns and parsed here, not by
 * TypeORM's `simple-json` type: `simple-json` calls `JSON.parse` while
 * hydrating, before any column transformer runs, so one row holding an empty
 * string (`servers.headers = ''`, written outside the normalising
 * persistence path) threw `JSON.parse('')` and took the whole server list
 * down. Reading such a payload as "absent" keeps the list serving; the next
 * write of that row stores valid JSON.
 *
 * `simple-json` and `text` are the same underlying Postgres type, so the
 * column mapping is unchanged.
 */
export const emptySafeJsonTransformer = {
  to: (value: unknown): string | null =>
    value === undefined || value === null ? null : JSON.stringify(value),
  from: (value: unknown): unknown => {
    if (value === null || value === undefined || value === '') {
      return undefined;
    }
    if (typeof value !== 'string') {
      return value;
    }
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  },
};
