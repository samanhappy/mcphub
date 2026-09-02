import type {
  CredentialBinding,
  EncryptedCredentialValues,
} from '../../src/types/index.js';
import type { CredentialBindingDao } from '../../src/dao/CredentialBindingDao.js';
import type { ServerDao } from '../../src/dao/ServerDao.js';
import {
  CredentialBindingRequiredError,
  CredentialBindingService,
} from '../../src/services/credentialBindingService.js';
import { decryptCredentialValues, encryptCredentialValues } from '../../src/services/credentialCrypto.js';

const server = {
  name: 'tavily',
  type: 'streamable-http' as const,
  url: 'https://example.com/mcp',
  visibility: 'public' as const,
  owner: 'admin',
  env: { REGION: 'us-east-1' },
  headers: { 'X-Shared': 'shared' },
  credentialTemplate: {
    env: { TAVILY_API_KEY: { label: 'Tavily API key' } },
    headers: { Authorization: { label: 'Personal token' } },
  },
};

const makeBinding = (
  username: string,
  envSecret: string,
  headerSecret: string,
  updatedAt = '2026-09-02T00:00:00.000Z',
): CredentialBinding => ({
  id: `${username}-binding`,
  serverName: server.name,
  username,
  encryptedValues: encryptCredentialValues({
    env: { TAVILY_API_KEY: envSecret },
    headers: { Authorization: headerSecret },
  }, { username }),
  createdAt: updatedAt,
  updatedAt,
});

const createHarness = (bindings: CredentialBinding[] = []) => {
  const stored = new Map(bindings.map((binding) => [binding.username, binding]));
  const bindingDao: jest.Mocked<CredentialBindingDao> = {
    findByServerAndUsername: jest.fn(async (_serverName, username) => stored.get(username) ?? null),
    findByUsername: jest.fn(async (username) =>
      [...stored.values()].filter((binding) => binding.username === username),
    ),
    upsert: jest.fn(async (serverName, username, encryptedValues) => {
      const now = '2026-09-02T01:00:00.000Z';
      const existing = stored.get(username);
      const binding: CredentialBinding = {
        id: existing?.id ?? `${username}-binding`,
        serverName,
        username,
        encryptedValues,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      stored.set(username, binding);
      return binding;
    }),
    delete: jest.fn(async (_serverName, username) => stored.delete(username)),
    deleteByServer: jest.fn(async () => 0),
    deleteByUsername: jest.fn(async () => 0),
    renameServer: jest.fn(async () => 0),
  };
  const serverDao = {
    findById: jest.fn(async (name: string) => (name === server.name ? server : null)),
    findAll: jest.fn(async () => [server]),
  } as unknown as jest.Mocked<ServerDao>;

  return {
    service: new CredentialBindingService(bindingDao, serverDao),
    bindingDao,
  };
};

describe('CredentialBindingService (#1114)', () => {
  it('resolves concurrent users only through their exact principal binding', async () => {
    const { service, bindingDao } = createHarness([
      makeBinding('alice@example.com', 'alice-env-secret', 'Bearer alice-header-secret'),
      makeBinding('bob@example.com', 'bob-env-secret', 'Bearer bob-header-secret'),
    ]);

    const [alice, bob] = await Promise.all([
      service.resolveServerConfig(server, { username: 'alice@example.com' }),
      service.resolveServerConfig(server, { username: 'bob@example.com' }),
    ]);

    expect(alice.config.env).toEqual({ REGION: 'us-east-1', TAVILY_API_KEY: 'alice-env-secret' });
    expect(alice.config.headers).toEqual({
      'X-Shared': 'shared',
      Authorization: 'Bearer alice-header-secret',
    });
    expect(JSON.stringify(alice.config)).not.toContain('bob-env-secret');
    expect(bob.config.env?.TAVILY_API_KEY).toBe('bob-env-secret');
    expect(bindingDao.findByServerAndUsername).toHaveBeenCalledWith(
      'tavily',
      'alice@example.com',
    );
    expect(bindingDao.findByServerAndUsername).toHaveBeenCalledWith(
      'tavily',
      'bob@example.com',
    );
  });

  it('fails closed with an actionable, non-sensitive error when a binding is missing', async () => {
    const { service } = createHarness();

    await expect(service.resolveServerConfig(server, { username: 'alice' })).rejects.toEqual(
      expect.objectContaining({
        name: CredentialBindingRequiredError.name,
        message: "Credential binding required for server 'tavily'. Add it in My Credentials.",
      }),
    );
  });

  it('writes encrypted values for the current principal and returns metadata only', async () => {
    const { service, bindingDao } = createHarness();

    const summary = await service.upsertForPrincipal(
      'tavily',
      { username: 'alice@example.com' },
      {
        env: { TAVILY_API_KEY: 'alice-write-secret' },
        headers: { Authorization: 'Bearer alice-write-header' },
      },
    );

    const encrypted = bindingDao.upsert.mock.calls[0][2] as EncryptedCredentialValues;
    expect(
      decryptCredentialValues(encrypted, {
        username: 'alice@example.com',
      }),
    ).toEqual({
      env: { TAVILY_API_KEY: 'alice-write-secret' },
      headers: { Authorization: 'Bearer alice-write-header' },
    });
    expect(JSON.stringify(encrypted)).not.toContain('alice-write-secret');
    expect(JSON.stringify(summary)).not.toContain('alice-write-secret');
    expect(summary).toMatchObject({
      serverName: 'tavily',
      complete: true,
      configured: {
        env: { TAVILY_API_KEY: true },
        headers: { Authorization: true },
      },
    });
  });

  it('never permits a principal to delete another user binding', async () => {
    const { service, bindingDao } = createHarness([
      makeBinding('alice', 'alice-secret', 'alice-header'),
      makeBinding('bob', 'bob-secret', 'bob-header'),
    ]);

    await service.deleteForPrincipal('tavily', { username: 'alice' });

    expect(bindingDao.delete).toHaveBeenCalledWith('tavily', 'alice');
    expect(bindingDao.delete).not.toHaveBeenCalledWith('tavily', 'bob');
  });

  it('injects only values that are still declared by the current template', async () => {
    const binding = makeBinding(
      'alice@example.com',
      'alice-env-secret',
      'Bearer removed-header-secret',
    );
    const currentServer = {
      ...server,
      credentialTemplate: { env: server.credentialTemplate.env },
    };
    const { service } = createHarness([binding]);

    const resolved = await service.resolveServerConfig(currentServer, {
      username: 'alice@example.com',
    });

    expect(resolved.config.env?.TAVILY_API_KEY).toBe('alice-env-secret');
    expect(resolved.config.headers).toEqual({ 'X-Shared': 'shared' });
    expect(JSON.stringify(resolved.config)).not.toContain('removed-header-secret');
  });
});
