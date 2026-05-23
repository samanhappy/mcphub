import { Request, Response } from 'express';

const getSystemConfigMock = jest.fn();
const getPermissionsMock = jest.fn();
const getBetterAuthRuntimeConfigMock = jest.fn();

jest.mock('../../src/dao/DaoFactory.js', () => ({
  getSystemConfigDao: jest.fn(() => ({
    get: getSystemConfigMock,
  })),
}));

jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({
    getPermissions: getPermissionsMock,
  })),
}));

jest.mock('../../src/services/betterAuthConfig.js', () => ({
  getBetterAuthRuntimeConfig: getBetterAuthRuntimeConfigMock,
}));

import { getPublicConfig } from '../../src/controllers/configController.js';

describe('ConfigController - getPublicConfig', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockJson: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockJson = jest.fn();
    mockRequest = {};
    mockResponse = {
      json: mockJson,
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
  });

  it('uses DAO-backed routing and Better Auth configuration for public config', async () => {
    const systemConfig = {
      routing: {
        skipAuth: true,
      },
      auth: {
        betterAuth: {
          enabled: true,
        },
      },
    };

    getSystemConfigMock.mockResolvedValue(systemConfig);
    getPermissionsMock.mockReturnValue({
      settings: ['manage'],
    });
    getBetterAuthRuntimeConfigMock.mockResolvedValue({
      enabled: true,
      basePath: '/api/auth/better',
      trustedOrigins: ['https://mcp.example.com'],
      providers: {
        google: { enabled: false },
        github: { enabled: false },
        oidc: {
          enabled: true,
          providerId: 'oidc',
          discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
          scopes: ['openid', 'profile', 'email'],
          pkce: true,
          prompt: undefined,
        },
      },
    });

    await getPublicConfig(mockRequest as Request, mockResponse as Response);

    expect(getSystemConfigMock).toHaveBeenCalledTimes(1);
    expect(getBetterAuthRuntimeConfigMock).toHaveBeenCalledWith(systemConfig);
    expect(getPermissionsMock).toHaveBeenCalledWith({
      username: 'guest',
      password: '',
      isAdmin: true,
    });
    expect(mockJson).toHaveBeenCalledWith({
      success: true,
      data: {
        skipAuth: true,
        permissions: {
          settings: ['manage'],
        },
        betterAuth: {
          enabled: true,
          basePath: '/api/auth/better',
          trustedOrigins: ['https://mcp.example.com'],
          providers: {
            google: { enabled: false },
            github: { enabled: false },
            oidc: {
              enabled: true,
              providerId: 'oidc',
              discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
              scopes: ['openid', 'profile', 'email'],
              pkce: true,
              prompt: undefined,
            },
          },
        },
      },
    });
  });

  it('does not request guest permissions when skipAuth is disabled in DAO-backed settings', async () => {
    const systemConfig = {
      routing: {
        skipAuth: false,
      },
    };

    getSystemConfigMock.mockResolvedValue(systemConfig);
    getBetterAuthRuntimeConfigMock.mockResolvedValue({
      enabled: false,
      basePath: '/api/auth/better',
      trustedOrigins: [],
      providers: {
        google: { enabled: false },
        github: { enabled: false },
        oidc: {
          enabled: false,
          providerId: 'oidc',
          discoveryUrl: undefined,
          scopes: ['openid', 'profile', 'email'],
          pkce: true,
          prompt: undefined,
        },
      },
    });

    await getPublicConfig(mockRequest as Request, mockResponse as Response);

    expect(getPermissionsMock).not.toHaveBeenCalled();
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          skipAuth: false,
          permissions: {},
        }),
      }),
    );
  });
});
