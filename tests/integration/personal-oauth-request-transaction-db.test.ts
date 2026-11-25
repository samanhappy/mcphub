import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { DataSource, type QueryRunner } from 'typeorm';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { LegacyMcpClient } from '../../src/clients/legacyMcpClient.js';
import { CredentialBinding } from '../../src/db/entities/CredentialBinding.js';
import { CredentialBindingImport } from '../../src/db/entities/CredentialBindingImport.js';
import { Server } from '../../src/db/entities/Server.js';
import { getAppDataSource } from '../../src/db/connection.js';
import { databaseTransaction } from '../../src/db/transactionContext.js';
import { PersonalOAuthContext } from '../../src/services/personalOAuthService.js';
import { createOAuthProvider, MCPHubOAuthProvider } from '../../src/services/mcpOAuthProvider.js';
import {
  createOAuthFetch,
  fetchScopesFromServer,
} from '../../src/services/oauthClientRegistration.js';
import { logger } from '../../src/utils/logger.js';
import type { ServerConfigWithName } from '../../src/types/index.js';

// Replica mode: dashboard GET requests run inside a REPEATABLE READ configuration transaction
// (replicaConfiguration middleware) and may connect personal OAuth servers. A refresh inside
// such a request rotates the refresh token at the authorization server; its persistence must
// neither be rolled back with the request nor be hidden from other requests.

let mockSource: DataSource;
const mockDefinition: ServerConfigWithName = {
  name: 'gitlab',
  type: 'streamable-http',
  url: 'https://gitlab.example/mcp',
  visibility: 'public',
  oauth: {
    identityMode: 'personal',
    allowInsecureTokenEndpoint: true,
    clientId: 'client',
    scopes: ['mcp'],
  },
};
jest.mock('../../src/db/connection.js', () => ({
  // Same wiring as production: DAOs join the request transaction when one is active.
  getAppDataSource: () =>
    jest.requireActual('../../src/db/transactionContext.js').scopedDataSource(mockSource),
}));
// Personal servers use mockDefinition; shared servers are read from the servers table.
const findServer = async (name: string) =>
  name === mockDefinition.name
    ? mockDefinition
    : ((await getAppDataSource().getRepository(Server).findOneBy({ name })) ?? undefined);
jest.mock('../../src/dao/index.js', () => ({
  getServerDao: () => ({ findById: findServer }),
  getUserDao: () => ({
    findByUsername: async (username: string) => ({ username, isAdmin: false }),
  }),
  getSystemConfigDao: () => ({ get: async () => ({}) }),
}));
jest.mock('../../src/dao/DaoFactory.js', () => ({
  getCredentialBindingDao: () =>
    new (jest.requireActual(
      '../../src/dao/CredentialBindingDaoDbImpl.js',
    ).CredentialBindingDaoDbImpl)(),
  getServerDao: () => ({
    findById: async () => mockDefinition,
    findAll: async () => [mockDefinition],
  }),
  getUserDao: () => ({
    findByUsername: async (username: string) => ({ username, isAdmin: false }),
  }),
}));
jest.mock('../../src/services/mcpService.js', () => ({
  getServerByName: jest.fn(),
  createTransportFromConfig: jest.fn(),
}));
jest.mock('openid-client', () => ({}));
jest.mock('../../src/services/oauthClientRegistration.js', () => ({
  getRegisteredClient: jest.fn(),
  removeRegisteredClient: jest.fn(),
  createOAuthFetch: jest.fn(),
  fetchScopesFromServer: jest.fn(),
  initializeOAuthForServer: jest.fn(),
}));

const issuer = 'http://gitlab.internal.example';

/**
 * Authorization and resource server with rotating refresh tokens (GitLab/Doorkeeper): a
 * refresh revokes the used refresh token together with its access token, and redeeming a
 * revoked refresh token fails with invalid_grant.
 */
const rotatingUpstream = () => {
  let generation = 1;
  const active = new Map<string, string>([['refresh-1', 'access-1']]);
  const refreshes: string[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url === `${issuer}/token`) {
      const refreshToken = new URLSearchParams(String(init?.body)).get('refresh_token')!;
      refreshes.push(refreshToken);
      if (!active.delete(refreshToken))
        return Response.json({ error: 'invalid_grant' }, { status: 400 });
      generation++;
      active.set(`refresh-${generation}`, `access-${generation}`);
      return Response.json({
        access_token: `access-${generation}`,
        refresh_token: `refresh-${generation}`,
        token_type: 'Bearer',
        expires_in: 7200,
      });
    }
    if (url === mockDefinition.url) {
      const accessToken = (new Headers(init?.headers).get('authorization') || '').replace(
        'Bearer ',
        '',
      );
      if (![...active.values()].includes(accessToken))
        return new Response(null, { status: 401, headers: { 'www-authenticate': 'Bearer' } });
      const message = JSON.parse(String(init?.body));
      if (message.method === 'notifications/initialized')
        return new Response(null, { status: 202 });
      const result =
        message.method === 'initialize'
          ? {
              protocolVersion: '2025-03-26',
              capabilities: { tools: {} },
              serverInfo: { name: 'gitlab', version: '1' },
            }
          : { tools: [{ name: 'issues', inputSchema: { type: 'object' } }] };
      return Response.json({ jsonrpc: '2.0', id: message.id, result });
    }
    if (url.includes('oauth-protected-resource'))
      return Response.json({ resource: mockDefinition.url, authorization_servers: [issuer] });
    return Response.json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
    });
  };
  return { fetchFn, refreshes };
};

/** Connect alice's personal runtime and list tools, as a principal runtime does. */
const listTools = async (fetchFn: typeof fetch) => {
  const context = await PersonalOAuthContext.load('gitlab', 'alice', mockDefinition);
  const transport = new StreamableHTTPClientTransport(new URL(mockDefinition.url!), {
    authProvider: new MCPHubOAuthProvider('gitlab', context.config),
    fetch: context.wrapFetch(fetchFn),
  });
  const client = new LegacyMcpClient({ name: 'request-transaction', version: '1' });
  try {
    await client.connect(transport);
    return (await client.listTools()).tools.map((tool) => tool.name);
  } finally {
    await client.close().catch(() => undefined);
  }
};

const stored = async () =>
  (await PersonalOAuthContext.load('gitlab', 'alice', mockDefinition)).config.oauth;

/** Open a configuration transaction like replicaConfiguration does for a dashboard GET. */
const openRequestTransaction = async (): Promise<QueryRunner> => {
  const runner = mockSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction('REPEATABLE READ');
  // The snapshot is taken by the first statement, as getConfigurationVersion does.
  await runner.query('SELECT 1 FROM credential_bindings LIMIT 1');
  return runner;
};

const createSource = (poolSize?: number) =>
  new DataSource({
    type: 'postgres',
    host: '127.0.0.1',
    port: Number(process.env.MCPHUB_TEST_PG_PORT),
    username: 'mcphub_test',
    password: 'mcphub_test',
    database: 'mcphub_test',
    entities: [CredentialBinding, CredentialBindingImport, Server],
    synchronize: true,
    ...(poolSize ? { extra: { max: poolSize } } : {}),
  });

/** Fail instead of hanging on a lock or a connection checkout. */
const withinSeconds = <T>(seconds: number, promise: Promise<T>): Promise<T> => {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`still waiting after ${seconds}s`)),
        seconds * 1000,
      );
    }),
  ]).finally(() => clearTimeout(timer));
};

// This suite runs only against an explicitly supplied disposable local database.
const dbSuite = process.env.MCPHUB_TEST_PG_PORT ? describe : describe.skip;
dbSuite('personal OAuth refresh inside a request transaction (replica mode)', () => {
  let directory: string;
  const originalEnv = {
    path: process.env.MCPHUB_SETTING_PATH,
    key: process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY,
    replica: process.env.MCPHUB_REPLICA_MODE,
  };
  beforeAll(async () => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-oauth-request-tx-'));
    process.env.MCPHUB_SETTING_PATH = path.join(directory, 'settings.json');
    process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
    process.env.MCPHUB_REPLICA_MODE = 'true';
    mockSource = createSource();
    await mockSource.initialize();
  });
  afterAll(async () => {
    await mockSource.destroy();
    fs.rmSync(directory, { recursive: true, force: true });
    for (const [name, value] of [
      ['MCPHUB_SETTING_PATH', originalEnv.path],
      ['MCPHUB_CREDENTIAL_ENCRYPTION_KEY', originalEnv.key],
      ['MCPHUB_REPLICA_MODE', originalEnv.replica],
    ] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
  beforeEach(async () => {
    jest.spyOn(logger, 'log').mockImplementation(() => undefined);
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    await mockSource.getRepository(CredentialBinding).clear();
    await mockSource.getRepository(Server).clear();
    const context = await PersonalOAuthContext.load('gitlab', 'alice', mockDefinition);
    // An expired grant, as after a night without activity.
    await new MCPHubOAuthProvider('gitlab', context.config).saveTokens({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      token_type: 'Bearer',
      expires_in: 0,
    });
  });
  afterEach(() => jest.restoreAllMocks());

  test('a rotation survives the rollback of the request that refreshed', async () => {
    const upstream = rotatingUpstream();
    jest.mocked(createOAuthFetch).mockResolvedValue(upstream.fetchFn);
    const request = await openRequestTransaction();
    try {
      await expect(
        databaseTransaction.run(request, () => listTools(upstream.fetchFn)),
      ).resolves.toEqual(['issues']);
    } finally {
      // The dashboard client aborted the request (or it ended with an error status).
      await request.rollbackTransaction();
      await request.release();
    }
    expect((await stored()).refreshToken).toBe('refresh-2');
    await expect(listTools(upstream.fetchFn)).resolves.toEqual(['issues']);
    // The revoked refresh token is never redeemed again, so the grant is never cleared.
    expect(upstream.refreshes).toEqual(['refresh-1']);
    expect((await stored()).accessToken).toBe('access-2');
  });

  test('a request never redeems a refresh token rotated after its snapshot', async () => {
    const upstream = rotatingUpstream();
    jest.mocked(createOAuthFetch).mockResolvedValue(upstream.fetchFn);
    const request = await openRequestTransaction();
    try {
      // Another request (an MCP tool call) refreshes after the dashboard snapshot was taken.
      await expect(listTools(upstream.fetchFn)).resolves.toEqual(['issues']);
      // The dashboard request starts from its snapshot; the binding check under the lock
      // reads the committed rotation and stops it before the token endpoint.
      await expect(
        databaseTransaction.run(request, () => listTools(upstream.fetchFn)),
      ).rejects.toThrow('Personal authorization changed');
      await request.commitTransaction();
    } finally {
      if (request.isTransactionActive) await request.rollbackTransaction();
      await request.release();
    }
    expect(upstream.refreshes).toEqual(['refresh-1']);
    expect((await stored()).refreshToken).toBe('refresh-2');
    // The next request starts from a new snapshot.
    await expect(listTools(upstream.fetchFn)).resolves.toEqual(['issues']);
  });

  test('a rotation is visible to other requests before the refreshing request ends', async () => {
    const upstream = rotatingUpstream();
    jest.mocked(createOAuthFetch).mockResolvedValue(upstream.fetchFn);
    const request = await openRequestTransaction();
    try {
      await databaseTransaction.run(request, () => listTools(upstream.fetchFn));
      // The dashboard request is still open; an MCP request must use the rotated grant.
      await expect(listTools(upstream.fetchFn)).resolves.toEqual(['issues']);
      await request.commitTransaction();
    } finally {
      if (request.isTransactionActive) await request.rollbackTransaction();
      await request.release();
    }
    expect(upstream.refreshes).toEqual(['refresh-1']);
    expect((await stored()).refreshToken).toBe('refresh-2');
  });

  test('enabling a shared OAuth server saves discovered scopes in the request transaction', async () => {
    // Shared OAuth settings live in the server row, which the enable request has locked.
    await mockSource.getRepository(Server).insert({
      name: 'shared-gitlab',
      type: 'streamable-http',
      url: 'https://shared.example/mcp',
      enabled: false,
      oauth: { clientId: 'shared-client' },
    });
    jest.mocked(createOAuthFetch).mockResolvedValue(fetch);
    jest.mocked(fetchScopesFromServer).mockResolvedValue(['read_api']);
    const request = mockSource.createQueryRunner();
    await request.connect();
    await request.startTransaction('READ COMMITTED');
    try {
      await databaseTransaction.run(request, async () => {
        await getAppDataSource().getRepository(Server).update(
          { name: 'shared-gitlab' },
          {
            enabled: true,
          },
        );
        const { name: _, ...definition } = (await findServer('shared-gitlab'))!;
        await withinSeconds(5, createOAuthProvider('shared-gitlab', definition));
      });
      await request.commitTransaction();
    } finally {
      if (request.isTransactionActive) await request.rollbackTransaction();
      await request.release();
    }
    const saved = await mockSource.getRepository(Server).findOneBy({ name: 'shared-gitlab' });
    expect(saved?.enabled).toBe(true);
    expect(saved?.oauth?.scopes).toEqual(['read_api']);
  });

  test('loading bindings needs no connection beyond the one of the request', async () => {
    // Every pooled connection is held by a dashboard request listing servers.
    const pool = createSource(2);
    await pool.initialize();
    const shared = mockSource;
    mockSource = pool;
    const requests = await Promise.all([1, 2].map(() => openRequestTransaction()));
    try {
      const loads = requests.flatMap((request) =>
        // A linked user (alice) and a user who never linked the server (bob).
        ['alice', 'bob'].map((username) =>
          databaseTransaction.run(request, () =>
            PersonalOAuthContext.load('gitlab', username, mockDefinition),
          ),
        ),
      );
      const contexts = await withinSeconds(5, Promise.all(loads));
      expect(contexts.map((context) => context.config.oauth.refreshToken ?? null)).toEqual([
        'refresh-1',
        null,
        'refresh-1',
        null,
      ]);
    } finally {
      for (const request of requests) {
        await request.rollbackTransaction();
        await request.release();
      }
      mockSource = shared;
      await pool.destroy();
    }
  });
});
