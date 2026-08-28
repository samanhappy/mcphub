/**
 * Frontend server-name helpers.
 *
 * Server names become part of downstream tool identifiers
 * (`${serverName}-${toolName}`), so the MCP tool-name charset applies to them
 * indirectly. These helpers mirror the backend rule in
 * `src/utils/serverNameValidation.ts`.
 */

export const SERVER_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export const SERVER_NAME_MAX_LENGTH = 128;

export const isValidServerName = (name: string): boolean => {
  const trimmed = name.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= SERVER_NAME_MAX_LENGTH &&
    SERVER_NAME_PATTERN.test(trimmed) &&
    !trimmed.includes('..')
  );
};

/**
 * Turn an arbitrary string (e.g. an official Registry reverse-DNS name like
 * `io.github.user/weather`) into a charset-safe server name. Characters
 * outside `[A-Za-z0-9._-]` become `-`; consecutive dots collapse; leading /
 * trailing hyphens are trimmed and the result is length-capped. Falls back to
 * `'server'` for an empty result.
 */
export const slugifyServerName = (name: string): string => {
  const slugged = name
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^-+|-+$/g, '')
    .slice(0, SERVER_NAME_MAX_LENGTH);
  return slugged || 'server';
};
