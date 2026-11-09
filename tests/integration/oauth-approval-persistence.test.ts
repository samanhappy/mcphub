import { OAuthState } from '../../src/db/entities/OAuthState.js';
import {
  saveAuthorizationCode,
  getAuthorizationCode,
  revokeUserClientAuthorizationCodes,
} from '../../src/models/OAuth.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { OAuthApprovalDaoImpl, type OAuthApprovalDao } from '../../src/dao/OAuthApprovalDao.js';
import { OAuthApprovalDaoDbImpl } from '../../src/dao/OAuthApprovalDaoDbImpl.js';
import { OAuthTokenDaoDbImpl } from '../../src/dao/OAuthTokenDaoDbImpl.js';
import { OAuthApproval } from '../../src/db/entities/OAuthApproval.js';
import { OAuthToken } from '../../src/db/entities/OAuthToken.js';
import type { OAuthClientApproval } from '../../src/types/index.js';

let mockSource: DataSource;
jest.mock('../../src/db/connection.js', () => ({ getAppDataSource: () => mockSource }));

const approval = (username = 'alice', clientId = 'client'): OAuthClientApproval => ({
  id: randomUUID(),
  username,
  clientId,
  sessionVersion: 'version',
  clientFingerprint: 'fingerprint',
  redirectUri: 'https://client.example/callback',
  resource: 'https://hub.example/mcp',
  scopes: ['read'],
  approvedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 10000).toISOString(),
});

function persistenceContract(createDao: () => OAuthApprovalDao) {
  it('persists across DAO instances and keeps users and clients isolated on revocation', async () => {
    const a = approval();
    const b = approval('bob');
    const c = approval('alice', 'another-client');
    await createDao().save(a);
    await createDao().save(b);
    await createDao().save(c);
    expect(await createDao().findById(a.id)).toEqual(a);
    expect(await createDao().findByUsername('alice')).toEqual(expect.arrayContaining([a, c]));
    await createDao().deleteByUserAndClient('alice', 'client');
    expect(await createDao().findById(a.id)).toBeNull();
    expect(await createDao().findById(b.id)).toEqual(b);
    expect(await createDao().findById(c.id)).toEqual(c);
    await createDao().deleteByUsername('alice');
    expect(await createDao().findByUsername('alice')).toEqual([]);
    await createDao().deleteByClientId('client');
    expect(await createDao().findByUsername('bob')).toEqual([]);
  });
}

describe('file OAuth approval persistence', () => {
  let directory: string;
  const oldPath = process.env.MCPHUB_SETTING_PATH;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-approvals-'));
    process.env.MCPHUB_SETTING_PATH = path.join(directory, 'settings.json');
  });
  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
    if (oldPath === undefined) delete process.env.MCPHUB_SETTING_PATH;
    else process.env.MCPHUB_SETTING_PATH = oldPath;
  });
  persistenceContract(() => new OAuthApprovalDaoImpl());

  it('keeps consent outside configuration and writes owner-only files', async () => {
    await new OAuthApprovalDaoImpl().save(approval());
    expect(fs.existsSync(process.env.MCPHUB_SETTING_PATH!)).toBe(false);
    if (process.platform !== 'win32') {
      // Windows has no POSIX permission bits; Node reports 0o666 for every regular file.
      expect(fs.statSync(`${process.env.MCPHUB_SETTING_PATH}.approvals.json`).mode & 0o777).toBe(
        0o600,
      );
    }
  });

  it('fails closed on corrupt storage instead of forgetting revocations or overwriting state', async () => {
    const file = `${process.env.MCPHUB_SETTING_PATH}.approvals.json`;
    fs.writeFileSync(file, '{}');
    await expect(new OAuthApprovalDaoImpl().save(approval())).rejects.toThrow(
      'Invalid OAuth approval store',
    );
    expect(fs.readFileSync(file, 'utf8')).toBe('{}');
  });
});

const dbSuite = process.env.MCPHUB_TEST_PG_PORT ? describe : describe.skip;
dbSuite('PostgreSQL OAuth approval persistence', () => {
  beforeAll(async () => {
    mockSource = new DataSource({
      type: 'postgres',
      host: '127.0.0.1',
      port: Number(process.env.MCPHUB_TEST_PG_PORT),
      username: 'mcphub_test',
      password: 'mcphub_test',
      database: 'mcphub_test',
      entities: [OAuthApproval, OAuthToken, OAuthState],
      synchronize: true,
    });
    await mockSource.initialize();
  });
  beforeEach(async () => {
    await mockSource.getRepository(OAuthState).clear();
    await mockSource.getRepository(OAuthToken).clear();
    await mockSource.getRepository(OAuthApproval).clear();
  });
  afterAll(async () => {
    if (mockSource?.isInitialized) {
      await mockSource.getRepository(OAuthState).clear();
      await mockSource.getRepository(OAuthToken).clear();
      await mockSource.getRepository(OAuthApproval).clear();
      await mockSource.destroy();
    }
  });
  persistenceContract(() => new OAuthApprovalDaoDbImpl());

  it('preserves the revocable grant reference when tokens are persisted and read', async () => {
    const row = approval();
    await new OAuthApprovalDaoDbImpl().save(row);
    await new OAuthTokenDaoDbImpl().create({
      accessToken: randomUUID(),
      accessTokenExpiresAt: new Date(Date.now() + 10000),
      username: row.username,
      clientId: row.clientId,
      approvalId: row.id,
    });
    const tokens = await new OAuthTokenDaoDbImpl().findByUsername(row.username);
    expect(tokens[0].approvalId).toBe(row.id);
    await new OAuthApprovalDaoDbImpl().deleteByUserAndClient(row.username, row.clientId);
    expect(await new OAuthApprovalDaoDbImpl().findById(tokens[0].approvalId!)).toBeNull();
  });
  it('persists the grant on replica-shared codes and revokes only the matching user/client', async () => {
    const oldMode = process.env.MCPHUB_REPLICA_MODE;
    process.env.MCPHUB_REPLICA_MODE = 'true';
    try {
      const row = approval();
      const payload = {
        username: row.username,
        clientId: row.clientId,
        approvalId: row.id,
        redirectUri: row.redirectUri,
      };
      const a = await saveAuthorizationCode(payload);
      const b = await saveAuthorizationCode({ ...payload, username: 'bob' });
      expect((await getAuthorizationCode(a))?.approvalId).toBe(row.id);
      await revokeUserClientAuthorizationCodes(row.username, row.clientId);
      expect(await getAuthorizationCode(a)).toBeUndefined();
      expect(await getAuthorizationCode(b)).toBeDefined();
    } finally {
      if (oldMode === undefined) delete process.env.MCPHUB_REPLICA_MODE;
      else process.env.MCPHUB_REPLICA_MODE = oldMode;
    }
  });
});
