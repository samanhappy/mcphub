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
import {
  disconnectPersonalOAuth,
  hasUsablePersonalOAuthGrant,
  PersonalOAuthContext,
  withPersonalOAuthLock,
} from '../../src/services/personalOAuthService.js';
import { PrincipalRuntimeService } from '../../src/services/principalRuntimeService.js';
import {
  withLockConnection,
  withOAuthPendingAuthLock,
  withReplicaLock,
} from '../../src/services/replicaLock.js';
import { installReplicaSchema } from '../../src/db/replicaSchema.js';
import { createOAuthProvider, MCPHubOAuthProvider } from '../../src/services/mcpOAuthProvider.js';
import {
  createOAuthFetch,
  fetchScopesFromServer,
} from '../../src/services/oauthClientRegistration.js';
import { logger } from '../../src/utils/logger.js';
import type { ServerConfigWithName, ServerInfo } from '../../src/types/index.js';

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
    // Revision triggers of replica mode: every binding write updates the mcphub_revision row.
    await installReplicaSchema(mockSource);
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

  test('a callback reloads the grant it saved under the lock, committed at once', async () => {
    // First-time sign-in: no grant yet.
    await mockSource.getRepository(CredentialBinding).clear();
    await withOAuthPendingAuthLock('gitlab', 'alice', async () => {
      const context = await PersonalOAuthContext.load('gitlab', 'alice', mockDefinition);
      expect(hasUsablePersonalOAuthGrant(context)).toBe(false);
      await new MCPHubOAuthProvider('gitlab', context.config).saveTokens({
        access_token: 'access-2',
        refresh_token: 'refresh-2',
        token_type: 'Bearer',
        expires_in: 7200,
      });
      // The callback reloads the binding before the lock is released.
      const reloaded = await PersonalOAuthContext.load('gitlab', 'alice', mockDefinition);
      expect(reloaded.config.oauth.accessToken).toBe('access-2');
      expect(hasUsablePersonalOAuthGrant(reloaded)).toBe(true);
      // Committed before the lock is released: visible to other connections, and the
      // revision row (bumped by the binding trigger) is not held for the rest of the action.
      const other = mockSource.createQueryRunner();
      await other.connect();
      try {
        const [row] = await other.query(
          'SELECT "encryptedValues" FROM credential_bindings WHERE "serverName" = $1 AND username = $2',
          ['gitlab', 'alice'],
        );
        expect(row.encryptedValues).toBe(reloaded.version);
        await other.startTransaction();
        await other.query("SET LOCAL lock_timeout = '1s'");
        await other.query('UPDATE mcphub_revision SET version = version + 1 WHERE id = 1');
        await other.commitTransaction();
      } finally {
        if (other.isTransactionActive) await other.rollbackTransaction();
        await other.release();
      }
    });
  });

  test('a personal runtime initializes on the request connection and one lock connection', async () => {
    // Two pooled connections: the dashboard request holds one.
    const pool = createSource(2);
    await pool.initialize();
    const shared = mockSource;
    mockSource = pool;
    const request = await openRequestTransaction();
    let configurationRead!: () => void;
    const configurationReadDone = new Promise<void>((resolve) => (configurationRead = resolve));
    let otherLock: Promise<void> | undefined;
    // Runtime initialization outlives the preparation callback that started it under the lock.
    const runtimes = new PrincipalRuntimeService(
      async (name) => {
        // Once the preparation lock is released, the next OAuth lock takes the second connection.
        await new Promise((resolve) => setTimeout(resolve, 200));
        let otherLockHeld!: () => void;
        const held = new Promise<void>((resolve) => (otherLockHeld = resolve));
        otherLock = withPersonalOAuthLock('gitlab', 'bob', async () => {
          otherLockHeld();
          await configurationReadDone;
        });
        await held;
        // A configuration read of the initialization: on the request connection.
        await getAppDataSource().query('SELECT 1');
        configurationRead();
        return {
          name,
          status: 'connected',
          tools: [],
          prompts: [],
          resources: [],
        } as unknown as ServerInfo;
      },
      () => undefined,
    );
    try {
      const lease = await withinSeconds(
        10,
        databaseTransaction.run(request, () => runtimes.acquire('gitlab', { username: 'alice' })),
      );
      expect(lease.info.status).toBe('connected');
      lease.release();
      await otherLock;
    } finally {
      configurationRead();
      await otherLock?.catch(() => undefined);
      runtimes.invalidate();
      await request.rollbackTransaction();
      await request.release();
      mockSource = shared;
      await pool.destroy();
    }
  });

  test('saving a refreshed grant waits for a configuration write longer than the lock timeout', async () => {
    const upstream = rotatingUpstream();
    jest.mocked(createOAuthFetch).mockResolvedValue(upstream.fetchFn);
    // A configuration write holds the revision row for longer than the 10-second lock timeout.
    const configurationWrite = mockSource.createQueryRunner();
    await configurationWrite.connect();
    await configurationWrite.startTransaction();
    await configurationWrite.query('UPDATE mcphub_revision SET version = version + 1 WHERE id = 1');
    const refresh = listTools(upstream.fetchFn);
    await new Promise((resolve) => setTimeout(resolve, 11_000));
    await configurationWrite.commitTransaction();
    await configurationWrite.release();
    await expect(refresh).resolves.toEqual(['issues']);
    expect(upstream.refreshes).toEqual(['refresh-1']);
    expect((await stored()).refreshToken).toBe('refresh-2');
  }, 30_000);

  test('a released lock leaves no advisory lock, whichever backends served it', async () => {
    const heldAdvisoryLocks = async () =>
      (
        await mockSource.query(
          "SELECT count(*)::int AS count FROM pg_locks WHERE locktype = 'advisory' AND granted",
        )
      )[0].count;
    for (let attempt = 0; attempt < 5; attempt++) {
      // As the renewal and client calls do: the binding is saved under the held lock.
      await withReplicaLock(JSON.stringify(['oauth', 'gitlab', 'alice']), async () => {
        // Other clients keep backends busy: behind a transaction pooler (PgBouncer in
        // transaction mode), the next transactions of the lock connection may get another one.
        const busy = Promise.all([1, 2, 3].map(() => mockSource.query('SELECT pg_sleep(0.1)')));
        const context = await PersonalOAuthContext.load('gitlab', 'alice', mockDefinition);
        await new MCPHubOAuthProvider('gitlab', context.config).saveTokens({
          access_token: `access-${attempt + 2}`,
          refresh_token: `refresh-${attempt + 2}`,
          token_type: 'Bearer',
          expires_in: 7200,
        });
        await busy;
      });
      expect(await heldAdvisoryLocks()).toBe(0);
    }
    // Another replica takes the lock at once.
    const otherReplica = mockSource.createQueryRunner();
    await otherReplica.connect();
    try {
      await otherReplica.startTransaction();
      await otherReplica.query("SET LOCAL lock_timeout = '1s'");
      await otherReplica.query('SELECT pg_advisory_xact_lock(209, hashtext($1))', [
        JSON.stringify(['oauth', 'gitlab', 'alice']),
      ]);
      await otherReplica.commitTransaction();
    } finally {
      if (otherReplica.isTransactionActive) await otherReplica.rollbackTransaction();
      await otherReplica.release();
    }
    expect((await stored()).accessToken).toBe('access-6');
  });

  test('two overlapping requests save the same binding without waiting for the lock timeout', async () => {
    // Both requests load the binding, then save a grant: the first write commits and the lock
    // is taken again while the second request waits for the same binding in this process.
    const started = Date.now();
    const results = await Promise.allSettled(
      ['access-a', 'access-b'].map(async (accessToken) => {
        const context = await PersonalOAuthContext.load('gitlab', 'alice', mockDefinition);
        await new MCPHubOAuthProvider('gitlab', context.config).saveTokens({
          access_token: accessToken,
          refresh_token: `refresh-${accessToken}`,
          token_type: 'Bearer',
          expires_in: 7200,
        });
      }),
    );
    // The regression showed as the 10-second lock timeout of the first request.
    expect(Date.now() - started).toBeLessThan(9_000);
    // The first write wins; the second one is rejected as stale, never by a lock timeout.
    expect(results[0].status).toBe('fulfilled');
    expect(results[1]).toMatchObject({
      status: 'rejected',
      reason: expect.objectContaining({ message: 'Personal authorization changed; reconnect' }),
    });
    expect((await stored()).accessToken).toBe('access-a');
  }, 30_000);

  test('a write nested in read-only credential work is committed at once', async () => {
    const scope = JSON.stringify(['oauth', 'gitlab', 'alice']);
    const revision = async (source: DataSource) =>
      Number((await source.query('SELECT version FROM mcphub_revision WHERE id = 1'))[0].version);
    const before = await revision(mockSource);
    await withReplicaLock(scope, async () => {
      await withLockConnection(scope, async () => {
        await withLockConnection(
          scope,
          () => getAppDataSource().query('UPDATE mcphub_revision SET version = version + 1'),
          { commit: true },
        );
      });
      // Committed before the lock is released: visible to other connections.
      expect(await revision(mockSource)).toBe(before + 1);
    });
    expect(await revision(mockSource)).toBe(before + 1);
  });

  test('a request of the same process waits for a held lock 10 seconds at most', async () => {
    const scope = JSON.stringify(['oauth', 'gitlab', 'alice']);
    let releaseHolder!: () => void;
    const holderDone = new Promise<void>((resolve) => (releaseHolder = resolve));
    // A long locked action, such as a tool call.
    const holder = withReplicaLock(scope, () => holderDone);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const started = Date.now();
    await expect(withReplicaLock(scope, async () => 'never')).rejects.toThrow(
      'Timed out waiting for a lock held in this process',
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(9_900);
    expect(Date.now() - started).toBeLessThan(12_000);
    releaseHolder();
    await holder;
    await expect(withReplicaLock(scope, async () => 'free')).resolves.toBe('free');
  }, 30_000);

  test('a task resuming during the cleanup of its lock queues like any request', async () => {
    // Personal runtime initialization: a connection task started under the lock outlives it
    // and resumes while the lock is being released, with another request of this process
    // queued for the same binding. Both save credentials (a commit, then a new acquisition).
    const scope = JSON.stringify(['oauth', 'gitlab', 'alice']);
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const saveCredentials = () =>
      withPersonalOAuthLock('gitlab', 'alice', async () => {
        await sleep(400);
        await withLockConnection(
          scope,
          () => getAppDataSource().query('UPDATE mcphub_revision SET version = version + 1'),
          { commit: true },
        );
      });
    let resumeTask!: () => void;
    const cleanupStarted = new Promise<void>((resolve) => (resumeTask = resolve));
    const createQueryRunner = mockSource.createQueryRunner.bind(mockSource);
    jest.spyOn(mockSource, 'createQueryRunner').mockImplementationOnce((...args) => {
      const runner = createQueryRunner(...args);
      const release = runner.release.bind(runner);
      runner.release = async () => {
        // The parent lock is being released: let the task resume in this window.
        resumeTask();
        await sleep(200);
        return release();
      };
      return runner;
    });
    let task: Promise<void> | undefined;
    const started = Date.now();
    const parent = withPersonalOAuthLock('gitlab', 'alice', async () => {
      task = (async () => {
        await cleanupStarted;
        await saveCredentials();
      })();
    });
    await sleep(50);
    const queued = saveCredentials();
    await parent;
    const results = await Promise.allSettled([task!, queued]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled']);
    expect(Date.now() - started).toBeLessThan(9_000);
  }, 30_000);

  test('credential work still running when the action returns is committed', async () => {
    const scope = JSON.stringify(['oauth', 'gitlab', 'alice']);
    const revision = async () =>
      Number(
        (await mockSource.query('SELECT version FROM mcphub_revision WHERE id = 1'))[0].version,
      );
    const before = await revision();
    let work: Promise<unknown> | undefined;
    await withReplicaLock(scope, async () => {
      // Started under the lock, not awaited by the action.
      work = withLockConnection(
        scope,
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 200));
          await getAppDataSource().query('UPDATE mcphub_revision SET version = version + 1');
        },
        { commit: true },
      );
    });
    // Neither rolled back with the lock nor run on a released connection.
    await expect(work).resolves.toBeUndefined();
    expect(await revision()).toBe(before + 1);
  });

  test('a task started inside credential work commits its own write after that work', async () => {
    const scope = JSON.stringify(['oauth', 'gitlab', 'alice']);
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const revision = async () =>
      Number(
        (await mockSource.query('SELECT version FROM mcphub_revision WHERE id = 1'))[0].version,
      );
    const before = await revision();
    let task: Promise<unknown> | undefined;
    await withReplicaLock(scope, async () => {
      await withLockConnection(scope, async () => {
        // Started inside the work, runs its own write once that work has ended.
        task = (async () => {
          await sleep(100);
          await withLockConnection(
            scope,
            () => getAppDataSource().query('UPDATE mcphub_revision SET version = version + 1'),
            { commit: true },
          );
        })();
      });
      // The lock is still held when the task writes.
      await sleep(300);
      expect(await revision()).toBe(before + 1);
    });
    await expect(task).resolves.toBeUndefined();
    expect(await revision()).toBe(before + 1);
  });
});
