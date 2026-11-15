import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { ServerConfig } from '../../../types/index.js';
import type { StagingAdapter } from '../adapter.js';
import {
  resolveStagingCwd,
  serverVersionMatchesPinnedProfile,
  sshStagingAdapter,
  validateResolvedSshArgs,
  validateSshServerConfig,
} from '../adapter.js';

const OWNER = 'a'.repeat(64);

jest.mock('../identity.js', () => ({
  resolveStagingPrincipal: jest.fn(async (username: string) => ({
    username,
    ownerHash: 'a'.repeat(64),
  })),
  resolveOwnerPrincipal: jest.fn(async () => ({ username: 'admin', ownerHash: 'a'.repeat(64) })),
}));

const baseConfig = (overrides: Partial<ServerConfig> = {}): ServerConfig => ({
  type: 'stdio',
  command: 'npx',
  args: [
    '-y',
    '@fangjunjie/ssh-mcp-server@1.11.0',
    '--host',
    'h',
    '--port',
    '22',
    '--username',
    'u',
    '--password',
    'p',
  ],
  staging: { adapter: 'ssh' },
  visibility: 'private',
  owner: 'admin',
  tools: {
    upload: { enabled: true, fileStaging: { enabled: true, inputParams: ['localPath'] } },
  },
  ...overrides,
});

describe('ssh staging adapter', () => {
  it('requires the exact pinned package specifier', () => {
    expect(validateSshServerConfig(baseConfig()).ok).toBe(true);
    const unpinned = baseConfig({ args: ['-y', '@fangjunjie/ssh-mcp-server', '--host', 'h'] });
    expect(validateSshServerConfig(unpinned)).toMatchObject({ ok: false });
    const other = baseConfig({
      args: ['-y', '@fangjunjie/ssh-mcp-server@1.10.0', '--host', 'h'],
    });
    expect(validateSshServerConfig(other)).toMatchObject({ ok: false });
  });

  it('rejects non-stdio configs and missing trust', () => {
    expect(
      validateSshServerConfig(baseConfig({ type: 'sse', url: 'https://x', command: undefined })),
    ).toMatchObject({ ok: false });
    expect(
      validateSshServerConfig(baseConfig({ staging: undefined, tools: {} })),
    ).toMatchObject({ ok: false });
    expect(
      validateSshServerConfig({
        ...baseConfig(),
        args: ['-y', '@fangjunjie/ssh-mcp-server@1.11.0', '--allowed-local-paths=/'],
      }),
    ).toMatchObject({ ok: false });
  });

  it('requires credential slots for a shared server', () => {
    const shared = baseConfig({ visibility: 'public', staging: { shared: true, adapter: 'ssh' } });
    expect(validateSshServerConfig(shared)).toMatchObject({ ok: false });
    expect(
      validateSshServerConfig({
        ...shared,
        credentialTemplate: [{ target: 'args', name: 'ssh_host' }],
      }),
    ).toMatchObject({ ok: true });
  });

  it('allows known options and rejects smuggling attempts in the resolved argv', () => {
    expect(
      validateResolvedSshArgs(['--host', 'h', '--port', '22', '--username', 'u', '--password', 'p']),
    ).toEqual({ ok: true });
    expect(validateResolvedSshArgs(['--host', 'h', '--allowed-local-paths=/'])).toMatchObject({
      ok: false,
    });
    expect(validateResolvedSshArgs(['--config-file=/tmp/x'])).toMatchObject({ ok: false });
    expect(validateResolvedSshArgs(['--exec', 'rm -rf /'])).toMatchObject({ ok: false });
  });

  it('accepts --opt value and --opt=value', () => {
    expect(validateResolvedSshArgs(['--host=h', '--port=22', '--username=u', '--password=p'])).toEqual({
      ok: true,
    });
    expect(validateResolvedSshArgs(['--host', 'h', '--try-keyboard', '--pre-connect'])).toEqual({
      ok: true,
    });
    expect(validateResolvedSshArgs(['--allowed-local-paths=/'])).toMatchObject({ ok: false });
    expect(validateResolvedSshArgs(['--help'])).toMatchObject({ ok: false });
    expect(validateResolvedSshArgs(['--version'])).toMatchObject({ ok: false });
  });

  it('does not mistake a value that starts with -- for an option', () => {
    // A password or username may legitimately start with dashes.
    expect(validateResolvedSshArgs(['--username', '--host', '--password', '--config-file=x'])).toEqual({
      ok: true,
    });
    expect(validateResolvedSshArgs(['--host', '--allowed-local-paths=/'])).toEqual({ ok: true });
    // The same token in option position is still rejected.
    expect(validateResolvedSshArgs(['--host', 'h', '--allowed-local-paths=/'])).toMatchObject({
      ok: false,
    });
    expect(validateResolvedSshArgs(['--', '--allowed-local-paths=/'])).toEqual({ ok: true });
  });

  it('ignores the launcher prefix and judges only the SSH program args', () => {
    // `npx -y` is the documented launcher; `-y` is not an SSH option.
    expect(
      validateResolvedSshArgs([
        'npx',
        '-y',
        '@fangjunjie/ssh-mcp-server@1.11.0',
        '--host',
        'h',
        '--username',
        'u',
      ]),
    ).toEqual({ ok: true });
    expect(
      validateResolvedSshArgs(['-y', '@fangjunjie/ssh-mcp-server@1.11.0', '--help']),
    ).toMatchObject({ ok: false });
  });

  it('rejects the connection-object options that carry a local-root override', () => {
    // `--ssh` parses a JSON connection object and the pinned parser reads
    // `allowedLocalPaths` from it, so a credential slot bound to `--ssh` would
    // be a second way to grant the local root.
    expect(
      validateResolvedSshArgs(['--ssh', '{"host":"h","allowedLocalPaths":["/"]}']),
    ).toMatchObject({ ok: false });
    expect(validateResolvedSshArgs(['--ssh-config-file', '/tmp/ssh.json'])).toMatchObject({
      ok: false,
    });
  });

  it('treats a missing visibility as owner-only, not as shared', () => {
    const config = {
      name: 'sftp',
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@fangjunjie/ssh-mcp-server@1.11.0'],
      staging: { adapter: 'ssh' },
      tools: { upload: { enabled: true, fileStaging: { enabled: true, inputParams: ['localPath'] } } },
    } as unknown as Parameters<typeof validateSshServerConfig>[0];
    expect(validateSshServerConfig(config)).toEqual({ ok: true });
  });

  it('does not let a boolean flag hide the option that follows it', () => {
    // The pinned parser declares --try-keyboard and --pre-connect as booleans,
    // so the next token is an option position, not their value.
    expect(validateResolvedSshArgs(['--pre-connect', '--allowed-local-paths=/'])).toMatchObject({
      ok: false,
    });
    expect(validateResolvedSshArgs(['--try-keyboard', '--config-file=/tmp/x'])).toMatchObject({
      ok: false,
    });
    expect(validateResolvedSshArgs(['--pre-connect', '--try-keyboard', '--host', 'h'])).toEqual({
      ok: true,
    });
  });

  it('inspects and rejects unknown single-dash options', () => {
    expect(validateResolvedSshArgs(['-x'])).toMatchObject({ ok: false });
    expect(validateResolvedSshArgs(['-x', 'value'])).toMatchObject({ ok: false });
    expect(validateResolvedSshArgs(['--host', 'h', '-h'])).toMatchObject({ ok: false });
    expect(validateResolvedSshArgs(['--http-port=3000'])).toEqual({ ok: true });
  });

  it('exposes the ssh adapter through the StagingAdapter seam', () => {
    const adapter: StagingAdapter = sshStagingAdapter;
    expect(adapter.id).toBe('ssh');
    expect(adapter.validateConfig(baseConfig())).toMatchObject({ ok: true });
    expect(adapter.validateResolvedArgs(['--host', 'h'])).toEqual({ ok: true });
    expect(typeof adapter.prepareRuntime).toBe('function');
  });

  it('binds the pin to the launcher and its first positional', () => {
    expect(validateSshServerConfig(baseConfig()).ok).toBe(true);
    // npx switches may precede the spec.
    expect(
      validateSshServerConfig(baseConfig({ args: ['--yes', '@fangjunjie/ssh-mcp-server@1.11.0'] })).ok,
    ).toBe(true);
    // node runs the CLI itself; no script may precede it.
    expect(
      validateSshServerConfig(
        baseConfig({ command: 'node', args: ['@fangjunjie/ssh-mcp-server@1.11.0', '--host', 'h'] }),
      ).ok,
    ).toBe(true);
    expect(
      validateSshServerConfig(
        baseConfig({ command: '/usr/local/bin/npx', args: ['@fangjunjie/ssh-mcp-server@1.11.0'] }),
      ).ok,
    ).toBe(true);
    // A script argument before the pin is what actually runs.
    expect(
      validateSshServerConfig(
        baseConfig({ command: 'node', args: [`/tmp/mcp-staging-1.11.0/index.js`, '@fangjunjie/ssh-mcp-server@1.11.0'] }),
      ),
    ).toMatchObject({ ok: false });
    expect(
      validateSshServerConfig(
        baseConfig({ command: 'npx', args: ['/tmp/other.js', '@fangjunjie/ssh-mcp-server@1.11.0'] }),
      ),
    ).toMatchObject({ ok: false });
    // Another command name after the package runs different code.
    expect(
      validateSshServerConfig(
        baseConfig({ args: ['-p', '@fangjunjie/ssh-mcp-server@1.11.0', 'other-cli'] }),
      ),
    ).toMatchObject({ ok: false });
    // Only npx and node may launch the pin.
    expect(
      validateSshServerConfig(
        baseConfig({ command: 'node_modules/.bin/ssh-mcp-server', args: ['@fangjunjie/ssh-mcp-server@1.11.0'] }),
      ),
    ).toMatchObject({ ok: false });
    expect(
      validateSshServerConfig(baseConfig({ command: 'bash', args: ['@fangjunjie/ssh-mcp-server@1.11.0'] })),
    ).toMatchObject({ ok: false });
    // The two flags that terminate the child are rejected in the config too.
    expect(
      validateSshServerConfig(baseConfig({ args: ['-y', '@fangjunjie/ssh-mcp-server@1.11.0', '--help'] })),
    ).toMatchObject({ ok: false });
    expect(
      validateSshServerConfig(baseConfig({ args: ['-y', '@fangjunjie/ssh-mcp-server@1.11.0', '--version'] })),
    ).toMatchObject({ ok: false });
  });

  it('accepts both --opt value and --opt=value in the server config', () => {
    expect(
      validateSshServerConfig(
        baseConfig({ args: ['-y', '@fangjunjie/ssh-mcp-server@1.11.0', '--allowed-local-paths=/'] }),
      ),
    ).toMatchObject({ ok: false });
  });

  it('accepts only the verified upstream version', () => {
    expect(serverVersionMatchesPinnedProfile('1.11.0')).toBe(true);
    expect(serverVersionMatchesPinnedProfile('1.11.1')).toBe(false);
    expect(serverVersionMatchesPinnedProfile(undefined)).toBe(false);
  });

  describe('per-principal cwd', () => {
    let root: string;
    const previous = process.env.MCPHUB_STAGING_ROOT;

    beforeEach(async () => {
      root = await fs.mkdtemp(path.join(os.tmpdir(), 'mcphub-adapter-'));
      process.env.MCPHUB_STAGING_ROOT = path.join(root, 'staging');
    });

    afterEach(async () => {
      process.env.MCPHUB_STAGING_ROOT = previous;
      await fs.rm(root, { recursive: true, force: true });
    });

    it('gives a shared server a per-principal root and the placeholder its own', async () => {
      const shared = {
        ...baseConfig({ visibility: 'public', staging: { shared: true, adapter: 'ssh' } }),
        credentialTemplate: [{ target: 'args' as const, name: 'ssh_host' }],
      };
      await expect(resolveStagingCwd(shared, 'alice')).resolves.toBe(
        path.join(root, 'staging', OWNER),
      );
      await expect(resolveStagingCwd(shared)).resolves.toBe(
        path.join(root, 'staging', '_placeholder'),
      );
    });

    it('fails closed for an owner-only server with no resolvable owner', async () => {
      const { resolveOwnerPrincipal } = await import('../identity.js');
      (resolveOwnerPrincipal as jest.Mock).mockResolvedValueOnce(undefined);
      await expect(resolveStagingCwd(baseConfig())).rejects.toThrow(/principal/i);
    });
  });
});
