import express from 'express';
import request from 'supertest';
import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { authenticatedRouteRateLimiter } from '../utils/rateLimit.js';

const currentSystemConfig = {
  routing: {
    enableBearerAuth: true,
    bearerAuthHeaderName: 'Authorization',
    skipAuth: false,
  },
};

const findEnabledMock = jest.fn();

jest.mock('../dao/index.js', () => ({
  getBearerKeyDao: jest.fn(() => ({
    findEnabled: findEnabledMock,
  })),
  getSystemConfigDao: jest.fn(() => ({
    get: jest.fn().mockImplementation(async () => currentSystemConfig),
  })),
}));

jest.mock('../config/index.js', () => ({
  __esModule: true,
  default: {
    readonly: false,
    basePath: '',
  },
  loadSettings: jest.fn(() => ({
    systemConfig: currentSystemConfig,
  })),
}));

jest.mock('../config/jwt.js', () => ({
  JWT_SECRET: 'test-secret',
}));

jest.mock('../models/OAuth.js', () => ({
  getToken: jest.fn().mockResolvedValue(null),
}));

jest.mock('../services/oauthServerService.js', () => ({
  isOAuthServerEnabled: jest.fn(() => false),
}));

jest.mock('../services/betterAuthConfig.js', () => ({
  getBetterAuthRuntimeConfig: jest.fn(() => ({
    enabled: false,
  })),
}));

import { auth } from './auth.js';

describe('auth middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    currentSystemConfig.routing.enableBearerAuth = true;
    currentSystemConfig.routing.bearerAuthHeaderName = 'Authorization';
    currentSystemConfig.routing.skipAuth = false;
    findEnabledMock.mockResolvedValue([
      {
        id: 'key-1',
        name: 'default',
        token: 'test-key',
        enabled: true,
        accessType: 'all',
      },
    ]);
  });

  const createApp = () => {
    const app = express();
    app.get('/api/protected', authenticatedRouteRateLimiter, (req, _res, next) => {
      (req as any).t = (value: string) => value;
      next();
    }, auth, (_req, res) => {
      res.status(200).json({ success: true });
    });
    return app;
  };

  it('does not accept bearer key auth when enableBearerAuth is false', async () => {
    currentSystemConfig.routing.enableBearerAuth = false;

    const app = createApp();
    const response = await request(app)
      .get('/api/protected')
      .set('Authorization', 'Bearer test-key');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ success: false, message: 'No token, authorization denied' });
  });

  it('still accepts bearer key auth when enableBearerAuth is true', async () => {
    const app = createApp();
    const response = await request(app)
      .get('/api/protected')
      .set('Authorization', 'Bearer test-key');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
  });

  it('does not accept group-scoped bearer key auth for dashboard API routes', async () => {
    findEnabledMock.mockResolvedValue([
      {
        id: 'key-2',
        name: 'group-scoped',
        token: 'group-key',
        enabled: true,
        accessType: 'groups',
        allowedGroups: ['engineering'],
      },
    ]);

    const app = createApp();
    const response = await request(app)
      .get('/api/protected')
      .set('Authorization', 'Bearer group-key');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ success: false, message: 'No token, authorization denied' });
  });

  it('does not accept server-scoped bearer key auth for dashboard API routes', async () => {
    findEnabledMock.mockResolvedValue([
      {
        id: 'key-3',
        name: 'server-scoped',
        token: 'server-key',
        enabled: true,
        accessType: 'servers',
        allowedServers: ['filesystem'],
      },
    ]);

    const app = createApp();
    const response = await request(app)
      .get('/api/protected')
      .set('Authorization', 'Bearer server-key');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ success: false, message: 'No token, authorization denied' });
  });

  it('does not accept custom-scoped bearer key auth for dashboard API routes', async () => {
    findEnabledMock.mockResolvedValue([
      {
        id: 'key-4',
        name: 'custom-scoped',
        token: 'custom-key',
        enabled: true,
        accessType: 'custom',
        allowedGroups: ['engineering'],
        allowedServers: ['filesystem'],
      },
    ]);

    const app = createApp();
    const response = await request(app)
      .get('/api/protected')
      .set('Authorization', 'Bearer custom-key');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ success: false, message: 'No token, authorization denied' });
  });

  it('does not accept user-level bearer keys for dashboard API routes', async () => {
    findEnabledMock.mockResolvedValue([
      {
        id: 'key-5',
        name: 'alice-client',
        token: 'user-key',
        enabled: true,
        kind: 'user',
        owner: 'alice',
        accessType: 'all',
      },
    ]);

    const app = createApp();
    const response = await request(app)
      .get('/api/protected')
      .set('Authorization', 'Bearer user-key');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ success: false, message: 'No token, authorization denied' });
  });

  it('bypasses dashboard API authentication when skipAuth is true', async () => {
    currentSystemConfig.routing.skipAuth = true;

    const app = createApp();
    const response = await request(app).get('/api/protected');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
  });

  it('does not bypass non-dashboard routes when skipAuth is true', async () => {
    currentSystemConfig.routing.skipAuth = true;

    const app = express();
    app.get(
      '/protected',
      authenticatedRouteRateLimiter,
      (req, _res, next) => {
        (req as any).t = (value: string) => value;
        next();
      },
      auth,
      (_req, res) => {
        res.status(200).json({ success: true });
      },
    );

    const response = await request(app).get('/protected');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ success: false, message: 'No token, authorization denied' });
  });

  it('attaches a guest admin user when skipAuth is true', async () => {
    currentSystemConfig.routing.skipAuth = true;

    const app = express();
    app.get(
      '/api/protected-user',
      authenticatedRouteRateLimiter,
      (req, _res, next) => {
        (req as any).t = (value: string) => value;
        next();
      },
      auth,
      (req, res) => {
        res.status(200).json({
          success: true,
          user: (req as any).user,
        });
      },
    );

    const response = await request(app).get('/api/protected-user');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      user: {
        username: 'guest',
        isAdmin: true,
      },
    });
  });

  it('returns 500 when validateBearerAuth throws a database error', async () => {
    findEnabledMock.mockRejectedValueOnce(new Error('Database connection failed'));

    const app = express();
    app.get(
      '/api/protected',
      authenticatedRouteRateLimiter,
      (req: express.Request, _res: express.Response, next: express.NextFunction) => {
        (req as any).t = (value: string) => value;
        next();
      },
      auth,
      (_req: express.Request, res: express.Response) => {
        res.status(200).json({ success: true });
      },
      // Error handler to catch next(error) from auth
      (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
        res.status(500).json({ success: false, message: 'Internal server error' });
      },
    );

    const response = await request(app)
      .get('/api/protected')
      .set('Authorization', 'Bearer test-key');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      message: 'Internal server error',
    });
  });

  describe('system bearer auth context', () => {
    it('attaches an admin user context for valid system all-access bearer key', async () => {
      findEnabledMock.mockResolvedValue([
        {
          id: 'key-sys-1',
          name: 'system-client',
          token: 'system-key',
          enabled: true,
          kind: 'system',
          accessType: 'all',
          owner: 'system-owner',
        },
      ]);

      const app = express();
      app.get(
        '/api/protected',
        authenticatedRouteRateLimiter,
        (req, _res, next) => {
          (req as any).t = (value: string) => value;
          next();
        },
        auth,
        (req, res) => {
          res.status(200).json({
            success: true,
            user: (req as any).user,
            bearerKey: (req as any).bearerKey,
          });
        },
      );

      const response = await request(app)
        .get('/api/protected')
        .set('Authorization', 'Bearer system-key');

      expect(response.status).toBe(200);
      expect(response.body.user).toEqual({
        username: 'system-owner',
        isAdmin: true,
      });
      expect(response.body.bearerKey).toEqual(
        expect.objectContaining({
          id: 'key-sys-1',
          name: 'system-client',
          kind: 'system',
          accessType: 'all',
          owner: 'system-owner',
        }),
      );
    });

    it('uses fallback username "system" when system bearer key has no owner', async () => {
      findEnabledMock.mockResolvedValue([
        {
          id: 'key-sys-2',
          name: 'no-owner-system',
          token: 'no-owner-key',
          enabled: true,
          kind: 'system',
          accessType: 'all',
          owner: undefined,
        },
      ]);

      const app = express();
      app.get(
        '/api/protected',
        authenticatedRouteRateLimiter,
        (req, _res, next) => {
          (req as any).t = (value: string) => value;
          next();
        },
        auth,
        (req, res) => {
          res.status(200).json({
            success: true,
            user: (req as any).user,
          });
        },
      );

      const response = await request(app)
        .get('/api/protected')
        .set('Authorization', 'Bearer no-owner-key');

      expect(response.status).toBe(200);
      expect(response.body.user).toEqual({
        username: 'system',
        isAdmin: true,
      });
    });

    it('denies user-kind bearer keys for dashboard API routes', async () => {
      findEnabledMock.mockResolvedValue([
        {
          id: 'key-user-1',
          name: 'user-client',
          token: 'user-key',
          enabled: true,
          kind: 'user',
          accessType: 'all',
          owner: 'alice',
        },
      ]);

      const app = createApp();
      const response = await request(app)
        .get('/api/protected')
        .set('Authorization', 'Bearer user-key');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ success: false, message: 'No token, authorization denied' });
    });

    it('denies system bearer keys with accessType other than all', async () => {
      findEnabledMock.mockResolvedValue([
        {
          id: 'key-scoped-1',
          name: 'groups-scoped',
          token: 'groups-key',
          enabled: true,
          kind: 'system',
          accessType: 'groups',
          allowedGroups: ['engineering'],
        },
      ]);

      const app = createApp();
      const response = await request(app)
        .get('/api/protected')
        .set('Authorization', 'Bearer groups-key');

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ success: false, message: 'No token, authorization denied' });
    });

    it('still authenticates with JWT x-auth-token', async () => {
      const app = express();
      app.get(
        '/api/protected',
        authenticatedRouteRateLimiter,
        (req, _res, next) => {
          (req as any).t = (value: string) => value;
          next();
        },
        auth,
        (req, res) => {
          res.status(200).json({
            success: true,
            user: (req as any).user,
          });
        },
      );

      const token = jwt.sign({ user: { username: 'jwt-user', isAdmin: false } }, 'test-secret');

      const response = await request(app)
        .get('/api/protected')
        .set('x-auth-token', token);

      expect(response.status).toBe(200);
      expect(response.body.user).toEqual({
        username: 'jwt-user',
        isAdmin: false,
      });
    });
  });
});
