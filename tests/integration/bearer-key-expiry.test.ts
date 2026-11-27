jest.mock('openid-client', () => ({}));
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Request, Response } from 'express';
import { jest } from '@jest/globals';
import { clearSettingsCache } from '../../src/config/index.js';
import { JsonFileDaoFactory, setDaoFactory } from '../../src/dao/DaoFactory.js';
import { BearerKeyDaoImpl, getBearerKeyUsageStorePath } from '../../src/dao/BearerKeyDao.js';
import { auth } from '../../src/middlewares/auth.js';
import { validateBearerAuth } from '../../src/services/sseService.js';
import {
  createBearerKey,
  resetBearerKey,
  updateBearerKey,
} from '../../src/controllers/bearerKeyController.js';
import {
  flushPendingBearerKeyUsage,
  resetBearerKeyUsageThrottle,
} from '../../src/utils/bearerKeyUsage.js';
import type { IGroup } from '../../src/types/index.js';

const makeReq = (overrides: Record<string, unknown> = {}): Request => {
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries((overrides.headers as Record<string, string>) || {})) {
    headers[k.toLowerCase()] = v;
  }
  return {
    method: 'GET',
    path: '/api/servers',
    baseUrl: '/api',
    originalUrl: '/api/servers',
    params: {},
    query: {},
    body: {},
    headers,
    header(name: string) {
      return headers[name.toLowerCase()];
    },
    t: (key: string) => key,
    ...overrides,
  } as unknown as Request;
};

const makeRes = () => {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: undefined as unknown,
    status: jest.fn(function (this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: jest.fn(function (this: any, payload: unknown) {
      this.body = payload;
      return this;
    }),
    setHeader: jest.fn(function (this: any, key: string, value: string) {
      this.headers[key.toLowerCase()] = value;
      return this;
    }),
  };
  return res as unknown as Response & {
    statusCode: number;
    body: any;
    headers: Record<string, string>;
  };
};

describe('Bearer key expiry and isolated lastUsedAt (file mode)', () => {
  let tmpDir: string;
  let settingsPath: string;
  const origSettingPath = process.env.MCPHUB_SETTING_PATH;
  const origUseDb = process.env.USE_DB;
  const origDbUrl = process.env.DB_URL;

  const writeSettings = (overrides: Record<string, unknown> = {}) => {
    const base = {
      mcpServers: {
        alpha: { command: 'node', args: ['alpha.js'], enabled: true },
        beta: { command: 'node', args: ['beta.js'], enabled: true },
      },
      groups: [
        {
          id: '11111111-1111-4111-8111-111111111111',
          name: 'team-a',
          servers: ['alpha'],
        },
      ],
      users: [{ username: 'admin', password: 'x', isAdmin: true }],
      systemConfig: {
        routing: {
          enableBearerAuth: true,
          enableGlobalRoute: true,
          enableGroupNameRoute: true,
          skipAuth: false,
        },
      },
      bearerKeys: [],
      ...overrides,
    };
    fs.writeFileSync(settingsPath, JSON.stringify(base, null, 2));
    clearSettingsCache();
  };

  const getKeyFromList = async (dao: BearerKeyDaoImpl, id: string) =>
    (await dao.findAll()).find((k) => k.id === id);

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcphub-bearer-expiry-'));
    settingsPath = path.join(tmpDir, 'mcp_settings.json');
    process.env.MCPHUB_SETTING_PATH = settingsPath;
    process.env.USE_DB = 'false';
    delete process.env.DB_URL;
    setDaoFactory(new JsonFileDaoFactory());
    clearSettingsCache();
    resetBearerKeyUsageThrottle();
    writeSettings();
  });

  afterEach(async () => {
    await flushPendingBearerKeyUsage();
    jest.useRealTimers();
    resetBearerKeyUsageThrottle();
    setDaoFactory(new JsonFileDaoFactory());
    clearSettingsCache();
    if (origSettingPath === undefined) delete process.env.MCPHUB_SETTING_PATH;
    else process.env.MCPHUB_SETTING_PATH = origSettingPath;
    if (origUseDb === undefined) delete process.env.USE_DB;
    else process.env.USE_DB = origUseDb;
    if (origDbUrl === undefined) delete process.env.DB_URL;
    else process.env.DB_URL = origDbUrl;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('enforces 1-day expiry boundary with fake timers on Dashboard API, MCP, and OpenAPI', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-27T08:00:00.000Z'));

    const createRes = makeRes();
    await createBearerKey(
      makeReq({
        user: { username: 'admin', isAdmin: true },
        body: { name: 'ci-key', accessType: 'all', expiresInDays: 1 },
      }),
      createRes,
    );
    expect(createRes.statusCode).toBe(201);
    const createdKey = createRes.body.data;
    expect(createdKey.expiresAt).toBe('2026-11-28T08:00:00.000Z');
    const rawToken = createdKey.token as string;

    // 1. Before expiry: Dashboard API succeeds and schedules lastUsedAt
    const next = jest.fn();
    const apiRes = makeRes();
    await auth(makeReq({ headers: { authorization: `Bearer ${rawToken}` } }), apiRes, next);
    expect(next).toHaveBeenCalledTimes(1);
    await flushPendingBearerKeyUsage();

    const dao = new BearerKeyDaoImpl();
    const afterFirstUse = await getKeyFromList(dao, createdKey.id);
    expect(afterFirstUse?.lastUsedAt).toBe('2026-11-27T08:00:00.000Z');

    // 2. Within 1 minute: throttled (no second write)
    jest.advanceTimersByTime(30_000);
    const mcpResult = await validateBearerAuth(
      makeReq({ headers: { authorization: `Bearer ${rawToken}` } }),
    );
    expect(mcpResult.valid).toBe(true);
    await flushPendingBearerKeyUsage();
    expect((await getKeyFromList(dao, createdKey.id))?.lastUsedAt).toBe(
      '2026-11-27T08:00:00.000Z',
    );

    // 3. After 1 minute: OpenAPI-style scoped validation succeeds and updates lastUsedAt
    jest.advanceTimersByTime(31_000);
    const group: IGroup = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'team-a',
      servers: ['alpha'],
    };
    const openApiAuth = await validateBearerAuth(
      makeReq({ params: { group: 'team-a' }, headers: { authorization: `Bearer ${rawToken}` } }),
      group,
    );
    expect(openApiAuth.valid).toBe(true);
    await flushPendingBearerKeyUsage();
    expect((await getKeyFromList(dao, createdKey.id))?.lastUsedAt).toBe(
      '2026-11-27T08:01:01.000Z',
    );

    // 4. Advance past expiresAt: rejected identically to disabled key across API, MCP, OpenAPI
    jest.setSystemTime(new Date('2026-11-28T08:00:00.000Z'));

    const expiredApiNext = jest.fn();
    const expiredApiRes = makeRes();
    await auth(
      makeReq({ headers: { authorization: `Bearer ${rawToken}` } }),
      expiredApiRes,
      expiredApiNext,
    );
    expect(expiredApiNext).not.toHaveBeenCalled();
    expect(expiredApiRes.statusCode).toBe(401);

    const expiredMcp = await validateBearerAuth(
      makeReq({ headers: { authorization: `Bearer ${rawToken}` } }),
    );
    expect(expiredMcp).toEqual({ valid: false, reason: 'invalid' });

    const expiredOpenApi = await validateBearerAuth(
      makeReq({ params: { group: 'team-a' }, headers: { authorization: `Bearer ${rawToken}` } }),
      group,
    );
    expect(expiredOpenApi).toEqual({ valid: false, reason: 'invalid' });

    await flushPendingBearerKeyUsage();
    // Rejected expired calls must NOT update lastUsedAt
    expect((await getKeyFromList(dao, createdKey.id))?.lastUsedAt).toBe(
      '2026-11-27T08:01:01.000Z',
    );
  });

  it('fails closed when persisted expiresAt is malformed in mcp_settings.json', async () => {
    writeSettings({
      bearerKeys: [
        {
          id: 'malformed-str',
          name: 'corrupted-date-key',
          token: 'mcphub_corrupted_str_token',
          enabled: true,
          kind: 'system',
          accessType: 'all',
          expiresAt: 'not-a-valid-date',
        },
        {
          id: 'malformed-empty',
          name: 'empty-date-key',
          token: 'mcphub_corrupted_empty_token',
          enabled: true,
          kind: 'system',
          accessType: 'all',
          expiresAt: '',
        },
      ],
    });

    for (const token of ['mcphub_corrupted_str_token', 'mcphub_corrupted_empty_token']) {
      const apiNext = jest.fn();
      const apiRes = makeRes();
      await auth(makeReq({ headers: { authorization: `Bearer ${token}` } }), apiRes, apiNext);
      expect(apiNext).not.toHaveBeenCalled();
      expect(apiRes.statusCode).toBe(401);

      const mcpRes = await validateBearerAuth(
        makeReq({ headers: { authorization: `Bearer ${token}` } }),
      );
      expect(mcpRes).toEqual({ valid: false, reason: 'invalid' });
    }
  });

  it('does not block or fail authentication when usage storage write fails', async () => {
    const dao = new BearerKeyDaoImpl();
    const created = await dao.create({
      name: 'resilient-key',
      token: 'mcphub_resilient_secret',
      enabled: true,
      kind: 'system',
      accessType: 'all',
    });

    const failingFactory = new JsonFileDaoFactory();
    const realDao = failingFactory.getBearerKeyDao();
    jest.spyOn(realDao, 'recordLastUsed').mockRejectedValue(new Error('usage store down'));
    jest.spyOn(failingFactory, 'getBearerKeyDao').mockReturnValue(realDao);
    setDaoFactory(failingFactory);

    const next = jest.fn();
    const apiRes = makeRes();
    await auth(
      makeReq({ headers: { authorization: 'Bearer mcphub_resilient_secret' } }),
      apiRes,
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);

    const mcpRes = await validateBearerAuth(
      makeReq({ headers: { authorization: 'Bearer mcphub_resilient_secret' } }),
    );
    expect(mcpRes.valid).toBe(true);
    expect(mcpRes.valid && mcpRes.keyId).toBe(created.id);
    await flushPendingBearerKeyUsage();
  });

  it('keeps legacy keys without expiresAt working and preserves/clears expiry on edit and reset', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-27T08:00:00.000Z'));

    const dao = new BearerKeyDaoImpl();
    const legacy = await dao.create({
      name: 'legacy-key',
      token: 'mcphub_legacy_secret_value',
      enabled: true,
      kind: 'system',
      accessType: 'all',
    });
    expect(legacy.expiresAt).toBeUndefined();

    // Legacy key keeps working far in the future
    jest.setSystemTime(new Date('2035-01-01T00:00:00.000Z'));
    const authRes = await validateBearerAuth(
      makeReq({ headers: { authorization: 'Bearer mcphub_legacy_secret_value' } }),
    );
    expect(authRes.valid).toBe(true);
    await flushPendingBearerKeyUsage();

    // Set expiry via update
    const setRes = makeRes();
    await updateBearerKey(
      makeReq({
        params: { id: legacy.id },
        user: { username: 'admin', isAdmin: true },
        body: { expiresInDays: 10 },
      }),
      setRes,
    );
    expect(setRes.statusCode).toBe(200);
    const expectedExpiry = '2035-01-11T00:00:00.000Z';
    expect(setRes.body.data.expiresAt).toBe(expectedExpiry);

    // Omitting expiry on update preserves it
    const renameRes = makeRes();
    await updateBearerKey(
      makeReq({
        params: { id: legacy.id },
        user: { username: 'admin', isAdmin: true },
        body: { name: 'renamed-key' },
      }),
      renameRes,
    );
    expect(renameRes.statusCode).toBe(200);
    expect(renameRes.body.data.expiresAt).toBe(expectedExpiry);

    // Omitting expiry on reset preserves it
    const resetKeepRes = makeRes();
    await resetBearerKey(
      makeReq({
        params: { id: legacy.id },
        user: { username: 'admin', isAdmin: true },
        body: {},
      }),
      resetKeepRes,
    );
    expect(resetKeepRes.statusCode).toBe(200);
    expect(resetKeepRes.body.data.expiresAt).toBe(expectedExpiry);

    // Explicit clear on update removes expiry
    const clearRes = makeRes();
    await updateBearerKey(
      makeReq({
        params: { id: legacy.id },
        user: { username: 'admin', isAdmin: true },
        body: { expiresInDays: null },
      }),
      clearRes,
    );
    expect(clearRes.statusCode).toBe(200);
    expect(clearRes.body.data.expiresAt).toBeUndefined();
    expect((await dao.findById(legacy.id))?.expiresAt).toBeUndefined();
  });

  it('never records lastUsedAt on scope-rejected or anonymous requests', async () => {
    const dao = new BearerKeyDaoImpl();
    const scoped = await dao.create({
      name: 'scoped-alpha',
      token: 'mcphub_scoped_alpha_token',
      enabled: true,
      kind: 'system',
      accessType: 'servers',
      allowedServers: ['alpha'],
    });

    // Scope rejected on MCP (requesting beta)
    const rejectedMcp = await validateBearerAuth(
      makeReq({
        params: { group: 'beta' },
        headers: { authorization: 'Bearer mcphub_scoped_alpha_token' },
      }),
    );
    expect(rejectedMcp).toEqual({ valid: false, reason: 'invalid' });
    await flushPendingBearerKeyUsage();
    expect((await getKeyFromList(dao, scoped.id))?.lastUsedAt).toBeUndefined();

    // Scoped key rejected on Dashboard API
    const next = jest.fn();
    const apiRes = makeRes();
    await auth(
      makeReq({ headers: { authorization: 'Bearer mcphub_scoped_alpha_token' } }),
      apiRes,
      next,
    );
    expect(next).not.toHaveBeenCalled();
    await flushPendingBearerKeyUsage();
    expect((await getKeyFromList(dao, scoped.id))?.lastUsedAt).toBeUndefined();

    // Anonymous request with enableBearerAuth=false
    writeSettings({
      systemConfig: {
        routing: {
          enableBearerAuth: false,
          enableGlobalRoute: true,
          enableGroupNameRoute: true,
          skipAuth: true,
        },
      },
      bearerKeys: [
        {
          id: scoped.id,
          name: 'scoped-alpha',
          token: 'mcphub_scoped_alpha_token',
          enabled: true,
          kind: 'system',
          accessType: 'all',
        },
      ],
    });
    const anonMcp = await validateBearerAuth(makeReq());
    expect(anonMcp).toEqual({ valid: true });
    await flushPendingBearerKeyUsage();
    expect((await getKeyFromList(dao, scoped.id))?.lastUsedAt).toBeUndefined();
  });

  it('isolates file-mode lastUsedAt from mcp_settings.json and serializes concurrent delete + recordLastUsed', async () => {
    const dao = new BearerKeyDaoImpl();
    const created = await dao.create({
      name: 'isolated-key',
      token: 'mcphub_isolated_token',
      enabled: true,
      kind: 'system',
      accessType: 'all',
    });

    const settingsBefore = fs.readFileSync(settingsPath, 'utf8');

    // Recording usage writes only to sidecar, never rewrites mcp_settings.json
    const usedAt = new Date('2026-11-27T09:15:00.000Z');
    await expect(dao.recordLastUsed(created.id, usedAt)).resolves.toBe(true);
    expect(fs.readFileSync(settingsPath, 'utf8')).toBe(settingsBefore);
    expect(fs.existsSync(getBearerKeyUsageStorePath())).toBe(true);
    expect((await getKeyFromList(dao, created.id))?.lastUsedAt).toBe(usedAt.toISOString());

    // Concurrent edit + usage write preserves both the edit and lastUsedAt
    await Promise.all([
      dao.update(created.id, { name: 'concurrent-rename' }),
      dao.recordLastUsed(created.id, new Date('2026-11-27T09:20:00.000Z')),
    ]);
    const afterConcurrent = await getKeyFromList(dao, created.id);
    expect(afterConcurrent?.name).toBe('concurrent-rename');
    expect(afterConcurrent?.lastUsedAt).toBe('2026-11-27T09:20:00.000Z');

    // Deterministic concurrency regression: start recordLastUsed and delete concurrently,
    // await both, re-read sidecar from disk, and verify no orphaned entry remains.
    await Promise.all([
      dao.recordLastUsed(created.id, new Date('2026-11-27T09:25:00.000Z')),
      dao.delete(created.id),
      dao.recordLastUsed(created.id, new Date('2026-11-27T09:30:00.000Z')),
    ]);
    expect(await dao.findById(created.id)).toBeUndefined();
    const sidecarAfterDelete = JSON.parse(fs.readFileSync(getBearerKeyUsageStorePath(), 'utf8'));
    expect(sidecarAfterDelete[created.id]).toBeUndefined();
  });
});
