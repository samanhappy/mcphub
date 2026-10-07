import express from 'express';
import request from 'supertest';
import type { SystemConfig } from '../../src/types/index.js';

// The stored system config; tests change it the way the Settings page does
let storedConfig: SystemConfig = {};

// Third-party pieces only: the provider registry in src/betterAuth.ts, the
// runtime config resolver and the login controller all run for real
jest.mock('better-auth', () => ({ betterAuth: jest.fn(() => ({ handler: jest.fn() })) }));
jest.mock('better-auth/plugins', () => ({
  genericOAuth: jest.fn(() => ({ id: 'generic-oauth' })),
}));
jest.mock('pg', () => ({ Pool: jest.fn() }));
jest.mock('kysely', () => ({ PostgresDialect: jest.fn() }));

jest.mock('../../src/dao/DaoFactory.js', () => ({
  getSystemConfigDao: jest.fn(() => ({ get: jest.fn(async () => storedConfig) })),
}));

jest.mock('../../src/utils/systemConfigCache.js', () => ({
  getCachedSystemConfig: jest.fn(() => storedConfig),
  isDatabaseModeEnabled: jest.fn(() => true),
}));

jest.mock('../../src/models/User.js', () => ({
  createUser: jest.fn(),
  findUserByUsername: jest.fn(async () => undefined),
  verifyPassword: jest.fn(),
  updateUserPassword: jest.fn(),
}));

jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({ getPermissions: jest.fn(() => ['']) })),
}));

const ENV = {
  OIDC_CLIENT_ID: 'oidc-client-id',
  OIDC_CLIENT_SECRET: 'oidc-client-secret',
  DB_URL: 'postgresql://mcphub:password@localhost:5432/mcphub',
};

const betterAuthSettings = (oidcEnabled: boolean, disablePasswordLogin: boolean): SystemConfig => ({
  auth: {
    betterAuth: {
      enabled: true,
      disablePasswordLogin,
      providers: {
        google: { enabled: false },
        github: { enabled: false },
        oidc: {
          enabled: oidcEnabled,
          discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
        },
      },
    },
  },
});

/**
 * Starts a fresh process: loads Better Auth from the stored config and records
 * its providers as mounted, as `initRoutes` does after mounting the handler.
 */
const startProcess = async () => {
  jest.resetModules();
  const { registeredSsoProviders } = await import('../../src/betterAuth.js');
  const { setMountedSsoProviders, getBetterAuthRuntimeConfig } = await import(
    '../../src/services/betterAuthConfig.js'
  );
  setMountedSsoProviders(registeredSsoProviders);
  const { login } = await import('../../src/controllers/authController.js');

  const app = express();
  app.use(express.json());
  app.post(
    '/api/auth/login',
    (req, _res, next) => {
      (req as any).t = (key: string) => key;
      next();
    },
    login,
  );
  return { app, getBetterAuthRuntimeConfig };
};

const passwordLogin = (app: express.Express) =>
  request(app).post('/api/auth/login').send({ username: 'admin', password: 'secret123' });

describe('password login while SSO is enabled without a restart', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, ...ENV };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('keeps password login until a restart mounts the newly enabled provider', async () => {
    // Started with Better Auth on but no SSO provider mounted
    storedConfig = betterAuthSettings(false, false);
    let hub = await startProcess();

    // An admin enables OIDC, then SSO-only sign-in, in Settings
    storedConfig = betterAuthSettings(true, true);

    const runtime = await hub.getBetterAuthRuntimeConfig();
    expect(runtime.providers.oidc.enabled).toBe(true);
    expect(runtime.disablePasswordLogin).toBe(false);
    // The credentials are still checked (unknown user), not refused outright
    expect((await passwordLogin(hub.app)).status).toBe(401);

    // After a restart the OIDC route exists, so the switch takes effect
    hub = await startProcess();
    expect((await hub.getBetterAuthRuntimeConfig()).disablePasswordLogin).toBe(true);
    expect((await passwordLogin(hub.app)).status).toBe(403);
  });

  it('restores password login once the mounted provider is disabled again', async () => {
    storedConfig = betterAuthSettings(true, true);
    const hub = await startProcess();
    expect((await passwordLogin(hub.app)).status).toBe(403);

    // The handler stays mounted, but the login page no longer offers OIDC
    storedConfig = betterAuthSettings(false, true);

    expect((await passwordLogin(hub.app)).status).toBe(401);
  });
});
