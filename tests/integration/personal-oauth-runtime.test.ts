import { PrincipalRuntimeService } from '../../src/services/principalRuntimeService.js';
import { personalOAuthContexts } from '../../src/services/personalOAuthService.js';
import { credentialBindingEvents } from '../../src/services/credentialBindingService.js';
import type { ServerInfo, ServerConfig } from '../../src/types/index.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { CredentialBindingDaoImpl } from '../../src/dao/CredentialBindingDao.js';
import { PersonalOAuthContext } from '../../src/services/personalOAuthService.js';
import type { ServerConfigWithName } from '../../src/types/index.js';
const mockDefinition: ServerConfigWithName = {
  name: 'gitlab',
  type: 'streamable-http',
  url: 'https://gitlab.example/mcp',
  visibility: 'public',
  oauth: { identityMode: 'personal', clientId: 'client' },
};
jest.mock('../../src/dao/DaoFactory.js', () => ({
  getCredentialBindingDao: () =>
    new (jest.requireActual('../../src/dao/CredentialBindingDao.js').CredentialBindingDaoImpl)(),
  getServerDao: () => ({
    findById: async () => mockDefinition,
    findAll: async () => [mockDefinition],
  }),
  getUserDao: () => ({
    findByUsername: async (username: string) => ({ username, isAdmin: false }),
  }),
}));
let directory: string;
const originalPath = process.env.MCPHUB_SETTING_PATH;
const originalKey = process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-personal-oauth-'));
  process.env.MCPHUB_SETTING_PATH = path.join(directory, 'settings.json');
  process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
});
afterEach(() => {
  jest.restoreAllMocks();
  credentialBindingEvents.removeAllListeners();
  fs.rmSync(directory, { recursive: true, force: true });
  if (originalPath === undefined) delete process.env.MCPHUB_SETTING_PATH;
  else process.env.MCPHUB_SETTING_PATH = originalPath;
  if (originalKey === undefined) delete process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY;
  else process.env.MCPHUB_CREDENTIAL_ENCRYPTION_KEY = originalKey;
});

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test('retains a principal-scoped catalog after snapshot discovery without retaining resolved credentials', async () => {
  const seed = await PersonalOAuthContext.load('gitlab', 'alice', mockDefinition);
  await seed.persistTokens('gitlab', { accessToken: 'alice-token' });
  const tools = [{ name: 'gitlab-read', inputSchema: { type: 'object' as const } }];
  const cached = { name: 'gitlab', tools } as ServerInfo;
  const connect = jest.fn();
  const pool = new PrincipalRuntimeService(connect, jest.fn(), async () => cached);
  try {
    (await pool.acquire('gitlab', { username: 'alice' }, true)).release();
    expect(pool.peekTools('gitlab', 'alice')).toEqual(tools);
    expect(pool.peekTools('gitlab', 'bob')).toBeUndefined();
    expect(connect).not.toHaveBeenCalled();
    pool.invalidate({ username: 'alice' });
    expect(pool.peekTools('gitlab', 'alice')).toBeUndefined();
  } finally {
    pool.invalidate();
  }
});

test.each(['reuse', 'handshake'] as const)(
  'does not close an active OAuth runtime when token persistence races the %s revision read',
  async (stage) => {
    const seed = await PersonalOAuthContext.load('gitlab', 'alice', mockDefinition);
    await seed.persistTokens('gitlab', { accessToken: 'old-token' });
    const readStarted = deferred();
    const resumeRead = deferred();
    const child: ServerInfo = {
      name: 'gitlab',
      status: 'connected',
      tools: [],
      prompts: [],
      resources: [],
      error: null,
      createTime: Date.now(),
    };
    let context!: PersonalOAuthContext;
    let pauseNextRead = false;
    const originalGet = CredentialBindingDaoImpl.prototype.get;
    jest.spyOn(CredentialBindingDaoImpl.prototype, 'get').mockImplementation(async function (
      this: CredentialBindingDaoImpl,
      server: string,
      user: string,
    ) {
      const binding = await originalGet.call(this, server, user);
      if (pauseNextRead) {
        pauseNextRead = false;
        readStarted.resolve();
        await resumeRead.promise;
      }
      return binding;
    });
    const connect = jest.fn(async (_name: string, config: ServerConfig) => {
      context = personalOAuthContexts.get(config)!;
      pauseNextRead = stage === 'handshake';
      return child;
    });
    const close = jest.fn();
    const pool = new PrincipalRuntimeService(connect, close);
    let first: Awaited<ReturnType<PrincipalRuntimeService['acquire']>> | undefined;
    try {
      if (stage === 'reuse') {
        first = await pool.acquire('gitlab', { username: 'alice' });
        pauseNextRead = true;
      }
      const acquiring = pool.acquire('gitlab', { username: 'alice' });
      const settled = Promise.allSettled([acquiring]);
      await readStarted.promise;
      const refreshing = context.persistTokens('gitlab', { accessToken: 'refreshed-token' });
      await new Promise((done) => setImmediate(done));
      resumeRead.resolve();
      await refreshing;
      const [result] = await settled;
      expect(result.status).toBe('fulfilled');
      if (result.status === 'fulfilled') {
        expect(result.value.info).toBe(child);
        result.value.release();
      }
      expect(close).not.toHaveBeenCalled();
      expect(connect).toHaveBeenCalledTimes(1);
    } finally {
      resumeRead.resolve();
      first?.release();
      pool.invalidate();
    }
  },
);

test('permits a startup refresh and still replaces the runtime after an external binding rotation', async () => {
  const seed = await PersonalOAuthContext.load('gitlab', 'alice', mockDefinition);
  await seed.persistTokens('gitlab', { accessToken: 'initial' });
  const connect = jest.fn(async (_name: string, config: ServerConfig) => {
    await personalOAuthContexts
      .get(config)!
      .persistTokens('gitlab', { accessToken: 'startup-refreshed' });
    return {
      name: 'gitlab',
      status: 'connected',
      tools: [],
      prompts: [],
      resources: [],
      error: null,
      createTime: Date.now(),
    } as ServerInfo;
  });
  const close = jest.fn();
  const pool = new PrincipalRuntimeService(connect, close);
  try {
    const first = await pool.acquire('gitlab', { username: 'alice' });
    first.release();
    const external = await PersonalOAuthContext.load('gitlab', 'alice', mockDefinition);
    await external.persistTokens('gitlab', { accessToken: 'external-rotation' });
    const next = await pool.acquire('gitlab', { username: 'alice' });
    expect(next.info).not.toBe(first.info);
    expect(close).toHaveBeenCalledWith(first.info);
    expect(connect).toHaveBeenCalledTimes(2);
    next.release();
  } finally {
    pool.invalidate();
  }
});
