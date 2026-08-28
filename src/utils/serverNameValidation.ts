/**
 * Server name validation.
 *
 * Server names are embedded into downstream tool/prompt identifiers as
 * `${serverName}${nameSeparator}${toolName}` (see mcpService), so the MCP
 * tool-name charset — `A-Za-z0-9._-`, 1-128 chars, no spaces or other special
 * characters — applies to server names indirectly. The MCPB upload path
 * already enforced this pattern locally; this module lifts it into a shared
 * helper used by every create/rename path.
 *
 * Names loaded from disk (e.g. `mcp_settings.json`) are NOT rejected here —
 * callers only warn about them at startup, so existing configurations keep
 * working after upgrade.
 */

export const SERVER_NAME_PATTERN = /^[A-Za-z0-9._-]+$/;

export const SERVER_NAME_MAX_LENGTH = 128;

export interface ServerNameValidationResult {
  valid: boolean;
  /** Human-readable error message when invalid; the caller decides exposure. */
  message?: string;
  /** Trimmed name when valid. */
  normalized?: string;
}

export const validateServerName = (name: unknown): ServerNameValidationResult => {
  if (typeof name !== 'string' || name.trim() === '') {
    return { valid: false, message: 'Server name is required' };
  }

  const normalized = name.trim();

  if (normalized.length > SERVER_NAME_MAX_LENGTH) {
    return {
      valid: false,
      message: `Server name must be at most ${SERVER_NAME_MAX_LENGTH} characters`,
    };
  }

  if (!SERVER_NAME_PATTERN.test(normalized)) {
    return {
      valid: false,
      message:
        'Server name can only contain letters, numbers, dots, underscores, and hyphens (no spaces or other special characters)',
    };
  }

  // `..` is allowed by the charset but rejected because names are used in
  // filesystem paths (e.g. the MCPB upload directory).
  if (normalized.includes('..')) {
    return { valid: false, message: 'Server name cannot contain consecutive dots' };
  }

  return { valid: true, normalized };
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
