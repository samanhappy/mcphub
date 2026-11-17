/**
 * Error thrown when the requested server/tool (or server/prompt) cannot be
 * used by the current caller. `message` is the single safe text returned to
 * the caller — intentionally identical whether the target is hidden from them
 * or does not exist at all, so server/tool existence is never leaked through
 * distinguishable authorization errors (see #1103). `reason` is an internal
 * diagnostic recorded only in logs/activity, never surfaced to the caller.
 */
export class ToolUnavailableError extends Error {
  constructor(
    message: string,
    public readonly reason: string,
  ) {
    super(message);
    this.name = 'ToolUnavailableError';
  }
}
