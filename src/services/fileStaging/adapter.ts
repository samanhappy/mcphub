import path from 'node:path';

import type { ServerConfig } from '../../types/index.js';
import { ensureDirectory, getStagingRoot } from './paths.js';
import { resolveOwnerPrincipal, resolveStagingPrincipal } from './identity.js';

export const SSH_STAGING_PACKAGE = '@fangjunjie/ssh-mcp-server';
export const SSH_STAGING_VERSION = '1.11.0';
const PINNED_SPEC = `${SSH_STAGING_PACKAGE}@${SSH_STAGING_VERSION}`;

/** Launchers that execute the pinned specifier itself. */
const PINNING_LAUNCHERS = new Set(['npx', 'node']);

/**
 * Options the pinned SSH server may receive (verified against 1.11.0,
 * `build/cli/command-line-parser.js`). The resolved argv is checked per
 * principal, so a credential-template args slot cannot smuggle a local-root
 * flag such as `--allowed-local-paths=/` or `--config-file`.
 */
/**
 * Options that consume the next token, taken from the pinned 1.11.0 parser
 * (`parseArgs` with `type: 'string'`). Everything else in the allowlist is a
 * boolean flag: advancing past the next token for a boolean would hide the
 * option that follows it.
 */
const VALUE_OPTIONS = new Set([
  '--config-file',
  '--ssh-config-file',
  '--ssh',
  '--host',
  '--port',
  '--username',
  '--password',
  '--privateKey',
  '--passphrase',
  '--agent',
  '--whitelist',
  '--blacklist',
  '--proxy',
  '--socksProxy',
  '--allowed-local-paths',
  '--allowed-remote-paths',
  '--transport-mode',
  '--shell-ready-timeout',
  '--command-template',
  '--pty',
  '--mcp-transport',
]);

const ALLOWED_SSH_OPTIONS = new Set([
  '--ssh',
  '--host',
  '--port',
  '--username',
  '--password',
  '--private-key',
  '--privateKey',
  '--passphrase',
  '--agent',
  '--whitelist',
  '--blacklist',
  '--proxy',
  '--socks-proxy',
  '--socksProxy',
  '--allowed-remote-paths',
  '--transport-mode',
  '--shell-ready-timeout',
  '--command-template',
  '--pty',
  '--try-keyboard',
  '--pre-connect',
  '--mcp-transport',
]);

/**
 * Forbidden in a staged server's argv.
 *
 * `--ssh` and `--ssh-config-file` are forbidden because both carry a whole
 * connection object: the pinned parser reads `allowedLocalPaths` from that
 * JSON, so a credential-template slot bound to `--ssh` would hand the user the
 * local-root override that `--allowed-local-paths` is blocked from providing.
 * `--config-file` is the same escape through a file.
 */
const FORBIDDEN_OPTIONS = new Set([
  '--allowed-local-paths',
  '--config-file',
  '--ssh-config-file',
  '--ssh',
  '--help',
  '--version',
]);

export interface AdapterValidation {
  ok: boolean;
  reason?: string;
}

export interface PreparedRuntime {
  cwd: string;
}

/**
 * Per-server staging adapter. `ssh` is the only PR1 adapter; later adapters
 * (e.g. a filesystem adapter) implement the same seam.
 */
export interface StagingAdapter {
  readonly id: string;
  /** Static check of the unresolved server config. */
  validateConfig(config: ServerConfig): AdapterValidation;
  /** Filesystem setup the child needs; `undefined` when staging does not apply. */
  prepareRuntime(config: ServerConfig, principalUsername?: string): Promise<PreparedRuntime | undefined>;
  /** Check of the credential-resolved argv the child will actually receive. */
  validateResolvedArgs(argv: readonly string[]): AdapterValidation;
}

/** Any tool on this server opted into staging. */
export const hasStagedTools = (config: ServerConfig): boolean =>
  Object.values(config.tools ?? {}).some((tool) => tool?.fileStaging?.enabled === true);

export const isStdioServerConfig = (config: ServerConfig): boolean =>
  (config.type === 'stdio' || (!config.type && Boolean(config.command))) && !config.url;

const launcherName = (command: string): string => path.basename(command.trim());

/**
 * Locate the pinned specifier as a positional argument of a trusted launcher.
 *
 * npx switches (`-y`) may precede it; `node` must get the CLI itself, because a
 * script argument there would be the code that actually runs. Any other
 * command is rejected: the pin only binds code that this launcher executes.
 */
const findPinnedSpecifier = (command: string | undefined, args: readonly string[] | undefined): string | undefined => {
  if (!command || !args) return undefined;
  const launcher = launcherName(command);
  if (!PINNING_LAUNCHERS.has(launcher)) return undefined;
  const tokens = [...args];
  if (launcher === 'node' && tokens[0] === '--') tokens.shift();
  // npx flags are switches (`-y`), never option/value pairs, so a flag may
  // precede the spec; a script argument there would be what npx runs.
  let specIndex = 0;
  while (specIndex < tokens.length && tokens[specIndex].startsWith('-')) specIndex += 1;
  if (launcher === 'node' && specIndex !== 0) return undefined;
  const spec = tokens[specIndex];
  if (!spec || !spec.includes(SSH_STAGING_PACKAGE)) return undefined;
  // `npx -p <pkg> <command>` names a different command after the pin.
  const next = tokens[specIndex + 1];
  return next === undefined || next.startsWith('-') ? spec : undefined;
};

/** Split `--opt=value` into its option; other tokens are their own option. */
const optionNameOf = (token: string): string => {
  if (!token.startsWith('-')) return token;
  const separator = token.indexOf('=');
  return separator > 0 ? token.slice(0, separator) : token;
};

/**
 * Strict option allowlist for an argv whose credential slots are resolved.
 *
 * Tokens are read pairwise: a value that follows a bare option belongs to it
 * and is never judged as an option itself, even when it starts with dashes.
 * Single-dash tokens are inspected too, because the pinned CLI binds short
 * forms (`-h`, `-k`), often reached through a credential slot.
 */
export const validateResolvedSshArgs = (argv: readonly string[]): AdapterValidation => {
  // Only the arguments the SSH program receives are judged. The launcher
  // (`npx -y @fangjunjie/ssh-mcp-server@1.11.0`) has its own flags (`-y`), and
  // the pinned specifier is checked separately by validateSshServerConfig.
  const specifierIndex = argv.findIndex((token) => token === PINNED_SPEC);
  const programArgv = specifierIndex === -1 ? argv : argv.slice(specifierIndex + 1);
  // After `--` the pinned CLI reads only positionals; nothing is an option.
  const end = programArgv.indexOf('--');
  const tokens = end === -1 ? programArgv : programArgv.slice(0, end);
  // Only the option positions are judged, so a value that starts with dashes
  // (`--password --host`) is never mistaken for an option.
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token.startsWith('-')) continue;
    const option = optionNameOf(token);
    if (FORBIDDEN_OPTIONS.has(option)) return { ok: false, reason: `Forbidden SSH option: ${option}` };
    if (!ALLOWED_SSH_OPTIONS.has(option) && !option.startsWith('--http-')) {
      return { ok: false, reason: `Unknown SSH option: ${option}` };
    }
    // A boolean flag never consumes the next token; only a value option does.
    if (!token.includes('=') && VALUE_OPTIONS.has(option)) i += 1;
  }
  return { ok: true };
};

/** The unresolved config must already pin the exact package version. */
export const validateSshServerConfig = (config: ServerConfig): AdapterValidation => {
  if (config.staging?.adapter !== 'ssh') {
    return { ok: false, reason: 'staging.adapter must be ssh' };
  }
  if (!isStdioServerConfig(config)) {
    return { ok: false, reason: 'File staging requires a stdio server' };
  }
  if (!hasStagedTools(config)) {
    return { ok: false, reason: 'No tool has fileStaging enabled' };
  }
  // An absent visibility is the file-mode default for a hand-written entry and
  // is owner-only; only an explicit group/public server is shared.
  const visibility = config.visibility ?? 'private';
  if (visibility !== 'private' && config.staging.shared !== true) {
    return { ok: false, reason: 'Shared/group servers require staging.shared' };
  }
  if (config.staging.shared === true && !config.credentialTemplate?.length) {
    return { ok: false, reason: 'Shared staging requires per-user credential slots' };
  }
  const specifier = findPinnedSpecifier(config.command, config.args);
  if (!specifier) {
    return { ok: false, reason: `Server args must run ${PINNED_SPEC} via npx` };
  }
  if (specifier !== PINNED_SPEC) {
    return { ok: false, reason: `Server must pin ${PINNED_SPEC}, got ${specifier}` };
  }
  for (const token of config.args ?? []) {
    if (!token.startsWith('-')) continue;
    const option = optionNameOf(token);
    if (FORBIDDEN_OPTIONS.has(option)) {
      return { ok: false, reason: `Forbidden SSH option: ${option}` };
    }
  }
  return { ok: true };
};

/** The connected server must report the version whose behavior was verified. */
export const serverVersionMatchesPinnedProfile = (version: string | undefined): boolean =>
  version === SSH_STAGING_VERSION;

export const getStagingRootForPrincipal = (ownerHash: string): string =>
  path.join(getStagingRoot(), ownerHash);

/** Reserved area for a shared server's credential-less global placeholder. */
export const getStagingPlaceholderRoot = (): string =>
  path.join(getStagingRoot(), '_placeholder');

/**
 * Per-principal child cwd. Shared servers use the caller's root; owner-only
 * servers use the owner's root. There is deliberately no hub-cwd fallback.
 */
export const prepareStagingRuntime = async (
  config: ServerConfig,
  principalUsername?: string,
): Promise<PreparedRuntime | undefined> => {
  if (config.staging?.adapter !== 'ssh' || !hasStagedTools(config)) return undefined;
  const validation = validateSshServerConfig(config);
  if (!validation.ok) return undefined;

  // `owner` is optional in a hand-written file entry; the DAO defaults it to
  // the admin account on create, so the runtime uses the same default.
  const principal = principalUsername
    ? await resolveStagingPrincipal(principalUsername)
    : await resolveOwnerPrincipal(config.owner ?? 'admin');
  if (!principal) return undefined;

  const cwd = getStagingRootForPrincipal(principal.ownerHash);
  await ensureDirectory(cwd);
  return { cwd };
};

/**
 * Cwd for a staged stdio child. Owner-only servers fail closed when the owner
 * principal cannot be resolved; a shared server's global placeholder (which has
 * no credentials) is confined to a reserved directory instead of the hub cwd.
 */
export const resolveStagingCwd = async (
  config: ServerConfig,
  principalUsername?: string,
): Promise<string | undefined> => {
  if (!hasStagedTools(config)) return undefined;
  if (config.staging?.adapter !== 'ssh') {
    throw new Error('File staging requires the ssh adapter');
  }
  const validation = validateSshServerConfig(config);
  if (!validation.ok) throw new Error(`File staging is not available: ${validation.reason}`);

  if (config.staging.shared === true && !principalUsername) {
    const placeholder = getStagingPlaceholderRoot();
    await ensureDirectory(placeholder);
    return placeholder;
  }
  const runtime = await prepareStagingRuntime(config, principalUsername);
  if (!runtime) throw new Error('File staging principal is unavailable');
  return runtime.cwd;
};

/** The pinned SSH server adapter. */
export const sshStagingAdapter: StagingAdapter = {
  id: 'ssh',
  validateConfig: validateSshServerConfig,
  prepareRuntime: prepareStagingRuntime,
  validateResolvedArgs: validateResolvedSshArgs,
};
