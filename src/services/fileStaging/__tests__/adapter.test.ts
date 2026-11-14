import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { ServerConfig } from '../../../types/index.js';
import {
  resolveStagingCwd,
  serverVersionMatchesPinnedProfile,
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
