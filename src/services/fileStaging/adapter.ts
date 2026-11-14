import path from 'node:path';

import type { ServerConfig } from '../../types/index.js';
import { ensureDirectory, getStagingRoot } from './paths.js';
import { resolveOwnerPrincipal, resolveStagingPrincipal } from './identity.js';

export const SSH_STAGING_PACKAGE = '@fangjunjie/ssh-mcp-server';
export const SSH_STAGING_VERSION = '1.11.0';
const PINNED_SPEC = `${SSH_STAGING_PACKAGE}@${SSH_STAGING_VERSION}`;

/**
 * Options the pinned SSH server may receive. The resolved argv is checked per
 * principal, so a credential-template args slot cannot smuggle a local-root
 * flag such as `--allowed-local-paths=/` or `--config-file`.
 */
const ALLOWED_SSH_OPTIONS = new Set([
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
  '--pre-connect',
  '--mcp-transport',
  '--help',
  '--version',
]);

const FORBIDDEN_OPTIONS = new Set(['--allowed-local-paths', '--config-file']);

export interface AdapterValidation {
  ok: boolean;
  reason?: string;
}

export interface PreparedRuntime {
  cwd: string;
}

/** Any tool on this server opted into staging. */
export const hasStagedTools = (config: ServerConfig): boolean =>
  Object.values(config.tools ?? {}).some((tool) => tool?.fileStaging?.enabled === true);

export const isStdioServerConfig = (config: ServerConfig): boolean =>
  (config.type === 'stdio' || (!config.type && Boolean(config.command))) && !config.url;

const findPinnedSpecifier = (args: readonly string[] | undefined): string | undefined =>
  args?.find((arg) => arg.includes(SSH_STAGING_PACKAGE));

/** Strict option allowlist for an argv whose credential slots are resolved. */
export const validateResolvedSshArgs = (argv: readonly string[]): AdapterValidation => {
  for (const token of argv) {
    if (FORBIDDEN_OPTIONS.has(token) || [...FORBIDDEN_OPTIONS].some((option) => token.startsWith(`${option}=`))) {
      return { ok: false, reason: `Forbidden SSH option: ${token}` };
    }
    if (!token.startsWith('--')) continue;
    if (token.startsWith('--http-')) continue;
    if (!ALLOWED_SSH_OPTIONS.has(token)) {
      return { ok: false, reason: `Unknown SSH option: ${token}` };
    }
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
  if (config.visibility !== 'private' && config.staging.shared !== true) {
    return { ok: false, reason: 'Shared/group servers require staging.shared' };
  }
  if (config.staging.shared === true && !config.credentialTemplate?.length) {
    return { ok: false, reason: 'Shared staging requires per-user credential slots' };
  }
  const specifier = findPinnedSpecifier(config.args);
  if (!specifier) {
    return { ok: false, reason: `Server args must include ${PINNED_SPEC}` };
  }
  if (specifier !== PINNED_SPEC) {
    return { ok: false, reason: `Server must pin ${PINNED_SPEC}, got ${specifier}` };
  }
  for (const token of config.args ?? []) {
    if (FORBIDDEN_OPTIONS.has(token) || [...FORBIDDEN_OPTIONS].some((option) => token.startsWith(`${option}=`))) {
      return { ok: false, reason: `Forbidden SSH option: ${token}` };
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

  const principal = principalUsername
    ? await resolveStagingPrincipal(principalUsername)
    : await resolveOwnerPrincipal(config.owner);
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
