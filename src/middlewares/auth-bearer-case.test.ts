import { jest } from '@jest/globals';
import jwt from 'jsonwebtoken';

const currentSystemConfig = {
  routing: {
    enableBearerAuth: true,
    bearerAuthHeaderName: 'Authorization',
    skipAuth: false,
  },
};

const findEnabledMock = jest.fn();
const mockGetSystemConfig = jest.fn();
const mockGetCachedSystemConfig = jest.fn();

jest.mock('../dao/index.js', () => ({
  getBearerKeyDao: jest.fn(() => ({
    findEnabled: findEnabledMock,
  })),
  getSystemConfigDao: jest.fn(() => ({
    get: mockGetSystemConfig,
  })),
}));

jest.mock('../utils/systemConfigCache.js', () => ({
  getCachedSystemConfig: mockGetCachedSystemConfig,
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

const run = async (authorization: string) => {
  const req: any = {
    headers: { authorization },
    query: {},
    method: 'GET',
    path: '/api/protected',
    baseUrl: '/api',
    originalUrl: '/api/protected',
    t: (v: string) => v,
    header: (n: string) => (n.toLowerCase() === 'authorization' ? authorization : undefined),
  };
  const res: any = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  const next = jest.fn();
  await auth(req, res, next);
  return { req, res, next };
};

describe('auth middleware bearer scheme case', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSystemConfig.mockImplementation(async () => currentSystemConfig);
    mockGetCachedSystemConfig.mockReturnValue(null);
    findEnabledMock.mockResolvedValue([
      { id: 'key-1', name: 'default', token: 'test-key', enabled: true, accessType: 'all' },
    ]);
  });

  it('accepts "Bearer <token>"', async () => {
    const { next, res } = await run('Bearer test-key');
    expect(next).toHaveBeenCalledWith();
    expect(res.status).not.toHaveBeenCalled();
  });

  it.each(['bearer test-key', 'BEARER test-key'])(
    'accepts %s (RFC 7235 case-insensitive scheme)',
    async (h) => {
      const { next, res } = await run(h);
      expect(res.status).not.toHaveBeenCalledWith(401);
      expect(next).toHaveBeenCalledWith();
    },
  );
});
