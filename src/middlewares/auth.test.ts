import express from 'express';
import request from 'supertest';
import { jest } from '@jest/globals';

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
    app.get('/protected', (req, _res, next) => {
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
      .get('/protected')
      .set('Authorization', 'Bearer test-key');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ success: false, message: 'No token, authorization denied' });
  });

  it('still accepts bearer key auth when enableBearerAuth is true', async () => {
    const app = createApp();
    const response = await request(app)
      .get('/protected')
      .set('Authorization', 'Bearer test-key');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
  });

  it('bypasses dashboard API authentication when skipAuth is true', async () => {
    currentSystemConfig.routing.skipAuth = true;

    const app = createApp();
    const response = await request(app).get('/protected');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
  });

  it('attaches a guest admin user when skipAuth is true', async () => {
    currentSystemConfig.routing.skipAuth = true;

    const app = express();
    app.get(
      '/protected-user',
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

    const response = await request(app).get('/protected-user');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      user: {
        username: 'guest',
        isAdmin: true,
      },
    });
  });
});
