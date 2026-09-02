import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type {
  CredentialBinding,
  EncryptedCredentialValues,
} from '../../src/types/index.js';
import type { CredentialBindingDao } from '../../src/dao/CredentialBindingDao.js';
import { CredentialBindingService } from '../../src/services/credentialBindingService.js';

class MemoryCredentialBindingDao implements CredentialBindingDao {
  binding: CredentialBinding | null = null;
  version = 0;

  findByServerAndUsername(serverName: string, username: string) {
    return Promise.resolve(
      this.binding?.serverName === serverName && this.binding.username === username
        ? this.binding
        : null,
    );
  }
  findByUsername(username: string) {
    return Promise.resolve(this.binding?.username === username ? [this.binding] : []);
  }
  upsert(serverName: string, username: string, encryptedValues: EncryptedCredentialValues) {
    this.version += 1;
    this.binding = {
      id: 'binding-1',
      serverName,
      username,
      encryptedValues,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: `v${this.version}`,
    };
    return Promise.resolve(this.binding);
  }
  delete() { return Promise.resolve(false); }
  deleteByServer() { return Promise.resolve(0); }
  deleteByUsername() { return Promise.resolve(0); }
  renameServer() { return Promise.resolve(0); }
}

const rawServer = {
  name: 'real-personal-stdio',
  type: 'stdio' as const,
  command: process.execPath,
  args: [path.resolve(process.cwd(), 'tests/fixtures/credential-stdio-server.mjs')],
  owner: 'admin',
  visibility: 'public' as const,
  enabled: true,
  credentialTemplate: { env: { PERSONAL_TOKEN: { label: 'Personal token' } } },
};

const connectAndVerify = async (secret: string) => {
  const transport = new StdioClientTransport({
    command: rawServer.command,
    args: rawServer.args,
    env: { ...process.env, PERSONAL_TOKEN: secret } as Record<string, string>,
    stderr: 'pipe',
  });
  const client = new Client({ name: 'credential-e2e-client', version: '1.0.0' });
  await client.connect(transport);
  const result = await client.callTool({ name: 'verify_credential', arguments: { expected: secret } });
  const pid = transport.pid;
  await client.close();
  return { result, pid };
};

describe('real stdio per-user credential flow (#1114)', () => {
  const originalKey = process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY = 'test-only-credential-key';
  });

  afterAll(() => {
    if (originalKey === undefined) delete process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY;
    else process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY = originalKey;
  });

  it('injects the current encrypted binding and leaves no stdio child after rotation', async () => {
    const bindingDao = new MemoryCredentialBindingDao();
    const serverDao = {
      findAll: jest.fn().mockResolvedValue([rawServer]),
      findById: jest.fn().mockResolvedValue(rawServer),
    } as any;
    const service = new CredentialBindingService(bindingDao, serverDao);
    const principal = { username: 'partner@example.com', isAdmin: false };

    await service.upsertForPrincipal(rawServer.name, principal, {
      env: { PERSONAL_TOKEN: 'first-private-token' },
    });
    const first = await service.resolveServerConfig(rawServer, principal);
    const firstCall = await connectAndVerify(first.config.env!.PERSONAL_TOKEN);
    expect(firstCall.result).toMatchObject({ content: [{ text: 'matched' }] });

    await service.upsertForPrincipal(rawServer.name, principal, {
      env: { PERSONAL_TOKEN: 'rotated-private-token' },
    });
    const rotated = await service.resolveServerConfig(rawServer, principal);
    const secondCall = await connectAndVerify(rotated.config.env!.PERSONAL_TOKEN);
    expect(secondCall.result).toMatchObject({ content: [{ text: 'matched' }] });
    expect(rotated.bindingVersion).not.toBe(first.bindingVersion);

    for (const pid of [firstCall.pid, secondCall.pid]) {
      expect(pid).toEqual(expect.any(Number));
      expect(() => process.kill(pid!, 0)).toThrow();
    }
  });
});
