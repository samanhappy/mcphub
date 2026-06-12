/**
 * Security utilities for validating server configurations and inputs.
 */

const DANGEROUS_COMMANDS = new Set([
  'sh', 'bash', 'zsh', 'fish', 'dash', 'ash',
  'cmd', 'powershell', 'pwsh',
  'curl', 'wget', 'fetch',
  'python', 'python3', 'perl', 'ruby', 'php', 'lua',
  'node', 'npm', 'pnpm', 'yarn'
]);

/**
 * Validates that a command is safe to execute.
 * Checks against a blacklist of dangerous binaries and common shell injection patterns.
 */
export function isCommandSafe(command: string, args: string[] = []): boolean {
  const fullCommand = `${command} ${args.join(' ')}`.toLowerCase();
  
  // 1. Check for shell redirection or piping
  if (/[|;`$><]/.test(fullCommand)) {
    return false;
  }
  
  // 2. Check for dangerous binaries
  const baseCmd = command.split('/').pop()?.toLowerCase();
  if (baseCmd && DANGEROUS_COMMANDS.has(baseCmd)) {
    return false;
  }
  
  return true;
}
